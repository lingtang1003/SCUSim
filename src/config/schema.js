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

  // ---- characters（v2.1，可选：缺省时整个角色系统关闭） ----
  const charIds = [];
  if (c.characters !== undefined) {
    if (!isObj(c.characters) || !Array.isArray(c.characters.list)) {
      errors.push('characters.list 必须是数组');
    } else {
      if (c.characters.list.length === 0) errors.push('characters.list 不能为空');
      for (const ch of c.characters.list) {
        if (!isObj(ch) || !isStr(ch.id) || !isStr(ch.name)) {
          errors.push('character 条目需含 id/name 字符串');
          continue;
        }
        if (charIds.includes(ch.id)) errors.push(`character id 重复：${ch.id}`);
        charIds.push(ch.id);
        if (!Array.isArray(ch.stages) || ch.stages.length === 0) {
          errors.push(`character ${ch.id}.stages 必须是非空数组`);
        } else {
          let prev = -Infinity;
          for (const s of ch.stages) {
            if (!isObj(s) || !isNum(s.at) || !isStr(s.id)) {
              errors.push(`character ${ch.id} 的 stages 需含 at(数字)/id(字符串)`);
              continue;
            }
            if (s.at < prev) errors.push(`character ${ch.id} 的 stages.at 必须升序`);
            prev = s.at;
          }
          if (ch.stages[0] && ch.stages[0].at !== 0) {
            errors.push(`character ${ch.id} 的 stages 首档 at 必须为 0`);
          }
        }
        if (ch.initialAffinity !== undefined && (!isNum(ch.initialAffinity) || ch.initialAffinity < 0)) {
          errors.push(`character ${ch.id}.initialAffinity 必须是非负数字`);
        }
        if (ch.portrait !== undefined && !isObj(ch.portrait)) {
          errors.push(`character ${ch.id}.portrait 必须是对象`);
        }
        if (ch.likedEvents !== undefined && !Array.isArray(ch.likedEvents)) {
          errors.push(`character ${ch.id}.likedEvents 必须是数组`);
        }
      }
    }
  }

  // ---- events（v2.1 增补：charId / lines / relation 效果） ----
  const allEventIds = [];
  if (isObj(events)) {
    const list = [].concat(
      Array.isArray(events.fixed) ? events.fixed : [],
      Array.isArray(events.random) ? events.random : []
    );
    for (const e of list) {
      if (!isObj(e)) continue;
      if (isStr(e.id)) allEventIds.push(e.id);
      if (e.charId !== undefined && !isStr(e.charId)) {
        errors.push(`事件 ${e.id}.charId 必须是字符串`);
      }
      if (e.lines !== undefined) {
        if (!Array.isArray(e.lines) || e.lines.length === 0) {
          errors.push(`事件 ${e.id}.lines 必须是非空数组`);
        } else for (const l of e.lines) {
          if (!isObj(l) || !isStr(l.text)) errors.push(`事件 ${e.id} 的 lines 每段需含 text 字符串`);
        }
      }
      if (e.storylineOnly !== undefined && typeof e.storylineOnly !== 'boolean') {
        errors.push(`事件 ${e.id}.storylineOnly 必须是布尔值`);
      }
      for (const o of (Array.isArray(e.options) ? e.options : [])) {
        if (!isObj(o)) continue;
        const rel = o.effects && o.effects.relation;
        if (rel !== undefined && !isObj(rel)) {
          errors.push(`事件 ${e.id} 选项 ${o.id} 的 effects.relation 必须是对象`);
        }
        const reqRel = o.requires && o.requires.relationAtLeast;
        if (reqRel !== undefined && (!isObj(reqRel) || !isStr(reqRel.charId) || !isNum(reqRel.value))) {
          errors.push(`事件 ${e.id} 选项 ${o.id} 的 requires.relationAtLeast 需含 charId/value`);
        }
      }
    }
  }

  // 跨表引用：事件 / 剧情线里出现的角色必须存在
  if (charIds.length) {
    if (isObj(events)) {
      const list = [].concat(
        Array.isArray(events.fixed) ? events.fixed : [],
        Array.isArray(events.random) ? events.random : []
      );
      for (const e of list) {
        if (!isObj(e)) continue;
        if (isStr(e.charId) && !charIds.includes(e.charId)) {
          errors.push(`事件 ${e.id} 引用了不存在的角色 ${e.charId}`);
        }
        for (const o of (Array.isArray(e.options) ? e.options : [])) {
          const rel = o && o.effects && o.effects.relation;
          if (isObj(rel)) {
            for (const k of Object.keys(rel)) {
              if (!charIds.includes(k)) errors.push(`事件 ${e.id} 选项 ${o.id} 的效果引用了不存在的角色 ${k}`);
            }
          }
          const reqRel = o && o.requires && o.requires.relationAtLeast;
          if (isObj(reqRel) && isStr(reqRel.charId) && !charIds.includes(reqRel.charId)) {
            errors.push(`事件 ${e.id} 选项 ${o.id} 的前置引用了不存在的角色 ${reqRel.charId}`);
          }
        }
      }
    }
  }

  // ---- storylines（v2.1，可选） ----
  if (c.storylines !== undefined) {
    if (!isObj(c.storylines) || !Array.isArray(c.storylines.lines)) {
      errors.push('storylines.lines 必须是数组');
    } else {
      const lineIds = [];
      for (const line of c.storylines.lines) {
        if (!isObj(line) || !isStr(line.id) || !isStr(line.name)) {
          errors.push('storyline 条目需含 id/name 字符串');
          continue;
        }
        if (lineIds.includes(line.id)) errors.push(`storyline id 重复：${line.id}`);
        lineIds.push(line.id);
        if (line.charId !== undefined && charIds.length && !charIds.includes(line.charId)) {
          errors.push(`storyline ${line.id} 引用了不存在的角色 ${line.charId}`);
        }
        if (!Array.isArray(line.steps) || line.steps.length === 0) {
          errors.push(`storyline ${line.id}.steps 必须是非空数组`);
          continue;
        }
        const stepIds = line.steps.map((s) => (isObj(s) ? s.id : null)).filter(isStr);
        for (const s of line.steps) {
          if (!isObj(s) || !isStr(s.id) || !isStr(s.eventId)) {
            errors.push(`storyline ${line.id} 的 step 需含 id/eventId`);
            continue;
          }
          if (allEventIds.length && !allEventIds.includes(s.eventId)) {
            errors.push(`storyline ${line.id} 的 step ${s.id} 引用了不存在的事件 ${s.eventId}`);
          }
          // 用局部变量取窗口字段（避免被静态红线扫描误判成浏览器全局对象）
          const win = s['window'];
          if (win !== undefined) {
            if (!Array.isArray(win) || win.length !== 2 ||
                !win.every((v) => isNum(v)) || win[0] > win[1]) {
              errors.push(`storyline ${line.id} 的 step ${s.id}.window 必须是 [起, 止] 升序数字`);
            }
          }
          if (s.next !== undefined) {
            if (!isObj(s.next)) {
              errors.push(`storyline ${line.id} 的 step ${s.id}.next 必须是对象`);
            } else for (const k of Object.keys(s.next)) {
              const target = s.next[k];
              const ok = target === '@break' || target === '@done' ||
                (isStr(target) && stepIds.includes(target));
              if (!ok) errors.push(`storyline ${line.id} 的 step ${s.id}.next.${k} 指向了不存在的步骤 ${target}`);
            }
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
