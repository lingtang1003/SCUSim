# W4 验收 · A · main 集成（存储/恢复/队列）

> 任务卡：A-W4（`docs/分工/A-核心引擎与集成.md` §2 W4）｜ 验收人：C 交叉验
> 结论：**🟡 A 侧完成**；IndexedDB / `migrateSave` / 性能脚本仍属 D（见 §4）

## 1. 交付对照

| # | 任务卡要求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 读档恢复未结算事件（断点续玩） | ✅ | `main.onLoadGame` → `queueModal(showEvent)` |
| 2 | 学期结算 → 事件 → 结局 的弹窗队列 | ✅ | `main.modalQueue` + `pumpModalQueue` |
| 3 | 终局同回合先看成绩再看不到的问题 | ✅ | `main.onAdvance`：终局也先排结算，再排结局（浏览器 E2E 抓到并修复） |
| 4 | 每次行动/事件/考试/导入后落盘 | ✅ | 各回调内 `storage.saveGame` |
| 5 | 副结局入图鉴 | ✅ | `onAdvance` 逐个 `unlockEnding` |
| 6 | 视图统一走 `buildViewModel` | ✅ | `main.renderState` |
| 7 | 配置加载失败可读错误页 | ✅（既有） | 浏览器入口 `controller.start().catch` 渲染错误页 |
| 8 | `?dev=1` 面板仅开发可见 | ✅ | `devModeEnabled()` + `__scusim` 句柄（正式访问不存在，E2E 验证） |
| 9 | 迁移不兼容提示、IndexedDB 降级 | ❌ | 依赖 D（storage 仍 localStorage；无 `migrateSave`） |
| 10 | 性能测量（启动/回合/存档） | ❌ | 依赖 D 的 `accept/perf.mjs` |

## 2. 队列协议（给 C 的说明）

```js
// UI 两种关窗方式都支持：
app.showExam(settlement, done);   // done() 表示玩家点了「继续」
callbacks.onModalClosed();        // 或者关闭时通知 main
// 若 UI 两者都没做：玩家下一次点击行动（onAction）会触发隐式关闭，队列继续
```

队列保证**同一时刻最多一个 overlay**：`showExam` / `showEvent` 内部都会先 `closeOverlay()`，main 再串行放行下一个。

## 3. 实测

```
$ node tests/unit/a-main.mjs
  PASS  onAdvance: 同回合有结算+事件时先弹结算
  PASS  结算未关闭前事件不出现（不叠窗）
  PASS  兜底: 玩家下一次交互会放行队列
  总计 12 项，PASS 12，FAIL 0

$ node tests/unit/a-browser-e2e.mjs（Edge headless）
  PASS  学期结算弹窗被真实调用 ≥8 次（C 的 showExam 接线）
  PASS  事件弹窗被真实调用（showEvent 接线）
  PASS  考试周顺序：先「全力复习/佛系应考」事件，后「学期结算」
  PASS  结局弹层出现
  PASS  正式访问无调试面板 / 无 __scusim
  PASS  无未捕获异常 / 无 console.error
  总计 26 项，PASS 26，FAIL 0
```

### 3.1 考试周顺序（本轮新增）

```text
第 5 回合 advance → 弹「期末考试周」事件（ev_r14：全力复习 / 佛系应考）→ 此时无成绩
玩家选择「全力复习」→ 事件效果入账 → engine.finishExam() → main 弹「学期结算」
（截图：docs/截图/W1-A/06-exam-week-event.jpg、07-exam-result.jpg）
```

实现：`advance` 在考试回合若弹出了事件就只记 `state.academics.pendingExam`，成绩由 `resolvePendingEvent` 计算并随返回值带回；`main.onResolveEvent` 关掉事件弹窗后把 `showExam` 排进队列。

### 3.2 顺手修掉的环境 bug

`server.js` 有一行被写成了 `// …\r\n    res.writeHead(200, …)` —— `writeHead` 被注释吞掉，静态文件**没有 Content-Type**，浏览器按严格 MIME 拒绝加载 ES Module，本地页面卡在「正在进入校园…」。已拆回两行并验证 `Content-Type: application/javascript`。Cloudflare Pages 不受影响，只影响本地 `node server.js`。

## 4. 未闭环（D 的 W4）

| 项 | 当前 | 需要 D 做什么 |
|---|---|---|
| IndexedDB | 仍 localStorage（多槽已支持） | 主用 IDB + 失败降级 LS + 配额返回 `{ok:false}` |
| `migrateSave` | 无；`SAVE_VERSION` 仍 1.0.0 | v1→v2 补字段 + 不兼容拒绝；与 `GameState.version` 同 PR 升 2.0.0（会动 `verify_m1` 断言） |
| `accept/w4.mjs` / `perf.mjs` | 无 | E2E 驱动 + 启动/回合/存档耗时门槛 |
| `_headers` | 无 | Pages 缓存控制 |

## 5. 验收复跑（5 分钟）

```bash
node server.js
node tests/unit/a-browser-e2e.mjs     # 26/26，截图在 docs/截图/W1-A/
node tests/unit/a-main.mjs            # 12/12
npm test                              # 22 + 14
```
