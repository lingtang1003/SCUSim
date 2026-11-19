// 标签属性修正自检（纯 Node）
// 运行：node tests/verify_tags.mjs
//
// 覆盖：
//  A) 12 个标签，每个都有属性加成与代价，且数值在合理区间
//  B) 三标签叠加后，开局属性 = 分配值 + 修正合计（非 money 下限 0、money 可为负）
//  C) 标签权重引用的都是存在的随机事件
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config/loader.js';
import { createRng } from '../src/core/rng.js';
import { newGame } from '../src/core/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = await loadConfig({
  read: (p) => readFile(join(root, 'config', `${p}.json`), 'utf8'),
});

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.error(`  FAIL  ${name}  ${detail}`); }
}

const tags = config.tags.list;
const ATTRS = config.balance.attributeKeys;
const eventIds = new Set([]
  .concat(config.events.fixed || [], config.events.random || [])
  .map((e) => e.id));

function modsOf(tag) {
  const m = (tag.modifiers && (tag.modifiers.attributes || tag.modifiers)) || {};
  const out = {};
  for (const k of ATTRS) {
    const v = Number(m[k]);
    if (Number.isFinite(v) && v !== 0) out[k] = v;
  }
  return out;
}

function sumOf(ids) {
  const sum = {};
  for (const id of ids) {
    const tag = tags.find((t) => t.id === id);
    for (const [k, v] of Object.entries(modsOf(tag))) sum[k] = (sum[k] || 0) + v;
  }
  return sum;
}

function expectedAttrs(base, ids) {
  const sum = sumOf(ids);
  const out = {};
  for (const k of ATTRS) {
    const raw = (Number(base[k]) || 0) + (Number(sum[k]) || 0);
    out[k] = k === 'money' ? raw : Math.max(0, raw);
  }
  return out;
}

console.log('== SCUSim 标签属性自检 ==');

// ---------------------------------------------------------------------------
// A) 数据规则
// ---------------------------------------------------------------------------
check('A: 12 个标签', tags.length === 12, String(tags.length));
check('A: id 唯一', new Set(tags.map((t) => t.id)).size === tags.length);

const badShape = [];
const badRange = [];
const badSign = [];
const badNet = [];
for (const t of tags) {
  const mods = modsOf(t);
  const keys = Object.keys(mods);
  const vals = keys.map((k) => mods[k]);
  if (keys.length < 2 || !keys.every((k) => ATTRS.includes(k))) badShape.push(t.id);
  if (vals.some((v) => Math.abs(v) > 3)) badRange.push(t.id);
  if (!vals.some((v) => v > 0) || !vals.some((v) => v < 0)) badSign.push(t.id);
  const net = vals.reduce((a, b) => a + b, 0);
  if (net < -1 || net > 3) badNet.push(`${t.id}(${net})`);
}
check('A: 每个标签至少改 2 个合法属性', badShape.length === 0, badShape.join(','));
check('A: 单项修正不超过 ±3', badRange.length === 0, badRange.join(','));
check('A: 每个标签都同时有加成和代价', badSign.length === 0, badSign.join(','));
check('A: 净收益在 -1 ~ +3 之间', badNet.length === 0, badNet.join(','));

// 三条叠加不会太离谱（净收益 ≤ +6）
const TOP3 = ['study_hard', 'grind', 'researcher'];
check('A: 同类标签叠满也不会爆表（净收益 ≤ +6）',
  Object.values(sumOf(TOP3)).reduce((a, b) => a + b, 0) <= 6,
  JSON.stringify(sumOf(TOP3)));

// ---------------------------------------------------------------------------
// B) 引擎接线：新局属性 = 分配值 + 修正合计
// ---------------------------------------------------------------------------
const base20 = { knowledge: 5, social: 5, health: 5, money: 5 };
const cases = [
  ['吃货 + 运动达人 + 游戏宅', base20, ['foodie', 'athlete', 'gamer']],
  ['学霸 + 卷王 + 科研党', base20, ['study_hard', 'grind', 'researcher']],
  ['社牛 + 社团达人 + 文艺青年', base20, ['social_butterfly', 'club_nerd', 'artist']],
  ['创业青年 + 佛系 + 夜猫子', base20, ['startup', 'chill', 'night_owl']],
];
let ok = true;
const detail = [];
for (const [label, base, ids] of cases) {
  const ng = newGame({
    name: '标签生', gender: '男', collegeId: 'cs',
    attributes: base, tags: ids, seed: 7,
  }, config, createRng(7));
  if (!ng.ok) { ok = false; detail.push(label + ' newGame 失败:' + ng.reason); continue; }
  const want = expectedAttrs(base, ids);
  const got = ng.state.player.attributes;
  const same = ATTRS.every((k) => got[k] === want[k]);
  if (!same) { ok = false; detail.push(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
check('B: 4 组三标签组合的属性合计正确', ok, detail.join(' | '));

// 非 money 属性下限 0
const clampNg = newGame({
  name: '钳制生', gender: '女', collegeId: 'cs',
  attributes: { knowledge: 6, social: 0, health: 1, money: 13 },
  tags: ['study_hard', 'grind', 'researcher'], seed: 9,
}, config, createRng(9));
check('B: 修正把社交压到负数时钳到 0',
  clampNg.ok && clampNg.state.player.attributes.social === 0,
  clampNg.ok ? String(clampNg.state.player.attributes.social) : clampNg.reason);

// money 允许为负（标签是开局负债的来源之一）
const negNg = newGame({
  name: '负钱生', gender: '男', collegeId: 'cs',
  attributes: { knowledge: 5, social: 5, health: 10, money: 0 },
  tags: ['foodie', 'study_hard', 'gamer'], seed: 11,
}, config, createRng(11));
check('B: 金钱可以因标签变成负数',
  negNg.ok && negNg.state.player.attributes.money < 0,
  negNg.ok ? String(negNg.state.player.attributes.money) : negNg.reason);

// ---------------------------------------------------------------------------
// C) 权重引用
// ---------------------------------------------------------------------------
const badRef = [];
for (const t of tags) {
  for (const id of Object.keys(t.eventWeights || {})) {
    if (!eventIds.has(id)) badRef.push(`${t.id} → ${id}`);
  }
}
check('C: eventWeights 引用的都是存在的事件', badRef.length === 0, badRef.join(','));

// ---------------------------------------------------------------------------
// D) UI 接线（源码级，防止渲染被误删；视觉由浏览器手测）
// ---------------------------------------------------------------------------
const uiSrc = await readFile(join(root, 'src', 'ui', 'ui.js'), 'utf8');
check('D: 标签卡渲染属性修正药丸', uiSrc.includes('vn-tag__mods') && uiSrc.includes('tagMods(t)'));
check('D: 标签页显示「属性合计」', uiSrc.includes('vn-tag-sum') && uiSrc.includes('selectedTagMods(selected)'));
check('D: 右侧预览显示修正后的属性', uiSrc.includes('vn-create__attr-mod'));

console.log(`\n总计 ${pass + failures.length} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
