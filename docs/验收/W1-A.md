# W1 验收 · A · 引擎接入与行动规则

> 任务卡：A-W1（`docs/分工/A-核心引擎与集成.md` §2 W1）｜ 分支：`feat/a-w1`｜ 日期：W1
> 验收人：A 自检 + B 交叉验收（用 B 的规则单测反向验证引擎接线，只提 issue 不改引擎）
> **结论：🟡 有条件通过**——A 的部分全绿；本周机器门禁 `tests/accept/w1.mjs` 与部分能力依赖 B/D 的 W1 产物（见 §5）。
> **W3 收口更新（见 §10）**：B 的 v2 规则已合并、C 的 `showExam` 已对接，A 侧已全部落地并通过真实浏览器 26 项 E2E；🟡 仅因为 D 的 `accept/w1.mjs` 仍未交付。

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

### ⑤ 待拍板问题的决议（W1 中期已回填）

| # | 问题 | 决议 | A 的落地 |
|---|---|---|---|
| 1 | `walletPerMoneyPoint` 取多少？ | **不采用 200**；具体值由 D/B 定，A 代码不写死（缺省 0 = 不兑换） | CONTRACT §2.1 已改；值确定后 D 必须同步改 `verify_ui` 的"四属性和=20"断言，C 把 money 展示成金额 |
| 2 | 低健康学习惩罚 | **概率扣**（`studyPenalty.dropChance`，建议 0.3 / 扣 1） | 引擎按概率实现，配置由 D 填 |
| 3 | 结算与事件弹窗顺序 | **结算先、事件后** | `main.modalQueue` 已实现（含隐式关闭兜底），见 §9 |
| 4 | 结局方向切换周次 | **W3** 与 D 的 endings 重排同 PR | CONTRACT §9 保持"就绪未激活" |
| 5 | 开局步骤 | **六步**（姓名/性别/学院/属性/标签/立绘） | 已修正 `docs/分工/C-UI与交互.md` 与手册措辞；UI 不改 |

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
| `src/core/engine.js` | ① `actionAvailability` 增加健康 <3 白名单（`exercise`/`rest`）② `doAction` 增加三档加成、学习惩罚、`pending_event` 阻断、结算后钳制 ③ `advance` 改为「回合+1 → 月初结算 → 负债 → 期末/绩点/警告 → 学习计数重置 → 事件（固定>负债>随机）→ 终局」并返回 `monthly/settlement` ④ `newGame` 按 `walletPerMoneyPoint` 兑换初始资金 ⑤ 顶部「过渡适配层」 ⑥ **终局回合不再触发事件**（E2E 发现的结局被重绘清空缺陷） |
| `src/core/ending.js` | `sortByPriority` 读 `balance.endingPriorityOrder`（默认 `desc`，`asc` 为 SRS 口径）；条件类型仍 3 种，W3 扩展 |
| `src/main.js` | 弹窗队列 `modalQueue`（同回合「结算先、事件后」，支持 `done` 回调 / `onModalClosed` / Promise，含隐式关闭兜底）；`onAdvance` 改为排队；`onAction` pending 拦截与 `reason` 文案；`?dev=1` 调试面板 + 只读调试句柄 `__scusim`（仅 dev） |
| `tests/unit/a-main.mjs` | 新增 12 条断言：队列顺序、不叠窗、隐式关闭兜底、`onModalClosed` 存在性 |
| `tests/unit/a-browser-e2e.mjs` | 新增真实浏览器 E2E（Edge headless + CDP，零依赖）：23 条断言 + 5 张截图 |
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

$ node tests/unit/a-main.mjs（弹窗队列）
  总计 12 项，PASS 12，FAIL 0
```

**唯一失败项的定性**：该用例在 `newGame` 之后**没有先结算回合 1 的固定事件**就调用 `doAction`，
而 W1 按设计 §11.1#9 引入了"存在待处理事件时禁止行动"的规则。这是**预期的行为变更**，
需要测试 Owner（D）把该用例改成"先 `resolvePendingEvent`，再 `doAction`"。
A 不改他人测试（红线 6），已在 §5 列为 D 的动作项。

### 3.1 浏览器 E2E（真实 Edge headless，A 档手测第 1/3/4 项）

```bash
# 终端 1
node server.js
# 终端 2
node tests/unit/a-browser-e2e.mjs
```

真实输出（23 项全 PASS）：

```
== A · 浏览器 E2E（Edge headless）==
  PASS  首屏不白屏（#app 有内容）
  PASS  ?dev=1 时调试面板存在
  PASS  首屏无残留弹层
  PASS  新游戏：turn=1 / AP=4
  PASS  回合 1 弹出社团招新事件
  PASS  推进到第 10 回合
  PASS  第 10 回合已有 2 个学期成绩记录
  PASS  期间最多一个弹层（不叠窗）
  PASS  属性钳制在合法区间（health 0–99）
  PASS  到达第 40 回合
  PASS  结局已判定（endingId 非空）
  PASS  8 个学期成绩记录齐全
  PASS  结局弹层出现
  PASS  全程最多一个弹层（不叠窗）
  PASS  图鉴写入 localStorage 且含本次结局
  PASS  dev 面板按钮可点（≥6 个）
  PASS  点击「钱−5000」真实扣款
  PASS  点击「AP 清零」真实生效
  PASS  正式访问无调试面板
  PASS  正式访问无 __scusim 句柄
  PASS  正式访问首屏正常渲染
  PASS  无未捕获异常
  PASS  无 console.error

== a-browser-e2e 结果 ==
总计 23 项，PASS 23，FAIL 0
```

**截图**（1600×900，`docs/截图/W1-A/`）：

| 文件 | 画面 |
|---|---|
| `01-title-dev.jpg` | 标题页 + 左下角 `?dev=1` 调试面板（9 个按钮） |
| `02-turn1-event.jpg` | 第 1 回合 · 大上第 1 学期 · 社团招新事件弹层（2 选项 + 对话框 + 立绘） |
| `03-turn10.jpg` | 第 10 回合主舞台（HUD/选项条/对话框） |
| `04-ending.jpg` | 第 40 回合结局卡「学术之星 · 学识 99 / 社交 17 / 健康 5 / 金钱 2」+ 返回标题/再玩一次 |
| `05-title-normal.jpg` | 去掉 `?dev=1` 的正式访问（无调试面板、无 `__scusim`） |

**E2E 抓到的真实缺陷（已修）**：

| # | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | 第 40 回合结局卡被"事件已结算"后的重绘清掉，玩家看不到结局 | `advance` 在终局回合仍调用 `enterTurn` 生成 `pendingEvent`；UI 结算该事件时 `renderState()` 清空了根节点，把结局弹层一起删了 | `engine.advance` 终局回合**不再触发事件**并清空 `pendingEvent`（`isFinalTurn` 分支） |
| 2 | 截图过早，结局淡入动画未结束，底层舞台透出来 | 截图时机问题（非产品缺陷） | E2E 截图前加 400–800ms 等待 |
| 3 | dev 面板"钱 −5000"点不动 | E2E 选择器写的是 ASCII `-`，按钮文案是 U+2212 `−` | 选择器改为匹配 `5000` |

> 缺陷 1 是**只有真浏览器才能暴露**的集成 bug：Node 侧单测与 `verify_ui` 都只断言"结局 id 非空"，不看 DOM。

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

## 9. 本周剩余工作（按"能不能现在做"分三档）

### A. 现在就能做（不依赖别人，A 独占文件）

| # | 事项 | 产出 | 预计 |
|---|---|---|---|
| 1 | **弹窗队列**（结算先、事件后 + 隐式关闭兜底） | `main.modalQueue` + `tests/unit/a-main.mjs`（12/12） | ✅ 已完成 |
| 2 | 五项决议回填契约与任务书（钱包值不写死、概率扣、结算先、W3 切 asc、六步开局） | CONTRACT §2.1/§5/§11、`docs/分工/C` | ✅ 已完成 |
| 3 | `?dev=1` 面板自测（改钱、清 AP、结算事件、结束回合） | 浏览器 E2E 真实点击 9 个按钮：钱−5000、AP 清零均生效 | ✅ 已完成 |
| 4 | 40 回合全流程（真实浏览器）确认无死锁、不叠窗、无 console error | `tests/unit/a-browser-e2e.mjs` 23/23 + 5 张截图 | ✅ 已完成（顺带修掉 1 个结局被清空的缺陷） |
| 5 | 仓库设置：`main` 分支保护、Labels、Milestones、Projects 看板 | CONTRACT §8 勾选 | ⏳ 20 分钟（GitHub 网页，只能你点） |

### B. 等别人交付后立刻能接（不写新代码，只接线/复跑）

| # | 事项 | 等谁 | 到时动作 |
|---|---|---|---|
| 6 | 学期结算弹窗真正弹出 | C 的 `app.showExam(settlement, done)` | 无需改 main，队列已支持；只做浏览器手测 |
| 7 | 事件弹窗不叠窗 | C 的 `done` 或 `onModalClosed` | 同上；若 C 未接，隐式关闭兜底已生效 |
| 8 | 月度收支/学习惩罚/资金兑换/三档加成真正生效 | D 的 `balance` 字段 + B 的 `mainAttr` | 复跑 `a-engine` + 浏览器看数字 |
| 9 | 期末从"单科降级"升级为 4 科 + 真绩点 | B 的 `runFinalExam/gradePoint` | 删「过渡适配层」里 `runExam/gradePoint` 两段，复跑 |
| 10 | `accept/w1.mjs` 门禁闭环 | D 的脚本 | 跑红→修→绿，把结论从 🟡 改 ✅ |
| 11 | `verify_m1` 回到 30/30 | D 改 1 条用例 | 复跑确认 |

### C. 只能催、不能替（红线：不改别人文件）

| # | 事项 | 谁 | 提醒话术（可直接发群） |
|---|---|---|---|
| 12 | `balance.json` v2 字段 | D | "W1 门禁卡在 5 个字段：monthlyIncome/Expense、walletPerMoneyPoint（值你们定，不写死）、studyPenalty、healthStudyPenaltyBelow、gpaTable；周二前给我就来得及" |
| 13 | `actions.mainAttr` + `tags.modifiers` | B | "三档加成和标签修正的代码已就绪，只差 mainAttr/modifiers 两个字段；给我就能在预览站点看到数字变化" |
| 14 | `showExam` + `onModalClosed` | C | "队列已写好，`showExam(settlement, done)` 收第二参并在关闭时调用，或者调 `callbacks.onModalClosed()`；两种都支持" |

> **本周（W1）A 的收口标准**：A 档 5 项全绿、B 档至少 6/7 两项在浏览器验证通过、C 档三项都有明确回执。
> 达到后把本文件结论从 🟡 改为 ✅（`accept/w1` 仍由 D 的脚本决定）。

---

## 10. W3 收口更新（A 侧全部落地）

### 10.1 状态

| 项 | 结果 |
|---|---|
| A 档 5 项 | ✅ 全绿（队列、决议回填、dev 面板、40 回合真浏览器、仓库设置待你点） |
| B 档 6–11 | ✅ B 的 v2 规则已合并、C 的 `showExam` 已到位、A 已删适配层并直接调用；`accept/w1` 仍缺（D） |
| C 档 12–14 | ✅ 字段已由 B/D 补齐；`showExam` 已交付并对接成功 |
| 门禁 | `a-engine` 76/76、`a-main` 15/15、`a-browser-e2e` 26/26、`npm test` 22+14 全绿；`verify_m1` 29/30（1 条待 D） |

### 10.2 本轮新增的修复（都有测试锁定）

| # | 问题 | 修复 |
|---|---|---|
| 1 | 配置形状与契约不一致：`threeTierBonus`（非 `tierBonus`）、`attributeClamp` 按属性数组、`tags.modifiers.attributes` | `engine.tierBonus` 双写法兼容；`state.clampAttrs` 双写法兼容；`engine.applyTagModifiers` 读 `modifiers.attributes` |
| 2 | 三档加成此前完全不生效 | 改为读 `threeTierBonus.bonus{low,mid,high}`，9/10/19/20 四个边界用例锁定 |
| 3 | 标签修正未接入 | `newGame` 叠加三标签并 `max(0)`，`a-engine` 断言 5/5/5/5 → 7/4/4 |
| 4 | 第 40 回合的期末结算看不到（先返回结局分支） | `main.onAdvance` 终局也先排结算再排结局；E2E 统计结算弹窗 ≥8 次 |
| 5 | 过渡适配层与 B 的实现双轨 | 删除适配层，`engine` 直接调 `settleMonthly/checkDebt/runFinalExam/checkWarning/rollEvent/buildPending` |
| 6 | 读档后未结算事件丢失 | `main.onLoadGame` 用队列恢复事件弹窗 |
| 7 | 考试周顺序反了（先出成绩再问复习） | `advance` 只记 `pendingExam`，成绩由 `resolvePendingEvent` 计算；`main.onResolveEvent` 关掉事件后再弹结算（E2E 新增顺序断言） |
| 8 | 本地 `node server.js` 静态文件没有 Content-Type，ES Module 被浏览器拒绝，页面卡在「正在进入校园…」 | `server.js` 一行被写成 `// …\r\n res.writeHead`，`writeHead` 落进注释；已拆行修复 |
| 9 | 读「最后一回合（已判结局）」的存档后再点进入下一周，只弹 `无法推进：ended`，看不到结局 | `main.onLoadGame` 检测 `state.endingId` → `judgedEndingOf()` 取主/副结局 → 解锁图鉴 → 直接 `showEnding`；`onAdvance` 同样兜底（`a-main` 新增 3 条用例，浏览器实测重开页面→继续游戏→结局卡） |
| 10 | 姓名允许数字/符号/16 字 | `state.isValidName`（1–12 字，仅汉字/英文字母）+ UI 输入实时过滤 + `newGame` 拒绝 `reason:'name'`；`a-engine` 补 9 条用例 | 
| 11 | 长期不学习/不锻炼会一直涨属性 | `balance.idleDecay` + `engine.applyIdleDecay`：连续 4 周没学习 → 学识 −3；连续 4 周没锻炼/休息 → 健康 −2；做了对应行动清零；每学年重新计数；下限 0（`a-engine` 补 7 条用例） |

### 10.3 仍未闭环（全部在 D / 决策侧）

| 项 | 归属 | 影响 |
|---|---|---|
| `tests/accept/w1.mjs` + CI | D | W1 机器门禁无法闭环（A 用单测 + E2E 代偿） |
| `schema.js` v2 校验 | D | 新字段无校验，配置错误只能靠运行时兜底 |
| IndexedDB / `migrateSave` | D | 存档仍 localStorage 单后端，版本迁移缺 |
| `verify_m1` 1 条用例 | D | 旧脚本 29/30（"先结算事件再行动"的行为变更） |
| Q1 资金汇率 | 全员 | 初始钱=点数（5），而事件金额是货币尺度（−15/+1000），`小富翁 money≥50` 过早达成 |
| Q8 月度支出 1950 vs SRS 1800 | 全员/文档 | 答辩口径不一致 |
| Q9 `ending_warning` 不可达 | D-W3 | 永不挂科后该结局永远不会出现，重排结局时要删/换 |
