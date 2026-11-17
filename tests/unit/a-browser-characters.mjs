/**
 * 角色系统浏览器 E2E（真实 Edge headless + CDP，零依赖）
 * 运行：先 `node server.js`，再 `node tests/unit/a-browser-characters.mjs`
 *
 * 验证：
 *  1) 迎新晚会事件渲染（7 个选项走两列网格）
 *  2) 选人后第 3 回合强制触发剧情线第一步（ev_r23）
 *  3) 事件里出现角色立绘（右下角 NPC 立绘，背景图指向 media/characters/linyu.webp）
 *  4) 台词逐段播放：选项在台词播完前隐藏（.is-waiting），播完后出现
 *  5) 结算后对话框出现好感标签（▲ 林予 好感 +10），state 好感 = 16
 *  6) 关系面板能打开，卡片显示「林予 / 熟识 / 好感 16」
 *  7) 全程无 console error
 *  8) 截图留档到 media/shots/characters/
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const OUT_DIR = join(root, 'media', 'shots', 'characters');

const EDGE = process.env.SCUSIM_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.SCUSIM_CDP_PORT || 9334);
const BASE = process.env.SCUSIM_BASE || 'http://127.0.0.1:5173';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.error(`  FAIL  ${name}  ${detail}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(JSON.stringify(msg.params && msg.params.exceptionDetails).slice(0, 300));
      } else if (msg.method === 'Log.entryAdded') {
        const entry = msg.params && msg.params.entry;
        if (entry && entry.level === 'error') this.errors.push(entry.text);
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
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面执行异常: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
    }
    return r.result ? r.result.value : undefined;
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 84, captureBeyondViewport: false });
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

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  // 优先复用已经启动的 headless Edge（Windows 沙箱下 Node 直接 spawn 浏览器可能被拦，
  // 推荐先用 pwsh Start-Process 起好，再跑本脚本）：
  //   msedge --headless=new --remote-debugging-port=9334 --user-data-dir=<tmp> http://127.0.0.1:5173/?dev=1
  let browser = null;
  let preLaunched = false;
  try {
    await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
    preLaunched = true;
  } catch (_) {
    preLaunched = false;
  }
  if (!preLaunched) {
    const profile = join(tmpdir(), 'scusim-char-e2e-' + Date.now());
    browser = spawn(EDGE, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--window-size=1600,900',
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
      `${BASE}/?dev=1`,
    ], { stdio: 'ignore' });
  }

  let cdp = null;
  try {
    await waitFor(async () => {
      try { await fetchJson(`http://127.0.0.1:${PORT}/json/version`); return true; } catch { return false; }
    }, 20000, 'Edge DevTools 端口');

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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });

    await waitFor(async () => {
      try { return await cdp.eval('!!(window.__scusim && window.__scusim.config && window.__scusim.config.characters)'); }
      catch { return false; }
    }, 20000, '角色配置加载');

    // ---- 立绘文件可访问 ----
    const artStatus = await cdp.eval(`fetch('media/characters/linyu.webp').then(r => r.status)`);
    check('立绘文件可通过静态服务器访问', artStatus === 200, 'status=' + artStatus);

    // ---- 新游戏 ----
    await cdp.eval(`(async () => {
      await window.__scusim.callbacks.onNewGame({
        name: '测试生', gender: '男', collegeId: 'cs',
        attributes: { knowledge: 6, social: 6, health: 6, money: 2 },
        tags: ['study_hard', 'gamer', 'chill'], seed: 20241117,
      });
      return true;
    })()`);
    const t1 = await cdp.eval('({ turn: window.__scusim.state.turn, pending: window.__scusim.state.pendingEvent && window.__scusim.state.pendingEvent.eventId })');
    check('新游戏落在第 1 回合', t1.turn === 1, JSON.stringify(t1));

    // 结算社团招新
    await cdp.eval(`(async () => {
      const st = window.__scusim.state;
      const first = st.pendingEvent.options.find(o => o.enabled !== false) || st.pendingEvent.options[0];
      await window.__scusim.callbacks.onResolveEvent(first.id);
      return true;
    })()`);

    // ---- 第 2 回合：迎新晚会 ----
    await cdp.eval('window.__scusim.callbacks.onAdvance()');
    await waitFor(async () => cdp.eval('!!document.querySelector(".vn-event")'), 8000, '迎新晚会弹层');
    const hub = await cdp.eval(`({
      pending: window.__scusim.state.pendingEvent && window.__scusim.state.pendingEvent.eventId,
      options: document.querySelectorAll('.vn-choices--event .vn-choice').length,
      grid: !!document.querySelector('.vn-choices--event.is-grid'),
      tag: (document.querySelector('.vn-event__tag') || {}).textContent,
    })`);
    check('第 2 回合触发迎新晚会', hub.pending === 'ev_fixed_welcome', JSON.stringify(hub));
    check('迎新晚会 7 个选项、两列网格', hub.options === 7 && hub.grid === true, JSON.stringify(hub));
    await cdp.shot('01-welcome-event.jpg');

    // ---- 选林予 ----
    await cdp.eval(`(async () => {
      await window.__scusim.callbacks.onResolveEvent('approach_linyu');
      return true;
    })()`);
    const afterPick = await cdp.eval(`({
      route: window.__scusim.state.player.flags.route_linyu,
      affinity: window.__scusim.state.player.relations.linyu.affinity,
    })`);
    check('选择后写入 route_linyu 且好感 +6', afterPick.route === true && afterPick.affinity === 6, JSON.stringify(afterPick));

    // ---- 第 3 回合：剧情线强制触发 ev_r23 ----
    await cdp.eval('window.__scusim.callbacks.onAdvance()');
    await waitFor(async () => cdp.eval('!!document.querySelector(".vn-event")'), 8000, '剧情事件弹层');
    const meet = await cdp.eval(`({
      pending: window.__scusim.state.pendingEvent && window.__scusim.state.pendingEvent.eventId,
      npc: document.querySelectorAll('.vn-event__npc .vn-npc').length,
      npcBg: (() => { const el = document.querySelector('.vn-event__npc .vn-npc__art'); return el ? getComputedStyle(el).backgroundImage : ''; })(),
      speaker: (document.querySelector('.vn-speaker') || {}).textContent,
      waiting: !!document.querySelector('.vn-choices--event.is-waiting'),
      text: (document.querySelector('.vn-dialogue__box--event .vn-text') || {}).textContent,
    })`);
    check('第 3 回合强制触发林予线第一步', meet.pending === 'ev_r23', JSON.stringify({ pending: meet.pending }));
    check('事件里出现 NPC 立绘', meet.npc === 1, 'npc=' + meet.npc);
    check('NPC 立绘指向 media/characters/linyu.webp', String(meet.npcBg).includes('linyu.webp'), meet.npcBg);
    check('台词在播（第一段是旁白、选项尚未出现）', meet.waiting === true && !!meet.speaker, JSON.stringify({ waiting: meet.waiting, speaker: meet.speaker }));
    await cdp.shot('02-linyu-meet.jpg');

    // ---- 点击对话框推进台词，选项出现 ----
    await cdp.eval(`(() => {
      const box = document.querySelector('.vn-dialogue__box--event');
      box.click(); box.click();
      return true;
    })()`);
    const afterClick = await cdp.eval(`({
      waiting: !!document.querySelector('.vn-choices--event.is-waiting'),
      speaker: (document.querySelector('.vn-speaker') || {}).textContent,
      options: Array.from(document.querySelectorAll('.vn-choices--event .vn-choice')).map(b => b.innerText.replace(/\\s+/g, ' ').trim()),
    })`);
    check('台词播完后选项出现', afterClick.waiting === false, JSON.stringify(afterClick));
    check('选项上带好感提示', afterClick.options.some((t) => t.includes('好感')), JSON.stringify(afterClick.options));
    await cdp.shot('03-linyu-choices.jpg');

    // ---- 结算：好感标签 ----
    await cdp.eval(`(async () => { await window.__scusim.callbacks.onResolveEvent('chat'); return true; })()`);
    await sleep(400);
    const done = await cdp.eval(`({
      affinity: window.__scusim.state.player.relations.linyu.affinity,
      stage: window.__scusim.state.player.relations.linyu.stage,
      chip: Array.from(document.querySelectorAll('.vn-effects .vn-effect')).map(x => x.textContent).join(' | '),
      lineStatus: window.__scusim.state.storylines.line_linyu.status,
    })`);
    check('好感累加到 16', done.affinity === 16, JSON.stringify(done));
    check('阶段升到「熟识」', done.stage === 'acquaintance', done.stage);
    check('对话框下方出现好感标签', String(done.chip).includes('林予'), done.chip);
    check('剧情线进入 active', done.lineStatus === 'active', done.lineStatus);
    await cdp.shot('04-linyu-result.jpg');

    // ---- 关系面板 ----
    await cdp.eval('window.__scusim.app.showRelations()');
    await waitFor(async () => cdp.eval('document.querySelectorAll(".vn-rel__card").length > 0'), 8000, '关系面板');
    const panel = await cdp.eval(`({
      cards: document.querySelectorAll('.vn-rel__card').length,
      names: Array.from(document.querySelectorAll('.vn-rel__name')).map(x => x.textContent),
      stages: Array.from(document.querySelectorAll('.vn-rel__stage')).map(x => x.textContent),
      metas: Array.from(document.querySelectorAll('.vn-rel__meta')).map(x => x.textContent),
      bars: document.querySelectorAll('.vn-rel__bar i').length,
    })`);
    check('关系面板有 6 张人物卡', panel.cards === 6, String(panel.cards));
    check('卡片显示林予与好感 16',
      panel.names.includes('林予') && panel.metas.some((m) => m.includes('16')),
      JSON.stringify(panel.metas));
    check('好感条渲染', panel.bars === 6, String(panel.bars));
    await cdp.shot('05-relations.jpg');

    // ---- 无 console error ----
    const errs = cdp.errors.filter((e) => !String(e).includes('favicon'));
    check('全程无 console error', errs.length === 0, errs.join(' || ').slice(0, 400));
  } finally {
    if (cdp) { try { cdp.ws.close(); } catch (_) { /* ignore */ } }
    if (browser) { try { browser.kill(); } catch (_) { /* ignore */ } }
  }
}

await main();
console.log(`\n总计 ${pass + failures.length} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
