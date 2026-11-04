/**
 * A · W1 引擎单测（负责人 A）
 * 运行：node tests/unit/a-engine.mjs
 *
 * 覆盖 CONTRACT §2.3/§2.4 中 A 负责的规则：
 *  1) state: clampAttrs 边界（含 money 不钳制，D-01）、pushHistory / pushLog 环形截断
 *  2) newGame: GameState v2 字段齐备；walletPerMoneyPoint 配置驱动的初始资金兑换（D-01）
 *  3) doAction: 三档加成（D-04）、健康<3 行动白名单（D-03）、健康<5 学习惩罚（配置驱动）、
 *     待处理事件阻断（设计 §11.1#9）、AP=0 拒绝且 state 不变
 *  4) advance: 月初收支、学期考试/绩点/学习计数重置、40 回合终局、同种子可复现
 *  5) ending: 优先级方向配置（D-02，默认 desc 兼容现状，asc 为 W3 目标口径）
 *
 * 说明：第 3/4 组用例会把 state.pendingEvent 清空，目的是隔离「行动规则」，
 * 事件链路由第 6 组单独验证。
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../../src/config/loader.js';
import { createRng } from '../../src/core/rng.js';
import {
  newGame, actionAvailability, doAction, advance, resolvePendingEvent, getEnding,
} from '../../src/core/engine.js';
import { clampAttrs, pushHistory, pushLog, createGameState } from '../../src/core/state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.error(`  FAIL  ${name}  ${detail}`); }
}

const reader = { read: (path) => readFile(join(root, 'config', `${path}.json`), 'utf8') };
const base = await loadConfig(reader);

const OPTIONS = {
  name: '引擎生', gender: '男', collegeId: 'cs',
  attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
  tags: ['study_hard', 'gamer', 'chill'],
  seed: 2024,
};

/** 深拷贝配置并按需覆盖（模拟 B/D 已合并的 v2 字段，验证接线而非等配置） */
function patch(mutator) {
  const cfg = JSON.parse(JSON.stringify(base));
  if (mutator) mutator(cfg);
  return cfg;
}

/** 新开一局并清掉回合 1 的固定事件，隔离行动规则 */
function stateWithoutPending(cfg = base, seed = 7) {
  const ng = newGame(OPTIONS, cfg, createRng(seed));
  if (!ng.ok) throw new Error('newGame 失败: ' + ng.reason);
  ng.state.pendingEvent = null;
  return ng.state;
}

console.log('== A · W1 引擎单测（a-engine）==');

// ---------------- 1) state ----------------
{
  const s = createGameState(OPTIONS);
  s.player.attributes = { knowledge: -5, social: 120, health: 3.6, money: -5000 };
  clampAttrs(s, base);
  check('clampAttrs: knowledge -5 → 0', s.player.attributes.knowledge === 0, String(s.player.attributes.knowledge));
  check('clampAttrs: social 120 → 99', s.player.attributes.social === 99, String(s.player.attributes.social));
  check('clampAttrs: health 3.6 → 4（取整）', s.player.attributes.health === 4, String(s.player.attributes.health));
  check('clampAttrs: money 为货币，不钳制（-5000 保留）', s.player.attributes.money === -5000, String(s.player.attributes.money));

  const s2 = createGameState(OPTIONS);
  for (let i = 0; i < 70; i += 1) pushHistory(s2, { type: 't', text: '#' + i }, base);
  check('pushHistory: 环形截断到 60 条', s2.history.length === 60, String(s2.history.length));
  check('pushHistory: 保留最新一条', s2.history[s2.history.length - 1].text === '#69', s2.history[s2.history.length - 1].text);
  const s3 = createGameState(OPTIONS);
  for (let i = 0; i < 70; i += 1) pushLog(s3, 'line ' + i, base);
  check('pushLog: 环形截断到 60 条', s3.log.length === 60, String(s3.log.length));
}

// ---------------- 2) newGame ----------------
{
  const ng = newGame(OPTIONS, base, createRng(1));
  const s = ng.state;
  check('newGame: GameState v2 字段齐备',
    ng.ok === true
    && s.player.club === null
    && s.player.romance === 'none'
    && typeof s.player.flags === 'object'
    && Array.isArray(s.academics.semesterRecords)
    && Array.isArray(s.history)
    && s.academics.totalGpa === 0
    && s.academics.thesis === null);
  check('newGame: 未配置 walletPerMoneyPoint 时保持点数语义（money=5）',
    s.player.attributes.money === 5, String(s.player.attributes.money));

  const cfgWallet = patch((c) => { c.balance.walletPerMoneyPoint = 200; });
  const ng2 = newGame(OPTIONS, cfgWallet, createRng(1));
  check('newGame: walletPerMoneyPoint=200 → 初始资金 1000（D-01）',
    ng2.state.player.attributes.money === 1000, String(ng2.state.player.attributes.money));

  const bad = newGame({ ...OPTIONS, attributes: { knowledge: 5, social: 5, health: 5, money: 4 } }, base, createRng(1));
  check('newGame: 属性和≠20 仍被拒绝', bad.ok === false && bad.reason === 'attributes');
}

// ---------------- 3) doAction ----------------
{
  // 三档加成：需要 actions.mainAttr + balance.tierBonus（B/D 的 W2 配置）
  const cfgTier = patch((c) => {
    c.actions.list.find((a) => a.id === 'study').mainAttr = 'knowledge';
    c.balance.tierBonus = { thresholds: [10, 20], bonuses: [1, 2] };
  });
  const cases = [[9, 11], [10, 13], [19, 22], [20, 24]];
  for (const [before, expected] of cases) {
    const s = stateWithoutPending(cfgTier);
    s.player.attributes.knowledge = before;
    s.player.attributes.health = 30; // 避开低健康惩罚与健康限制
    const r = doAction(s, 'study', cfgTier, createRng(3));
    check(`tierBonus: 学识 ${before} → ${expected}（含 +${expected - before - 2} 档位加成）`,
      r.ok && s.player.attributes.knowledge === expected,
      `got ${s.player.attributes.knowledge}, reason ${r.reason || ''}`);
  }
  const sNoMain = stateWithoutPending(base);
  sNoMain.player.attributes.knowledge = 20;
  sNoMain.player.attributes.health = 30;
  doAction(sNoMain, 'study', base, createRng(3));
  check('tierBonus: 行动未声明 mainAttr 时无加成（20 → 22）',
    sNoMain.player.attributes.knowledge === 22, String(sNoMain.player.attributes.knowledge));

  // 健康 <3 行动白名单（D-03）
  const s0 = stateWithoutPending(); s0.player.attributes.health = 0;
  check('健康 0：学习被拒绝（health）', actionAvailability(s0, 'study', base).reason === 'health');
  check('健康 0：休息可用', actionAvailability(s0, 'rest', base).ok === true);
  const s2 = stateWithoutPending(); s2.player.attributes.health = 2;
  check('健康 2：锻炼可用', actionAvailability(s2, 'exercise', base).ok === true);
  check('健康 2：兼职被健康白名单拒绝', actionAvailability(s2, 'parttime', base).reason === 'health');
  const s1 = stateWithoutPending(); s1.player.attributes.health = 1;
  check('健康 1：锻炼仍被 requiresHealth=2 拦截', actionAvailability(s1, 'exercise', base).reason === 'health');
  const s3 = stateWithoutPending(); s3.player.attributes.health = 3;
  check('健康 3：学习恢复可用', actionAvailability(s3, 'study', base).ok === true);

  // 健康 <5 学习惩罚（配置驱动，未配置时不生效）
  const sNoPenalty = stateWithoutPending(); sNoPenalty.player.attributes.health = 4; sNoPenalty.player.attributes.knowledge = 20;
  doAction(sNoPenalty, 'study', base, createRng(4));
  check('未配置 studyPenalty：健康 4 学习仍 +2（20 → 22）',
    sNoPenalty.player.attributes.knowledge === 22, String(sNoPenalty.player.attributes.knowledge));

  const cfgPenalty = patch((c) => { c.balance.studyPenalty = { dropChance: 1, dropAmount: 1 }; c.balance.healthStudyPenaltyBelow = 5; });
  const sPenalty = stateWithoutPending(cfgPenalty); sPenalty.player.attributes.health = 4; sPenalty.player.attributes.knowledge = 20;
  doAction(sPenalty, 'study', cfgPenalty, createRng(4));
  check('配置 studyPenalty：健康 4 学习学识不增长且必扣 1（20 → 19）',
    sPenalty.player.attributes.knowledge === 19, String(sPenalty.player.attributes.knowledge));

  // 待处理事件阻断（设计 §11.1#9）
  const sPending = stateWithoutPending();
  sPending.pendingEvent = { eventId: 'ev_fixed_club_recruit', options: [], resolved: false };
  const before = JSON.stringify(sPending);
  const rp = doAction(sPending, 'study', base, createRng(5));
  check('pendingEvent 存在时 doAction 被拒绝（pending_event）',
    rp.ok === false && rp.reason === 'pending_event', String(rp.reason));
  check('pendingEvent 阻断时 state 不变', JSON.stringify(sPending) === before);

  // AP=0
  const sAp = stateWithoutPending();
  sAp.actionPoints = 0;
  const beforeAp = JSON.stringify(sAp);
  const ra = doAction(sAp, 'study', base, createRng(5));
  check('AP=0 时 doAction 拒绝（AP）且 state 不变',
    ra.ok === false && ra.reason === 'AP' && JSON.stringify(sAp) === beforeAp);
}

// ---------------- 4) advance ----------------
{
  const cfgMoney = patch((c) => { c.balance.monthlyIncome = 2000; c.balance.monthlyExpense = 1800; });
  const s = stateWithoutPending(cfgMoney);
  s.player.attributes.money = 500;
  const r = advance(s, cfgMoney, createRng(11));
  check('advance: 回合 +1 且 AP 重置为 4', s.turn === 2 && s.actionPoints === 4, `turn=${s.turn} ap=${s.actionPoints}`);
  check('advance: 月初结算 +2000/−1800 → money 500→700', s.player.attributes.money === 700, String(s.player.attributes.money));
  check('advance: 返回 monthly {income,expense,net}', r.monthly && r.monthly.income === 2000 && r.monthly.expense === 1800 && r.monthly.net === 200);

  const cfgExam = patch((c) => { c.balance.examTurns = [5]; });
  const se = stateWithoutPending(cfgExam);
  for (let i = 0; i < 3; i += 1) advance(se, cfgExam, createRng(20 + i));
  se.academics.studyActions = 3;
  advance(se, cfgExam, createRng(30)); // 进入第 5 周（期末周开始）
  const re = advance(se, cfgExam, createRng(31)); // 结束第 5 周 → 期末结算
  check('advance: 第 5 周结束时触发期末结算', se.turn === 6 && re.settlement !== null, `turn=${se.turn}`);
  check('advance: settlement 含科目/绩点/挂科/警告', re.settlement
    && Array.isArray(re.settlement.subjects)
    && re.settlement.subjects.length >= 1
    && typeof re.settlement.semesterGpa === 'number'
    && typeof re.settlement.totalGpa === 'number'
    && typeof re.settlement.failedCourses === 'number'
    && typeof re.settlement.warning === 'boolean');
  check('advance: 学期结算写 semesterRecords', se.academics.semesterRecords.length === 1);
  check('advance: 学期结束后 studyActions 归零', se.academics.studyActions === 0, String(se.academics.studyActions));

  // 40 回合终局
  const s40 = stateWithoutPending(base, 12345);
  let guard = 0;
  while (s40.turn < 40 && !s40.endingId && guard < 100) {
    guard += 1;
    advance(s40, base, createRng(400 + guard));
    // 期末周推迟的考试需要事件结算才会落账，这里每回合把事件结掉
    if (s40.pendingEvent) {
      resolvePendingEvent(s40, s40.pendingEvent.options[0].id, base, createRng(900 + guard));
    }
  }
  check('advance: 40 回合后 turn 停在 40', s40.turn === 40, String(s40.turn));
  check('advance: 终局写入 endingId', typeof s40.endingId === 'string' && s40.endingId.length > 0, String(s40.endingId));
  check('advance: 8 个学期都有成绩记录（examTurns 8 个）', s40.academics.semesterRecords.length === 8, String(s40.academics.semesterRecords.length));
  check('advance: 属性始终落在 [0,99]（money 除外）',
    ['knowledge', 'social', 'health'].every((k) => s40.player.attributes[k] >= 0 && s40.player.attributes[k] <= 99));
  check('advance: 履历环形缓冲不超 60', s40.history.length <= 60, String(s40.history.length));

  // 同种子可复现
  const runA = stateWithoutPending(base, 555);
  const runB = stateWithoutPending(base, 555);
  for (let i = 0; i < 12; i += 1) {
    advance(runA, base, createRng(900 + i));
    advance(runB, base, createRng(900 + i));
  }
  const key = (s) => JSON.stringify({
    turn: s.turn, ap: s.actionPoints, attrs: s.player.attributes,
    rngState: s.rngState, history: s.history.length,
  });
  check('advance: 同种子同输入两次完全一致', key(runA) === key(runB));
}

// ---------------- 5) ending 优先级方向 ----------------
{
  const s = createGameState(OPTIONS);
  s.player.attributes.knowledge = 40;
  const desc = getEnding(s, base);
  check('ending: 未配置方向时保持 desc 兼容（学识 40 → 学术之星）',
    desc.endingId === 'ending_academic_star', String(desc.endingId));

  const cfgAsc = patch((c) => { c.balance.endingPriorityOrder = 'asc'; });
  const asc = getEnding(s, cfgAsc);
  check('ending: endingPriorityOrder=asc 时按「越小越高」命中（→ 平凡四年）',
    asc.endingId === 'ending_ordinary', String(asc.endingId));
}

// ---------------- 6) 事件链路 ----------------
{
  const ng = newGame(OPTIONS, base, createRng(77));
  const s = ng.state;
  check('newGame: 回合 1 生成固定事件（社团招新）',
    !!s.pendingEvent && s.pendingEvent.eventId === 'ev_fixed_club_recruit',
    String(s.pendingEvent && s.pendingEvent.eventId));
  const first = s.pendingEvent.options[0];
  const r = resolvePendingEvent(s, first.id, base, createRng(78));
  check('resolvePendingEvent: 结算成功并清空 pending', r.ok === true && s.pendingEvent === null);
  check('resolvePendingEvent: 写入 eventHistory 与履历',
    s.eventHistory.includes('ev_fixed_club_recruit')
    && s.history.some((h) => h.type === 'choice'));
}

// ---------------- 汇总 ----------------
const total = pass + failures.length;
console.log(`\n== a-engine 结果 ==`);
console.log(`总计 ${total} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
