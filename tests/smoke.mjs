// SCUSim 冒烟测试（纯 Node，无浏览器）
// 运行：npm test
//
// 覆盖：
//  A) loadConfig 注入 reader 加载 6 份配置并 validateConfigs 通过
//  B) 固定种子 newGame + 跑到终局（turn 停在 40、endingId 非空、rngState 为数字、全程不抛错）
//  C) 同种子 + 同操作序列两次完全一致（复现性）
//  D) 存档序列化/反序列化关键字段一致（纯 JSON，不依赖 IndexedDB）；畸形 / 缺 format / 版本不兼容返回 ok:false；图鉴去重
//  E) core/events 静态约束：无 Math.random / 存储 / DOM 引用
//  以及原有：配置结构校验、规模下限。

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfigs } from '../src/config/schema.js';
import { loadConfig } from '../src/config/loader.js';
import {
  serializeSave, deserializeSave, checkSaveVersion, addGalleryUnlocked,
} from '../src/storage/storage.js';
import { createRng } from '../src/core/rng.js';
import {
  newGame, actionAvailability, doAction, advance,
} from '../src/core/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.error(`  FAIL  ${name}  ${detail}`); failures++; }
}

// 注入 reader：从本地 config/*.json 读取（Node 测试用）
const testReader = {
  read: (path) => readFile(join(root, 'config', `${path}.json`), 'utf8'),
};

console.log('== SCUSim 冒烟测试 ==');

// A) loadConfig 注入 reader
const configs = await loadConfig(testReader).catch((e) => {
  console.error('  loadConfig 抛错:', e && e.errors ? e.errors.join(' | ') : e);
  return null;
});
check('A: loadConfig 返回 6 份配置',
  !!configs && ['balance', 'colleges', 'tags', 'actions', 'events', 'endings'].every((k) => k in configs));
const v = validateConfigs(configs || {});
check('A: 六份配置通过结构校验', v.ok, v.errors.join(' | '));
if (!v.ok) v.errors.forEach((e) => console.error('     - ' + e));

// 1) 配置结构校验（原有）
check('六份配置通过结构校验(原有)', v.ok, v.errors.join(' | '));

// 2) 规模下限（原有）
check('学院 >= 8', configs && configs.colleges.list.length >= 8, `=${configs && configs.colleges.list.length}`);
check('标签 >= 12', configs && configs.tags.list.length >= 12, `=${configs && configs.tags.list.length}`);
check('行动 >= 6', configs && configs.actions.list.length >= 6, `=${configs && configs.actions.list.length}`);
check('事件 fixed>=2 且 random>=14',
  configs && configs.events.fixed.length >= 2 && configs.events.random.length >= 14,
  `fixed=${configs && configs.events.fixed.length}, random=${configs && configs.events.random.length}`);
check('结局 >= 6', configs && configs.endings.list.length >= 6, `=${configs && configs.endings.list.length}`);

// 测试用角色（属性四项之和 === 20）
const testOptions = {
  name: '测试员', gender: '男', collegeId: 'cs',
  attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
  tags: ['study_hard', 'gamer', 'chill'],
  seed: 12345,
};

// 通用：从开局按固定策略跑到终局（不解析事件，仅驱动行动 + 推进）
function runToEnd(seed) {
  const rng = createRng(seed);
  const ng = newGame(testOptions, configs, rng);
  if (!ng.ok) throw new Error('newGame 失败: ' + ng.reason);
  const state = ng.state;
  let guard = 0;
  while (state.turn < 40 && !state.endingId && guard < 2000) {
    guard++;
    while (state.actionPoints > 0) {
      const av = configs.actions.list.find((a) => actionAvailability(state, a.id, configs).ok);
      if (!av) break;
      const r = doAction(state, av.id, configs, rng);
      if (!r.ok) break;
    }
    advance(state, configs, rng);
  }
  return state;
}

// B) 固定种子跑满 40 回合
let bState = null;
let bThrew = false;
try {
  bState = runToEnd(12345);
} catch (e) {
  bThrew = true;
  console.error('  B 抛错:', e && e.message ? e.message : e);
}
check('B: 全程不抛错', !bThrew);
check('B: turn 停在 40', bState && bState.turn === 40, `turn=${bState && bState.turn}`);
check('B: endingId 非空', bState && !!bState.endingId, `endingId=${bState && bState.endingId}`);
check('B: rngState 为数字', bState && typeof bState.rngState === 'number', `rngState=${bState && bState.rngState}`);

// C) 复现性
const c1 = runToEnd(777);
const c2 = runToEnd(777);
const k1 = { turn: c1.turn, actionPoints: c1.actionPoints, attributes: c1.player.attributes, endingId: c1.endingId };
const k2 = { turn: c2.turn, actionPoints: c2.actionPoints, attributes: c2.player.attributes, endingId: c2.endingId };
check('C: 同种子同输入完全一致', JSON.stringify(k1) === JSON.stringify(k2),
  `${JSON.stringify(k1)} vs ${JSON.stringify(k2)}`);

// D) 存档往返
const dState = runToEnd(42);
const serialized = serializeSave(dState);
const deserialized = deserializeSave(serialized);
check('D: 序列化->反序列化 ok', deserialized.ok);
check('D: 关键字段一致',
  deserialized.ok
  && deserialized.state.turn === dState.turn
  && deserialized.state.player.name === dState.player.name
  && JSON.stringify(deserialized.state.academics) === JSON.stringify(dState.academics)
  && JSON.stringify(deserialized.state.eventHistory) === JSON.stringify(dState.eventHistory)
  && deserialized.state.endingId === dState.endingId,
  '关键字段不一致');

// D 畸形文本
const malformed = deserializeSave('{ this is not json');
check('D: 畸形文本返回 ok:false', malformed.ok === false, JSON.stringify(malformed));
// D 缺少 format
const noFmt = deserializeSave(JSON.stringify({ version: '1.0.0', state: {} }));
check('D: 缺少 format 返回 ok:false', noFmt.ok === false);
// D 版本不兼容
const badVer = deserializeSave(JSON.stringify({ format: 'scusim', version: '9.9.9', state: dState }));
check('D: 版本不兼容返回 ok:false', badVer.ok === false, JSON.stringify(badVer));
// D checkSaveVersion 直接校验
check('D: checkSaveVersion 拒绝不兼容版本',
  checkSaveVersion({ format: 'scusim', version: '9.9.9' }).ok === false);

// D 图鉴去重（T4 G2）
const g0 = { version: '1.0.0', unlocked: ['ending_ordinary'] };
const g1 = addGalleryUnlocked(g0, 'ending_academic_star');
const g2 = addGalleryUnlocked(g1, 'ending_academic_star'); // 重复
check('D: 图鉴去重',
  g2.unlocked.length === 2
  && g2.unlocked.includes('ending_ordinary')
  && g2.unlocked.includes('ending_academic_star'));

// E) 核心层静态约束：不得出现 Math.random / window / indexedDB / localStorage
async function scanForbidden(dir, tokens) {
  let found = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) found = found.concat(await scanForbidden(p, tokens));
      else if (e.name.endsWith('.js')) {
        const txt = await readFile(p, 'utf8');
        for (const tk of tokens) {
          if (txt.includes(tk)) found.push(`${p}: 含 ${tk}`);
        }
      }
    }
  } catch { /* 目录尚不存在则跳过 */ }
  return found;
}
const forbidden = await scanForbidden(join(root, 'src', 'core'), ['Math.random', 'indexedDB', 'localStorage', 'window.']);
const forbiddenEv = await scanForbidden(join(root, 'src', 'events'), ['Math.random', 'indexedDB', 'localStorage', 'window.']);
check('E: core/ 无 Math.random / 存储 / DOM 引用', forbidden.length === 0, forbidden.join('; '));
check('E: events/ 无 Math.random / 存储 / DOM 引用', forbiddenEv.length === 0, forbiddenEv.join('; '));

console.log(failures === 0 ? '\n全部通过 ✅' : `\n失败 ${failures} 项 ❌`);
process.exit(failures === 0 ? 0 : 1);
