/**
 * 核心引擎（负责人 A）。编排 state / economy / academy / eventManager / ending。
 *
 * 所有函数就地修改传入的 state，并返回统一结果对象：
 *   成功 { ok:true, state?, data?, message? }
 *   失败 { ok:false, reason:string, data? }
 *
 * 除 newGame 外不新建 GameState；UI 绝不直接改 state。
 *
 * ── W1 变更（见 docs/CONTRACT.md §2.4）────────────────────────────
 *  1. doAction：三档加成、健康<3 行动白名单（D-03）、健康<5 学习惩罚（配置驱动）、
 *     待处理事件阻断（设计 §11.1#9）、结算后 clampAttrs。
 *  2. advance：回合+1 → 月初结算 → 负债判定 → 期末（成绩/绩点/警告）→ 学期学习计数重置
 *     → 事件（固定 > 负债 > 随机）→ 终局判定；返回 monthly / settlement 供 UI 展示。
 *  3. newGame：按 balance.walletPerMoneyPoint 把「金钱点数」兑换为货币（D-01）。
 *  4. 过渡适配层：B 的 v2 规则函数（settleMonthly/checkDebt/runFinalExam/gradePoint/
 *     checkWarning）尚未合并时自动降级到现有实现，保证 main 与回归先绿；
 *     B 合并后**删除本文件 `过渡适配层` 整段**（见 CONTRACT §9 激活开关表）。
 */

import { createGameState, clampAttrs, pushHistory, pushLog } from './state.js';
import * as economy from './economy.js';
import * as academy from './academy.js';
import * as eventManager from '../events/eventManager.js';
import { evaluateEnding } from './ending.js';

const MAX_TURN_DEFAULT = 40;
const AP_DEFAULT = 4;
const MONTHS_PER_SEMESTER_DEFAULT = 5;
const HEALTH_RESTRICT_DEFAULT = 3;
/** 健康 < 阈值时仍可执行的行动（D-03：锻炼 + 休息） */
const LOW_HEALTH_ALLOWED = ['exercise', 'rest'];

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

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

function hasFn(mod, name) {
  return !!mod && typeof mod[name] === 'function';
}

// ═══════════════ 过渡适配层（TODO(B-W1/W2)：B 合并 v2 规则后整段删除） ═══════════════

/** 月度结算：优先 B 的 settleMonthly(state, config)，否则降级为旧实现。 */
function settleMonth(state, config) {
  if (hasFn(economy, 'settleMonthly')) return economy.settleMonthly(state, config);
  if (hasFn(economy, 'monthlyEconomy')) economy.monthlyEconomy(state, config);
  const b = getBalance(config);
  const income = num(b.monthlyIncome, 0);
  const expense = num(b.monthlyExpense, 0);
  return { ok: true, income, expense, net: income - expense, legacy: true };
}

/** 负债判定：优先 B 的 checkDebt，否则视为未触发。 */
function debtCheck(state, config) {
  if (hasFn(economy, 'checkDebt')) return economy.checkDebt(state, config);
  return { triggered: false, eventId: null, legacy: true };
}

/** 绩点换算：优先 B 的 gradePoint，否则查 gpaTable / 按 score/25 估算。 */
function gradePoint(score, config) {
  if (hasFn(academy, 'gradePoint')) return academy.gradePoint(score, config);
  const table = getBalance(config).gpaTable;
  if (Array.isArray(table)) {
    for (const row of table) {
      if (Number.isFinite(row && row.min) && score >= row.min) return Number(row.gpa) || 0;
    }
  }
  return round2(Math.min(4, Math.max(0, Number(score) / 25)));
}

/**
 * 期末考试：优先 B 的 runFinalExam（4 门科目、写 semesterRecords），
 * 否则降级为 takeExam 的单科成绩并自行补齐学期记录。
 */
function runExam(state, config, rng) {
  if (hasFn(academy, 'runFinalExam')) return academy.runFinalExam(state, config, rng);
  if (!hasFn(academy, 'takeExam')) {
    return { ok: false, subjects: [], semesterGpa: 0, totalGpa: state.academics.totalGpa, failedThisSemester: 0 };
  }
  const r = academy.takeExam(state, config, rng);
  const gpa = gradePoint(r.score, config);
  state.academics.semesterScores.push(r.score);
  const months = num(getBalance(config).monthsPerSemester, MONTHS_PER_SEMESTER_DEFAULT);
  const record = {
    semester: Math.ceil(state.turn / months),
    turn: state.turn,
    subjects: [{ name: '综合', score: r.score, passed: !!r.passed, gpa }],
    gpa,
    failed: r.passed ? 0 : 1,
  };
  state.academics.semesterRecords.push(record);
  const gpas = state.academics.semesterRecords.map((x) => Number(x.gpa) || 0);
  state.academics.totalGpa = round2(gpas.reduce((a, b) => a + b, 0) / gpas.length);
  return {
    ok: true,
    subjects: record.subjects,
    semesterGpa: gpa,
    totalGpa: state.academics.totalGpa,
    failedThisSemester: record.failed,
    legacy: true,
  };
}

/** 挂科警告：沿用 B 的实现（B 在 W1 改为读 config 阈值）。 */
function warningCheck(state, config) {
  if (!hasFn(academy, 'checkWarning')) return false;
  return academy.checkWarning(state, config);
}

/** 随机事件抽取：兼容 B 的 rollEvent（v2）与 rollRandomEvent（旧名）。 */
function rollRandom(state, config, rng) {
  if (hasFn(eventManager, 'rollEvent')) return eventManager.rollEvent(state, config, rng);
  if (hasFn(eventManager, 'rollRandomEvent')) return eventManager.rollRandomEvent(state, config, rng);
  return { eventId: null };
}

/** 组装待处理事件：兼容 B 的 buildPending(event, state, config) 与旧签名 (event)。 */
function buildPendingEvent(ev, state, config) {
  const pending = hasFn(eventManager, 'buildPending')
    ? eventManager.buildPending(ev, state, config)
    : { eventId: ev.id, options: (ev.options || []).map((o) => ({ id: o.id, label: o.label })), resolved: false };
  if (!Array.isArray(pending.options)) pending.options = [];
  pending.createdTurn = state.turn;
  return pending;
}

// ═══════════════ 规则辅助 ═══════════════

/** 三档加成：< 第 1 档阈值 +0；命中第 i 档给 bonuses[i]；取已命中的最高档（D-04）。 */
function tierBonus(value, balance) {
  const t = balance && balance.tierBonus;
  if (!t || !Array.isArray(t.thresholds) || !Array.isArray(t.bonuses)) return 0;
  let bonus = 0;
  for (let i = 0; i < t.thresholds.length; i += 1) {
    if (Number(value) >= Number(t.thresholds[i])) bonus = num(t.bonuses[i], bonus);
  }
  return bonus;
}

/** 健康 < healthStudyPenaltyBelow 时学习不增长（并有概率倒扣），D-03。 */
function applyStudyPenalty(state, action, config, rng, healthBefore) {
  const balance = getBalance(config);
  const penalty = balance.studyPenalty;
  if (!penalty || action.id !== 'study') return;
  if (healthBefore >= num(balance.healthStudyPenaltyBelow, 5)) return;
  const attrs = state.player.attributes;
  const gain = Number(action.effects && action.effects.attributes && action.effects.attributes.knowledge) || 0;
  if (gain > 0) attrs.knowledge -= gain;
  const dropChance = num(penalty.dropChance, 0);
  if (dropChance > 0 && rng && typeof rng.chance === 'function' && rng.chance(dropChance)) {
    attrs.knowledge -= num(penalty.dropAmount, 1);
  }
}

/** 进入某回合：固定事件 > 负债事件 > 随机事件，同刻至多一个 pendingEvent（D-10）。 */
function enterTurn(state, config, rng, priorityEventId) {
  if (state.pendingEvent && state.pendingEvent.eventId) return;
  const fixedIds = hasFn(eventManager, 'checkFixedEvents')
    ? eventManager.checkFixedEvents(state, config)
    : [];
  let eventId = (Array.isArray(fixedIds) && fixedIds[0]) || priorityEventId || null;
  if (!eventId) {
    const roll = rollRandom(state, config, rng);
    eventId = (roll && roll.eventId) || null;
  }
  if (!eventId) return;
  const ev = findEvent(config, eventId);
  if (!ev) return;
  state.pendingEvent = buildPendingEvent(ev, state, config);
  pushLog(state, `触发事件：${ev.name || ev.id}`, config);
  pushHistory(state, { type: 'event', eventId: ev.id, text: `触发事件：${ev.name || ev.id}` }, config);
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

  // D-01：把「金钱点数」按 walletPerMoneyPoint 兑换为初始资金；配置缺席则保持点数语义
  const perPoint = num(balance.walletPerMoneyPoint, 0);
  if (perPoint > 0) {
    state.player.attributes.money = (Number(attrs.money) || 0) * perPoint;
  }

  state.seed = Number.isFinite(options.seed) ? options.seed : rng.getState();
  clampAttrs(state, config);
  pushHistory(state, {
    type: 'creation',
    text: `角色创建：${state.player.name} · ${state.player.collegeId}`,
  }, config);
  pushLog(state, `角色创建成功：${state.player.name}`, config);

  enterTurn(state, config, rng); // 回合 1 的固定/随机事件（社团招新）
  state.rngState = rng.getState();
  return { ok: true, state, message: '新游戏已创建' };
}

/**
 * 判断某行动当前是否可用（不修改 state）。
 * 顺序：存在性 → 行动点 → 健康白名单（D-03）→ 行动自身健康要求。
 * @returns {{ ok: boolean, reason?: string }}
 */
export function actionAvailability(state, actionId, config) {
  const action = findAction(config, actionId);
  if (!action) return { ok: false, reason: 'unknown_action' };
  if (state.actionPoints < (action.cost ?? 0)) return { ok: false, reason: 'AP' };

  const health = Number(state.player.attributes.health) || 0;
  const restrict = num(getBalance(config).healthRestrictThreshold, HEALTH_RESTRICT_DEFAULT);
  if (health < restrict && LOW_HEALTH_ALLOWED.indexOf(action.id) < 0) {
    return { ok: false, reason: 'health' };
  }
  if (health < (action.requiresHealth ?? 0)) return { ok: false, reason: 'health' };
  return { ok: true };
}

/**
 * 执行一个行动（就地改 state：扣 AP、应用 effects + 三档加成 + 低健康惩罚）。
 * @returns {{ ok: boolean, state: object, message?: string, reason?: string }}
 */
export function doAction(state, actionId, config, rng) {
  const avail = actionAvailability(state, actionId, config);
  if (!avail.ok) {
    return { ok: false, state, reason: avail.reason, message: `无法执行「${actionId}」：${avail.reason}` };
  }
  // 设计 §11.1#9：存在待处理事件时必须先结算事件
  if (state.pendingEvent && state.pendingEvent.eventId) {
    return { ok: false, state, reason: 'pending_event', message: '请先处理当前事件' };
  }

  const action = findAction(config, actionId);
  const attrs = state.player.attributes;
  const healthBefore = Number(attrs.health) || 0;
  const mainAttr = action.mainAttr;
  const mainBefore = mainAttr ? Number(attrs[mainAttr]) || 0 : 0;

  state.actionPoints -= (action.cost ?? 0);

  if (hasFn(economy, 'applyActionEconomy')) economy.applyActionEconomy(state, action, config, rng);

  // D-04：三档加成只作用于 mainAttr，且按行动前的属性值判定
  if (mainAttr && typeof attrs[mainAttr] === 'number') {
    attrs[mainAttr] += tierBonus(mainBefore, getBalance(config));
  }
  // D-03：低健康学习惩罚
  applyStudyPenalty(state, action, config, rng, healthBefore);

  if (actionId === 'study') state.academics.studyActions = (Number(state.academics.studyActions) || 0) + 1;

  clampAttrs(state, config);
  pushLog(state, `行动：${action.name || actionId}`, config);
  pushHistory(state, { type: 'action', actionId, text: `行动：${action.name || actionId}` }, config);
  state.rngState = rng.getState();
  return { ok: true, state, message: `执行了「${action.name || actionId}」` };
}

/**
 * 期末考试 + 绩点 + 学业警告 + 学期学习计数重置，返回本次结算数据。
 * advance() 在期末周调用；若期末周同时有事件，则推迟到事件结算之后调用。
 */
function runExamSettlement(state, config, rng, turnOverride) {
  const balance = getBalance(config);
  const monthsPerSemester = num(balance.monthsPerSemester, MONTHS_PER_SEMESTER_DEFAULT);
  const examTurn = Number.isFinite(turnOverride) ? turnOverride : state.turn;
  const semester = Math.ceil(examTurn / monthsPerSemester);
  const exam = runExam(state, config, rng);
  warningCheck(state, config);
  state.academics.studyActionsBySemester = Number(state.academics.studyActions) || 0;
  state.academics.studyActions = 0;
  const settlement = {
    semester,
    turn: examTurn,
    subjects: (exam && exam.subjects) || [],
    semesterGpa: exam && exam.semesterGpa != null ? exam.semesterGpa : null,
    totalGpa: state.academics.totalGpa,
    failedCourses: state.academics.failedCourses,
    failedThisSemester: (exam && exam.failedThisSemester) || 0,
    warning: !!state.academics.warning,
  };
  pushLog(state, `学期 ${semester} 结算：总绩点 ${state.academics.totalGpa}，累计挂科 ${state.academics.failedCourses} 门`, config);
  pushHistory(state, { type: 'exam', text: `学期 ${semester} 期末：绩点 ${state.academics.totalGpa}` }, config);
  return settlement;
}

/**
 * 推进一个回合（就地改 state）。
 * 顺序（D-10）：回合+1/AP 重置 → 月初结算 → 负债判定 → 固定/负债/随机事件 →
 *              期末成绩/绩点/警告 → 学期学习计数重置 → 终局结局判定。
 * 期末周若同时有事件，考试会推迟到事件结算之后（pendingExam）。
 * @returns {{ ok, state, monthly?, settlement?, pendingEvent?, endingId?, message?, reason? }}
 */
export function advance(state, config, rng) {
  if (state.endingId) return { ok: false, reason: 'ended', state };
  const balance = getBalance(config);
  const maxTurn = num(balance.turns, MAX_TURN_DEFAULT);
  const apPerTurn = num(balance.actionPointsPerTurn, AP_DEFAULT);
  const monthsPerSemester = num(balance.monthsPerSemester, MONTHS_PER_SEMESTER_DEFAULT);
  const examTurns = Array.isArray(balance.examTurns) ? balance.examTurns : [];

  // 进入新回合
  state.turn += 1;
  state.actionPoints = apPerTurn;

  // 上一回合期末周的考试若因事件没结算掉，这里补算（按当时的回合推学期）
  if (state.pendingExam) {
    const pend = state.pendingExam;
    const pendTurn = pend && Number.isFinite(pend.turn) ? pend.turn : state.turn - 1;
    state.pendingExam = false;
    runExamSettlement(state, config, rng, pendTurn);
  }

  // 月初收支结算（SRS 3.3.1）
  const monthly = settleMonth(state, config);
  if (monthly && Number(monthly.net) !== 0) {
    pushLog(state, `月度收支：+${monthly.income} / −${monthly.expense}（净 ${monthly.net > 0 ? '+' : ''}${monthly.net}）`, config);
  }

  const semester = Math.ceil(state.turn / monthsPerSemester);

  // 负债判定（SRS 3.3.3）：触发则作为本回合优先事件
  const debt = debtCheck(state, config);
  if (debt && debt.triggered) {
    pushHistory(state, { type: 'debt', text: `负债触发：金钱 ${state.player.attributes.money}` }, config);
  }

  // 学期考试 / 绩点 / 警告
  // 期末周若同时触发了事件，先把考试挂起：等玩家选完「期末周」选项再考，
  // 这样选项加的知识/状态才真的影响成绩（否则结算会抢先弹出来）。
  let settlement = null;
  const isExamTurn = examTurns.indexOf(state.turn) >= 0;

  // 事件（固定 > 负债 > 随机，同刻至多一个）；终局回合不再触发事件
  const isFinalTurn = state.turn >= maxTurn;
  if (isFinalTurn) {
    state.pendingEvent = null;
  } else {
    enterTurn(state, config, rng, debt && debt.triggered ? debt.eventId : null);
  }

  if (isExamTurn) {
    if (state.pendingEvent) state.pendingExam = { turn: state.turn };
    else settlement = runExamSettlement(state, config, rng);
  }

  // 终局
  let endingId = null;
  if (state.turn >= maxTurn) {
    endingId = evaluateEnding(state, config);
    state.endingId = endingId;
    pushHistory(state, { type: 'ending', text: `结局：${endingId}` }, config);
  }

  clampAttrs(state, config);
  state.rngState = rng.getState();
  return {
    ok: true,
    state,
    monthly,
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
  if (!hasFn(eventManager, 'resolveEvent')) {
    return { ok: false, state, reason: 'event_manager_unavailable' };
  }
  const res = eventManager.resolveEvent(state, eventId, choiceId, config, rng);
  if (!res.ok) return { ok: false, state, reason: res.reason };
  state.pendingEvent = null;
  clampAttrs(state, config);
  pushHistory(state, { type: 'choice', eventId, text: res.message || `事件选择：${choiceId}` }, config);
  // 期末周被挂起的考试：选项效果已生效，现在结算
  let settlement = null;
  if (state.pendingExam) {
    state.pendingExam = false;
    settlement = runExamSettlement(state, config, rng);
  }
  state.rngState = rng.getState();
  return { ok: true, state, result: res.result, message: res.message, settlement };
}

/**
 * 按优先级判定当前应命中结局（不修改 state）。
 * @returns {{ ok: boolean, endingId: string|null }}
 */
export function getEnding(state, config) {
  return { ok: true, endingId: evaluateEnding(state, config) };
}

