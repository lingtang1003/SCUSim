/**
 * 角色信息面板：点每一学期可以展开该学期的逐科成绩
 * 运行：node tests/verify_profile.mjs
 *
 * 覆盖：
 *  A) 默认：整块学期列表是收起的（is-collapsed），点标题才展开
 *  B) 每个学期行都是按钮（aria-expanded=false），默认不带 is-open
 *  C) 点第 1 学期 → 只展开第 1 学期的逐科成绩（课程名/分数/绩点/难度），第 2 学期保持收起
 *  D) 再点一次 → 收起
 *  E) 可以同时展开多个学期（互不干扰）
 *  F) 只有学期汇总、没有逐科记录的老存档：点了不展开，并给一句说明
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRng } from '../src/core/rng.js';
import * as engine from '../src/core/engine.js';
import { createApp } from '../src/ui/ui.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.error(`  FAIL  ${name}  ${detail}`); }
}

// ---------------- 最小 DOM 桩 ----------------
function makeEl(tag = 'div') {
  const children = [];
  const listeners = {};
  const el = {
    tagName: tag, nodeType: 1, className: '', _text: '', style: {}, dataset: {},
    children, parentNode: null, value: '',
    classList: {
      add: (...c) => {
        const set = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
        c.forEach((x) => set.add(x));
        el.className = Array.from(set).join(' ');
      },
      remove: (...c) => {
        const set = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
        c.forEach((x) => set.delete(x));
        el.className = Array.from(set).join(' ');
      },
      contains: (c) => String(el.className || '').split(/\s+/).includes(c),
      toggle: () => false,
    },
    appendChild(c) { c.parentNode = el; children.push(c); return c; },
    removeChild(c) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); return c; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { el['attr_' + k] = v; },
    getAttribute(k) { return el['attr_' + k]; },
    click() { fire(el, 'click'); },
    querySelector(sel) { return queryAll(el, sel)[0] || null; },
    querySelectorAll(sel) { return queryAll(el, sel); },
    get textContent() {
      if (el._text) return el._text;
      return children.map((c) => (c && c.textContent != null ? String(c.textContent) : '')).join('');
    },
    set textContent(v) { el._text = String(v); },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html || ''; },
    set(v) { el._html = v; if (v === '') { children.length = 0; el._text = ''; } },
  });
  el._listeners = listeners;
  return el;
}

function fire(el, type) {
  for (const fn of (el._listeners && el._listeners[type]) || []) {
    fn({ type, target: el, currentTarget: el, preventDefault() {} });
  }
}

function matchesToken(el, token) {
  return String(token).split('.').filter(Boolean)
    .every((cls) => String(el.className || '').split(/\s+/).includes(cls));
}
function collect(node, token, out) {
  for (const c of node.children || []) {
    if (c && c.nodeType === 1) {
      if (matchesToken(c, token)) out.push(c);
      collect(c, token, out);
    }
  }
}
function queryAll(node, selector) {
  let pool = [node];
  for (const part of String(selector).trim().split(/\s+/)) {
    const next = [];
    for (const p of pool) collect(p, part, next);
    pool = next;
  }
  return pool;
}

const doc = {
  createElement: (t) => makeEl(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
  getElementById: () => makeEl(),
  querySelector: () => null,
  body: makeEl('body'),
  documentElement: makeEl('html'),
  addEventListener() {},
  removeEventListener() {},
};

const config = await (await import('../src/config/loader.js')).loadConfig({
  read: (n) => readFile(join(root, 'config', `${n}.json`), 'utf8'),
});

const state = engine.newGame({
  name: '成绩生', gender: '女', collegeId: 'cs',
  attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
  tags: ['study_hard', 'gamer', 'chill'], seed: 5,
}, config, createRng(5)).state;
state.turn = 10;
state.academics.totalGpa = 2.13;
state.academics.failedCourses = 0;
state.academics.semesterRecords = [
  {
    semester: 1,
    turn: 5,
    semesterGpa: 1.55,
    failed: 0,
    subjects: [
      { name: '大学英语（综合）', score: 60, gpa: 1.0, passed: true, topic: 'basics', difficulty: 5, weight: 1.5 },
      { name: '微积分（Ⅰ）', score: 74, gpa: 2.7, passed: true, topic: 'major', difficulty: 9, weight: 1.9 },
    ],
  },
  {
    semester: 2,
    turn: 10,
    semesterGpa: 3.1,
    failed: 0,
    subjects: [
      { name: '数据结构与算法分析', score: 88, gpa: 3.7, passed: true, topic: 'major', difficulty: 8, weight: 1.8 },
    ],
  },
];

console.log('== SCUSim 角色信息 · 学期成绩展开自检 ==');

const rootEl = makeEl('div');
const app = createApp({ config, callbacks: {}, doc, appearance: 'm_short1' });
app.mount(rootEl, { hasSave: false });
app.render(state, {});
// HUD 上的人物胶囊就是「角色信息」入口
const nameChip = rootEl.querySelector('.vn-hud__name');
check('准备：HUD 上有人物胶囊（角色信息入口）', !!nameChip);
if (nameChip) fire(nameChip, 'click');

const list = () => rootEl.querySelector('.vn-score__list');
check('A: 学期列表默认收起', !!list() && list().classList.contains('is-collapsed'),
  list() && list().className);

const head = rootEl.querySelector('.vn-score__head');
check('A: 有「各学期成绩和绩点」的展开按钮', !!head && String(head.textContent).includes('各学期成绩'));
if (head) fire(head, 'click');
check('A: 点标题后列表展开', !!list() && !list().classList.contains('is-collapsed'),
  list() && list().className);

const sems = rootEl.querySelectorAll('.vn-score__row--sem');
check('B: 两个学期各有一行', sems.length === 2, String(sems.length));
check('B: 学期行是按钮且默认 aria-expanded=false',
  sems.every((r) => String(r.tagName).toLowerCase() === 'button' && r.getAttribute('aria-expanded') === 'false'),
  sems.map((r) => r.tagName + '/' + r.getAttribute('aria-expanded')).join(','));
check('B: 默认所有学期都是收起的',
  sems.every((r) => !r.classList.contains('is-open')));

const subsOf = (row) => (row && row.parentNode ? row.parentNode.querySelector('.vn-score__subs') : null);
check('B: 每个学期都有逐科成绩容器（默认不带 is-open）',
  sems.every((r) => {
    const s = subsOf(r);
    return !!s && !s.classList.contains('is-open');
  }));

// C) 展开第 1 学期
if (sems[0]) fire(sems[0], 'click');
const s1 = subsOf(sems[0]);
check('C: 点第 1 学期后它展开', !!s1 && s1.classList.contains('is-open'), s1 && s1.className);
check('C: 第 1 学期行标记为展开（aria-expanded=true）',
  !!sems[0] && sems[0].getAttribute('aria-expanded') === 'true' && sems[0].classList.contains('is-open'));

const subRows = s1 ? queryAll(s1, '.vn-score__row--sub') : [];
check('C: 展开内容是这门学期的所有科目（2 门）', subRows.length === 2, String(subRows.length));
const subText = subRows.map((r) => String(r.textContent)).join(' | ');
check('C: 逐科成绩带课程名与分数',
  subText.includes('大学英语（综合）') && subText.includes('微积分（Ⅰ）')
  && subText.includes('60 分') && subText.includes('74 分'), subText);
check('C: 逐科成绩带绩点', subText.includes('绩点 1.00') && subText.includes('绩点 2.70'), subText);
check('C: 逐科成绩不再显示难度标记（「难 N」）', !subText.includes('难 '), subText);

const s2 = subsOf(sems[1]);
check('C: 第 2 学期保持收起', !!s2 && !s2.classList.contains('is-open'), s2 && s2.className);

// E) 再展开第 2 学期 → 两个同时开
if (sems[1]) fire(sems[1], 'click');
check('E: 两个学期可以同时展开',
  !!s1 && s1.classList.contains('is-open') && !!s2 && s2.classList.contains('is-open'));

// D) 再点第 1 学期 → 收起
if (sems[0]) fire(sems[0], 'click');
check('D: 再点一次收起', !!s1 && !s1.classList.contains('is-open'), s1 && s1.className);
check('D: 收起后 aria-expanded=false',
  !!sems[0] && sems[0].getAttribute('aria-expanded') === 'false');

// F) 老存档：只有学期汇总，没有 subjects
{
  const legacy = engine.newGame({
    name: '老档生', gender: '男', collegeId: 'cs',
    attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
    tags: ['study_hard', 'gamer', 'chill'], seed: 6,
  }, config, createRng(6)).state;
  legacy.turn = 6;
  delete legacy.academics.semesterRecords;
  legacy.academics.semesterScores = [60, 66];
  const rootEl2 = makeEl('div');
  const app2 = createApp({ config, callbacks: {}, doc, appearance: 'm_short1' });
  app2.mount(rootEl2, { hasSave: false });
  app2.render(legacy, {});
  const chip2 = rootEl2.querySelector('.vn-hud__name');
  if (chip2) fire(chip2, 'click');
  const list2 = rootEl2.querySelector('.vn-score__list');
  if (list2) list2.className = 'vn-score__list';
  const rows = rootEl2.querySelectorAll('.vn-score__row--sem');
  check('F: 老存档也按学期列出', rows.length === 2, String(rows.length));
  if (rows[0]) fire(rows[0], 'click');
  const sub2 = subsOf(rows[0]);
  check('F: 没有逐科记录时不展开', !!sub2 && !sub2.classList.contains('is-open'));
  check('F: 给出「没有逐科记录」的说明',
    !!sub2 && String(sub2.textContent).includes('没有逐科记录'), sub2 && sub2.textContent);
}

console.log(`\n总计 ${pass + failures.length} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
