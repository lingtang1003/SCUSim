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

  // 对每项行动计算可用性，作为 render 的输入
  function computeAvailability(s) {
    const availability = {};
    const actions = (config && config.actions && config.actions.list) || [];
    for (const a of actions) {
      availability[a.id] = eng.actionAvailability(s, a.id, config);
    }
    return availability;
  }

  function renderState() {
    if (!state) return;
    app.render(state, { availability: computeAvailability(state) });
  }

  function endingOf(id) {
    const list = config && config.endings && config.endings.list;
    return (list || []).find((e) => e.id === id) || { id, name: id, desc: '' };
  }

  // ---------------- 回调：新游戏 ----------------
  async function onNewGame(opts) {
    if (!opts || typeof opts !== 'object') {
      app.showError('创建数据无效');
      return;
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
    await storage.saveGame(state);
    hasSave = true;
    // 回合 1 可能已生成固定事件（社团招新），优先弹事件
    if (state.pendingEvent) app.showEvent(state.pendingEvent);
    else renderState();
  }

  // ---------------- 回调：继续游戏 ----------------
  async function onLoadGame() {
    const r = await storage.loadGame();
    if (!r.ok) {
      app.showError('没有可用的存档');
      return;
    }
    state = r.state;
    rng = makeRng((state.rngState != null ? state.rngState : 0) >>> 0);
    hasSave = true;
    renderState();
  }

  // ---------------- 回调：执行行动 ----------------
  async function onAction(actionId) {
    if (!state) return;
    const res = eng.doAction(state, actionId, config, rng);
    if (!res.ok) {
      app.showError(res.message || '行动失败');
      return;
    }
    await storage.saveGame(state);
    renderState();
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
    if (res.endingId) {
      await storage.unlockEnding(res.endingId);
      app.showEnding(endingOf(res.endingId));
      return;
    }
    if (res.pendingEvent || state.pendingEvent) {
      app.showEvent(state.pendingEvent);
      return;
    }
    renderState();
  }

  // ---------------- 回调：结算事件 ----------------
  async function onResolveEvent(choiceId) {
    if (!state || !state.pendingEvent) return;
    const res = eng.resolvePendingEvent(state, choiceId, config, rng);
    if (!res.ok) {
      app.showError('选择无效');
      return;
    }
    await storage.saveGame(state);
    renderState();
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
    } catch (_) {
      app.showError('导出失败');
    }
  }

  // ---------------- 回调：导入存档 ----------------
  async function onImport(file) {
    if (!file) return;
    const r = await storage.importSaveFile(file);
    if (!r.ok) {
      app.showError('导入失败：' + (r.reason || ''));
      return;
    }
    state = r.state;
    rng = makeRng((state.rngState != null ? state.rngState : 0) >>> 0);
    hasSave = true;
    await storage.saveGame(state);
    renderState();
  }

  // ---------------- 回调：清除存档（回主菜单） ----------------
  async function onClearSave() {
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
        ? r.settings
        : { seedDisplay: false, reduceMotion: false, lastSaveAt: 0 };
    if (doc && doc.documentElement && doc.documentElement.classList) {
      doc.documentElement.classList.toggle('reduce-motion', !!settings.reduceMotion);
    }
    app.showSettings(settings, async (newSettings) => {
      await storage.saveSettings(newSettings || {});
      if (doc && doc.documentElement && doc.documentElement.classList) {
        doc.documentElement.classList.toggle(
          'reduce-motion',
          !!(newSettings && newSettings.reduceMotion)
        );
      }
    });
  }

  // ---------------- 回调：返回主菜单 ----------------
  function onOpenMenu() {
    if (app.mount) app.mount(rootEl, { hasSave });
  }

  const callbacks = {
    onNewGame,
    onLoadGame,
    onAction,
    onAdvance,
    onResolveEvent,
    onExport,
    onImport,
    onClearSave,
    onOpenGallery,
    onOpenSettings,
    onOpenMenu,
  };

  // 启动时加载配置 → 创建 UI → 挂载主菜单
  async function start() {
    config = await loader.loadConfig();
    app = makeApp({ config, callbacks, doc });
    const r = await storage.loadGame();
    hasSave = r.ok;
    app.mount(rootEl, { hasSave });
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
        '<div class="screen"><h1 class="section-title">加载失败</h1>' +
        '<p class="muted">' +
        (e && e.message ? e.message : String(e)) +
        '</p></div>';
    });
  }
}
