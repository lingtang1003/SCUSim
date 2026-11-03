/**
 * 事件管理（B · 被 engine 调用）。
 *
 * 功能（任务书 W2/W3）：
 *  - computeWeight(event, state, config)：权重 = event.weight × Π(tag.eventWeights) × college.eventBias，
 *    且 termRange 外返回 0。
 *  - rollEvent(state, config, rng)：按 randomEventBaseChance 判定触发；对权重>0 的事件做一次轮盘赌。
 *  - availableOptions(event, state, config)：逐条判 requires，返回 [{id,label,enabled,reason}]。
 *  - buildPending(event, state, config)：把可用选项写进 pendingEvent.options。
 *  - resolveEvent：调 applyEffects 结算；前置不满足的选项返回 {ok:false, reason:'requirement'}。
 *
 * 兼容层：rollRandomEvent / buildPending(ev) 为 engine 既有调用保留。
 *
 * 注意：本模块严禁使用原生随机函数，随机一律通过 rng 入参。
 */

import { applyEffects, describeChanges } from '../core/effects.js';
import { runFinalExam } from '../core/academy.js';

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

function getTags(config) {
  return (config && config.tags && Array.isArray(config.tags.list)) ? config.tags.list : [];
}

function getColleges(config) {
  return (config && config.colleges && Array.isArray(config.colleges.list)) ? config.colleges.list : [];
}

function semesterOf(state) {
  return Math.ceil((state && state.turn) || 1 / 5);
}

/**
 * 剧情线保证触发：每局 40 回合内，竞赛 / 恋爱 / 保研 / 实习各至少触发一次，
 * 且保研、实习只安排在大四（回合 30 之后）。窗口回合且该线尚未触发 → 强制返回其起始事件。
 * 起始事件一旦被 resolve（无论选哪个选项）都会写入 player.flags.chain_<line>，防止重复触发。
 */
const STORYLINES = [
  { line: 'competition', start: 'ev_r16', window: [8, 13] },
  { line: 'romance', start: 'ev_r23', window: [2, 6] },
  { line: 'scholarship', start: 'ev_r35', window: [32, 36] },
  { line: 'intern', start: 'ev_r17', window: [33, 37] },
];

function storylineKey(line) { return `chain_${line}`; }

function nextStoryline(state, config) {
  if (!state || !state.player || typeof state.turn !== 'number') return null;
  const flags = state.player.flags || {};
  const turn = state.turn;
  for (const L of STORYLINES) {
    if (turn >= L.window[0] && turn <= L.window[1] && !flags[storylineKey(L.line)]) {
      return L.start;
    }
  }
  return null;
}

/**
 * 期末考试事件强制：第 5/10/15/20/25/30/35 回合必出现「期末考试周」事件。
 * 回合 40 为终局回合，引擎直接判定结局、不派发事件，故不安排期末。
 * 回合列表优先读 balance.exam.examTurns，缺省用固定七次期末。
 */
function examTurnEvent(state, config) {
  if (!state || typeof state.turn !== 'number') return null;
  const turns = (config && config.balance && config.balance.exam && Array.isArray(config.balance.exam.examTurns))
    ? config.balance.exam.examTurns
    : [5, 10, 15, 20, 25, 30, 35];
  if (turns.indexOf(state.turn) >= 0) return 'ev_r14';
  return null;
}

/**
 * 返回本回合应触发的固定事件 id 数组（已结算过的不重复）。
 * 仅处理 trigger.type === 'turn' 的固定事件；负债（type:'debt'）等由 engine 另行接入。
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
  // 期末考试事件强制：第 5/10/15/20/25/30/35/40 回合必出现「期末考试周」（最高优先）
  const exam = examTurnEvent(state, config);
  if (exam) return [exam];
  // 剧情线保证触发：窗口回合且该线未触发时，强制返回其起始事件（优先于固定/随机）
  const lineEvent = nextStoryline(state, config);
  if (lineEvent) {
    return [lineEvent].concat(result.filter((id) => id !== lineEvent));
  }
  return result;
}

/**
 * 计算事件权重：weight × 各玩家标签 eventWeights[event.id] 之积 × 学院 eventBias[event.id]。
 * turn 不在 termRange 内返回 0；任何系数缺失按 1；weight<=0 返回 0。
 * @param {object} event events.json 的条目
 * @param {object} state
 * @param {object} config
 * @returns {number}
 */
export function computeWeight(event, state, config) {
  if (!event) return 0;
  const tr = Array.isArray(event.termRange) ? event.termRange : [];
  if (tr.length >= 2) {
    const semester = semesterOf(state);
    if (semester < Number(tr[0]) || semester > Number(tr[1])) return 0;
  }
  let w = Number(event.weight) || 0;
  if (w <= 0) return 0;

  const playerTags = (state && state.player && Array.isArray(state.player.tags))
    ? state.player.tags
    : [];
  const tagDefs = getTags(config);
  for (const tagId of playerTags) {
    const tag = tagDefs.find((t) => t.id === tagId);
    const ew = tag && tag.eventWeights ? tag.eventWeights[event.id] : undefined;
    if (Number.isFinite(ew)) w *= ew;
  }

  const collegeId = state && state.player && state.player.collegeId;
  const college = getColleges(config).find((c) => c.id === collegeId);
  const eb = college && college.eventBias ? college.eventBias[event.id] : undefined;
  if (Number.isFinite(eb)) w *= eb;

  return w;
}

/**
 * 抽取一个随机事件：先按基率判定是否触发，再对权重>0 的事件做一次轮盘赌。
 * @param {object} state
 * @param {object} config
 * @param {object} rng
 * @returns {{ eventId: string|null, options: Array }}
 */
export function rollEvent(state, config, rng) {
  const balance = (config && config.balance) || {};
  const baseChance = Number.isFinite(balance.randomEventBaseChance)
    ? balance.randomEventBaseChance
    : (Number.isFinite(balance.randomEventChance) ? balance.randomEventChance : 0.35);
  if (!rng || typeof rng.chance !== 'function' || !rng.chance(baseChance)) {
    return { eventId: null, options: [] };
  }
  const { random } = getAllEvents(config);
  const weighted = random
    .map((e) => ({ e, w: computeWeight(e, state, config) }))
    .filter((x) => x.w > 0);
  if (weighted.length === 0) return { eventId: null, options: [] };
  // 去重：最近触发过的随机事件（state.__recentEvents）短间隔内不重复触发，
  // 避免「上一回合刚领完十佳歌手门票、这一回合又来同一事件」的情况。
  const recent = (state && Array.isArray(state.__recentEvents)) ? state.__recentEvents : [];
  const fresh = weighted.filter((x) => !recent.includes(x.e.id));
  // 防卡：只返回至少含一个可用选项的事件；前置 flag 未满足（全部选项被置灰）的事件跳过不触发。
  let pool = fresh.length > 0 ? fresh : weighted;
  while (pool.length > 0) {
    const totalWeight = pool.reduce((s, x) => s + x.w, 0);
    let r = rng.next() * totalWeight;
    let picked = pool[pool.length - 1].e;
    for (const x of pool) {
      r -= x.w;
      if (r < 0) { picked = x.e; break; }
    }
    const avail = availableOptions(picked, state, config);
    if (avail.some((a) => a.enabled)) {
      return {
        eventId: picked.id,
        options: (picked.options || []).map((o) => ({ id: o.id, label: o.label })),
      };
    }
    pool = pool.filter((x) => x.e !== picked);
  }
  return { eventId: null, options: [] };
}

/**
 * 兼容层（engine 既有调用）：内部委托 rollEvent。
 */
export function rollRandomEvent(state, config, rng) {
  return rollEvent(state, config, rng);
}

/** 根据 requires 自动生成禁用原因（"社交需 ≥10" 之类）。 */
function autoReason(cond, req) {
  if (req && req.attribute) {
    return `${attrLabel(req.attribute.key)}需 ≥ ${req.attribute.min}`;
  }
  return '未满足前置条件';
}

function attrLabel(key) {
  const map = { knowledge: '学识', social: '社交', health: '健康', money: '金钱' };
  return map[key] || key;
}

/**
 * 逐条判断事件选项的可用性。
 * @param {object} event
 * @param {object} state
 * @param {object} config
 * @returns {Array<{id:string,label:string,enabled:boolean,reason:string}>}
 */
export function availableOptions(event, state, config) {
  const opts = (event && Array.isArray(event.options)) ? event.options : [];
  const attrs = (state && state.player && state.player.attributes) || {};
  const flags = (state && state.player && state.player.flags) || {};
  const totalGpa = (state && state.academics && Number(state.academics.totalGpa)) || 0;
  return opts.map((o) => {
    const req = o.requires;
    let enabled = true;
    let reason = '';
    if (req && typeof req === 'object') {
      const hint = typeof req.disabledHint === 'string' ? req.disabledHint : '';
      // attribute 前置
      if (enabled && req.attribute && req.attribute.key) {
        if ((Number(attrs[req.attribute.key]) || 0) < Number(req.attribute.min)) {
          enabled = false; reason = hint || autoReason(req, req);
        }
      }
      // flag 前置
      if (enabled && req.flag && req.flag.key) {
        if (String(flags[req.flag.key]) !== String(req.flag.value)) {
          enabled = false; reason = hint || `需要标记「${req.flag.key}」`;
        }
      }
      // moneyAtLeast 前置
      if (enabled && req.moneyAtLeast !== undefined) {
        if ((Number(attrs.money) || 0) < Number(req.moneyAtLeast)) {
          enabled = false; reason = hint || `需要金钱 ≥ ${req.moneyAtLeast}`;
        }
      }
      // 回合范围前置
      if (enabled && req.minTurn !== undefined && state.turn < Number(req.minTurn)) {
        enabled = false; reason = hint || `需要第 ${req.minTurn} 回合后`;
      }
      if (enabled && req.maxTurn !== undefined && state.turn > Number(req.maxTurn)) {
        enabled = false; reason = hint || `仅限第 ${req.maxTurn} 回合前`;
      }
      // 绩点前置
      if (enabled && req.gpaAtLeast !== undefined) {
        if (totalGpa < Number(req.gpaAtLeast)) {
          enabled = false; reason = hint || `需要绩点 ≥ ${req.gpaAtLeast}`;
        }
      }
    }
    return { id: o.id, label: o.label, enabled, reason };
  });
}

/**
 * 生成待处理事件。若传入 state/config，则 options 携带 enabled/reason（供 UI 置灰）；
 * 否则（engine 既有调用 buildPending(ev)）返回全部 enabled 的基本结构。
 * @param {object} event
 * @param {object} [state]
 * @param {object} [config]
 * @returns {{ eventId:string, options:Array, resolved:boolean }}
 */
export function buildPending(event, state, config) {
  if (!event) return null;
  if (state && config) {
    return {
      eventId: event.id,
      options: availableOptions(event, state, config),
      resolved: false,
    };
  }
  return {
    eventId: event.id,
    options: (event.options || []).map((o) => ({ id: o.id, label: o.label, enabled: true, reason: '' })),
    resolved: false,
  };
}

/**
 * 结算一个事件选项（应用 effects、写 eventHistory、写 log）。
 * 前置不满足（enabled===false）的选项返回 { ok:false, reason:'requirement' }。
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
  // 前置条件校验：disabled 选项不可选
  if (state && config) {
    const avail = availableOptions(ev, state, config).find((a) => a.id === choiceId);
    if (avail && avail.enabled === false) {
      return { ok: false, reason: 'requirement', message: avail.reason };
    }
  }
  const applied = applyEffects(state, option.effects || {}, { config });
  if (!Array.isArray(state.eventHistory)) state.eventHistory = [];
  state.eventHistory.push(eventId);
  // 随机事件去重：记录最近触发的随机事件，供 rollEvent 短间隔内不重复
  if (getAllEvents(config).random.some((e) => e.id === eventId)) {
    if (!Array.isArray(state.__recentEvents)) state.__recentEvents = [];
    const cap = (config && config.balance && Number.isFinite(config.balance.recentEventCooldown))
      ? config.balance.recentEventCooldown : 3;
    state.__recentEvents.push(eventId);
    if (state.__recentEvents.length > cap) state.__recentEvents.shift();
  }
  let text = option.resultText || '';
  // 考试类事件：只有在真正的期末周（balance.examTurns）才公布成绩。
  // 否则随机事件会校历外提前把期末考掉、写坏学期记录，正式期末反而被跳过。
  const examTurns = Array.isArray(config && config.balance && config.balance.examTurns)
    ? config.balance.examTurns
    : [];
  const isExamTurn = examTurns.indexOf(state.turn) >= 0;
  if (ev.showExamResult && isExamTurn) {
    const months = Number.isFinite(config && config.balance && config.balance.monthsPerSemester)
      ? config.balance.monthsPerSemester
      : 5;
    const curSem = Math.ceil(state.turn / months);
    const recs = (state.academics && state.academics.semesterRecords) || [];
    let last = recs[recs.length - 1];
    // 引擎若已在期末回合算好本次成绩则复用；否则当场运行 runFinalExam 计算本次成绩与绩点
    if (!last || last.semester !== curSem || !Array.isArray(last.subjects) || !last.subjects.length) {
      const exam = runFinalExam(state, config, rng);
      if (exam && exam.ok) {
        last = {
          semester: curSem, turn: state.turn,
          subjects: exam.subjects,
          semesterGpa: exam.semesterGpa,
          failed: exam.failedThisSemester,
        };
      }
    }
    if (last && Array.isArray(last.subjects) && last.subjects.length) {
      const scores = last.subjects.map((x) => `${x.name} ${x.score} 分`).join('、');
      text += ` ｜ 期末成绩：${scores} ｜ 绩点 ${last.semesterGpa} ｜ 挂 ${last.failed} 门`;
    }
  }
  // 所有事件：追加实际效果影响
  const effParts = describeChanges(applied.changes);
  if (effParts.length) text += ` ｜ 效果：${effParts.join('，')}`;
  state.log.push(`事件【${ev.name}】选择「${option.label}」：${text}`);
  // 剧情线起始事件：无论选哪个选项，标记该线已触发，避免强制调度重复
  if (state && state.player) {
    const st = STORYLINES.find((L) => L.start === eventId);
    if (st) {
      if (!state.player.flags) state.player.flags = {};
      state.player.flags[storylineKey(st.line)] = true;
    }
  }
  return {
    ok: true,
    result: { eventId, choiceId, effects: option.effects || {} },
    message: text,
  };
}
