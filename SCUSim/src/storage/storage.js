/**
 * 存储层（负责人 D）。纯逻辑可测 + 浏览器持久化两层。
 *
 * 纯函数（可在 Node 直接测，不依赖 DOM）：
 *   serializeSave(state) / deserializeSave(text) / checkSaveVersion(parsed)
 *   / addGalleryUnlocked(gallery, id)
 *
 * createStorage(backend?) 工厂：默认浏览器用 localStorage（typeof 守卫，
 * 无则降级内存），提供 saveGame/loadGame/clearSave/getGallery/unlockEnding/
 * exportSaveFile/importSaveFile/getSettings/saveSettings。
 *
 * 核心逻辑（core/events/config）不得调用本模块。
 */

const SAVE_KEY = 'scusim:save';
const GALLERY_KEY = 'scusim:gallery';
const SETTINGS_KEY = 'scusim:settings';
const SAVE_VERSION = '1.0.0';
const SAVE_FORMAT = 'scusim';

/** 将 GameState 序列化为 .scusim 文本。 */
export function serializeSave(state) {
  return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, state });
}

/** 校验存档结构/版本，返回 { ok, reason? }。 */
export function checkSaveVersion(parsed) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'invalid' };
  if (parsed.format !== SAVE_FORMAT) return { ok: false, reason: 'format_mismatch' };
  if (parsed.version !== SAVE_VERSION) return { ok: false, reason: 'version_incompatible' };
  return { ok: true };
}

/**
 * 反序列化存档文本。
 * 畸形文本 / 版本不兼容 / 缺 state 均返回 { ok:false, reason }。
 * @param {string|object} text
 * @returns {{ ok: boolean, state?: object, reason?: string }}
 */
export function deserializeSave(text) {
  let parsed;
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : text;
  } catch (_) {
    return { ok: false, reason: 'invalid_json' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'invalid_format' };
  const ver = checkSaveVersion(parsed);
  if (!ver.ok) return { ok: false, reason: ver.reason };
  if (!parsed.state || typeof parsed.state !== 'object') return { ok: false, reason: 'missing_state' };
  return { ok: true, state: parsed.state, data: { version: parsed.version } };
}

/** 图鉴去重：返回新的 gallery 对象（不修改入参）。 */
export function addGalleryUnlocked(gallery, id) {
  const g = (gallery && typeof gallery === 'object')
    ? { version: gallery.version || SAVE_VERSION, unlocked: Array.isArray(gallery.unlocked) ? [...gallery.unlocked] : [] }
    : { version: SAVE_VERSION, unlocked: [] };
  if (!g.unlocked.includes(id)) g.unlocked.push(id);
  return g;
}

// ---------------- 浏览器 / 内存后端 ----------------

function makeLocalStorageBackend(ls) {
  return {
    get: (k) => { try { return ls.getItem(k); } catch { return null; } },
    set: (k, v) => { try { ls.setItem(k, v); } catch { /* 配额等忽略 */ } },
    remove: (k) => { try { ls.removeItem(k); } catch { /* 忽略 */ } },
  };
}

function makeMemoryBackend() {
  const m = new Map();
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => { m.set(k, v); },
    remove: (k) => { m.delete(k); },
  };
}

function resolveBackend(backend) {
  if (backend && typeof backend.get === 'function') return backend;
  // 默认：浏览器 localStorage，否则降级内存（Node 测试亦可安全使用）
  if (typeof localStorage !== 'undefined' && localStorage) {
    return makeLocalStorageBackend(localStorage);
  }
  return makeMemoryBackend();
}

/**
 * 创建存储实例。所有方法返回 Promise（与浏览器异步 API 保持一致）。
 * @param {object} [backend] 可选注入后端 { get, set, remove }
 */
export function createStorage(backend) {
  const be = resolveBackend(backend);

  function getGallery() {
    const raw = be.get(GALLERY_KEY);
    if (!raw) return Promise.resolve({ ok: true, gallery: { version: SAVE_VERSION, unlocked: [] } });
    try {
      const g = JSON.parse(raw);
      return Promise.resolve({
        ok: true,
        gallery: { version: g.version || SAVE_VERSION, unlocked: Array.isArray(g.unlocked) ? g.unlocked : [] },
      });
    } catch {
      return Promise.resolve({ ok: true, gallery: { version: SAVE_VERSION, unlocked: [] } });
    }
  }

  function unlockEnding(endingId) {
    return getGallery().then(({ gallery }) => {
      const updated = addGalleryUnlocked(gallery, endingId);
      be.set(GALLERY_KEY, JSON.stringify(updated));
      return { ok: true };
    });
  }

  function saveGame(state) {
    be.set(SAVE_KEY, serializeSave(state));
    return Promise.resolve({ ok: true, message: '已保存' });
  }

  function loadGame() {
    const raw = be.get(SAVE_KEY);
    if (!raw) return Promise.resolve({ ok: false, reason: 'no_save' });
    const r = deserializeSave(raw);
    if (!r.ok) return Promise.resolve({ ok: false, reason: r.reason });
    return Promise.resolve({ ok: true, state: r.state });
  }

  function clearSave() {
    be.remove(SAVE_KEY);
    return Promise.resolve({ ok: true });
  }

  function exportSaveFile(state) {
    const obj = { format: SAVE_FORMAT, version: SAVE_VERSION, state };
    // 浏览器返回 Blob；Node 下无 Blob 则返回对象（不依赖 Blob 全局）
    if (typeof Blob !== 'undefined') {
      return Promise.resolve(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
    }
    return Promise.resolve(obj);
  }

  function importSaveFile(file) {
    return Promise.resolve().then(async () => {
      let text;
      if (typeof file === 'string') {
        text = file;
      } else if (file && typeof file === 'object') {
        if (typeof Blob !== 'undefined' && file instanceof Blob) {
          text = await file.text();
        } else if (typeof file.text === 'function') {
          text = await file.text();
        } else {
          // 已是对象或含 state 的对象
          text = JSON.stringify(file);
        }
      } else {
        return { ok: false, reason: 'invalid_input' };
      }
      const r = deserializeSave(text);
      // 校验失败不覆盖当前有效存档（本函数不写 SAVE_KEY）
      if (!r.ok) return { ok: false, reason: r.reason };
      return { ok: true, state: r.state };
    });
  }

  function getSettings() {
    const raw = be.get(SETTINGS_KEY);
    const def = { seedDisplay: false, reduceMotion: false, lastSaveAt: 0 };
    if (!raw) return Promise.resolve({ ok: true, settings: def });
    try {
      const s = JSON.parse(raw);
      return Promise.resolve({ ok: true, settings: { ...def, ...s } });
    } catch {
      return Promise.resolve({ ok: true, settings: def });
    }
  }

  function saveSettings(settings) {
    return getSettings().then(({ settings: cur }) => {
      const merged = { ...cur, ...(settings || {}) };
      be.set(SETTINGS_KEY, JSON.stringify(merged));
      return { ok: true };
    });
  }

  return {
    saveGame, loadGame, clearSave, getGallery, unlockEnding,
    exportSaveFile, importSaveFile, getSettings, saveSettings,
  };
}
