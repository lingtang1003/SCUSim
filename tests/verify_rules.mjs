/**
 * 每周固定规则自检（core/rhythm.js + engine 接线）
 * 运行：node tests/verify_rules.mjs
 *
 * 覆盖四条：
 *  A) 一周内没吃饭 → 扣健康（默认 −15）；吃了就不扣
 *  B) 每两周固定发生活费 +80（第 2 / 4 / 6 周）
 *  C) 金钱为负 → 只能兼职 / 休息，其余行动返回 reason=broke
 *  D) 属性连续两周没涨 → 掉 10 点，掉完重新计时（不会每周连扣）
 *  E) 没配 weeklyRules 的老配置 → 一条都不生效（向后兼容）
 *
 * 属性点合计必须 = 20（引擎校验），money 是"金钱点"，会按 walletPerMoneyPoint 换成元。
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config/loader.js';
import { createRng } from '../src/core/rng.js';
import {
  newGame, advance, doAction, moveToLocation, actionAvailability, resolvePendingEvent,
} from '../src/core/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.error(`  FAIL  ${name}  ${detail}`); }
}

const baseConfig = await loadConfig({ read: (p) => readFile(join(root, 'config', `${p}.json`), 'utf8') });
const RULES = baseConfig.balance.weeklyRules;
const clone = (o) => JSON.parse(JSON.stringify(o));

// 三套开局属性（合计都是 20 点）；学识一律 > 0，否则第一次推进就触发「退学」
const A_NO_MONEY = { knowledge: 5, social: 0, health: 15, money: 0 };
const A_WITH_MONEY = { knowledge: 4, social: 0, health: 11, money: 5 };
const A_RICH = { knowledge: 4, social: 0, health: 10, money: 6 };
const D_NOBLE = { knowledge: 18, social: 1, health: 1, money: 0 };

/** 开一局并把开局固定事件结算掉，返回 { state, rng } */
function boot(attrs, config) {
  const cfg = config || baseConfig;
  const rng = createRng(7);
  const ng = newGame({
    name: '规则生', gender: '男', collegeId: 'cs',
    attributes: attrs || A_NO_MONEY,
    tags: ['study_hard', 'gamer', 'chill'],
    seed: 7,
  }, cfg, rng);
  if (!ng.ok) throw new Error('newGame 失败: ' + ng.reason);
  const s = ng.state;
  if (s.pendingEvent) {
    const opt = (s.pendingEvent.options || []).find((o) => o.enabled !== false) || s.pendingEvent.options[0];
    resolvePendingEvent(s, opt.id, cfg, rng);
  }
  return { s, rng };
}

console.log('== SCUSim 每周固定规则自检 ==');

// ---------------------------------------------------------------------------
// A) 一周内必须吃一次饭
// ---------------------------------------------------------------------------
{
  const { s, rng } = boot(A_NO_MONEY);
  const h0 = s.player.attributes.health;
  const res = advance(s, baseConfig, rng);
  const hp = RULES.eat.healthPenalty;
  check('A: 这周没吃饭 → 健康 −' + hp,
    s.player.attributes.health === h0 - hp,
    h0 + ' → ' + s.player.attributes.health);
  check('A: 扣血会给出提示',
    (res.notices || []).some((n) => n.type === 'eat'), JSON.stringify(res.notices || []));
}
{
  const { s, rng } = boot(A_WITH_MONEY);
  moveToLocation(s, 'canteen', baseConfig);
  const eat = doAction(s, 'eat', baseConfig, rng);
  check('A: 在食堂能吃到饭', eat.ok === true, eat.reason || '');
  const hAfterEat = s.player.attributes.health;
  const res = advance(s, baseConfig, rng);
  check('A: 这周吃过饭 → 不再扣健康',
    s.player.attributes.health === hAfterEat,
    hAfterEat + ' → ' + s.player.attributes.health);
  check('A: 吃过饭就没有 eat 提示',
    !(res.notices || []).some((n) => n.type === 'eat'), JSON.stringify(res.notices || []));
}
{
  // 商业街吃饭也算（在 street 上做 socialize）
  const { s, rng } = boot(A_RICH);
  moveToLocation(s, 'street', baseConfig);
  const act = doAction(s, 'socialize', baseConfig, rng);
  check('A: 商业街的社交能执行', act.ok === true, act.reason || '');
  const h = s.player.attributes.health;
  const res = advance(s, baseConfig, rng);
  check('A: 商业街也算这周吃过饭',
    s.player.attributes.health === h && !(res.notices || []).some((n) => n.type === 'eat'),
    h + ' → ' + s.player.attributes.health);
}

// ---------------------------------------------------------------------------
// B) 每周固定扣费 −20；每两周再发生活费 +80
// ---------------------------------------------------------------------------
{
  const { s, rng } = boot(A_NO_MONEY);
  const amount = RULES.allowance.amount;
  const every = RULES.allowance.everyTurns;
  const fee = RULES.fee.amount;
  const m0 = s.player.attributes.money;
  const r1 = advance(s, baseConfig, rng);       // → 第 2 周（扣开销 + 发生活费）
  check(`B: 第 2 周 = 生活费 +${amount} − 固定开销 ${fee}`,
    s.player.attributes.money === m0 + amount - fee,
    m0 + ' → ' + s.player.attributes.money);
  check('B: 生活费给 success 提示',
    (r1.notices || []).some((n) => n.type === 'allowance' && n.tone === 'success'));
  check('B: 固定开销给 fee 提示',
    (r1.notices || []).some((n) => n.type === 'fee' && String(n.text).includes(String(fee))),
    JSON.stringify(r1.notices || []));
  const m2 = s.player.attributes.money;
  advance(s, baseConfig, rng);                  // → 第 3 周（只扣开销）
  check('B: 第 3 周只扣固定开销（每 ' + every + ' 周才发一次）',
    s.player.attributes.money === m2 - fee, m2 + ' → ' + s.player.attributes.money);
  const m3 = s.player.attributes.money;
  advance(s, baseConfig, rng);                  // → 第 4 周（扣开销 + 发生活费）
  check(`B: 第 4 周再 +${amount} − ${fee}`,
    s.player.attributes.money === m3 + amount - fee,
    m3 + ' → ' + s.player.attributes.money);
}

// ---------------------------------------------------------------------------
// C) 金钱为负 → 只能兼职 / 休息
// ---------------------------------------------------------------------------
{
  const { s } = boot(A_NO_MONEY);
  s.player.attributes.money = -1;
  moveToLocation(s, 'dorm', baseConfig);
  const rest = actionAvailability(s, 'rest', baseConfig);
  check('C: 没钱也能休息（防止死锁）', rest.ok === true, JSON.stringify(rest));
  moveToLocation(s, 'library', baseConfig);
  const study = actionAvailability(s, 'study', baseConfig);
  check('C: 没钱不能学习（reason=broke）',
    study.ok === false && study.reason === 'broke', JSON.stringify(study));
  moveToLocation(s, 'wj_gate', baseConfig);
  const part = actionAvailability(s, 'parttime', baseConfig);
  check('C: 没钱可以兼职', part.ok === true, JSON.stringify(part));
  const doIt = doAction(s, 'parttime', baseConfig, createRng(3));
  check('C: 兼职真的能执行', doIt.ok === true, doIt.reason || '');
}
{
  const { s } = boot(A_NO_MONEY);
  s.player.attributes.money = 0;
  moveToLocation(s, 'library', baseConfig);
  check('C: 金钱 ≥ 0 时不锁行动',
    actionAvailability(s, 'study', baseConfig).ok === true);
}

// ---------------------------------------------------------------------------
// D) 连续两周属性没涨 → 学识 −5 / 其他 −10
// ---------------------------------------------------------------------------
const KNEG = Number.isFinite(Number(RULES.neglect.amounts && RULES.neglect.amounts.knowledge))
  ? Number(RULES.neglect.amounts.knowledge)
  : RULES.neglect.amount;
{
  const { s, rng } = boot(D_NOBLE);
  const k0 = s.player.attributes.knowledge;
  const s0 = s.player.attributes.social;   // 开局社团事件会给一点社交，这里取"结算后的值"
  advance(s, baseConfig, rng);   // → 第 2 周（只过了一周）
  check('D: 只过一周不扣（还没满两周）',
    s.player.attributes.knowledge === k0, k0 + ' → ' + s.player.attributes.knowledge);
  const r2 = advance(s, baseConfig, rng);   // → 第 3 周（两周没涨）
  check(`D: 连续两周没涨学识 → 扣 ${KNEG}（比社交/健康轻）`,
    s.player.attributes.knowledge === k0 - KNEG,
    k0 + ' → ' + s.player.attributes.knowledge);
  check('D: 扣属性会给出提示',
    (r2.notices || []).some((n) => n.type === 'neglect' && String(n.text).includes('学识')));
  const k2 = s.player.attributes.knowledge;
  advance(s, baseConfig, rng);   // → 第 4 周（学识刚扣过，重新计时；社交这时才满两周）
  check('D: 扣完重新计时，不会每周连扣',
    s.player.attributes.knowledge === k2, k2 + ' → ' + s.player.attributes.knowledge);
  check('D: 社交没涨掉 ' + RULES.neglect.amount + '（用基础值，不受学识覆盖影响）',
    s.player.attributes.social === Math.max(0, s0 - RULES.neglect.amount),
    s0 + ' → ' + s.player.attributes.social);
}
{
  // 这一周涨过 → 计时重置
  const { s, rng } = boot(A_NO_MONEY);
  moveToLocation(s, 'library', baseConfig);
  const st = doAction(s, 'study', baseConfig, rng);   // 第 1 周涨学识
  check('D: 准备：学习能涨学识', st.ok === true, st.reason || '');
  const k1 = s.player.attributes.knowledge;
  advance(s, baseConfig, rng);                 // → 第 2 周
  check('D: 这周涨过学识 → 不扣', s.player.attributes.knowledge === k1,
    k1 + ' → ' + s.player.attributes.knowledge);
  advance(s, baseConfig, rng);                 // → 第 3 周（第 2 周没涨，仅一周）
  check('D: 第 2 周没涨但只隔一周 → 仍不扣',
    s.player.attributes.knowledge === k1, k1 + ' → ' + s.player.attributes.knowledge);
  advance(s, baseConfig, rng);                 // → 第 4 周（第 2、3 周都没涨）
  check(`D: 连着两周没涨 → 扣 ${KNEG}（不够扣就到 0）`,
    s.player.attributes.knowledge === Math.max(0, k1 - KNEG),
    k1 + ' → ' + s.player.attributes.knowledge);
}

// ---------------------------------------------------------------------------
// F) 健康 0 → 只能做「加健康」的活动
// ---------------------------------------------------------------------------
{
  const { s } = boot(A_WITH_MONEY);
  s.player.attributes.health = 0;
  moveToLocation(s, 'library', baseConfig);
  const study = actionAvailability(s, 'study', baseConfig);
  check('F: 健康 0 不能学习（reason=zero_health）',
    study.ok === false && study.reason === 'zero_health', JSON.stringify(study));
  moveToLocation(s, 'dorm', baseConfig);
  const rest = actionAvailability(s, 'rest', baseConfig);
  check('F: 健康 0 可以休息（+3 健康）', rest.ok === true, JSON.stringify(rest));
  moveToLocation(s, 'canteen', baseConfig);
  const eat = actionAvailability(s, 'eat', baseConfig);
  check('F: 健康 0 可以吃饭（+3 健康，但要钱）', eat.ok === true, JSON.stringify(eat));
}

// ---------------------------------------------------------------------------
// G) 学识归零 = 退学，直接触发「学业警示」结局
// ---------------------------------------------------------------------------
{
  const { s, rng } = boot({ knowledge: 4, social: 8, health: 8, money: 0 });
  s.player.attributes.knowledge = 0;
  const r = advance(s, baseConfig, rng);
  const want = (baseConfig.balance.dropout && baseConfig.balance.dropout.endingId) || 'ending_warning';
  check('G: 学识归零 → 立即结束本局', r.ok === true && r.endingId === want,
    JSON.stringify({ ok: r.ok, endingId: r.endingId }));
  check('G: state.endingId 被写成学业警示', s.endingId === want, String(s.endingId));
  check('G: 退学这一步不再生成事件', !s.pendingEvent, JSON.stringify(s.pendingEvent));
  check('G: 退学写进履历', (s.history || []).some((h) => h.type === 'dropout'));
}
{
  const { s, rng } = boot({ knowledge: 8, social: 6, health: 6, money: 0 });
  const r = advance(s, baseConfig, rng);
  check('G: 学识 > 0 时不会退学', !r.endingId && !s.endingId,
    JSON.stringify({ endingId: r.endingId, stateEnding: s.endingId }));
}
{
  // 没配 dropout 的旧配置：学识 0 也不退学
  const cfg = clone(baseConfig);
  delete cfg.balance.dropout;
  const { s, rng } = boot({ knowledge: 4, social: 8, health: 8, money: 0 }, cfg);
  s.player.attributes.knowledge = 0;
  const r = advance(s, cfg, rng);
  check('G: 没配 dropout 时不退学（向后兼容）', !r.endingId && !s.endingId);
}

// ---------------------------------------------------------------------------
// E) 老配置（没有 weeklyRules）→ 全部不生效
// ---------------------------------------------------------------------------
{
  const cfg = clone(baseConfig);
  delete cfg.balance.weeklyRules;
  const { s, rng } = boot(A_NO_MONEY, cfg);
  const h0 = s.player.attributes.health;
  const m0 = s.player.attributes.money;
  advance(s, cfg, rng);
  check('E: 没配规则时不扣饭钱', s.player.attributes.health === h0,
    h0 + ' → ' + s.player.attributes.health);
  check('E: 没配规则时不发生活费', s.player.attributes.money === m0,
    m0 + ' → ' + s.player.attributes.money);
  s.player.attributes.money = -5;
  moveToLocation(s, 'library', cfg);
  check('E: 没配规则时没钱也不锁行动',
    actionAvailability(s, 'study', cfg).ok === true);
}

console.log(`\n总计 ${pass + failures.length} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
