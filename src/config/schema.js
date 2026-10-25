// SCUSim 配置校验（纯函数，无浏览器依赖，可在 Node 直接测试）
// 负责人 D。由 loader.js 调用；tests/smoke.mjs 直接调用。
// 设计目标：结构性校验 + 关键跨引用校验；不确定数值由配置自行占位，不在此硬性规定平衡值。

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function isStr(v) { return typeof v === 'string'; }
function uniq(ids) { return new Set(ids).size === ids.length; }

export function validateConfigs(c) {
  const errors = [];
  if (!isObj(c)) return { ok: false, errors: ['configs 必须是对象'] };

  const { balance, colleges, tags, actions, events, endings } = c;

  // ---- balance ----
  if (!isObj(balance)) errors.push('balance 缺失或非对象');
  else {
    if (!isStr(balance.version)) errors.push('balance.version 必须是字符串');
    if (!isNum(balance.turns) || balance.turns <= 0) errors.push('balance.turns 必须是正数');
    if (!isNum(balance.actionPointsPerTurn) || balance.actionPointsPerTurn < 0)
      errors.push('balance.actionPointsPerTurn 必须是非负数字');
    if (!isNum(balance.attributePointTotal) || balance.attributePointTotal <= 0)
      errors.push('balance.attributePointTotal 必须是正数');
    if (!Array.isArray(balance.attributeKeys) || balance.attributeKeys.length !== 4 ||
        !balance.attributeKeys.every(isStr))
      errors.push('balance.attributeKeys 必须是长度为 4 的字符串数组');
    if (!isNum(balance.randomEventBaseChance) || balance.randomEventBaseChance < 0 ||
        balance.randomEventBaseChance > 1)
      errors.push('balance.randomEventBaseChance 必须是 0..1');
    if (!isNum(balance.healthRestrictThreshold)) errors.push('balance.healthRestrictThreshold 必须是数字');
    if (!isNum(balance.warningFailedCourses) || balance.warningFailedCourses < 0)
      errors.push('balance.warningFailedCourses 必须是非负数字');
    if (!isObj(balance.exam)) errors.push('balance.exam 必须是对象');
  }

  const attrKeys = (balance && Array.isArray(balance.attributeKeys)) ? balance.attributeKeys : [];

  // ---- colleges ----
  if (!isObj(colleges) || !Array.isArray(colleges.list)) errors.push('colleges.list 必须是数组');
  else {
    const ids = [];
    for (const x of colleges.list) {
      if (!isObj(x) || !isStr(x.id) || !isStr(x.name)) errors.push('college 条目需含 id/name 字符串');
      else ids.push(x.id);
    }
    if (!uniq(ids)) errors.push('college id 重复');
    if (colleges.list.length < 8) errors.push(`college 数量不足 8（当前 ${colleges.list.length}）`);
  }

  // ---- tags ----
  if (!isObj(tags) || !Array.isArray(tags.list)) errors.push('tags.list 必须是数组');
  else {
    const ids = [];
    for (const x of tags.list) {
      if (!isObj(x) || !isStr(x.id) || !isStr(x.name)) errors.push('tag 条目需含 id/name 字符串');
      else ids.push(x.id);
    }
    if (!uniq(ids)) errors.push('tag id 重复');
    if (tags.list.length < 12) errors.push(`tag 数量不足 12（当前 ${tags.list.length}）`);
  }

  // ---- actions ----
  if (!isObj(actions) || !Array.isArray(actions.list)) errors.push('actions.list 必须是数组');
  else {
    const ids = [];
    for (const a of actions.list) {
      if (!isObj(a) || !isStr(a.id) || !isStr(a.name)) { errors.push('action 条目需含 id/name'); continue; }
      ids.push(a.id);
      if (!isNum(a.cost) || a.cost < 0) errors.push(`action ${a.id}.cost 必须是非负数字`);
      if (!isNum(a.requiresHealth) || a.requiresHealth < 0)
        errors.push(`action ${a.id}.requiresHealth 必须是非负数字`);
      if (a.effects && isObj(a.effects)) {
        const eff = a.effects.attributes || {};
        for (const k of Object.keys(eff)) {
          if (!attrKeys.includes(k)) errors.push(`action ${a.id} 效果引用了未知属性 ${k}`);
        }
      }
    }
    if (!uniq(ids)) errors.push('action id 重复');
    if (actions.list.length < 6) errors.push(`action 数量不足 6（当前 ${actions.list.length}）`);
  }

  // ---- events ----
  if (!isObj(events)) errors.push('events 必须是对象');
  else {
    const fixed = Array.isArray(events.fixed) ? events.fixed : [];
    const random = Array.isArray(events.random) ? events.random : [];
    if (fixed.length < 2) errors.push(`固定事件不足 2（当前 ${fixed.length}）`);
    if (random.length < 14) errors.push(`随机事件不足 14（当前 ${random.length}）`);
    const allIds = [];
    const checkEvent = (e, where) => {
      if (!isObj(e) || !isStr(e.id) || !isStr(e.name) || !isStr(e.text))
        { errors.push(`${where} 事件需含 id/name/text`); return; }
      allIds.push(e.id);
      if (!Array.isArray(e.options) || e.options.length === 0)
        errors.push(`事件 ${e.id} 需含非空 options`);
      else for (const o of e.options) {
        if (!isObj(o) || !isStr(o.id) || !isStr(o.label))
          errors.push(`事件 ${e.id} 的选项需含 id/label`);
        if (o.effects && isObj(o.effects)) {
          const eff = o.effects.attributes || {};
          for (const k of Object.keys(eff)) {
            if (attrKeys.length && !attrKeys.includes(k))
              errors.push(`事件 ${e.id} 选项 ${o.id} 引用了未知属性 ${k}`);
          }
        }
      }
      if (where === 'random' && (!isNum(e.weight) || e.weight < 0))
        errors.push(`随机事件 ${e.id}.weight 必须是非负数字`);
    };
    fixed.forEach((e) => checkEvent(e, 'fixed'));
    random.forEach((e) => checkEvent(e, 'random'));
    if (!uniq(allIds)) errors.push('事件 id 在 fixed/random 间重复');
  }

  // ---- endings ----
  if (!isObj(endings) || !Array.isArray(endings.list)) errors.push('endings.list 必须是数组');
  else {
    const ids = [];
    for (const e of endings.list) {
      if (!isObj(e) || !isStr(e.id) || !isStr(e.name) || !isObj(e.condition))
        { errors.push('ending 条目需含 id/name/condition'); continue; }
      if (!isNum(e.priority)) errors.push(`ending ${e.id}.priority 必须是数字`);
      ids.push(e.id);
    }
    if (!uniq(ids)) errors.push('ending id 重复');
    if (endings.list.length < 6) errors.push(`ending 数量不足 6（当前 ${endings.list.length}）`);
  }

  return { ok: errors.length === 0, errors };
}
