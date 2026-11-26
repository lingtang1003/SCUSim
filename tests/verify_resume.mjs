/**
 * 刷新续玩自检（Node + 最小 DOM 桩）
 * 运行：node tests/verify_resume.mjs
 *
 * 覆盖：
 *  A) 有存档 + autoResume + 上次在游戏里 → start() 自动读档，停在游戏画面（不是标题页）
 *  B) 存档里的未结算事件会重新弹出（断点续玩）
 *  C) 上次主动回主页（route=title）→ 刷新后仍停在标题页
 *  D) autoResume 关闭（测试/内嵌场景）→ 仍然从标题页开始
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

// ---------------- 最小 DOM 桩 ----------------
function makeEl(tag = 'div') {
  const children = [];
  const el = {
    tagName: tag, nodeType: 1, className: '', _text: '', style: {}, dataset: {},
    children, parentNode: null, disabled: false,
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
    addEventListener() {},
    removeEventListener() {},
    setAttribute(k, v) { el['attr_' + k] = v; },
    getAttribute(k) { return el['attr_' + k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    click() {},
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
  return el;
}

function makeDoc() {
  return {
    createElement: (t) => makeEl(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    getElementById: () => makeEl(),
    querySelector: () => null,
    body: makeEl('body'),
    documentElement: makeEl('html'),
  };
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

// localStorage 桩（route 记忆用它）
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const config = await (async () => {
  const files = ['balance', 'colleges', 'tags', 'actions', 'events', 'endings', 'locations', 'characters', 'storylines', 'events-characters'];
  const reader = {
    read: async (n) => {
      if (!files.includes(n)) throw new Error('no such config: ' + n);
      return readFile(join(root, 'config', `${n}.json`), 'utf8');
    },
  };
  const cfg = await (await import('../src/config/loader.js')).loadConfig(reader);
  // 这里只测「刷新续玩 / 存档恢复」，不受每周固定规则影响：关掉退学与每周结算，
  // 免得造存档时角色因为学识荒废被退学，pendingEvent 也就没了（规则由 verify_rules 专测）
  if (cfg.balance) {
    cfg.balance.weeklyRules = null;
    cfg.balance.dropout = null;
  }
  return cfg;
})();

const loader = { loadConfig: async () => config };

async function boot(autoResume, storage) {
  const rootEl = makeEl('div');
  const controller = createController({
    loader,
    storage,
    engine,
    createRng,
    createApp,
    doc: makeDoc(),
    rootEl,
    autoResume,
  });
  await controller.start();
  return { controller, rootEl };
}

console.log('== SCUSim 刷新续玩自检 ==');

// 先造一份「玩到第 5 回合、还有未结算事件」的存档
const storage = createStorage();
const rng = createRng(2024);
const ng = engine.newGame({
  name: '续玩生', gender: '男', collegeId: 'cs',
  attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
  tags: ['study_hard', 'gamer', 'chill'], seed: 2024,
}, config, rng);
engine.advance(ng.state, config, rng);
engine.advance(ng.state, config, rng);
engine.advance(ng.state, config, rng);
engine.advance(ng.state, config, rng);
await storage.saveGame(ng.state);
const savedTurn = ng.state.turn;
const savedPending = ng.state.pendingEvent ? ng.state.pendingEvent.eventId : null;
check('准备：存档存在且在第 5 回合', savedTurn === 5, String(savedTurn));

// ---------------------------------------------------------------------------
// A) 自动续玩
// ---------------------------------------------------------------------------
store.delete('scusim:route');   // 只清路线记忆，存档要留着
const a = await boot(true, storage);
const aState = a.controller._getState();
check('A: start() 后已载入存档', !!aState && aState.turn === savedTurn,
  aState ? String(aState.turn) : 'null');
check('A: 没有停在标题页', findByClass(a.rootEl, 'vn-stage--title').length === 0);
check('A: 渲染出游戏画面', findByClass(a.rootEl, 'vn-stage').length === 1);
check('A: 回合数与存档一致（属性/进度未变）',
  !!aState && JSON.stringify(aState.player.attributes) === JSON.stringify(ng.state.player.attributes));

// ---------------------------------------------------------------------------
// B) 未结算事件恢复
// ---------------------------------------------------------------------------
if (savedPending) {
  check('B: 存档里的未结算事件重新弹出',
    findByClass(a.rootEl, 'vn-event').length >= 1,
    String(findByClass(a.rootEl, 'vn-event').length));
} else {
  check('B: 存档里没有未结算事件（跳过弹窗断言）', true);
}

// ---------------------------------------------------------------------------
// C) 主动回主页后刷新 → 停在标题页
// ---------------------------------------------------------------------------
a.controller.callbacks.onOpenMenu();
check('C: 回主页写回 route=title', store.get('scusim:route') === 'title', String(store.get('scusim:route')));
const c = await boot(true, storage);
check('C: 刷新后停在标题页', findByClass(c.rootEl, 'vn-stage--title').length === 1);
check('C: 没有偷偷读档', !c.controller._getState());

// ---------------------------------------------------------------------------
// D) autoResume 关闭 → 标题页
// ---------------------------------------------------------------------------
store.delete('scusim:route');
const d = await boot(false, storage);
check('D: autoResume=false 时不自动读档', !d.controller._getState());
check('D: 仍然是标题页', findByClass(d.rootEl, 'vn-stage--title').length === 1);

console.log(`\n总计 ${pass + failures.length} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
