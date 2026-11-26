/**
 * 社交点数规则自检
 * 运行：node tests/verify_social.mjs
 *
 * 覆盖：
 *  A) 社交 < 30 → 已遇见的可攻略角色好感 −20（掉线触发一次；继续低于 30 不重复扣）
 *  B) 回到 30 以上再跌破 → 会再扣一次
 *  C) 没遇见过的角色不受影响
 *  D) 社交 < 20 → 人物剧情「见人」那一步有 skipChance 概率不登场（社交正常时必定登场）
 *  E) 社交 < 20 → 角色事件权重 ×eventWeightScale
 *  F) 社交 ≥ 30 / 没配 socialRules → 什么都不发生
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config/loader.js';
import { createRng } from '../src/core/rng.js';
import { newGame, advance } from '../src/core/engine.js';
import { dueStorylineEvent, computeWeight } from '../src/events/eventManager.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.error(`  FAIL  ${name}  ${detail}`); }
}

const config = await loadConfig({ read: (p) => readFile(join(root, 'config', `${p}.json`), 'utf8') });
const RULES = config.balance.socialRules;
const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * 造一个「第 4 回合、已经走了林予线、社交可控」的状态。
 * 为了避免别的规则干扰（吃饭 / 荒废 / 退学），把 weekly 与 dropout 关掉。
 */
function makeState(social, opts) {
  const cfg = (opts && opts.config) || config;
  const rng = createRng(11);
  const ng = newGame({
    name: '社交生', gender: '男', collegeId: 'cs',
    attributes: { knowledge: 8, social: 0, health: 12, money: 0 },
    tags: ['study_hard', 'gamer', 'chill'], seed: 11,
  }, cfg, rng);
  if (!ng.ok) throw new Error('newGame 失败: ' + ng.reason);
  const s = ng.state;
  s.pendingEvent = null;
  s.player.location = null;
  s.turn = 4;
  s.player.attributes.social = social;
  s.player.flags = Object.assign({ route_linyu: true }, (opts && opts.flags) || {});
  if (opts && opts.relations) s.player.relations = opts.relations;
  return { s, rng };
}

const MET = {
  linyu: { affinity: 40, stage: 'friend', met: true, lastTurn: 1 },
  guchi: { affinity: 10, stage: 'stranger', met: false, lastTurn: 0 },
};

const quietCfg = clone(config);
quietCfg.balance.weeklyRules = null;   // 本文件只测社交规则，关掉每周结算
quietCfg.balance.dropout = null;

console.log('== SCUSim 社交规则自检 ==');
check('准备：socialRules 配置存在', !!RULES && !!RULES.affinity && !!RULES.scarcity);

// ---------------------------------------------------------------------------
// A/B) 社交 < 30 扣好感（掉线触发一次）
// ---------------------------------------------------------------------------
{
  const { s, rng } = makeState(25, { config: quietCfg, relations: JSON.parse(JSON.stringify(MET)) });
  const r1 = advance(s, quietCfg, rng);
  check('A: 社交 25 → 已遇见的林予好感 −20（40 → 20）',
    s.player.relations.linyu.affinity === 20, String(s.player.relations.linyu.affinity));
  check('A: 给出社交惩罚提示',
    (r1.notices || []).some((n) => n.type === 'social'), JSON.stringify(r1.notices || []));

  advance(s, quietCfg, rng);
  check('A: 继续低于 30 不会每周连扣',
    s.player.relations.linyu.affinity === 20, String(s.player.relations.linyu.affinity));

  // 回到 30 以上
  s.player.attributes.social = 35;
  advance(s, quietCfg, rng);
  check('B: 回到 30 以上不再扣', s.player.relations.linyu.affinity === 20,
    String(s.player.relations.linyu.affinity));

  // 再跌破
  s.player.attributes.social = 28;
  const r4 = advance(s, quietCfg, rng);
  check('B: 再跌破 30 → 再扣一次（20 → 0）',
    s.player.relations.linyu.affinity === 0, String(s.player.relations.linyu.affinity));
  check('B: 又给出一次提示',
    (r4.notices || []).some((n) => n.type === 'social'));
}

// ---------------------------------------------------------------------------
// C) 没遇见的角色不受影响
// ---------------------------------------------------------------------------
{
  const { s, rng } = makeState(10, { config: quietCfg, relations: JSON.parse(JSON.stringify(MET)) });
  advance(s, quietCfg, rng);
  check('C: 未遇见的顾迟好感不变（10）',
    s.player.relations.guchi.affinity === 10, String(s.player.relations.guchi.affinity));
}

// ---------------------------------------------------------------------------
// D) 社交 < 20 → 人物剧情「见人」有概率不登场
// ---------------------------------------------------------------------------
{
  const hi = makeState(50, { config: quietCfg, relations: JSON.parse(JSON.stringify(MET)) });
  let hiHits = 0;
  for (let i = 0; i < 12; i += 1) {
    const probe = makeState(50, { config: quietCfg, relations: JSON.parse(JSON.stringify(MET)) });
    if (dueStorylineEvent(probe.s, quietCfg, createRng(200 + i))) hiHits += 1;
  }
  check('D: 社交 50 → 人物剧情每次都登场', hiHits === 12, String(hiHits));

  let loHits = 0;
  for (let i = 0; i < 40; i += 1) {
    const probe = makeState(10, { config: quietCfg, relations: JSON.parse(JSON.stringify(MET)) });
    if (dueStorylineEvent(probe.s, quietCfg, createRng(300 + i))) loHits += 1;
  }
  const skip = Number(RULES.scarcity.skipChance);
  // 期望登场次数 ≈ 40 × (1 − skip) = 10；给个宽一点的区间，避免 seed 抖动
  check(`D: 社交 10 → 登场概率明显下降（${loHits}/40，期望约 ${Math.round(40 * (1 - skip))}）`,
    loHits > 0 && loHits <= 20, String(loHits));

  // 用固定 rng 验证「一定跳过 / 一定不跳过」两条边界
  const alwaysSkip = { next: () => 0 };
  const neverSkip = { next: () => 0.999 };
  const lowProbe = makeState(10, { config: quietCfg, relations: JSON.parse(JSON.stringify(MET)) });
  check('D: rng 落在跳过区间 → 本周不登场',
    dueStorylineEvent(lowProbe.s, quietCfg, alwaysSkip) === null);
  const lowProbe2 = makeState(10, { config: quietCfg, relations: JSON.parse(JSON.stringify(MET)) });
  check('D: rng 落在不跳过区间 → 正常登场',
    !!dueStorylineEvent(lowProbe2.s, quietCfg, neverSkip));
  const hiProbe = makeState(50, { config: quietCfg, relations: JSON.parse(JSON.stringify(MET)) });
  check('D: 社交正常时 rng 再小也照常登场（不消耗概率）',
    !!dueStorylineEvent(hiProbe.s, quietCfg, alwaysSkip));
}

// ---------------------------------------------------------------------------
// E) 社交 < 20 → 角色事件权重打折
// ---------------------------------------------------------------------------
{
  const ev = { id: 'probe_char_event', charId: 'linyu', weight: 10, termRange: [1, 8] };
  const lo = makeState(10, { config: quietCfg, relations: JSON.parse(JSON.stringify(MET)) });
  const hi = makeState(50, { config: quietCfg, relations: JSON.parse(JSON.stringify(MET)) });
  const wLo = computeWeight(ev, lo.s, quietCfg);
  const wHi = computeWeight(ev, hi.s, quietCfg);
  const scale = Number(RULES.scarcity.eventWeightScale);
  check('E: 社交 10 时角色事件权重按 eventWeightScale 打折',
    Math.abs(wLo - wHi * scale) < 0.001, `lo=${wLo} hi=${wHi} scale=${scale}`);
  const neutral = { id: 'probe_plain_event', weight: 10, termRange: [1, 8] };
  check('E: 不带角色的事件不受影响',
    computeWeight(neutral, lo.s, quietCfg) === computeWeight(neutral, hi.s, quietCfg));
}

// ---------------------------------------------------------------------------
// F) 社交正常 / 没配 socialRules → 什么都不发生
// ---------------------------------------------------------------------------
{
  const { s, rng } = makeState(50, { config: quietCfg, relations: JSON.parse(JSON.stringify(MET)) });
  const r = advance(s, quietCfg, rng);
  check('F: 社交 50 → 不扣好感、没有社交提示',
    s.player.relations.linyu.affinity === 40
    && !(r.notices || []).some((n) => n.type === 'social'),
    String(s.player.relations.linyu.affinity));
}
{
  const cfg = clone(quietCfg);
  delete cfg.balance.socialRules;
  const { s, rng } = makeState(5, { config: cfg, relations: JSON.parse(JSON.stringify(MET)) });
  const r = advance(s, cfg, rng);
  check('F: 没配 socialRules 时社交 5 也不扣好感',
    s.player.relations.linyu.affinity === 40, String(s.player.relations.linyu.affinity));
  const probe = makeState(5, { config: cfg, relations: JSON.parse(JSON.stringify(MET)) });
  check('F: 没配 socialRules 时人物剧情照常登场',
    !!dueStorylineEvent(probe.s, cfg, { next: () => 0 }));
}

console.log(`\n总计 ${pass + failures.length} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
