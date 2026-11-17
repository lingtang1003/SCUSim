/**
 * 设置持久化自检：并发写入不能互相覆盖（动效开关 bug 的回归测试）。
 * 运行：node tests/verify_settings.mjs
 */
import { createStorage } from '../src/storage/storage.js';

let pass = 0;
let fail = 0;
const rows = [];

function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    rows.push('PASS  ' + name);
  } else {
    fail += 1;
    rows.push('FAIL  ' + name + (detail ? '  → ' + detail : ''));
  }
}

/** 内存版 backend，和浏览器里的 localStorage 接口一致 */
function makeBackend() {
  const map = new Map();
  return {
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => map.set(k, v),
    remove: (k) => map.delete(k),
    _map: map,
  };
}

const be = makeBackend();
const storage = createStorage(be);

// 1) 基本写入
await storage.saveSettings({ reduceMotion: true });
let cur = (await storage.getSettings()).settings;
ok('保存 reduceMotion=true', cur.reduceMotion === true, JSON.stringify(cur));

// 2) 再读一次仍然是 true（模拟关掉设置面板后重开）
cur = (await storage.getSettings()).settings;
ok('重开后仍是已关闭', cur.reduceMotion === true, JSON.stringify(cur));

// 3) 并发：保存设置 + 换立绘同时发生（原来的 bug 场景）
be._map.clear();
await Promise.all([
  storage.saveSettings({ reduceMotion: true, bgmVolume: 30, sfxVolume: 90 }),
  storage.saveSettings({ appearance: 'f_long2' }),
]);
cur = (await storage.getSettings()).settings;
ok('并发写入后 reduceMotion 仍在', cur.reduceMotion === true, JSON.stringify(cur));
ok('并发写入后 appearance 也在', cur.appearance === 'f_long2', JSON.stringify(cur));
ok('并发写入后音量也在', cur.bgmVolume === 30 && cur.sfxVolume === 90, JSON.stringify(cur));

// 4) 三个并发写入，全部保留
be._map.clear();
await Promise.all([
  storage.saveSettings({ reduceMotion: true }),
  storage.saveSettings({ appearance: 'm_short1' }),
  storage.saveSettings({ bgmVolume: 55 }),
]);
cur = (await storage.getSettings()).settings;
ok(
  '三路并发全部保留',
  cur.reduceMotion === true && cur.appearance === 'm_short1' && cur.bgmVolume === 55,
  JSON.stringify(cur)
);

// 5) 后写覆盖同名字段（顺序语义仍然正确）
be._map.clear();
await storage.saveSettings({ bgmVolume: 10 });
await storage.saveSettings({ bgmVolume: 70 });
cur = (await storage.getSettings()).settings;
ok('顺序写入后者覆盖', cur.bgmVolume === 70, JSON.stringify(cur));

// 6) 默认值兜底
be._map.clear();
cur = (await storage.getSettings()).settings;
ok('空存储时 reduceMotion 默认 false', cur.reduceMotion === false, JSON.stringify(cur));

console.log(rows.join('\n'));
console.log('\n总计 ' + (pass + fail) + ' 项，PASS ' + pass + '，FAIL ' + fail);
if (fail > 0) process.exitCode = 1;
