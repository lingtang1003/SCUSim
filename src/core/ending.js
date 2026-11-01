/**
 * 结局判定（负责人 A，被 engine 调用，不修改 state）。
 *
 * ── W1 变更 ─────────────────────────────────────────────
 *  - 优先级方向改为配置驱动（D-02）：
 *      balance.endingPriorityOrder === 'asc' → 数值越小优先级越高（SRS 4.1.6 口径）
 *      缺省（当前 config 未加该字段）→ 'desc'，与 W0 现有 endings.json 的「越大越优先」
 *      保持兼容，避免在 D 重排 endings.json 之前出现「人人都是平凡四年」的回归。
 *      W3 由 D 重排 6 条结局 + 同 PR 追加 "endingPriorityOrder": "asc"，原子切换。
 *  - 条件类型仍为 attributeAtLeast / warningTrue / default；
 *    all / any / gpaAtLeast / flagEquals / tagIncludes / collegeIs / eventDone 在 W3 扩展。
 */

/**
 * 按配置的优先级方向对结局排序（不改原数组）。
 * @param {Array} list
 * @param {object} config
 * @returns {Array}
 */
function sortByPriority(list, config) {
  const order = (config && config.balance && config.balance.endingPriorityOrder) === 'asc'
    ? 'asc'
    : 'desc';
  return list.slice().sort((a, b) => {
    const pa = Number.isFinite(a && a.priority) ? a.priority : 0;
    const pb = Number.isFinite(b && b.priority) ? b.priority : 0;
    return order === 'asc' ? pa - pb : pb - pa;
  });
}

/**
 * 按优先级返回第一个命中条件的结局 id；无命中返回 null。
 * 未知 condition.type 视为不命中并 console.warn。
 * 支持的 type：
 *   - attributeAtLeast { key, value }：属性 >= value
 *   - warningTrue：academics.warning 为真
 *   - default：兜底（永远命中），优先级应最低
 * @param {object} state
 * @param {object} config
 * @returns {string|null}
 */
export function evaluateEnding(state, config) {
  const endings = (config && config.endings && Array.isArray(config.endings.list))
    ? config.endings.list
    : [];
  const sorted = sortByPriority(endings, config);
  const attrs = (state && state.player && state.player.attributes) || {};
  const academics = (state && state.academics) || {};
  for (const e of sorted) {
    const cond = (e && e.condition) || {};
    let hit = false;
    switch (cond.type) {
      case 'attributeAtLeast': {
        const val = attrs[cond.key];
        hit = Number.isFinite(val) && val >= Number(cond.value);
        break;
      }
      case 'warningTrue': {
        hit = !!academics.warning;
        break;
      }
      case 'default': {
        hit = true;
        break;
      }
      default: {
        console.warn(`未知结局条件类型: ${String(cond.type)}（结局 ${e.id}）`);
        hit = false;
      }
    }
    if (hit) return e.id;
  }
  return null;
}
