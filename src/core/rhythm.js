/**
 * 每周固定规则（B · 纯函数，被 engine 调用；不碰 DOM / 存储 / 原生随机）。
 *
 * 四条规则全部由 config/balance.json 的 `weeklyRules` 驱动：
 *  1. eat       —— 这一周必须吃一次饭（食堂 / 商业街），否则扣健康（默认 −15）；
 *  2. allowance —— 每 N 周固定发一笔生活费（默认每 2 周 +80）；
 *  3. broke     —— 金钱为负时只能做允许的行动（默认兼职 / 休息），其余全部锁死；
 *  4. neglect   —— 某个属性连着 N 周都没涨过，就掉一截（默认 2 周 −10），掉完重新计数。
 *
 * 状态挂在 `state.player.weekly`：
 *   { lastEatTurn, gainedTurn: { 属性: 回合 }, miss: { 属性: 连续几周没涨 } }
 * 老存档没有这个字段时懒初始化，不破坏兼容。
 */

const DEFAULT_ATTRS = ['knowledge', 'social', 'health'];
const LABELS = { knowledge: '学识', social: '社交', health: '健康', money: '金钱' };

function getRules(config) {
  const b = (config && config.balance) || {};
  const r = b.weeklyRules;
  return (r && typeof r === 'object') ? r : null;
}

function num(v, fallback) {
  return Number.isFinite(Number(v)) ? Number(v) : fallback;
}

function trackedAttrs(config) {
  const rules = getRules(config);
  const list = rules && rules.neglect && Array.isArray(rules.neglect.attributes)
    ? rules.neglect.attributes
    : null;
  return (list && list.length) ? list : DEFAULT_ATTRS;
}

/** 取/建每周追踪状态（就地改 state）。 */
export function ensureWeekly(state, config) {
  if (!state || !state.player) return null;
  if (!state.player.weekly || typeof state.player.weekly !== 'object') {
    state.player.weekly = { lastEatTurn: 0, gainedTurn: {}, miss: {} };
  }
  const w = state.player.weekly;
  if (!Number.isFinite(Number(w.lastEatTurn))) w.lastEatTurn = 0;
  if (!w.gainedTurn || typeof w.gainedTurn !== 'object') w.gainedTurn = {};
  if (!w.miss || typeof w.miss !== 'object') w.miss = {};
  for (const k of trackedAttrs(config)) {
    if (!Number.isFinite(Number(w.gainedTurn[k]))) w.gainedTurn[k] = -1;
    if (!Number.isFinite(Number(w.miss[k]))) w.miss[k] = 0;
  }
  return w;
}

/**
 * 记录"这一周吃过饭了"。满足任一条件即算：
 *  - 执行的行动在 `weeklyRules.eat.actions` 里（默认 eat）；
 *  - 当前地点在 `weeklyRules.eat.locations` 里（默认两个食堂 + 商业街）。
 * @param {object} state
 * @param {string} actionId
 * @param {object} config
 */
export function markEat(state, actionId, config) {
  const rules = getRules(config);
  if (!rules || !rules.eat) return;
  const w = ensureWeekly(state, config);
  if (!w) return;
  const eat = rules.eat;
  const actions = Array.isArray(eat.actions) ? eat.actions : [];
  const locations = Array.isArray(eat.locations) ? eat.locations : [];
  const loc = state.player && state.player.location;
  if (actions.indexOf(actionId) >= 0 || (loc && locations.indexOf(loc) >= 0)) {
    w.lastEatTurn = Number(state.turn) || 1;
  }
}

/**
 * 记录"这一周涨过哪些属性"：before 是行动/事件结算前的属性快照。
 * @param {object} state
 * @param {object} before { knowledge, social, health, money }
 * @param {object} config
 */
export function markGains(state, before, config) {
  const rules = getRules(config);
  if (!rules || !rules.neglect) return;
  const w = ensureWeekly(state, config);
  if (!w) return;
  const now = state.player.attributes || {};
  const prev = before || {};
  const turn = Number(state.turn) || 1;
  for (const k of trackedAttrs(config)) {
    const delta = (Number(now[k]) || 0) - (Number(prev[k]) || 0);
    if (delta > 0) w.gainedTurn[k] = turn;
  }
}

/**
 * 金钱为负时，这个行动还能不能做。
 * @returns {{ blocked: boolean, allowed: string[] }}
 */
export function brokeCheck(state, actionId, config) {
  const rules = getRules(config);
  if (!rules || !rules.broke) return { blocked: false, allowed: [] };
  const money = Number(state.player && state.player.attributes && state.player.attributes.money) || 0;
  const allowed = Array.isArray(rules.broke.allowedActions) ? rules.broke.allowedActions.slice() : [];
  if (money >= 0) return { blocked: false, allowed };
  return { blocked: allowed.indexOf(actionId) < 0, allowed };
}

/**
 * 回合结束时结算"周期性"规则（固定开销 / 吃饭 / 生活费 / 属性荒废）。
 * 由 engine.advance 在进入新回合后调用，endedTurn 为刚结束的那一回合。
 * @param {object} state
 * @param {object} config
 * @param {number} endedTurn
 * @returns {{ notices: Array<{type:string, text:string, tone?:string}>, eatPenalty:number, allowance:number, fee:number, neglect:Array }}
 */
export function applyWeeklyRules(state, config, endedTurn) {
  const rules = getRules(config);
  const out = { notices: [], eatPenalty: 0, allowance: 0, fee: 0, neglect: [] };
  if (!rules || !state || !state.player) return out;
  const attrs = state.player.attributes || {};
  const w = ensureWeekly(state, config);
  const ended = Number(endedTurn) || 0;

  // 1) 这一周没吃饭 → 扣健康（同一周吃过就不再罚）
  const eat = rules.eat;
  if (eat) {
    const penalty = num(eat.healthPenalty, 15);
    const ate = Number(w.lastEatTurn) === ended;
    if (!ate && penalty > 0) {
      const before = Number(attrs.health) || 0;
      attrs.health = Math.max(0, before - penalty);
      const applied = before - attrs.health;
      out.eatPenalty = applied;
      if (applied > 0) {
        out.notices.push({
          type: 'eat',
          tone: 'warning',
          text: `${eat.message || '这周没好好吃饭'}：健康 −${applied}`,
        });
      }
    }
  }

  // 2) 每周固定开销（先扣固定开销，再发生活费，顺序固定便于对账）
  const fee = rules.fee;
  if (fee) {
    const amount = num(fee.amount, 0);
    if (amount > 0) {
      attrs.money = (Number(attrs.money) || 0) - amount;
      out.fee = amount;
      out.notices.push({
        type: 'fee',
        tone: 'info',
        text: `${fee.message || '本周固定开销'}：金钱 −${amount}`,
      });
    }
  }

  // 3) 生活费：每 everyTurns 周发一次
  const allowance = rules.allowance;
  if (allowance) {
    const every = Math.max(1, num(allowance.everyTurns, 2));
    const amount = num(allowance.amount, 0);
    const turn = Number(state.turn) || 1;
    if (amount > 0 && turn % every === 0) {
      attrs.money = (Number(attrs.money) || 0) + amount;
      out.allowance = amount;
      out.notices.push({
        type: 'allowance',
        tone: 'success',
        text: `${allowance.message || '生活费到账'}：+${amount}`,
      });
    }
  }

  // 4) 连着 N 周没涨过的属性 → 掉一截（掉完清零重算，不会每周连扣）
  const neglect = rules.neglect;
  if (neglect) {
    const after = Math.max(1, num(neglect.afterTurns, 2));
    const baseAmount = num(neglect.amount, 10);
    const perAttr = (neglect.amounts && typeof neglect.amounts === 'object') ? neglect.amounts : {};
    for (const k of trackedAttrs(config)) {
      const gained = Number(w.gainedTurn[k]);
      if (Number.isFinite(gained) && gained === ended) {
        w.miss[k] = 0;              // 这一周涨过，重新计时
        continue;
      }
      const miss = (Number(w.miss[k]) || 0) + 1;
      w.miss[k] = miss;
      if (miss < after) continue;
      const amount = Number.isFinite(Number(perAttr[k])) ? Number(perAttr[k]) : baseAmount;
      const before = Number(attrs[k]) || 0;
      attrs[k] = Math.max(0, before - amount);
      const applied = before - attrs[k];
      w.miss[k] = 0;                // 掉完重新计时
      if (applied > 0) {
        const label = (neglect.labels && neglect.labels[k]) || LABELS[k] || k;
        out.neglect.push({ attribute: k, amount: -applied });
        out.notices.push({
          type: 'neglect',
          tone: 'warning',
          text: `${(neglect.message || '两周没碰{direction}，手生了').replace('{direction}', label)}：${label} −${applied}`,
        });
      }
    }
  }

  return out;
}

/**
 * 健康归零时，这个行动还允不允许做（默认只允许「效果里加健康」的活动）。
 * @returns {boolean} true = 被拦下
 */
export function blockedByZeroHealth(state, action, config) {
  const rules = getRules(config);
  const cfg = (config && config.balance && config.balance.healthZeroRule) || null;
  if (!cfg || cfg.onlyPositiveHealthActions === false) return false;
  const health = Number(state.player && state.player.attributes && state.player.attributes.health) || 0;
  if (health > 0) return false;
  const gain = Number(action && action.effects && action.effects.attributes && action.effects.attributes.health) || 0;
  return !(gain > 0);
}

/**
 * 学识归零 = 退学：直接把结局定死。
 * @returns {{ ended: boolean, endingId?: string, message?: string }}
 */
export function checkDropout(state, config) {
  const cfg = (config && config.balance && config.balance.dropout) || null;
  if (!cfg || !state || !state.player) return { ended: false };
  if (state.endingId) return { ended: false };
  const attr = cfg.attribute || 'knowledge';
  const value = Number(state.player.attributes && state.player.attributes[attr]) || 0;
  const atMost = Number.isFinite(Number(cfg.atMost)) ? Number(cfg.atMost) : 0;
  if (value > atMost) return { ended: false };
  const endingId = cfg.endingId || 'ending_warning';
  state.endingId = endingId;
  return { ended: true, endingId, message: cfg.message || '学识归零，被退学' };
}

