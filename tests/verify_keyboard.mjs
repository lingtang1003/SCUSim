/**
 * 键盘推进自检：空格 / 回车 = 点击对话框（继续台词、跳过打字机、关掉结算对白）
 * 运行：node tests/verify_keyboard.mjs
 *
 * 覆盖：
 *  A) 事件弹层里按空格 → 逐句继续，最后把选项放出来
 *  B) 结算对白按空格 → 关掉对白（和点击一致）
 *  C) 焦点在输入框（创建页姓名）时按空格 → 不抢按键
 *  D) 焦点在按钮上时按空格 → 不消费，交给浏览器原生按钮行为
 *  E) 没有对白（标题页）时按空格 → 不抛错、也不 preventDefault
 *
 * 注意：bindKeys 是「每个 app 实例只绑一次」的模块级开关，
 * 所以这里只创建一个 app，按 E → A → B → D → C 的顺序走。
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

// ---------------- 最小 DOM 桩（事件 + click + class 选择器） ----------------
function makeEl(tag = 'div') {
  const children = [];
  const listeners = {};
  const el = {
    tagName: tag, nodeType: 1, className: '', _text: '', style: {}, dataset: {},
    children, parentNode: null, disabled: false, value: '',
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
      toggle: (c, force) => {
        const on = force === undefined ? !el.classList.contains(c) : !!force;
        if (on) el.classList.add(c); else el.classList.remove(c);
        return on;
      },
      contains: (c) => String(el.className || '').split(/\s+/).includes(c),
    },
    appendChild(c) { c.parentNode = el; children.push(c); return c; },
    removeChild(c) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); return c; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { el['attr_' + k] = v; if (k === 'value') el.value = v; },
    getAttribute(k) { return el['attr_' + k]; },
    click() { fire(el, 'click'); },
    querySelector(sel) { const r = queryAll(el, sel); return r.length ? r[0] : null; },
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

function fire(el, type, extra) {
  const list = (el._listeners && el._listeners[type]) || [];
  for (const fn of list) fn(Object.assign({ type, target: el, currentTarget: el }, extra || {}));
}

/** 支持 '.a .b.c' 这类「后代 + 多类」选择器（够本项目用） */
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
  const parts = String(selector).trim().split(/\s+/);
  let pool = [node];
  for (const part of parts) {
    const next = [];
    for (const p of pool) collect(p, part, next);
    pool = next;
  }
  return pool;
}

const docListeners = {};
const doc = {
  createElement: (t) => makeEl(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
  getElementById: () => makeEl(),
  querySelector: () => null,
  body: makeEl('body'),
  documentElement: makeEl('html'),
  addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
  removeEventListener() {},
};

function pressKey(key, target) {
  const ev = { key, target: target || doc.body, defaultPrevented: false };
  ev.preventDefault = () => { ev.defaultPrevented = true; };
  for (const fn of docListeners.keydown || []) fn(ev);
  return ev;
}

const config = await (await import('../src/config/loader.js')).loadConfig({
  read: async (n) => readFile(join(root, 'config', `${n}.json`), 'utf8'),
});

const state = engine.newGame({
  name: '键盘生', gender: '男', collegeId: 'cs',
  attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
  tags: ['study_hard', 'gamer', 'chill'], seed: 21,
}, config, createRng(21)).state;

console.log('== SCUSim 键盘推进自检 ==');

const rootEl = makeEl('div');
const acted = [];
const resolved = [];
const app = createApp({
  config,
  callbacks: {
    onAction: (id) => acted.push(id),
    onAdvance: () => acted.push('advance'),
    onResolveEvent: (id) => resolved.push(id),
  },
  doc,
  appearance: 'm_short1',
});
app.mount(rootEl, { hasSave: false });   // 标题页

// ---------------------------------------------------------------------------
// E) 标题页：没有对白，按空格什么都不做
// ---------------------------------------------------------------------------
{
  let thrown = null;
  let ev = null;
  try {
    ev = pressKey(' ');
  } catch (err) {
    thrown = err;
  }
  check('E: 标题页按空格不抛错', !thrown, thrown && thrown.message);
  check('E: 没有对白时不消费按键', !!ev && ev.defaultPrevented === false);
}

// ---------------------------------------------------------------------------
// A) 事件弹层：空格逐句继续
// ---------------------------------------------------------------------------
const evDef = (config.events.random || []).find((e) =>
  Array.isArray(e.lines) && e.lines.length >= 3
  && e.lines[0].speaker && e.lines[1].speaker && e.lines[0].speaker !== e.lines[1].speaker);
check('A: 找到一个多段台词的事件做样本', !!evDef, 'no multi-line event');
if (evDef) {
  app.showEvent({ eventId: evDef.id });
  const speakerOf = () => String((rootEl.querySelector('.vn-event .vn-speaker') || {}).textContent || '');
  const first = speakerOf();
  check('A: 事件弹层停在第 1 句', first === evDef.lines[0].speaker, first);

  const ev1 = pressKey(' ');
  const second = speakerOf();
  check('A: 按空格切到下一句台词', second === evDef.lines[1].speaker, first + ' → ' + second);
  check('A: 空格被消费（preventDefault）', ev1.defaultPrevented === true);

  const waiting = () => {
    const wrap = rootEl.querySelector('.vn-choices--event');
    return !!(wrap && wrap.classList.contains('is-waiting'));
  };
  for (let i = 0; i < 8 && waiting(); i += 1) pressKey(' ');
  check('A: 台词播完后选项放出来', !waiting());
}

// ---------------------------------------------------------------------------
// B) 结算对白：空格关掉对白
// ---------------------------------------------------------------------------
{
  app.closeOverlay();
  app.render(state, {});   // 先正常进第 1 回合（把 ui.lastTurn 定下来）
  app.render(state, {
    eventResult: {
      eventId: 'ev_fixed_welcome',
      text: '你帮她挡了一下挤过来的人群。',
      relationDelta: [{ charId: 'linyu', name: '林予', delta: 6 }],
      delta: {},
      charId: 'linyu',
    },
  });
  check('B: 准备：舞台上有结算对白', !!rootEl.querySelector('.vn-stage .vn-dialogue'));
  const ev = pressKey(' ');
  check('B: 按空格后对白关掉', !rootEl.querySelector('.vn-stage .vn-dialogue'));
  check('B: 空格被消费', ev.defaultPrevented === true);
}

// ---------------------------------------------------------------------------
// D) 焦点在按钮上：交给浏览器原生行为（对白关掉后行动选项才出现）
// ---------------------------------------------------------------------------
{
  // 注意：必须复用同一个 state 对象 —— 换新对象会走「读档/新局」分支并弹出旁白，
  // 那时候行动选项是被对白压住的（真实行为），测不到按钮。
  state.actionPoints = 2;
  state.player.location = 'dorm';
  app.render(state, {});
  const btn = rootEl.querySelector('.vn-choice');
  check('D: 舞台上有可选行动按钮', !!btn, String(!!btn));
  const ev = pressKey(' ', btn || doc.body);
  check('D: 按钮上按空格不被拦截（原生触发）', ev.defaultPrevented === false);
}

// ---------------------------------------------------------------------------
// C) 焦点在输入框：不抢按键
// ---------------------------------------------------------------------------
{
  app.startCreation();
  const input = (function find(node) {
    for (const c of node.children || []) {
      if (!c || c.nodeType !== 1) continue;
      if (String(c.tagName).toLowerCase() === 'input') return c;
      const hit = find(c);
      if (hit) return hit;
    }
    return null;
  })(rootEl);
  check('C: 创建页有姓名输入框', !!input);
  const ev = pressKey(' ', input || doc.body);
  check('C: 输入框里按空格不被拦截', ev.defaultPrevented === false);
}

// ---------------------------------------------------------------------------
// F) 回车同义
// ---------------------------------------------------------------------------
{
  app.render(state, {});
  app.render(state, {
    eventResult: { eventId: 'ev_fixed_welcome', text: '测试回车。', relationDelta: [], delta: {}, charId: '' },
  });
  check('F: 准备：又有结算对白', !!rootEl.querySelector('.vn-stage .vn-dialogue'));
  const ev = pressKey('Enter');
  check('F: 回车也能关掉结算对白', !rootEl.querySelector('.vn-stage .vn-dialogue'));
  check('F: 回车同样被消费', ev.defaultPrevented === true);
}

// ---------------------------------------------------------------------------
// G) 空格执行「本周行动」里第一个可用的卡（带 350ms 防连按）
// ---------------------------------------------------------------------------
{
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  state.actionPoints = 3;
  state.player.location = 'dorm';
  app.render(state, {});
  const cards = rootEl.querySelectorAll('.vn-choice');
  const btn = cards.find((b) => String(b['attr_data-key'] || '') === 'space');
  check('G: 第一个可用行动卡被标成空格目标', !!btn, cards.map((b) => b['attr_data-key'] || '-').join(','));
  const before = acted.length;
  pressKey(' ');   // 刚出现就按：被防连按吃掉
  check('G: 刚出现时立刻按空格不会误触行动', acted.length === before, String(acted.length));
  await sleep(420);
  pressKey(' ');
  check('G: 等过防连按后，空格执行第一个行动', acted.length === before + 1, String(acted.length));
  check('G: 执行的是那张卡对应的行动', acted[acted.length - 1] === 'rest', String(acted[acted.length - 1]));
}

// ---------------------------------------------------------------------------
// H) 事件弹层的分支选项不会被空格误选
// ---------------------------------------------------------------------------
if (evDef) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  app.showEvent({ eventId: evDef.id });
  for (let i = 0; i < 8; i += 1) pressKey(' ');   // 推完台词，选项出现
  await sleep(420);
  const before = resolved.length;
  pressKey(' ');
  check('H: 事件选项不会被空格误选', resolved.length === before, String(resolved.length));
  app.closeOverlay();
}

console.log(`\n总计 ${pass + failures.length} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
