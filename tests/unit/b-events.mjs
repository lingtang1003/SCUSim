// B 模块单测 · 事件（computeWeight / availableOptions / resolveEvent / 固定事件）
// 运行：node tests/unit/b-events.mjs
// 覆盖：权重修正（标签/termRange）、同种子一致性、选项前置条件、flags 写入、固定事件去重

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../../src/config/loader.js';
import { createGameState } from '../../src/core/state.js';
import {
  computeWeight, rollEvent, availableOptions, resolveEvent, checkFixedEvents, assignSideCast,
  finalizeSideCast,
} from '../../src/events/eventManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const reader = { read: (p) => readFile(join(root, 'config', `${p}.json`), 'utf8') };
const config = await loadConfig(reader);
const events = config.events;

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.error(`  FAIL  ${name}  ${detail}`); failures++; }
}

const state = (tags, collegeId = 'cs', turn = 10) => {
  const s = createGameState({
    name: '测试', gender: '男', collegeId,
    attributes: { knowledge: 8, social: 8, health: 5, money: 300 },
    tags,
  });
  s.turn = turn;
  return s;
};

const evR02 = events.random.find((e) => e.id === 'ev_r02');
const evR01 = events.random.find((e) => e.id === 'ev_r01');
const evR15 = events.random.find((e) => e.id === 'ev_r15');

console.log('== B · 事件单测 ==');

// --- 权重修正：学霸标签让 ev_r02 权重 ×1.5 ---
{
  const wPlain = computeWeight(evR02, state(['chill']), config);
  const wStudy = computeWeight(evR02, state(['study_hard']), config);
  check('computeWeight: 学霸 → ev_r02 权重 ×1.5', Math.abs(wStudy - wPlain * 1.5) < 1e-9,
    `plain=${wPlain}, study=${wStudy}`);
}

// --- 同种子一致性（computeWeight 确定性） ---
{
  const a = computeWeight(evR02, state(['study_hard', 'researcher']), config);
  const b = computeWeight(evR02, state(['study_hard', 'researcher']), config);
  check('computeWeight: 相同输入两次一致', a === b);
}

// --- termRange 外为 0 ---
{
  const w = computeWeight(evR01, state(['chill'], 'cs', 40), config); // semester 8 > 8
  check('computeWeight: termRange 外 → 0', w === 0, `w=${w}`);
  const wIn = computeWeight(evR01, state(['chill'], 'cs', 5), config); // semester 1
  check('computeWeight: termRange 内 > 0', wIn > 0, `w=${wIn}`);
}

// --- rollEvent：chance 恒 true 且权重>0 时返回某个事件 ---
{
  const rngAlways = { next: () => 0.0001, chance: () => true };
  const roll = rollEvent(state(['chill']), config, rngAlways);
  check('rollEvent: 触发时返回合法事件', !!roll.eventId && events.random.some((e) => e.id === roll.eventId),
    JSON.stringify(roll));
  const rngNever = { next: () => 0.5, chance: () => false };
  check('rollEvent: 不触发时返回 null', rollEvent(state(['chill']), config, rngNever).eventId === null);
}

// --- availableOptions：社交 8 时表白选项 disabled 且 reason 含「10」 ---
{
  const opts = availableOptions(evR15, state(['chill']), config);
  const confess = opts.find((o) => o.id === 'confess');
  check('availableOptions: 社交 8 → 表白 disabled', confess && confess.enabled === false, JSON.stringify(opts));
  check('availableOptions: 原因含「10」', confess && confess.reason.includes('10'), `reason=${confess && confess.reason}`);
  const optsHigh = availableOptions(evR15, (() => { const s = state(['chill']); s.player.attributes.social = 12; return s; })(), config);
  const confessHigh = optsHigh.find((o) => o.id === 'confess');
  check('availableOptions: 社交 12 → 表白 enabled', confessHigh && confessHigh.enabled === true);
}

// --- resolveEvent：flags 写入 + eventHistory ---
{
  const s = state(['chill']);
  s.player.attributes.social = 12; // 满足前置
  const r = resolveEvent(s, 'ev_r15', 'confess', config, null);
  check('resolveEvent: 表白成功 → flags.romance=dating', r.ok === true
    && s.player.flags && s.player.flags.romance === 'dating' && s.player.romance === 'dating',
    JSON.stringify(r));
  check('resolveEvent: 写 eventHistory', s.eventHistory.includes('ev_r15'));
  const s2 = state(['chill']);
  s2.player.attributes.social = 8; // 不满足前置
  const r2 = resolveEvent(s2, 'ev_r15', 'confess', config, null);
  check('resolveEvent: 前置不满足 → {ok:false, reason:"requirement"}', r2.ok === false && r2.reason === 'requirement',
    JSON.stringify(r2));
  check('resolveEvent: 前置不满足不结算不改状态', s2.eventHistory.includes('ev_r15') === false
    && !(s2.player.flags && s2.player.flags.romance));
}

// --- 固定事件：社团招新在 turn 1 触发，结算后不再重复 ---
{
  const s = state(['chill'], 'cs', 1);
  const ids = checkFixedEvents(s, config);
  check('checkFixedEvents: turn 1 → 社团招新', ids.includes('ev_fixed_club_recruit'), JSON.stringify(ids));
  s.eventHistory.push('ev_fixed_club_recruit');
  const ids2 = checkFixedEvents(s, config);
  check('checkFixedEvents: 已结算不重复', !ids2.includes('ev_fixed_club_recruit'), JSON.stringify(ids2));
  const s38 = state(['chill'], 'cs', 38);
  check('checkFixedEvents: turn 38 → 毕业论文', checkFixedEvents(s38, config).includes('ev_fixed_thesis'),
    JSON.stringify(checkFixedEvents(s38, config)));
}

// --- 恋爱事件链：邂逅→搭讪→聚餐→散步→吵架（和好/分手），flags 逐级驱动 ---
{
  const s = state(['chill']);
  const r23 = resolveEvent(s, 'ev_r23', 'chat', config, null);
  check('恋爱链: 邂逅搭讪 → crush 标记 + 学识-1/社交+3', r23.ok === true
    && s.player.flags && s.player.flags.crush === true
    && s.player.attributes.knowledge === 8 - 1
    && s.player.attributes.social === 8 + 3, JSON.stringify(r23));
  const r24 = resolveEvent(s, 'ev_r24', 'dinner', config, null);
  check('恋爱链: 聚餐 → crush2 + 社交+2/金钱-150/好感+7', r24.ok === true
    && s.player.flags.crush2 === true
    && s.player.attributes.social === 11 + 2
    && s.player.attributes.money === 300 - 150
    && s.player.relations.linyu.affinity === 7 + 7, JSON.stringify(r24));
  const r25 = resolveEvent(s, 'ev_r25', 'date', config, null);
  check('恋爱链: 散步确认 → romance=dating', r25.ok === true
    && s.player.flags.romance === 'dating' && s.player.romance === 'dating', JSON.stringify(r25));
  const r26a = resolveEvent(s, 'ev_r26', 'makeup', config, null);
  check('恋爱链: 吵架和好 → romance=hehe', r26a.ok === true
    && s.player.flags.romance === 'hehe', JSON.stringify(r26a));

  const s2 = state(['chill']);
  resolveEvent(s2, 'ev_r23', 'chat', config, null);
  resolveEvent(s2, 'ev_r24', 'dinner', config, null);
  resolveEvent(s2, 'ev_r25', 'date', config, null);
  const r26b = resolveEvent(s2, 'ev_r26', 'breakup', config, null);
  check('恋爱链: 吵架分手 → romance 清除为 null', r26b.ok === true
    && s2.player.flags.romance === null && s2.player.romance === null, JSON.stringify(r26b));

  const s3 = state(['chill']);
  const r24x = resolveEvent(s3, 'ev_r24', 'dinner', config, null);
  // v2.1：恋爱链改成剧情线（storyline）驱动，事件本身不再写 requires，
  // 「先邂逅才能聚餐」由 config/storylines.json 的 gate 控制（见 verify_characters）
  check('恋爱链: 事件本身不再拦截（前置交给剧情线 gate）', r24x.ok === true
    && s3.player.relations.linyu.affinity === 7, JSON.stringify(r24x));
}

// --- 随机事件去重：同一随机事件短间隔内不重复触发 ---
{
  const s = state(['chill']);
  const r23 = resolveEvent(s, 'ev_r23', 'chat', config, null); // 结算一个随机事件
  check('去重: resolveEvent 记录 __recentEvents', r23.ok === true
    && Array.isArray(s.__recentEvents) && s.__recentEvents.includes('ev_r23'),
    JSON.stringify(s.__recentEvents));
  const rngAlways = { next: () => 0.0001, chance: () => true };
  const roll = rollEvent(s, config, rngAlways);
  check('去重: 已触发的 ev_r23 不再被返回', roll.eventId !== 'ev_r23',
    `roll=${roll.eventId}, recent=${JSON.stringify(s.__recentEvents)}`);
}

// --- 地点隔离：带 place 的事件只在对应地点出现 ---
{
  const locs = config.locations.list;
  const allRandom = events.random;
  const placeEvents = allRandom.filter((e) => Array.isArray(e.place) && e.place.length);
  check('place: 至少 90 条事件带地点标签', placeEvents.length >= 90, 'n=' + placeEvents.length);

  const tooThin = locs.filter((l) => placeEvents.filter((e) => e.place.includes(l.id)).length < 3);
  check('place: 每个地点至少 3 条专属事件', tooThin.length === 0,
    tooThin.map((l) => l.id).join(','));

  let crossCount = 0;
  for (const loc of locs) {
    const s = state(['study_hard']);
    s.turn = 5;
    for (let i = 0; i < 60; i++) {
      s.turn = (i % 6) + 3;
      s.__recentEvents = [];
      s.history = [
        { type: 'move', location: loc.id },
        { type: 'action', actionId: loc.activities[0], location: loc.id },
      ];
      const rng = { next: () => 0.0001, chance: () => true };
      const roll = rollEvent(s, config, rng);
      const ev = allRandom.find((e) => e.id === roll.eventId);
      if (ev && Array.isArray(ev.place) && !ev.place.includes(loc.id)) crossCount++;
    }
  }
  check('place: 任何地点都不会抽到别处的事件', crossCount === 0, 'cross=' + crossCount);

  const noCtx = state(['chill']);
  noCtx.history = [];
  const rolls = [];
  for (let i = 0; i < 60; i++) {
    rolls.push(rollEvent(noCtx, config, { next: () => 0.0001, chance: () => true }).eventId);
  }
  const placeHit = rolls.filter((id) => {
    const e = allRandom.find((x) => x.id === id);
    return e && Array.isArray(e.place);
  });
  check('place: 无地点上下文时不抽地点专属事件', placeHit.length === 0, placeHit.join(','));
}

// --- 单一地点也能刷到通用事件：分层混合而非"地点专属独占" ---
{
  const s = state(['chill'], 'cs', 8);
  const mkHist = (loc, act) => [
    { type: 'move', location: loc },
    { type: 'action', actionId: act, location: loc },
  ];
  s.history = mkHist('bridge', 'rest');
  const ids = [];
  let seed = 20261126;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 40; i += 1) {
    const roll = rollEvent(s, config, { next: rand, chance: () => true });
    if (!roll.eventId) continue;
    const ev = events.random.find((x) => x.id === roll.eventId);
    const opt = availableOptions(ev, s, config).find((o) => o.enabled);
    const res = resolveEvent(s, roll.eventId, opt && opt.id, config, { next: rand, chance: () => true });
    if (res.ok) ids.push(roll.eventId);
  }
  const isGeneral = (id) => {
    const e = events.random.find((x) => x.id === id);
    return e && !(Array.isArray(e.place) && e.place.length);
  };
  const general = ids.filter(isGeneral);
  const distinct = new Set(ids.filter(Boolean));
  check('rollEvent: 死守长桥也能刷到通用事件', general.length > 0,
    `general=${general.length}/${ids.length}`);
  check('rollEvent: 单地点 40 次抽取至少覆盖 12 种不同事件', distinct.size >= 12,
    `distinct=${distinct.size}`);
}

// --- 基率读取 balance.randomEventBaseChance ---
{
  let seen = null;
  rollEvent(state(['chill']), config, {
    next: () => 0.5,
    chance: (p) => { seen = p; return false; },
  });
  const cfgChance = Number(config.balance.randomEventBaseChance);
  check('rollEvent: 掷骰基率来自 balance.randomEventBaseChance',
    Number.isFinite(seen) && Math.abs(seen - cfgChance) < 1e-9,
    `seen=${seen}, cfg=${cfgChance}`);
}

// --- 相识线：非路线 NPC 也能认识，但只停在告白前 ---
{
  const SIDE_CHARS = ['jiangxu', 'guchi', 'linyu', 'suwan', 'zhouye', 'tangtang'];
  const sideOf = (cid, n) => events.random.find((e) => e.id === `ev_side_${cid}_${n}`);
  const missing = [];
  const badFlags = [];
  for (const cid of SIDE_CHARS) {
    for (const n of [1, 2, 3]) {
      const e = sideOf(cid, n);
      if (!e) { missing.push(`ev_side_${cid}_${n}`); continue; }
      for (const o of (e.options || [])) {
        const flags = (o.effects && o.effects.flags) || {};
        for (const k of Object.keys(flags)) {
          if (k.startsWith('route_') || k === 'romance') badFlags.push(`${e.id}/${o.id}:${k}`);
        }
      }
    }
  }
  check('相识线: 六位角色各 3 段事件齐备', missing.length === 0, missing.join(','));
  check('相识线: 不写 route_/romance 标记（到不了告白）', badFlags.length === 0, badFlags.join(','));

  // 选了林予之后，林予的相识事件全部禁用；江叙的仍可用
  const s = state(['chill'], 'cs', 8);
  s.player.flags = { route_linyu: true, side_linyu: true, side_jiangxu: true };
  s.history = [
    { type: 'move', location: 'street' },
    { type: 'action', actionId: 'socialize', location: 'street' },
  ];
  const linyuOpts = availableOptions(sideOf('linyu', 1), s, config);
  const jiangxuOpts = availableOptions(sideOf('jiangxu', 1), s, config);
  check('相识线: 选定林予后，林予的相识选项全部禁用',
    linyuOpts.length > 0 && linyuOpts.every((o) => !o.enabled),
    JSON.stringify(linyuOpts));
  check('相识线: 选定林予后，江叙的相识选项仍可用',
    jiangxuOpts.some((o) => o.enabled));

  // 三步都由剧情线顺序推进，事件本身不进随机池；最后一步没有分支（到不了告白）
  const sideLines = (config.storylines.lines || []).filter((l) => String(l.id).endsWith('_side'));
  const sideOk = sideLines.length === 6 && sideLines.every((l) => l.steps.length === 3
    && l.steps.every((st) => {
      const e = events.random.find((x) => x.id === st.eventId);
      return e && e.storylineOnly === true && e.once === true;
    })
    && !l.steps.some((st) => st.next));
  check('相识线: 六条线各 3 步、事件进剧情池且末步无分支', sideOk,
    sideLines.map((l) => l.id + ':' + l.steps.length).join(','));

  // 随机池里永远抽不到相识线事件（storylineOnly 权重为 0）
  const r = state(['chill'], 'cs', 20);
  r.player.flags = { route_linyu: true, side_linyu: true, side_jiangxu: true };
  r.history = [
    { type: 'move', location: 'library' },
    { type: 'action', actionId: 'study', location: 'library' },
  ];
  let seed2 = 424242;
  const rnd = () => { seed2 = (seed2 * 1103515245 + 12345) % 2147483648; return seed2 / 2147483648; };
  const hit = [];
  for (let i = 0; i < 60; i += 1) hit.push(rollEvent(r, config, { next: rnd, chance: () => true }).eventId);
  check('相识线: 随机抽取不会直接抛出相识线事件',
    !hit.some((id) => typeof id === 'string' && id.startsWith('ev_side_')));
}

  // 开局相识圈：同 seed 稳定、挑 3 人、不与路线冲突地写 side_ 标记
  {
    const idsOf = (seed) => {
      const a = state(['chill'], 'cs', 1);
      a.player.flags = {};
      const cast = assignSideCast(a, config, seed);
      return { cast, flags: Object.keys(a.player.flags).sort() };
    };
    const one = idsOf(20261020);
    const again = idsOf(20261020);
    const other = idsOf(20260609);
    check('相识圈: 每局挑 3 位角色', one.cast.length === 3, JSON.stringify(one.cast));
    check('相识圈: 同 seed 结果一致', JSON.stringify(one.cast) === JSON.stringify(again.cast));
    check('相识圈: 不同 seed 会换人', JSON.stringify(one.cast) !== JSON.stringify(other.cast),
      `${one.cast} vs ${other.cast}`);
    check('相识圈: 写的是 side_ 标记', one.flags.every((k) => k.startsWith('side_')), one.flags.join(','));
  }

  // 迎新晚会后收口：主角 + 2 位，一局最多 3 个 NPC 有交集
  {
    const setup = (seed, route) => {
      const a = state(['chill'], 'cs', 1);
      a.player.flags = {};
      a.seed = seed;
      assignSideCast(a, config, seed); // 开局先写 3 个候选
      const kept = finalizeSideCast(a, config, route);
      return { kept, sides: Object.keys(a.player.flags).filter((k) => k.startsWith('side_')).sort() };
    };
    const x = setup(2024, 'jiangxu');
    const same = setup(2024, 'jiangxu');
    check('相识圈收口: 除主角外只留 2 位', x.kept.length === 2, JSON.stringify(x.kept));
    check('相识圈收口: 主角不会留在相识圈', !x.kept.includes('jiangxu') && !x.sides.includes('side_jiangxu'),
      JSON.stringify(x.sides));
    check('相识圈收口: 同 seed 结果一致', JSON.stringify(x.kept) === JSON.stringify(same.kept));
    check('相识圈收口: 主角 + 2 位 = 一局最多 3 人', x.kept.length + 1 === 3);
  }

  // 负债当回合触发时，剧情线（含相识线）必须让位，避免借钱事件被相识事件顶掉
  {
    const d = state(['chill'], 'cs', 1);
    d.player.flags = { side_jiangxu: true };
    d.eventHistory = [];
    d.turn = 6; // 江叙相识线第一段窗口 6–12 的开头，且不是考试周
    const normal = checkFixedEvents(d, config);
    const skip = checkFixedEvents(d, config, { skipStoryline: true });
    check('相识线: 负债优先时剧情线事件让位',
      normal.includes('ev_side_jiangxu_1') && !skip.some((id) => String(id).startsWith('ev_side_')),
      `normal=${JSON.stringify(normal)} skip=${JSON.stringify(skip)}`);
  }

  // 相识线节奏：两段之间至少隔 3 回合，不许连着刷
  {
    const p = state(['chill'], 'cs', 1);
    p.player.flags = { side_jiangxu: true };
    p.eventHistory = [];
    p.turn = 6;
    const at6 = checkFixedEvents(p, config); // 触发并记下 lastSideTurn=6
    p.turn = 8;
    const at8 = checkFixedEvents(p, config); // 6→8 只隔 2，应被拦
    p.turn = 9;
    const at9 = checkFixedEvents(p, config); // 6→9 隔 3，放行
    check('相识线: 两段之间至少隔 3 回合',
      at6.includes('ev_side_jiangxu_1')
      && !at8.some((id) => String(id).startsWith('ev_side_'))
      && at9.includes('ev_side_jiangxu_1'),
      `at6=${JSON.stringify(at6)} at8=${JSON.stringify(at8)} at9=${JSON.stringify(at9)}`);
  }

  // 剧情线事件的地点标记：必须是真实地点 id，且文案里有地点的都写上了 place
  {
    const locIds = new Set(((config.locations && config.locations.list) || []).map((l) => l.id));
    const story = events.random.filter((e) => String(e.id).startsWith('ev_story_') || String(e.id).startsWith('ev_side_'));
    const badPlace = story.filter((e) => Array.isArray(e.place) && e.place.some((p) => !locIds.has(p)));
    check('剧情线事件: place 都是有效地点', badPlace.length === 0,
      badPlace.map((e) => `${e.id}:${e.place}`).join(','));
  }

console.log(failures === 0 ? '\n事件单测全部通过 ✅' : `\n失败 ${failures} 项 ❌`);
process.exit(failures === 0 ? 0 : 1);
