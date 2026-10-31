/**
 * GameState 工厂（仅结构，规则计算在 engine 中完成）。
 *
 * 可变状态模型：state 在引擎中就地修改。本模块不依赖 DOM / 存储。
 */

/**
 * 创建初始 GameState。
 * @param {object} options { name, gender, collegeId, attributes, tags, seed? }
 * @returns {object} GameState
 */
export function createGameState(options) {
  const o = options || {};
  const attrs = o.attributes || {};
  return {
    version: '1.0.0',
    seed: Number.isFinite(o.seed) ? o.seed : 0,
    // rngState 由引擎在 newGame 中填入（结构预留）
    rngState: 0,
    turn: 1,
    actionPoints: 4,
    player: {
      name: typeof o.name === 'string' ? o.name : '',
      gender: o.gender === '女' ? '女' : '男',
      collegeId: typeof o.collegeId === 'string' ? o.collegeId : '',
      // 外观（立绘 id）：纯展示字段，不参与任何数值计算，仅随存档保存
      appearance: typeof o.appearance === 'string' ? o.appearance : '',
      attributes: {
        knowledge: Number(attrs.knowledge) || 0,
        social: Number(attrs.social) || 0,
        health: Number(attrs.health) || 0,
        money: Number(attrs.money) || 0,
      },
      tags: Array.isArray(o.tags) ? o.tags.slice(0, 3) : [],
    },
    academics: {
      semesterScores: [],
      failedCourses: 0,
      warning: false,
      studyActions: 0,
    },
    pendingEvent: null,
    eventHistory: [],
    log: [],
    endingId: null,
  };
}

/**
 * 深拷贝（存档快照/测试用）。优先 structuredClone，降级 JSON 克隆。
 * @param {object} state
 * @returns {object}
 */
export function clone(state) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(state);
    } catch (_) {
      /* 降级到 JSON */
    }
  }
  return JSON.parse(JSON.stringify(state));
}
