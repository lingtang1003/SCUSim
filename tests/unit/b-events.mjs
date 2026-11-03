// B 模块单测 · 事件（computeWeight / availableOptions / resolveEvent / 固定事件）
// 运行：node tests/unit/b-events.mjs
// 覆盖：权重修正（标签/termRange）、同种子一致性、选项前置条件、flags 写入、固定事件去重

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../../src/config/loader.js';
import { createGameState } from '../../src/core/state.js';
import {
  computeWeight, rollEvent, availableOptions, resolveEvent, checkFixedEvents,
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
  check('恋爱链: 聚餐 → crush2 + 社交+2/金钱-120', r24.ok === true
    && s.player.flags.crush2 === true
    && s.player.attributes.social === 11 + 2
    && s.player.attributes.money === 300 - 120, JSON.stringify(r24));
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
  check('恋爱链: 未邂逅时聚餐被前置拦截', r24x.ok === false
    && r24x.reason === 'requirement', JSON.stringify(r24x));
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

console.log(failures === 0 ? '\n事件单测全部通过 ✅' : `\n失败 ${failures} 项 ❌`);
process.exit(failures === 0 ? 0 : 1);
