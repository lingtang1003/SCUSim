/**
 * 音频层（背景音乐 + 音效）。
 *
 * 设计要点：
 *  - 模块顶层【不访问 DOM / window】，Node 里 import 不抛错（测试会直接 import 本文件）。
 *  - 浏览器里用 <audio> 播放，音量分「背景音乐」和「音效」两路，各自可调 0–100。
 *  - 资源文件还没放进来时（或没装音频设备）全部静默降级：不报错、不影响游戏。
 *
 * 资源约定（把文件按下面的名字放进对应目录即可自动生效）：
 *   assets/audio/bgm/theme.mp3     标题页
 *   assets/audio/bgm/campus.mp3    游戏内（按季节同名文件可覆盖：spring/summer/autumn/winter）
 *   assets/audio/sfx/click.mp3     按钮、选项卡
 *   assets/audio/sfx/choice.mp3    确认选项
 *   assets/audio/sfx/toast.mp3     提示音
 *
 * 缺哪个文件，就只是那一个音不响，其余照常。
 */

const BGM_DIR = 'assets/audio/bgm/';
const SFX_DIR = 'assets/audio/sfx/';

/** 逻辑音轨名 → 文件名。想换曲子只改这里。 */
const BGM_TRACKS = {
  theme: 'theme.mp3',
  campus: 'campus.mp3',
};

const SFX_TRACKS = {
  click: 'click.mp3',
  choice: 'choice.mp3',
  toast: 'toast.mp3',
};

const DEFAULT_VOLUME = { bgm: 0.6, sfx: 0.8 };

function clamp01(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/**
 * @param {object} [ctx] { doc?, Audio? } —— 方便测试注入假实现
 * @returns {object} 音频控制器
 */
export function createAudio(ctx) {
  const scope = ctx || {};
  const doc = scope.doc || (typeof globalThis !== 'undefined' ? globalThis.document : undefined);
  const AudioCtor =
    scope.Audio ||
    (typeof globalThis !== 'undefined' && typeof globalThis.Audio === 'function' ? globalThis.Audio : null);

  let bgmVolume = DEFAULT_VOLUME.bgm;
  let sfxVolume = DEFAULT_VOLUME.sfx;
  let muted = false;

  let bgmEl = null;
  let bgmName = '';

  function canPlay() {
    return !!AudioCtor && (muted ? false : true);
  }

  function effective(kind) {
    if (muted) return 0;
    return kind === 'bgm' ? bgmVolume : sfxVolume;
  }

  function makeEl(src, loop, volume) {
    if (!AudioCtor) return null;
    try {
      const el = new AudioCtor(src);
      el.loop = !!loop;
      el.volume = volume;
      el.preload = 'auto';
      return el;
    } catch {
      return null;
    }
  }

  function playBgm(name) {
    const key = BGM_TRACKS[name] ? name : 'campus';
    if (bgmName === key && bgmEl) return;
    stopBgm();
    bgmName = key;
    bgmEl = makeEl(BGM_DIR + BGM_TRACKS[key], true, effective('bgm'));
    if (!bgmEl) return;
    // 自动播放策略：被浏览器拦下时静默等待用户下一次交互
    try {
      const p = bgmEl.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* 静默 */
    }
  }

  function stopBgm() {
    if (!bgmEl) return;
    try {
      bgmEl.pause();
      bgmEl.currentTime = 0;
    } catch {
      /* 静默 */
    }
    bgmEl = null;
    bgmName = '';
  }

  function playSfx(name) {
    const key = SFX_TRACKS[name] ? name : 'click';
    if (!canPlay()) return;
    const el = makeEl(SFX_DIR + SFX_TRACKS[key], false, effective('sfx'));
    if (!el) return;
    try {
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* 静默 */
    }
  }

  /** 0–100 的整数，外部（设置面板）直接用这个单位。 */
  function setBgmVolume(percent) {
    bgmVolume = clamp01(Number(percent) / 100, DEFAULT_VOLUME.bgm);
    if (bgmEl) bgmEl.volume = effective('bgm');
    return Math.round(bgmVolume * 100);
  }

  function setSfxVolume(percent) {
    sfxVolume = clamp01(Number(percent) / 100, DEFAULT_VOLUME.sfx);
    return Math.round(sfxVolume * 100);
  }

  function setMuted(on) {
    muted = !!on;
    if (bgmEl) bgmEl.volume = effective('bgm');
    if (!muted) {
      try {
        if (bgmEl && bgmEl.paused) {
          const p = bgmEl.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch {
        /* 静默 */
      }
    }
    return muted;
  }

  function getState() {
    return {
      bgmVolume: Math.round(bgmVolume * 100),
      sfxVolume: Math.round(sfxVolume * 100),
      muted: muted,
      playing: bgmName,
      supported: !!AudioCtor,
    };
  }

  /** 从存档/设置对象里一次性套用（缺字段用默认值）。 */
  function apply(raw) {
    const s = raw || {};
    if (s.bgmVolume !== undefined) bgmVolume = clamp01(Number(s.bgmVolume) / 100, DEFAULT_VOLUME.bgm);
    if (s.sfxVolume !== undefined) sfxVolume = clamp01(Number(s.sfxVolume) / 100, DEFAULT_VOLUME.sfx);
    if (s.muted !== undefined) muted = !!s.muted;
    if (bgmEl) bgmEl.volume = effective('bgm');
    return getState();
  }

  return {
    playBgm,
    stopBgm,
    playSfx,
    setBgmVolume,
    setSfxVolume,
    setMuted,
    getState,
    apply,
    BGM_TRACKS,
    SFX_TRACKS,
    doc: doc,
  };
}
