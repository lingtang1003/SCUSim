/**
 * 角色关系（好感度）模块 · 纯逻辑，无 DOM / 存储 / 原生随机。
 *
 * 数据（写进存档，随存档走）：
 *   state.player.relations = {
 *     [charId]: { affinity: number, stage: 'stranger'|…, met: boolean, lastTurn: number }
 *   }
 *
 * 角色静态数据来自 config/characters.json（D 校验结构、B 负责内容）：
 *   { id, name, gender, role, college, title, intro,
 *     portrait: { file, silhouette? },
 *     initialAffinity, stages: [{ at, id, name }], likedEvents: [] }
 *
 * 约定：
 *  - 好感范围 0..balance.affinityMax（默认 100），只由 applyEffects / 剧本事件改写；
 *  - 阶段由 stages 阈值推导（不在存档里手写），保证改配置后旧档自动重算；
 *  - 本模块不 import 任何其它 core 模块，避免环依赖。
 */

export const DEFAULT_AFFINITY_MAX = 100;
export const DEFAULT_STAGE = { at: 0, id: 'stranger', name: '陌生' };

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** 配置里的角色列表（缺配置时为空数组，整个角色系统自动降级关闭）。 */
export function charactersOf(config) {
  const list = config && config.characters && Array.isArray(config.characters.list)
    ? config.characters.list
    : [];
  return list.filter((c) => c && typeof c.id === 'string');
}

/** 按 id 找角色；找不到返回 null（调用方必须容忍）。 */
export function findCharacter(config, charId) {
  if (!charId) return null;
  return charactersOf(config).find((c) => c.id === charId) || null;
}

/** 好感上限（配置驱动）。 */
export function affinityMax(config) {
  const v = config && config.balance && config.balance.affinityMax;
  return Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : DEFAULT_AFFINITY_MAX;
}

/** 阶段表（按 at 升序，保证缺失阈值时也能用）。 */
export function stagesOf(char) {
  const list = char && Array.isArray(char.stages) ? char.stages : [];
  const clean = list
    .filter((s) => s && Number.isFinite(Number(s.at)))
    .map((s) => ({ at: Number(s.at), id: String(s.id || 'stage'), name: String(s.name || s.id || '') }))
    .sort((a, b) => a.at - b.at);
  return clean.length ? clean : [DEFAULT_STAGE];
}

/** 好感 → 阶段（取 at <= affinity 的最高档）。 */
export function stageAt(char, affinity) {
  const stages = stagesOf(char);
  let hit = stages[0];
  for (const s of stages) {
    if (num(affinity, 0) >= s.at) hit = s;
  }
  return hit;
}

/** 最近一次交互回合（用于「冷落」判定与 UI 排序）。 */
function ensureEntry(state, charId) {
  if (!state.player.relations || typeof state.player.relations !== 'object') {
    state.player.relations = {};
  }
  if (!state.player.relations[charId]) {
    state.player.relations[charId] = {
      affinity: 0, stage: 'stranger', met: false, lastTurn: 0,
    };
  }
  const rel = state.player.relations[charId];
  if (!Number.isFinite(Number(rel.affinity))) rel.affinity = 0;
  if (typeof rel.met !== 'boolean') rel.met = false;
  if (!Number.isFinite(Number(rel.lastTurn))) rel.lastTurn = 0;
  return rel;
}

/**
 * 初始化/补全关系表（幂等）。新局与读旧档都调用它。
 * @returns {number} 新增的角色数量
 */
export function ensureRelations(state, config) {
  if (!state || !state.player) return 0;
  const chars = charactersOf(config);
  if (!chars.length) return 0;
  if (!state.player.relations || typeof state.player.relations !== 'object') {
    state.player.relations = {};
  }
  let added = 0;
  for (const c of chars) {
    if (state.player.relations[c.id]) continue;
    state.player.relations[c.id] = {
      affinity: num(c.initialAffinity, 0),
      stage: stageAt(c, num(c.initialAffinity, 0)).id,
      met: false,
      lastTurn: 0,
    };
    added += 1;
  }
  // 阶段按当前好感重算（改配置后旧档自动跟上）
  for (const c of chars) {
    const rel = state.player.relations[c.id];
    rel.stage = stageAt(c, rel.affinity).id;
  }
  return added;
}

/** 新局入口（语义化包装）。 */
export function initRelations(state, config) {
  if (!state || !state.player) return 0;
  state.player.relations = {};
  return ensureRelations(state, config);
}

/** 当前好感值（未初始化时按 0）。 */
export function affinityOf(state, charId) {
  const rel = state && state.player && state.player.relations
    ? state.player.relations[charId]
    : null;
  return rel ? num(rel.affinity, 0) : 0;
}

/** 当前阶段对象 { at, id, name }。 */
export function stageOf(state, config, charId) {
  const char = findCharacter(config, charId);
  if (!char) return DEFAULT_STAGE;
  return stageAt(char, affinityOf(state, charId));
}

/**
 * 改变好感（就地改 state）。负数会扣，0..max 钳制。
 * @returns {{changed:boolean, applied:number, before:number, after:number, stage:object, stageChanged:boolean, char:object|null}}
 */
export function changeAffinity(state, charId, delta, config) {
  const char = findCharacter(config, charId);
  const empty = { changed: false, applied: 0, before: 0, after: 0, stage: DEFAULT_STAGE, stageChanged: false, char };
  if (!state || !state.player || !char) return empty;
  const max = affinityMax(config);
  const rel = ensureEntry(state, charId);
  const before = num(rel.affinity, 0);
  const d = Math.round(num(delta, 0));
  if (!d) {
    return { ...empty, before, after: before, stage: stageAt(char, before), char };
  }
  const after = Math.max(0, Math.min(max, before + d));
  const applied = after - before;
  rel.affinity = after;
  const beforeStage = stageAt(char, before);
  const afterStage = stageAt(char, after);
  rel.stage = afterStage.id;
  rel.met = true;
  rel.lastTurn = num(state.turn, 0);
  return {
    changed: applied !== 0,
    applied,
    before,
    after,
    stage: afterStage,
    stageChanged: afterStage.id !== beforeStage.id,
    char,
  };
}

/** 是否已经遇见过（UI 用来把没见过的角色画成剪影）。 */
export function hasMet(state, charId) {
  const rel = state && state.player && state.player.relations
    ? state.player.relations[charId]
    : null;
  return !!(rel && rel.met);
}

/** 标记「已遇见」（事件进入 pending 时调用，让关系面板亮起来）。 */
export function markMet(state, charId, config) {
  if (!state || !state.player || !charId) return;
  if (!findCharacter(config, charId)) return;
  const rel = ensureEntry(state, charId);
  rel.met = true;
}

/**
 * 恋爱状态同步：只要有任一角色到达 id === 'lover' 的阶段，就把 player.romance 置为 dating。
 * 只在「有恋人」时写入，不清空旧值（兼容 v1 事件里直接写 romance 的写法）。
 */
export function syncRomance(state, config) {
  if (!state || !state.player) return false;
  const chars = charactersOf(config);
  let hasLover = false;
  for (const c of chars) {
    const rel = state.player.relations && state.player.relations[c.id];
    if (!rel) continue;
    const stage = stageAt(c, rel.affinity);
    if (stage.id === 'lover') hasLover = true;
  }
  if (hasLover && state.player.romance !== 'dating') {
    state.player.romance = 'dating';
    return true;
  }
  return false;
}

/**
 * 给 UI 的只读列表（按好感降序，未遇见的排后面）。
 * @returns {Array<{id,name,gender,role,title,intro,college,affinity,max,stage,stageName,met,portrait,lineId}>}
 */
export function listRelations(state, config) {
  const chars = charactersOf(config);
  const max = affinityMax(config);
  const rows = chars.map((c) => {
    const rel = (state && state.player && state.player.relations && state.player.relations[c.id]) || null;
    const aff = rel ? num(rel.affinity, 0) : num(c.initialAffinity, 0);
    const stage = stageAt(c, aff);
    return {
      id: c.id,
      name: c.name || c.id,
      gender: c.gender || '',
      role: c.role || '',
      title: c.title || '',
      intro: c.intro || '',
      college: c.college || '',
      affinity: aff,
      max,
      stage: stage.id,
      stageName: stage.name,
      met: !!(rel && rel.met),
      portrait: (c.portrait && c.portrait.file) || '',
      silhouette: !!(c.portrait && c.portrait.silhouette),
      lineId: c.lineId || '',
      likedEvents: Array.isArray(c.likedEvents) ? c.likedEvents.slice() : [],
    };
  });
  rows.sort((a, b) => {
    if (a.met !== b.met) return a.met ? -1 : 1;
    if (b.affinity !== a.affinity) return b.affinity - a.affinity;
    return a.id < b.id ? -1 : 1;
  });
  return rows;
}

/** 好感变化快照（main 层算差分用）。 */
export function snapshotAffinity(state) {
  const out = {};
  const rels = (state && state.player && state.player.relations) || {};
  for (const id of Object.keys(rels)) out[id] = num(rels[id].affinity, 0);
  return out;
}

/**
 * 对比两次快照，返回 [{charId, name, delta}]（只含变化项）。
 * @param {object} before
 * @param {object} state
 * @param {object} config
 */
export function diffAffinity(before, state, config) {
  const chars = charactersOf(config);
  const nameOf = (id) => {
    const c = chars.find((x) => x.id === id);
    return c ? (c.name || id) : id;
  };
  const out = [];
  const rels = (state && state.player && state.player.relations) || {};
  for (const id of Object.keys(rels)) {
    const prev = Number.isFinite(Number(before[id])) ? Number(before[id]) : 0;
    const now = num(rels[id].affinity, 0);
    if (now !== prev) out.push({ charId: id, name: nameOf(id), delta: now - prev });
  }
  return out;
}
