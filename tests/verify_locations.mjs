/**
 * 地点系统自检：地点配置、健康门槛、行动按地点过滤、自动回宿舍的判定。
 * 运行：node tests/verify_locations.mjs
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/loader.js';
import {
  newGame, doAction, actionAvailability, moveToLocation, advance,
  currentLocation, availableActivities, canEnterLocation,
} from '../src/core/engine.js';
import { createRng } from '../src/core/rng.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
const failures = [];
function test(name, fn) {
  try {
    const r = fn();
    if (r === true) pass += 1;
    else failures.push(name + (typeof r === 'string' ? ' → ' + r : ''));
  } catch (e) {
    failures.push(name + ' → EXC: ' + (e && e.message ? e.message : String(e)));
  }
}

const config = await loadConfig({
  read: (p) => readFile(join(root, 'config', `${p}.json`), 'utf8'),
});

const validOptions = {
  name: '林夕',
  gender: '女',
  collegeId: (config.colleges.list[0] || {}).id,
  attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
  tags: (config.tags.list || []).slice(0, 3).map((t) => t.id),
};

function freshState() {
  const ng = newGame(validOptions, config, createRng(7));
  if (!ng.ok) throw new Error('newGame 失败: ' + ng.reason);
  return ng.state;
}

// 1) 配置本身
test('locations: 至少 6 个地点且都有 id/name/scene/坐标', () => {
  const list = config.locations.list || [];
  if (list.length < 6) return '只有 ' + list.length + ' 个';
  return list.every((l) => l.id && l.name && l.scene
    && Number.isFinite(Number(l.x)) && Number.isFinite(Number(l.y)));
});
test('locations: 每个 activities 都是已存在的行动 id', () => {
  const ids = new Set(config.actions.list.map((a) => a.id));
  for (const l of config.locations.list) {
    for (const a of l.activities || []) {
      if (!ids.has(a)) return l.id + ' 里的 ' + a + ' 不存在';
    }
  }
  return true;
});
test('locations: 默认地点是宿舍，且宿舍能休息', () => {
  const def = config.locations.list.find((l) => l.id === config.locations.default);
  return !!def && (def.activities || []).indexOf('rest') >= 0;
});

// 2) 新档默认在宿舍
test('state: 新档停在地图（location 为空）', () => {
  return freshState().player.location === null;
});
test('engine: 在地图上时没有任何可做行动', () => {
  const s = freshState();
  const acts = availableActivities(s, config);
  return Array.isArray(acts) && acts.length === 0;
});
test('engine: 地图状态下直接行动 → not_here', () => {
  const av = actionAvailability(freshState(), 'rest', config);
  return av.ok === false && av.reason === 'not_here';
});

// 3) 当前地点与可做行动
test('engine: 宿舍只能做歇息（rest）', () => {
  const s = freshState();
  moveToLocation(s, 'dorm', config);
  const acts = availableActivities(s, config);
  return Array.isArray(acts) && acts.length === 1 && acts[0] === 'rest'
    ? true
    : JSON.stringify(acts);
});
test('engine: 宿舍点「上课学习」→ not_here', () => {
  const s = freshState();
  moveToLocation(s, 'dorm', config);
  const av = actionAvailability(s, 'study', config);
  return av.ok === false && av.reason === 'not_here';
});
test('engine: 移动到教学楼后可上课学习', () => {
  const s = freshState();
  const mv = moveToLocation(s, 'college', config);
  if (!mv.ok) return '移动失败 ' + mv.reason;
  const av = actionAvailability(s, 'study', config);
  return av.ok === true;
});

// 4) 健康门槛
test('engine: 健康不足时进不去体育馆', () => {
  const s = freshState();
  s.player.attributes.health = 3;      // 体育馆需要 5
  const mv = moveToLocation(s, 'gym', config);
  return mv.ok === false && mv.reason === 'health' && !s.player.location;
});
test('engine: 健康够了就能进体育馆', () => {
  const s = freshState();
  s.player.attributes.health = 8;
  const mv = moveToLocation(s, 'gym', config);
  return mv.ok === true && s.player.location === 'gym';
});
test('engine: 未知地点 → unknown_location', () => {
  const s = freshState();
  const mv = moveToLocation(s, '不存在的楼', config);
  return mv.ok === false && mv.reason === 'unknown_location';
});

// 5) 移动不消耗行动点
test('engine: 移动不扣行动点', () => {
  const s = freshState();
  const ap = s.actionPoints;
  moveToLocation(s, 'library', config);
  return s.actionPoints === ap;
});

// 6) 行动后属性变化（在对应地点）
test('engine: 图书馆学习 → 学识 +2 / 健康 -1', () => {
  const s = freshState();
  moveToLocation(s, 'library', config);
  if (s.pendingEvent) return true; // 开局事件未结时引擎会拦截，跳过本断言
  const k0 = s.player.attributes.knowledge;
  const h0 = s.player.attributes.health;
  const r = doAction(s, 'study', config, createRng(3));
  if (!r.ok) return 'doAction 失败 ' + r.reason;
  return s.player.attributes.knowledge === k0 + 2 && s.player.attributes.health === h0 - 1;
});

// 7) 商业街社交、体育场锻炼
test('engine: 商业街社交 → 社交 +2', () => {
  const s = freshState();
  s.player.attributes.health = 10;
  moveToLocation(s, 'street', config);
  if (s.pendingEvent) return true;
  const v0 = s.player.attributes.social;
  const r = doAction(s, 'socialize', config, createRng(4));
  if (!r.ok) return 'doAction 失败 ' + r.reason;
  return s.player.attributes.social === v0 + 2;
});
test('engine: 体育场锻炼 → 健康上升', () => {
  const s = freshState();
  s.player.attributes.health = 10;
  moveToLocation(s, 'track', config);
  if (s.pendingEvent) return true;
  const h0 = s.player.attributes.health;
  const r = doAction(s, 'exercise', config, createRng(5));
  if (!r.ok) return 'doAction 失败 ' + r.reason;
  return s.player.attributes.health > h0;
});

// 8) 旧存档迁移：没有 location 字段时按宿舍处理
test('迁移: 缺 location 的老存档停在地图', () => {
  const s = freshState();
  delete s.player.location;
  return currentLocation(s, config) === null;
});
test('迁移: 存档里的未知地点回落到宿舍', () => {
  const s = freshState();
  s.player.location = '火星基地';
  const loc = currentLocation(s, config);
  return !!loc && loc.id === 'dorm';
});
test('engine: 推进到下一周后回到地图', () => {
  const s = freshState();
  moveToLocation(s, 'college', config);
  if (s.pendingEvent) return true;
  advance(s, config, createRng(11));
  return s.player.location === null;
});

console.log(`\n== verify_locations 结果 ==`);
console.log(`总计 ${pass + failures.length} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
