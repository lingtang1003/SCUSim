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
import * as relation from '../core/relation.js';
import * as storyline from '../core/storyline.js';

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
 * 读取玩家最近一次行动作为「当前场景」（spot 类别，与 actions.json 的 actionId 一致）。
 * 事件在回合推进时抽取，此时 state.player.location 已被引擎清空，
 * 但上一回合做过的行动记在 state.history（type:'action'），行动与地点一一对应，
 * 因此用最近行动等价于当前所在地点场景；找不到则返回 null（不做场景限制）。
 */
function currentSpot(state) {
  const history = Array.isArray(state && state.history) ? state.history : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry && entry.type === 'action' && entry.actionId) return entry.actionId;
  }
  return null;
}

/**
 * 读取玩家最近一次前往的地点，返回其细分主题（topic，与 locations.json 的 topic 一致）。
 * 同一大类（spot）下不同地点再细分：如图书馆=major 专业课、教学楼=basics 公共课、文科楼=humanities。
 * 事件抽取时 state.player.location 已被清空，故从 history 最近一条 type:'move' 反查地点。
 */
function currentTopic(state, config) {
  const history = Array.isArray(state && state.history) ? state.history : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry && entry.type === 'move' && entry.location) {
      const list = config && config.locations && Array.isArray(config.locations.list)
        ? config.locations.list
        : [];
      const loc = list.find((l) => l.id === entry.location);
      return (loc && loc.topic) || null;
    }
  }
  return null;
}

/**
 * 剧情线保证触发（v2.1）：真正的「哪条线、哪一步、什么窗口」全部在 config/storylines.json，
 * 由 core/storyline.js 的状态机决定；这里只负责在回合开始时问它一句「现在该不该强制出事件」。
 */
function nextStoryline(state, config) {
  const due = storyline.dueEvent(state, config);
  return due && due.eventId ? due.eventId : null;
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
  // 学院专属事件保证：回合12强制触发一次本院特色事件（避开考试周/剧情线窗口）
  const collegeId = state && state.player && state.player.collegeId;
  if (collegeId && state.turn === 12 && !(state.player.flags && state.player.flags.chain_college)) {
    const ce = getAllEvents(config).random.find((e) => e.college === collegeId);
    if (ce) result.unshift(ce.id);
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
  // 剧情线步骤事件只由状态机强制派发，不参与随机池（避免与步进重复触发）
  if (event.storylineOnly) return 0;
  const tr = Array.isArray(event.termRange) ? event.termRange : [];
  if (tr.length >= 2) {
    const semester = semesterOf(state);
    if (semester < Number(tr[0]) || semester > Number(tr[1])) return 0;
  }
  // 「只在期末周出现」的事件（期末考试周 / 期末答疑班）：
  // 必须落在考试周，才能保证「先选复习方式，再结算成绩」的顺序。
  if (event.examWeekOnly) {
    const balance = (config && config.balance) || {};
    const examTurns = Array.isArray(balance.examTurns) ? balance.examTurns : [];
    if (examTurns.indexOf(state.turn) < 0) return 0;
  }
  // 学院专属事件：事件带 college 字段时，仅该学院玩家才会遇到
  if (event.college && state.player && state.player.collegeId !== event.college) return 0;
  // 一次性事件：已经发生过就不再回到随机池
  if (event.once) {
    const history = Array.isArray(state.eventHistory) ? state.eventHistory : [];
    if (history.indexOf(event.id) >= 0) return 0;
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

  // v2.1：带角色的日常事件，好感越高越容易遇到（0 好感 ×1，满好感 ×2）
  if (event.charId) {
    const char = relation.findCharacter(config, event.charId);
    const aff = relation.affinityOf(state, event.charId);
    const max = relation.affinityMax(config);
    w *= 1 + Math.max(0, Math.min(1, aff / max));
    if (char && Array.isArray(char.likedEvents) && char.likedEvents.indexOf(event.id) >= 0) w *= 1.3;
  }

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

  // 场景 + 细分主题分组（混合模式）：主题匹配 → 同大类其他主题 → 通用事件（无 spot）→ 其他场景；逐级兜底，避免空池卡死。
  const cur = currentSpot(state);
  const curTopic = currentTopic(state, config);
  let groups;
  if (!cur) {
    groups = [weighted];
  } else {
    const inSpot = (x) => Array.isArray(x.e.spot) && x.e.spot.includes(cur);
    const topicMatch = weighted.filter((x) => inSpot(x) && curTopic && x.e.topic === curTopic);
    const spotMatch = weighted.filter((x) => inSpot(x) && !(curTopic && x.e.topic === curTopic));
    const general = weighted.filter((x) => !Array.isArray(x.e.spot) || x.e.spot.length === 0);
    const other = weighted.filter((x) => Array.isArray(x.e.spot) && x.e.spot.length > 0 && !inSpot(x));
    groups = [topicMatch, spotMatch, general, other];
  }

  // 在给定候选组内做轮盘赌；只返回至少含一个可用选项的事件，前置未满足的跳过。
  const pickFrom = (pool) => {
    let cand = pool.filter((x) => !recent.includes(x.e.id));
    if (cand.length === 0) cand = pool; // 防卡：去重窗口内全重复时回退整组
    let guard = cand.length;
    while (cand.length > 0 && guard-- > 0) {
      const totalWeight = cand.reduce((s, x) => s + x.w, 0);
      let r = rng.next() * totalWeight;
      let picked = cand[cand.length - 1].e;
      for (const x of cand) {
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
      cand = cand.filter((x) => x.e !== picked);
    }
    return null;
  };

  for (const group of groups) {
    if (group.length === 0) continue;
    const res = pickFrom(group);
    if (res) return res;
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

/** 选项携带的好感提示（UI 在选项上显示「↑ 江叙 +8」）。 */
function optionHints(option, config) {
  const out = [];
  const rel = option && option.effects && option.effects.relation;
  if (rel && typeof rel === 'object') {
    for (const charId of Object.keys(rel)) {
      const delta = Number(rel[charId]);
      if (!Number.isFinite(delta) || delta === 0) continue;
      const char = relation.findCharacter(config, charId);
      out.push({ charId, name: char ? char.name : charId, delta });
    }
  }
  if (Array.isArray(option && option.hints)) {
    for (const h of option.hints) if (typeof h === 'string') out.push({ text: h });
  }
  return out;
}

/** 好感不足时的可读提示。 */
function relationReason(req, config) {
  const need = Number(req.relationAtLeast.value);
  const charId = req.relationAtLeast.charId;
  const char = relation.findCharacter(config, charId);
  return `需要和${char ? char.name : charId}更熟（好感 ≥ ${need}）`;
}

/**
 * 逐条判断事件选项的可用性。
 * @param {object} event
 * @param {object} state
 * @param {object} config
 * @returns {Array<{id:string,label:string,enabled:boolean,reason:string,hints:Array}>}
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
      // 好感前置（v2.1）
      if (enabled && req.relationAtLeast && req.relationAtLeast.charId) {
        if (relation.affinityOf(state, req.relationAtLeast.charId) < Number(req.relationAtLeast.value)) {
          enabled = false; reason = hint || relationReason(req, config);
        }
      }
    }
    return { id: o.id, label: o.label, enabled, reason, hints: optionHints(o, config) };
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
      charId: event.charId || '',
      options: availableOptions(event, state, config),
      resolved: false,
    };
  }
  return {
    eventId: event.id,
    charId: event.charId || '',
    options: (event.options || []).map((o) => ({
      id: o.id, label: o.label, enabled: true, reason: '', hints: [],
    })),
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
  // 考试类事件不再复述成绩：期末成绩统一由「学期结算」弹窗展示（引擎在该周结束时结算），
  // 事件里再写一遍会出现「还没选就已经出成绩」的错觉。
  // showExamResult 字段保留，仅作为事件语义标记，不参与文本拼接。
  // 所有事件：追加实际效果影响
  const effParts = describeChanges(applied.changes);
  if (effParts.length) text += ` ｜ 效果：${effParts.join('，')}`;
  state.log.push(`事件【${ev.name}】选择「${option.label}」：${text}`);
  if (state && state.player) {
    // 学院专属事件：resolve 后标记，避免回合 12 重复强制触发
    if (ev.college) {
      if (!state.player.flags) state.player.flags = {};
      state.player.flags.chain_college = true;
    }
  }
  return {
    ok: true,
    result: { eventId, choiceId, effects: option.effects || {} },
    message: text,
  };
}
