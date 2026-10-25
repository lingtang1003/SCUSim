/**
 * 事件管理（被 engine 调用）。
 *
 * 注意：本模块严禁使用原生随机函数，随机一律通过 rng 入参。
 */

import { applyAttributeEffects } from '../core/economy.js';

function getAllEvents(config) {
  const events = (config && config.events) || {};
  const fixed = Array.isArray(events.fixed) ? events.fixed : [];
  const random = Array.isArray(events.random) ? events.random : [];
  return { fixed, random };
}

function findEvent(config, eventId) {
  const { fixed, random } = getAllEvents(config);
  return fixed.find((e) => e.id === eventId)
    || random.find((e) => e.id === eventId)
    || null;
}

export function buildPending(ev) {
  return {
    eventId: ev.id,
    options: (ev.options || []).map((o) => ({ id: o.id, label: o.label })),
    resolved: false,
  };
}

/**
 * 按基率与权重抽取随机事件。v1 用原始 weight 加权抽样（不做 weightModifiers 修正）。
 * @param {object} state
 * @param {object} config
 * @param {object} rng
 * @returns {{ eventId: string|null, options: Array }}
 */
export function rollRandomEvent(state, config, rng) {
  const balance = (config && config.balance) || {};
  const baseChance = Number.isFinite(balance.randomEventBaseChance)
    ? balance.randomEventBaseChance
    : (Number.isFinite(balance.randomEventChance) ? balance.randomEventChance : 0.35);
  if (!rng || typeof rng.chance !== 'function' || !rng.chance(baseChance)) {
    return { eventId: null, options: [] };
  }
  const { random } = getAllEvents(config);
  if (random.length === 0) return { eventId: null, options: [] };
  const totalWeight = random.reduce((s, e) => s + (Number(e.weight) || 0), 0);
  if (totalWeight <= 0) return { eventId: null, options: [] };
  let r = rng.next() * totalWeight;
  let chosen = random[random.length - 1];
  for (const e of random) {
    r -= (Number(e.weight) || 0);
    if (r < 0) { chosen = e; break; }
  }
  return {
    eventId: chosen.id,
    options: (chosen.options || []).map((o) => ({ id: o.id, label: o.label })),
  };
}

/**
 * 返回本回合应触发的固定事件 id 数组（已结算过的不重复）。
 * @param {object} state
 * @param {object} config
 * @returns {string[]}
 */
export function checkFixedEvents(state, config) {
  const { fixed } = getAllEvents(config);
  const result = [];
  const history = Array.isArray(state.eventHistory) ? state.eventHistory : [];
  for (const e of fixed) {
    const trigger = e.trigger || {};
    if (trigger.type === 'turn'
      && trigger.value === state.turn
      && !history.includes(e.id)) {
      result.push(e.id);
    }
  }
  return result;
}

/**
 * 结算一个事件选项（应用 effects、写 eventHistory、写 log）。
 * @param {object} state
 * @param {string} eventId
 * @param {string} choiceId
 * @param {object} config
 * @param {object} rng
 * @returns {{ ok: boolean, result?: object, message?: string, reason?: string }}
 */
export function resolveEvent(state, eventId, choiceId, config, rng) {
  const ev = findEvent(config, eventId);
  if (!ev) return { ok: false, reason: 'unknown_event' };
  const option = (ev.options || []).find((o) => o.id === choiceId);
  if (!option) return { ok: false, reason: 'invalid_choice' };
  applyAttributeEffects(state, option.effects || {});
  if (!Array.isArray(state.eventHistory)) state.eventHistory = [];
  state.eventHistory.push(eventId);
  const text = option.resultText || '';
  state.log.push(`事件【${ev.name}】选择「${option.label}」：${text}`);
  return {
    ok: true,
    result: { eventId, choiceId, effects: option.effects || {} },
    message: text,
  };
}
