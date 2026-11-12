# SCUSim 接口与数据契约 v2（A · W0 冻结版）

> 文档编号：SCUSim-CONTRACT-0001 ｜ 版本 v2.0-draft ｜ 生效：W0（契约冻结）
> Owner：**A（核心引擎与集成）** ｜ 评审：B / C / D ｜ 依据：《系统需求分析》SCUSim-JS-0001、《系统概要设计》SCUSim-JS-0003、`docs/团队分工与验收手册.md`
> 状态：**已发布，等待 B/C/D 在 PR 上 approve 后转为 v2.0-冻结**。任何签名/字段变更必须同 PR 修改本文件（§10），否则不得合并。

---

## 0. 一句话

**契约只定义"跨模块能看见的东西"**：文件归属、六张配置表的字段、GameState 字段、函数签名、返回结构、行为决策。
实现细节（算法、文案、样式、内部私有函数）不在契约里，各自负责。

---

## 1. 文件所有权（白名单 / 禁区）

| 路径 | Owner | 其他人 |
|---|---|---|
| `src/core/rng.js` `state.js` `engine.js` `ending.js`、`src/main.js` | **A** | 只读 |
| `src/core/economy.js` `academy.js` `effects.js`、`src/events/eventManager.js`、`config/{actions,events,tags,colleges}.json` 内容 | **B** | 只读 |
| `index.html` `css/**` `src/ui/**` `dev/ui-lab.html`、`assets/**` | **C** | 只读 |
| `src/config/{loader,schema}.js` `src/storage/**` `config/*.json` 结构、`tests/accept` `tests/fixtures` `tests/support` `tests/smoke.mjs` `tests/verify_*.mjs`、`.github/**`、`README.md`、`package.json`、`server.js`、`docs/`（除本文件与验收） | **D** | 只读 |
| `docs/CONTRACT.md`、`docs/验收/**`、`docs/分工/**` | **A** | 评审 |
| `tests/unit/<角色>-*.mjs` | 各自作者 | 只读 |

**跨文件需求**：PR 标题加 `[契约变更]`，正文写"为什么必须改 / 影响谁 / 已同步的文档"，A 24h 内裁决。**不允许静默改**。

---

## 2. 配置契约（六表 v2）

### 2.1 `balance.json` 字段表（以 `config/balance.json` 实际内容为准）

| 键 | 类型 | 必填 | 状态 | 读取者 | 语义 |
|---|---|---|---|---|---|
| `turns` | number | 是 | ✅ 40 | engine | 总回合数 |
| `actionPointsPerTurn` | number | 是 | ✅ 4 | engine | 每回合 AP |
| `monthsPerSemester` | number | 是 | ✅ 5 | engine | 学期换算 |
| `examTurns` | number[] | 是 | ✅ [5,…,40] | engine | 期末回合 |
| `randomEventBaseChance` | number | 是 | ✅ 0.35 | eventManager | 随机事件基率 |
| `recentEventCooldown` | number | 否 | ✅ 3 | eventManager | 随机事件去重窗口 |
| `attributePointTotal` | number | 是 | ✅ 20 | engine | 开局分配总点 |
| `attributeKeys` | string[4] | 是 | ✅ | engine/schema | 属性键 |
| `healthRestrictThreshold` | number | 是 | ✅ 3 | engine | 健康低于此值只允许锻炼/休息（D-03） |
| `warningFailedCourses` | number | 是 | ✅ 3 | academy | 学业警告阈值（永不挂科决议后不再触发，见 D-05） |
| `monthlyIncome` / `monthlyExpense` | number | 是 | ✅ 2000 / 1950 | economy.settleMonthly | 每月固定收支；**1950 偏离 SRS 1800**（D-14 待文档确认） |
| `debtThreshold` / `debtCooldownTurns` | number | 是 | ✅ −3000 / 6 | economy.checkDebt | 负债触发线与冷却 |
| `attributeClamp` | object | 是 | ✅ 按属性：`{[key]:[min,max] 或 null}` | state.clampAttrs / effects | `money:null` = 货币不钳制（D-01）；也兼容全局 `{min,max}` |
| `exam` | object | 是 | ✅ | academy.runFinalExam | `{subjects:4 门, fluctuation:0.10, passLine:60, base:50, knowledgeWeight:1.0, …}`；单门 `score = round(base + 学识×权重×(1±波动))`，夹 `[passLine,100]`（D-05 永不挂科） |
| `gpaTable` | object[] | 是 | ✅ 降序 `{min,gpa}` | academy.gradePoint | 60→1.0 … 90→4.0 |
| `thesis` | object | 是 | ✅ | academy.judgeThesis | `{knowledgeWeight:1.0,gpaWeight:25,passLine:60}` |
| `threeTierBonus` | object | 是 | ✅ `{thresholds:[10,20],tiers:['low','mid','high'],bonus:{low:0,mid:1,high:2}}` | engine.tierBonus | 三档加成（D-04）；引擎同时兼容 `bonuses:[1,2]` 写法 |
| `walletPerMoneyPoint` | number | 否 | ⏳ **待拍板 Q1** | engine.newGame | 1 点「金钱」兑换的初始资金；缺省 0 = 不兑换（保持点数语义） |
| `studyPenalty` + `healthStudyPenaltyBelow` | object/number | 否 | ⏳ 可选 | engine | 低健康学习惩罚 `{dropChance,dropAmount}`；缺席则不生效 |
| `endingPriorityOrder` | `"asc"｜"desc"` | 否 | ⏳ D-W3 | ending.sortByPriority | `asc` = 数值越小越高；缺省 `desc` 兼容现配置 |
| `historyLimit` / `logLimit` | number | 否 | 默认 60 | state | 履历/日志环形上限 |
| `idleDecay` | object | 否 | ✅ 已生效 | engine.applyIdleDecay | 连续空窗扣属性：`{everyTurns:4, resetPerYear:true, knowledge:{actions:['study'],amount:3}, health:{actions:['exercise','rest'],amount:2}}`；缺省则不扣（兼容旧存档） |

当前实际片段（节选）：

```json
{
  "monthlyIncome": 2000,
  "monthlyExpense": 1950,
  "attributeClamp": { "knowledge": [0, 99], "social": [0, 99], "health": [0, 99], "money": null },
  "exam": { "subjects": ["高等数学", "大学英语", "专业核心", "思想政治"], "fluctuation": 0.10, "passLine": 60, "base": 50, "knowledgeWeight": 1.0 },
  "gpaTable": [{ "min": 90, "gpa": 4.0 }, { "min": 85, "gpa": 3.7 }, { "min": 60, "gpa": 1.0 }],
  "threeTierBonus": { "thresholds": [10, 20], "tiers": ["low", "mid", "high"], "bonus": { "low": 0, "mid": 1, "high": 2 } }
}
```

### 2.2 `tags.json`（B 的实际形状：`modifiers.attributes`）

```json
{ "id": "study_hard", "name": "学霸", "desc": "天生爱学习",
  "modifiers": { "attributes": { "knowledge": 2, "health": -1 } },
  "eventWeights": { "ev_r02": 1.5 } }
```

- `modifiers.attributes` 必填且非空；键 ∈ `attributeKeys`；三标签叠加后非 money 属性 `max(0, …)`（SRS 1.4，已由 `engine.applyTagModifiers` 实现）。
- 引擎同时兼容扁平写法 `modifiers:{knowledge:2}`。
- `eventWeights` 选填；键必须是 `events.json` 中存在的随机事件 id；`eventManager.computeWeight` 读取。

### 2.3 `colleges.json`

```json
{ "id": "cs", "name": "计算机学院", "desc": "代码与算法的世界",
  "eventBias": { "ev_r02": 1.4, "ev_r09": 1.4, "ev_r04": 0.8 } }
```

### 2.4 `actions.json`

```json
{ "id": "study", "name": "上课学习", "desc": "…", "mainAttr": "knowledge",
  "cost": 1, "requiresHealth": 0,
  "effects": { "attributes": { "knowledge": 2, "health": -1 } } }
```

- `mainAttr` 选填；存在时三档加成作用于它，且它必须出现在正向 `effects.attributes` 中。

### 2.5 `events.json`

```json
{
  "fixed": [
    { "id": "ev_fixed_club_recruit", "code": "CLUB", "type": "fixed", "name": "社团/学生会招新",
      "trigger": { "type": "termRange", "from": 1, "to": 3 }, "text": "…",
      "options": [ { "id": "join", "label": "加入社团", "resultText": "…",
        "effects": { "attributes": { "social": 3 }, "club": "join" } } ] }
  ],
  "random": [
    { "id": "ev_r05", "type": "random", "name": "心动信号", "weight": 6, "termRange": [3, 36], "text": "…",
      "options": [
        { "id": "confess", "label": "表白",
          "requires": { "attribute": { "key": "social", "min": 10 }, "disabledHint": "社交 ≥ 10 才能表白" },
          "resultText": "…",
          "effects": { "attributes": { "social": 2 }, "flags": { "romance": "dating" } } }
      ] }
  ]
}
```

- `effects` 允许键：`attributes` / `money` / `flags` / `club`（统一由 `effects.applyEffects` 写入）。
- `requires` 实际形状（B 的 `availableOptions` 读取）：`attribute:{key,min}` / `flag:{key,value}` / `moneyAtLeast` / `minTurn` / `maxTurn` / `gpaAtLeast`；`disabledHint` 写在 `requires` 内。
- `fixed` 必须含 `code:"CLUB"`、`"THESIS"`（当前另有 `"DEBT"`）；缺失即致命（设计 §11.1#3）。
- 随机事件权重 = `weight × Π(标签系数) × 学院偏向`，`termRange` 外为 0（B 已实现）。

### 2.6 `endings.json`

```json
{ "id": "ending_baoyan", "name": "保研上岸", "priority": 1, "desc": "…",
  "condition": { "type": "all", "conditions": [
    { "type": "gpaAtLeast", "value": 3.7 },
    { "type": "attributeAtLeast", "key": "knowledge", "value": 60 },
    { "type": "warningTrue", "negate": true }
  ] } }
```

- `priority` 方向由 `balance.endingPriorityOrder` 决定；`asc` 时数值越小越高。
- 条件类型白名单：`attributeAtLeast` `gpaAtLeast` `warningTrue`(+`negate`) `flagEquals` `tagIncludes` `collegeIs` `eventDone` `all` `any` `default`。
- **W3 已全部实现**（`ending.evaluateCondition` / `judgeEnding`），主结局 + 副结局一起返回；`endings.json` 的 6 条 SRS 结局仍待 D 重排（W3），代码已支持新旧两套配置。

---

## 3. GameState v2

```js
{
  version: '1.0.0',        // W4 与 SAVE_VERSION 同步升 '2.0.0'（D 的迁移 PR）
  seed, rngState,
  turn: 1, actionPoints: 4,
  player: {
    name, gender: '男'|'女', collegeId,
    attributes: { knowledge, social, health, money },   // money 是货币（D-01）
    tags: [3],
    appearance: '',        // 纯展示（立绘），不参与结算
    club: null|string,
    romance: 'none'|'dating'|'married',
    flags: {},             // 任意履历标记：scholarship / competition / intern / lastDebtTurn ...
    idle: { knowledge: 0, health: 0 },   // D-18：连续未安排对应行动的周数
    idleYear: 1                          // D-18：resetPerYear 用的学年序号
  },
  academics: {
    semesterScores: [],    // 兼容旧字段
    semesterRecords: [ { semester, turn, subjects:[{name,score,passed,gpa}], gpa, failed } ],
    failedCourses: 0, warning: false, warningTurn: null,
    studyActions: 0, studyActionsBySemester: 0,
    totalGpa: 0,
    thesis: null | { score, level }
  },
  pendingEvent: null | { eventId, options:[{id,label,enabled?,reason?}], resolved, createdTurn },
  eventHistory: [],
  history: [],             // 结构化履历 ≤ historyLimit：{turn,type,text,...}
  log: [],                 // 玩家可见文本 ≤ logLimit
  endingId: null
}
```

字段修改权：`core` 独占写；`main` 只写 `player.appearance`（纯展示）；UI 只读。

---

## 4. 接口签名（W1–W3 已落地）

### 4.1 `src/core/state.js`（A）

```js
STATE_VERSION: string                     // '1.0.0'
createGameState(options) -> GameState
clampAttrs(state, config?) -> state       // 支持 {min,max} 与按属性 [min,max]；money 默认不钳制
pushHistory(state, entry, config?) -> void
pushLog(state, text, config?) -> void
clone(state) -> GameState
```

### 4.2 `src/core/engine.js`（A）

```js
newGame(options, config, rng) -> { ok, state?, message?, reason? }      // 含三标签修正 + 可选资金兑换
actionAvailability(state, actionId, config) -> { ok, reason? }          // unknown_action|AP|health
doAction(state, actionId, config, rng) -> { ok, state, message?, reason? }  // 另含 pending_event
advance(state, config, rng) -> { ok, state, monthly?, settlement?, pendingEvent?, endingId?, endingSubs?, message?, reason? }
resolvePendingEvent(state, choiceId, config, rng) -> { ok, state, result?, message?, reason? }
getEnding(state, config) -> { ok, endingId, subEndings[] }
drawTagCandidates(config, rng, count=6) -> string[]                    // W2：随机刷 6 个不重复标签
buildViewModel(state, config) -> { availability, actions[], tierInfo, flags, monthly, debtThreshold, seed }  // W2：给 UI 的只读视图
```

`advance().settlement` 结构（C 的 `showExam` 依赖）：

```js
{
  semester: 1, turn: 5,
  subjects: [ { name, score, passed, gpa } ],   // 4 门，score ∈ [passLine,100]
  semesterGpa: 3.3, totalGpa: 3.3,
  failedCourses: 0, failedThisSemester: 0,
  warning: false
}
```

`advance().monthly` 结构：`{ ok, income, expense, net }`（income/expense 含当月兼职/消费流水）。

**考试周顺序（UI 契约）**：每学期期末先弹「期末考试周」事件（`ev_r14`，选项 `全力复习` / `佛系应考`），
玩家选择后**才**计算成绩并返回 `settlement`：

```text
advance()@考试回合  → 先 enterTurn() 触发 ev_r14；settlement = null，state.academics.pendingExam = {semester,turn}
resolvePendingEvent() → 应用复习选项效果 → finishExam() → 返回 { settlement }
main.onResolveEvent() → 关闭事件弹窗后 queueModal(app.showExam(settlement, done))
```

- 若 UI 未结算就推进下一周，`advance` 会在下一回合补算遗留的 `pendingExam`（成绩不会被吞，只是晚一回合）。
- 终局回合（40）无 `ev_r14`，直接算分 → 结算弹窗 → 结局弹窗。

### 4.3 `src/core/ending.js`（A）

```js
sortByPriority(list, config) -> ending[]                       // 方向由 balance.endingPriorityOrder 控制
evaluateCondition(cond, state, config) -> boolean              // 支持 all/any 递归 + negate
judgeEnding(state, config) -> { main: string|null, subs: string[] }
evaluateEnding(state, config) -> string|null
```

### 4.4 `src/main.js`（A）· callbacks

```
onNewGame(opts) onLoadGame() onSave() onAction(actionId) onAdvance()
onResolveEvent(choiceId) onChangeAppearance(id) onExport() onImport(file)
onClearSave() onOpenGallery() onOpenSettings() onOpenMenu()
```

W1 新增（可选，C 的弹窗队列用）：`onModalClosed()` —— UI 关闭弹窗后通知 main。

**读档语义（D-16）**：`onLoadGame` 读到的存档若 `state.endingId` 非空（最后一回合的自动存档），main 直接调
`eng.getEnding(state, config)` 取主/副结局 → 解锁图鉴 → 渲染 → `app.showEnding`，并结束本次读档流程；
此时再点「进入下一周」也走同一分支，不会出现 `无法推进：ended` 的 toast。
`onAdvance` 在 `state.turn >= balance.turns` 且未判结局时同样先补判结局。

### 4.5 其他人的 v2 目标（签名已冻结，实现由本人交付）

| Owner | 函数 | 交付周 |
|---|---|---|
| B | `effects.applyEffects(state, effects, ctx)` | W1 |
| B | `economy.settleMonthly(state, config)` / `applyExtraMoney` / `checkDebt(state, config)` | W1 |
| B | `academy.runFinalExam(state, config, rng)` / `gradePoint(score, config)` / `checkWarning(state, config)` / `judgeThesis(state, config)` | W1 |
| B | `eventManager.computeWeight` / `rollEvent` / `availableOptions` / `buildPending(event, state, config)` / `resolveEvent` | W2 |
| C | `app.showExam(settlement, done?)` / `app.showEvent(ev, done?)` / `app.showToast(msg, kind)`（已有）/ `app.setAppearance(id)`（已有）/ `app.showBacklog()`（已有） | W1–W2：`showExam` 与 `onModalClosed` 待交付；其余已在现网 UI 中可用 |
| D | `loadConfig` 并行 / `validateConfigs` v2 / `storage` IndexedDB + `migrateSave` | W1–W4 |

> 兼容策略：A 在 engine 内做了**过渡适配**（见 §9），B 的 v2 函数一旦出现即自动优先使用，旧实现自动降级；B 合并后 A 删除适配层。
> **禁止**在 A 未删除适配层时直接改 engine 调用点。

---

## 5. 行为决策（W0 签字 + W3 收口）

| 编号 | 决策 | 结论 | 影响 | 状态 |
|---|---|---|---|---|
| **D-01** | 金钱语义 | **货币**：不参与钳制、可为负；开局资金 = 分配点数 × `walletPerMoneyPoint`（值待定，见 §11 Q1） | endings 阈值、UI 显示、金额脚本 | 🟡 代码就绪，等 Q1 定值 |
| **D-02** | 结局优先级方向 | 按 SRS **数值越小越高**；`balance.endingPriorityOrder` 控制，当前默认 `desc` 兼容旧配置 | ending.js、endings.json | ✅ 引擎双向支持，等 D 重排配置后切 `asc` |
| **D-03** | 健康阈值 | 健康 < 3 只能**锻炼 + 休息**；健康 < 5 学习学识 +0，`studyPenalty.dropChance` 概率再 −1 | actionAvailability / doAction | ✅ 白名单已生效；惩罚等配置字段 |
| D-04 | 三档加成 | `<10 +0 / 10–19 +1 / ≥20 +2`，只加 `mainAttr`，不加负向 | doAction | ✅ 已生效（`threeTierBonus.bonus`） |
| **D-05** | 期末成绩（**永不挂科，已定**） | 单门 `score = round(base + 学识×knowledgeWeight×(1±fluctuation))`，再夹 `[passLine, 100]`；4 门；绩点查 `gpaTable`。**任何学识水平都不挂科** | academy / settlement / 结局可达性 | ✅ 已生效（B 实现 + A 的 8 学期回归用例锁定） |
| D-06 | 固定事件标识 | `code:"CLUB"｜"THESIS"｜"DEBT"`，id 保留现名；缺失即致命 | schema / events | 🟡 事件已加 code；schema 校验仍待 D |
| D-07 | 存档版本 | 单槽/多槽并存（D 已加 `saveGameSlot/listSlots`）；`SAVE_VERSION` 升级与 `migrateSave` 仍待 D | storage / main | 🟡 多槽已上线，迁移未做 |
| D-08 | 姓名/性别 | 姓名 1–12 字，**只允许汉字或英文字母**（数字/符号/空格一律拒绝）；性别男/女 | UI + engine | ✅ 已生效（`state.isValidName` + UI 输入过滤 + `newGame` 拒绝 `reason:'name'`） |
| D-09 | 属性初始 | 四项 0 起分配 20 点；标签修正后再钳制 | UI / engine | 🟡 引擎侧已支持标签修正，UI 仍默认 5/5/5/5 |
| D-10 | 结算顺序 | 回合+1 → 月初 → 负债 → 期末（先复习事件、后出成绩）→ 事件（固定 > 负债 > 随机）→ 终局；终局回合不再触发事件 | engine.advance | ✅ |
| D-11 | 履历/图鉴 | `history` ≤60 条结构化；图鉴跨周目唯一；**主结局与副结局都入图鉴** | state / storage / main | ✅ |
| D-12 | 依赖 | 不引入任何第三方运行时/测试依赖 | 全组 | ✅ |
| D-13 | 弹窗顺序 | 同回合「结算 → 事件」；终局「结算 → 结局」。由 `main.modalQueue` 串行，UI 通过 `done` / `onModalClosed` / Promise 通知关闭；UI 不通知时下一次交互隐式关闭兜底 | main / UI | ✅ 已与 C 的 `showExam(settlement, done)` 对接成功（浏览器 E2E 验证 8 次结算弹窗） |
| **D-14** | 月度支出 | 配置为 **1950**，SRS 写 **1800**；当前以配置为准 | economy / 文档 | 🟡 待课程文档确认（建议改文档而不是改配置，因为 1950 已配合事件物价） |
| **D-15** | 学业警告 | 永不挂科 ⇒ `failedCourses` 恒 0 ⇒ `warning` 永不触发 ⇒ `ending_warning` 不可达 | endings 配置 | 🟡 D-W3 重排结局时必须删掉/替换该结局，否则 6 结局里有 1 条永远拿不到 |
| **D-17** | 姓名合法性 | 1–12 字符，仅 `[\u4e00-\u9fa5A-Za-z]`；UI 侧实时过滤非法字符，引擎侧 `newGame` 兜底拒绝（`reason:'name'`） | state / engine / UI | ✅ |
| **D-18** | 连续空窗扣属性 | 连续 `everyTurns`（4）周没有「学识类」行动 → 学识 −`amount`（3）；没有「健康类」行动（锻炼/休息）→ 健康 −`amount`（2）；做了对应行动立即清零计数；每到 4 的倍数扣一次；`resetPerYear` 时每学年（10 回合）重新计数；属性下限 0 | engine.applyIdleDecay + balance.idleDecay | ✅ 已生效（4 个用例覆盖：触发/重置/学年重置/下限） |

---

## 6. 版本与迁移

- 配置 `version`：六表统一 `2.0.0`（D-W1 起）。
- 存档 `SAVE_VERSION`：`1.0.0 → 2.0.0`（D-W4），`migrateSave` 为 v1 存档补 `history/flags/semesterRecords/totalGpa/thesis`，失败返回 `{ok:false,reason:'version_incompatible'}`。
- `GameState.version`：**暂保持 `1.0.0`**，与 `SAVE_VERSION` 在 D-W4 同 PR 升级；原因是当前 `tests/verify_m1.mjs` 断言了 `version==='1.0.0'`，同步升级必须由测试 Owner（D）一起改，避免 A 单方面改红别人的测试。
- 兼容原则：**新增字段必须有默认值**；不重命名已发布字段；删除字段需一次迁移。

---

## 7. 红线（违反即退回）

1. 原生 ES2020 ESM、无框架、无打包、HTTP 运行（禁 `file://`）。
2. `core/` `events/` `config/` 禁 DOM / `localStorage` / `indexedDB` / `window.`；随机唯一入口 `rng.js`，禁 `Math.random`。
3. 数值必须来自 `config/*.json`；代码里只允许 0/1 边界与数组下标。
4. UI 零 import、绝不改 `GameState`；状态变更只经 callbacks。
5. 签名/字段变更必须同 PR 改本文件。
6. **不得通过删改他人测试来变绿**；测试变更须单独说明。
7. 提交信息：`<角色>-W<N>: <一句话>`。

---

## 8. 仓库设置清单（A 在 GitHub 网页完成，本地无 git 命令环境）

| # | 设置 | 路径 | 状态 |
|---|---|---|---|
| 1 | `main` 分支保护：Require PR + Require status checks (`test`) + Include administrators | Settings → Branches | ⏳ 待 A |
| 2 | `dev` 分支保护（可选） | 同上 | ⏳ 待 A |
| 3 | Actions workflow（`npm test` on PR） | `.github/workflows/test.yml` | ⏳ 待 D（D-W0） |
| 4 | Labels：`P0` `P1` `P2` `契约变更` `待验收` `验收退回` `已验收` | Issues → Labels | ⏳ 待 A |
| 5 | Milestones：`W1`…`W5` | Issues → Milestones | ⏳ 待 A |
| 6 | Projects 看板：`Todo / 本周在做 / 待验收 / 退回中 / 已完成` | Projects | ⏳ 待 A |
| 7 | Pages：Production branch = `main`；Preview deployments = All branches | Cloudflare Dashboard | ⏳ 待 A 确认 |

---

## 9. 激活开关表（W3 收口后的真实状态）

> "已就绪"= 代码写完且有单测；"已激活"= 当前配置下真的生效。

| 能力 | 代码位置 | 当前状态 | 激活条件 | Owner |
|---|---|---|---|---|
| 健康 <3 行动白名单 | `engine.actionAvailability` | ✅ 已激活 | — | A |
| 待处理事件阻断 | `engine.doAction` | ✅ 已激活 | D 更新 `verify_m1` 1 条用例 | A + D |
| 属性钳制（按属性/全局） | `state.clampAttrs` | ✅ 已激活（`[0,99]`，money 不钳制） | — | A |
| 履历/日志环形 | `state.pushHistory/pushLog` | ✅ 已激活（60） | — | A |
| 标签三选修正叠加 | `engine.applyTagModifiers` | ✅ 已激活（`tags.modifiers.attributes`） | — | A + B |
| 三档加成 | `engine.tierBonus` | ✅ 已激活（`threeTierBonus.bonus` + `actions.mainAttr`） | — | A + B |
| 健康 <5 学习惩罚 | `engine.applyStudyPenalty` | 🟡 就绪，配置未加 | D 给 `studyPenalty` + `healthStudyPenaltyBelow` | D |
| 初始资金兑换 | `engine.newGame` | 🟡 就绪，值未定 | Q1 定 `walletPerMoneyPoint`，D 同步改 `verify_ui` 断言 | D/B |
| 月初收支 / 负债 | `engine.advance` → `economy.settleMonthly/checkDebt` | ✅ 已激活（2000/1950、−3000/6） | — | B |
| 期末 4 科 + 绩点 + 论文 | `engine.advance` → `academy.runFinalExam/checkWarning/judgeThesis` | ✅ 已激活（永不挂科，D-05） | — | B |
| 学期结算数据 | `engine.advance().settlement` | ✅ 已激活（4 科） | — | A + B |
| 结局条件引擎（all/any/7 类） | `ending.evaluateCondition/judgeEnding` | ✅ 已激活 | — | A |
| 主 + 副结局 | `engine.advance().endingSubs` + `main.onAdvance` | ✅ 已激活（副结局也入图鉴） | — | A |
| 结局方向 asc | `ending.sortByPriority` | 🟡 就绪（默认 desc 兼容现配置） | D 给 `endingPriorityOrder:'asc'` + 重排 endings | D |
| 学期结算弹窗 | `app.showExam(settlement, done)` | ✅ 已激活（浏览器 E2E 验证 8 次调用） | — | C |
| 弹窗队列（结算→事件→结局） | `main.modalQueue` + `onModalClosed` | ✅ 已激活 | — | A + C |
| 读档恢复未结算事件 | `main.onLoadGame` | ✅ 已激活 | — | A |
| `?dev=1` 面板 + `__scusim` 句柄 | `main.mountDevPanel/start` | ✅ 已激活（正式访问不存在） | — | A |
| IndexedDB / 迁移 | `storage` | ❌ 未实现（多槽已上线，仍 localStorage） | D-W4 | D |
| schema v2 校验 / CI / accept 脚本 | `src/config/schema.js` 等 | ❌ 未交付 | D-W1 | D |

**过渡适配层已删除**：`engine.js` 现在直接调用 B 的 `settleMonthly/checkDebt/runFinalExam/checkWarning/rollEvent/buildPending`。

---

## 10. 变更流程

1. 需要新字段/新签名 → 先提 issue（`契约变更` 模板），写清"谁读、谁写、默认值、影响面"。
2. A 24h 内裁决；通过则**同 PR** 更新本文件 §2/§3/§4 + 影响方的最小改动。
3. schema（D）必须同步：新增字段进校验、新增错误进负向用例。
4. 验收记录（`docs/验收/W<N>-<角色>.md`）里注明"本 PR 是否触碰契约"。

---

## 11. 决议回填（W1 中期 + W3 收口）

| # | 议题 | 决议 | 落地 |
|---|---|---|---|
| Q1 | `walletPerMoneyPoint` 取值 | **不采用 200**；具体值由 D/B 定，A 不写死（缺省 0 = 不兑换） | 🟡 仍开放；值定了以后 D 同 PR 改 `verify_ui` 的"四属性和=20"断言，C 把 money 渲染成金额 |
| Q2 | 低健康学习惩罚 | **概率扣**（`studyPenalty.dropChance` 建议 0.3、`dropAmount` 1） | 引擎已按概率；等 D 填配置 |
| Q3 | 结算 / 事件弹窗顺序 | **结算先、事件后**；终局为「结算 → 结局」 | ✅ 已实现并由浏览器 E2E 验证（8 次结算弹窗） |
| Q4 | 结局方向切换周次 | **W3** 与 `endings.json` 重排同 PR | 🟡 引擎已支持；等 D 重排配置 |
| Q5 | 开局步骤 | **六步**：姓名 → 性别 → 学院 → 属性 → 标签 → 立绘 | ✅ 任务书/手册已同步 |
| **Q6** | 期末是否允许挂科 | **永不挂科**（团队已定）：分数下限 `passLine`，`failedCourses` 恒 0 | ✅ 引擎 + B 实现 + A 的 8 学期回归用例锁定；**副作用见 D-15** |
| **Q7** | 属性上限 | 配置为 **99**（`attributeClamp` 按属性数组），SRS 同为 0–99 | ✅ 已对齐 |
| **Q8** | 月度支出 | 配置 **1950**，SRS **1800** | 🟡 待文档确认（D-14） |
| **Q9** | 学业警告结局 | 永不挂科后 `ending_warning` 不可达 | 🟡 D 在 W3 重排结局时删除/替换 |

> Q1 / Q8 / Q9 是本周期剩余的三个开放项；其余全部落地。

---

## 附录 A · A 侧交付清单（W1–W4）

| 文件 | 变更 |
|---|---|
| `src/core/state.js` | GameState v2 字段、`clampAttrs`（全局/按属性两种写法、money 不钳制）、`pushHistory`/`pushLog` 环形；保留 `appearance` |
| `src/core/engine.js` | 三档加成（`threeTierBonus.bonus`）、健康白名单、学习惩罚、pending 阻断、标签修正、`drawTagCandidates`、`buildViewModel`、`advance` 新顺序 + `monthly/settlement/endingSubs`、终局不出事件、**删除过渡适配层直接调 B** |
| `src/core/ending.js` | 条件引擎（all/any/7 类 + negate）、`judgeEnding` 主+副结局、`sortByPriority`（`endingPriorityOrder`） |
| `src/main.js` | 弹窗队列（结算→事件→结局，含隐式关闭兜底）、读档恢复未结算事件、副结局入图鉴、`buildViewModel` 接入、`?dev=1` 面板 + `__scusim` 句柄 |
| `tests/unit/a-engine.mjs` | 76 条断言（全 PASS） |
| `tests/unit/a-main.mjs` | 15 条断言（队列/不叠窗/隐式关闭/读档结局，全 PASS） |
| `tests/unit/a-browser-e2e.mjs` | 真实 Edge headless E2E：25 条断言 + 5 张截图（`docs/截图/W1-A/`），全 PASS |

## 附录 B · 签署

| 角色 | 结论 | 日期 |
|---|---|---|
| A（Owner） | ✅ v2.0-draft 已按 W1–W4 收口 | W3 |
| B | ✅ 规则已合并（经济/学业/事件/effects） | W3 |
| C | ✅ `showExam(settlement, done)` 已对接 | W3 |
| D | ⏳ schema/CI/accept/IDB 待交付 | — |
