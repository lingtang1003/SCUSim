/**
 * 课程表 / 考试科目自检：各学院分学期课程（config/courses.json）。
 * 运行：node tests/verify_courses.mjs
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/loader.js';
import { newGame } from '../src/core/engine.js';
import { runFinalExam, subjectsFor } from '../src/core/academy.js';
import { createRng } from '../src/core/rng.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
const failures = [];
function test(name, fn) {
  try {
    const r = fn();
    if (r === true) pass += 1;
    else failures.push(name + (typeof r === 'string' ? ' → ' + r : ''));
  } catch (e) {
    failures.push(name + ' → EXC: ' + (e && e.message ? e.message : String(e)));
  }
}

const config = await loadConfig({ read: (p) => readFile(join(root, 'config', `${p}.json`), 'utf8') });
const courses = config.courses || {};

const collegeIds = (config.colleges.list || []).map((c) => c.id);

function stateOf(collegeId, turn) {
  const ng = newGame({
    name: '林夕',
    gender: '女',
    collegeId,
    attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
    tags: (config.tags.list || []).slice(0, 3).map((t) => t.id),
  }, config, createRng(7));
  if (!ng.ok) throw new Error('newGame 失败: ' + ng.reason);
  ng.state.turn = turn;
  return ng.state;
}

// 1) 配置结构
test('courses: 有 public 且覆盖 8 个学期', () => {
  const pub = courses.public || {};
  for (let sem = 1; sem <= 8; sem += 1) {
    if (!Array.isArray(pub[String(sem)]) || pub[String(sem)].length === 0) {
      return '缺学期 ' + sem;
    }
  }
  return true;
});
test('courses: 每个学院都有 1~6 学期的专业课', () => {
  const cols = courses.colleges || {};
  const bad = [];
  for (const id of collegeIds) {
    const bySem = cols[id];
    if (!bySem) { bad.push(id + '(缺整个学院)'); continue; }
    for (let sem = 1; sem <= 6; sem += 1) {
      const list = bySem[String(sem)];
      if (!Array.isArray(list) || list.length === 0) bad.push(id + '/S' + sem);
    }
  }
  return bad.length ? bad.join(',') : true;
});
test('courses: 专业课里不混进公共课', () => {
  const pub = new Set();
  for (const sem of Object.keys(courses.public || {})) {
    for (const c of courses.public[sem]) pub.add(c);
  }
  const bad = [];
  for (const id of Object.keys(courses.colleges || {})) {
    for (const sem of Object.keys(courses.colleges[id])) {
      for (const c of courses.colleges[id][sem]) {
        if (pub.has(c)) bad.push(id + '/' + sem + ':' + c);
      }
    }
  }
  return bad.length ? bad.slice(0, 6).join(',') : true;
});

test('courses: 同一学年上下两学期课程不重复', () => {
  const cols = courses.colleges || {};
  const bad = [];
  for (const id of Object.keys(cols)) {
    for (const [odd, even] of [['1', '2'], ['3', '4'], ['5', '6']]) {
      const a = cols[id][odd] || [];
      const b = cols[id][even] || [];
      const overlap = a.filter((x) => b.includes(x));
      if (overlap.length) bad.push(id + ' S' + odd + '/S' + even + ':' + overlap.slice(0, 3).join(','));
    }
  }
  return bad.length ? bad.slice(0, 6).join(' | ') : true;
});

// 2) 考试科目按学院/学期取
test('subjectsFor: 同一学期不同学院科目不同', () => {
  const a = subjectsFor(stateOf('cs', 3), config);
  const b = subjectsFor(stateOf('med', 3), config);
  return a.join('|') !== b.join('|');
});
test('subjectsFor: 第一学期含公共课', () => {
  const subs = subjectsFor(stateOf('med', 1), config);
  return subs.some((s) => (courses.public['1'] || []).includes(s));
});
test('subjectsFor: 未知学院退回 balance 默认科目', () => {
  const s = stateOf('cs', 3);
  s.player.collegeId = 'not-exist';
  const subs = subjectsFor(s, config);
  const fallback = config.balance.exam.subjects;
  return subs.length === fallback.length && subs[0] === fallback[0];
});
test('subjectsFor: 学期按 turn 换算（5 回合一学期）', () => {
  const s1 = stateOf('med', 5);
  const s2 = stateOf('med', 6);
  const a = subjectsFor(s1, config);
  const b = subjectsFor(s2, config);
  return a.join('|') !== b.join('|');   // 第 5 回合=第1学期末，第 6 回合=第2学期
});

test('subjectsFor: 科目数 = 该学期公共课数 + 该学院专业课数', () => {
  const s = stateOf('foreign', 15);            // 第 3 学期
  const sem = 3;
  const pubN = ((config.courses.public[String(sem)]) || []).length;
  const majN = ((config.courses.colleges.foreign[String(sem)]) || []).length;
  const subs = subjectsFor(s, config);
  return subs.length === pubN + majN ? true : subs.length + ' != ' + pubN + '+' + majN;
});

// 3) 期末考试用上这些科目
test('runFinalExam: 成绩单科目 = 该学院该学期的考试科目', () => {
  const s = stateOf('cs', 10);          // 第 2 学期
  const expected = subjectsFor(s, config);
  const r = runFinalExam(s, config, createRng(11));
  const got = r.subjects.map((x) => x.name);
  return got.join('|') === expected.join('|') ? true : '期望 ' + expected.join(',') + ' 实际 ' + got.join(',');
});
test('runFinalExam: 医学生与计算机生同一学期考不同专业课', () => {
  const cs = runFinalExam(stateOf('cs', 3), config, createRng(12)).subjects.map((x) => x.name);
  const med = runFinalExam(stateOf('med', 3), config, createRng(12)).subjects.map((x) => x.name);
  return cs.join('|') !== med.join('|');
});

test('subjectsFor: 大四（学期 7/8）只考公共课，不排专业课', () => {
  const s7 = subjectsFor(stateOf('cs', 35), config);   // 第 7 学期
  const s8 = subjectsFor(stateOf('cs', 40), config);   // 第 8 学期
  const pub7 = config.courses.public['7'];
  const pub8 = config.courses.public['8'];
  const onlyPublic = (subs, pub) => subs.length === pub.length && subs.every((x) => pub.includes(x));
  return onlyPublic(s7, pub7) && onlyPublic(s8, pub8);
});

console.log(`\n== verify_courses 结果 ==`);
console.log(`总计 ${pass + failures.length} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
