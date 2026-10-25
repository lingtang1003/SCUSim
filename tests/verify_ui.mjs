// SCUSim M3/M4 集成验证（UI + 协调层）
// 运行：node tests/verify_ui.mjs
// 与 smoke.mjs / verify_m1.mjs 完全独立（不修改它们）。
//
// 覆盖范围：
//  A) 静态红线：ui.js 零 import、不碰 core/events/storage/config、无 Math.random/DOM 存储；
//     main.js 顶层不访问 DOM（Node import 不抛错）。
//  B) 依赖注入：import main.js / ui.js 在 Node 下不抛错。
//  C) 最小 DOM 桩 + createController 启动不抛错，mount 渲染主菜单。
//  D) 完整回合驱动（经 controller.callbacks）：
//       onNewGame(合法 options, 属性四项和=20, 3 标签) → engine.newGame 被调用, state.turn=1
//       onAction 若干次直到 AP=0 → state.actionPoints 递减、attributes 变化
//       onAdvance 若干次直到 turn=40 或 endingId → 不抛错、endingId 非空
//       中途 pendingEvent → onResolveEvent → state 变化
//       全程断言 render/showEvent/showEnding 被按预期调用，且 UI 收到的是 controller 持有的同一 state
//       （证明 UI 不自行改写 GameState，只透传）。
//  E) 存档往返：storage 写入后 loadGame 还原；onImport 序列化文本恢复。
//  F) 其他回调：onOpenGallery / onOpenSettings / onExport / onClearSave 不抛错。

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRng } from '../src/core/rng.js';
import * as engine from '../src/core/engine.js';
import { createStorage, serializeSave } from '../src/storage/storage.js';
import { createController } from '../src/main.js';
import { createApp as realCreateApp } from '../src/ui/ui.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.error(`  FAIL  ${name}  ${detail}`);
  }
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------------- 最小 DOM 桩 ----------------
function makeStubElement(tag = 'div') {
  const children = [];
  const listeners = {};
  const classSet = new Set();
  const el = {
    tagName: tag,
    nodeType: 1,
    className: '',
    _text: '',
    innerHTML: '',
    value: '',
    selected: false,
    disabled: false,
    style: {},
    dataset: {},
    children,
    parentNode: null,
    classList: {
      add: (...c) => c.forEach((x) => classSet.add(x)),
      remove: (...c) => c.forEach((x) => classSet.delete(x)),
      toggle: (c, force) => {
        const has = classSet.has(c);
        const on = force === undefined ? !has : !!force;
        if (on) classSet.add(c);
        else classSet.delete(c);
        return on;
      },
      contains: (c) => classSet.has(c),
    },
    appendChild(child) {
      child.parentNode = el;
      children.push(child);
      return child;
    },
    removeChild(child) {
      const i = children.indexOf(child);
      if (i >= 0) children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    remove() {
      if (el.parentNode) el.parentNode.removeChild(el);
    },
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener() {},
    setAttribute(k, v) {
      if (k === 'disabled') el.disabled = true;
      if (k === 'selected') el.selected = true;
      el['attr_' + k] = v;
    },
    getAttribute(k) {
      return el['attr_' + k];
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    click() {},
    get textContent() {
      return el._text;
    },
    set textContent(v) {
      el._text = String(v);
    },
  };
  // innerHTML='' 清空子节点（模拟真实 DOM）
  Object.defineProperty(el, 'innerHTML', {
    get() {
      return el._html || '';
    },
    set(v) {
      el._html = v;
      if (v === '') children.length = 0;
    },
  });
  return el;
}

function makeStubDoc() {
  return {
    createElement: (tag) => makeStubElement(tag),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    getElementById: () => makeStubElement('div'),
    querySelector: () => null,
    body: makeStubElement('body'),
    documentElement: makeStubElement('html'),
  };
}

// ---------------- 配置加载（复用本地 config 文件） ----------------
async function loadConfigsFromDisk() {
  const files = ['balance', 'colleges', 'tags', 'actions', 'events', 'endings'];
  const cfg = {};
  for (const f of files) {
    cfg[f] = JSON.parse(
      await readFile(join(root, 'config', `${f}.json`), 'utf8')
    );
  }
  return cfg;
}

// 用真实 createApp 包一层，记录 UI 各方法被调用情况
function makeSpyApp(ctx) {
  const app = realCreateApp(ctx);
  const calls = [];
  const api = {};
  for (const m of [
    'mount',
    'render',
    'showEvent',
    'showEnding',
    'showError',
    'showGallery',
    'showSettings',
  ]) {
    api[m] = (...args) => {
      calls.push({ method: m, args });
      return app[m](...args);
    };
  }
  api._calls = calls;
  api._real = app;
  return api;
}

// =====================================================================
//  A) 静态红线扫描
// =====================================================================
test('A: ui.js 零 import（不引入任何模块）', async () => {
  const txt = await readFile(join(root, 'src', 'ui', 'ui.js'), 'utf8');
  return !/^\s*import\s/m.test(txt);
});
test('A: ui.js 不引用 core/events/storage/config', async () => {
  const txt = await readFile(join(root, 'src', 'ui', 'ui.js'), 'utf8');
  // 仅检查「真正的相对路径 import 目标」('../core/' 等)，避免误匹配注释中的说明文字
  return !/\.\.\/(core|events|storage|config)\//.test(txt);
});
test('A: ui.js 无 Math.random / indexedDB / localStorage / window.', async () => {
  const txt = await readFile(join(root, 'src', 'ui', 'ui.js'), 'utf8');
  const bad = [];
  for (const tk of ['Math.random', 'indexedDB', 'localStorage', 'window.']) {
    if (txt.includes(tk)) bad.push(tk);
  }
  return bad.length === 0 || bad.join('; ');
});
test('A: main.js 首个 document 标记位于 typeof 守卫内（顶层不裸访问）', async () => {
  let txt = await readFile(join(root, 'src', 'main.js'), 'utf8');
  // 去除注释，避免注释中的说明文字（如「浏览器传 document」）干扰
  txt = txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const hasGuard = txt.includes("typeof document !== 'undefined'");
  // 匹配「全局 document 标识符」（排除 doc.documentElement 中的子串），
  // 其首次出现应位于 typeof document 守卫中。
  const re = /(^|[^.\w])document\b/g;
  const m = re.exec(txt);
  const firstDoc = m ? m.index + m[1].length : -1;
  const firstGuard = txt.indexOf('typeof document');
  const insideGuard = firstDoc >= 0 && firstDoc === firstGuard + 'typeof '.length;
  return hasGuard && insideGuard;
});

// =====================================================================
//  B) 依赖注入：Node import 不抛错（import 本身即验证）
// =====================================================================
test('B: import main.js / ui.js 在 Node 下未抛错', () => {
  return (
    typeof createController === 'function' &&
    typeof realCreateApp === 'function'
  );
});

// =====================================================================
//  C) 启动 + 主菜单
// =====================================================================
test('C: createController 启动不抛错且 mount 渲染主菜单', async () => {
  const configs = await loadConfigsFromDisk();
  const loader = { loadConfig: async () => configs };
  const storage = createStorage(); // Node 下使用内存后端，真实存储实现
  const doc = makeStubDoc();
  const rootEl = makeStubElement('div');
  const spyApp = makeSpyApp({ config: configs, callbacks: {}, doc });
  const controller = createController({
    loader,
    storage,
    engine,
    createRng,
    createApp: () => spyApp,
    doc,
    rootEl,
  });
  await controller.start();
  const mounted = spyApp._calls.some((c) => c.method === 'mount');
  return controller._getConfig() === configs && mounted && !!rootEl.children.length;
});

// =====================================================================
//  D) 完整回合驱动
// =====================================================================
test('D: 经 controller 驱动完整一局不抛错且到达结局', async () => {
  const configs = await loadConfigsFromDisk();
  const loader = { loadConfig: async () => configs };
  const storage = createStorage();
  const doc = makeStubDoc();
  const rootEl = makeStubElement('div');
  const spyApp = makeSpyApp({ config: configs, callbacks: {}, doc });

  const controller = createController({
    loader,
    storage,
    engine,
    createRng,
    createApp: () => spyApp,
    doc,
    rootEl,
  });
  await controller.start();
  const calls = spyApp._calls;

  // --- 新游戏（合法：属性和=20，3 标签，seed 固定） ---
  const validOptions = {
    name: '验证生',
    gender: '男',
    collegeId: 'cs',
    attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
    tags: ['study_hard', 'gamer', 'chill'],
    seed: 2024,
  };
  await controller.callbacks.onNewGame(validOptions);
  const s = controller._getState();
  if (!(s && s.turn === 1)) return '新游戏后 turn 不为 1: ' + (s && s.turn);
  if (s.player.attributes.knowledge + s.player.attributes.social + s.player.attributes.health + s.player.attributes.money !== 20) {
    return '属性总和不为 20';
  }

  // --- 解开局固定事件（社团招新） ---
  if (s.pendingEvent) {
    const firstOpt = s.pendingEvent.options[0]
      ? s.pendingEvent.options[0].id
      : null;
    await controller.callbacks.onResolveEvent(firstOpt);
  }
  if (s.pendingEvent) return '开局事件未结算';

  // --- 行动直到 AP=0 ---
  const apBefore = s.actionPoints;
  let guard = 0;
  while (s.actionPoints > 0 && guard < 100) {
    guard++;
    const avail = configs.actions.list.find((a) =>
      engine.actionAvailability(s, a.id, configs).ok
    );
    if (!avail) break;
    await controller.callbacks.onAction(avail.id);
  }
  if (s.actionPoints !== 0) return '行动后 AP 未耗尽: ' + s.actionPoints;
  if (s.academics.studyActions < 1) return '学习计数未增长';
  if (apBefore !== 4) return '初始 AP 异常: ' + apBefore;

  // --- 推进回合直到终局 ---
  let advGuard = 0;
  const seenEvents = [];
  while (s.turn < 40 && !s.endingId && advGuard < 500) {
    advGuard++;
    if (s.pendingEvent) {
      seenEvents.push(s.pendingEvent.eventId);
      const opt = s.pendingEvent.options[0]
        ? s.pendingEvent.options[0].id
        : null;
      await controller.callbacks.onResolveEvent(opt);
    }
    if (s.endingId || s.turn >= 40) break;
    await controller.callbacks.onAdvance();
    if (s.pendingEvent) {
      seenEvents.push(s.pendingEvent.eventId);
      const opt = s.pendingEvent.options[0]
        ? s.pendingEvent.options[0].id
        : null;
      await controller.callbacks.onResolveEvent(opt);
    }
  }
  if (s.turn !== 40) return '未到达终局回合: ' + s.turn;
  if (!s.endingId || typeof s.endingId !== 'string') {
    return '结局 id 为空: ' + s.endingId;
  }

  // --- UI 调用断言 ---
  const rendered = calls.filter((c) => c.method === 'render');
  const eventShown = calls.some((c) => c.method === 'showEvent');
  const endingShown = calls.some((c) => c.method === 'showEnding');
  const sameState =
    rendered.length > 0 && rendered[0].args[0] === controller._getState();
  if (rendered.length === 0) return 'render 从未被调用';
  if (endingShown !== true) return 'showEnding 未被调用';
  if (!sameState) return 'render 收到的 state 非 controller 持有的同一引用（疑似 UI 自行改状态）';
  if (seenEvents.length > 0 && eventShown !== true) {
    return '存在事件但未调用 showEvent';
  }
  return true;
});

// =====================================================================
//  E) 存档往返 + 导入
// =====================================================================
test('E: storage 写入后可 loadGame 还原', async () => {
  const configs = await loadConfigsFromDisk();
  const loader = { loadConfig: async () => configs };
  const storage = createStorage();
  const doc = makeStubDoc();
  const rootEl = makeStubElement('div');
  const spyApp = makeSpyApp({ config: configs, callbacks: {}, doc });
  const controller = createController({
    loader,
    storage,
    engine,
    createRng,
    createApp: () => spyApp,
    doc,
    rootEl,
  });
  await controller.start();
  await controller.callbacks.onNewGame({
    name: '存档生',
    gender: '女',
    collegeId: 'med',
    attributes: { knowledge: 4, social: 6, health: 6, money: 4 },
    tags: ['athlete', 'foodie', 'chill'],
    seed: 99,
  });
  const s = controller._getState();
  const r = await storage.loadGame();
  if (!r.ok) return 'loadGame 失败';
  if (r.state.turn !== s.turn || r.state.player.name !== s.player.name) {
    return 'loadGame 与当前 state 不一致';
  }
  return true;
});

test('E: onImport 通过序列化文本恢复存档', async () => {
  const configs = await loadConfigsFromDisk();
  const loader = { loadConfig: async () => configs };
  const storage = createStorage();
  const doc = makeStubDoc();
  const rootEl = makeStubElement('div');
  const spyApp = makeSpyApp({ config: configs, callbacks: {}, doc });
  const controller = createController({
    loader,
    storage,
    engine,
    createRng,
    createApp: () => spyApp,
    doc,
    rootEl,
  });
  await controller.start();
  await controller.callbacks.onNewGame({
    name: '导入生',
    gender: '男',
    collegeId: 'law',
    attributes: { knowledge: 6, social: 4, health: 5, money: 5 },
    tags: ['researcher', 'grind', 'chill'],
    seed: 7,
  });
  const s = controller._getState();
  const text = serializeSave(s);
  // 模拟切换存档后再导入
  await controller.callbacks.onClearSave();
  if (controller._getState() !== null) return 'clearSave 未清空 state';
  await controller.callbacks.onImport(text);
  const s2 = controller._getState();
  if (!s2 || s2.player.name !== '导入生' || s2.turn !== s.turn) {
    return '导入后 state 不一致';
  }
  return true;
});

// =====================================================================
//  F) 其他回调不抛错
// =====================================================================
test('F: onOpenGallery / onOpenSettings / onExport / onClearSave 不抛错', async () => {
  const configs = await loadConfigsFromDisk();
  const loader = { loadConfig: async () => configs };
  const storage = createStorage();
  const doc = makeStubDoc();
  const rootEl = makeStubElement('div');
  const spyApp = makeSpyApp({ config: configs, callbacks: {}, doc });
  const controller = createController({
    loader,
    storage,
    engine,
    createRng,
    createApp: () => spyApp,
    doc,
    rootEl,
  });
  await controller.start();
  await controller.callbacks.onNewGame({
    name: '功能生',
    gender: '男',
    collegeId: 'cs',
    attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
    tags: ['study_hard', 'gamer', 'chill'],
    seed: 11,
  });
  try {
    await controller.callbacks.onOpenGallery();
    await controller.callbacks.onOpenSettings();
    await controller.callbacks.onExport();
    await controller.callbacks.onClearSave();
  } catch (e) {
    return '回调抛错: ' + (e && e.message ? e.message : String(e));
  }
  return spyApp._calls.some((c) => c.method === 'showGallery')
    && spyApp._calls.some((c) => c.method === 'showSettings');
});

// =====================================================================
//  G) 边界用例（QA 补充：源码 Bug 防护）
// =====================================================================
test('G: onNewGame 属性四项和≠20 → engine 拒绝，UI 走 showError 且 state 不变', async () => {
  const configs = await loadConfigsFromDisk();
  const loader = { loadConfig: async () => configs };
  const storage = createStorage();
  const doc = makeStubDoc();
  const rootEl = makeStubElement('div');
  const spyApp = makeSpyApp({ config: configs, callbacks: {}, doc });
  const controller = createController({
    loader, storage, engine, createRng, createApp: () => spyApp, doc, rootEl,
  });
  await controller.start();
  await controller.callbacks.onNewGame({
    name: '越界生', gender: '男', collegeId: 'cs',
    attributes: { knowledge: 5, social: 5, health: 5, money: 6 }, // 和=21
    tags: ['study_hard', 'gamer', 'chill'], seed: 1,
  });
  const s = controller._getState();
  const errored = spyApp._calls.some((c) => c.method === 'showError');
  if (s !== null) return '非法属性仍创建了 state';
  if (!errored) return '未走 showError 路径';
  return true;
});

test('G: AP=0 时 onAction 返回 reason:"AP"，state 不变', async () => {
  const configs = await loadConfigsFromDisk();
  const loader = { loadConfig: async () => configs };
  const storage = createStorage();
  const doc = makeStubDoc();
  const rootEl = makeStubElement('div');
  const spyApp = makeSpyApp({ config: configs, callbacks: {}, doc });
  const controller = createController({
    loader, storage, engine, createRng, createApp: () => spyApp, doc, rootEl,
  });
  await controller.start();
  await controller.callbacks.onNewGame({
    name: 'AP生', gender: '男', collegeId: 'cs',
    attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
    tags: ['study_hard', 'gamer', 'chill'], seed: 3,
  });
  const s = controller._getState();
  if (s.pendingEvent) {
    await controller.callbacks.onResolveEvent(s.pendingEvent.options[0].id);
  }
  let g = 0;
  while (s.actionPoints > 0 && g < 100) {
    g++;
    const av = configs.actions.list.find((a) =>
      engine.actionAvailability(s, a.id, configs).ok);
    if (!av) break;
    await controller.callbacks.onAction(av.id);
  }
  if (s.actionPoints !== 0) return 'AP 未耗尽: ' + s.actionPoints;
  const snap = JSON.stringify({
    turn: s.turn, ap: s.actionPoints,
    attrs: s.player.attributes, study: s.academics.studyActions,
  });
  await controller.callbacks.onAction('study');
  const snap2 = JSON.stringify({
    turn: s.turn, ap: s.actionPoints,
    attrs: s.player.attributes, study: s.academics.studyActions,
  });
  if (snap !== snap2) return 'AP=0 时再做行动改动了 state';
  return true;
});

test('G: onImport 损坏文件 → {ok:false,reason}，当前存档不被覆盖', async () => {
  const configs = await loadConfigsFromDisk();
  const loader = { loadConfig: async () => configs };
  const storage = createStorage();
  const doc = makeStubDoc();
  const rootEl = makeStubElement('div');
  const spyApp = makeSpyApp({ config: configs, callbacks: {}, doc });
  const controller = createController({
    loader, storage, engine, createRng, createApp: () => spyApp, doc, rootEl,
  });
  await controller.start();
  await controller.callbacks.onNewGame({
    name: '存档A', gender: '男', collegeId: 'cs',
    attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
    tags: ['study_hard', 'gamer', 'chill'], seed: 5,
  });
  const s = controller._getState();
  const savedName = s.player.name;
  await controller.callbacks.onImport('{ this is not valid json');
  const s2 = controller._getState();
  if (!s2) return '损坏导入把 state 清空了';
  if (s2.player.name !== savedName) return '损坏导入覆盖了当前 state';
  const r = await storage.loadGame();
  if (!r.ok || r.state.player.name !== savedName) {
    return '磁盘存档被损坏导入覆盖';
  }
  return true;
});

test('G: createApp 传入空 actions 列表 → render 不崩且产出 DOM', async () => {
  const configs = await loadConfigsFromDisk();
  const emptyCfg = JSON.parse(JSON.stringify(configs));
  emptyCfg.actions = { list: [] };
  const doc = makeStubDoc();
  const rootEl = makeStubElement('div');
  const app = realCreateApp({ config: emptyCfg, callbacks: {}, doc });
  app.mount(rootEl, { hasSave: false });
  const stubState = {
    turn: 1, actionPoints: 4,
    player: {
      name: '空配置生', gender: '男', collegeId: 'cs',
      attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
      tags: ['chill'],
    },
    academics: { semesterScores: [], failedCourses: 0, warning: false, studyActions: 0 },
    log: ['测试'],
  };
  try {
    app.render(stubState);
  } catch (e) {
    return 'render 抛错: ' + (e && e.message ? e.message : String(e));
  }
  if (!rootEl.children.length) return 'render 未产出任何 DOM';
  return true;
});

// ---------------- 执行 ----------------
console.log('== SCUSim M3/M4 集成验证（verify_ui）==');
for (const { name, fn } of tests) {
  try {
    const cond = await fn();
    if (typeof cond === 'string') check(name, false, cond);
    else check(name, !!cond, '');
  } catch (e) {
    check(name, false, 'EXC: ' + (e && e.message ? e.message : String(e)));
  }
}

const total = pass + failures.length;
console.log(`\n== verify_ui 结果 ==`);
console.log(`总计 ${total} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
