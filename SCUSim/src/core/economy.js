/**
 * 经济 / 属性效果模块（被 engine 调用，不对外暴露给 UI）。
 *
 * 注：四个核心属性（knowledge/social/health/money）统一存于
 * state.player.attributes；money 也是其中一项，因此"经济效果"与
 * "属性效果"在此合并处理。
 */

/**
 * 将 effects 应用到玩家属性（就地修改）。
 * @param {object} state
 * @param {object} effects 形如 { attributes: { knowledge: 2, health: -1 } }
 */
export function applyAttributeEffects(state, effects) {
  const attrs = state && state.player && state.player.attributes;
  if (!attrs || !effects) return;
  const eff = effects.attributes || {};
  for (const key of Object.keys(eff)) {
    if (Object.prototype.hasOwnProperty.call(attrs, key)) {
      const delta = Number(eff[key]);
      if (Number.isFinite(delta)) attrs[key] += delta;
    }
  }
}

/**
 * 应用单个行动的属性 / 金钱效果（按 action.effects）。
 * @param {object} state
 * @param {object} action 来自 actions.json 的条目
 * @param {object} config
 * @param {object} rng
 */
export function applyActionEconomy(state, action, config, rng) {
  if (!action || !action.effects) return;
  applyAttributeEffects(state, action.effects);
}

/**
 * 月度收支结算（就地改 money）。缺字段按 0（no-op）。
 * @param {object} state
 * @param {object} config
 */
export function monthlyEconomy(state, config) {
  const balance = (config && config.balance) || {};
  const income = Number.isFinite(balance.monthlyIncome) ? balance.monthlyIncome : 0;
  const expense = Number.isFinite(balance.monthlyExpense) ? balance.monthlyExpense : 0;
  const net = income - expense;
  if (Number.isFinite(net) && net !== 0) {
    state.player.attributes.money += net;
    state.log.push(`月度收支：收入 ${income}，支出 ${expense}，净变化 ${net}。`);
  }
}
