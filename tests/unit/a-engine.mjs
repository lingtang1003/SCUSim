/**
 * A 引擎单测（负责人 A，W1–W3）
 * 运行：node tests/unit/a-engine.mjs
 *
 * 覆盖：
 *  1) state：clampAttrs（全局 {min,max} / 按属性数组 / money 不钳制）、pushHistory/pushLog 环形
 *  2) newGame：v2 字段、标签修正叠加、初始资金兑换（配置驱动）
 *  3) doAction：三档加成（threeTierBonus.bonus 映射）、健康白名单、学习惩罚、pending 阻断、AP=0
 *  4) advance：月初结算、期末 4 科、学期记录/学习计数重置、40 回合、可复现、终局不出事件
 *  5) ending：条件引擎（all/any/7 类）、主+副结局、优先级方向
 *  6) W2 API：drawTagCandidates / buildViewModel
 *  7) 决赛决议：期末永不挂科（failedCourses 恒 0、warning 不触发）
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../../src/config/loader.js';
import { createRng } from '../../src/core/rng.js';
import {
  newGame, actionAvailability, doAction, advance, getEnding,
  drawTagCandidates, buildViewModel,
} from '../../src/core/engine.js';
import { judgeEnding, evaluateCondition } from '../../src/core/ending.js';
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

function patch(mutator) {
  const cfg = JSON.parse(JSON.stringify(base));
  if (mutator) mutator(cfg);
  return cfg;
}

function stateWithoutPending(cfg = base, seed = 7) {
  const ng = newGame(OPTIONS, cfg, createRng(seed));
  if (!ng.ok) throw new Error('newGame 失败: ' + ng.reason);
  ng.state.pendingEvent = null;
  return ng.state;
}

console.log('== A 引擎单测（a-engine · W1–W3）==');

// ---------------- 1) state ----------------
{
  const s = createGameState(OPTIONS);
  s.player.attributes = { knowledge: -5, social: 120, health: 3.6, money: -5000 };
  clampAttrs(s, base);
  const cap = Array.isArray(base.balance.attributeClamp.social)
    ? base.balance.attributeClamp.social[1]
    : (Number.isFinite(base.balance.attributeClamp.max) ? base.balance.attributeClamp.max : 99);
  check('clampAttrs: knowledge -5 → 0', s.player.attributes.knowledge === 0, String(s.player.attributes.knowledge));
  check(`clampAttrs: social 120 → 配置上限 ${cap}`, s.player.attributes.social === cap, String(s.player.attributes.social));
  check('clampAttrs: health 3.6 → 4（取整）', s.player.attributes.health === 4, String(s.player.attributes.health));
  check('clampAttrs: money 为货币，不钳制（-5000 保留）', s.player.attributes.money === -5000, String(s.player.attributes.money));

  const cfgPerKey = patch((c) => { c.balance.attributeClamp = { knowledge: [0, 99], social: [0, 99], health: [0, 99], money: null }; });
  const s2 = createGameState(OPTIONS);
  s2.player.attributes = { knowledge: 120, social: 5, health: 5, money: 5 };
  clampAttrs(s2, cfgPerKey);
  check('clampAttrs: 兼容按属性数组写法（knowledge 120 → 99）', s2.player.attributes.knowledge === 99, String(s2.player.attributes.knowledge));

  const s3 = createGameState(OPTIONS);
  for (let i = 0; i < 70; i += 1) pushHistory(s3, { type: 't', text: '#' + i }, base);
  check('pushHistory: 环形截断到 60 条', s3.history.length === 60, String(s3.history.length));
  const s4 = createGameState(OPTIONS);
  for (let i = 0; i < 70; i += 1) pushLog(s4, 'line ' + i, base);
  check('pushLog: 环形截断到 60 条', s4.log.length === 60, String(s4.log.length));
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

  // 三标签修正：study_hard(k+2,h-1) + gamer(k+1,h-1,s-1) + chill(k-1,h+1)
  check('newGame: 标签修正叠加（学识 5→7 / 健康 5→4 / 社交 5→4）',
    s.player.attributes.knowledge === 7 && s.player.attributes.health === 4 && s.player.attributes.social === 4,
    JSON.stringify(s.player.attributes));
  check('newGame: 标签修正写入履历', s.history.some((h) => h.type === 'tags'));

  const cfgWallet = patch((c) => { c.balance.walletPerMoneyPoint = 20; });
  const ng2 = newGame(OPTIONS, cfgWallet, createRng(1));
  check('newGame: walletPerMoneyPoint=20 → 初始资金 = 5 点 × 20 = 100（D-01，值由配置定）',
    ng2.state.player.attributes.money === 100, String(ng2.state.player.attributes.money));

  const bad = newGame({ ...OPTIONS, attributes: { knowledge: 5, social: 5, health: 5, money: 4 } }, base, createRng(1));
  check('newGame: 属性和≠20 仍被拒绝', bad.ok === false && bad.reason === 'attributes');
}

// ---------------- 3) doAction ----------------
{
  const cases = [[9, 11], [10, 13], [19, 22], [20, 24]];
  for (const [before, expected] of cases) {
    const s = stateWithoutPending(base);
    s.player.attributes.knowledge = before;
    s.player.attributes.health = 30;
    const r = doAction(s, 'study', base, createRng(3));
    check(`tierBonus: 学识 ${before} → ${expected}（+2 基础 + 档位 ${expected - before - 2}）`,
      r.ok && s.player.attributes.knowledge === expected,
      `got ${s.player.attributes.knowledge}, reason ${r.reason || ''}`);
  }

  const cfgNoMain = patch((c) => { delete c.actions.list.find((a) => a.id === 'study').mainAttr; });
  const sNoMain = stateWithoutPending(cfgNoMain);
  sNoMain.player.attributes.knowledge = 20;
  sNoMain.player.attributes.health = 30;
  doAction(sNoMain, 'study', cfgNoMain, createRng(3));
  check('tierBonus: 行动未声明 mainAttr 时无加成（20 → 22）',
    sNoMain.player.attributes.knowledge === 22, String(sNoMain.player.attributes.knowledge));

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

  const sNoPenalty = stateWithoutPending(); sNoPenalty.player.attributes.health = 4; sNoPenalty.player.attributes.knowledge = 9;
  doAction(sNoPenalty, 'study', base, createRng(4));
  check('未配置 studyPenalty：健康 4 学习仍 +2（9 → 11）',
    sNoPenalty.player.attributes.knowledge === 11, String(sNoPenalty.player.attributes.knowledge));

  const cfgPenalty = patch((c) => { c.balance.studyPenalty = { dropChance: 1, dropAmount: 1 }; c.balance.healthStudyPenaltyBelow = 5; });
  const sPenalty = stateWithoutPending(cfgPenalty); sPenalty.player.attributes.health = 4; sPenalty.player.attributes.knowledge = 9;
  doAction(sPenalty, 'study', cfgPenalty, createRng(4));
  check('配置 studyPenalty：健康 4 学习不增长且必扣 1（9 → 8）',
    sPenalty.player.attributes.knowledge === 8, String(sPenalty.player.attributes.knowledge));

  const sPending = stateWithoutPending();
  sPending.pendingEvent = { eventId: 'ev_fixed_club_recruit', options: [], resolved: false };
  const before = JSON.stringify(sPending);
  const rp = doAction(sPending, 'study', base, createRng(5));
  check('pendingEvent 存在时 doAction 被拒绝（pending_event）',
    rp.ok === false && rp.reason === 'pending_event', String(rp.reason));
  check('pendingEvent 阻断时 state 不变', JSON.stringify(sPending) === before);

  const sAp = stateWithoutPending();
  sAp.actionPoints = 0;
  const beforeAp = JSON.stringify(sAp);
  const ra = doAction(sAp, 'study', base, createRng(5));
  check('AP=0 时 doAction 拒绝（AP）且 state 不变',
    ra.ok === false && ra.reason === 'AP' && JSON.stringify(sAp) === beforeAp);
}

// ---------------- 4) advance ----------------
{
  const s = stateWithoutPending(base);
  const moneyBefore = s.player.attributes.money;
  const r = advance(s, base, createRng(11));
  const net = Number(base.balance.monthlyIncome) - Number(base.balance.monthlyExpense);
  check('advance: 回合 +1 且 AP 重置为 4', s.turn === 2 && s.actionPoints === 4, `turn=${s.turn} ap=${s.actionPoints}`);
  check('advance: 月初结算按配置净额入账', s.player.attributes.money === moneyBefore + net,
    `money=${s.player.attributes.money} net=${net}`);
  check('advance: 返回 monthly {income,expense,net}', r.monthly && typeof r.monthly.net === 'number');

  const cfgExam = patch((c) => { c.balance.examTurns = [5]; });
  const se = stateWithoutPending(cfgExam);
  for (let i = 0; i < 4; i += 1) advance(se, cfgExam, createRng(20 + i));
  check('advance: 第 5 回合触发期末结算', se.turn === 5);
  const rec = se.academics.semesterRecords[se.academics.semesterRecords.length - 1];
  check('advance: 期末科目数 = 配置 subjects 数（4 门）',
    rec && rec.subjects.length === base.balance.exam.subjects.length,
    String(rec && rec.subjects.length));
  check('advance: 分数落在 [passLine, 100]（永不挂科决议）',
    rec && rec.subjects.every((x) => x.score >= base.balance.exam.passLine && x.score <= 100),
    JSON.stringify(rec && rec.subjects.map((x) => x.score)));
  check('advance: 学期结束后 studyActions 归零', se.academics.studyActions === 0, String(se.academics.studyActions));

  const s40 = stateWithoutPending(base, 12345);
  let guard = 0;
  while (s40.turn < 40 && !s40.endingId && guard < 100) { guard += 1; advance(s40, base, createRng(400 + guard)); }
  check('advance: 40 回合后 turn 停在 40', s40.turn === 40, String(s40.turn));
  check('advance: 终局写入 endingId', typeof s40.endingId === 'string' && s40.endingId.length > 0, String(s40.endingId));
  check('advance: 8 个学期都有成绩记录', s40.academics.semesterRecords.length === 8, String(s40.academics.semesterRecords.length));
  check('advance: 终局回合不再残留待处理事件', s40.pendingEvent === null);
  check('advance: 属性始终落在配置区间（money 除外）',
    ['knowledge', 'social', 'health'].every((k) => s40.player.attributes[k] >= 0 && s40.player.attributes[k] <= 100));

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

  // 永不挂科决议：从 0 学识开局跑满 8 学期，不挂科、不触发学业警告
  const sZero = (() => {
    const ng = newGame({ ...OPTIONS, attributes: { knowledge: 0, social: 10, health: 5, money: 5 } }, base, createRng(9));
    ng.state.pendingEvent = null;
    return ng.state;
  })();
  let g2 = 0;
  while (sZero.turn < 40 && !sZero.endingId && g2 < 100) { g2 += 1; advance(sZero, base, createRng(50 + g2)); }
  check('决赛决议: 学识 0 开局 8 学期也不挂科（failedCourses=0）',
    sZero.academics.failedCourses === 0, String(sZero.academics.failedCourses));
  check('决赛决议: 学业警告不触发（warning=false）', sZero.academics.warning === false);
}

// ---------------- 5) ending 条件引擎 ----------------
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

  const cfgCustom = patch((c) => {
    c.balance.endingPriorityOrder = 'asc';
    c.endings.list = [
      { id: 'E1', name: '保研', priority: 1, condition: { type: 'all', conditions: [
        { type: 'attributeAtLeast', key: 'knowledge', value: 10 },
        { type: 'warningTrue', negate: true },
        { type: 'gpaAtLeast', value: 3.0 },
      ] } },
      { id: 'E2', name: '就业', priority: 2, condition: { type: 'any', conditions: [
        { type: 'flagEquals', key: 'romance', value: 'married' },
        { type: 'collegeIs', value: 'cs' },
      ] } },
      { id: 'E3', name: '毕业', priority: 3, condition: { type: 'default' } },
    ];
  });
  const st2 = createGameState(OPTIONS);
  st2.player.attributes.knowledge = 20;
  st2.academics.totalGpa = 3.5;
  const judged = judgeEnding(st2, cfgCustom);
  check('ending: all/any/多类型组合命中主结局 E1', judged.main === 'E1', String(judged.main));
  check('ending: 其余命中项记为副结局', JSON.stringify(judged.subs) === JSON.stringify(['E2', 'E3']), JSON.stringify(judged.subs));

  const st3 = createGameState(OPTIONS);
  st3.academics.totalGpa = 3.5;
  check('ending: all 中任一不满足则不命中（warning 为真）',
    evaluateCondition(cfgCustom.endings.list[0].condition, Object.assign(st3, { academics: { totalGpa: 3.5, warning: true } }), cfgCustom) === false);
  check('ending: default 恒真', evaluateCondition({ type: 'default' }, st3, cfgCustom) === true);
  check('ending: 未知类型不命中且不抛错', evaluateCondition({ type: 'nope' }, st3, cfgCustom) === false);
}

// ---------------- 6) W2 API ----------------
{
  const rng = createRng(42);
  const c = drawTagCandidates(base, rng);
  check('drawTagCandidates: 返回 6 个不重复 id', c.length === 6 && new Set(c).size === 6, JSON.stringify(c));
  check('drawTagCandidates: id 都存在于 tags.json',
    c.every((id) => base.tags.list.some((t) => t.id === id)), JSON.stringify(c));
  const c2 = drawTagCandidates(base, createRng(42));
  check('drawTagCandidates: 同种子同一批（可复现）', JSON.stringify(c) === JSON.stringify(c2));

  const s = stateWithoutPending();
  const vm = buildViewModel(s, base);
  check('buildViewModel: availability 覆盖全部行动',
    Object.keys(vm.availability).length === base.actions.list.length);
  check('buildViewModel: actions 带 enabled/reason',
    Array.isArray(vm.actions) && vm.actions.every((a) => typeof a.enabled === 'boolean' && typeof a.reason === 'string'));
  check('buildViewModel: 带 tierInfo / debtThreshold / seed',
    vm.tierInfo && Array.isArray(vm.tierInfo.thresholds)
    && typeof vm.debtThreshold === 'number'
    && typeof vm.seed === 'number');
}

// ---------------- 汇总 ----------------
const total = pass + failures.length;
console.log(`\n== a-engine 结果 ==`);
console.log(`总计 ${total} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
