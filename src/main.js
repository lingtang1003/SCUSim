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
    app.render(state, payload);
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
    const res = eng.doAction(state, actionId, config, rng);
    if (!res.ok) {
      app.showError(res.reason === 'AP' ? '行动点不够了，先结束这一周吧' : '这一步现在做不了');
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
    if (res.endingId) {
      await storage.unlockEnding(res.endingId);
      renderState();
      app.showEnding(endingOf(res.endingId));
      return;
    }
    renderState();
    if (res.pendingEvent || state.pendingEvent) {
      app.showEvent(state.pendingEvent);
    }
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
