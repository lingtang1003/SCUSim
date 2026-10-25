/**
 * 结局判定（被 engine 调用，不修改 state）。
 */

/**
 * 按 priority 降序，返回第一个命中条件的结局 id；无命中返回 null。
 * 未知 condition.type 视为不命中并 console.warn。
 * 支持的 type：
 *   - attributeAtLeast { key, value }：属性 >= value
 *   - warningTrue：academics.warning 为真
 *   - default：兜底（永远命中），priority 应最低
 * @param {object} state
 * @param {object} config
 * @returns {string|null}
 */
export function evaluateEnding(state, config) {
  const endings = (config && config.endings && Array.isArray(config.endings.list))
    ? config.endings.list
    : [];
  const sorted = endings.slice().sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
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
