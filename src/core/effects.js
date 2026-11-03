/**
 * 统一效果写入口（B · 经济/学业/事件）。
 *
 * 所有「属性 / 货币 / 标记 / 社团」的变更一律经由此处一次应用，
 * 避免各模块各自改 player 造成口径不一致（任务书 W1-1）。
 *
 * 纯逻辑模块：不触碰 DOM / 存储 / 原生随机，可在 Node 直接 import 测试。
 *
 * 返回：
 *   applyEffects(state, effects, ctx) -> { ok: true, changes: [{kind,key,delta}] }
 *     kind ∈ 'attr' | 'money' | 'flag' | 'club'
 *   - attributes：逐项加，并对非 money 属性做上下限钳制（clamp）。
 *   - money：直接加，不钳制（可为负，供负债判定）。
 *   - flags：写 player.flags[key]；romance 额外同步写 player.romance。
 *   - club：写 player.club。
 *   所有变更追加到 state.history（超过上限截断；可通过 ctx 注入 pushHistory / historyLimit）。
 */

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 100;
const HISTORY_LIMIT = 200;

/** 解析钳制函数：ctx.clamp 优先，其次读 config.balance.attributeClamp，最后用默认 [0,100]（money 不钳制）。 */
function resolveClamp(ctx) {
  if (ctx && typeof ctx.clamp === 'function') return ctx.clamp;
  const clampCfg = (ctx && ctx.config && ctx.config.balance && ctx.config.balance.attributeClamp) || {};
  const min = Number.isFinite(clampCfg.min) ? clampCfg.min : DEFAULT_MIN;
  const max = Number.isFinite(clampCfg.max) ? clampCfg.max : DEFAULT_MAX;
  return (key, value) => (key === 'money' ? value : Math.max(min, Math.min(max, value)));
}

/** 写入 history（可注入 pushHistory，否则就地惰性初始化 state.history）。 */
function pushHistory(state, changes, ctx) {
  if (ctx && typeof ctx.pushHistory === 'function') {
    ctx.pushHistory(state, changes);
    return;
  }
  if (!Array.isArray(state.history)) state.history = [];
  const limit = Number.isFinite(ctx && ctx.historyLimit) ? ctx.historyLimit : HISTORY_LIMIT;
  state.history.push({
    type: 'effect',
    turn: state.turn,
    changes: changes.map((c) => ({ ...c })),
  });
  if (state.history.length > limit) {
    state.history.splice(0, state.history.length - limit);
  }
}

/** 当月属性净变化追踪（供 settleMonthly 汇总展示当月累计变化）。 */
function bumpMonth(state, key, applied) {
  if (!state.__monthDelta) state.__monthDelta = {};
  state.__monthDelta[key] = (state.__monthDelta[key] || 0) + applied;
}

/** 当月金钱流水追踪（income=正变化/兼职等，expense=负变化/消费等，供月度收支展示）。 */
function bumpMoneyFlow(state, delta) {
  if (!state.__monthFlow) state.__monthFlow = { income: 0, expense: 0 };
  if (delta > 0) state.__monthFlow.income += delta;
  else state.__monthFlow.expense += -delta;
}

/**
 * 统一应用一组 effects（就地修改 state）。
 * @param {object} state
 * @param {object} effects 形如 { attributes, money, flags, club }
 * @param {object} [ctx] { config, clamp, historyLimit, pushHistory }
 * @returns {{ ok: boolean, changes: Array<{kind:string,key:string,delta:number}> }}
 */
export function applyEffects(state, effects, ctx) {
  const attrs = state && state.player && state.player.attributes;
  if (!effects || !attrs) return { ok: false, changes: [] };
  const changes = [];
  const clamp = resolveClamp(ctx);

  // ---- attributes：逐项加 + 钳制（money 除外） ----
  const aeff = effects.attributes || {};
  for (const key of Object.keys(aeff)) {
    if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
    const delta = Number(aeff[key]);
    if (!Number.isFinite(delta) || delta === 0) continue;
    const before = Number(attrs[key]) || 0;
    const after = clamp(key, before + delta);
    attrs[key] = after;
    const applied = after - before;
    if (applied !== 0) {
      changes.push({ kind: 'attr', key, delta: applied });
      bumpMonth(state, key, applied);
      // attributes 里的 money（如兼职赚/消费花）也计入当月金钱流水，供月度收支展示
      if (key === 'money') bumpMoneyFlow(state, applied);
    }
  }

  // ---- money：直接加，不钳制 ----
  if (effects.money !== undefined) {
    const delta = Number(effects.money);
    if (Number.isFinite(delta) && delta !== 0) {
      attrs.money = (Number(attrs.money) || 0) + delta;
      changes.push({ kind: 'money', key: 'money', delta });
      bumpMonth(state, 'money', delta);
      bumpMoneyFlow(state, delta);
    }
  }

  // ---- flags ----
  const flags = effects.flags || {};
  for (const key of Object.keys(flags)) {
    if (!state.player.flags) state.player.flags = {};
    const val = flags[key];
    state.player.flags[key] = val;
    if (key === 'romance') state.player.romance = val;
    changes.push({ kind: 'flag', key, delta: val });
  }

  // ---- club ----
  if (effects.club !== undefined) {
    state.player.club = effects.club;
    changes.push({ kind: 'club', key: 'club', delta: effects.club });
  }

  if (changes.length > 0) pushHistory(state, changes, ctx);
  return { ok: true, changes };
}

const ATTR_LABEL = { knowledge: '学识', social: '社交', health: '健康', money: '金钱' };

/**
 * 把 applyEffects 返回的 changes 转成人类可读的影响片段数组。
 * 例如 [{kind:'attr',key:'knowledge',delta:2},{kind:'attr',key:'health',delta:-1}]
 * → ['学识+2', '健康-1']
 * @param {Array<{kind:string,key:string,delta:any}>} changes
 * @returns {string[]}
 */
export function describeChanges(changes) {
  const parts = [];
  for (const c of (changes || [])) {
    if (c.kind === 'attr' || c.kind === 'money') {
      const label = (c.kind === 'money' ? '金钱' : ATTR_LABEL[c.key]) || c.key;
      const d = Number(c.delta);
      if (Number.isFinite(d)) parts.push(`${label}${d > 0 ? '+' : ''}${d}`);
    } else if (c.kind === 'flag') {
      parts.push(`${c.key}=${c.delta}`);
    } else if (c.kind === 'club') {
      parts.push(`加入${c.delta}`);
    }
  }
  return parts;
}
