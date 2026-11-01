# B · 经济 / 学业 / 事件负责人 · 任务书

> 你负责"游戏规则本身"：钱怎么变、考试怎么算、事件怎么抽、选项怎么结算。
> 你是四个模块（`economy` `academy` `effects` `eventManager`）的唯一作者，A 只负责调用你。
> 配套阅读：`docs/团队分工与验收手册.md`（下称《手册》）§2.2 配置契约、§2.5 决策表。

---

## 1. 你的边界

### 1.1 你能改（白名单）

| 文件 | 说明 |
|---|---|
| `src/core/economy.js` | 月度收支、额外收支、负债判定 |
| `src/core/academy.js` | 期末考试、绩点、挂科警告、毕业论文 |
| `src/core/effects.js`（新增） | **统一写入口**：属性 / money / flags / club 一次 apply，所有模块共用 |
| `src/events/eventManager.js` | 权重、抽取、选项可见性、结算、固定事件 |
| `config/actions.json` `events.json` `tags.json` `colleges.json` | **内容与数值**（结构由 D 维护，你只填数据） |
| `tools/sim.mjs`（新增） | 数值模拟脚本（1000 局统计结局分布） |
| `tests/unit/b-*.mjs`（新增） | 你自己的单测 |

### 1.2 你不能改

- A：`rng.js` `state.js` `engine.js` `ending.js` `main.js`。
- C：`index.html` `css/**` `ui.js`。
- D：`loader.js` `schema.js` `storage.js` `tests/**`（除 `tests/unit/b-*`）`package.json` `README.md`。

> 你**不改** engine：engine 会调你。你**不改** config 的字段结构（加新字段要先让 D 加 schema 校验）。

### 1.3 你的交付物（按周）

| 周 | 交付物 |
|---|---|
| W0 | 一页纸：规则缺口清单 + 候选数值表（月度收支、负债阈值、考试参数、绩点表、结局阈值）+ 事件内容清单（≥24 条，含川大特色） |
| W1 | `economy` + `academy` + `effects` 实现与单测（期末 ±10%、绩点、挂科按科目、负债） |
| W2 | 权重公式 + `availableOptions`（前置条件）+ `requires` + 标签/学院内容 v2 |
| W3 | 24 条事件内容（含负债/恋爱/竞赛/实习链）+ 固定事件 v2 + `flags` 结算 |
| W4 | `tools/sim.mjs` 1000 局模拟 + 阈值反调 + 平衡报告 |
| W5 | 数值冻结 + 规则讲解稿（答辩用） |

---

## 2. 六周任务卡

### W0 · 盘点与候选数值

**目标**：给 A 拍板提供数据，别等。

1. 规则缺口清单：逐条对照 `docs/团队分工与验收手册.md` §1.2（G01–G24 里归你的部分），标"已有/缺/错"。
2. 候选数值表（直接可写进 `balance.json`）：

| 参数 | 建议值 | 依据 |
|---|---|---|
| `monthlyIncome` / `monthlyExpense` | 2000 / 1800 | SRS 3.3.1 |
| `walletPerMoneyPoint` | 200 | 让 20 点分配有意义（D-01） |
| `debtThreshold` / 冷却 | −3000 / 6 回合 | 设计 3.1 |
| `exam.subjects` | 4 门 | 设计 10.2 |
| `exam.fluctuation` / `passLine` | 0.10 / 60 | SRS 4.1 |
| `gpaTable` | 90→4.0、85→3.7、82→3.3、78→3.0、75→2.7、72→2.3、68→2.0、64→1.5、60→1.0 | SRS 4.3（待 A 签字） |
| `thesis` | knowledgeWeight 1.0、gpaWeight 25、passLine 60 | SRS 4.5 |
| `warningFailedCourses` | 3 | SRS 4.2 |
| 三档阈值/加成 | 10 / 20 → +0 / +1 / +2 | USR-0010 |

3. 事件内容清单：24 条（2 固定 + 22 随机），每条给 `id/name/weight/termRange/2–3 选项/前置/效果（含 flags）`，其中至少 4 条川大特色（江安校区、华西、望江、青广、图书馆、运动会）。
4. 把清单贴进 PR 描述，等 A 在周一拍板。**不要直接改代码**。

### W1 · 经济 + 学业（最重的一周）

**目标**：让 G01–G09 全部消失。

1. **`effects.js`**（新）
   ```js
   applyEffects(state, effects, ctx) -> { ok:true, changes:[{kind:'attr'|'money'|'flag'|'club', key, delta}] }
   ```
   - `attributes`：逐项加，调 `clampAttrs`（A 提供；没提供就先本地按 config 钳制，之后再换成 A 的）。
   - `money`：直接加，**不钳制**（D-01）。
   - `flags`：写 `player.flags[key] = value`（`romance` 单独也写 `player.romance`）。
   - `club`：写 `player.club`。
   - 所有变更 push 到 `state.history`（通过 A 的 `pushHistory`；没有就先 `state.history.push`）。
2. **`economy.js`**
   - `settleMonthly(state, config)`：`money += monthlyIncome − monthlyExpense`，返回 `{ok, income, expense, net}`，写 log。
   - `applyExtraMoney(state, amount, reason)`：写 money + log，返回 `{ok, money}`。
   - `checkDebt(state, config)`：`money <= debtThreshold` 且距上次触发 ≥ `debtCooldownTurns` → `{triggered:true, eventId:'ev_fixed_debt'}`；同时记 `state.player.flags.lastDebtTurn`。
3. **`academy.js`**
   - `gradePoint(score, config)`：遍历 `balance.gpaTable`（降序），返回第一个 `score >= min` 的 `gpa`。
   - `runFinalExam(state, config, rng)`：对每门科目 `score = round(knowledge * (1 + (rng.next()*2-1) * fluctuation))`，夹 `[0,100]`；`passed = score >= passLine`；`failedCourses += 未通过门数`；写 `semesterRecords` 与 `semesterScores`；返回 `{ok, subjects:[{name,score,passed,gpa}], semesterGpa, totalGpa, failedThisSemester}`（`totalGpa` = 所有科目绩点平均，保留 2 位）。
   - `checkWarning(state, config)`：读 `warningFailedCourses`，首次触发写 `warning=true` + `warningTurn` + history。
   - `judgeThesis(state, config)`：`score = knowledge*thesis.knowledgeWeight + totalGpa*thesis.gpaWeight`，夹 0–100；`level = score>=85?'优秀':score>=passLine?'通过':'未通过'`；写 `academics.thesis`。
4. **单测** `tests/unit/b-economy.mjs`、`b-academy.mjs`：
   - rng 桩 `next()` 恒 0 → score = knowledge×0.9；恒 0.999999 → knowledge×1.1（取整后核对）。
   - `money=0`，一次 `settleMonthly` → 200。
   - `money=-1000`，两次 settle（−2000）→ `checkDebt` triggered=true；冷却期内再次不触发。
   - `gpaTable` 边界：90/85/84.9/82/60/59.9/0。
   - `failedCourses` 累计到 3 → warning=true；2 → false。
   - thesis：knowledge 30 / gpa 3.5 → score = 30 + 87.5 = 117.5 → 夹 100 → 优秀（若 A 把 gpaWeight 改成别的值，测试读 config 而非写死）。

**门禁**：`node tests/unit/b-economy.mjs && node tests/unit/b-academy.mjs` 全 PASS；`node tests/accept/w1.mjs` 全 PASS；`npm test` 不回归。

> 注意：`engine.advance` 里 `studyActions` 的清零归 A；你只负责读它。若发现 A 没清零，提 issue，别自己去 engine 改。

### W2 · 权重 + 前置条件 + 内容 v2

1. **`computeWeight(event, state, config)`**
   ```
   weight = event.weight
          × Π(tag.eventWeights[event.id] || 1)          // 三个标签相乘
          × (college.eventBias[event.id] || 1)          // 学院偏向
   termRange 外（turn < min 或 > max）→ 0
   ```
   权重 ≤0 不参与抽取。
2. **`rollEvent(state, config, rng)`**：按 `balance.randomEventBaseChance` 判定是否触发；触发则对权重 >0 的事件做轮盘赌（用 `rng.next()`，一次抽取）。
3. **`availableOptions(event, state, config)`**：逐条判 `requires`（`attribute` / `flag` / `moneyAtLeast` / `minTurn` / `maxTurn`），返回 `[{id, label, enabled, reason}]`，`reason` 用 `disabledHint` 或自动生成（"社交需 ≥10"）。
4. **`buildPending(event, state, config)`**：把 `availableOptions` 的结果写进 `pendingEvent.options`（含 `enabled/reason`），供 C 渲染置灰。
5. **`resolveEvent`**：调 `applyEffects`；`enabled === false` 的选项返回 `{ok:false, reason:'requirement'}`；写 `eventHistory` + history。
6. **内容**：`tags.json` 12 条全部填 `modifiers` + 2–4 个 `eventWeights`；`colleges.json` 8 条填 `eventBias`（每院 3–5 个事件，系数 0.8–1.5）；`actions.json` 每条加 `mainAttr`。

**门禁**：`accept/w2` 全 PASS（同种子同学院两次结果一致；同种子不同学院事件分布不同；前置不满足的选项 `enabled:false`）。

### W3 · 内容与履历

1. `events.json`：
   - `fixed`：`ev_fixed_club_recruit`（termRange 1–3，`code:"CLUB"`）、`ev_fixed_thesis`（termRange 37–39，`code:"THESIS"`）、新增 `ev_fixed_debt`（负债，`code:"DEBT"`，type:"debt"）。
   - `random`：22 条，覆盖食堂/社团/竞赛/实习/恋爱/挂科/兼职/生病/讲座/宿舍/奖学金/运动会/考试周/毕业季…每条 2–3 选项，至少 5 条带 `requires`，至少 6 条带 `flags`（`romance`、`club`、`scholarship`、`competition`、`intern`）。
2. 固定事件必须有 2–3 个选项，后果包含 `money`/`flags`/`club`，而不只是加属性。
3. `judgeThesis` 的等级写进 `state.academics.thesis` 并 push history。
4. 写 `tests/unit/b-events.mjs`：权重修正（标签前后比值）、termRange 过滤、前置条件、flags 写入、负债事件只触发一次。

**门禁**：`accept/w3` 全 PASS；`node -e` 逐条校验 24 条事件 id 唯一、选项 ≥2、引用的 tag/college id 都存在（D 的 schema 也会查）。

### W4 · 数值模拟与平衡

1. `tools/sim.mjs`：`node tools/sim.mjs --runs 1000 --strategy balanced|study|social`，用 `loadConfig(reader)` 读本地 JSON（注入 reader，不用 fetch），跑满 40 回合（每回合 4 次行动，策略固定），统计：
   - 结局分布（6 类占比）、平均最终属性、平均绩点、挂科率、负债触发率、随机事件触发率（应在 30–40%）。
2. 目标分布：保研 10–15%、留学 ~10%、就业 ~30%、结婚 ~10%、普通毕业 ~30%、延毕 5–10%。偏离就调 `endings.json` 阈值与 `balance` 参数（**只调配置，不改代码逻辑**）。
3. 输出 `docs/平衡报告.md`：一张分布表 + 三条结论 + 你调过的参数与前后对比。

**门禁**：`node tools/sim.mjs --runs 1000` 跑完 ≤30s，分布落在目标区间 ±5pp；`accept/w4` 里 A 抽测 3 个种子。

### W5 · 冻结

1. 数值冻结：`config/*.json` 只允许改文案，不再改数值；打 `balance-v2.0` 标签。
2. 答辩规则讲解稿：考试公式、绩点换算、权重公式各一段 + 一个例子（举"学霸标签让突击测验概率 ×1.5"）。

---

## 3. 自测命令

```bash
node tests/unit/b-economy.mjs
node tests/unit/b-academy.mjs
node tests/unit/b-events.mjs
node tests/accept/w1.mjs
node tools/sim.mjs --runs 1000
npm test
```

---

## 4. 常见翻车点

1. **在 engine 里写规则**：一发现 engine 没调你的函数就自己去改 engine → 下周 A 合并冲突。**只提 issue**。
2. **测试里写死数值**：`expect(score).toBe(18)` 这种，配置一调就红。测试要读 config 算期望值。
3. **rng 用错**：`chance()` 与 `next()` 混用导致抽取序列不可复现。一次抽取只用一次 `next()`。
4. **权重归一化写错**：轮盘赌要在 `[0, totalWeight)` 上取，别先除以 total 再乘。
5. **事件效果写 `money` 又写 `attributes.money`**：v2 只有 `effects.money` 作用于货币，`attributes.money` 是初始资金档，两者不要混。
6. **改 events 结构不通知 D**：D 的 schema 会红，CI 会挂，全组等你。

---

## 5. AI 提示词

### 5.1 系统提示词（每次新对话先贴）

```text
你是 SCUSim 项目的「B · 经济/学业/事件」规则工程师。项目是配置驱动的回合制文字养成 Web 游戏，仓库 D:\My_projects\SCUSim（GitHub lingtang1003/SCUSim）。

【技术栈】原生 ES2020 ES Modules；无框架/无打包/无第三方依赖；`node server.js` 起 5173；测试是纯 Node 脚本。
【玩法基线】40 回合（1 回合=1 月，5 回合一学期）；每回合 4 行动点；开局 20 点分配；12 标签刷 6 选 3；8 学院；6 行动；固定事件 2 + 随机 ≥14；6 结局（保研/留学/就业/结婚/普通毕业/延毕）；随机事件基础 35%；挂科累计 ≥3 学业警告；期末 4 门 = 学识×(1±10%)；绩点查 gpaTable。
【你的文件（只能改这些）】src/core/economy.js、academy.js、effects.js（可新建）、src/events/eventManager.js、config/{actions,events,tags,colleges}.json 的内容与数值、tools/sim.mjs（可新建）、tests/unit/b-*.mjs（可新建）。
【绝对不能改】src/core/{rng,state,engine,ending}.js、src/main.js（A）；src/ui/**、index.html、css/**（C）；src/config/**、src/storage/**、tests/**（除 tests/unit/b-*）、package.json、README.md（D）。
【红线】1) 禁 DOM/localStorage/IndexedDB/window/Math.random（随机只用入参 rng）；2) 数值全来自 config，不硬编码；3) 不改函数签名（要改先告诉我要什么签名）；4) 不删改他人测试；5) 必须真实运行测试并贴输出，不编造。
【接口】函数就地修改 state，返回 {ok,...}；属性/货币/flags 的写入统一走 effects.applyEffects。
【工作方式】先读 docs/CONTRACT.md 和你要改的文件，先输出计划（改哪些文件、每个文件改什么、怎么测），我确认后再写。
【输出格式】①改动清单（文件:行号）②公式与关键实现 ③自测命令 + 真实输出 ④未覆盖/风险 ⑤需要 A/D 拍板的问题。
```

### 5.2 W1 · 经济 + 学业提示词

```text
【任务 B-W1｜经济与学业闭环】
先读 docs/CONTRACT.md、docs/团队分工与验收手册.md §2.2、src/core/economy.js、src/core/academy.js、src/core/engine.js（只读，别改）、config/balance.json。
实现：
1. 新建 src/core/effects.js：applyEffects(state, effects, ctx) -> {ok, changes[]}，支持 attributes（逐项加，调用 ctx.clampAttrs 或按 config.attributeClamp 钳制，money 为 null 不钳制）、money（直接加，可为负）、flags（写 player.flags 与 player.romance）、club（写 player.club）；每次变更写入 state.history（超过 historyLimit 截断）。
2. economy.js：settleMonthly(state, config) -> {ok,income,expense,net}；applyExtraMoney(state, amount, reason)；checkDebt(state, config) -> {triggered, eventId}（money <= debtThreshold 且距上次触发 >= debtCooldownTurns，事件 id 取 config.events 里的负债固定事件）。
3. academy.js：gradePoint(score, config) 查 balance.gpaTable；runFinalExam(state, config, rng) 每门 score = round(knowledge * (1 + (rng.next()*2-1) * exam.fluctuation))，夹 [0,100]，passed = score >= passLine，failedCourses += 未通过门数，写 semesterRecords/semesterScores，返回 {ok, subjects, semesterGpa, totalGpa, failedThisSemester}；checkWarning(state, config) 读 balance.warningFailedCourses；judgeThesis(state, config) 按 balance.thesis 计算等级并写 academics.thesis。
4. 写 tests/unit/b-economy.mjs 与 tests/unit/b-academy.mjs，覆盖：rng 恒 0/恒 0.999999 时成绩落在 0.9×/1.1× 上下界；money 0→200；负债触发与冷却；gpaTable 边界 90/85/84.9/60/59.9；挂科 2 vs 3；thesis 等级。
约束：不改 engine/state/ending/main；不改配置字段结构（用 docs/CONTRACT.md 里已有的字段，缺字段就告诉我要加什么）。
最后贴 `node tests/unit/b-economy.mjs`、`node tests/unit/b-academy.mjs`、`node tests/accept/w1.mjs`、`npm test` 的真实输出。
```

### 5.3 W2 · 权重与前置条件提示词

```text
【任务 B-W2｜事件权重、选项前置、内容 v2】
先读 docs/CONTRACT.md §2.2（events/tags/colleges/actions 结构）、src/events/eventManager.js、config/{events,tags,colleges,actions}.json。
实现：
1. computeWeight(event, state, config)：weight × Π(标签 eventWeights) × 学院 eventBias；turn 不在 termRange 内返回 0；任何系数缺失按 1。
2. rollEvent(state, config, rng)：按 randomEventBaseChance 判定；再在权重 >0 的事件上做一次轮盘赌（只调用一次 rng.next()）。
3. availableOptions(event, state, config)：逐条判 requires（attribute/flag/moneyAtLeast/minTurn/maxTurn），返回 [{id,label,enabled,reason}]，reason 优先用 disabledHint。
4. buildPending(event, state, config)：把 availableOptions 结果写进 pendingEvent.options；resolveEvent 遇到 enabled=false 返回 {ok:false, reason:'requirement'}。
5. 内容：tags.json 12 条全部填 modifiers（2–3 项，含至少一项负向）与 2–4 个 eventWeights；colleges.json 8 条填 eventBias（3–5 个事件，0.8–1.5）；actions.json 每条加 mainAttr（必须是正向 effects 里最主要的那个属性）。
6. 写 tests/unit/b-events.mjs：同种子两次权重一致；学霸标签让 ev_r02 权重 ×1.5；termRange 外为 0；社交 8 时表白选项 enabled=false 且 reason 含「10」。
约束：不改 engine（它调用你）；不改 tags/colleges/events 的字段结构。
最后贴 `node tests/unit/b-events.mjs`、`node tests/accept/w2.mjs`、`npm test` 的真实输出。
```

### 5.4 W3 · 事件内容提示词

```text
【任务 B-W3｜24 条事件内容 + 履历 flags + 固定事件 v2】
先读 docs/CONTRACT.md、config/events.json 现状、src/core/effects.js。
要求：
1. fixed 三条：ev_fixed_club_recruit（code:"CLUB"，trigger termRange 1–3）、ev_fixed_thesis（code:"THESIS"，termRange 37–39）、ev_fixed_debt（code:"DEBT"，type:"debt"）；每条 2–3 选项，效果含 money/flags/club，不只是属性。
2. random 22 条：每条 id/name/type/weight/termRange/text/2–3 options；至少 5 条带 requires（如社交≥10、money≥500、flags.romance=='none'）；至少 6 条写 flags（romance/club/scholarship/competition/intern）；至少 4 条川大特色（江安/华西/望江/青广/图书馆/运动会）。
3. 文案统一第二人称、每条 ≤60 字；选项 label ≤8 字；resultText ≤40 字。
4. 写 tests/unit/b-content.mjs：id 唯一、每条选项 ≥2、requires 引用合法、flags 键在允许集合内、termRange 有序。
5. 输出一份「事件清单.md」到 docs/（表：id/名称/权重/学期窗口/选项数/前置/flag），方便答辩展示内容量。
约束：只改 config/events.json 内容与 tests/unit/b-content.mjs。
最后贴 `node tests/unit/b-content.mjs`、`node tests/accept/w3.mjs` 的真实输出。
```

### 5.5 W4 · 数值模拟提示词

```text
【任务 B-W4｜1000 局数值模拟与阈值反调】
先读 src/core/{engine,rng,state}.js、src/config/loader.js（loadConfig 支持注入 reader）、config/*.json。
实现 tools/sim.mjs：
1. 用注入 reader 从本地 config/ 读六份 JSON（不用 fetch），import engine 与 createRng。
2. 参数 --runs（默认 1000）、--strategy balanced|study|social|random。
3. 每局：newGame（固定种子 i）→ 每回合按策略执行 4 次 doAction → advance → 遇到 pendingEvent 用策略选第一个可用选项 → 直到 endingId。
4. 统计并输出：6 类结局占比、平均最终四属性、平均总绩点、挂科率、负债触发率、随机事件触发率（目标 30–40%）、平均通关耗时。
5. 若某结局占比为 0，打印该结局的 condition 与最接近的 state，方便反调。
目标分布：保研 10–15%、留学 ~10%、就业 ~30%、结婚 ~10%、普通 30%、延毕 5–10%。
调整只允许改 config（endings 阈值 / balance 参数），不改代码逻辑。
输出：控制台表格 + docs/平衡报告.md（分布表 + 调整前后对比 + 结论）。
最后贴 `node tools/sim.mjs --runs 1000` 的真实输出（表格），并说明你改了哪些配置项、为什么。
```

### 5.6 返工提示词

```text
【返工｜PR #<编号>】
A 的验收结论：❌ 退回。必改项：
1) <问题> —— 期望 <…>，实际 <…>，复现 <命令>
2) …
只修这三条；修完跑 <命令> 贴完整输出；不要顺手改 engine/UI/其他人的文件。
```

---

## 6. 你每周必须贴给 A 的三样东西

1. `tests/unit/b-*.mjs` 的完整输出（不是"通过"三个字）。
2. 你改了哪些配置项（diff 摘要），因为数值变化会影响 A 的验收和 C 的显示。
3. 一句话风险：这周哪个规则是"我猜的"，等谁拍板。
