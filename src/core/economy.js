/**
 * 经济 / 属性效果模块（B · 被 engine 调用，不对外暴露给 UI）。
 *
 * 注：四个核心属性（knowledge/social/health/money）统一存于
 * state.player.attributes；money 也是其中一项，因此"经济效果"与
 * "属性效果"在此合并处理。
 *
 * 本模块：
 *  - 属性/money/flags/club 的写入统一走 effects.applyEffects（任务书 W1-1）。
 *  - 提供月度收支 settleMonthly、额外收支 applyExtraMoney、负债判定 checkDebt。
 *  - 保留 applyAttributeEffects / monthlyEconomy 作为兼容层，供 engine 既有调用。
 */

import { applyEffects, describeChanges } from './effects.js';

/**
 * 将 effects 应用到玩家属性（就地修改）。
 * 兼容层：仅处理 effects.attributes，不做 money/flags/club 与 history。
 * 新代码请使用 effects.applyEffects（统一入口）。
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
 * 统一走 applyEffects，因此 action.effects 支持 attributes/money/flags/club。
 * 并在效果后追加一条「影响：…」日志，供近期动态展示本次行动的具体数值变化。
 * @param {object} state
 * @param {object} action 来自 actions.json 的条目
 * @param {object} config
 * @param {object} rng
 */
export function applyActionEconomy(state, action, config, rng) {
  if (!action || !action.effects) return;
  const res = applyEffects(state, action.effects, { config });
  const parts = describeChanges(res.changes);
  if (parts.length) state.log.push(`影响：${parts.join('，')}。`);
}

const MONTH_LABEL = { knowledge: '学识', social: '社交', health: '健康' };

/**
 * 月度收支结算（就地改 money）。
 * 汇总当月行动/事件累计的属性净变化与金钱流水（兼职/消费），一并写入日志。
 * 金钱只加「固定净额」（固定收入-固定支出）；兼职/消费已由行动/事件即时入账，不重复计入。
 * @param {object} state
 * @param {object} config
 * @returns {{ ok: boolean, income: number, expense: number, net: number }}
 */
export function settleMonthly(state, config) {
  const balance = (config && config.balance) || {};
  const income = Number.isFinite(balance.monthlyIncome) ? balance.monthlyIncome : 0;
  const expense = Number.isFinite(balance.monthlyExpense) ? balance.monthlyExpense : 0;
  const flow = state.__monthFlow || { income: 0, expense: 0 };
  const delta = state.__monthDelta || {};
  const fixedNet = income - expense;

  // 当月属性净变化（学识/社交/健康）
  const attrParts = [];
  for (const k of Object.keys(MONTH_LABEL)) {
    const d = delta[k];
    if (Number.isFinite(d) && d !== 0) attrParts.push(`${MONTH_LABEL[k]}${d > 0 ? '+' : ''}${d}`);
  }
  // 当月金钱：固定收支 + 兼职/消费净流水
  const moneyFlowNet = (Number.isFinite(flow.income) ? flow.income : 0) - (Number.isFinite(flow.expense) ? flow.expense : 0);
  const totalIncome = income + (Number.isFinite(flow.income) ? flow.income : 0);
  const totalExpense = expense + (Number.isFinite(flow.expense) ? flow.expense : 0);
  const net = totalIncome - totalExpense;

  // 固定净额入账（兼职/消费已即时生效）
  if (Number.isFinite(fixedNet) && fixedNet !== 0) {
    state.player.attributes.money = (Number(state.player.attributes.money) || 0) + fixedNet;
  }

  let msg = '';
  if (attrParts.length) msg += `本月变化：${attrParts.join('，')}。`;
  msg += `金钱：固定收支 ${income} - ${expense}，兼职/消费净 ${moneyFlowNet > 0 ? '+' : ''}${moneyFlowNet}，当月 ${net > 0 ? '+' : ''}${net}。`;
  state.log.push(`月度结算：${msg}`);

  // 重置当月追踪
  delete state.__monthDelta;
  delete state.__monthFlow;
  return { ok: true, income: totalIncome, expense: totalExpense, net };
}

/**
 * 兼容层：engine 既有调用的 monthlyEconomy，内部委托 settleMonthly（void）。
 * @param {object} state
 * @param {object} config
 */
export function monthlyEconomy(state, config) {
  settleMonthly(state, config);
}

/**
 * 额外收支（奖学金/兼职/买买买等一次性货币变化），就地改 money 并写 log。
 * @param {object} state
 * @param {number} amount 可为负
 * @param {string} [reason] 日志文案
 * @returns {{ ok: boolean, money: number }}
 */
export function applyExtraMoney(state, amount, reason) {
  const m = Number(amount);
  if (!Number.isFinite(m) || m === 0) {
    return { ok: true, money: Number(state.player.attributes.money) || 0 };
  }
  state.player.attributes.money = (Number(state.player.attributes.money) || 0) + m;
  const sign = m > 0 ? '+' : '';
  state.log.push(reason ? `${reason}：${sign}${m}。` : `金钱变化：${sign}${m}。`);
  return { ok: true, money: state.player.attributes.money };
}

/**
 * 负债判定：money <= debtThreshold 且距上次触发 >= debtCooldownTurns 时触发负债事件。
 * 记 state.player.flags.lastDebtTurn，避免冷却期内重复触发。
 *
 * 注：本函数供 engine 在 advance 中调用以把 ev_fixed_debt 挂进待处理事件；
 * 当前 engine 尚未接入，由 A 集成（本模块只提供判定，不自行改 engine）。
 * @param {object} state
 * @param {object} config
 * @returns {{ triggered: boolean, eventId: string|null }}
 */
export function checkDebt(state, config) {
  const balance = (config && config.balance) || {};
  const threshold = Number.isFinite(balance.debtThreshold) ? balance.debtThreshold : -3000;
  const cooldown = Number.isFinite(balance.debtCooldownTurns) ? balance.debtCooldownTurns : 6;
  const money = Number(state.player.attributes.money) || 0;
  if (money > threshold) return { triggered: false, eventId: null };
  if (!state.player.flags) state.player.flags = {};
  const last = Number.isFinite(state.player.flags.lastDebtTurn)
    ? state.player.flags.lastDebtTurn
    : -Infinity;
  if (state.turn - last < cooldown) return { triggered: false, eventId: null };
  state.player.flags.lastDebtTurn = state.turn;
  return { triggered: true, eventId: 'ev_fixed_debt' };
}
