// B 模块单测 · 经济（settleMonthly / applyExtraMoney / checkDebt+markDebtTriggered / applyEffects）
// 运行：node tests/unit/b-economy.mjs
// 覆盖：月度收支、额外收支、负债触发与冷却、统一效果入口（属性钳制/money/flags/club/history）

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../../src/config/loader.js';
import { createGameState } from '../../src/core/state.js';
import { settleMonthly, applyExtraMoney, checkDebt, markDebtTriggered } from '../../src/core/economy.js';
import { applyEffects } from '../../src/core/effects.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const reader = { read: (p) => readFile(join(root, 'config', `${p}.json`), 'utf8') };
const config = await loadConfig(reader);
const balance = config.balance;

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.error(`  FAIL  ${name}  ${detail}`); failures++; }
}

const baseState = () => createGameState({
  name: '测试', gender: '男', collegeId: 'cs',
  attributes: { knowledge: 5, social: 5, health: 5, money: 0 },
  tags: ['study_hard', 'gamer', 'chill'],
});

console.log('== B · 经济单测 ==');

// --- settleMonthly：money 0 → income - expense ---
{
  const s = baseState();
  const r = settleMonthly(s, config);
  const income = Number(balance.monthlyIncome) || 0;
  const expense = Number(balance.monthlyExpense) || 0;
  check('settleMonthly: ok / 返回净额', r.ok === true && r.income === income && r.expense === expense && r.net === income - expense,
    JSON.stringify(r));
  check('settleMonthly: money 0 → ' + (income - expense), s.player.attributes.money === income - expense,
    `money=${s.player.attributes.money}`);
}

// --- settleMonthly：兼职/消费流水不混入固定生活费（修复「兼职收入被显示成生活费」） ---
{
  const s = baseState();
  s.__monthFlow = { income: 100, expense: 40 };
  const r = settleMonthly(s, config);
  const income = Number(balance.monthlyIncome) || 0;
  const expense = Number(balance.monthlyExpense) || 0;
  check('settleMonthly: fixedIncome 只含固定生活费', r.fixedIncome === income, `fixedIncome=${r.fixedIncome}`);
  check('settleMonthly: fixedExpense 只含固定开销', r.fixedExpense === expense, `fixedExpense=${r.fixedExpense}`);
  check('settleMonthly: 兼职/消费流水单独返回', r.flowIncome === 100 && r.flowExpense === 40, JSON.stringify(r));
  check('settleMonthly: 旧字段 income/expense/net 保持兼容（含流水）',
    r.income === income + 100 && r.expense === expense + 40 && r.net === (income + 100) - (expense + 40),
    JSON.stringify(r));
  check('settleMonthly: money 仍只入账固定净额（流水已即时入账，不重复）',
    s.player.attributes.money === income - expense, `money=${s.player.attributes.money}`);
}

// --- applyExtraMoney：正/负/零 ---
{
  const s = baseState();
  applyExtraMoney(s, 500, '奖学金');
  check('applyExtraMoney: 加 500', s.player.attributes.money === 500, `money=${s.player.attributes.money}`);
  applyExtraMoney(s, -200, '买书');
  check('applyExtraMoney: 减 200 → 300', s.player.attributes.money === 300, `money=${s.player.attributes.money}`);
  const before = s.log.length;
  applyExtraMoney(s, 0, '无变化');
  check('applyExtraMoney: 0 不写 log 不改 money', s.player.attributes.money === 300 && s.log.length === before);
}

// --- checkDebt：只读判定 + markDebtTriggered 记账 + 冷却 ---
{
  const threshold = Number.isFinite(balance.debtThreshold) ? balance.debtThreshold : -3000;
  const cooldown = Number.isFinite(balance.debtCooldownTurns) ? balance.debtCooldownTurns : 6;
  const s = baseState();
  s.player.attributes.money = threshold; // 恰好触线
  s.turn = 5;
  const first = checkDebt(s, config);
  check('checkDebt: money<=threshold 触发', first.triggered === true && first.eventId === 'ev_fixed_debt',
    JSON.stringify(first));
  // 判定与记账分离：checkDebt 只读，不提前写 lastDebtTurn（事件被固定事件抢先时不能被冷却掉）
  check('checkDebt: 只读判定不写 lastDebtTurn', !s.player.flags || !Number.isFinite(s.player.flags.lastDebtTurn),
    JSON.stringify(s.player.flags));
  markDebtTriggered(s); // 事件真正弹出后才由 engine 调用
  check('markDebtTriggered: 记账写入 lastDebtTurn', s.player.flags && s.player.flags.lastDebtTurn === 5,
    JSON.stringify(s.player.flags));
  const again = checkDebt(s, config);
  check('checkDebt: 冷却期内不重复触发', again.triggered === false, JSON.stringify(again));
  s.turn = 5 + cooldown - 1;
  check('checkDebt: 冷却期临界仍不触发', checkDebt(s, config).triggered === false);
  s.turn = 5 + cooldown;
  check('checkDebt: 冷却期满再次触发', checkDebt(s, config).triggered === true);
  const high = baseState();
  high.player.attributes.money = 0; // 高于阈值
  check('checkDebt: money>threshold 不触发', checkDebt(high, config).triggered === false);
}

// --- applyEffects：属性钳制 / money 不钳制 / flags / club / history ---
{
  const s = baseState();
  const r = applyEffects(s, {
    attributes: { knowledge: 200, health: -100 },
    money: -5000,
    flags: { romance: 'dating', scholarship: 'won' },
    club: '读书社',
  }, { config });
  check('applyEffects: 返回 ok 且含各 kind 变更',
    r.ok === true
    && r.changes.some((c) => c.kind === 'attr' && c.key === 'knowledge')
    && r.changes.some((c) => c.kind === 'money')
    && r.changes.some((c) => c.kind === 'flag')
    && r.changes.some((c) => c.kind === 'club'),
    JSON.stringify(r.changes));
  const clamp = balance.attributeClamp || {};
  const rangeOf = (k) => (Array.isArray(clamp[k])
    ? clamp[k]
    : [Number.isFinite(clamp.min) ? clamp.min : 0, Number.isFinite(clamp.max) ? clamp.max : 100]);
  const max = rangeOf('knowledge')[1];
  const min = rangeOf('health')[0];
  check('applyEffects: 非 money 属性被钳制到 [min,max]',
    s.player.attributes.knowledge === max && s.player.attributes.health === min,
    `knowledge=${s.player.attributes.knowledge}, health=${s.player.attributes.health}`);
  check('applyEffects: money 不钳制（可为负）', s.player.attributes.money === -5000,
    `money=${s.player.attributes.money}`);
  check('applyEffects: flags 写入（romance 同步）', s.player.flags.romance === 'dating' && s.player.romance === 'dating',
    JSON.stringify(s.player.flags));
  check('applyEffects: club 写入', s.player.club === '读书社');
  check('applyEffects: 写入 history', Array.isArray(s.history) && s.history.length > 0,
    `history=${s.history && s.history.length}`);
}

console.log(failures === 0 ? '\n经济单测全部通过 ✅' : `\n失败 ${failures} 项 ❌`);
process.exit(failures === 0 ? 0 : 1);
