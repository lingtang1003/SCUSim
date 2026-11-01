# W1 验收 · A · 引擎接入与行动规则

> 任务卡：A-W1（`docs/分工/A-核心引擎与集成.md` §2 W1）｜ 分支：`feat/a-w1`｜ 日期：W1
> 验收人：A 自检 + B 交叉验收（用 B 的规则单测反向验证引擎接线，只提 issue 不改引擎）
> **结论：🟡 有条件通过**——A 的部分全绿；本周机器门禁 `tests/accept/w1.mjs` 与部分能力依赖 B/D 的 W1 产物（见 §5）。

## 0. 按任务卡提示词的输出格式汇总

### ① 改动清单（文件:行号）

| 文件 | 位置 | 内容 |
|---|---|---|
| `src/core/state.js` | 22–31 / 34–88 | `DEFAULT_CLAMP`；`createGameState` 增 v2 字段（含 `appearance`） |
| | 90–113 | `clampAttrs` |
| | 116–148 | `pushHistory` / `pushLog`（环形截断） |
| `src/core/engine.js` | 65–149 | **过渡适配层**：`settleMonth / debtCheck / gradePoint / runExam / warningCheck / rollRandom / buildPendingEvent` |
| | 154–163 | `tierBonus`（三档） |
| | 165–178 | `applyStudyPenalty`（低健康学习惩罚） |
| | 180–203 | `enterTurn`（固定 > 负债 > 随机，同刻至多 1 个） |
| | 205–266 | `newGame`（含 `walletPerMoneyPoint` 兑换） |
| | 268–284 | `actionAvailability`（健康白名单） |
| | 286–326 | `doAction`（pending 阻断 / 加成 / 惩罚 / 钳制） |
| | 328–401 | `advance`（新结算顺序 + `monthly/settlement`） |
| | 403–422 | `resolvePendingEvent`（履历 + 钳制） |
| `src/core/ending.js` | 20–40 | `sortByPriority`（`endingPriorityOrder`） |
| `src/main.js` | 54–121 | `renderState` 挂载调试面板；`devModeEnabled` / `mountDevPanel` |
| | 194–217 | `onAction`：pending 拦截 + `reason` 文案 |
| | 219–265 | `onAdvance`：结局 / 事件 / 学期结算三分支 |
| `tests/unit/a-engine.mjs` | 全文 | 6 组 45 条断言 |

### ② 关键实现与公式

```text
clampAttrs:      v = round(x); 若 range=[min,max] → v = min(max, max(min, v)); money 的 range=null → 只取整
tierBonus:       bonus = 0; for i: if value >= thresholds[i] → bonus = bonuses[i]   // 取最高命中档，不累加
健康白名单:      health < healthRestrictThreshold(3) 且 action ∉ {exercise, rest} → reason:'health'
                 （之后仍受 action.requiresHealth 二级约束，所以健康 1 时锻炼也不可用）
doAction 顺序:   availability → pendingEvent 阻断 → 扣 AP → B 的 applyActionEconomy
                 → 三档加成（按行动前 mainAttr 值）→ 学习惩罚 → studyActions+1
                 → clampAttrs → log/history → rngState 回写
学习惩罚:        healthBefore < healthStudyPenaltyBelow(5) 时：
                 knowledge -= 本行动正向 knowledge 增益；再以 dropChance 概率 knowledge -= dropAmount
advance 顺序:    turn+1/AP 重置 → 月初结算（settleMonth）→ 负债（debtCheck）
                 → 期末（runExam → warningCheck → 学习计数重置）→ 事件（固定>负债>随机）→ 终局
settlement:      { semester, turn, subjects[], semesterGpa, totalGpa, failedCourses,
                   failedThisSemester, warning }
结局方向:        endingPriorityOrder === 'asc' → 升序（越小越高）；缺省 'desc'（兼容现配置）
```

### ③ 自测命令 + 真实输出

见 §3（`a-engine` 45/45、`npm test` 22+14 全绿、`verify_m1` 29/30）。

### ④ 未覆盖 / 风险

见 §4（行为变更）与 §5（9 项依赖未闭环）。最关键三条：
1. 三档加成、学习惩罚、资金兑换、月初收支目前**就绪未激活**（配置字段在 D/B 手里）。
2. 期末仍是"单科降级"，4 科 ±10% 与真绩点要等 B 的 `runFinalExam/gradePoint`。
3. `verify_m1` 有 1 条用例与新行为冲突（D 负责更新）。

### ⑤ 需要拍板的问题（请在群里回一句）

| # | 问题 | A 的建议 | 谁定 |
|---|---|---|---|
| 1 | `walletPerMoneyPoint` 取多少？取 200 后开局 money=1000，四属性展示需要改成"金额格式"而不是 0–99 进度条 | **200**，C 在 W2 把 money 单独渲染成 `¥1000` | 全员 + C |
| 2 | 低健康学习惩罚是"必扣"还是"概率扣"？ | **概率扣（0.3）**，SRS 原文是"存在倒扣可能性" | 全员 |
| 3 | 学期结算与事件同回合时的弹窗顺序？ | **结算先、事件后**（玩家先看到成绩再处理事件）；需要 C 的 `onModalClosed` 才能排队 | A + C |
| 4 | 结局方向切换周次 | **W3** 与 D 的 endings 重排同 PR，避免线上演示退化 | A + D |
| 5 | 开局步骤数：`docs/分工/C-UI与交互.md` 写的是四步，当前 `ui.js` 已是**六步**（含姓名/性别/学院/属性/标签/立绘） | 以当前 UI 的六步为准，A 在 W2 修正任务书措辞 | C 确认 |

## 1. 本周目标（对照任务卡）

| # | 任务卡要求 | 状态 | 落点 |
|---|---|---|---|
| 1 | state.js 增 v2 字段 + `clampAttrs` + `pushHistory` | ✅ | `src/core/state.js` |
| 2 | `newGame` 初始资金兑换（D-01） | ✅ 代码就绪 | `engine.newGame` |
| 3 | `doAction`：三档加成、健康白名单、低健康学习惩罚、pending 阻断 | ✅ | `engine.doAction` |
| 4 | `advance`：月初结算→负债→期末→学习计数重置→事件→终局，返回 `monthly/settlement` | ✅ | `engine.advance` |
| 5 | `ending.js` 优先级方向开关（D-02） | ✅ 默认 desc，`asc` 已支持 | `ending.sortByPriority` |
| 6 | `main.js` 结算透传 + `?dev=1` 面板 | ✅ | `main.onAdvance` / `main.mountDevPanel` |
| 7 | `tests/unit/a-engine.mjs` | ✅ 45 条全 PASS | `tests/unit/a-engine.mjs` |
| 8 | 门禁 `node tests/accept/w1.mjs` 全绿 | ❌ 脚本尚未由 D 提供 | 见 §5 |

## 2. 改动清单

| 文件 | 变更 |
|---|---|
| `src/core/state.js` | 新增 `club/romance/flags/appearance`、`semesterRecords/totalGpa/thesis/warningTurn/studyActionsBySemester`、`history`；新增 `clampAttrs` / `pushHistory` / `pushLog`（环形 60）；`version` 暂留 `1.0.0`（见 CONTRACT §6） |
| `src/core/engine.js` | ① `actionAvailability` 增加健康 <3 白名单（`exercise`/`rest`）② `doAction` 增加三档加成、学习惩罚、`pending_event` 阻断、结算后钳制 ③ `advance` 改为「回合+1 → 月初结算 → 负债 → 期末/绩点/警告 → 学习计数重置 → 事件（固定>负债>随机）→ 终局」并返回 `monthly/settlement` ④ `newGame` 按 `walletPerMoneyPoint` 兑换初始资金 ⑤ 顶部「过渡适配层」（B 的 v2 函数出现即自动优先） |
| `src/core/ending.js` | `sortByPriority` 读 `balance.endingPriorityOrder`（默认 `desc`，`asc` 为 SRS 口径）；条件类型仍 3 种，W3 扩展 |
| `src/main.js` | `onAdvance` 三分支（结局/事件/学期结算）；`onAction` 增加 pending 拦截与 `reason` 文案；新增 `?dev=1` 调试面板（改属性/改钱/清 AP/结算事件/结束回合/清档） |
| `tests/unit/a-engine.mjs` | 新增 45 条断言：钳制、环形、v2 字段、资金兑换、三档边界、健康 0/1/2/3、学习惩罚、pending 阻断、AP=0、月度收支、期末结算、40 回合、复现性、结局方向、事件链路 |

## 3. 门禁实测（真实输出）

```
$ node tests/unit/a-engine.mjs
  ...
  PASS  tierBonus: 学识 9 → 11（含 +0 档位加成）
  PASS  tierBonus: 学识 10 → 13（含 +1 档位加成）
  PASS  tierBonus: 学识 19 → 22（含 +1 档位加成）
  PASS  tierBonus: 学识 20 → 24（含 +2 档位加成）
  PASS  pendingEvent 存在时 doAction 被拒绝（pending_event）
  PASS  advance: 月初结算 +2000/−1800 → money 500→700
  PASS  advance: 8 个学期都有成绩记录（examTurns 8 个）
  PASS  ending: endingPriorityOrder=asc 时按「越小越高」命中（→ 平凡四年）
  == a-engine 结果 ==
  总计 45 项，PASS 45，FAIL 0

$ npm test
  smoke     : 22 项全 PASS（"全部通过 ✅"）
  verify_ui : 14 项全 PASS，FAIL 0

$ node tests/verify_m1.mjs（历史脚本，不在 npm test 内）
  总计 30 项，PASS 29，FAIL 1
  失败：Engine: doAction("study") → AP 4→3 / studyActions+1 / 效果生效 / log 追加
```

**唯一失败项的定性**：该用例在 `newGame` 之后**没有先结算回合 1 的固定事件**就调用 `doAction`，
而 W1 按设计 §11.1#9 引入了"存在待处理事件时禁止行动"的规则。这是**预期的行为变更**，
需要测试 Owner（D）把该用例改成"先 `resolvePendingEvent`，再 `doAction`"。
A 不改他人测试（红线 6），已在 §5 列为 D 的动作项。

## 4. 行为变更（请 B/C 注意）

| 变更 | 旧行为 | 新行为 | 影响方 |
|---|---|---|---|
| 事件未结算时行动 | 允许（可绕过事件） | 返回 `{ok:false, reason:'pending_event'}`，UI 提示"先处理当前事件" | C 的按钮点击可依赖该 reason；B 的测试若直接调 `doAction` 需先结算事件 |
| 健康 <3 行动 | 只有 `requiresHealth` 拦 | 白名单：仅 `exercise`/`rest`；再叠加 `requiresHealth` | C 的置灰逻辑；B 的规则单测 |
| `advance` 结算时机 | 先结算后 +1 回合 | 先 +1 回合再结算（新回合月初发放） | 月度金额统计；D 的 accept 脚本 |
| `advance` 返回值 | `settlement` 仅 `{score,passed,...}` | `settlement.subjects/semesterGpa/totalGpa`（单科降级，B 合并后 4 科） | C 的 `showExam` 按此结构渲染 |
| `studyActions` | 从不清零 | 每次期末结算后清零，并记录到 `studyActionsBySemester` | B 的 `runFinalExam` 读取学期计数 |

## 5. 依赖与未闭环项（🟡 的原因）

| # | 未闭环项 | 依赖方 | 激活后会发生什么 | 谁来做 | 截止 |
|---|---|---|---|---|---|
| 1 | `tests/accept/w1.mjs` 不存在 | D | 机器门禁闭环（先红后绿） | D | W1 周一 |
| 2 | `balance.monthlyIncome/monthlyExpense` 缺失 | D | 月初结算从空操作变为 ±200 | D | W1 周二 |
| 3 | `balance.walletPerMoneyPoint` 缺失 | D | 初始资金兑换生效；**必须同步改 `verify_ui` 的"四属性和=20"断言** | D | W1 周二 |
| 4 | `balance.studyPenalty / healthStudyPenaltyBelow` 缺失 | D | 低健康学习惩罚生效 | D | W1 周三 |
| 5 | `actions.mainAttr` + `balance.tierBonus` 缺失 | B/D | 三档加成生效 | B/D | W1 周四 |
| 6 | `academy.runFinalExam/gradePoint` 缺失 | B | 期末从"单科降级"升级为 4 科 + 真绩点 | B | W1 周四 |
| 7 | `economy.settleMonthly/checkDebt` 缺失 | B | 月度/负债走 B 实现（引擎已接线） | B | W1 周四 |
| 8 | `app.showExam` 缺失 | C | 学期结算从 toast 升级为弹窗 | C | W1 周五 |
| 9 | `verify_m1` 1 条用例与新行为冲突 | D | 旧脚本回到 30/30 | D | W1 周五 |

> 以上 9 项全部完成后，A 删除 `engine.js` 顶部「过渡适配层」，并把本记录结论改为 ✅。

## 6. 给 B / C / D 的具体请求（可直接贴到 issue）

**给 D（最高优先，卡 3 条门禁）**
1. `tests/accept/w1.mjs`：用注入 reader 读真实配置，断言 8 条 `semesterRecords`、每门成绩落在 `knowledge×[0.9,1.1]`、`failedCourses` 与未通过科目数一致、`money ≤ -3000` 时 `checkDebt().triggered`；有 FAIL 时 `process.exitCode=1`。
2. `balance.json` 补 `monthlyIncome/monthlyExpense/walletPerMoneyPoint/studyPenalty/healthStudyPenaltyBelow/attributeClamp/gpaTable/thesis/historyLimit/logLimit`（结构见 CONTRACT §2.1）。
3. 改 `verify_ui` 的"四属性和=20"断言：加了 `walletPerMoneyPoint` 后应为"分配点数之和=20，money=点数×200"；并更新 `verify_m1` 的 study 用例（先结算事件再行动）。

**给 B**
1. `economy.settleMonthly/checkDebt`、`academy.runFinalExam/gradePoint/judgeThesis` 按 CONTRACT §4.5 签名交付，引擎已自动优先调用，不需要改 engine。
2. `actions.json` 每条加 `mainAttr`（study→knowledge、club→social、exercise→health、parttime→money、socialize→social、rest→health）。

**给 C**
1. `showExam(settlement)` 按 CONTRACT §4.2 的结构渲染（`subjects/semesterGpa/totalGpa/failedCourses/warning`）。
2. 弹窗关闭后调 `callbacks.onModalClosed?.()`；A 在 W4 用它做"结算 → 事件"队列。
3. 事件按钮用 `pendingEvent.options[i].enabled/reason` 渲染置灰（W2 B 会填）。

## 7. 复跑方式（5 分钟）

```bash
node tests/unit/a-engine.mjs     # 45/45
npm test                         # 22 + 14
node tests/verify_m1.mjs         # 29/30（1 条待 D 更新）
node server.js                   # 打开 http://localhost:5173/?dev=1 用调试面板手测
```

## 8. W2 预告（A）

- `drawTagCandidates(config, rng)` + 新游戏应用标签修正（`modifiers` 叠加、下限 0）。
- 学院 `eventBias` 注入事件权重（B 的 `computeWeight` 读取，A 保证 state 上下文）。
- 事件队列（固定 > 负债 > 随机，同刻至多 1 个）与 `buildViewModel`（`actions[].reason`、`tierInfo`、`flags`）。
- 门禁：`accept/w2` + `tests/unit/a-engine.mjs` 增补标签修正与队列用例。
