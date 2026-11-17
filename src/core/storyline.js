/**
 * 剧情线（storyline）状态机 · 纯逻辑，无 DOM / 存储 / 原生随机。
 *
 * 一条线 = 一串带回合窗口与前置条件的剧情步骤，每步绑定一个事件；
 * 玩家在事件里做的选择可以改变下一步走向（`next`），走完最后一步 → done；
 * 窗口过期 / 关键选择失败 / 好感跌破底线 → broken（本局错过这条线）。
 *
 * 配置形状（config/storylines.json，结构由 D 校验）：
 * {
 *   "lines": [{
 *     "id": "line_linyu", "charId": "linyu", "name": "林予线", "priority": 10,
 *     "startIf": { "flag": "route_linyu" },          // 迎新晚会选了谁才开启
 *     "steps": [
 *       { "id": "meet",   "eventId": "ev_r23", "window": [3, 10] },
 *       { "id": "dinner", "eventId": "ev_r24", "window": [10, 20],
 *         "gate": { "relationAtLeast": { "charId": "linyu", "value": 12 } },
 *         "next": { "dinner": "walk", "refuse": "@break" } },
 *       …
 *     ],
 *     "onBreak": { "affinityBelow": 6, "forTurns": 5 }
 *   }]
 * }
 *
 * 状态（写进存档）：
 *   state.storylines = { [lineId]: { step, status, since, lastTurn, lowTurns } }
 *   status ∈ 'idle' | 'active' | 'done' | 'broken'
 */

import { affinityOf } from './relation.js';

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const STATUS = { idle: 'idle', active: 'active', done: 'done', broken: 'broken' };

/** 配置里的剧情线（缺配置时为空数组，剧情线系统整体降级关闭）。 */
export function linesOf(config) {
  const list = config && config.storylines && Array.isArray(config.storylines.lines)
    ? config.storylines.lines
    : [];
  return list.filter((l) => l && typeof l.id === 'string');
}

export function findLine(config, lineId) {
  if (!lineId) return null;
  return linesOf(config).find((l) => l.id === lineId) || null;
}

function stepsOf(line) {
  return line && Array.isArray(line.steps) ? line.steps : [];
}

/** 初始化（新局）：清空后补齐。 */
export function initStorylines(state, config) {
  if (!state) return 0;
  state.storylines = {};
  return ensureStorylines(state, config);
}

/** 补全缺失的线（旧存档迁移 / 新配置新增线时调用，幂等）。 */
export function ensureStorylines(state, config) {
  if (!state) return 0;
  const lines = linesOf(config);
  if (!lines.length) return 0;
  if (!state.storylines || typeof state.storylines !== 'object') state.storylines = {};
  let added = 0;
  for (const line of lines) {
    if (state.storylines[line.id]) continue;
    state.storylines[line.id] = {
      step: 0,
      status: STATUS.idle,
      since: num(state.turn, 1),
      lastTurn: 0,
      lowTurns: 0,
    };
    added += 1;
  }
  return added;
}

function entryOf(state, lineId) {
  if (!state || !state.storylines) return null;
  return state.storylines[lineId] || null;
}

/** 线的当前状态（未初始化按 idle）。 */
export function statusOf(state, lineId) {
  const e = entryOf(state, lineId);
  return e ? e.status : STATUS.idle;
}

/** 线的下一步（返回 null 表示已走完/无步骤）。 */
export function currentStep(state, line) {
  const e = entryOf(state, line.id);
  const steps = stepsOf(line);
  const idx = e ? num(e.step, 0) : 0;
  if (idx < 0 || idx >= steps.length) return null;
  return { index: idx, step: steps[idx] };
}

/** 前置条件求值：relationAtLeast / flag / notFlag / college / minTurn / maxTurn。 */
export function gateOk(state, gate, config) {
  if (!gate || typeof gate !== 'object') return true;
  const flags = (state && state.player && state.player.flags) || {};
  if (gate.flag && gate.flag.key) {
    if (String(flags[gate.flag.key]) !== String(gate.flag.value)) return false;
  }
  if (gate.notFlag && gate.notFlag.key) {
    if (String(flags[gate.notFlag.key]) === String(gate.notFlag.value)) return false;
  }
  if (gate.relationAtLeast && gate.relationAtLeast.charId) {
    const need = num(gate.relationAtLeast.value, 0);
    if (affinityOf(state, gate.relationAtLeast.charId) < need) return false;
  }
  if (gate.college) {
    const cur = state && state.player ? state.player.collegeId : '';
    if (cur !== gate.college) return false;
  }
  if (Number.isFinite(Number(gate.minTurn)) && num(state && state.turn, 1) < Number(gate.minTurn)) return false;
  if (Number.isFinite(Number(gate.maxTurn)) && num(state && state.turn, 1) > Number(gate.maxTurn)) return false;
  return true;
}

/**
 * 本回合是否有剧情线要强制触发（固定事件之下的最高优先级）。
 * @returns {{eventId:string, lineId:string, stepIndex:number, stepId:string}|null}
 */
export function dueEvent(state, config) {
  if (!state || !state.player) return null;
  const lines = linesOf(config).slice().sort((a, b) => num(a.priority, 100) - num(b.priority, 100));
  const turn = num(state.turn, 1);
  for (const line of lines) {
    if (!state.storylines) state.storylines = {};
    if (!state.storylines[line.id]) {
      state.storylines[line.id] = {
        step: 0, status: STATUS.idle, since: turn, lastTurn: 0, lowTurns: 0,
      };
    }
    const entry = state.storylines[line.id];
    if (!entry || (entry.status !== STATUS.idle && entry.status !== STATUS.active)) continue;
    if (!gateOk(state, line.startIf, config)) continue;
    const cur = currentStep(state, line);
    if (!cur) { entry.status = STATUS.done; continue; }
    const win = Array.isArray(cur.step.window) ? cur.step.window : [];
    if (win.length >= 2 && turn < num(win[0], 1)) continue;
    if (win.length >= 2 && turn > num(win[1], 999)) {
      // 窗口已过：本局错过这条线
      entry.status = STATUS.broken;
      entry.lastTurn = turn;
      continue;
    }
    if (!gateOk(state, cur.step.gate, config)) continue;
    if (!cur.step.eventId) { entry.step = cur.index + 1; continue; }
    return {
      eventId: cur.step.eventId,
      lineId: line.id,
      stepIndex: cur.index,
      stepId: cur.step.id || '',
    };
  }
  return null;
}

/**
 * 事件结算后推进剧情线（由 engine 在 resolvePendingEvent 中调用）。
 * @returns {{lineId:string, stepIndex:number, status:string, stepId:string, finished:boolean}|null}
 */
export function onEventResolved(state, eventId, choiceId, config) {
  if (!state || !eventId) return null;
  ensureStorylines(state, config);
  for (const line of linesOf(config)) {
    const steps = stepsOf(line);
    const entry = state.storylines[line.id];
    if (!entry) continue;
    let hit = -1;
    for (let i = 0; i < steps.length; i += 1) {
      if (steps[i] && steps[i].eventId === eventId) { hit = i; break; }
    }
    if (hit < 0) continue;
    // 事件重复结算（读档/异常路径）：不重复推进
    if (entry.status === STATUS.done) return null;
    const step = steps[hit] || {};
    const branch = step.next && Object.prototype.hasOwnProperty.call(step.next, choiceId)
      ? step.next[choiceId]
      : null;

    if (branch === '@break') {
      entry.status = STATUS.broken;
      entry.step = hit + 1;
      entry.lastTurn = num(state.turn, 1);
      return { lineId: line.id, stepIndex: hit, stepId: step.id || '', status: STATUS.broken, finished: true };
    }
    if (branch === '@done') {
      entry.status = STATUS.done;
      entry.step = steps.length;
      entry.lastTurn = num(state.turn, 1);
      return { lineId: line.id, stepIndex: hit, stepId: step.id || '', status: STATUS.done, finished: true };
    }

    let next = hit + 1;
    if (branch && branch !== '@next') {
      const byId = steps.findIndex((s) => s && s.id === branch);
      if (byId >= 0) next = byId;
    }
    entry.lastTurn = num(state.turn, 1);
    if (next >= steps.length) {
      entry.status = STATUS.done;
      entry.step = steps.length;
      return { lineId: line.id, stepIndex: hit, stepId: step.id || '', status: STATUS.done, finished: true };
    }
    entry.step = next;
    entry.status = STATUS.active;
    entry.lowTurns = 0;
    return { lineId: line.id, stepIndex: hit, stepId: step.id || '', status: STATUS.active, finished: false };
  }
  return null;
}

/**
 * 「冷落」判定：进行中的线，如果好感连续 N 回合低于底线 → broken。
 * @returns {string[]} 本回合被中断的线 id
 */
export function checkBreak(state, config) {
  if (!state || !state.storylines) return [];
  const broken = [];
  for (const line of linesOf(config)) {
    const cfg = line.onBreak;
    if (!cfg) continue;
    const entry = state.storylines[line.id];
    if (!entry || entry.status !== STATUS.active) continue;
    const below = num(cfg.affinityBelow, -1);
    if (below < 0) continue;
    if (!line.charId) continue;
    if (affinityOf(state, line.charId) < below) {
      entry.lowTurns = num(entry.lowTurns, 0) + 1;
      if (entry.lowTurns >= Math.max(1, num(cfg.forTurns, 3))) {
        entry.status = STATUS.broken;
        entry.lastTurn = num(state.turn, 1);
        broken.push(line.id);
      }
    } else {
      entry.lowTurns = 0;
    }
  }
  return broken;
}

/** 手动中断一条线（内容没配出可用选项、或剧情上判定失败时用）。 */
export function markBroken(state, lineId, config) {
  const line = findLine(config, lineId);
  if (!line || !state) return false;
  ensureStorylines(state, config);
  const entry = state.storylines[lineId];
  if (!entry || entry.status === STATUS.broken || entry.status === STATUS.done) return false;
  entry.status = STATUS.broken;
  entry.lastTurn = num(state.turn, 1);
  return true;
}

/** 给 UI 的当前线摘要（进行中的线 + 进度），没有则 null。 */
export function activeLineSummary(state, config) {
  ensureStorylines(state, config);
  const lines = linesOf(config);
  for (const line of lines) {
    const entry = state.storylines && state.storylines[line.id];
    if (!entry || entry.status !== STATUS.active) continue;
    const steps = stepsOf(line);
    return {
      id: line.id,
      name: line.name || line.id,
      charId: line.charId || '',
      step: Math.min(entry.step + 1, steps.length),
      total: steps.length,
    };
  }
  return null;
}

/** 某条线的进度（结局条件 / 测试用）。 */
export function progressOf(state, config, lineId) {
  const line = findLine(config, lineId);
  if (!line) return { status: STATUS.idle, step: 0, total: 0 };
  const entry = entryOf(state, lineId);
  const steps = stepsOf(line);
  return {
    status: entry ? entry.status : STATUS.idle,
    step: entry ? num(entry.step, 0) : 0,
    total: steps.length,
  };
}
