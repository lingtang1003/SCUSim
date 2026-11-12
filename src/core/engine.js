/**
 * 核心引擎（负责人 A）。编排 state / economy / academy / eventManager / ending。
 *
 * 所有函数就地修改传入的 state，并返回统一结果对象：
 *   成功 { ok:true, state?, data?, message? }
 *   失败 { ok:false, reason:string, data? }
 *
 * 除 newGame 外不新建 GameState；UI 绝不直接改 state。
 *
 * ── W1→W3 能力（见 docs/CONTRACT.md §2.4 / §4.5）──────────────
 *  - W1：三档加成、健康<3 行动白名单（D-03）、健康<5 学习惩罚（配置驱动）、
 *        待处理事件阻断（§11.1#9）、月初结算/负债/期末接线、结算后 clampAttrs。
 *  - W2：`drawTagCandidates`（随机刷 6）、`newGame` 应用标签修正、`buildViewModel`、
 *        事件队列（固定 > 负债 > 随机，同刻至多 1 个）。
 *  - W3：结局条件引擎（all/any/7 类）+ 主/副结局 + 优先级方向（D-02）。
 *  - B 的 v2 规则函数（settleMonthly/checkDebt/runFinalExam/gradePoint/checkWarning/
 *    rollEvent/buildPending）已合并，本文件直接调用；过渡适配层已删除。
 */

import { createGameState, clampAttrs, pushHistory, pushLog, isValidName } from './state.js';
import * as economy from './economy.js';
import * as academy from './academy.js';
import * as eventManager from '../events/eventManager.js';
import { judgeEnding, evaluateEnding } from './ending.js';

const MAX_TURN_DEFAULT = 40;
const AP_DEFAULT = 4;
const MONTHS_PER_SEMESTER_DEFAULT = 5;
const HEALTH_RESTRICT_DEFAULT = 3;
/** 健康 < 阈值时仍可执行的行动（D-03：锻炼 + 休息） */
const LOW_HEALTH_ALLOWED = ['exercise', 'rest'];
const TAG_CANDIDATE_COUNT = 6;

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export const ENGINE_DEFAULTS = {
  MAX_TURN_DEFAULT,
  AP_DEFAULT,
  MONTHS_PER_SEMESTER_DEFAULT,
  HEALTH_RESTRICT_DEFAULT,
  TAG_CANDIDATE_COUNT,
};

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

// ═══════════════ 规则辅助 ═══════════════

/**
 * 三档加成（D-04）：取已命中的最高档对应加成。
 * 支持两种配置写法：
 *   threeTierBonus: { thresholds:[10,20], bonus:{ low:0, mid:1, high:2 }, tiers:['low','mid','high'] }
 *   threeTierBonus: { thresholds:[10,20], bonuses:[1,2] }
 * @param {number} value 行动前的属性值
 * @param {object} balance
 * @returns {number}
 */
function tierBonus(value, balance) {
  const t = (balance && (balance.threeTierBonus || balance.tierBonus)) || null;
  if (!t) return 0;
  const thresholds = Array.isArray(t.thresholds) ? t.thresholds : [];
  let hit = -1;
  for (let i = 0; i < thresholds.length; i += 1) {
    if (Number(value) >= Number(thresholds[i])) hit = i;
  }
  if (hit < 0) return 0;
  if (Array.isArray(t.bonuses)) return num(t.bonuses[hit], 0);
  if (t.bonus && typeof t.bonus === 'object') {
    const tiers = Array.isArray(t.tiers) && t.tiers.length
      ? t.tiers
      : ['low', 'mid', 'high'];
    const key = tiers[Math.min(hit + 1, tiers.length - 1)];
    return num(t.bonus[key], 0);
  }
  return 0;
}

/** 当前配置下的档位信息（供 buildViewModel / UI 提示） */
function tierInfo(balance) {
  const t = (balance && (balance.threeTierBonus || balance.tierBonus)) || null;
  if (!t || !Array.isArray(t.thresholds)) return null;
  const thresholds = t.thresholds.map((x) => Number(x));
  const tiers = Array.isArray(t.tiers) ? t.tiers : [];
  const bonuses = [];
  for (let i = 0; i < thresholds.length; i += 1) {
    if (Array.isArray(t.bonuses)) bonuses.push(num(t.bonuses[i], 0));
    else if (t.bonus && typeof t.bonus === 'object') {
      const key = tiers.length ? tiers[Math.min(i + 1, tiers.length - 1)] : ['low', 'mid', 'high'][Math.min(i + 1, 2)];
      bonuses.push(num(t.bonus[key], 0));
    } else bonuses.push(0);
  }
  return { thresholds, bonuses };
}

/** 三标签修正叠加（SRS 1.4：叠加后属性不得低于 0） */
function applyTagModifiers(state, config) {
  const list = (config && config.tags && Array.isArray(config.tags.list))
    ? config.tags.list
    : [];
  const attrs = state.player.attributes;
  const mods = {};
  for (const id of state.player.tags || []) {
    const tag = list.find((t) => t.id === id);
    if (!tag || !tag.modifiers) continue;
    const m = (tag.modifiers.attributes && typeof tag.modifiers.attributes === 'object')
      ? tag.modifiers.attributes
      : tag.modifiers;
    for (const key of Object.keys(m)) {
      if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
      const d = Number(m[key]);
      if (Number.isFinite(d)) mods[key] = (mods[key] || 0) + d;
    }
  }
  for (const key of Object.keys(mods)) attrs[key] += mods[key];
  // 叠加后不得低于 0（money 允许为负）
  for (const key of Object.keys(attrs)) {
    if (key !== 'money' && attrs[key] < 0) attrs[key] = 0;
  }
  return mods;
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

/** 期末考试（4 门 + 绩点 + 警告 + 学习计数重置）：返回给 UI 的 settlement。 */
function finishExam(state, config, rng, semester) {
  const exam = (typeof academy.runFinalExam === 'function')
    ? academy.runFinalExam(state, config, rng)
    : { ok: false, subjects: [], semesterGpa: 0, totalGpa: 0, failedThisSemester: 0 };
  if (typeof academy.checkWarning === 'function') academy.checkWarning(state, config);
  if (state.academics.studyActions > 0) {
    state.academics.studyActionsBySemester = Number(state.academics.studyActions) || 0;
  }
  state.academics.studyActions = 0;
  const settlement = {
    semester,
    turn: state.turn,
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

/** 组装待处理事件（B 的 buildPending 会带上 enabled/reason）。 */
function buildPendingEvent(ev, state, config) {
  const pending = (typeof eventManager.buildPending === 'function')
    ? eventManager.buildPending(ev, state, config)
    : { eventId: ev.id, options: (ev.options || []).map((o) => ({ id: o.id, label: o.label })), resolved: false };
  if (!Array.isArray(pending.options)) pending.options = [];
  pending.createdTurn = state.turn;
  return pending;
}

/** 进入某回合：固定事件 > 负债事件 > 随机事件，同刻至多一个 pendingEvent（D-10）。 */
function enterTurn(state, config, rng, priorityEventId) {
  if (state.pendingEvent && state.pendingEvent.eventId) return;
  const fixedIds = (typeof eventManager.checkFixedEvents === 'function')
    ? eventManager.checkFixedEvents(state, config)
    : [];
  let eventId = (Array.isArray(fixedIds) && fixedIds[0]) || priorityEventId || null;
  if (!eventId) {
    const roll = (typeof eventManager.rollEvent === 'function')
      ? eventManager.rollEvent(state, config, rng)
      : { eventId: null };
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
 * 随机抽取 6 个候选标签（W2）。同一 rng 状态 → 同一批，保证可复现。
 * @param {object} config
 * @param {object} rng
 * @param {number} [count]
 * @returns {string[]}
 */
export function drawTagCandidates(config, rng, count = TAG_CANDIDATE_COUNT) {
  const pool = ((config && config.tags && Array.isArray(config.tags.list))
    ? config.tags.list
    : []).map((t) => t.id);
  const n = Math.max(0, Math.min(count, pool.length));
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, n);
}

/**
 * 给表现层的只读视图（W2）。UI 仍只读 state；这里把可用性/档位/flags 一次性算好。
 * @param {object} state
 * @param {object} config
 * @returns {object}
 */
export function buildViewModel(state, config) {
  const balance = getBalance(config);
  const availability = {};
  const actions = getActions(config).map((a) => {
    const av = actionAvailability(state, a.id, config);
    availability[a.id] = av.ok ? { ok: true } : { ok: false, reason: av.reason };
    return {
      id: a.id,
      name: a.name || a.id,
      cost: a.cost ?? 0,
      enabled: av.ok,
      reason: av.reason || '',
    };
  });
  return {
    availability,
    actions,
    tierInfo: tierInfo(balance),
    flags: Object.assign({}, (state.player && state.player.flags) || {}),
    monthly: null,
    debtThreshold: num(balance.debtThreshold, -3000),
    seed: state.seed,
  };
}

/**
 * 新建一局游戏。
 * @param {object} options { name, gender, collegeId, attributes, tags, appearance?, seed? }
 * @param {object} config loadConfig 的结果
 * @param {object} rng createRng(seed)
 * @returns {{ ok: boolean, state?: object, message?: string, reason?: string }}
 */
export function newGame(options, config, rng) {
  if (!options || typeof options !== 'object') return { ok: false, reason: 'options' };
  const balance = getBalance(config);

  // D-17：姓名只允许汉字/英文字母（1–12 字），数字与符号一律拒绝
  if (!isValidName(options.name)) return { ok: false, reason: 'name' };

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

  // W2：应用三标签修正（叠加、下限 0）
  const tagMods = applyTagModifiers(state, config);
  if (Object.keys(tagMods).length) {
    pushHistory(state, { type: 'tags', text: '标签修正', modifiers: tagMods }, config);
  }

  if (perPoint > 0) {
    state.player.attributes.money = (Number(options.attributes.money) || 0) * perPoint;
    pushHistory(state, { type: 'wallet', text: `初始资金 ${state.player.attributes.money}` }, config);
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

  // B 的规则入口：应用 effects（含 money/flags/club）并记录 log/history
  if (typeof economy.applyActionEconomy === 'function') {
    economy.applyActionEconomy(state, action, config, rng);
  }

  // D-04：三档加成只作用于 mainAttr，按行动前属性值判档
  if (mainAttr && typeof attrs[mainAttr] === 'number') {
    const bonus = tierBonus(mainBefore, getBalance(config));
    if (bonus > 0) attrs[mainAttr] += bonus;
  }
  // D-03：低健康学习惩罚
  applyStudyPenalty(state, action, config, rng, healthBefore);

  if (actionId === 'study') state.academics.studyActions = (Number(state.academics.studyActions) || 0) + 1;

  // D-18：标记本回合做过「学识 / 健康」类行动，advance 时据此重置连续空窗计数
  const idleCfg = getBalance(config).idleDecay;
  if (idleCfg) {
    if (!state.__turnFlags || typeof state.__turnFlags !== 'object') state.__turnFlags = {};
    if (idleCfg.knowledge && Array.isArray(idleCfg.knowledge.actions)
      && idleCfg.knowledge.actions.indexOf(actionId) >= 0) {
      state.__turnFlags.knowledge = true;
    }
    if (idleCfg.health && Array.isArray(idleCfg.health.actions)
      && idleCfg.health.actions.indexOf(actionId) >= 0) {
      state.__turnFlags.health = true;
    }
  }

  clampAttrs(state, config);
  pushLog(state, `行动：${action.name || actionId}`, config);
  pushHistory(state, { type: 'action', actionId, text: `行动：${action.name || actionId}` }, config);
  state.rngState = rng.getState();
  return { ok: true, state, message: `执行了「${action.name || actionId}」` };
}

/**
 * D-18：连续 N 周没有对应行动 → 扣属性（配置见 balance.idleDecay）。
 * - knowledge：本周没有任何 `knowledge.actions`（默认 study）→ 计数 +1
 * - health：本周没有任何 `health.actions`（默认 exercise/rest）→ 计数 +1
 * - 计数每到 `everyTurns` 的整数倍扣一次 amount，属性下限 0
 * - `resetPerYear` 为真时，每学年（monthsPerSemester×2 回合）重新计数
 */
function applyIdleDecay(state, config) {
  const balance = getBalance(config);
  const cfg = balance.idleDecay;
  if (!cfg) return;
  if (!state.player.idle || typeof state.player.idle !== 'object') {
    state.player.idle = { knowledge: 0, health: 0 };
  }
  const monthsPerSemester = num(balance.monthsPerSemester, MONTHS_PER_SEMESTER_DEFAULT);
  const monthsPerYear = monthsPerSemester * 2;
  const year = Math.max(1, Math.ceil(state.turn / monthsPerYear));
  if (cfg.resetPerYear && state.player.idleYear !== year) {
    state.player.idleYear = year;
    state.player.idle = { knowledge: 0, health: 0 };
  }
  const flags = (state.__turnFlags && typeof state.__turnFlags === 'object') ? state.__turnFlags : {};
  const every = Math.max(1, num(cfg.everyTurns, 4));
  const LABEL = { knowledge: '学识', health: '健康' };
  const WHY = { knowledge: '学习', health: '锻炼/休息' };
  for (const attr of ['knowledge', 'health']) {
    const rule = cfg[attr];
    if (!rule) continue;
    const amount = num(rule.amount, 0);
    if (amount <= 0) continue;
    if (flags[attr]) {
      state.player.idle[attr] = 0;
      continue;
    }
    const n = (Number(state.player.idle[attr]) || 0) + 1;
    state.player.idle[attr] = n;
    if (n % every !== 0) continue;
    const attrs = state.player.attributes;
    const before = Number(attrs[attr]) || 0;
    const after = Math.max(0, before - amount);
    attrs[attr] = after;
    const applied = before - after;
    pushLog(state, `连续 ${every} 周没有${WHY[attr]}：${LABEL[attr]} −${applied}`, config);
    pushHistory(state, {
      type: 'decay',
      attribute: attr,
      delta: -applied,
      text: `${LABEL[attr]} −${applied}（连续 ${every} 周未安排${WHY[attr]}）`,
    }, config);
  }
  state.__turnFlags = {};
}

/**
 * 推进一个回合（就地改 state）。
 * 顺序（D-10）：回合+1/AP 重置 → 月初结算 → 连续空窗扣减 → 负债判定 → 期末成绩/绩点/警告 →
 *              学期学习计数重置 → 固定/负债/随机事件 → 终局结局判定。
 * @returns {{ ok, state, monthly?, settlement?, pendingEvent?, endingId?, endingSubs?, message?, reason? }}
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

  // 月初收支结算（SRS 3.3.1）
  const monthly = (typeof economy.settleMonthly === 'function')
    ? economy.settleMonthly(state, config)
    : { ok: true, income: 0, expense: 0, net: 0 };
  if (monthly && Number(monthly.net) !== 0) {
    pushLog(state, `月度收支：+${monthly.income} / −${monthly.expense}（净 ${monthly.net > 0 ? '+' : ''}${monthly.net}）`, config);
  }

  // D-18：连续空窗扣减（学识 / 健康）
  applyIdleDecay(state, config);

  const semester = Math.ceil(state.turn / monthsPerSemester);

  // 负债判定（SRS 3.3.3）：触发则作为本回合优先事件
  const debt = (typeof economy.checkDebt === 'function')
    ? economy.checkDebt(state, config)
    : { triggered: false, eventId: null };
  if (debt && debt.triggered) {
    pushHistory(state, { type: 'debt', text: `负债触发：金钱 ${state.player.attributes.money}` }, config);
  }

  // 上一回合遗留的待考（UI 未结算事件就推进）：先补算，避免成绩被吞
  let settlement = null;
  if (state.academics.pendingExam && state.academics.pendingExam.turn < state.turn) {
    const stale = state.academics.pendingExam;
    settlement = finishExam(state, config, rng, stale.semester);
    delete state.academics.pendingExam;
  }

  // 事件（固定 > 负债 > 随机）；终局回合不再触发事件
  const isFinalTurn = state.turn >= maxTurn;
  if (isFinalTurn) {
    state.pendingEvent = null;
  } else {
    enterTurn(state, config, rng, debt && debt.triggered ? debt.eventId : null);
  }

  // 学期考试：先弹「期末考试周」事件（全力复习 / 佛系应考），成绩延后到事件结算后
  const isExamTurn = examTurns.indexOf(state.turn) >= 0;
  if (isExamTurn) {
    if (!isFinalTurn && state.pendingEvent && state.pendingEvent.eventId) {
      state.academics.pendingExam = { semester, turn: state.turn };
      pushLog(state, `学期 ${semester} 期末考试周：先做复习安排`, config);
    } else {
      settlement = finishExam(state, config, rng, semester);
    }
  }

  // 终局：主结局 + 副结局（SRS 6.1）
  let endingId = null;
  let endingSubs = [];
  if (isFinalTurn) {
    if (state.academics.pendingExam) delete state.academics.pendingExam;
    const judged = judgeEnding(state, config);
    endingId = judged.main;
    endingSubs = judged.subs || [];
    state.endingId = endingId;
    pushHistory(state, { type: 'ending', text: `结局：${endingId || '无'}` }, config);
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
    endingSubs,
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
  if (typeof eventManager.resolveEvent !== 'function') {
    return { ok: false, state, reason: 'event_manager_unavailable' };
  }
  const res = eventManager.resolveEvent(state, eventId, choiceId, config, rng);
  if (!res.ok) {
    return { ok: false, state, reason: res.reason, message: res.message };
  }
  state.pendingEvent = null;
  clampAttrs(state, config);
  pushHistory(state, { type: 'choice', eventId, text: res.message || `事件选择：${choiceId}` }, config);

  // 期末考试周事件已结算：此刻再算成绩，让「全力复习 / 佛系应考」真正影响本学期结果
  let settlement = null;
  const pendingExam = state.academics && state.academics.pendingExam;
  if (pendingExam && pendingExam.turn === state.turn) {
    settlement = finishExam(state, config, rng, pendingExam.semester);
    delete state.academics.pendingExam;
    clampAttrs(state, config);
  }

  state.rngState = rng.getState();
  return {
    ok: true, state, result: res.result, message: res.message,
    settlement, endingId: null, endingSubs: [],
  };
}

/**
 * 按优先级判定当前应命中结局（不修改 state）。
 * @returns {{ ok: boolean, endingId: string|null, subEndings: string[] }}
 */
export function getEnding(state, config) {
  const judged = judgeEnding(state, config);
  return { ok: true, endingId: judged.main, subEndings: judged.subs };
}

export { evaluateEnding };
