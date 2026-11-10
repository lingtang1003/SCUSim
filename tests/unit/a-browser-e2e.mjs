/**
 * A · 浏览器端 E2E（真实 Edge headless + CDP，零依赖）
 * 运行：node tests/unit/a-browser-e2e.mjs
 * 前置：本地已 `node server.js`（127.0.0.1:5173）
 *
 * 覆盖 A 档手测项：
 *  1) 首屏不白屏、`?dev=1` 调试面板存在
 *  2) 创建角色 → 回合 1 事件弹窗 → 逐回合推进到 40 回合结算
 *  3) 每回合结束时页面上最多一个弹层（不叠窗）
 *  4) 第 10 回合已有 2 条学期成绩、40 回合满 8 条
 *  5) 结局弹层出现、图鉴写入 localStorage
 *  6) dev 面板按钮真实可点（钱 −5000、AP 清零）
 *  7) 去掉 ?dev=1 后：无调试面板、无 __scusim 句柄
 *  8) 全程 console 无 error / 无未捕获异常（favicon 404 除外）
 *  9) 截图存 docs/截图/W1-A/
 *
 * 退出码非 0 表示有失败项。
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const OUT_DIR = join(root, 'docs', '截图', 'W1-A');

const EDGE = process.env.SCUSIM_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.SCUSIM_CDP_PORT || 9333);
const BASE = process.env.SCUSIM_BASE || 'http://127.0.0.1:5173';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.error(`  FAIL  ${name}  ${detail}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- CDP 最小客户端 ----------------
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面执行异常: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
    }
    return r.result ? r.result.value : undefined;
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', {
      format: 'jpeg', quality: 82, captureBeyondViewport: false,
    });
    const file = join(OUT_DIR, name);
    await writeFile(file, Buffer.from(r.data, 'base64'));
    return file;
  }
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(150);
  }
  throw new Error('等待超时: ' + label);
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const profile = join(tmpdir(), 'scusim-e2e-' + Date.now());
  const browser = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--window-size=1600,900',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `${BASE}/?dev=1`,
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    await waitFor(async () => {
      try { await fetchJson(`http://127.0.0.1:${PORT}/json/version`); return true; } catch { return false; }
    }, 20000, 'Edge DevTools 端口');

    // 找到页面 target
    let target = null;
    await waitFor(async () => {
      const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
      target = list.find((t) => t.type === 'page' && t.url.includes('127.0.0.1:5173'));
      return !!target;
    }, 20000, '页面 target');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    cdp = new Cdp(ws);

    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
    });

    // 等游戏启动
    await waitFor(async () => {
      try { return await cdp.eval('!!(window.__scusim && window.__scusim.state !== undefined) || !!document.getElementById("scusim-devpanel")'); }
      catch { return false; }
    }, 20000, '游戏启动 / dev 面板');

    // 1) 首屏
    const first = await cdp.eval(`({
      hasRoot: !!document.getElementById('app'),
      hasPanel: !!document.getElementById('scusim-devpanel'),
      text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 60),
      overlays: document.querySelectorAll('.vn-event, .vn-ending, .vn-modal-scrim, .vn-drawer').length,
    })`);
    check('首屏不白屏（#app 有内容）', first.hasRoot && first.text.length > 5, JSON.stringify(first));
    check('?dev=1 时调试面板存在', first.hasPanel === true);
    check('首屏无残留弹层', first.overlays === 0, String(first.overlays));
    await cdp.shot('01-title-dev.jpg');

    // 2) 创建角色（六步参数一次提交，等价于走完创建向导）
    await cdp.eval(`(async () => {
      await window.__scusim.callbacks.onNewGame({
        name: '浏览器生', gender: '男', collegeId: 'cs',
        attributes: { knowledge: 6, social: 6, health: 6, money: 2 },
        tags: ['study_hard', 'gamer', 'chill'],
        appearance: 'm_hoodie', seed: 20241022,
      });
      return true;
    })()`);
    const afterNew = await cdp.eval(`({
      turn: window.__scusim.state.turn,
      ap: window.__scusim.state.actionPoints,
      pending: window.__scusim.state.pendingEvent ? window.__scusim.state.pendingEvent.eventId : null,
      eventOverlays: document.querySelectorAll('.vn-event').length,
      money: window.__scusim.state.player.attributes.money,
    })`);
    check('新游戏：turn=1 / AP=4', afterNew.turn === 1 && afterNew.ap === 4, JSON.stringify(afterNew));
    check('回合 1 弹出社团招新事件', afterNew.pending === 'ev_fixed_club_recruit' && afterNew.eventOverlays === 1, JSON.stringify(afterNew));
    await sleep(400);
    await cdp.shot('02-turn1-event.jpg');

    // 统计 UI 弹窗被真实调用的次数（验证 showExam/showEvent 接线，而非只看 state）
    await cdp.eval(`(() => {
      window.__counts = { exam: 0, event: 0 };
      window.__seq = [];
      const app = window.__scusim.app;
      if (app && typeof app.showExam === 'function') {
        const e0 = app.showExam;
        app.showExam = function (s, done) {
          window.__counts.exam += 1;
          window.__seq.push('exam');
          const r = e0.call(this, s, done);
          if (typeof done === 'function') done(); // 模拟玩家点「继续」（同步关闭，保证队列推进）
          return r;
        };
      }
      if (app && typeof app.showEvent === 'function') {
        const v0 = app.showEvent;
        app.showEvent = function (ev, done) {
          window.__counts.event += 1;
          window.__seq.push('event:' + (ev && ev.eventId));
          const r = v0.call(this, ev, done);
          if (typeof done === 'function') done(); // 模拟玩家关闭事件
          return r;
        };
      }
      return true;
    })()`);

    // 3) 前 10 回合
    const toTen = await cdp.eval(`(async () => {
      const S = () => window.__scusim.state;
      const cb = window.__scusim.callbacks;
      const overlays = () => document.querySelectorAll('.vn-event, .vn-ending, .vn-modal-scrim, .vn-drawer').length;
      const resolve = async () => {
        const st = S();
        if (st && st.pendingEvent && st.pendingEvent.options && st.pendingEvent.options[0]) {
          await cb.onResolveEvent(st.pendingEvent.options[0].id);
        }
      };
      let maxOverlays = 0;
      let guard = 0;
      await resolve();
      while (S().turn < 10 && !S().endingId && guard < 30) {
        guard++;
        let apGuard = 0;
        while (S().actionPoints > 0 && apGuard < 8) {
          apGuard++;
          const id = S().player.attributes.health < 5 ? 'rest' : 'study';
          await cb.onAction(id);
        }
        await cb.onAdvance();
        if (S().pendingEvent) await resolve();
        maxOverlays = Math.max(maxOverlays, overlays());
      }
      return {
        turn: S().turn, ap: S().actionPoints, records: S().academics.semesterRecords.length,
        gpa: S().academics.totalGpa, money: S().player.attributes.money,
        health: S().player.attributes.health, maxOverlays,
      };
    })()`);
    check('推进到第 10 回合', toTen.turn === 10, JSON.stringify(toTen));
    check('第 10 回合已有 2 个学期成绩记录', toTen.records === 2, String(toTen.records));
    check('期间最多一个弹层（不叠窗）', toTen.maxOverlays <= 1, String(toTen.maxOverlays));
    check('属性钳制在合法区间（health 0–99）', toTen.health >= 0 && toTen.health <= 99, String(toTen.health));
    await sleep(400);
    await cdp.shot('03-turn10.jpg');

    // 4) 跑到第 40 回合
    const toEnd = await cdp.eval(`(async () => {
      const S = () => window.__scusim.state;
      const cb = window.__scusim.callbacks;
      const overlays = () => document.querySelectorAll('.vn-event, .vn-ending, .vn-modal-scrim, .vn-drawer').length;
      const resolve = async () => {
        const st = S();
        if (st && st.pendingEvent && st.pendingEvent.options && st.pendingEvent.options[0]) {
          await cb.onResolveEvent(st.pendingEvent.options[0].id);
        }
      };
      let maxOverlays = 0;
      let guard = 0;
      await resolve();
      while (S().turn < 40 && !S().endingId && guard < 60) {
        guard++;
        let apGuard = 0;
        while (S().actionPoints > 0 && apGuard < 8) {
          apGuard++;
          const id = S().player.attributes.health < 5 ? 'rest' : 'study';
          await cb.onAction(id);
        }
        await cb.onAdvance();
        if (S().pendingEvent) await resolve();
        maxOverlays = Math.max(maxOverlays, overlays());
      }
      return {
        turn: S().turn, endingId: S().endingId, maxOverlays,
        records: S().academics.semesterRecords.length,
        gpa: S().academics.totalGpa, warning: !!S().academics.warning,
        failed: S().academics.failedCourses,
        endingOverlays: document.querySelectorAll('.vn-ending').length,
        counts: window.__counts,
        seq: (window.__seq || []).slice(0, 80),
        gallery: (function () { try { return localStorage.getItem('scusim:gallery'); } catch (e) { return null; } })(),
      };
    })()`);
    check('到达第 40 回合', toEnd.turn === 40, JSON.stringify({ turn: toEnd.turn }));
    check('结局已判定（endingId 非空）', typeof toEnd.endingId === 'string' && toEnd.endingId.length > 0, String(toEnd.endingId));
    check('8 个学期成绩记录齐全', toEnd.records === 8, String(toEnd.records));
    check('结局弹层出现', toEnd.endingOverlays === 1, String(toEnd.endingOverlays));
    check('全程最多一个弹层（不叠窗）', toEnd.maxOverlays <= 1, String(toEnd.maxOverlays));
    check('图鉴写入 localStorage 且含本次结局',
      typeof toEnd.gallery === 'string' && toEnd.gallery.includes(toEnd.endingId),
      String(toEnd.gallery));
    check('学期结算弹窗被真实调用 ≥8 次（C 的 showExam 接线）',
      toEnd.counts && toEnd.counts.exam >= 8, JSON.stringify(toEnd.counts));
    check('事件弹窗被真实调用（showEvent 接线）',
      toEnd.counts && toEnd.counts.event >= 1, JSON.stringify(toEnd.counts));
    {
      const seq = toEnd.seq || [];
      const firstExam = seq.indexOf('exam');
      const firstExamEvent = seq.indexOf('event:ev_r14');
      check('考试周顺序：先「全力复习/佛系应考」事件，后「学期结算」',
        firstExamEvent >= 0 && firstExam > firstExamEvent,
        JSON.stringify(seq.slice(0, 20)));
    }
    await sleep(800); // 等结局淡入动画结束再截图
    await cdp.shot('04-ending.jpg');

    // 5) dev 面板真实点击
    const devClick = await cdp.eval(`(async () => {
      const panel = document.getElementById('scusim-devpanel');
      if (!panel) return { ok: false, reason: 'no panel' };
      const buttons = [...panel.querySelectorAll('button')];
      const moneyBtn = buttons.find((b) => b.textContent.indexOf('5000') >= 0);
      const before = window.__scusim.state.player.attributes.money;
      if (moneyBtn) moneyBtn.click();
      await new Promise((r) => setTimeout(r, 80));
      const after = window.__scusim.state.player.attributes.money;
      const apBtn = buttons.find((b) => b.textContent.indexOf('AP') >= 0);
      if (apBtn) apBtn.click();
      await new Promise((r) => setTimeout(r, 80));
      return { ok: true, buttons: buttons.length, before, after, ap: window.__scusim.state.actionPoints };
    })()`);
    check('dev 面板按钮可点（≥6 个）', devClick.ok === true && devClick.buttons >= 6, JSON.stringify(devClick));
    check('点击「钱−5000」真实扣款', devClick.after === devClick.before - 5000, JSON.stringify(devClick));
    check('点击「AP 清零」真实生效', devClick.ap === 0, JSON.stringify(devClick));

    // 6) 去掉 ?dev=1：无面板、无调试句柄
    await cdp.send('Page.navigate', { url: `${BASE}/` });
    await sleep(1500);
    const normal = await cdp.eval(`({
      panel: !!document.getElementById('scusim-devpanel'),
      hook: typeof window.__scusim,
      text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 40),
    })`);
    check('正式访问无调试面板', normal.panel === false);
    check('正式访问无 __scusim 句柄', normal.hook === 'undefined', normal.hook);
    check('正式访问首屏正常渲染', normal.text.length > 5, normal.text);
    await cdp.shot('05-title-normal.jpg');

    // 7) console 错误
    const errors = cdp.events
      .filter((e) => e.method === 'Runtime.exceptionThrown')
      .map((e) => (e.params.exceptionDetails.exception || {}).description || e.params.exceptionDetails.text);
    const consoleErrors = cdp.events
      .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      .map((e) => (e.params.args || []).map((a) => a.value || a.description || '').join(' '))
      .filter((t) => !/favicon/i.test(t));
    check('无未捕获异常', errors.length === 0, errors.join(' | '));
    check('无 console.error', consoleErrors.length === 0, consoleErrors.join(' | '));

    console.log(`\n截图：${OUT_DIR}`);
  } finally {
    try { if (cdp) await cdp.send('Browser.close'); } catch (_) { /* ignore */ }
    try { browser.kill(); } catch (_) { /* ignore */ }
    await sleep(300);
    try { await rm(profile, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

console.log('== A · 浏览器 E2E（Edge headless）==');
try {
  await main();
} catch (e) {
  failures.push('E2E 异常');
  console.error('  FAIL  E2E 异常: ' + (e && e.message ? e.message : String(e)));
}
const total = pass + failures.length;
console.log(`\n== a-browser-e2e 结果 ==`);
console.log(`总计 ${total} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
