# A · 核心引擎与集成负责人 · 任务书

> 你 = 组长 + 集成负责人 + 契约 Owner + 周验收主持 + 发布人。
> 你的产出不是"写最多代码"，而是**让别人能并行、让每周有可验收的东西、让 main 永远能演示**。
> 配套阅读：`docs/团队分工与验收手册.md`（下称《手册》）第 2 章（契约）、第 5 章（验收 SOP）。

---

## 1. 你的边界

### 1.1 你能改（白名单）

| 文件 | 说明 |
|---|---|
| `src/core/rng.js` | 随机唯一入口，**尽量不动**（动了要通知全员） |
| `src/core/state.js` | GameState 工厂、`clampAttrs`、`pushHistory` |
| `src/core/engine.js` | 回合/行动/事件/结局编排（唯一调用 B 的规则模块的地方） |
| `src/core/ending.js` | 条件求值 + 优先级判定 |
| `src/main.js` | 唯一串联 config+engine+storage+ui 的协调层 |
| `docs/CONTRACT.md`、`docs/验收/**`、`docs/分工/**` | 契约、验收记录、任务书 |

### 1.2 你不能改

- B：`economy.js` `academy.js` `effects.js` `eventManager.js`、`config/{actions,events,tags,colleges}.json` 的**内容与数值**。
- C：`index.html` `css/**` `ui.js` `dev/ui-lab.html`。
- D：`loader.js` `schema.js` `storage.js` `tests/accept/**` `tests/fixtures/**` `tests/support/**` `tests/smoke.mjs` `package.json` `README.md` `.github/**`（`tests/unit/a-*.mjs` 是你自己的单测）。

需要改别人文件 → 在 issue 里写清"为什么必须改、影响谁"，让对应人改；**永远不要"顺手帮他改了"**，这是四人协作崩溃的最主要原因。

### 1.3 你的交付物（按周）

| 周 | 交付物 | 验收人 |
|---|---|---|
| W0 | `docs/CONTRACT.md`（含 12 项决策签字页）+ 验收模板 + 分支保护 | B/C/D approve |
| W1 | 引擎接入经济/学业 + 钳制 + 三档 + 健康约束 + pending 阻断 + `?dev=1` 面板 + `tests/unit/a-engine.mjs` | B 交叉验 |
| W2 | `drawTagCandidates` / 标签修正 / 学院偏向注入 / 事件队列 / `buildViewModel` | C 交叉验 |
| W3 | 结局条件引擎（all/any/7 类型）+ 优先级方向 + 副结局 + 图鉴记录 | D 交叉验 |
| W4 | `main.js` 集成 IDB/迁移/错误页/弹窗队列/继续游戏恢复 pending | C 交叉验 |
| W5 | `v2.0.0` release + 验收总报告 + 技术答辩稿 | 全员 |

---

## 2. 六周任务卡

### W0 · 契约与盘点（你主导，半天到一天）

**目标**：让 B/C/D 下周能真的并行。

1. 写 `docs/CONTRACT.md`：把《手册》§2.1–§2.6 抄进去并补上"决策签字"表。
2. 在群里发起三项决策投票（D-01 金钱语义 / D-02 优先级方向 / D-03 健康阈值），把结论写进 CONTRACT，同时让 D 回写 `DATA_DICTIONARY.md`、`INTERFACES.md`。
3. 建三个分支保护：`main`、`dev` 需要 PR + CI 绿；`feat/*` 自由。
4. 建 issue 标签：`P0/P1/P2`、`契约变更`、`验收退回`、`docs`。
5. 确认 D 建的验收看板 `docs/验收/README.md`（6 周 × 4 人表格 + 每周门禁命令），你只负责每周打勾。
6. 确认 D 的 CI 能在 PR 上跑 `npm test`（这是你后面所有验收的前提）。

**W0 结束判据**：`CONTRACT.md` 有 4 个 approve；`npm test` 在 CI 上绿；`docs/验收/README.md` 存在。

### W1 · 引擎接入（最重的一周）

**目标**：让 B 写的规则真正进入主流程，让 C 有结算数据可显示。

1. `state.js`
   - `createGameState` 增加 v2 字段（见《手册》§2.3）：`player.club/romance/flags`、`academics.semesterRecords/totalGpa/thesis/warningTurn/studyActionsBySemester`、`history`。
   - `clampAttrs(state, config)`：按 `balance.attributeClamp` 钳制；`money` 为 `null` 时**不钳制**（D-01）。
   - `pushHistory(state, entry, config)`：结构化履历，超 `historyLimit` 从头截断。
2. `engine.js`
   - `newGame`：按 `walletPerMoneyPoint` 计算初始 money（D-01）；标签修正放到 W2（等 B 的 `applyEffects` 和标签内容就绪）。
   - `doAction`：三档加成（D-04，加在 `mainAttr` 上）、健康 <3 只允许锻炼/休息（D-03）、健康 <5 学习惩罚、`pendingEvent` 存在时拒绝（返回 `{ok:false, reason:'pending_event'}`）、结算后 `clampAttrs`。
   - `advance`：顺序改为 `学期重置 studyActions → settleMonthly → checkDebt（触发则排负债事件）→ 期末 runFinalExam/gradePoint/checkWarning → 固定事件 → 随机事件 → 终局判定`；`settlement` 返回完整考试数据给 UI。
   - `resolvePendingEvent`：应用 `effects`（含 money/flags/club），写 `eventHistory` + `history`，清空 pending。
   - `buildViewModel(state, config)`：给 C 的只读快照（availability、actions、tierInfo、flags、tagCandidates）。
3. `ending.js`：先按 D-02 把排序改为**从小到大**，条件类型扩展预留（W3 做全）。
4. `ending.js` / 测试：`tests/unit/a-engine.mjs` 覆盖
   - 三档边界：属性 9/10/19/20 时 `study` 的 knowledge 增量；
   - 健康 0/2/3/4/5 时各行动可用性与学习惩罚；
   - `pendingEvent` 阻断；
   - AP=0 拒绝且 state 不变；
   - 固定种子 40 回合不抛错、`turn` 停在 40、`endingId` 非空、同种子两次完全一致。
5. `?dev=1` 调试面板（只在 URL 带 `dev=1` 时渲染）：设置四项属性/money/turn/清档/直接加事件。**这是 A 每周手测第 3/6 项的前提**。
6. `main.js`：把 `settlement` 传给 `app.showExam?.(settlement)`（C 在 W1 提供；未提供时降级 `showToast`，别崩）。

**门禁**：`node tests/unit/a-engine.mjs` 全 PASS；`node tests/accept/w1.mjs` 全 PASS；`npm test` 不回归；预览站手测第 3/4/6 项通过。

### W2 · 开局 / 标签 / 学院 / 事件队列

1. `drawTagCandidates(config, rng)`：从 `tags.list` 洗牌取 6 个不重复 id（用 `rng`，禁 `Math.random`）。
2. `newGame` 里应用标签修正：三标签 `modifiers` 累加，结果逐项 `max(0, …)`（SRS 1.4 下限 0），再 `clampAttrs`。
3. 学院偏向：把 `colleges.list[i].eventBias` 作为参数传给 B 的 `computeWeight`（B 负责读，你负责传 `state.player.collegeId` 的上下文——按 W2 契约，`computeWeight(event, state, config)` 自己读，你只需保证 state 里有 collegeId）。
4. 事件队列（D-10）：固定 > 负债 > 随机，同刻至多 1 个；`enterTurn` 里把三个来源合成一个 `pickNextEvent`。
5. `buildViewModel` 补齐 `tierInfo`（当前属性对应档位与 +N 提示）与 `flags`（社团/恋爱/警告）。
6. `main.js`：`onRerollTags()` 调 `drawTagCandidates` 并用 `app.renderCreation({tagCandidates})` 重绘。

**门禁**：`accept/w2` 全 PASS（同种子不同学院 → 事件分布差异；标签修正生效；候选恰好 6 个）。

### W3 · 结局体系 + 履历

1. `ending.js` 重写为 `evaluateCondition(cond, state, config)` 递归求值，支持 `attributeAtLeast / gpaAtLeast / warningTrue(可 negate) / flagEquals / tagIncludes / collegeIs / eventDone / all / any / default`。
2. `judgeEnding(state, config) -> {main, subs[]}`：按 priority 升序取第一条命中为主结局，其余命中记录为副结局（SRS 6.1）。
3. 学业警告的负面修正（G10）：`warning === true` 时屏蔽保研/留学（条件里用 `warningTrue negate` 表达，而不是写死在代码里——保持配置驱动）。
4. 结局写入 `state.endingId` + `history`，`main` 里 `unlockEnding(main)` 并同时解锁副结局。
5. `tests/unit/a-ending.mjs`：6 个结局各构造一个 state 验证可达；优先级方向（两条同时命中取小值）；`all/any` 嵌套；未知 type 不命中且 `console.warn`。

**门禁**：`accept/w3` 全 PASS；6 个结局在预览站都能跑到（用 dev 面板构造）。

### W4 · main 集成（存储、恢复、错误）

1. `main.js`：
   - 启动：`loadConfig` 失败 → `app.showError` 全屏错误页（不是白屏、不是 console）。
   - `onLoadGame`：读档后若 `state.pendingEvent` 非空，**先弹事件再渲染**（G34）。
   - 自动存档时机：每次行动、每次事件结算、每次考试结算、每次导入后。
   - 弹窗队列：学期结算 → 事件 → 结局，依次弹，不互相覆盖。
   - `onExport` 用 `storage.exportSaveFile`，失败 toast。
   - `?dev=1` 面板在正式站不可见。
2. 迁移：`storage.migrateSave` 返回不兼容时，`main` 弹"存档版本不兼容，请从主菜单开始新游戏或导入备份"，**不覆盖**原存档。
3. 性能自测：`tests/accept/w4.mjs` 打印 启动/回合/存档 耗时（需求：启动 ≤3s、回合 ≤500ms、存档 ≤1s；本机应远低于）。

**门禁**：生产站 40 回合通关；刷新继续；导出/导入；坏档不覆盖；错误页可见。

### W5 · 发布与答辩

1. `package.json` 版本 → `2.0.0`；`SAVE_VERSION` 与 `CONFIG version` 对齐；打 tag `v2.0.0`。
2. 写 `docs/验收/总报告.md`：18 项 RTM 状态 + 6 结局可达性 + 性能实测 + 遗留问题。
3. 技术答辩稿：架构图、配置驱动怎么体现（举 1 个"加一个事件不改代码"的例子）、随机复现怎么保证、错误处理矩阵。
4. 演示动线彩排 3 遍（同一台机器 + Chrome）。

---

## 3. 自测命令

```bash
node server.js                              # 本地
node tests/unit/a-engine.mjs                # 你的引擎单测
node tests/unit/a-ending.mjs                # 结局单测
node tests/accept/w1.mjs                    # 门禁（D 提供）
npm test                                    # 全局回归
```

---

## 4. 常见翻车点

1. **把 B 的规则写进 engine**：加成一算就顺手写在 `doAction` 里 → 下周 B 改规则你要改两处。规则一律放 B 的模块，engine 只编排。
2. **忘了 `rngState` 回写**：每个改随机状态的函数末尾都要 `state.rngState = rng.getState()`，否则读档不可复现。
3. **`main.js` 里直接改 state**：`main` 只调 engine，不碰字段。
4. **先合并再验收**：`main` 一乱，周日的演示就没了。永远 `feat → dev → 验收 → main`。
5. **契约写得太细**：契约只定"字段名/签名/返回结构"，实现细节留给各人，否则你每周都在改契约。

---

## 5. AI 提示词

### 5.1 系统提示词（每次新对话先贴）

```text
你是 SCUSim 项目的「A · 核心引擎与集成」工程师，向组长负责。项目是配置驱动的回合制文字养成 Web 游戏，仓库 D:\My_projects\SCUSim（GitHub lingtang1003/SCUSim，main 已部署到 Cloudflare Pages）。

【技术栈】原生 ES2020 ES Modules；无框架、无打包、无第三方依赖；本地 `node server.js` → http://localhost:5173；测试是纯 Node 脚本（`npm test` = tests/smoke.mjs + tests/verify_ui.mjs）。

【玩法基线】40 回合（1 回合=1 月，5 回合一学期）；每回合 4 行动点；开局 20 点分配到学识/社交/健康/金钱；12 标签随机刷 6 选 3；8 学院；6 行动；固定事件 2 + 随机事件 ≥14；6 结局（保研/留学/就业/结婚/普通毕业/延毕）；随机事件基础概率 35%；挂科累计 ≥3 学业警告；期末 4 门 = 学识×(1±10%)；绩点查 balance.gpaTable。

【你的文件（只能改这些）】src/core/rng.js、state.js、engine.js、ending.js、src/main.js、docs/CONTRACT.md、docs/验收/**。
【绝对不能改】src/core/{economy,academy,effects}.js、src/events/**、config/*.json 的内容数值（B）；index.html、css/**、src/ui/**、dev/**（C）；src/config/**、src/storage/**、tests/accept/**、tests/fixtures/**、tests/smoke.mjs、package.json、README.md、.github/**（D）；你自己的单测写在 tests/unit/a-*.mjs。
【红线】1) core/events 禁 DOM/localStorage/IndexedDB/window/Math.random；2) 数值全部来自 config，不硬编码；3) 接口签名变更必须同 PR 改 docs/CONTRACT.md；4) 不删改他人测试；5) 不伪造测试输出。
【工作方式】先读 docs/CONTRACT.md 和你要改的文件，先输出「计划：要改哪些文件、每个文件改什么、怎么测」，我确认后再写代码。
【输出格式】①改动清单（文件:行号）②关键实现与公式 ③自测命令 + 真实输出 ④未覆盖/风险 ⑤需要我拍板的问题。
```

### 5.2 W0 · 契约冻结提示词

```text
【任务 A-W0｜冻结契约 v2】
请阅读 docs/团队分工与验收手册.md 第 2 章与 docs/INTERFACES.md、docs/DATA_DICTIONARY.md、src/core/engine.js、src/core/ending.js、src/main.js，然后生成 docs/CONTRACT.md，要求：
1. 逐条包含：文件所有权表（含禁区）、六张配置表的 v2 字段契约、GameState v2 字段、接口签名表、12 项决策表（编号/决策/结论/落地人）、版本与迁移策略、红线清单。
2. 决策 D-01（金钱=货币，不参与 0-99 钳制，开局 money=分配点数×200）、D-02（结局 priority 越小越高，普通毕业 warning===false，延毕 default）、D-03（健康<3 只能锻炼/休息）按手册建议写死，并标注「A 已于 W0 拍板」。
3. 每个配置字段给出 JSON 片段（可直接粘到 config 里）+ 谁读它（哪个函数）。
4. 接口表要能和现有代码对上：现有但保留的签名标「保留」，新增标「新增」，变更标「变更（原签名→新签名）」。
5. 最后给一个「本周需要 D 回写的文档」清单（DATA_DICTIONARY/INTERFACES/README 各改哪几处）。
只输出文档内容，不要改任何代码。
```

### 5.3 W1 · 引擎接入提示词

```text
【任务 A-W1｜引擎接入经济/学业 + 行动规则】
先读 docs/CONTRACT.md、src/core/{engine,state,ending}.js、src/core/{economy,academy}.js、src/events/eventManager.js、src/main.js。
按以下顺序实现，每步先说明改动点再写代码：
1. state.js：createGameState 补 v2 字段（player.club/romance/flags；academics.semesterRecords/totalGpa/thesis/warningTurn/studyActionsBySemester；history）；实现 clampAttrs(state,config)（按 balance.attributeClamp，money 为 null 时不钳制）与 pushHistory(state,entry,config)（环形 ≤ historyLimit）。
2. engine.js doAction：三档加成（属性 <10 +0 / 10–19 +1 / ≥20 +2，只加 action.mainAttr，不加负向效果）；健康 <3 时除 exercise/rest 外返回 {ok:false, reason:'health'}；健康 <5 执行 study 时 knowledge 增量改为 0，并有 studyPenalty.dropChance 概率再 −1（用 rng）；存在 state.pendingEvent 时返回 {ok:false, reason:'pending_event'}；结算后 clampAttrs + 回写 state.rngState。
3. engine.js advance：顺序 = 学期重置 studyActions 与 studyActionsBySemester → settleMonthly → checkDebt（触发则把负债事件放进队列）→ examTurns 命中则 runFinalExam + gradePoint + checkWarning → 固定事件 → 随机事件 → turn>=turns 时 judgeEnding 写 endingId；返回 settlement={semester, turn, subjects, semesterGpa, totalGpa, failedCourses, warning}。
4. ending.js：把排序改为 priority 升序（D-02），条件类型先保留现有三种并在注释标注 W3 扩展。
5. main.js：把 res.settlement 传给 app.showExam?.(settlement)（没有该方法时 showToast 降级）；?dev=1 时渲染调试面板（改四项属性/money/turn、清档、强制触发事件）。
6. 写 tests/unit/a-engine.mjs（Node，直接 import core，构造 config 用 tests/fixtures/config.v2.json 或 fs 读 config/*.json）：覆盖三档边界 9/10/19/20、健康 0/2/3/4/5、pending 阻断、AP=0 不变、固定种子 40 回合、同种子两次一致。
约束：不得修改 economy/academy/effects/eventManager（那是 B 的文件），需要新函数就在 engine 里调用现有签名；若现有签名不够，先告诉我要什么签名，不要自己改 B 的文件。
最后贴出 `node tests/unit/a-engine.mjs` 与 `npm test` 的真实输出。
```

### 5.4 W4 · main 集成提示词

```text
【任务 A-W4｜main.js 集成 IndexedDB / 恢复 / 错误页 / 弹窗队列】
先读 src/main.js、src/storage/storage.js（D 已升级 v2：saveGame(state,slot?)、loadGame(slot?)、listSaves、migrateSave、失败返回 ok:false）、src/ui/ui.js 的公开方法。
实现：
1. 启动流程：loadConfig 失败 → app.showError(可读文案 + 缺失文件名)，不白屏；成功 → mount 主菜单（有存档时"继续游戏"可用）。
2. onLoadGame：读档成功后若 state.pendingEvent 非空，先 showEvent 再 render；若 migrateSave 返回不兼容，提示并保留原档。
3. 弹窗队列：用一个数组排队 {type:'exam'|'event'|'ending', payload}，逐个 show，关闭后再出下一个；同一时刻最多一个 overlay。
4. 自动存档：onAction、onResolveEvent、onAdvance 的考试结算后、onImport 后各调一次 saveGame，失败要 toast（不能静默）。
5. ?dev=1 面板：只在 location.search 含 dev=1 时渲染；正式访问不出现。
6. tests/unit/a-main.mjs 用现有 verify_ui 的 DOM 桩思路，覆盖：读档带 pendingEvent 时先弹事件、弹窗队列顺序、saveGame 失败时 toast 文案。
最后贴 `node tests/unit/a-main.mjs`、`node tests/accept/w4.mjs`、`npm test` 的真实输出。
```

### 5.5 审 PR 助手提示词（你每周五用）

```text
你是 SCUSim 的代码审查助手。我会给你：①本周门禁清单 ②PR 的 diff ③该成员的文件白名单。
请逐项输出检查结果，不要客气：
1. 范围：是否只改了白名单文件？有没有夹带无关改动（整文件格式化、改他人测试）？
2. 红线：diff 里是否出现 Math.random / localStorage / indexedDB / document / window.（core、events、config 层）？
3. 硬编码：是否把 2000/1800/-3000/0.10/0.35/3 这类数值写进代码而不是读 config？
4. 契约：函数签名是否变化？变了是否同 PR 改了 docs/CONTRACT.md？
5. 测试覆盖：新增分支是否有对应用例？列出缺少的用例（具体到输入与期望）。
6. 结论：✅通过 / 🟡有条件通过 / ❌退回，并给 ≤3 条必改（每条含文件:行号 + 怎么改 + 怎么验）。
```

### 5.6 被退回后的返工提示词

```text
【返工｜PR #<编号>】
A 的验收结论：❌ 退回。必改项：
1) <问题> —— 期望：<…>；实际：<…>；复现：<命令/步骤>
2) …
请只修这三条，不要顺手重构其他代码；修完重新跑 <命令> 并贴完整输出；在 PR 里逐条回复"已修复 + 证据"。
```

---

## 6. 你每周必做的三件小事

1. **周日 22:00 发版**：`dev → main`，确认 Pages 生产站能打开、`/config/balance.json` 返回 200，群里发一句"W<N> 已上线 + 预览/生产 URL"。
2. **周一 20:00 发任务卡**：只发本周要做的 3–5 条，附验收命令，不写长篇。
3. **周五 10:00 预验收**：宁可周五退回，也不要周日才发现。
