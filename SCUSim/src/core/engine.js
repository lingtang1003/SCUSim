/**
 * 核心引擎（编排 state / rng / economy / academy / eventManager / ending）。
 *
 * 所有函数就地修改传入的 state，并返回统一结果对象：
 *   成功 { ok:true, state?, data?, message? }
 *   失败 { ok:false, reason:string, data? }
 *
 * 除 newGame 外不新建 GameState；UI 绝不直接改 state。
 */

import { createGameState } from './state.js';
import { applyActionEconomy, monthlyEconomy } from './economy.js';
import { takeExam, checkWarning } from './academy.js';
import { rollRandomEvent, checkFixedEvents, resolveEvent, buildPending } from '../events/eventManager.js';
import { evaluateEnding } from './ending.js';

const MAX_TURN_DEFAULT = 40;
const AP_DEFAULT = 4;

function getBalance(config) {
  return (config && config.balance) || {};
}

function getActions(config) {
  const actions = (config && config.actions && Array.isArray(config.actions.list))
    ? config.actions.list
    : [];
  return actions;
}

function findAction(config, actionId) {
  return getActions(config).find((a) => a.id === actionId) || null;
}

function findEvent(config, eventId) {
  const events = (config && config.events) || {};
  const fixed = Array.isArray(events.fixed) ? events.fixed : [];
  const random = Array.isArray(events.random) ? events.random : [];
  return fixed.find((e) => e.id === eventId)
    || random.find((e) => e.id === eventId)
    || null;
}

/** 进入某回合：优先固定事件，否则按基率抽随机事件（同刻至多一个 pendingEvent）。 */
function enterTurn(state, config, rng) {
  const fixedIds = checkFixedEvents(state, config);
  if (fixedIds.length > 0) {
    const ev = findEvent(config, fixedIds[0]);
    if (ev) state.pendingEvent = buildPending(ev);
    return;
  }
  const roll = rollRandomEvent(state, config, rng);
  if (roll.eventId) {
    const ev = findEvent(config, roll.eventId);
    if (ev) state.pendingEvent = buildPending(ev);
  }
}

/**
 * 新建一局游戏。
 * @param {object} options { name, gender, collegeId, attributes, tags, seed? }
 * @param {object} config loadConfig 的结果
 * @param {object} rng createRng(seed)
 * @returns {{ ok: boolean, state?: object, message?: string, reason?: string }}
 */
export function newGame(options, config, rng) {
  if (!options || typeof options !== 'object') return { ok: false, reason: 'options' };
  const balance = getBalance(config);

  // 属性四项之和严格 === attributePointTotal（默认 20）
  const attrs = options.attributes || {};
  const sum = (Number(attrs.knowledge) || 0)
    + (Number(attrs.social) || 0)
    + (Number(attrs.health) || 0)
    + (Number(attrs.money) || 0);
  const expectedTotal = Number.isFinite(balance.attributePointTotal)
    ? balance.attributePointTotal
    : 20;
  if (sum !== expectedTotal) return { ok: false, reason: 'attributes' };

  // 学院必须存在
  if (!options.collegeId) return { ok: false, reason: 'collegeId' };
  const colleges = (config && config.colleges && Array.isArray(config.colleges.list))
    ? config.colleges.list
    : [];
  if (!colleges.some((c) => c.id === options.collegeId)) {
    return { ok: false, reason: 'collegeId' };
  }

  // 标签严格 3 个且都存在
  if (!Array.isArray(options.tags) || options.tags.length !== 3) {
    return { ok: false, reason: 'tags' };
  }
  const tagIds = new Set(
    (config && config.tags && Array.isArray(config.tags.list))
      ? config.tags.list.map((t) => t.id)
      : []
  );
  for (const t of options.tags) {
    if (!tagIds.has(t)) return { ok: false, reason: 'tags' };
  }

  const state = createGameState(options);
  state.seed = Number.isFinite(options.seed) ? options.seed : rng.getState();
  enterTurn(state, config, rng); // 回合 1 的固定/随机事件（社团招新）
  state.rngState = rng.getState();
  return { ok: true, state, message: '新游戏已创建' };
}

/**
 * 判断某行动当前是否可用（不修改 state）。
 * @returns {{ ok: boolean, reason?: string }}
 */
export function actionAvailability(state, actionId, config) {
  const action = findAction(config, actionId);
  if (!action) return { ok: false, reason: 'unknown_action' };
  if (state.actionPoints < (action.cost ?? 0)) return { ok: false, reason: 'AP' };
  const health = (state.player.attributes.health) || 0;
  const requiresHealth = action.requiresHealth ?? 0;
  if (health < requiresHealth) return { ok: false, reason: 'health' };
  return { ok: true };
}

/**
 * 执行一个行动（就地改 state：扣 AP、应用 effects）。
 * @returns {{ ok: boolean, state: object, message?: string, reason?: string }}
 */
export function doAction(state, actionId, config, rng) {
  const avail = actionAvailability(state, actionId, config);
  if (!avail.ok) {
    return { ok: false, state, reason: avail.reason, message: `无法执行「${actionId}」：${avail.reason}` };
  }
  const action = findAction(config, actionId);
  state.actionPoints -= (action.cost ?? 0);
  applyActionEconomy(state, action, config, rng);
  if (actionId === 'study') state.academics.studyActions += 1;
  state.log.push(`行动：${action.name || actionId}`);
  state.rngState = rng.getState();
  return { ok: true, state, message: `执行了「${action.name || actionId}」` };
}

/**
 * 推进一个回合（就地改 state）：月度结算 + 学期考试 + 固定/随机事件 + 结局判定。
 * @returns {{ ok: boolean, state: object, settlement?: object, pendingEvent?: object, endingId?: string, message?: string, reason?: string }}
 */
export function advance(state, config, rng) {
  if (state.endingId) return { ok: false, reason: 'ended', state };
  const balance = getBalance(config);
  const maxTurn = Number.isFinite(balance.turns) ? balance.turns : MAX_TURN_DEFAULT;
  const apPerTurn = Number.isFinite(balance.actionPointsPerTurn)
    ? balance.actionPointsPerTurn
    : AP_DEFAULT;
  const examTurns = Array.isArray(balance.examTurns) ? balance.examTurns : [];

  // 月度结算
  monthlyEconomy(state, config);

  // 回合数 + 行动点重置
  state.turn += 1;
  state.actionPoints = apPerTurn;
  const semester = Math.ceil(state.turn / 5);

  // 学期考试
  let settlement = null;
  if (examTurns.includes(state.turn)) {
    const exam = takeExam(state, config, rng);
    state.academics.semesterScores.push(exam.score);
    checkWarning(state);
    settlement = {
      semester,
      turn: state.turn,
      score: exam.score,
      passed: exam.passed,
      failedCourses: state.academics.failedCourses,
      warning: state.academics.warning,
    };
  }

  // 固定/随机事件（同刻至多一个）
  enterTurn(state, config, rng);

  // 终局回合置 endingId
  let endingId = null;
  if (state.turn >= maxTurn) {
    endingId = evaluateEnding(state, config);
    state.endingId = endingId;
  }

  state.rngState = rng.getState();
  return {
    ok: true,
    state,
    settlement,
    pendingEvent: state.pendingEvent,
    endingId,
    message: `推进至第 ${state.turn} 回合（学期 ${semester}）`,
  };
}

/**
 * 结算当前待处理事件的一个选项（就地改 state）。
 * @returns {{ ok: boolean, state: object, result?: object, message?: string, reason?: string }}
 */
export function resolvePendingEvent(state, choiceId, config, rng) {
  if (!state.pendingEvent || !state.pendingEvent.eventId) {
    return { ok: false, state, reason: 'no_pending' };
  }
  const eventId = state.pendingEvent.eventId;
  const res = resolveEvent(state, eventId, choiceId, config, rng);
  if (!res.ok) return { ok: false, state, reason: res.reason };
  state.pendingEvent = null;
  state.rngState = rng.getState();
  return { ok: true, state, result: res.result, message: res.message };
}

/**
 * 按优先级判定当前应命中结局（不修改 state）。
 * @returns {{ ok: boolean, endingId: string|null }}
 */
export function getEnding(state, config) {
  return { ok: true, endingId: evaluateEnding(state, config) };
}
