// 随机事件曝光度报告：每条事件"最佳情境下"的每局期望触发次数。
// 用途：找出在当前权重下几乎刷不到的事件，作为配平依据（不是单元测试）。
//
// 口径：假设玩家 40 回合始终待在"对该事件最有利的地点 + 行动"（地点匹配、场景匹配、
//       回合窗口内、选项前置可用），按轮盘赌份额 × randomEventBaseChance × 40 折算。
//       份额按 place/spot/topic/tier 倍率复算，与 src/events/eventManager.js 的 rollEvent 一致。
//
// 运行：node tools/events_exposure.mjs [topN]
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config/loader.js';
import { createGameState } from '../src/core/state.js';
import { computeWeight, availableOptions } from '../src/events/eventManager.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const reader = { read: (p) => readFile(join(root, 'config', `${p}.json`), 'utf8') };
const config = await loadConfig(reader);
const bal = config.balance;
const tw = bal.eventTierWeights || {};
const tier = (k, d) => (Number.isFinite(tw[k]) ? tw[k] : d);
const random = config.events.random;
const locations = config.locations.list;

const mkState = (collegeId, turn, attrs, gpa, loc, act) => {
  const s = createGameState({ name: '曝光诊断', gender: '男', collegeId, attributes: attrs });
  s.turn = turn;
  s.academics.totalGpa = gpa;
  s.__recentEvents = [];
  s.eventHistory = [];
  s.history = [
    { type: 'move', location: loc.id },
    { type: 'action', actionId: act, location: loc.id },
  ];
  return s;
};

const colleges = config.colleges.list.map((c) => c.id);
const profiles = [
  { attrs: { knowledge: 5, social: 5, health: 3, money: 100 }, gpa: 2.2 },
  { attrs: { knowledge: 10, social: 10, health: 6, money: 400 }, gpa: 3.0 },
  { attrs: { knowledge: 22, social: 18, health: 10, money: 1600 }, gpa: 3.8 },
];
const turns = [2, 6, 12, 20, 26, 30, 34, 38];

const poolWeight = (e, s, cur, curPlace, curTopic) => {
  const w0 = computeWeight(e, s, config);
  if (!(w0 > 0)) return 0;
  const place = Array.isArray(e.place) ? e.place : null;
  if (place) {
    if (!place.includes(curPlace)) return 0;
    const inSpot = Array.isArray(e.spot) && e.spot.includes(cur);
    return w0 * (inSpot ? tier('placeSpot', 10) : tier('placeOnly', 3.5));
  }
  const spots = Array.isArray(e.spot) ? e.spot : [];
  if (spots.length === 0) return w0 * tier('generalAny', 1.2);
  if (spots.includes(cur)) {
    return w0 * (curTopic && e.topic === curTopic ? tier('generalSpotTopic', 2.5) : tier('generalSpot', 1.5));
  }
  return w0 * tier('generalOtherSpot', 0.6);
};

const maxShare = new Map();
const maxCtx = new Map();
let ctxTotal = 0;

for (const loc of locations) {
  for (const act of (loc.activities || ['study'])) {
    for (const turn of turns) {
      for (const cid of colleges) {
        for (const p of profiles) {
          const s = mkState(cid, turn, { ...p.attrs }, p.gpa, loc, act);
          ctxTotal += 1;
          const entries = [];
          for (const e of random) {
            const w = poolWeight(e, s, act, loc.id, loc.topic);
            if (!w) continue;
            if (!availableOptions(e, s, config).some((o) => o.enabled)) continue;
            entries.push({ e, w });
          }
          if (!entries.length) continue;
          const total = entries.reduce((sum, x) => sum + x.w, 0);
          for (const x of entries) {
            const share = x.w / total;
            if (!(maxShare.get(x.e.id) >= share)) {
              maxShare.set(x.e.id, share);
              maxCtx.set(x.e.id, `${loc.id}/${act}/T${turn}/${cid}`);
            }
          }
        }
      }
    }
  }
}

const base = Number(bal.randomEventBaseChance) || 0.85;
const hasFlagReq = (e) => (e.options || []).some((o) => o.requires && o.requires.flag);
const rows = random
  .filter((e) => !e.storylineOnly && !hasFlagReq(e) && !e.college)
  .map((e) => ({
    id: e.id,
    name: e.name,
    weight: e.weight,
    perGame: (maxShare.get(e.id) || 0) * base * 40,
    share: (maxShare.get(e.id) || 0) * 100,
    place: Array.isArray(e.place) ? e.place.join('/') : '通用',
    spot: Array.isArray(e.spot) && e.spot.length ? e.spot.join('/') : '不限',
    win: e.termRange ? `${e.termRange[0]}-${e.termRange[1]}` : '-',
    bestCtx: maxCtx.get(e.id) || '-',
  }))
  .sort((a, b) => a.perGame - b.perGame);

const topN = Number(process.argv[2] || 20);
console.log(`上下文 ${ctxTotal} 个 · 纯随机事件 ${rows.length} 条 · baseChance ${base} · tier ${JSON.stringify(tw)}`);
console.log('\n=== 最佳情境下最稀有 ===');
console.log('id\t名称\t每局期望\t占比\t权重\t窗口\t地点\t场景\t最佳情境');
for (const r of rows.slice(0, topN)) {
  console.log([r.id, r.name, r.perGame.toFixed(2), r.share.toFixed(1) + '%', r.weight, r.win, r.place, r.spot, r.bestCtx].join('\t'));
}

const vs = rows.map((r) => r.perGame);
const sorted = [...vs].sort((a, b) => a - b);
const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2);
console.log(`\n分布：最低 ${q(0)}　P25 ${q(0.25)}　中位 ${q(0.5)}　P75 ${q(0.75)}　最高 ${q(1)}`);
const place = rows.filter((r) => r.place !== '通用');
const gen = rows.filter((r) => r.place === '通用');
const med = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)].toFixed(2) : '-';
};
console.log(`地点专属 ${place.length} 条　中位 ${med(place.map((r) => r.perGame))}　最低 ${Math.min(...place.map((r) => r.perGame)).toFixed(2)}`);
console.log(`通用事件 ${gen.length} 条　中位 ${med(gen.map((r) => r.perGame))}　最低 ${Math.min(...gen.map((r) => r.perGame)).toFixed(2)}`);
const low = rows.filter((r) => r.perGame < 2);
console.log(`\n低于 2 次/局：${low.length} 条 —— ${low.map((r) => `${r.id}(${r.perGame.toFixed(2)})`).join('、') || '无'}`);
