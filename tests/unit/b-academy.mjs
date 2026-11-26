// B 模块单测 · 学业（runFinalExam / gradePoint / checkWarning / judgeThesis）
// 运行：node tests/unit/b-academy.mjs
// 覆盖：新课表逐门算分（方向映射 / 难度分层 / 随机项）、难度加权绩点、绩点表边界、挂科警告阈值、毕业论文等级

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../../src/config/loader.js';
import { createGameState } from '../../src/core/state.js';
import {
  runFinalExam, gradePoint, checkWarning, judgeThesis, takeExam, courseProfile, subjectsFor,
} from '../../src/core/academy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const reader = { read: (p) => readFile(join(root, 'config', `${p}.json`), 'utf8') };
const config = await loadConfig(reader);
const exam = config.balance.exam;

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.error(`  FAIL  ${name}  ${detail}`); failures++; }
}

const baseState = (knowledge = 10) => {
  const s = createGameState({
    name: '测试', gender: '男', collegeId: 'cs',
    attributes: { knowledge, social: 5, health: 5, money: 5 },
    tags: ['study_hard', 'gamer', 'chill'],
  });
  s.turn = 5; // 学期 1 考试
  return s;
};

// rng 桩：next 恒返回指定值；chance 恒 true
function rngStub(nextValue) {
  return { next: () => nextValue, chance: () => true, int: () => 1, pick: (a) => a[0] };
}

const passLine = Number.isFinite(exam.passLine) ? exam.passLine : 60;
const formula = {
  satiety: Number.isFinite(exam.progSatiety) ? exam.progSatiety : 12,
  progBonus: Number.isFinite(exam.progBonus) ? exam.progBonus : 32,
  progCap: Number.isFinite(exam.progCap) ? exam.progCap : 2,
  base: Number.isFinite(exam.base) ? exam.base : 46,
  kWeight: Number.isFinite(exam.knowledgeWeight) ? exam.knowledgeWeight : 0.3,
  hWeight: Number.isFinite(exam.healthWeight) ? exam.healthWeight : 0.15,
  hClamp: Number.isFinite(exam.healthClamp) ? exam.healthClamp : 12,
  noise: Number.isFinite(exam.noiseAmp) ? exam.noiseAmp : 8,
};

/** 按 src/core/academy.js 的新公式复算单门分（含课程方向进度与难度） */
function expectScore(state, name, nextValue) {
  const prof = courseProfile(name, config, exam);
  const knowledge = Number(state.player.attributes.knowledge) || 0;
  const health = Number(state.player.attributes.health) || 0;
  const prog = Math.max(0, Number((state.academics.subjectProgress || {})[prof.topic]) || 0);
  const progGain = formula.progBonus * Math.sqrt(Math.min(prog / formula.satiety, formula.progCap));
  const healthMod = Math.max(-formula.hClamp, Math.min(formula.hClamp, formula.hWeight * (health - 60)));
  const raw = formula.base + progGain + formula.kWeight * knowledge + healthMod - prof.difficulty
    + (nextValue * 2 - 1) * formula.noise;
  return Math.max(passLine, Math.min(100, Math.round(raw)));
}

console.log('== B · 学业单测 ==');

// --- runFinalExam：rng 恒 0 → 取随机项下限，且永不挂科 ---
{
  const s = baseState(10);
  const res = runFinalExam(s, config, rngStub(0));
  const bad = res.subjects.filter((x) => x.score !== expectScore(s, x.name, 0));
  check('runFinalExam: rng=0 → 逐门按新公式取低值（且不低于及格线）',
    res.ok === true && bad.length === 0,
    `偏差=${bad.map((x) => `${x.name}:${x.score}≠${expectScore(s, x.name, 0)}`).join(' ')}`);
  check('runFinalExam: 永不挂科决议仍然成立（全部 ≥ passLine）',
    res.subjects.every((x) => x.score >= passLine && x.score <= 100) && res.failedThisSemester === 0,
    `scores=${res.subjects.map((x) => x.score).join(',')}`);
  check('runFinalExam: 科目数 = 课表科目数（公共课+专业课）',
    res.subjects.length === subjectsFor(s, config).length && res.subjects.length > 0,
    `n=${res.subjects.length}`);
  check('runFinalExam: 写 semesterRecords', Array.isArray(s.academics.semesterRecords)
    && s.academics.semesterRecords.length === 1,
    JSON.stringify(s.academics.semesterRecords));
  check('runFinalExam: 写回 state.academics.totalGpa', typeof s.academics.totalGpa === 'number'
    && s.academics.totalGpa === res.totalGpa,
    `totalGpa=${s.academics.totalGpa}`);
}

// --- runFinalExam：rng 恒 ≈1 → 取随机项上限 ---
{
  const s = baseState(10);
  const res = runFinalExam(s, config, rngStub(0.999999));
  const nextVal = 0.999999;
  const bad = res.subjects.filter((x) => x.score !== expectScore(s, x.name, nextVal));
  check('runFinalExam: rng≈1 → 逐门按新公式取高值',
    bad.length === 0,
    `偏差=${bad.map((x) => `${x.name}:${x.score}≠${expectScore(s, x.name, nextVal)}`).join(' ')}`);
}

// --- 课程画像：方向映射 + 难度分层 + 绩点权重 ---
{
  const topicCases = [
    ['大学英语（综合）', 'basics'],
    ['体育-3', 'basics'],
    ['形势与政策（一）', 'humanities'],
    ['马克思主义基本原理', 'humanities'],
    ['专业核心', 'major'], // 老配置的精确名映射
    ['计算机组成原理', 'major'],
    ['概率统计（理工）', 'major'],
  ];
  const wrong = topicCases.filter(([n, t]) => courseProfile(n, config, exam).topic !== t);
  check('courseProfile: 课程方向映射（英语/体育→basics，形势/思政→humanities，专业课→major）',
    wrong.length === 0,
    wrong.map(([n]) => `${n}→${courseProfile(n, config, exam).topic}`).join(' | '));

  const easy = courseProfile('形势与政策（一）', config, exam).difficulty;
  const mid = courseProfile('大学英语（综合）', config, exam).difficulty;
  const hard = courseProfile('概率统计（理工）', config, exam).difficulty;
  const lab = courseProfile('计算机网络课程设计', config, exam).difficulty;
  check('courseProfile: 难度分层（形势2 / 英语5 / 数学统计9 / 课程设计8）',
    easy === 2 && mid === 5 && hard === 9 && lab === 8,
    `${easy}/${mid}/${hard}/${lab}`);

  const wEasy = courseProfile('形势与政策（一）', config, exam).weight;
  const wHard = courseProfile('概率统计（理工）', config, exam).weight;
  check('courseProfile: 难度越高绩点权重越大', wHard > wEasy, `${wEasy} vs ${wHard}`);
}

// --- 同一分科进度下，难课分低、水课分高（课程区分度） ---
{
  const s = baseState(30);
  s.player.attributes.health = 60;
  s.academics.subjectProgress = { major: 20, basics: 20, humanities: 20 };
  const res = runFinalExam(s, config, rngStub(0.5));
  const get = (n) => res.subjects.find((x) => x.name === n);
  const pol = get('形势与政策（一）');
  // 该学期课表里最难的那门（不写死课名，兼容各学院课表）
  const hardest = res.subjects.reduce((a, x) => (x.difficulty > a.difficulty ? x : a), res.subjects[0]);
  check('runFinalExam: 同一进度下难课分低、水课分高',
    !!pol && !!hardest && pol.difficulty < hardest.difficulty && pol.score > hardest.score,
    `${pol && pol.name}:${pol && pol.score}(难度${pol && pol.difficulty}) vs ${hardest && hardest.name}:${hardest && hardest.score}(难度${hardest && hardest.difficulty})`);
}

// --- 学期绩点按课程难度加权（不是等权平均） ---
{
  const s = baseState(30);
  s.player.attributes.health = 60;
  s.academics.subjectProgress = { major: 20, basics: 20, humanities: 20 };
  const res = runFinalExam(s, config, rngStub(0.5));
  const wSum = res.subjects.reduce((a, x) => a + x.weight, 0);
  const weighted = Math.round((res.subjects.reduce((a, x) => a + x.gpa * x.weight, 0) / wSum) * 100) / 100;
  const plain = Math.round((res.subjects.reduce((a, x) => a + x.gpa, 0) / res.subjects.length) * 100) / 100;
  check('runFinalExam: 学期绩点按难度加权', res.semesterGpa === weighted && weighted !== plain,
    `加权=${weighted} 等权=${plain}`);
}

// --- takeExam 兼容层：score=平均分，passed=全部通过 ---
{
  const s = baseState(80); // 高学识，应通过
  const r = takeExam(s, config, rngStub(0.5));
  check('takeExam: 返回 {ok,score,passed}，学识 80 应通过', r.ok === true && r.passed === true
    && typeof r.score === 'number', JSON.stringify(r));
}

// --- gradePoint：绩点表边界（90/85/84.9/82/60/59.9/0） ---
{
  const cases = [
    [90, 4.0], [85, 3.7], [84.9, 3.3], [82, 3.3],
    [60, 1.0], [59.9, 0], [0, 0], [100, 4.0],
  ];
  let allPass = true;
  const details = [];
  for (const [score, expect] of cases) {
    const got = gradePoint(score, config);
    if (got !== expect) { allPass = false; details.push(`${score}→${got}(期望${expect})`); }
  }
  check('gradePoint: 表边界全部正确', allPass, details.join(' | '));
}

// --- checkWarning：2 → false，3 → true（含首次记 warningTurn + history） ---
{
  const s = baseState();
  s.academics.failedCourses = 2;
  check('checkWarning: 挂科 2 门 → false', checkWarning(s, config) === false);
  s.academics.failedCourses = 3;
  s.turn = 10;
  const w1 = checkWarning(s, config);
  check('checkWarning: 挂科 3 门 → true', w1 === true && s.academics.warning === true);
  check('checkWarning: 首次触发记 warningTurn + history', s.academics.warningTurn === 10
    && Array.isArray(s.history) && s.history.some((h) => h.type === 'warning'));
}

// --- judgeThesis：knowledge 30 / gpa 3.5 → 30 + 87.5 = 117.5 → 100 → 优秀 ---
{
  const s = baseState(30);
  s.academics.totalGpa = 3.5;
  const r = judgeThesis(s, config);
  check('judgeThesis: 高分 → 优秀', r.ok === true && r.level === '优秀' && r.score === 100,
    JSON.stringify(r));
  check('judgeThesis: 写 academics.thesis 与 history', s.academics.thesis && s.academics.thesis.level === '优秀'
    && Array.isArray(s.history) && s.history.some((h) => h.type === 'thesis'));
  const s2 = baseState(20);
  s2.academics.totalGpa = 1.0;
  const r2 = judgeThesis(s2, config); // 20 + 25 = 45 → 未通过
  check('judgeThesis: 低分 → 未通过', r2.level === '未通过', JSON.stringify(r2));
}

console.log(failures === 0 ? '\n学业单测全部通过 ✅' : `\n失败 ${failures} 项 ❌`);
process.exit(failures === 0 ? 0 : 1);
