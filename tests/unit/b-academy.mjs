// B 模块单测 · 学业（runFinalExam / gradePoint / checkWarning / judgeThesis）
// 运行：node tests/unit/b-academy.mjs
// 覆盖：期末多门考试（rng 极值）、绩点表边界、挂科警告阈值、毕业论文等级

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../../src/config/loader.js';
import { createGameState } from '../../src/core/state.js';
import {
  runFinalExam, gradePoint, checkWarning, judgeThesis, takeExam,
} from '../../src/core/academy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const reader = { read: (p) => readFile(join(root, 'config', `${p}.json`), 'utf8') };
const config = await loadConfig(reader);
const exam = config.balance.exam;
const fluctuation = Number.isFinite(exam.fluctuation) ? exam.fluctuation : 0.1;

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

console.log('== B · 学业单测 ==');

// --- runFinalExam：rng 恒 0 → score = knowledge × (1 - fluctuation) ---
{
  const s = baseState(10);
  const res = runFinalExam(s, config, rngStub(0));
  const passLine = Number.isFinite(exam.passLine) ? exam.passLine : 60;
  const expected = Math.round(passLine + 10 * 0.6 * (1 - fluctuation));
  check('runFinalExam: rng=0 → score=round(60+10×0.6×0.9)=65（保底及格）',
    res.ok === true && res.subjects.every((x) => x.score === expected),
    `expected=${expected}, scores=${res.subjects.map((x) => x.score).join(',')}`);
  check('runFinalExam: 永不低于及格线 60', res.subjects.every((x) => x.score >= passLine),
    `scores=${res.subjects.map((x) => x.score).join(',')}`);
  check('runFinalExam: 返回 4 门与挂科数', res.subjects.length === exam.subjects.length
    && res.failedThisSemester === res.subjects.filter((x) => !x.passed).length,
    `n=${res.subjects.length}`);
  check('runFinalExam: 写 semesterRecords', Array.isArray(s.academics.semesterRecords)
    && s.academics.semesterRecords.length === 1,
    JSON.stringify(s.academics.semesterRecords));
  check('runFinalExam: 写回 state.academics.totalGpa', typeof s.academics.totalGpa === 'number'
    && s.academics.totalGpa === res.totalGpa,
    `totalGpa=${s.academics.totalGpa}`);
}

// --- runFinalExam：rng 恒 0.999999 → score ≈ knowledge × (1 + fluctuation) ---
{
  const s = baseState(10);
  const res = runFinalExam(s, config, rngStub(0.999999));
  const passLine2 = Number.isFinite(exam.passLine) ? exam.passLine : 60;
  const expected = Math.round(passLine2 + 10 * 0.6 * (1 + fluctuation));
  check('runFinalExam: rng≈1 → score=round(60+10×0.6×1.1)=67',
    res.subjects.every((x) => x.score === expected),
    `expected=${expected}, scores=${res.subjects.map((x) => x.score).join(',')}`);
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
