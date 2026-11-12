/**
 * A · 弹窗队列单测（负责人 A）
 * 运行：node tests/unit/a-main.mjs
 *
 * 覆盖 main.js 的弹窗调度协议（CONTRACT §4.5 / D-13）：
 *  1) 学期结算与事件同回合时，先弹结算、后弹事件
 *  2) 事件在结算关闭前不得出现（保证不叠窗）
 *  3) UI 不回调 done 时的隐式关闭兜底：下一次行动会放行队列
 *  4) callbacks.onModalClosed 能推进队列
 *
 * 用注入的 fake engine 控制 advance 的返回，避免依赖随机数。
 */

import { createController } from '../../src/main.js';
import { createStorage } from '../../src/storage/storage.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.error(`  FAIL  ${name}  ${detail}`); }
}

const CONFIG = {
  balance: { turns: 40, actionPointsPerTurn: 4, monthsPerSemester: 5 },
  actions: { list: [{ id: 'study', name: '学习', cost: 1 }] },
  colleges: { list: [{ id: 'cs', name: '计算机学院' }] },
  tags: { list: [] },
  events: { fixed: [], random: [] },
  endings: { list: [] },
};

function makeState() {
  return {
    version: '1.0.0', seed: 1, rngState: 1, turn: 1, actionPoints: 4,
    player: {
      name: '队列生', gender: '男', collegeId: 'cs', appearance: '',
      attributes: { knowledge: 5, social: 5, health: 5, money: 5 }, tags: [],
      club: null, romance: 'none', flags: {},
    },
    academics: {
      semesterScores: [], semesterRecords: [], failedCourses: 0, warning: false,
      warningTurn: null, studyActions: 0, studyActionsBySemester: 0, totalGpa: 0, thesis: null,
    },
    pendingEvent: null, eventHistory: [], history: [], log: [], endingId: null,
  };
}

const SETTLEMENT = {
  semester: 1, turn: 2,
  subjects: [{ name: '高等数学', score: 80, passed: true, gpa: 3.0 }],
  semesterGpa: 3.0, totalGpa: 3.0,
  failedCourses: 0, failedThisSemester: 0, warning: false,
};

/** 造一个 控制器 + 记录型 app + 可控 fake engine */
function makeHarness() {
  const calls = [];
  const app = {
    mount() { calls.push(['mount']); },
    render() { calls.push(['render']); },
    showEvent(ev, done) { calls.push(['event', ev.eventId]); app._closeEvent = done; },
    showExam(settlement, done) { calls.push(['exam', settlement.semester]); app._closeExam = done; },
    showEnding(e) { calls.push(['ending', e.id]); },
    showError(msg) { calls.push(['error', msg]); },
    showToast(msg) { calls.push(['toast', msg]); },
    showGallery() {}, showSettings() {}, setAppearance() {},
  };
  const engine = {
    actionAvailability: () => ({ ok: true }),
    newGame: () => ({ ok: true, state: makeState() }),
    doAction: (s) => ({ ok: true, state: s }),
    advance: (s) => {
      s.turn += 1;
      const ev = { eventId: 'ev_r01', options: [{ id: 'try', label: '尝鲜' }], resolved: false };
      s.pendingEvent = ev;
      return {
        ok: true, state: s,
        settlement: { ...SETTLEMENT, turn: s.turn },
        pendingEvent: ev, endingId: null,
      };
    },
    resolvePendingEvent: (s) => { s.pendingEvent = null; return { ok: true, state: s, message: '结算完成' }; },
  };
  const controller = createController({
    loader: { loadConfig: async () => CONFIG },
    storage: createStorage(),
    engine,
    createRng: () => ({ getState: () => 1, setState() {} }),
    createApp: () => app,
    doc: { documentElement: { classList: { toggle() {} } } },
    rootEl: {},
  });
  return { controller, app, calls };
}

function indexOf(calls, kind, arg) {
  return calls.findIndex((c) => c[0] === kind && (arg === undefined || c[1] === arg));
}

console.log('== A · 弹窗队列单测（a-main）==');

// ---------------- 场景 1：结算先、事件后 ----------------
{
  const { controller, app, calls } = makeHarness();
  await controller.start();
  check('start: 挂载主菜单', indexOf(calls, 'mount') >= 0);

  await controller.callbacks.onNewGame({
    name: '队列生', gender: '男', collegeId: 'cs',
    attributes: { knowledge: 5, social: 5, health: 5, money: 5 }, tags: ['a', 'b', 'c'], seed: 1,
  });
  check('onNewGame: 无 pendingEvent 时直接渲染', indexOf(calls, 'render') >= 0 && indexOf(calls, 'event') < 0);

  await controller.callbacks.onAdvance();
  check('onAdvance: 同回合有结算+事件时先弹结算', indexOf(calls, 'exam', 1) >= 0, JSON.stringify(calls));
  check('onAdvance: 结算未关闭前事件不出现（不叠窗）', indexOf(calls, 'event') < 0, JSON.stringify(calls));

  // 模拟 UI 关闭结算
  if (typeof app._closeExam === 'function') app._closeExam();
  check('关闭结算后事件被弹出', indexOf(calls, 'event', 'ev_r01') >= 0, JSON.stringify(calls));
  check('事件关闭回调可用', typeof app._closeEvent === 'function');

  await controller.callbacks.onResolveEvent('try');
  check('onResolveEvent: 结算后渲染且清空 pending', controller._getState().pendingEvent === null);
}

// ---------------- 场景 2：UI 不回调 done 的隐式关闭兜底 ----------------
{
  const { controller, calls } = makeHarness();
  await controller.start();
  await controller.callbacks.onNewGame({
    name: '兜底生', gender: '女', collegeId: 'cs',
    attributes: { knowledge: 5, social: 5, health: 5, money: 5 }, tags: ['a', 'b', 'c'], seed: 2,
  });
  await controller.callbacks.onAdvance();
  check('兜底: 结算已弹出', indexOf(calls, 'exam', 1) >= 0);
  // 不调用 _closeExam，直接点行动（模拟玩家在结算遮罩下点到底层按钮）
  await controller.callbacks.onAction('study');
  check('兜底: 玩家下一次交互会放行队列，把事件弹出来', indexOf(calls, 'event', 'ev_r01') >= 0, JSON.stringify(calls));
  check('兜底: 待处理事件期间行动仍被拒绝（不扣 AP）',
    controller._getState().actionPoints === 4, String(controller._getState().actionPoints));
}

// ---------------- 场景 3：onModalClosed 回调存在且可调用 ----------------
{
  const { controller } = makeHarness();
  await controller.start();
  check('callbacks.onModalClosed 已暴露（C 的弹窗关闭时调用）',
    typeof controller.callbacks.onModalClosed === 'function');
  controller.callbacks.onModalClosed(); // 无弹窗时调用不应抛错
  check('无弹窗时调用 onModalClosed 不抛错', true);
}

// ---------------- 场景 4：读最后一回合的存档（已判结局）→ 直接放结局 ----------------
{
  const { controller, app, calls } = makeHarness();
  await controller.start();
  await controller.callbacks.onNewGame({
    name: '结局读档', gender: '男', collegeId: 'cs',
    attributes: { knowledge: 5, social: 5, health: 5, money: 5 }, tags: ['a', 'b', 'c'], seed: 4,
  });
  const s = controller._getState();
  s.turn = 40;
  s.endingId = 'ending_ordinary';
  await controller.callbacks.onSave();

  calls.length = 0;
  await controller.callbacks.onLoadGame();
  const ended = calls.filter((c) => c[0] === 'ending');
  check('读档：最后一回合存档（已有 endingId）直接弹结局',
    ended.length === 1 && ended[0][1] === 'ending_ordinary', JSON.stringify(calls));
  check('读档：不再弹「无法推进」错误', calls.filter((c) => c[0] === 'error').length === 0);
}

// ---------------- 场景 5：在终局按「进入下一周」→ 放结局，不再报 ended ----------------
{
  const { controller, calls } = makeHarness();
  await controller.start();
  await controller.callbacks.onNewGame({
    name: '终局推进', gender: '男', collegeId: 'cs',
    attributes: { knowledge: 5, social: 5, health: 5, money: 5 }, tags: ['a', 'b', 'c'], seed: 5,
  });
  const s = controller._getState();
  s.turn = 40;
  s.endingId = 'ending_academic_star';
  calls.length = 0;
  await controller.callbacks.onAdvance();
  check('终局 onAdvance：弹结局而不是 reason:ended',
    calls.some((c) => c[0] === 'ending' && c[1] === 'ending_academic_star')
    && !calls.some((c) => c[0] === 'error'),
    JSON.stringify(calls));
}

const total = pass + failures.length;
console.log(`\n== a-main 结果 ==`);
console.log(`总计 ${total} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
