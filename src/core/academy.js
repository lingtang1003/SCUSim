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
  fluctuation: 0.10,
  passLine: 60,
  base: 60,
  knowledgeWeight: 1.0,
  growthRate: 0.6,
  studyBonusPerAction: 3,
  difficultyBase: 10,
};

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
 * 每学期期末考试（对每门科目）。
 * 单门公式：score = round( knowledge * (1 + (rng.next()*2 - 1) * exam.fluctuation) )，夹 [0,100]；
 * passed = score >= exam.passLine；failedCourses += 未通过门数。
 * 写 academics.semesterRecords（详细），并累计 gpaPoints 计算 totalGpa。
 * （semesterScores 由 engine 通过 takeExam 的返回值维护，本函数不写，避免重复。）
 * @param {object} state
 * @param {object} config
 * @param {object} rng
 * @returns {{ ok: boolean, subjects: Array<{name,score,passed,gpa}>, semesterGpa: number, totalGpa: number, failedThisSemester: number }}
 */
export function runFinalExam(state, config, rng) {
  const exam = getExamConfig(config);
  const knowledge = Number(state.player.attributes.knowledge) || 0;
  const fluctuation = Number.isFinite(exam.fluctuation) ? exam.fluctuation : DEFAULT_EXAM.fluctuation;
  const passLine = Number.isFinite(exam.passLine) ? exam.passLine : DEFAULT_EXAM.passLine;
  const base = Number.isFinite(exam.base) ? exam.base : DEFAULT_EXAM.base;
  const kWeight = Number.isFinite(exam.knowledgeWeight) ? exam.knowledgeWeight : DEFAULT_EXAM.knowledgeWeight;
  const growth = Number.isFinite(exam.growthRate) ? exam.growthRate : DEFAULT_EXAM.growthRate;
  const subjects = Array.isArray(exam.subjects) && exam.subjects.length ? exam.subjects : DEFAULT_EXAM.subjects;

  const next = (rng && typeof rng.next === 'function') ? () => rng.next() : () => 0.5;
  const health = Number(state.player.attributes.health) || 0;
  const results = subjects.map((name) => {
    const n = next();
    // 学识饱和贡献（开根号边际递减）：学识100→40分加成，学识50→≈28，学识10→≈13
    const knowGain = 40 * Math.sqrt(Math.max(0, knowledge) / 100);
    // 健康调节：60为基准，偏离每点0.1（健康100→+4，健康20→-4），死读书拖分
    const healthMod = (health - 60) * 0.1;
    // 整体乘随机波动，保底 passLine(60)、封顶100（永不挂科）
    const baseScore = passLine + knowGain + healthMod;
    const raw = baseScore * (1 + (n * 2 - 1) * fluctuation);
    let score = Math.round(raw);
    score = Math.max(passLine, Math.min(100, score));
    const passed = score >= passLine;
    const gpa = gradePoint(score, config);
    return { name, score, passed, gpa };
  });

  const failedThisSemester = results.filter((s) => !s.passed).length;
  state.academics.failedCourses = (Number(state.academics.failedCourses) || 0) + failedThisSemester;

  const semesterGpa = round2(average(results.map((s) => s.gpa)));
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
