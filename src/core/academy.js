/**
 * 学业模块（B · 被 engine 调用）。
 *
 * 功能：
 *  - gradePoint(score, config)：按 balance.gpaTable 查绩点。
 *  - runFinalExam(state, config, rng)：每学期多门考试，写 academics，返回成绩/绩点/挂科。
 *  - takeExam(state, config, rng)：兼容层（engine 既有调用），内部委托 runFinalExam。
 *  - checkWarning(state, config)：挂科达到阈值置学业警告（首次触发记 warningTurn + history）。
 *  - judgeThesis(state, config)：毕业论文等级判定。
 *
 * 纯逻辑模块，随机一律通过入参 rng，不触碰 DOM / 存储 / 原生随机。
 */

import { pushLog } from './state.js';

const DEFAULT_EXAM = {
  subjects: ['科目'],
  passLine: 60,
  progSatiety: 12,
  progBonus: 32,
  progCap: 2.0,
  base: 46,
  knowledgeWeight: 0.30,
  healthWeight: 0.15,
  healthClamp: 12,
  noiseAmp: 8,
  gpaWeightByDifficulty: 0.1,
  defaultTopic: 'major',
  defaultDifficulty: 6,
};

// 课名规则缓存：同一 pattern 只编译一次正则
const NAME_RULE_CACHE = new Map();

/** 课名规则匹配：match 当作「|」分隔的正则（编译失败则退化成子串包含）。 */
function matchesName(name, pattern) {
  if (typeof name !== 'string' || typeof pattern !== 'string' || !pattern) return false;
  let re = NAME_RULE_CACHE.get(pattern);
  if (re === undefined) {
    try { re = new RegExp(pattern); } catch (err) { re = null; }
    NAME_RULE_CACHE.set(pattern, re);
  }
  return re ? re.test(name) : name.includes(pattern);
}

function getBalance(config) {
  return (config && config.balance) || {};
}

function getExamConfig(config) {
  const exam = getBalance(config).exam;
  if (exam && typeof exam === 'object') return { ...DEFAULT_EXAM, ...exam };
  return { ...DEFAULT_EXAM };
}

function getGpaTable(config) {
  const table = getBalance(config).gpaTable;
  return Array.isArray(table) ? table : [];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function average(nums) {
  if (!nums.length) return 0;
  return nums.reduce((s, x) => s + Number(x), 0) / nums.length;
}

/**
 * 按 balance.gpaTable（降序 min）返回第一个 score >= min 的绩点；无命中返回 0。
 * @param {number} score 0..100
 * @param {object} config
 * @returns {number}
 */
export function gradePoint(score, config) {
  const table = getGpaTable(config);
  if (table.length === 0) return 0;
  const sorted = table.slice().sort((a, b) => (Number(b.min) || 0) - (Number(a.min) || 0));
  for (const row of sorted) {
    if (score >= Number(row.min)) return Number(row.gpa) || 0;
  }
  return 0;
}

/** 累计绩点：把本门 gpa 记入 state.academics.gpaPoints，返回全部历史科目平均（保留 2 位）。 */
function pushGpaPoints(state, gpa) {
  if (!Array.isArray(state.academics.gpaPoints)) state.academics.gpaPoints = [];
  state.academics.gpaPoints.push(Number(gpa) || 0);
  return round2(average(state.academics.gpaPoints));
}

/**
 * 单门课程画像：该课考哪个学习方向（major/basics/humanities）+ 难度 + 绩点权重。
 * 优先用 exam.subjectTopics 精确名映射（老配置兼容），否则按 exam.courseTopicRules /
 * exam.courseDifficultyRules 的课名规则匹配（第一条命中即止），都不命中走 default。
 * @param {string} name 课程名
 * @param {object} config 全量配置
 * @param {object} [examCfg] balance.exam
 * @returns {{ topic: string, difficulty: number, weight: number }}
 */
export function courseProfile(name, config, examCfg) {
  const exam = examCfg || getExamConfig(config);
  const exactTopics = (exam.subjectTopics && typeof exam.subjectTopics === 'object') ? exam.subjectTopics : {};
  let topic = exactTopics[name];
  if (typeof topic !== 'string' || !topic) {
    const rules = Array.isArray(exam.courseTopicRules) ? exam.courseTopicRules : [];
    for (const r of rules) {
      if (r && r.topic && r.match && matchesName(name, r.match)) { topic = r.topic; break; }
    }
  }
  if (typeof topic !== 'string' || !topic) topic = exam.defaultTopic || DEFAULT_EXAM.defaultTopic;

  let difficulty = null;
  const diffRules = Array.isArray(exam.courseDifficultyRules) ? exam.courseDifficultyRules : [];
  for (const r of diffRules) {
    if (r && Number.isFinite(r.difficulty) && r.match && matchesName(name, r.match)) {
      difficulty = r.difficulty;
      break;
    }
  }
  if (!Number.isFinite(difficulty)) {
    difficulty = Number.isFinite(exam.defaultDifficulty) ? exam.defaultDifficulty : DEFAULT_EXAM.defaultDifficulty;
  }

  const perDiff = Number.isFinite(exam.gpaWeightByDifficulty)
    ? exam.gpaWeightByDifficulty
    : DEFAULT_EXAM.gpaWeightByDifficulty;
  // 越难的课在学期绩点里权重越高（1.0 ≈ 送给分课，1.9 ≈ 数学/实验类硬课）
  const weight = round2(1 + Math.max(0, difficulty) * perDiff);
  return { topic, difficulty, weight };
}

/**
 * 每学期期末考试（对每门科目逐门算分）。
 * 单门公式：
 *   raw = base + progBonus × √min(该方向进度 / progSatiety, progCap)
 *         + knowledgeWeight × 学识
 *         + clamp(healthWeight × (健康 - 60), ±healthClamp)
 *         - 该课难度 + 随机项(-noiseAmp~+noiseAmp)
 *   score = clamp(round(raw), passLine, 100)
 * 说明：拆分「进度/学识/健康/课难/随机」五项相加，使不同课不同方向有区分度；
 * 保留「永不挂科」决议——低于及格线一律钳到 passLine，挂科数恒为 0。
 * 学期绩点按课程难度加权平均（硬课权重大），避免门数多时被水课拉平。
 * 写 academics.semesterRecords（详细），并累计 gpaPoints 计算 totalGpa。
 * @param {object} state
 * @param {object} config
 * @param {object} rng
 * @returns {{ ok: boolean, subjects: Array<{name,score,passed,gpa,topic,difficulty}>, semesterGpa: number, totalGpa: number, failedThisSemester: number }}
 */
/**
 * 本学期考试科目 = 该学期 2 门公共课 + 该学院 2 门专业课（config/courses.json）。
 * 没配置该学院/该学期时退回 balance.exam.subjects，保证老存档也能考。
 * @returns {string[]} 科目名列表
 */
/** 取某学院某学期的专业课；该学期没配就往前找最近的学期。 */
function majorsAt(collegeMap, semester) {
  if (!collegeMap) return [];
  for (let s = semester; s >= 1; s -= 1) {
    const arr = collegeMap[String(s)];
    if (Array.isArray(arr) && arr.length) return arr;
  }
  return [];
}

export function subjectsFor(state, config, examCfg) {
  const exam = examCfg || getExamConfig(config);
  const fallback = Array.isArray(exam.subjects) && exam.subjects.length
    ? exam.subjects.slice()
    : DEFAULT_EXAM.subjects.slice();
  const courses = (config && config.courses) || null;
  if (!courses || !courses.public) return fallback;

  const balance = getBalance(config);
  const months = Number.isFinite(balance.monthsPerSemester) ? balance.monthsPerSemester : 5;
  const semester = Math.min(8, Math.max(1, Math.ceil((Number(state && state.turn) || 1) / months)));

  const pub = (courses.public && Array.isArray(courses.public[String(semester)]))
    ? courses.public[String(semester)]
    : [];
  const collegeId = state && state.player && state.player.collegeId;
  // 大四（学期 7/8）只考公共课（毕业实习 / 毕业论文 就在 public 里），不排专业课
  if (semester >= 7) {
    return pub.length ? pub.slice() : fallback;
  }

  const collegeMap = (courses.colleges && collegeId) ? courses.colleges[collegeId] : null;
  // 其他学期若没单独录入，沿用最近一个学期的专业课
  const majors = majorsAt(collegeMap, semester);

  // 该学院/该学期没有专业课配置（老存档、未录入的学院）→ 用 balance 的默认科目
  if (!majors.length) return fallback;
  // 全部科目：该学期所有公共课 + 该学院该学期所有专业课
  const out = pub.concat(majors);
  return out.length ? out : fallback;
}

export function runFinalExam(state, config, rng) {
  const exam = getExamConfig(config);
  const knowledge = Number(state.player.attributes.knowledge) || 0;
  const health = Number(state.player.attributes.health) || 0;
  const passLine = Number.isFinite(exam.passLine) ? exam.passLine : DEFAULT_EXAM.passLine;
  const base = Number.isFinite(exam.base) ? exam.base : DEFAULT_EXAM.base;
  const kWeight = Number.isFinite(exam.knowledgeWeight) ? exam.knowledgeWeight : DEFAULT_EXAM.knowledgeWeight;
  const hWeight = Number.isFinite(exam.healthWeight) ? exam.healthWeight : DEFAULT_EXAM.healthWeight;
  const hClamp = Number.isFinite(exam.healthClamp) ? exam.healthClamp : DEFAULT_EXAM.healthClamp;
  // 兼容旧字段：没配新字段时退回 subjectSatiety / subjectBonus / fluctuation
  const satiety = Number.isFinite(exam.progSatiety)
    ? exam.progSatiety
    : (Number.isFinite(exam.subjectSatiety) ? exam.subjectSatiety : DEFAULT_EXAM.progSatiety);
  const progBonus = Number.isFinite(exam.progBonus)
    ? exam.progBonus
    : (Number.isFinite(exam.subjectBonus) ? exam.subjectBonus : DEFAULT_EXAM.progBonus);
  const progCap = Number.isFinite(exam.progCap) ? exam.progCap : DEFAULT_EXAM.progCap;
  const noiseAmp = Number.isFinite(exam.noiseAmp)
    ? exam.noiseAmp
    : (Number.isFinite(exam.fluctuation) ? exam.fluctuation * 100 : DEFAULT_EXAM.noiseAmp);
  const subjects = subjectsFor(state, config, exam);
  const progress = (state.academics && state.academics.subjectProgress) || {};

  const next = (rng && typeof rng.next === 'function') ? () => rng.next() : () => 0.5;
  const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const results = subjects.map((name) => {
    const n = next();
    const profile = courseProfile(name, config, exam);
    // 该课所属方向的学习进度：学满 satiety 次即 1 个档位，最多吃 progCap 个档位（边际递减）
    const prog = Math.max(0, Number(progress[profile.topic]) || 0);
    const progGain = progBonus * Math.sqrt(Math.min(prog / satiety, progCap));
    // 学识是通用底子（每点 0.30 分）；健康低于 60 扣分、高于 60 加分，最多 ±healthClamp
    const knowGain = kWeight * knowledge;
    const healthMod = clampNum(hWeight * (health - 60), -hClamp, hClamp);
    // 课程自身难度（形势/体育 2 分 → 数学/实验 9 分）
    const raw = base + progGain + knowGain + healthMod - profile.difficulty + (n * 2 - 1) * noiseAmp;
    // 夹到 [passLine,100]：永不挂科决议（低于及格线一律抬到 passLine）
    const score = clampNum(Math.round(raw), passLine, 100);
    const passed = score >= passLine;
    const gpa = gradePoint(score, config);
    return {
      name, score, passed, gpa,
      topic: profile.topic, difficulty: profile.difficulty, weight: profile.weight,
    };
  });

  const failedThisSemester = results.filter((s) => !s.passed).length;
  state.academics.failedCourses = (Number(state.academics.failedCourses) || 0) + failedThisSemester;

  // 学期绩点 = 按课程难度加权平均，硬课权重更大
  const wSum = results.reduce((acc, s) => acc + (Number(s.weight) || 1), 0) || 1;
  const semesterGpa = round2(results.reduce((acc, s) => acc + s.gpa * (Number(s.weight) || 1), 0) / wSum);
  const totalGpa = pushGpaPoints(state, semesterGpa);
  state.academics.totalGpa = totalGpa; // 写回累计绩点，供 judgeThesis 等读取

  if (!Array.isArray(state.academics.semesterRecords)) state.academics.semesterRecords = [];
  state.academics.semesterRecords.push({
    semester: Math.ceil(state.turn / 5),
    turn: state.turn,
    subjects: results,
    semesterGpa,
    failed: failedThisSemester,
  });

  const months = Number.isFinite(getBalance(config).monthsPerSemester)
    ? getBalance(config).monthsPerSemester
    : 5;
  const scoreText = results
    .map((s) => `${s.name} ${s.score} 分` + (s.passed ? '' : '（未及格）'))
    .join('、');
  pushLog(state, `学期 ${Math.ceil(state.turn / months)} 期末成绩：${scoreText}，总绩点 ${totalGpa}`, config);

  return { ok: true, subjects: results, semesterGpa, totalGpa, failedThisSemester };
}

/**
 * 兼容层（engine 既有调用）：返回单学期聚合成绩。
 * score = 本学期各科平均分（四舍五入）；passed = 本学期全部通过。
 * 副作用与 runFinalExam 相同（写 semesterRecords / failedCourses / 累计绩点）。
 * @param {object} state
 * @param {object} config
 * @param {object} rng
 * @returns {{ ok: boolean, score: number, passed: boolean }}
 */
export function takeExam(state, config, rng) {
  const res = runFinalExam(state, config, rng);
  const avg = Math.round(average(res.subjects.map((s) => s.score)));
  return { ok: true, score: avg, passed: res.failedThisSemester === 0 };
}

/**
 * 挂科达到阈值（balance.warningFailedCourses，默认 3）置 warning=true。
 * 首次触发额外写 warningTurn 与 history；返回当前 warning 状态。
 * @param {object} state
 * @param {object} [config]
 * @returns {boolean}
 */
export function checkWarning(state, config) {
  const threshold = Number.isFinite(getBalance(config).warningFailedCourses)
    ? getBalance(config).warningFailedCourses
    : 3;
  if (!state.academics.warning && (Number(state.academics.failedCourses) || 0) >= threshold) {
    state.academics.warning = true;
    if (!Number.isFinite(state.academics.warningTurn)) state.academics.warningTurn = state.turn;
    if (!Array.isArray(state.history)) state.history = [];
    state.history.push({
      type: 'warning',
      turn: state.turn,
      failedCourses: state.academics.failedCourses,
    });
  }
  return !!state.academics.warning;
}

/**
 * 毕业论文：score = knowledge*thesis.knowledgeWeight + totalGpa*thesis.gpaWeight，夹 [0,100]。
 * level = score>=85 ? '优秀' : (score>=passLine ? '通过' : '未通过')。
 * 写 academics.thesis 与 history。
 * @param {object} state
 * @param {object} config
 * @returns {{ ok: boolean, score: number, level: string }}
 */
export function judgeThesis(state, config) {
  const thesis = getBalance(config).thesis;
  const t = (thesis && typeof thesis === 'object') ? thesis : {};
  const kWeight = Number.isFinite(t.knowledgeWeight) ? t.knowledgeWeight : 1.0;
  const gWeight = Number.isFinite(t.gpaWeight) ? t.gpaWeight : 25;
  const passLine = Number.isFinite(t.passLine) ? t.passLine : 60;
  const knowledge = Number(state.player.attributes.knowledge) || 0;
  const totalGpa = Number(state.academics.totalGpa) || 0;
  let score = knowledge * kWeight + totalGpa * gWeight;
  score = Math.max(0, Math.min(100, score));
  const rounded = Math.round(score);
  const level = rounded >= 85 ? '优秀' : (rounded >= passLine ? '通过' : '未通过');
  state.academics.thesis = { score: rounded, level };
  if (!Array.isArray(state.history)) state.history = [];
  state.history.push({ type: 'thesis', turn: state.turn, score: rounded, level });
  return { ok: true, score: rounded, level };
}
