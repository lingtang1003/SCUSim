// SCUSim v2.1 角色系统验证（纯 Node，无需浏览器）
// 运行：node tests/verify_characters.mjs
//
// 覆盖：
//  A) 配置：characters / storylines / events-characters 加载与校验、跨表引用、角色身份规则
//  B) 初始化：新局写入 relations / storylines，全部 0 好感、idle
//  C) 玩法：迎新晚会选人 → 剧情线按窗口强制推进 → 好感累积 → 阶段跃迁 → 真结局
//  D) 分支：走保守选择 → 好感够但线未走完 → 「温暖」结局；首次冷落 → 线断 → 普通结局
//  E) 兼容：旧存档（无 relations/storylines）读取不崩、可继续推进
//  F) 确定性：同种子两次完全一致；无 Math.random
//  G) 6 名角色全部可攻略（各自跑到自己的真结局）

import { readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config/loader.js';
import { validateConfigs } from '../src/config/schema.js';
import { createRng } from '../src/core/rng.js';
import {
  newGame, advance, resolvePendingEvent, buildViewModel, getEnding,
} from '../src/core/engine.js';
import { availableOptions } from '../src/events/eventManager.js';
import { createApp } from '../src/ui/ui.js';
import * as relation from '../src/core/relation.js';
import * as storyline from '../src/core/storyline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.error(`  FAIL  ${name}  ${detail}`);
  }
}

const FILES = ['balance', 'colleges', 'tags', 'actions', 'events', 'endings', 'locations', 'characters', 'storylines', 'events-characters'];
const reader = {
  read: async (name) => {
    if (!FILES.includes(name)) throw new Error('no such config: ' + name);
    return readFile(join(root, 'config', `${name}.json`), 'utf8');
  },
};

function findEvent(config, id) {
  const ev = config.events || {};
  return [].concat(ev.fixed || [], ev.random || []).find((e) => e.id === id) || null;
}

const OPTIONS = {
  name: '测试生', gender: '男', collegeId: 'cs',
  attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
  tags: ['study_hard', 'gamer', 'chill'],
};

/**
 * 把当前 pendingEvent 用「第一个可用选项」结算（可指定某些事件的选择）。
 * @returns {{resolved:string[], failed:string|null}}
 */
function resolveForward(state, config, rng, forced = {}) {
  const resolved = [];
  let guard = 0;
  while (state.pendingEvent && state.pendingEvent.eventId && guard < 8) {
    guard++;
    const eventId = state.pendingEvent.eventId;
    const ev = findEvent(config, eventId);
    if (!ev) return { resolved, failed: 'unknown_event:' + eventId };
    const avail = availableOptions(ev, state, config);
    let choiceId = forced[eventId];
    if (!choiceId) {
      const first = avail.find((a) => a.enabled !== false);
      choiceId = first ? first.id : (avail[0] && avail[0].id);
    }
    if (!choiceId) return { resolved, failed: 'no_choice:' + eventId };
    const r = resolvePendingEvent(state, choiceId, config, rng);
    if (!r.ok) return { resolved, failed: eventId + ':' + r.reason };
    resolved.push(eventId);
  }
  return { resolved, failed: null };
}

/** 跑一整局：第 2 回合在迎新晚会上选 charId（或 'alone'）。 */
function play(config, seed, charId, forced = {}) {
  const rng = createRng(seed);
  const ng = newGame(Object.assign({}, OPTIONS, { seed }), config, rng);
  if (!ng.ok) throw new Error('newGame 失败: ' + ng.reason);
  const state = ng.state;
  const picks = Object.assign({}, forced);
  if (charId && charId !== 'alone') picks.ev_fixed_welcome = 'approach_' + charId;
  else if (charId === 'alone') picks.ev_fixed_welcome = 'alone';

  let failed = resolveForward(state, config, rng, picks).failed;
  let guard = 0;
  while (!state.endingId && state.turn < 40 && guard < 400) {
    guard++;
    advance(state, config, rng);
    const r = resolveForward(state, config, rng, picks);
    if (r.failed) { failed = r.failed; break; }
  }
  if (!state.endingId) {
    const judged = getEnding(state, config);
    if (!judged.endingId) throw new Error('未判定结局');
  }
  return { state, failed };
}

console.log('== SCUSim 角色系统验证（v2.1）==');

// =====================================================================
// A) 配置
// =====================================================================
const config = await loadConfig(reader).catch((e) => {
  console.error('  loadConfig 抛错:', e && e.errors ? e.errors.join(' | ') : e);
  return null;
});
check('A: 9 份配置加载成功', !!config);
const v = validateConfigs(config || {});
check('A: 配置通过结构校验', v.ok, v.errors.join(' | '));

const chars = (config.characters && config.characters.list) || [];
check('A: 6 名可攻略角色', chars.length === 6, '=' + chars.length);
check('A: 每名角色都有阶段表（首档 at=0）',
  chars.every((c) => Array.isArray(c.stages) && c.stages.length >= 3 && c.stages[0].at === 0));
check('A: 每名角色都有剧情线且 lineId 对得上',
  chars.every((c) => {
    const line = (config.storylines.lines || []).find((l) => l.id === c.lineId);
    return !!line && line.charId === c.id;
  }));

// 可攻略角色必须是在读学生，不能是老师/辅导员这类身份
const BAD_ROLE = ['老师', '老师', '教授', '导师', '教师', '辅导员', '班主任', '讲师', '助教'];
check('A: 没有「师生关系」角色（全部为学生）',
  chars.every((c) => !BAD_ROLE.some((k) => String(c.role || '').includes(k) || String(c.title || '').includes(k))),
  chars.map((c) => c.role).join(' / '));

// 有立绘的角色要真的能在磁盘上找到文件
const withArt = chars.filter((c) => c.portrait && c.portrait.file);
let artOk = true;
const artMissing = [];
for (const c of withArt) {
  const p = join(root, c.portrait.file);
  try {
    const st = await stat(p);
    if (!st.isFile() || st.size < 1000) { artOk = false; artMissing.push(c.id); }
  } catch (_) {
    artOk = false;
    artMissing.push(c.id);
  }
}
check('A: 有立绘的角色文件都存在', artOk, artMissing.join(','));
check('A: 6 名角色都有正式立绘（不再是剪影占位）', withArt.length === chars.length, '=' + withArt.length);

// 剧情线：步骤事件都存在、窗口合法、next 指向合法
const S = config.storylines.lines || [];
check('A: 6 条剧情线', S.length === 6, '=' + S.length);
check('A: 每条线 3–4 步且事件都存在',
  S.every((l) => l.steps.length >= 3 && l.steps.every((s) => !!findEvent(config, s.eventId))));
check('A: 剧情事件都标了 storylineOnly + once + charId',
  S.every((l) => l.steps.every((s) => {
    const e = findEvent(config, s.eventId);
    return e && e.storylineOnly === true && e.once === true && e.charId === l.charId;
  })));

// =====================================================================
// B) 新局初始化
// =====================================================================
const g0 = newGame(Object.assign({}, OPTIONS, { seed: 4242 }), config, createRng(4242));
const s0 = g0.state;
check('B: 新局写入 6 条关系，好感全 0、未遇见',
  Object.keys(s0.player.relations || {}).length === 6
  && Object.values(s0.player.relations).every((r) => r.affinity === 0 && r.met === false));
check('B: 新局写入 6 条剧情线，全部 idle',
  Object.keys(s0.storylines || {}).length === 6
  && Object.values(s0.storylines).every((x) => x.status === 'idle' && x.step === 0));
check('B: buildViewModel 带出关系列表与线进度',
  Array.isArray(buildViewModel(s0, config).relations)
  && buildViewModel(s0, config).relations.length === 6);

// =====================================================================
// C) 林予线端到端 → 真结局
// =====================================================================
const lin = play(config, 2024, 'linyu');
check('C: 林予线没有卡死', !lin.failed, lin.failed || '');
check('C: 迎新晚会记住选择（route_linyu）', lin.state.player.flags.route_linyu === true);
check('C: 走完林予线（done）', storyline.progressOf(lin.state, config, 'line_linyu').status === 'done');
check('C: 好感 ≥ 55（恋人档）',
  relation.affinityOf(lin.state, 'linyu') >= 55,
  '=' + relation.affinityOf(lin.state, 'linyu'));
check('C: 阶段到恋人', relation.stageOf(lin.state, config, 'linyu').id === 'lover');
check('C: 结局是林予真结局', lin.state.endingId === 'ending_linyu_true', lin.state.endingId);

// 事件总数：剧情事件不应重复触发
const hist = lin.state.eventHistory || [];
const dup = hist.filter((id, i) => hist.indexOf(id) !== i && findEvent(config, id).storylineOnly);
check('C: 剧情事件不重复触发', dup.length === 0, dup.join(','));

// =====================================================================
// D) 分支：保守选择 → 温暖结局；首次冷落 → 线断
// =====================================================================
// 江叙：date 步选次选（seat +2）→ 好感停在 30–54、线未走完 → 温暖结局（warm 不要求 done）
const jxWarm = play(config, 777, 'jiangxu', {
  ev_story_jiangxu_3: 'seat',
});
check('D: 保守选择线未走完', storyline.progressOf(jxWarm.state, config, 'line_jiangxu').status !== 'done');
check('D: 好感 30–54 之间',
  relation.affinityOf(jxWarm.state, 'jiangxu') >= 30 && relation.affinityOf(jxWarm.state, 'jiangxu') < 55,
  '=' + relation.affinityOf(jxWarm.state, 'jiangxu'));
check('D: 结局是「没说完的话」', jxWarm.state.endingId === 'ending_jiangxu_warm', jxWarm.state.endingId);

// 江叙：初遇就选次选（greet +2）→ 好感达不到后续门槛，窗口过期 → 线断
const jxHalf = play(config, 778, 'jiangxu', { ev_story_jiangxu_1: 'greet' });
check('D: 半途而废的选择会让线断在最后一步之前',
  storyline.progressOf(jxHalf.state, config, 'line_jiangxu').status === 'broken',
  storyline.progressOf(jxHalf.state, config, 'line_jiangxu').status + ' / ' + relation.affinityOf(jxHalf.state, 'jiangxu'));

// 林予：第一次就选了「默默看书」→ 好感只有 6 → 第 2 步门槛 8 过不去 → 窗口过期后线断
const linCold = play(config, 31337, 'linyu', { ev_r23: 'ignore' });
check('D: 冷落会让剧情线中断',
  storyline.progressOf(linCold.state, config, 'line_linyu').status === 'broken',
  storyline.progressOf(linCold.state, config, 'line_linyu').status);
check('D: 线断后落到普通结局',
  !String(linCold.state.endingId || '').includes('linyu'), linCold.state.endingId);

// 谁都不选：不产生任何关系结局
const alone = play(config, 909, 'alone');
check('D: 谁都不选时没有任何角色结局',
  !String(alone.state.endingId || '').startsWith('ending_jiangxu')
  && !String(alone.state.endingId || '').startsWith('ending_guchi')
  && !String(alone.state.endingId || '').startsWith('ending_linyu')
  && !String(alone.state.endingId || '').startsWith('ending_suwan')
  && !String(alone.state.endingId || '').startsWith('ending_zhouye')
  && !String(alone.state.endingId || '').startsWith('ending_tangtang'),
  alone.state.endingId);

// =====================================================================
// E) 旧存档兼容（v1 状态里没有 relations / storylines）
// =====================================================================
const old = JSON.parse(JSON.stringify(s0));
delete old.player.relations;
delete old.storylines;
check('E: 旧状态能被补全（不崩、不覆盖已有数据）',
  (() => {
    try {
      const vm = buildViewModel(old, config);
      return Object.keys(old.player.relations || {}).length === 6
        && Object.keys(old.storylines || {}).length === 6
        && Array.isArray(vm.relations);
    } catch (_) { return false; }
  })());
check('E: 旧状态推进回合不抛错',
  (() => {
    try {
      const rng = createRng(5);
      const st = JSON.parse(JSON.stringify(old));
      advance(st, config, rng);
      return true;
    } catch (_) { return false; }
  })());

// =====================================================================
// F) 确定性
// =====================================================================
const d1 = play(config, 123, 'suwan');
const d2 = play(config, 123, 'suwan');
check('F: 同种子同选择 → 完全一致',
  d1.state.endingId === d2.state.endingId
  && relation.affinityOf(d1.state, 'suwan') === relation.affinityOf(d2.state, 'suwan')
  && JSON.stringify(d1.state.eventHistory) === JSON.stringify(d2.state.eventHistory));

// =====================================================================
// G) 6 名角色各自都能走到真结局
// =====================================================================
for (const c of chars) {
  const r = play(config, 8888, c.id);
  const affinity = relation.affinityOf(r.state, c.id);
  const status = storyline.progressOf(r.state, config, c.lineId).status;
  check(`G: ${c.name} 能走到真结局（好感 ${affinity} / ${status}）`,
    !r.failed && status === 'done' && r.state.endingId === `ending_${c.id}_true`,
    `ending=${r.state.endingId} affinity=${affinity} status=${status} failed=${r.failed || ''}`);
}

// =====================================================================
// H) UI 结构（最小 DOM 桩：台词分段、NPC 立绘、好感提示、关系面板）
// =====================================================================
function makeEl(tag = 'div') {
  const children = [];
  const listeners = {};
  const el = {
    tagName: tag, nodeType: 1, className: '', _text: '', style: {}, dataset: {},
    children, parentNode: null, disabled: false,
    classList: {
      add: (...c) => { const set = new Set(String(el.className || '').split(/\s+/).filter(Boolean)); c.forEach((x) => set.add(x)); el.className = Array.from(set).join(' '); },
      remove: (...c) => { const set = new Set(String(el.className || '').split(/\s+/).filter(Boolean)); c.forEach((x) => set.delete(x)); el.className = Array.from(set).join(' '); },
      contains: (c) => String(el.className || '').split(/\s+/).includes(c),
    },
    appendChild(child) { child.parentNode = el; children.push(child); return child; },
    removeChild(child) { const i = children.indexOf(child); if (i >= 0) children.splice(i, 1); return child; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { el['attr_' + k] = v; if (k === 'style') el.attr_style = v; },
    getAttribute(k) { return el['attr_' + k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    click() { (listeners.click || []).forEach((fn) => fn({ target: el, currentTarget: el })); },
    get textContent() {
      if (el._text) return el._text;
      return children.map((c) => (c && c.textContent != null ? String(c.textContent) : '')).join('');
    },
    set textContent(v) { el._text = String(v); },
    _listeners: listeners,
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html || ''; },
    set(v) { el._html = v; if (v === '') children.length = 0; },
  });
  return el;
}

function walkEl(node, out = []) {
  for (const c of node.children || []) {
    if (c && c.nodeType === 1) { out.push(c); walkEl(c, out); }
  }
  return out;
}
function byClass(root, cls) {
  return walkEl(root).filter((el) => String(el.className || '').split(/\s+/).includes(cls));
}
function makeStubDoc() {
  return {
    createElement: (t) => makeEl(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    getElementById: () => makeEl(),
    querySelector: () => null,
    body: makeEl('body'),
    documentElement: makeEl('html'),
  };
}

// 走到「第 3 回合、林予线第一步刚触发」的中间态
const rngUi = createRng(555);
const sUi = newGame(Object.assign({}, OPTIONS, { seed: 555 }), config, rngUi).state;
resolveForward(sUi, config, rngUi, {});
advance(sUi, config, rngUi);
resolveForward(sUi, config, rngUi, { ev_fixed_welcome: 'approach_linyu' });
advance(sUi, config, rngUi);
check('H: 准备了第 3 回合的剧情事件', !!sUi.pendingEvent && sUi.pendingEvent.eventId === 'ev_r23',
  sUi.pendingEvent && sUi.pendingEvent.eventId);

const docUi = makeStubDoc();
const rootUi = makeEl('div');
const appUi = createApp({ config, callbacks: {}, doc: docUi, appearance: 'm_short1' });
appUi.mount(rootUi, { hasSave: true });
let renderOk = true;
try {
  appUi.render(sUi, buildViewModel(sUi, config));
} catch (e) {
  renderOk = false;
  console.error('  render 抛错:', e && e.message);
}
check('H: render 不抛错', renderOk);
check('H: HUD 出关系入口', byClass(rootUi, 'vn-icon').some((b) => b.textContent === '♡'));

let eventOk = true;
try {
  appUi.showEvent(sUi.pendingEvent);
} catch (e) {
  eventOk = false;
  console.error('  showEvent 抛错:', e && e.message);
}
check('H: showEvent 不抛错', eventOk);
const evNode = byClass(rootUi, 'vn-event')[0];
check('H: 事件弹层里有 NPC 立绘', !!evNode && byClass(evNode, 'vn-npc').length === 1);
const artEl = evNode ? byClass(evNode, 'vn-npc__art')[0] : null;
check('H: 立绘背景指向 linyu.webp',
  !!artEl && String(artEl.attr_style || '').includes('linyu.webp'),
  artEl ? artEl.attr_style : 'no art');
check('H: 立绘走 cutout 模式（透明底、不套白卡）',
  !!evNode && byClass(evNode, 'vn-npc--cutout').length === 1);
check('H: cutout 不画名牌（名牌在对话框上）',
  !!evNode && byClass(evNode, 'vn-npc__plate').length === 0);
check('H: 台词播放中选项处于等待态（is-waiting）',
  !!evNode && byClass(evNode, 'is-waiting').length === 1);

const speakerEl = evNode ? byClass(evNode, 'vn-speaker')[0] : null;
check('H: 第一段是旁白', !!speakerEl && speakerEl.textContent === '旁白', speakerEl && speakerEl.textContent);
const boxEl = evNode ? byClass(evNode, 'vn-dialogue__box--event')[0] : null;
if (boxEl) boxEl.click();
check('H: 点一下切到角色台词', !!speakerEl && speakerEl.textContent === '林予', speakerEl && speakerEl.textContent);
if (boxEl) { boxEl.click(); boxEl.click(); }
check('H: 台词播完后选项出现',
  !!evNode && byClass(evNode, 'is-waiting').length === 0);
check('H: 选项上显示好感提示',
  !!evNode && byClass(evNode, 'vn-choice__meta').some((m) => String(m.textContent).includes('好感')));

// 关系面板
let relOk = true;
try {
  appUi.showRelations();
} catch (e) {
  relOk = false;
  console.error('  showRelations 抛错:', e && e.message);
}
check('H: showRelations 不抛错', relOk);
check('H: 关系面板 6 张人物卡', byClass(rootUi, 'vn-rel__card').length === 6,
  String(byClass(rootUi, 'vn-rel__card').length));
check('H: 已遇见的林予显示真名',
  byClass(rootUi, 'vn-rel__name').some((n) => n.textContent === '林予'));
check('H: 未遇见的角色显示为「？？？」',
  byClass(rootUi, 'vn-rel__name').filter((n) => n.textContent === '？？？').length >= 4);

// =====================================================================
console.log(`\n总计 ${pass + failures.length} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
