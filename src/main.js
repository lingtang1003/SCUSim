/**
 * SCUSim · 协调层（负责人 A · 寇豆码）
 *
 * 职责：装配 engine + storage + ui，路由（新游戏/继续/图鉴/设置/导入导出），
 * 并持有【单一 rng 实例】透传给引擎以保证随机复现。
 *
 * 设计红线：
 *  - 仅本模块同时接触 engine + storage + ui。
 *  - 模块顶层【不访问 DOM】（保证 Node import 不抛错）；DOM 仅在函数内部使用。
 *  - rng 由本层持有并在 newGame/doAction/advance/resolvePendingEvent 全程复用同一实例；
 *    读档时用 rng.setState(state.rngState) 还原随机序列。
 *
 * 与 UI 的契约：
 *  - render(state, view)：view = { availability, actionId?, actionSeq? }
 *      actionId/actionSeq 用于让表现层切换到对应场景（每个本周行动一张背景）。
 *  - 立绘偏好存在 state.player.appearance，随存档走；设置面板改立绘走 onChangeAppearance。
 */

import { loadConfig } from './config/loader.js';
import { createStorage } from './storage/storage.js';
import * as engine from './core/engine.js';
import { createRng } from './core/rng.js';
import { createApp } from './ui/ui.js';

/**
 * 创建控制器（依赖注入）。
 * @param {object} deps { loader, storage, engine, createRng, createApp, doc, rootEl }
 * @returns {{ callbacks, start, _getState, _getConfig, _hasSave, _getApp, _getRng }}
 */
export function createController(deps) {
  const { loader, storage, engine: engineMod, createRng: makeRng, createApp: makeApp, doc, rootEl } = deps;

  // 允许直接传入 engine 模块，或回退到本地导入
  const eng = engineMod || engine;

  let rng = null;
  let state = null;
  let config = null;
  let hasSave = false;
  let app = null;
  let appearanceId = '';
  let actionSeq = 0;

  // ---------------- 弹窗队列（D-13：学期结算先、事件后） ----------------
  // 约定：UI 的 showExam / showEvent 收第二个参数 done，关闭时调用它；
  //      或调用 callbacks.onModalClosed()；或返回 Promise。三者任一即可。
  const modalQueue = [];
  let modalBusy = false;

  function notifyModalClosed() {
    if (!modalBusy) return;
    modalBusy = false;
    pumpModalQueue();
  }

  function pumpModalQueue() {
    if (modalBusy || modalQueue.length === 0) return;
    const show = modalQueue.shift();
    modalBusy = true;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      modalBusy = false;
      pumpModalQueue();
    };
    try {
      const ret = show(done);
      if (ret && typeof ret.then === 'function') ret.then(done, done);
    } catch (_) {
      done();
    }
  }

  function queueModal(show) {
    modalQueue.push(show);
    pumpModalQueue();
  }

  /** 新局/读档/回主菜单时清空队列，避免上一局的弹窗残留 */
  function resetModals() {
    modalQueue.length = 0;
    modalBusy = false;
  }

  // 对每项行动计算可用性，作为 render 的输入
  function computeAvailability(s) {
    const availability = {};
    const actions = (config && config.actions && config.actions.list) || [];
    for (const a of actions) {
      availability[a.id] = eng.actionAvailability(s, a.id, config);
    }
    return availability;
  }

  function renderState(view) {
    if (!state) return;
    const payload = { availability: computeAvailability(state) };
    if (view && view.actionId) {
      payload.actionId = view.actionId;
      payload.actionSeq = view.actionSeq;
    }
    if (view && view.eventResult) {
      payload.eventResult = view.eventResult;
    }
    app.render(state, payload);
    mountDevPanel();
  }

  // ---------------- 开发调试面板（仅 URL 带 ?dev=1 时出现，正式访问不可见） ----------------
  function devModeEnabled() {
    try {
      return typeof location !== 'undefined'
        && typeof location.search === 'string'
        && /(^|[?&])dev=1(&|$)/.test(location.search);
    } catch (_) {
      return false;
    }
  }

  function mountDevPanel() {
    if (!devModeEnabled()) return;
    if (!doc || typeof doc.createElement !== 'function' || !rootEl) return;
    if (typeof doc.getElementById === 'function' && doc.getElementById('scusim-devpanel')) return;
    const bar = doc.createElement('div');
    bar.id = 'scusim-devpanel';
    bar.setAttribute(
      'style',
      'position:fixed;left:8px;bottom:8px;z-index:99999;display:flex;gap:4px;flex-wrap:wrap;max-width:340px;'
      + 'padding:6px;border-radius:8px;background:rgba(10,10,10,.82);color:#fff;font:12px/1.4 monospace'
    );
    const mk = (label, fn) => {
      const b = doc.createElement('button');
      b.textContent = label;
      b.setAttribute('style', 'cursor:pointer;border:0;border-radius:4px;padding:3px 6px;background:#b3121a;color:#fff;font:inherit');
      b.addEventListener('click', fn);
      return b;
    };
    const bump = (key, delta) => {
      if (!state) return;
      const attrs = state.player.attributes;
      attrs[key] = (Number(attrs[key]) || 0) + delta;
      if (key !== 'money' && attrs[key] < 0) attrs[key] = 0;
      storage.saveGame(state);
      renderState();
    };
    bar.appendChild(mk('学识+10', () => bump('knowledge', 10)));
    bar.appendChild(mk('社交+10', () => bump('social', 10)));
    bar.appendChild(mk('健康+10', () => bump('health', 10)));
    bar.appendChild(mk('钱+1000', () => bump('money', 1000)));
    bar.appendChild(mk('钱−5000', () => bump('money', -5000)));
    bar.appendChild(mk('AP 清零', () => {
      if (!state) return;
      state.actionPoints = 0;
      storage.saveGame(state);
      renderState();
    }));
    bar.appendChild(mk('结算事件', () => {
      if (!state || !state.pendingEvent) return;
      const first = state.pendingEvent.options && state.pendingEvent.options[0];
      if (first) onResolveEvent(first.id);
    }));
    bar.appendChild(mk('结束回合', () => onAdvance()));
    bar.appendChild(mk('清档', () => onClearSave()));
    rootEl.appendChild(bar);
  }

  function endingOf(id) {
    const list = config && config.endings && config.endings.list;
    return (list || []).find((e) => e.id === id) || { id, name: id, desc: '' };
  }

  function toast(msg, kind) {
    if (app && typeof app.showToast === 'function') app.showToast(msg, kind);
    else if (app && typeof app.showError === 'function' && kind === 'danger') app.showError(msg);
  }

  // ---------------- 回调：新游戏 ----------------
  async function onNewGame(opts) {
    resetModals();
    if (!opts || typeof opts !== 'object') {
      app.showError('创建数据无效');
      return;
    }
    if (typeof opts.appearance === 'string' && opts.appearance) {
      appearanceId = opts.appearance;
    }
    const seedNum = Number.isFinite(opts.seed)
      ? opts.seed
      : typeof Math !== 'undefined' && Math.random
      ? Math.floor(Math.random() * 4294967296)
      : 20241022;
    rng = makeRng(seedNum >>> 0);
    const res = eng.newGame(opts, config, rng);
    if (!res.ok) {
      app.showError('创建失败：' + (res.reason || '未知错误'));
      return;
    }
    state = res.state;
    if (!state.player.appearance && appearanceId) {
      state.player.appearance = appearanceId;
    }
    await storage.saveGame(state);
    await storage.saveSettings({ appearance: state.player.appearance || appearanceId });
    hasSave = true;
    actionSeq = 0;
    renderState();
    // 回合 1 可能已生成固定事件（社团招新），在场景之上弹事件
    if (state.pendingEvent) app.showEvent(state.pendingEvent);
  }

  // ---------------- 回调：继续游戏 ----------------
  async function onLoadGame() {
    resetModals();
    const r = await storage.loadGame();
    if (!r.ok) {
      app.showError('没有可用的存档');
      return;
    }
    state = r.state;
    rng = makeRng((state.rngState != null ? state.rngState : 0) >>> 0);
    if (state.player && state.player.appearance) {
      appearanceId = state.player.appearance;
    }
    hasSave = true;
    actionSeq = 0;
    renderState();
  }

  // ---------------- 回调：手动存档 ----------------
  async function onSave() {
    if (!state) {
      toast('还没有可保存的进度', 'danger');
      return;
    }
    await storage.saveGame(state);
    toast('进度已保存到本机', 'success');
  }

  // ---------------- 回调：执行行动 ----------------
  async function onAction(actionId) {
    if (!state) return;
    // 弹窗未关时先让队列前进（UI 未必回调 done，这里给一个隐式关闭兜底）
    if (modalBusy) notifyModalClosed();
    // 设计 §11.1#9：存在待处理事件时先结算事件（引擎侧同样兜底拦截）
    if (state.pendingEvent) {
      toast('先处理当前事件，再安排这周的行动', 'warning');
      return;
    }
    const res = eng.doAction(state, actionId, config, rng);
    if (!res.ok) {
      const why = res.reason === 'AP'
        ? '行动点不够了，先结束这一周吧'
        : res.reason === 'health'
        ? '身体状况不支持这个行动（健康 < 3 时只能锻炼/休息）'
        : res.reason === 'pending_event'
        ? '先处理当前事件'
        : '这一步现在做不了';
      toast(why, 'danger');
      return;
    }
    actionSeq += 1;
    await storage.saveGame(state);
    renderState({ actionId, actionSeq });
  }

  // ---------------- 回调：推进回合 ----------------
  async function onAdvance() {
    if (!state) return;
    const res = eng.advance(state, config, rng);
    if (!res.ok) {
      app.showError('无法推进：' + (res.reason || ''));
      return;
    }
    await storage.saveGame(state);

    // 月初收支反馈（SRS 3.3.1）
    if (res.monthly && Number(res.monthly.net) !== 0) {
      toast(`月度收支：+${res.monthly.income} / −${res.monthly.expense}`, 'info');
    }

    if (res.endingId) {
      await storage.unlockEnding(res.endingId);
      renderState();
      app.showEnding(endingOf(res.endingId));
      return;
    }

    // 结算与事件同回合时：学期结算先、事件后（D-13），由弹窗队列串行弹出
    renderState();
    const settlement = res.settlement;
    const pendingEvent = state.pendingEvent;
    if (settlement) {
      queueModal((done) => {
        if (typeof app.showExam === 'function') {
          app.showExam(settlement, done);
        } else {
          toast(
            `学期 ${settlement.semester} 结算：总绩点 ${settlement.totalGpa}`
            + `，累计挂科 ${settlement.failedCourses} 门`
            + (settlement.warning ? '（已触发学业警告）' : ''),
            settlement.warning ? 'danger' : 'info'
          );
          done();
        }
      });
    }
    if (pendingEvent) {
      queueModal((done) => {
        if (typeof app.showEvent === 'function') app.showEvent(pendingEvent, done);
        else done();
      });
    }
  }

  // ---------------- 事件选项：前置不足时的说明文案 ----------------
  const ATTR_NAME = { knowledge: '学识', social: '社交', health: '健康', money: '金钱' };

  function findEventOption(eventId, choiceId) {
    const ev = config && config.events;
    const all = [].concat(
      Array.isArray(ev && ev.fixed) ? ev.fixed : [],
      Array.isArray(ev && ev.random) ? ev.random : []
    );
    const def = all.find((e) => e && e.id === eventId);
    const list = (def && Array.isArray(def.options)) ? def.options : [];
    return list.find((o) => o && o.id === choiceId) || null;
  }

  /** 拼出「选择无效的原因，可能带来的后果」 */
  function denyMessage(option, s) {
    const req = (option && option.requires) || null;
    const reasons = [];
    if (req) {
      const attrs = (s.player && s.player.attributes) || {};
      if (req.attribute && req.attribute.key) {
        const cur = Number(attrs[req.attribute.key]) || 0;
        const min = Number(req.attribute.min);
        if (Number.isFinite(min) && cur < min) {
          reasons.push(`${ATTR_NAME[req.attribute.key] || req.attribute.key}不足（需要 ${min}，现在 ${cur}）`);
        }
      }
      if (req.moneyAtLeast != null) {
        const cur = Number(attrs.money) || 0;
        const min = Number(req.moneyAtLeast);
        if (Number.isFinite(min) && cur < min) {
          reasons.push(`金钱不足（需要 ${min}，现在 ${cur}）`);
        }
      }
      if (req.gpaAtLeast != null) {
        const cur = Number(s.academics && s.academics.totalGpa) || 0;
        const min = Number(req.gpaAtLeast);
        if (Number.isFinite(min) && cur < min) {
          reasons.push(`总绩点不够（需要 ${min}，现在 ${cur.toFixed(2)}）`);
        }
      }
      if (req.flag) {
        const flags = (s.player && s.player.flags) || {};
        if (String(flags[req.flag.key]) !== String(req.flag.value)) {
          reasons.push('前置剧情还没走到');
        }
      }
    }
    const tail = (option && option.denyText) || '这个选择现在行不通。';
    return (reasons.length ? `${reasons.join('、')}，` : '') + tail;
  }

  // ---------------- 回调：结算事件 ----------------
  async function onResolveEvent(choiceId) {
    if (!state || !state.pendingEvent) return;
    const eventId = state.pendingEvent.eventId;
    const before = Object.assign({}, (state.player && state.player.attributes) || {});
    const res = eng.resolvePendingEvent(state, choiceId, config, rng);
    if (!res.ok) {
      // 不满足前置：把原因和可能的后果说清楚，而不是一句「选择无效」
      const option = findEventOption(eventId, choiceId);
      const msg = denyMessage(option, state);
      if (typeof app.showHint === 'function') app.showHint(msg);
      else if (typeof app.showError === 'function') app.showError(msg);
      return;
    }
    // 实际变化量（含 clamp 后的结果），交给表现层在对话框里展示
    const after = (state.player && state.player.attributes) || {};
    const delta = {};
    for (const k of Object.keys(after)) {
      const d = (Number(after[k]) || 0) - (Number(before[k]) || 0);
      if (d !== 0) delta[k] = d;
    }
    await storage.saveGame(state);
    renderState({
      eventResult: { eventId: eventId, text: res.message || '', delta: delta },
    });
    notifyModalClosed();
  }

  // ---------------- 回调：换立绘 ----------------
  async function onChangeAppearance(id) {
    if (!state || typeof id !== 'string' || !id) return;
    appearanceId = id;
    // 外观是纯展示字段：只写入存档，不参与任何结算
    state.player.appearance = id;
    await storage.saveGame(state);
    await storage.saveSettings({ appearance: id });
    if (app && typeof app.setAppearance === 'function') app.setAppearance(id);
  }

  // ---------------- 回调：导出存档 ----------------
  async function onExport() {
    if (!state) {
      app.showError('暂无可导出的存档');
      return;
    }
    try {
      const blob = await storage.exportSaveFile(state);
      if (!doc || typeof doc.createElement !== 'function') return;
      const a = doc.createElement('a');
      let url = null;
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        url = URL.createObjectURL(blob);
      }
      a.href = url || '#';
      a.download = 'scusim-save.scusim';
      if (typeof a.click === 'function') a.click();
      if (url && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
      }
      toast('存档已导出', 'success');
    } catch (_) {
      app.showError('导出失败');
    }
  }

  // ---------------- 回调：导入存档 ----------------
  async function onImport(file) {
    if (!file) return;
    resetModals();
    const r = await storage.importSaveFile(file);
    if (!r.ok) {
      app.showError('导入失败：' + (r.reason || ''));
      return;
    }
    state = r.state;
    rng = makeRng((state.rngState != null ? state.rngState : 0) >>> 0);
    if (state.player && state.player.appearance) {
      appearanceId = state.player.appearance;
    }
    hasSave = true;
    actionSeq = 0;
    await storage.saveGame(state);
    renderState();
  }

  // ---------------- 回调：清除存档（回主菜单） ----------------
  async function onClearSave() {
    resetModals();
    await storage.clearSave();
    state = null;
    hasSave = false;
    if (app.mount) app.mount(rootEl, { hasSave: false });
  }

  // ---------------- 回调：打开图鉴 ----------------
  async function onOpenGallery() {
    const r = await storage.getGallery();
    if (!r.ok) {
      app.showError('图鉴加载失败');
      return;
    }
    app.showGallery(r.gallery);
  }

  // ---------------- 回调：打开设置 ----------------
  async function onOpenSettings() {
    const r = await storage.getSettings();
    const settings =
      r && r.ok
        ? { ...r.settings, appearance: appearanceId || r.settings.appearance || '' }
        : { seedDisplay: false, reduceMotion: false, lastSaveAt: 0, appearance: appearanceId };
    if (doc && doc.documentElement && doc.documentElement.classList) {
      doc.documentElement.classList.toggle('reduce-motion', !!settings.reduceMotion);
    }
    app.showSettings(settings, async (newSettings) => {
      const merged = newSettings || {};
      await storage.saveSettings(merged);
      if (doc && doc.documentElement && doc.documentElement.classList) {
        doc.documentElement.classList.toggle('reduce-motion', !!merged.reduceMotion);
      }
      if (typeof merged.appearance === 'string' && merged.appearance) {
        appearanceId = merged.appearance;
      }
    });
  }

  // ---------------- 回调：返回主菜单 ----------------
  function onOpenMenu() {
    resetModals();
    if (app.mount) app.mount(rootEl, { hasSave });
  }

  const callbacks = {
    onNewGame,
    onLoadGame,
    onSave,
    onAction,
    onAdvance,
    onResolveEvent,
    onChangeAppearance,
    onExport,
    onImport,
    onClearSave,
    onOpenGallery,
    onOpenSettings,
    onOpenMenu,
    onModalClosed: notifyModalClosed,
  };

  // 启动时加载配置 → 读取偏好 → 创建 UI → 挂载主菜单
  async function start() {
    config = await loader.loadConfig();
    const pref = await storage.getSettings();
    appearanceId = (pref && pref.ok && pref.settings && pref.settings.appearance) || '';
    if (doc && doc.documentElement && doc.documentElement.classList && pref && pref.ok) {
      doc.documentElement.classList.toggle('reduce-motion', !!pref.settings.reduceMotion);
    }
    app = makeApp({ config, callbacks, doc, appearance: appearanceId });
    const r = await storage.loadGame();
    hasSave = r.ok;
    app.mount(rootEl, { hasSave });
    mountDevPanel();
    // 仅 ?dev=1：暴露只读调试句柄，供浏览器 E2E / 手工调试驱动（正式访问不存在）
    if (devModeEnabled() && typeof globalThis !== 'undefined') {
      globalThis.__scusim = {
        get state() { return state; },
        get config() { return config; },
        get app() { return app; },
        callbacks,
        controller,
        _setState(s) { state = s; },
      };
    }
    return controller;
  }

  const controller = {
    callbacks,
    start,
    _getState: () => state,
    _getConfig: () => config,
    _hasSave: () => hasSave,
    _getApp: () => app,
    _getRng: () => rng,
  };
  return controller;
}

// ---------------- 浏览器入口（仅在浏览器环境执行，Node import 不会触发） ----------------
if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
  const el = document.getElementById('app');
  if (el) {
    const controller = createController({
      loader: { loadConfig },
      storage: createStorage(),
      engine,
      createRng,
      createApp,
      doc: document,
      rootEl: el,
    });
    controller.start().catch((e) => {
      el.innerHTML =
        '<div style="padding:48px 24px;text-align:center;color:#3c5c8c;font-family:PingFang SC,Microsoft YaHei,sans-serif">' +
        '<h1 style="font-size:22px;letter-spacing:.1em">加载失败</h1>' +
        '<p style="opacity:.75">' +
        (e && e.message ? e.message : String(e)) +
        '</p></div>';
    });
  }
}
