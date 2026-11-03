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

### 2.1 `balance.json` 字段表

| 键 | 类型 | 必填 | 当前状态 | 读取者 | 语义 |
|---|---|---|---|---|---|
| `turns` | number | 是 | ✅ 40 | engine | 总回合数 |
| `actionPointsPerTurn` | number | 是 | ✅ 4 | engine | 每回合 AP |
| `monthsPerSemester` | number | 是 | ✅ 5 | engine | 学期换算 |
| `examTurns` | number[] | 是 | ✅ [5,10,…,40] | engine | 期末回合 |
| `attributePointTotal` | number | 是 | ✅ 20 | engine | 开局分配总点 |
| `attributeKeys` | string[4] | 是 | ✅ | schema | 属性键 |
| `attributeClamp` | object | 否 | ⏳ D-W1 | state.clampAttrs | `{knowledge:[0,99],social:[0,99],health:[0,99],money:null}`；`null` = 不钳制 |
| `walletPerMoneyPoint` | number | 否 | ⏳ D-W1 | engine.newGame | 1 点「金钱」兑换的初始资金；**具体值由 D/B 定**（W1 决议：不采用 200），A 代码不写死；缺省 = 0，表示不兑换 |
| `monthlyIncome` / `monthlyExpense` | number | 否 | ⏳ D-W1 | economy.settleMonthly | 每月 +2000 / −1800 |
| `debtThreshold` | number | 否 | ⏳ D-W1 | economy.checkDebt | 负债触发线（−3000） |
| `debtCooldownTurns` | number | 否 | ⏳ D-W1 | economy.checkDebt | 负债事件冷却（6） |
| `healthRestrictThreshold` | number | 是 | ✅ 3 | engine.actionAvailability | 健康低于此值只允许锻炼/休息 |
| `healthStudyPenaltyBelow` | number | 否 | ⏳ D-W1 | engine | 健康低于此值学习不增长（5） |
| `studyPenalty` | object | 否 | ⏳ D-W1 | engine | `{dropChance:0.3,dropAmount:1}` |
| `tierBonus` | object | 否 | ⏳ D-W1 | engine | `{thresholds:[10,20],bonuses:[1,2]}` |
| `randomEventBaseChance` | number | 是 | ✅ 0.35 | eventManager | 随机事件基率 |
| `randomEventChanceRange` | number[2] | 否 | ⏳ D-W1 | eventManager | `[0.30,0.40]` 校验区间 |
| `warningFailedCourses` | number | 是 | ✅ 3 | academy.checkWarning | 学业警告阈值 |
| `exam` | object | 是 | ✅（旧公式） | academy | v2：`{subjects:[4 门], fluctuation:0.10, passLine:60}` |
| `gpaTable` | object[] | 否 | ⏳ D-W1 | academy.gradePoint | 降序 `{min,gpa}`，必须含 `min:0` |
| `thesis` | object | 否 | ⏳ D-W1 | academy.judgeThesis | `{knowledgeWeight:1.0,gpaWeight:25,passLine:60}` |
| `endingPriorityOrder` | `"asc"｜"desc"` | 否 | ⏳ D-W3 | ending.sortByPriority | `asc` = 数值越小越高（SRS 口径） |
| `historyLimit` / `logLimit` | number | 否 | ⏳ D-W1 | state | 履历/日志环形上限（60） |

示例（B/D 合并后应与本片段一致）：

```json
{
  "version": "2.0.0",
  "attributeClamp": { "knowledge": [0, 99], "social": [0, 99], "health": [0, 99], "money": null },
  "walletPerMoneyPoint": 200,
  "monthlyIncome": 2000,
  "monthlyExpense": 1800,
  "debtThreshold": -3000,
  "debtCooldownTurns": 6,
  "healthRestrictThreshold": 3,
  "healthStudyPenaltyBelow": 5,
  "studyPenalty": { "dropChance": 0.3, "dropAmount": 1 },
  "tierBonus": { "thresholds": [10, 20], "bonuses": [1, 2] },
  "exam": { "subjects": ["高等数学", "大学英语", "专业核心课", "思想政治"], "fluctuation": 0.10, "passLine": 60 },
  "gpaTable": [
    { "min": 90, "gpa": 4.0 }, { "min": 85, "gpa": 3.7 }, { "min": 82, "gpa": 3.3 },
    { "min": 78, "gpa": 3.0 }, { "min": 75, "gpa": 2.7 }, { "min": 72, "gpa": 2.3 },
    { "min": 68, "gpa": 2.0 }, { "min": 64, "gpa": 1.5 }, { "min": 60, "gpa": 1.0 },
    { "min": 0,  "gpa": 0.0 }
  ],
  "thesis": { "knowledgeWeight": 1.0, "gpaWeight": 25, "passLine": 60 },
  "endingPriorityOrder": "asc",
  "historyLimit": 60,
  "logLimit": 60
}
```

### 2.2 `tags.json`

```json
{ "id": "study_hard", "name": "学霸", "desc": "天生爱学习",
  "modifiers": { "knowledge": 3, "health": -1 },
  "eventWeights": { "ev_r02": 1.5, "ev_r12": 1.5 } }
```

- `modifiers` 必填且非空；键 ∈ `attributeKeys`；叠加后每项 `max(0, …)`（SRS 1.4）。
- `eventWeights` 选填；键必须是 `events.json` 中存在的随机事件 id。

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
        { "id": "confess", "label": "表白", "requires": { "attribute": { "social": 10 } },
          "disabledHint": "社交 ≥ 10 才能表白", "resultText": "…",
          "effects": { "attributes": { "social": 2 }, "flags": { "romance": "dating" } } }
      ] }
  ]
}
```

- `effects` 允许键：`attributes` / `money` / `flags` / `club`。
- `requires` 允许键：`attribute` / `flag` / `moneyAtLeast` / `minTurn` / `maxTurn`。
- `fixed` 必须含 `code:"CLUB"` 与 `code:"THESIS"` 各一条，否则 schema 判致命错误（设计 §11.1#3）；负债事件（W3）用 `code:"DEBT"`。
- 随机事件权重 = `weight × Π(标签系数) × 学院偏向`，`termRange` 外为 0（B-W2）。

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
- 条件类型白名单：`attributeAtLeast` `gpaAtLeast` `warningTrue` `flagEquals` `tagIncludes` `collegeIs` `eventDone` `all` `any` `default`。
- W1 实现仅 `attributeAtLeast` / `warningTrue` / `default`；其余类型 W3 由 A 扩展，schema 的 type 白名单由 D 先放开。

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
    flags: {}              // 任意履历标记：scholarship / competition / intern / lastDebtTurn ...
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

## 4. 接口签名（W1 已落地）

### 4.1 `src/core/state.js`（A）

```js
STATE_VERSION: string                     // '1.0.0'
createGameState(options) -> GameState
clampAttrs(state, config?) -> state       // 每次数值变更后调用
pushHistory(state, entry, config?) -> void
pushLog(state, text, config?) -> void
clone(state) -> GameState
```

### 4.2 `src/core/engine.js`（A）

```js
newGame(options, config, rng) -> { ok, state?, message?, reason? }
actionAvailability(state, actionId, config) -> { ok, reason? }   // reason: unknown_action|AP|health
doAction(state, actionId, config, rng) -> { ok, state, message?, reason? }  // reason 增 pending_event
advance(state, config, rng) -> { ok, state, monthly?, settlement?, pendingEvent?, endingId?, message?, reason? }
resolvePendingEvent(state, choiceId, config, rng) -> { ok, state, result?, message?, reason? }
getEnding(state, config) -> { ok, endingId }
```

`advance().settlement` 结构（C 的 `showExam` 依赖）：

```js
{
  semester: 1, turn: 5,
  subjects: [ { name, score, passed, gpa } ],
  semesterGpa: 3.3, totalGpa: 3.3,
  failedCourses: 0, failedThisSemester: 0,
  warning: false
}
```

`advance().monthly` 结构：`{ ok, income, expense, net }`。

### 4.3 `src/core/ending.js`（A）

```js
evaluateEnding(state, config) -> string|null
```

### 4.4 `src/main.js`（A）· callbacks

```
onNewGame(opts) onLoadGame() onSave() onAction(actionId) onAdvance()
onResolveEvent(choiceId) onChangeAppearance(id) onExport() onImport(file)
onClearSave() onOpenGallery() onOpenSettings() onOpenMenu()
```

W1 新增（可选，C 的弹窗队列用）：`onModalClosed()` —— UI 关闭弹窗后通知 main。

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

## 5. 行为决策（W0 签字结论）

| 编号 | 决策 | 结论 | 影响 | 状态 |
|---|---|---|---|---|
| **D-01** | 金钱语义 | **货币**：不参与 0–99 钳制、可为负；开局资金 = 分配点数 × `walletPerMoneyPoint`（值由 D/B 定，不采用 200） | endings 阈值、UI 显示、金额脚本 | ✅ 代码就绪，等配置激活 |
| **D-02** | 结局优先级方向 | 按 SRS **数值越小越高**；`balance.endingPriorityOrder` 控制，当前默认 `desc` 兼容旧配置 | ending.js、endings.json、测试 | ✅ 代码就绪，W3 原子切换 |
| **D-03** | 健康阈值 | 健康 < 3 只能**锻炼 + 休息**；健康 < 5 学习学识 +0，`studyPenalty.dropChance` 概率再 −1 | actionAvailability / doAction | ✅ 已生效（惩罚等配置） |
| D-04 | 三档加成 | `<10 +0 / 10–19 +1 / ≥20 +2`，只加 `mainAttr`，不加负向 | doAction | ✅ 代码就绪，等 `mainAttr` |
| D-05 | 期末成绩 | `score = round(学识 × (1 + U(−0.10,+0.10)))`，4 门，60 及格，绩点查 `gpaTable` | academy / settlement | ⏳ B-W1 |
| D-06 | 固定事件标识 | `code:"CLUB"｜"THESIS"｜"DEBT"`，id 保留现名；缺失即致命 | schema / events | ⏳ D-W1（schema） |
| D-07 | 存档版本 | `SAVE_VERSION=2.0.0` + `migrateSave` 补默认字段；失败拒绝并提示 | storage / main | ⏳ D-W4 |
| D-08 | 姓名/性别 | 姓名 1–12 字；性别男/女 | UI | ⏳ C-W2 |
| D-09 | 属性初始 | 四项 0 起分配 20 点；money 表示初始资金档 | UI / engine | ⏳ C-W2 |
| D-10 | 结算顺序 | 回合+1 → 月初 → 负债 → 期末 → 事件（固定 > 负债 > 随机）→ 终局 | engine.advance | ✅ 已实现 |
| D-11 | 履历/图鉴 | `history` ≤60 条结构化；图鉴跨周目唯一 | state / storage | ✅ 引擎侧已实现 |
| D-12 | 依赖 | 不引入任何第三方运行时/测试依赖 | 全组 | ✅ |
| D-13 | 弹窗顺序 | 同回合「结算 → 事件」；由 `main.modalQueue` 串行，UI 通过 `done` 回调 / `onModalClosed` / 返回 Promise 任一种方式通知关闭；UI 不通知时下一次交互隐式关闭兜底 | main / UI | ✅ 队列已实现（等 C 的 `showExam`） |

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

## 9. 激活开关表（W1 落地真相）

> "已就绪"= 代码写完且有单测；"已激活"= 当前配置下真的生效。

| 能力 | 代码位置 | 当前状态 | 激活条件 | Owner |
|---|---|---|---|---|
| 健康 <3 行动白名单 | `engine.actionAvailability` | ✅ 已激活（`healthRestrictThreshold: 3` 已在配置） | — | A |
| 待处理事件阻断 | `engine.doAction`（`reason:'pending_event'`） | ✅ 已激活（**行为变更**） | D 更新 `verify_m1` 1 条用例 | A + D |
| 属性钳制 | `state.clampAttrs` | ✅ 已激活（默认 [0,99]，money 不钳制） | — | A |
| 履历/日志环形 | `state.pushHistory/pushLog` | ✅ 已激活（默认 60） | — | A |
| 学期学习计数重置 | `engine.advance` | ✅ 已激活 | — | A |
| 学期结算数据 | `engine.advance().settlement` | ✅ 已激活（单科降级） | B 的 `runFinalExam` 合并后自动升 4 科 | A + B |
| `?dev=1` 调试面板 + 只读句柄 `__scusim` | `main.mountDevPanel` / `main.start` | ✅ 已激活（无 `dev=1` 时不存在，已由浏览器 E2E 验证） | — | A |
| 三档加成 | `engine.tierBonus` | 🟡 就绪未激活 | B 给 `actions.mainAttr` + D 给 `tierBonus` | B/D |
| 健康 <5 学习惩罚 | `engine.applyStudyPenalty` | 🟡 就绪未激活 | D 给 `studyPenalty` + `healthStudyPenaltyBelow` | D |
| 初始资金兑换 | `engine.newGame` | 🟡 就绪未激活 | D 给 `walletPerMoneyPoint` 并改 `verify_ui` 的"属性和=20"断言 | D |
| 月初收支 | `engine.settleMonth` | 🟡 就绪未激活（空操作） | D 给 `monthlyIncome/monthlyExpense` | D |
| 负债事件 | `engine.debtCheck` | 🟡 就绪未激活 | B 给 `checkDebt` + `events.fixed` 负债事件 | B |
| 4 科 ±10% 考试 / 绩点 / 论文 | `engine.runExam/gradePoint` 适配层 | 🟡 降级单科 | B 合并 `runFullExam` 系列 | B |
| 结局方向 asc | `ending.sortByPriority` | 🟡 就绪未激活（默认 desc） | D 给 `endingPriorityOrder:'asc'` + 重排 endings | D/A W3 |
| 学期结算弹窗 | `main.onAdvance` | 🟡 toast 兜底 | C 提供 `app.showExam` | C |
| 弹窗队列 | `main.modalQueue` + `onModalClosed` | ✅ 已实现（结算先、事件后；含隐式关闭兜底） | C 交付 `showExam` 后自动生效 | A + C |
| IndexedDB / 迁移 | `storage` | ❌ 未实现 | D-W4 | D |

**过渡适配层**：`engine.js` 顶部「过渡适配层」一节（`settleMonth / debtCheck / gradePoint / runExam / warningCheck / rollRandom / buildPendingEvent`）。
B 合并 v2 后，A 删除该段并保留直接调用——**删除时同步更新本表**。

---

## 10. 变更流程

1. 需要新字段/新签名 → 先提 issue（`契约变更` 模板），写清"谁读、谁写、默认值、影响面"。
2. A 24h 内裁决；通过则**同 PR** 更新本文件 §2/§3/§4 + 影响方的最小改动。
3. schema（D）必须同步：新增字段进校验、新增错误进负向用例。
4. 验收记录（`docs/验收/W<N>-<角色>.md`）里注明"本 PR 是否触碰契约"。

---

## 11. 决议回填（W1 中期）

| # | 议题 | 决议 | 落地 |
|---|---|---|---|
| Q1 | `walletPerMoneyPoint` 取值 | **不采用 200**；具体值由 D/B 定，A 不写死（缺省 0 = 不兑换） | §2.1 已改；值定了以后 D 同 PR 改 `verify_ui` 的"四属性和=20"断言，C 把 money 渲染成金额 |
| Q2 | 低健康学习惩罚 | **概率扣**（`studyPenalty.dropChance` 建议 0.3、`dropAmount` 1） | 引擎已按概率；D 填配置 |
| Q3 | 结算 / 事件弹窗顺序 | **结算先、事件后** | `main.modalQueue` + D-13；C 交 `showExam` 即生效 |
| Q4 | 结局方向切换周次 | **W3** 与 `endings.json` 重排同 PR | 保持 `endingPriorityOrder` 待激活 |
| Q5 | 开局步骤 | **六步**：姓名 → 性别 → 学院 → 属性 → 标签 → 立绘 | 任务书与手册措辞已同步（原"四步"作废） |

> Q1 是本周期唯一的开放项：A 的代码对取值不敏感（任意数字都支持），但**值确定前不要打开**，否则 `verify_ui` 的断言会红。

---

## 附录 A · W1 已交付清单（A）

| 文件 | 变更 |
|---|---|
| `src/core/state.js` | v2 字段、`clampAttrs`、`pushHistory`、`pushLog`；保留 `appearance` 展示字段 |
| `src/core/engine.js` | 三档加成、健康白名单、学习惩罚、pending 阻断、`advance` 新顺序+`monthly/settlement`、负债接线、过渡适配层、终局回合不触发事件（E2E 缺陷修复） |
| `src/core/ending.js` | `sortByPriority`（`endingPriorityOrder` 开关），条件类型 W3 扩展 |
| `src/main.js` | 弹窗队列（`modalQueue`，结算先事件后 + 隐式关闭兜底）、`onAdvance` 排队、`onAction` 原因文案、`?dev=1` 调试面板 |
| `tests/unit/a-engine.mjs` | 45 条断言（全 PASS） |
| `tests/unit/a-main.mjs` | 12 条断言：队列顺序 / 不叠窗 / 隐式关闭 / `onModalClosed`（全 PASS） |
| `tests/unit/a-browser-e2e.mjs` | 真实 Edge headless E2E：23 条断言 + 5 张截图（`docs/截图/W1-A/`），全 PASS |

## 附录 B · 签署

| 角色 | 结论 | 日期 |
|---|---|---|
| A（Owner） | ✅ 已发布 v2.0-draft | W0 |
| B | ⏳ 待签 | — |
| C | ⏳ 待签 | — |
| D | ⏳ 待签 | — |
