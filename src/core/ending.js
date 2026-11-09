/**
 * 结局判定（负责人 A，被 engine 调用，不修改 state）。
 *
 * W3 能力（CONTRACT §2.6 / D-02）：
 *  - 条件类型：attributeAtLeast / gpaAtLeast / warningTrue(+negate) / flagEquals /
 *    tagIncludes / collegeIs / eventDone / default / all / any
 *  - 优先级方向由 balance.endingPriorityOrder 控制：
 *      'asc'  → 数值越小越高（SRS 4.1.6 口径，W3 目标）
 *      缺省   → 'desc'（兼容当前 endings.json 的「越大越优先」，避免未重排前全体落到默认结局）
 *  - judgeEnding 返回 { main, subs[] }：主结局取最高优先级命中项，其余命中项记为副结局（SRS 6.1）
 *
 * 只读 state，不写任何字段。
 */

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * 按配置的优先级方向对结局排序（不改原数组）。
 * @param {Array} list
 * @param {object} config
 * @returns {Array}
 */
export function sortByPriority(list, config) {
  const order = (config && config.balance && config.balance.endingPriorityOrder) === 'asc'
    ? 'asc'
    : 'desc';
  return list.slice().sort((a, b) => {
    const pa = Number.isFinite(a && a.priority) ? a.priority : 0;
    const pb = Number.isFinite(b && b.priority) ? b.priority : 0;
    return order === 'asc' ? pa - pb : pb - pa;
  });
}

function ctxOf(state) {
  return {
    attrs: (state && state.player && state.player.attributes) || {},
    player: (state && state.player) || {},
    academics: (state && state.academics) || {},
    tags: (state && state.player && Array.isArray(state.player.tags)) ? state.player.tags : [],
    flags: (state && state.player && state.player.flags) || {},
    history: (state && Array.isArray(state.eventHistory)) ? state.eventHistory : [],
  };
}

/**
 * 求值单个条件（可递归 all / any）。
 * @param {object} cond
 * @param {object} state
 * @param {object} config
 * @returns {boolean}
 */
export function evaluateCondition(cond, state, config) {
  if (!cond || typeof cond !== 'object') return false;
  const c = ctxOf(state);
  const negate = !!cond.negate;
  let hit = false;

  if (cond.type === 'all' || cond.type === 'any') {
    const arr = Array.isArray(cond.conditions) ? cond.conditions : [];
    hit = cond.type === 'all'
      ? arr.every((x) => evaluateCondition(x, state, config))
      : arr.some((x) => evaluateCondition(x, state, config));
    return negate ? !hit : hit;
  }

  switch (cond.type) {
    case 'attributeAtLeast': {
      const key = cond.key;
      hit = Object.prototype.hasOwnProperty.call(c.attrs, key)
        && num(c.attrs[key], -Infinity) >= num(cond.value, Infinity);
      break;
    }
    case 'gpaAtLeast': {
      hit = num(c.academics.totalGpa, 0) >= num(cond.value, Infinity);
      break;
    }
    case 'warningTrue': {
      hit = !!c.academics.warning;
      break;
    }
    case 'flagEquals': {
      const key = cond.key || cond.flag;
      hit = String(c.flags[key]) === String(cond.value);
      break;
    }
    case 'tagIncludes': {
      const tag = cond.tagId !== undefined ? cond.tagId : cond.value;
      hit = c.tags.indexOf(tag) >= 0;
      break;
    }
    case 'collegeIs': {
      const target = cond.collegeId !== undefined ? cond.collegeId : cond.value;
      hit = c.player.collegeId === target;
      break;
    }
    case 'eventDone': {
      const target = cond.eventId !== undefined ? cond.eventId : cond.value;
      hit = c.history.indexOf(target) >= 0;
      break;
    }
    case 'default': {
      hit = true;
      break;
    }
    default: {
      console.warn(`未知结局条件类型: ${String(cond.type)}`);
      hit = false;
    }
  }
  return negate ? !hit : hit;
}

/**
 * 判定主结局与副结局。
 * @param {object} state
 * @param {object} config
 * @returns {{ main: string|null, subs: string[] }}
 */
export function judgeEnding(state, config) {
  const endings = (config && config.endings && Array.isArray(config.endings.list))
    ? config.endings.list
    : [];
  const sorted = sortByPriority(endings, config);
  const hits = [];
  for (const e of sorted) {
    if (evaluateCondition(e && e.condition, state, config)) hits.push(e.id);
  }
  return { main: hits.length ? hits[0] : null, subs: hits.slice(1) };
}

/**
 * 便捷包装：只要主结局 id。
 * @param {object} state
 * @param {object} config
 * @returns {string|null}
 */
export function evaluateEnding(state, config) {
  return judgeEnding(state, config).main;
}
