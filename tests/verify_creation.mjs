/**
 * 创建页输入 + 换地点规则自检（Node + 最小 DOM 桩）
 * 运行：node tests/verify_creation.mjs
 *
 * 覆盖：
 *  A) 名字输入：输入法组合期间不改写 value（否则会「打几个字母就打不进字」）
 *  B) 名字输入：非组合输入时过滤非法字符、按 12 字截断
 *  C) 换地点：同一个行动周期（4 AP）内可以自由换地点，不扣 AP
 *  D) 换地点：可以跨校区（江安 ↔ 望江）
 *  E) 换地点：AP 用完后不能再换；有未结算事件时也不能换
 *  F) 换地点后会存盘（刷新后还停在这个地点）
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRng } from '../src/core/rng.js';
import * as engine from '../src/core/engine.js';
import { createStorage } from '../src/storage/storage.js';
import { createController } from '../src/main.js';
import { createApp } from '../src/ui/ui.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.error(`  FAIL  ${name}  ${detail}`); }
}

// ---------------- 最小 DOM 桩（带事件监听） ----------------
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
        const has = String(el.className || '').split(/\s+/).includes(c);
        const on = force === undefined ? !has : !!force;
        if (on) el.classList.add(c); else el.classList.remove(c);
        return on;
      },
      contains: (c) => String(el.className || '').split(/\s+/).includes(c),
    },
    appendChild(child) { child.parentNode = el; children.push(child); return child; },
    removeChild(child) { const i = children.indexOf(child); if (i >= 0) children.splice(i, 1); return child; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { el['attr_' + k] = v; if (k === 'value') el.value = v; },
    getAttribute(k) { return el['attr_' + k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    click() { fire(el, 'click'); },
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

function findByTag(node, tag, out = []) {
  for (const c of node.children || []) {
    if (c && c.nodeType === 1) {
      if (String(c.tagName).toLowerCase() === tag) out.push(c);
      findByTag(c, tag, out);
    }
  }
  return out;
}

function findByClass(node, cls, out = []) {
  for (const c of node.children || []) {
    if (c && c.nodeType === 1) {
      if (String(c.className || '').split(/\s+/).includes(cls)) out.push(c);
      findByClass(c, cls, out);
    }
  }
  return out;
}

function makeDoc() {
  const byId = new Map();
  return {
    createElement: (t) => makeEl(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, makeEl());
      return byId.get(id);
    },
    querySelector: () => null,
    body: makeEl('body'),
    documentElement: makeEl('html'),
  };
}

// localStorage 桩（存档 + route 记忆）
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const files = ['balance', 'colleges', 'tags', 'actions', 'events', 'endings', 'locations', 'characters', 'storylines', 'events-characters'];
const config = await (await import('../src/config/loader.js')).loadConfig({
  read: async (n) => {
    if (!files.includes(n)) throw new Error('no such config: ' + n);
    return readFile(join(root, 'config', `${n}.json`), 'utf8');
  },
});

console.log('== SCUSim 创建页输入 / 换地点自检 ==');

// ---------------------------------------------------------------------------
// A/B) 名字输入
// ---------------------------------------------------------------------------
{
  const rootEl = makeEl('div');
  const app = createApp({ config, callbacks: {}, doc: makeDoc(), appearance: 'm_short1' });
  app.mount(rootEl, { hasSave: false });
  app.startCreation();
  const input = findByTag(rootEl, 'input')[0];
  check('A: 创建页有名字输入框', !!input);
  if (input) {
    // 输入法组合开始 → 输入拼音 → 组合中的 input 事件不能改写 value
    fire(input, 'compositionstart');
    input.value = 'ni';
    fire(input, 'input', { isComposing: true });
    input.value = 'nihao';
    fire(input, 'input', { isComposing: true });
    check('A: 组合输入期间 value 不被改写（汉字输入不再中断）', input.value === 'nihao', input.value);

    // 组合结束：落地为汉字
    input.value = '你好';
    fire(input, 'compositionend');
    check('B: 组合结束后落地为合法姓名', input.value === '你好', input.value);

    // 非组合输入：过滤数字/符号
    input.value = '你好1!';
    fire(input, 'input');
    check('B: 静默过滤数字与符号', input.value === '你好', input.value);

    // 英文字母照常输入、逐字累积
    input.value = 'abc';
    fire(input, 'input');
    check('B: 英文字母可以正常累积输入', input.value === 'abc', input.value);

    // 超过 12 字符截断
    input.value = 'abcdefghijklmnop';
    fire(input, 'input');
    check('B: 超过 12 个字符被截断', input.value.length === 12, String(input.value.length));
  }
}

// ---------------------------------------------------------------------------
// C/D/E/F) 换地点：4 AP 的行动周期内自由切换（含跨校区）
// ---------------------------------------------------------------------------
async function boot() {
  const storage = createStorage();
  const rootEl = makeEl('div');
  const controller = createController({
    loader: { loadConfig: async () => config },
    storage,
    engine,
    createRng,
    createApp,
    doc: makeDoc(),
    rootEl,
    autoResume: false,
  });
  await controller.start();
  return { controller, storage, rootEl };
}

const { controller, storage } = await boot();
await controller.callbacks.onNewGame({
  name: '换地点生', gender: '男', collegeId: 'cs',
  attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
  tags: ['study_hard', 'gamer', 'chill'], seed: 2024,
});
const st = controller._getState();
st.pendingEvent = null;   // 开局社团招新先放一边，本节只测换地点
check('C: 开局停在地图（location 为空）', !st.player.location);

const firstEnabled = () => {
  const p = controller._getState().pendingEvent;
  if (!p) return null;
  const o = p.options.find((x) => x.enabled !== false) || p.options[0];
  return o ? o.id : null;
};

await controller.callbacks.onMoveLocation('dorm');
check('C: 换到宿舍，AP 不变（4）',
  st.player.location === 'dorm' && st.actionPoints === 4,
  st.player.location + '/' + st.actionPoints);

await controller.callbacks.onAction('rest');
check('C: 在宿舍休息后 AP = 3 / 健康上升',
  st.actionPoints === 3 && st.player.attributes.health >= 5,
  st.actionPoints + '/' + st.player.attributes.health);

await controller.callbacks.onMoveLocation('library');
check('C: 本周还没用完 AP → 可以换到图书馆，AP 仍为 3',
  st.player.location === 'library' && st.actionPoints === 3,
  st.player.location + '/' + st.actionPoints);

await controller.callbacks.onMoveLocation('wj_college');
check('D: 可以跨校区换到望江教学楼，AP 仍为 3',
  st.player.location === 'wj_college' && st.actionPoints === 3,
  st.player.location + '/' + st.actionPoints);

const k0 = st.player.attributes.knowledge;
const ap0 = st.actionPoints;
await controller.callbacks.onAction('study');
check('D: 跨校区后能直接做该地点的行动（上课学习）',
  st.actionPoints === ap0 - 1 && st.player.attributes.knowledge === k0 + 2,
  st.actionPoints + '/' + st.player.attributes.knowledge);

// F) 换地点会存盘
const loaded = await storage.loadGame();
check('F: 换地点后已存盘（刷新还能回到这个地点）',
  loaded.ok && loaded.state.player.location === 'wj_college',
  loaded.ok ? String(loaded.state.player.location) : loaded.reason);

// E) AP 用完后不能再换
st.actionPoints = 0;
const before = st.player.location;
await controller.callbacks.onMoveLocation('dorm');
check('E: 行动点用完后不能换地点', st.player.location === before, String(st.player.location));

// E2) 有未结算事件时不能换
st.actionPoints = 3;
st.pendingEvent = { eventId: 'ev_r01', options: [], resolved: false };
const before2 = st.player.location;
await controller.callbacks.onMoveLocation('dorm');
check('E: 有未结算事件时不能换地点', st.player.location === before2, String(st.player.location));

// ---------------------------------------------------------------------------
// G) 地图页签：站在江安也能翻到望江的地图（本周 4 AP 内）
// ---------------------------------------------------------------------------
{
  const { controller: c2, rootEl } = await (async () => {
    const storage2 = createStorage();
    const root2 = makeEl('div');
    const ctl = createController({
      loader: { loadConfig: async () => config },
      storage: storage2, engine, createRng, createApp,
      doc: makeDoc(), rootEl: root2, autoResume: false,
    });
    await ctl.start();
    await ctl.callbacks.onNewGame({
      name: '换图生', gender: '男', collegeId: 'cs',
      attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
      tags: ['study_hard', 'gamer', 'chill'], seed: 7,
    });
    const s2 = ctl._getState();
    s2.pendingEvent = null;
    await ctl.callbacks.onMoveLocation('dorm');   // 先站在江安宿舍
    return { controller: ctl, rootEl: root2 };
  })();
  const state2 = c2._getState();
  check('G: 准备：站在江安宿舍', state2.player.location === 'dorm', String(state2.player.location));

  c2.callbacks.onOpenMap();   // 周内打开地图
  const art0 = findByClass(rootEl, 'vn-map__art')[0];
  check('G: 弹窗默认显示当前校区（江安）地图',
    !!art0 && String(art0.attr_style || '').includes('jiang-an-map.jpg'),
    art0 ? String(art0.attr_style) : 'no art');

  const tabs = findByClass(rootEl, 'vn-map__tab');
  check('G: 地图上有江安/望江两个页签', tabs.length === 2,
    tabs.map((t) => String(t.textContent)).join('/'));
  const wjTab = tabs.find((t) => String(t.textContent).trim() === '望江');
  check('G: 找到「望江」页签', !!wjTab);
  if (wjTab) fire(wjTab, 'click');
  const art1 = findByClass(rootEl, 'vn-map__art')[0];
  check('G: 点「望江」后切到望江校区地图',
    !!art1 && String(art1.attr_style || '').includes('wangjiang-map.jpg'),
    art1 ? String(art1.attr_style) : 'no art');
  check('G: 切页签不会叠出第二层弹窗',
    findByClass(rootEl, 'vn-modal-scrim').length === 1,
    String(findByClass(rootEl, 'vn-modal-scrim').length));

  // 望江地图上的图钉：直接点一个，本周内（还有 AP）就能过去
  const pins = findByClass(rootEl, 'vn-map__pin');
  check('G: 望江地图上有地点图钉', pins.length >= 2, String(pins.length));
  const target = pins.find((p) => String(p.textContent).includes('教学楼'));
  check('G: 望江地图上有「教学楼」图钉', !!target,
    pins.map((p) => String(p.textContent)).join('/'));
  if (target) fire(target, 'click');
  check('G: 坐在江安也能在周内换到望江教学楼（AP 不变）',
    state2.player.location === 'wj_college' && state2.actionPoints === 4,
    state2.player.location + '/' + state2.actionPoints);
}

console.log(`\n总计 ${pass + failures.length} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
