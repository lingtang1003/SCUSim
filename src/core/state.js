/**
 * GameState 工厂与状态工具（负责人 A）。
 *
 * 可变状态模型：state 在引擎中就地修改。本模块不依赖 DOM / 存储。
 *
 * v2 增补（见 docs/CONTRACT.md §2.3）：
 *  - player.club / player.romance / player.flags
 *  - academics.semesterRecords / totalGpa / thesis / warningTurn / studyActionsBySemester
 *  - state.history（结构化履历，环形 ≤ historyLimit）
 *  - clampAttrs()：按 config.balance.attributeClamp 钳制（money 默认不钳制，D-01）
 *  - pushHistory() / pushLog()：写履历与日志并做环形截断
 *
 * 注意：state.version 在 W1 仍为 '1.0.0'；与 SAVE_VERSION 2.0.0 的同步升级由 D 在 W4
 * 的迁移 PR 中一并完成（见 CONTRACT §7「版本与迁移」），避免与旧存档/旧测试互相踩踏。
 */

export const STATE_VERSION = '1.0.0';

export const DEFAULT_HISTORY_LIMIT = 60;
export const DEFAULT_LOG_LIMIT = 60;

/** 姓名规则（D-17）：1–12 个字符，只允许汉字或英文字母，禁止数字与符号 */
export const NAME_MAX_LENGTH = 12;
export const NAME_PATTERN = /^[\u4e00-\u9fa5A-Za-z]+$/;

/**
 * 校验姓名是否合法。
 * @param {string} name
 * @returns {boolean}
 */
export function isValidName(name) {
  const s = typeof name === 'string' ? name.trim() : '';
  if (!s || s.length > NAME_MAX_LENGTH) return false;
  return NAME_PATTERN.test(s);
}

const DEFAULT_CLAMP = {
  knowledge: [0, 99],
  social: [0, 99],
  health: [0, 99],
  money: null, // D-01：金钱是货币，不设上限、可为负
};

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 99;

/**
 * 创建初始 GameState（仅结构，不做规则计算）。
 * @param {object} options { name, gender, collegeId, attributes, tags, seed? }
 * @returns {object} GameState
 */
export function createGameState(options) {
  const o = options || {};
  const attrs = o.attributes || {};
  return {
    version: STATE_VERSION,
    seed: Number.isFinite(o.seed) ? o.seed : 0,
    // rngState 由引擎在 newGame 中填入（结构预留）
    rngState: 0,
    turn: 1,
    actionPoints: 4,
    player: {
      name: typeof o.name === 'string' ? o.name : '',
      gender: o.gender === '女' ? '女' : '男',
      collegeId: typeof o.collegeId === 'string' ? o.collegeId : '',
      attributes: {
        knowledge: Number(attrs.knowledge) || 0,
        social: Number(attrs.social) || 0,
        health: Number(attrs.health) || 0,
        money: Number(attrs.money) || 0,
      },
      tags: Array.isArray(o.tags) ? o.tags.slice(0, 3) : [],
      // 纯展示字段（立绘），不参与任何结算；由 main 在创建/换装时写入
      appearance: typeof o.appearance === 'string' ? o.appearance : '',
      club: null,
      romance: 'none',
      flags: {},
      // 连续未安排对应行动的周数（idleDecay）：{ knowledge, health }
      idle: { knowledge: 0, health: 0 },
      idleYear: 1,
    },
    academics: {
      semesterScores: [],
      semesterRecords: [],
      failedCourses: 0,
      warning: false,
      warningTurn: null,
      studyActions: 0,
      studyActionsBySemester: 0,
      totalGpa: 0,
      thesis: null,
    },
    pendingEvent: null,
    eventHistory: [],
    history: [],
    log: [],
    endingId: null,
  };
}

/**
 * 按配置钳制属性（就地修改）。
 * 规则：
 *  - config.balance.attributeClamp[key] 为 [min, max] 时钳制到该区间并取整；
 *  - 为 null 时只取整、不钳制（money 的默认行为，D-01）；
 *  - 配置缺省时使用 DEFAULT_CLAMP（money 不钳制）。
 * @param {object} state
 * @param {object} [config]
 * @returns {object} state
 */
export function clampAttrs(state, config) {
  if (!state || !state.player || !state.player.attributes) return state;
  const cfg = (config && config.balance && config.balance.attributeClamp)
    ? config.balance.attributeClamp
    : DEFAULT_CLAMP;
  // 兼容两种写法：
  //   全局 { min, max }（当前 config）+ 可选按属性覆盖 { knowledge: [0,99], money: null }
  //   纯按属性 { knowledge: [0,99], ... }
  const globalMin = Number.isFinite(cfg.min) ? Number(cfg.min) : DEFAULT_MIN;
  const globalMax = Number.isFinite(cfg.max) ? Number(cfg.max) : DEFAULT_MAX;
  const attrs = state.player.attributes;
  for (const key of Object.keys(DEFAULT_CLAMP)) {
    if (!(key in attrs)) continue;
    const raw = Number(attrs[key]);
    if (!Number.isFinite(raw)) { attrs[key] = 0; continue; }
    let v = Math.round(raw);
    const perKey = cfg[key];
    if (key === 'money' && !Array.isArray(perKey)) {
      // D-01：money 是货币，默认不钳制（显式写成 [min,max] 时才钳制）
      attrs[key] = v;
      continue;
    }
    const range = Array.isArray(perKey) ? perKey : [globalMin, globalMax];
    if (Array.isArray(range) && range.length === 2) {
      v = Math.min(Number(range[1]), Math.max(Number(range[0]), v));
    }
    attrs[key] = v;
  }
  return state;
}

/**
 * 追加一条结构化履历（环形，超出 historyLimit 从头部丢弃）。
 * @param {object} state
 * @param {object} entry { type, text, ... }
 * @param {object} [config]
 */
export function pushHistory(state, entry, config) {
  if (!state) return;
  if (!Array.isArray(state.history)) state.history = [];
  const limit = Number.isFinite(config && config.balance && config.balance.historyLimit)
    ? Number(config.balance.historyLimit)
    : DEFAULT_HISTORY_LIMIT;
  const item = Object.assign({ turn: state.turn }, entry || {});
  state.history.push(item);
  if (state.history.length > limit) {
    state.history.splice(0, state.history.length - limit);
  }
}

/**
 * 追加一条玩家可见日志（环形，超出 logLimit 从头部丢弃）。
 * @param {object} state
 * @param {string} text
 * @param {object} [config]
 */
export function pushLog(state, text, config) {
  if (!state || typeof text !== 'string') return;
  if (!Array.isArray(state.log)) state.log = [];
  const limit = Number.isFinite(config && config.balance && config.balance.logLimit)
    ? Number(config.balance.logLimit)
    : DEFAULT_LOG_LIMIT;
  state.log.push(text);
  if (state.log.length > limit) {
    state.log.splice(0, state.log.length - limit);
  }
}

/**
 * 深拷贝（存档快照/测试用）。优先 structuredClone，降级 JSON 克隆。
 * @param {object} state
 * @returns {object}
 */
export function clone(state) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(state);
    } catch (_) {
      /* 降级到 JSON */
    }
  }
  return JSON.parse(JSON.stringify(state));
}
