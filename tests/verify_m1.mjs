// SCUSim M1 独立验证脚本（QA · 严过关）
// 运行：node tests/verify_m1.mjs
// 与 smoke.mjs 完全独立（不修改它），自行覆盖 M1 边界/异常用例。
//
// 覆盖范围：
//   1) RNG：复现性 / 边界 / chance 极值 / fork 分叉
//   2) State：createGameState 初值 / clone 深拷贝
//   3) Engine.newGame：合法 / 属性和非 20 / 缺 collegeId / 非法 tags
//   4) Engine.actionAvailability：health 受限 / AP 不足
//   5) Engine.doAction：AP=0 拒绝且不变 / study 效果与计数 / log 追加
//   6) Engine.advance：耗尽 AP 跑满 40 回合 / endingId 非空 / pendingEvent 至多一个
//   7) Engine.resolvePendingEvent：有效 choice / 无效 choice
//   8) Engine.getEnding：knowledge>=30 → ending_academic_star
//   9) 复现性：同种子+同操作序列两次关键字段一致
//  10) 存档：serialize→deserialize 一致 / 版本不兼容 / 畸形文本 / 图鉴去重
//  11) loadConfig：6 key 装配 / 缺 colleges 拒绝且 errors 非空
//  12) 静态约束：src/core、src/events、src/config 无 Math.random/indexedDB/localStorage/document./window.

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRng } from '../src/core/rng.js';
import { createGameState, clone } from '../src/core/state.js';
import {
  newGame, actionAvailability, doAction, advance, resolvePendingEvent, getEnding,
} from '../src/core/engine.js';
import {
  serializeSave, deserializeSave, addGalleryUnlocked, checkSaveVersion,
} from '../src/storage/storage.js';
import { loadConfig } from '../src/config/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.error(`  FAIL  ${name}  ${detail}`); }
}

// 注册测试（支持同步/异步 fn；返回 true=PASS，返回字符串=FAIL 且字符串为详情）
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// 文件读取器（注入 loadConfig，与 smoke 实现相互独立）
function makeFileReader(base) {
  return { read: (path) => readFile(join(base, 'config', `${path}.json`), 'utf8') };
}

// 测试用角色（属性四项和 === 20；collegeId / tags 均合法）
const validOptions = {
  name: '验证员', gender: '男', collegeId: 'cs',
  attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
  tags: ['study_hard', 'gamer', 'chill'],
  seed: 2024,
};

// 通用：从开局按固定策略跑到终局（耗尽 AP → advance），用于复现性与存档测试
function runToEnd(seed, cfg, rngFactory) {
  const r = rngFactory(seed);
  const ng = newGame(validOptions, cfg, r);
  if (!ng.ok) throw new Error('newGame 失败: ' + ng.reason);
  const s = ng.state;
  let guard = 0;
  while (s.turn < 40 && !s.endingId && guard < 1000) {
    guard++;
    let inner = 0;
    while (s.actionPoints > 0 && inner < 100) {
      inner++;
      const av = cfg.actions.list.find((a) => actionAvailability(s, a.id, cfg).ok);
      if (!av) break;
      const dr = doAction(s, av.id, cfg, r);
      if (!dr.ok) break;
    }
    if (s.turn >= 40 || s.endingId) break;
    const ad = advance(s, cfg, r);
    if (!ad.ok) break;
  }
  return s;
}

// ---------------- 1) RNG ----------------
test('RNG: createRng(123) 两实例 next() 序列完全一致', () => {
  const a = createRng(123), b = createRng(123);
  for (let i = 0; i < 20; i++) if (a.next() !== b.next()) return '序列在第' + i + '步分歧';
  return true;
});
test('RNG: next() ∈ [0,1)', () => {
  const r = createRng(999);
  for (let i = 0; i < 2000; i++) {
    const x = r.next();
    if (!(x >= 0 && x < 1)) return 'x=' + x;
  }
  return true;
});
test('RNG: int(1,6) 多次落在闭区间 [1,6] 且为整数', () => {
  const r = createRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(1, 6);
    if (!Number.isInteger(v) || v < 1 || v > 6) return 'v=' + v;
  }
  return true;
});
test('RNG: chance(0)===false 且 chance(1)===true（极值确定）', () => {
  const r = createRng(1);
  return r.chance(0) === false && r.chance(1) === true;
});
test('RNG: fork() 后父/子发生器分叉', () => {
  const p = createRng(123);
  const c = p.fork();
  const pa = [], ca = [];
  for (let i = 0; i < 8; i++) { pa.push(p.next()); ca.push(c.next()); }
  return JSON.stringify(pa) !== JSON.stringify(ca);
});

// ---------------- 2) State ----------------
test('State: createGameState 初值正确', () => {
  const s = createGameState(validOptions);
  return s.version === '1.0.0'
    && s.turn === 1
    && s.actionPoints === 4
    && Array.isArray(s.academics.semesterScores) && s.academics.semesterScores.length === 0
    && s.academics.failedCourses === 0
    && s.academics.warning === false
    && s.academics.studyActions === 0
    && Array.isArray(s.eventHistory) && s.eventHistory.length === 0
    && Array.isArray(s.log) && s.log.length === 0
    && s.endingId === null
    && s.player.name === '验证员' && s.player.gender === '男' && s.player.collegeId === 'cs'
    && s.player.attributes.knowledge === 5 && s.player.attributes.social === 5
    && s.player.attributes.health === 5 && s.player.attributes.money === 5
    && JSON.stringify(s.player.tags) === JSON.stringify(['study_hard', 'gamer', 'chill'])
    && typeof s.rngState === 'number';
});
test('State: clone(s) 深拷贝（player 不同引用，JSON 相等）', () => {
  const s = createGameState(validOptions);
  s.player.attributes.knowledge = 9;
  const c = clone(s);
  return c.player !== s.player && JSON.stringify(c) === JSON.stringify(s);
});

// ---------------- 3) Engine.newGame ----------------
test('Engine: newGame 合法 → {ok:true} / turn=1 / actionPoints=4 / rngState 为数字', () => {
  const ng = newGame(validOptions, config, createRng(2024));
  return ng.ok === true && ng.state.turn === 1 && ng.state.actionPoints === 4
    && typeof ng.state.rngState === 'number';
});
test('Engine: 属性四项和≠20 → {ok:false, reason:"attributes"}', () => {
  const bad = { ...validOptions, attributes: { knowledge: 5, social: 5, health: 5, money: 4 } };
  const ng = newGame(bad, config, createRng(1));
  return ng.ok === false && ng.reason === 'attributes';
});
test('Engine: 缺 collegeId → {ok:false, reason:"collegeId"}', () => {
  const bad = { ...validOptions }; delete bad.collegeId;
  const ng = newGame(bad, config, createRng(1));
  return ng.ok === false && ng.reason === 'collegeId';
});
test('Engine: 非法 tags（仅 2 个）→ {ok:false, reason:"tags"}', () => {
  const bad = { ...validOptions, tags: ['study_hard', 'gamer'] };
  const ng = newGame(bad, config, createRng(1));
  return ng.ok === false && ng.reason === 'tags';
});

// ---------------- 4) Engine.actionAvailability ----------------
test('Engine: health < requiresHealth → {ok:false, reason:"health"}', () => {
  const ng = newGame(validOptions, config, createRng(1));
  const s = ng.state;
  s.player.attributes.health = 1; // exercise.requiresHealth=2
  const av = actionAvailability(s, 'exercise', config);
  return av.ok === false && av.reason === 'health';
});
test('Engine: actionPoints < cost → {ok:false, reason:"AP"}', () => {
  const ng = newGame(validOptions, config, createRng(1));
  const s = ng.state;
  s.actionPoints = 0; s.player.attributes.health = 5;
  const av = actionAvailability(s, 'exercise', config);
  return av.ok === false && av.reason === 'AP';
});

// ---------------- 5) Engine.doAction ----------------
test('Engine: actionPoints===0 时 doAction → {ok:false,reason:"AP"} 且 state 不变', () => {
  const ng = newGame(validOptions, config, createRng(1));
  const s = ng.state; s.actionPoints = 0;
  const snapshot = JSON.stringify(s);
  const r = doAction(s, 'study', config, createRng(2));
  return r.ok === false && r.reason === 'AP' && JSON.stringify(s) === snapshot;
});
test('Engine: doAction("study") → AP 4→3 / studyActions+1 / 效果生效 / log 追加', () => {
  const ng = newGame(validOptions, config, createRng(1));
  const s = ng.state;
  const beforeLog = s.log.length;
  const r = doAction(s, 'study', config, createRng(2));
  return r.ok === true
    && s.actionPoints === 3
    && s.academics.studyActions === 1
    && s.player.attributes.knowledge === 7   // 5 + 2
    && s.player.attributes.health === 4      // 5 - 1
    && s.log.length === beforeLog + 1;
});

// ---------------- 6) Engine.advance ----------------
test('Engine: 耗尽 AP 后推进至 turn=40，endingId 非空，pendingEvent 至多一个', () => {
  const r = createRng(31337);
  const ng = newGame(validOptions, config, r);
  const s = ng.state;
  let guard = 0;
  let pendingAlwaysSingle = true;
  while (s.turn < 40 && !s.endingId && guard < 500) {
    guard++;
    let inner = 0;
    while (s.actionPoints > 0 && inner < 100) {
      inner++;
      const av = config.actions.list.find((a) => actionAvailability(s, a.id, config).ok);
      if (!av) break;
      const dr = doAction(s, av.id, config, r);
      if (!dr.ok) break;
    }
    if (s.turn >= 40 || s.endingId) break;
    const ad = advance(s, config, r);
    const single = s.pendingEvent === null
      || (s.pendingEvent && typeof s.pendingEvent.eventId === 'string');
    if (!single) { pendingAlwaysSingle = false; break; }
    if (!ad.ok) break;
  }
  return s.turn === 40
    && typeof s.endingId === 'string' && s.endingId.length > 0
    && pendingAlwaysSingle;
});

// ---------------- 7) Engine.resolvePendingEvent ----------------
test('Engine: resolvePendingEvent 有效 choiceId → 应用效果+清空+写 eventHistory', () => {
  const ng = newGame(validOptions, config, createRng(1));
  const s = ng.state;
  if (!s.pendingEvent || s.pendingEvent.eventId !== 'ev_fixed_club_recruit') {
    return '开局未生成社团招新 pendingEvent';
  }
  const socialBefore = s.player.attributes.social;
  const histBefore = s.eventHistory.length;
  const r = resolvePendingEvent(s, 'join', config, createRng(2));
  return r.ok === true
    && s.pendingEvent === null
    && s.player.attributes.social === socialBefore + 3
    && s.eventHistory.length === histBefore + 1
    && s.eventHistory.includes('ev_fixed_club_recruit');
});
test('Engine: resolvePendingEvent 无效 choiceId → {ok:false, reason}', () => {
  const ng = newGame(validOptions, config, createRng(1));
  const s = ng.state;
  if (!s.pendingEvent) return '开局无 pendingEvent';
  const r = resolvePendingEvent(s, 'not_a_real_choice', config, createRng(2));
  return r.ok === false && typeof r.reason === 'string';
});

// ---------------- 8) Engine.getEnding ----------------
test('Engine: getEnding knowledge>=30 → ending_academic_star', () => {
  const ng = newGame(validOptions, config, createRng(1));
  const s = ng.state;
  s.player.attributes.knowledge = 40;
  const r = getEnding(s, config);
  return r.ok === true && r.endingId === 'ending_academic_star';
});

// ---------------- 9) 复现性 ----------------
test('复现性: 同种子+同操作序列 两次关键字段 JSON 相等', () => {
  const a = runToEnd(555, config, createRng);
  const b = runToEnd(555, config, createRng);
  const ka = {
    turn: a.turn, actionPoints: a.actionPoints,
    attributes: a.player.attributes, endingId: a.endingId,
    studyActions: a.academics.studyActions, eventHistory: a.eventHistory,
  };
  const kb = {
    turn: b.turn, actionPoints: b.actionPoints,
    attributes: b.player.attributes, endingId: b.endingId,
    studyActions: b.academics.studyActions, eventHistory: b.eventHistory,
  };
  return JSON.stringify(ka) === JSON.stringify(kb);
});

// ---------------- 10) 存档 ----------------
test('存档: serialize→deserialize 中途 state 关键字段一致', () => {
  const s = runToEnd(42, config, createRng);
  const d = deserializeSave(serializeSave(s));
  return d.ok === true
    && d.state.turn === s.turn
    && d.state.player.name === s.player.name
    && JSON.stringify(d.state.academics) === JSON.stringify(s.academics)
    && JSON.stringify(d.state.eventHistory) === JSON.stringify(s.eventHistory)
    && d.state.endingId === s.endingId;
});
test('存档: 版本不兼容(9.9.9) → {ok:false, reason}', () => {
  const s = runToEnd(42, config, createRng);
  const d = deserializeSave(JSON.stringify({ format: 'scusim', version: '9.9.9', state: s }));
  return d.ok === false && typeof d.reason === 'string';
});
test('存档: 畸形文本 → {ok:false}', () => {
  const d = deserializeSave('{ 这不是合法 json');
  return d.ok === false;
});
test('存档: addGalleryUnlocked 重复不去重 + 新 id 追加', () => {
  const g0 = { version: '1.0.0', unlocked: ['a'] };
  const g1 = addGalleryUnlocked(g0, 'a'); // 重复
  const g2 = addGalleryUnlocked(g1, 'b'); // 追加
  return g1.unlocked.length === 1 && g1.unlocked[0] === 'a'
    && g2.unlocked.length === 2
    && g2.unlocked.includes('a') && g2.unlocked.includes('b');
});
test('存档: checkSaveVersion 拒绝不兼容版本', () => {
  return checkSaveVersion({ format: 'scusim', version: '9.9.9' }).ok === false;
});

// ---------------- 11) loadConfig ----------------
let config = null;
try { config = await loadConfig(makeFileReader(root)); }
catch (e) {
  console.error('loadConfig 失败:', e && e.errors ? e.errors.join(' | ') : e);
}
test('L: loadConfig 返回含 6 key 的对象', () => {
  return !!config && ['balance', 'colleges', 'tags', 'actions', 'events', 'endings']
    .every((k) => k in config);
});
test('L: reader 缺 colleges → reject 且 errors 非空', async () => {
  const badReader = {
    read: (path) => {
      if (path === 'colleges') throw new Error('模拟缺失 colleges');
      return readFile(join(root, 'config', `${path}.json`), 'utf8');
    },
  };
  let rejected = false;
  let errs = [];
  try { await loadConfig(badReader); }
  catch (e) { rejected = true; errs = (e && e.errors) || []; }
  return rejected && Array.isArray(errs) && errs.length > 0;
});

// ---------------- 12) 静态约束扫描 ----------------
async function scanForbidden(dir, tokens) {
  const found = [];
  async function walk(d) {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.js')) {
        const txt = await readFile(p, 'utf8');
        for (const tk of tokens) if (txt.includes(tk)) found.push(`${p}: 含 ${tk}`);
      }
    }
  }
  await walk(dir);
  return found;
}
const FORBIDDEN = ['Math.random', 'indexedDB', 'localStorage', 'document.', 'window.'];
test('静态: src/core 无 Math.random/indexedDB/localStorage/document./window.', async () => {
  const f = await scanForbidden(join(root, 'src', 'core'), FORBIDDEN);
  return f.length === 0 || f.join('; ');
});
test('静态: src/events 无 Math.random/indexedDB/localStorage/document./window.', async () => {
  const f = await scanForbidden(join(root, 'src', 'events'), FORBIDDEN);
  return f.length === 0 || f.join('; ');
});
test('静态: src/config 无 Math.random/indexedDB/localStorage/document./window.', async () => {
  const f = await scanForbidden(join(root, 'src', 'config'), FORBIDDEN);
  return f.length === 0 || f.join('; ');
});

// ---------------- 执行 ----------------
console.log('== SCUSim M1 独立验证（verify_m1）==');
for (const { name, fn } of tests) {
  try {
    const cond = await fn();
    if (typeof cond === 'string') check(name, false, cond);
    else check(name, !!cond, '');
  } catch (e) {
    check(name, false, 'EXC: ' + (e && e.message ? e.message : String(e)));
  }
}

const total = pass + failures.length;
console.log(`\n== verify_m1 结果 ==`);
console.log(`总计 ${total} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
