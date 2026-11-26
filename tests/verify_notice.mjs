/**
 * 提示窗（.vn-notice）与生活费到账自检
 * 运行：node tests/verify_notice.mjs
 *
 * 覆盖：
 *  A) 生活费改成每 4 周发一次：第 4 / 8 周 +80，第 2 / 3 / 6 周不发
 *  B) 每周固定开销仍然是 −20（每周都扣）
 *  C) advance 的返回值里带 allowance 通知（main 用它弹提示窗）
 *  D) app.showNotice() 真的往 rootEl 里插了一张 .vn-notice，带标题/正文/关闭按钮
 *  E) 点 × 能立刻移除；到时间会自动消失
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config/loader.js';
import { createRng } from '../src/core/rng.js';
import { newGame, advance } from '../src/core/engine.js';
import { createApp } from '../src/ui/ui.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.error(`  FAIL  ${name}  ${detail}`); }
}

// ---------------- 最小 DOM 桩 ----------------
function makeEl(tag = 'div') {
  const children = [];
  const listeners = {};
  const el = {
    tagName: tag, nodeType: 1, className: '', _text: '', style: {}, dataset: {},
    children, parentNode: null, value: '',
    classList: {
      add: (...c) => {
        const set = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
        c.forEach((x) => set.add(x));
        el.className = Array.from(set).join(' ');
      },
      remove: () => {},
      contains: (c) => String(el.className || '').split(/\s+/).includes(c),
      toggle: () => false,
    },
    appendChild(c) { c.parentNode = el; children.push(c); return c; },
    removeChild(c) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); c.parentNode = null; return c; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { el['attr_' + k] = v; },
    getAttribute(k) { return el['attr_' + k]; },
    click() { for (const fn of listeners.click || []) fn({ type: 'click', target: el, currentTarget: el, preventDefault() {} }); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    get textContent() {
      if (el._text) return el._text;
      return children.map((c) => (c && c.textContent != null ? String(c.textContent) : '')).join('');
    },
    set textContent(v) { el._text = String(v); },
    _listeners: listeners,
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html || ''; },
    set(v) { el._html = v; if (v === '') { children.length = 0; el._text = ''; } },
  });
  return el;
}

const doc = {
  createElement: (t) => makeEl(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
  getElementById: () => makeEl(),
  querySelector: () => null,
  body: makeEl('body'),
  documentElement: makeEl('html'),
  addEventListener() {},
  removeEventListener() {},
};

const config = await loadConfig({ read: (p) => readFile(join(root, 'config', `${p}.json`), 'utf8') });
const RULES = config.balance.weeklyRules;
// 这个用例只测「钱的节奏 + 提示窗」：把会让人退学的规则（吃饭扣血 / 属性荒废 / 学识归零退学）
// 关掉，只留固定开销与生活费，避免跑 8 周时先被退学打断（那几条在 verify_rules 里专测）
const moneyCfg = JSON.parse(JSON.stringify(config));
moneyCfg.balance.dropout = null;
moneyCfg.balance.weeklyRules.eat = null;
moneyCfg.balance.weeklyRules.neglect = null;

console.log('== SCUSim 生活费 / 提示窗自检 ==');

check('A: 生活费配置为每 4 周一次', Number(RULES.allowance.everyTurns) === 4, String(RULES.allowance.everyTurns));
check('A: 生活费金额 80', Number(RULES.allowance.amount) === 80, String(RULES.allowance.amount));
check('B: 每周固定开销 20', Number(RULES.fee.amount) === 20, String(RULES.fee.amount));

// ---------------------------------------------------------------------------
// A/B/C) 跑 8 周，核对进出账与通知
// ---------------------------------------------------------------------------
{
  const rng = createRng(21);
  const ng = newGame({
    name: '生活费生', gender: '男', collegeId: 'cs',
    attributes: { knowledge: 8, social: 4, health: 8, money: 0 },   // 学识 > 0，避免退学
    tags: ['study_hard', 'gamer', 'chill'], seed: 21,
  }, moneyCfg, rng);
  check('准备：新局成功', ng.ok === true, ng.reason || '');
  const s = ng.state;
  if (s.pendingEvent) s.pendingEvent = null;

  const fee = Number(RULES.fee.amount);
  const amount = Number(RULES.allowance.amount);
  const every = Number(RULES.allowance.everyTurns);
  const rows = [];
  let ended = false;
  for (let i = 0; i < 8; i += 1) {
    const before = s.player.attributes.money;
    const r = advance(s, moneyCfg, rng);
    const after = s.player.attributes.money;
    const allowNote = (r.notices || []).find((n) => n.type === 'allowance');
    rows.push({ turn: s.turn, before, after, allowNote, endingId: r.endingId });
    if (r.endingId) { ended = true; break; }
  }
  check('A: 8 周内没有意外退学', !ended, JSON.stringify(rows.map((x) => x.endingId)));

  // 第 2、3 周：只扣开销
  const r2 = rows.find((x) => x.turn === 2);
  const r3 = rows.find((x) => x.turn === 3);
  check('B: 第 2 周只扣 20', r2 && r2.after === r2.before - fee, JSON.stringify(r2));
  check('B: 第 3 周只扣 20', r3 && r3.after === r3.before - fee, JSON.stringify(r3));
  check('A: 第 2 / 3 周没有生活费通知',
    !(r2 && r2.allowNote) && !(r3 && r3.allowNote));

  // 第 4 周：扣 20 + 发 80
  const r4 = rows.find((x) => x.turn === 4);
  check('A: 第 4 周 = 生活费 +80 − 开销 20',
    r4 && r4.after === r4.before + amount - fee, JSON.stringify(r4));
  check('C: 第 4 周 advance 返回 allowance 通知（main 用它弹窗）',
    !!(r4 && r4.allowNote) && String(r4.allowNote.text).includes(String(amount)),
    JSON.stringify(r4 && r4.allowNote));
  check('C: allowance 通知带 success 语气', !!(r4 && r4.allowNote && r4.allowNote.tone === 'success'));

  // 第 5~7 周：只扣开销
  for (const t of [5, 6, 7]) {
    const row = rows.find((x) => x.turn === t);
    check(`B: 第 ${t} 周只扣 20（每 ${every} 周才发一次）`,
      row && row.after === row.before - fee && !row.allowNote, JSON.stringify(row));
  }
  const r8 = rows.find((x) => x.turn === 8);
  check('A: 第 8 周再发一次 +80 − 20',
    r8 && r8.after === r8.before + amount - fee, JSON.stringify(r8));
}

// ---------------------------------------------------------------------------
// D/E) 提示窗组件
// ---------------------------------------------------------------------------
{
  const rootEl = makeEl('div');
  const app = createApp({ config, callbacks: {}, doc, appearance: 'm_short1' });
  app.mount(rootEl, { hasSave: false });
  check('D: app 暴露了 showNotice', typeof app.showNotice === 'function');

  const node = app.showNotice({ icon: '💰', title: '生活费到账 +80', text: '第 4 周 · 每 4 周发放一次' });
  check('D: 提示窗挂进了 rootEl', !!node && rootEl.children.indexOf(node) >= 0);
  check('D: 提示窗带 .vn-notice 类', !!node && node.classList.contains('vn-notice'));
  check('D: 标题与正文都在',
    !!node && String(node.textContent).includes('生活费到账 +80')
    && String(node.textContent).includes('第 4 周'));
  check('D: 有关闭按钮',
    !!node && (node.children || []).some((c) => c && String(c.className).includes('vn-notice__close')));

  const closeBtn = (node.children || []).find((c) => c && String(c.className).includes('vn-notice__close'));
  if (closeBtn) closeBtn.click();
  check('E: 点 × 立刻移除', rootEl.children.indexOf(node) < 0);

  const auto = app.showNotice({ title: '自动消失', duration: 30 });
  await new Promise((r) => setTimeout(r, 90));
  check('E: 到时间自动移除', auto && rootEl.children.indexOf(auto) < 0);
}

console.log(`\n总计 ${pass + failures.length} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
