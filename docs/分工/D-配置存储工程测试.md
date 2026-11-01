# D · 配置 / 存储 / 工程 / 测试负责人 · 任务书

> 你是"让一切可验证"的人：配置契约的守门人、存档的唯一实现者、CI 与验收脚本的作者、文档与部署的把关人。
> 你不写游戏规则（B 写），也不写界面（C 写），但**每个人能不能被验收，取决于你**。
> 配套阅读：`docs/团队分工与验收手册.md`（下称《手册》）§2.2 配置契约、§5 A 的验收 SOP、§6 部署。

---

## 1. 你的边界

### 1.1 你能改（白名单）

| 文件 | 说明 |
|---|---|
| `src/config/loader.js` `schema.js` | 配置加载（改 `Promise.all`）与 v2 校验 |
| `src/storage/storage.js` | IndexedDB 主用 + LocalStorage 降级 + 配额 + 迁移 |
| `config/*.json` 的**结构** | 新增字段先由你加 schema，再让 B 填内容 |
| `tests/accept/**` `tests/fixtures/**` `tests/support/**` `tests/smoke.mjs` `tests/verify_m1.mjs` `tests/verify_ui.mjs` | 门禁脚本、夹具、桩、全局回归 |
| `tests/unit/d-*.mjs` | 你自己的单测（`b-*` 是 B 的、`c-ui.mjs` 是 C 的、`a-*` 是 A 的，别动） |
| `package.json` `server.js` `README.md` `.github/workflows/*` `_headers` | 工程与部署 |
| `docs/`（除 `CONTRACT.md`、`验收/**`、`分工/**`） | 数据字典、接口文档、设计补章 |

### 1.2 你不能改

- A：`src/core/**` `src/main.js` `docs/CONTRACT.md`。
- B：`src/core/{economy,academy,effects}.js` `src/events/**` `tools/sim.mjs` `config/*.json` 内容。
- C：`index.html` `css/**` `src/ui/**` `dev/**`。

> 你要改别人的文件 → 提 issue。特别是**不要为了让测试绿去改 engine 的行为**——那是 A 的决策。

### 1.3 你的交付物（按周）

| 周 | 交付物 |
|---|---|
| W0 | GitHub Actions（PR 跑 `npm test`）+ PR/issue 模板 + `tests/fixtures/` + README 分工修正 + 验收看板 |
| W1 | `schema.js` v2 + `tests/accept/w1.mjs`（**先红**）+ 坏配置负向用例 ≥15 条 |
| W2 | 交叉引用校验（tag/college/event/ending）+ `accept/w2` + loader 并行 + 负向用例累计 ≥30 |
| W3 | `endings.json` v2（SRS 6 结局）+ `accept/w3` + 结局可达性矩阵 |
| W4 | storage v2（IDB+降级+配额+迁移）+ `fake-idb` + E2E + 性能脚本 + `_headers` |
| W5 | README/设计 6–8 章补齐 + RTM 更新 + 部署复核 + 交付检查表 |

---

## 2. 六周任务卡

### W0 · 先把"可验收"搭起来（半天）

1. **CI**：`.github/workflows/test.yml`，`on: pull_request`，Node 18，`npm test`；PR 保护勾选"必须通过检查"。
2. **PR 模板** `.github/pull_request_template.md`：
   ```
   ## 本周任务卡编号
   - [ ] 只改了白名单文件
   - [ ] 契约未变（或已带 [契约变更] 标签并更新 CONTRACT.md）
   ## 改动
   ## 自测
   <命令 + 真实输出>
   ## 截图/预览 URL
   ## 遗留 / 风险
   ```
3. **issue 模板**：`bug`（现象/复现/期望/实际/环境）、`契约变更`（为什么必须改/影响谁）、`验收退回`（必改 1-2-3）。
4. **fixtures**：`tests/fixtures/state.v2.json`（按《手册》§2.3 造一个 turn=12 的中局，含 pendingEvent、history、semesterRecords），`tests/fixtures/state.end.json`（即将结局）。C 靠它做 ui-lab。
5. **README 修正**（G38）：把 §5 分工改成课程 A/B/C/D；把 §8「已知占位」重写为 v2 目标与状态；加在线 URL 与预览 URL 说明。
6. **验收看板** `docs/验收/README.md`：6 周 × 4 人表格，列出每周门禁命令。

**W0 判据**：随便提一个 PR，CI 自动跑起来并有结果；fixtures 能被 C 的 ui-lab 读取。

### W1 · schema v2 + 先红脚本

1. `schema.js` v2 校验（对照《手册》§2.2）：
   - `balance`：`monthlyIncome/monthlyExpense/debtThreshold/debtCooldownTurns/walletPerMoneyPoint/tierBonus/exam.subjects/fluctuation/passLine/gpaTable/thesis/studyPenalty/attributeClamp/historyLimit/logLimit` 必须存在且类型正确；`gpaTable` 必须按 `min` 降序且含 `min:0`。
   - `tags`：每条必须 `modifiers` 非空、键 ∈ attributeKeys、`eventWeights` 的 id 必须存在于 events。
   - `colleges`：每条 `eventBias` 的 id 必须存在于 events。
   - `actions`：每条 `mainAttr` ∈ attributeKeys 且出现在正向 effects 里。
   - `events`：`fixed` 中必须各有一条 `code:"CLUB"` / `"THESIS"`（缺失 → **致命**，errors 非空）；`trigger.type==='termRange'` 时 from ≤ to；`random` 每条 `weight>=0`；`requires` 键白名单；`effects` 键白名单（attributes/money/flags/club）。
   - `endings`：`condition.type` ∈ 白名单；`priority` 唯一；`all/any` 递归校验；引用的 tag/college/event id 必须存在。
2. `tests/unit/d-schema.mjs`：**≥15 条负向用例**（每类错误一条，断言 `errors` 里出现关键词），再加 3 条正向（现有配置全过）。
3. `tests/accept/w1.mjs`（**周一提交，此时应为红**）：
   - 用注入 reader 读真实 config，`newGame` 固定种子 → 连续 40 回合 `advance`（策略：每回合 4 次 `study`）；
   - 断言：每回合 money 变化含 +2000/−1800（排除事件影响时用纯 `settleMonthly` 校验更好）；
   - 断言：8 条 `semesterRecords`、`totalGpa > 0`、`failedCourses` 与 `subjects` 里 `passed===false` 的数量一致；
   - 断言：`failedCourses>=3` 时 `warning===true`；
   - 断言：把钱调到 −3000 后 `checkDebt().triggered===true`。
   - 输出形如 `PASS 12 / FAIL 0`，退出码非 0 表示失败（CI 能读）。
4. 把 `tests/verify_m1.mjs` 并入 `npm test`（G37），或拆到 `tests/unit/` 统一命名。

### W2 · 交叉引用与负向覆盖

1. 补齐 W1 未覆盖的交叉引用（尤其 `endings.condition` 里引用的 `tagIncludes/collegeIs/eventDone` 的 id 存在性）。
2. loader 改 `Promise.all` 并行（G41），失败时仍返回"哪一个文件失败"。
3. `tests/accept/w2.mjs`：权重与前置条件（同种子两次一致；学霸标签让 ev_r02 权重 ×1.5；社交 8 时表白选项 `enabled:false`）；用 `computeWeight/availableOptions` 的返回值断言，不依赖 UI。
4. 负向用例累计 ≥30 条；`npm test` 时间控制在 10s 内。

### W3 · 结局配置与可达性

1. `config/endings.json` v2：按 SRS 写 6 条（保研/留学/就业/结婚/普通毕业/延毕），`priority` 1–6（越小越高），条件用 v2 类型组合；普通毕业 `warning===false`，延毕 `default`。
2. `tests/accept/w3.mjs`：对 6 条结局各构造一个"刚好命中"的 state（用 `state.js` 的工厂 + 手工改字段），断言 `judgeEnding().main` 等于预期；再构造"同时命中保研与就业"断言取保研；构造 warning=true 断言不命中保研。
3. **结局可达性矩阵** `docs/结局可达性.md`：6 行 ×（构造 state 的字段组合 / 期望结局 / 实测结果 / 达成周次）。
4. 与 B 的 `tools/sim.mjs` 对账：模拟分布里每个结局 ≥1 次出现，否则退回 B 调阈值。

### W4 · 存储 v2 + E2E + 部署

1. `storage.js` v2：
   - IndexedDB 主用（db `scusim`，store `saves`，key `current`/`slot:N`），打开失败 → LocalStorage（`scusim.save.fallback`）→ 内存；
   - `saveGame` 失败返回 `{ok:false, reason:'quota'|'idb'}`（G30），不吞异常；
   - `SAVE_VERSION = '2.0.0'`，`migrateSave(parsed)`：v1 → 补 `history/flags/semesterRecords/totalGpa` 默认值；不认识的版本返回 `{ok:false, reason:'version_incompatible'}`；
   - 导出/导入保持 `{format,version,state}`，导入失败不覆盖当前档。
2. `tests/support/fake-idb.mjs`：自己实现 `open/get/put/delete` 的最小 IndexedDB 桩（**不引入依赖**），供 Node 测试 storage。测试覆盖：IDB 成功、IDB 打开失败降级 LS、LS 也失败降级内存、配额异常返回 `ok:false`、v1→v2 迁移、坏 JSON 不清档。
3. E2E `tests/accept/w4.mjs`：DOM 桩 + `createController`（复用 `verify_ui` 思路）驱动完整一局：创建 → 40 回合 → 结局 → 图鉴 → 刷新读档恢复中途 → pendingEvent 恢复；断言无异常、结局已解锁。
4. 性能脚本 `tests/accept/perf.mjs`：打印 `newGame`、单次 `advance`、`saveGame`、`loadGame` 的 p50/p95 耗时；门槛 启动 ≤3s、回合 ≤500ms、存档 ≤1s。
5. `_headers`（Cloudflare Pages）：
   ```
   /*
     Cache-Control: no-cache
   ```
6. 部署复核：生产 URL、六份 JSON 200、预览 URL 可打开；`README` 写清回滚步骤。

### W5 · 文档与交付

1. README：运行/测试/部署/回滚/在线地址/已知限制，全部与实现对齐（IndexedDB 说法要真实）。
2. 概要设计补章（**先确认 6–8 章是否真的缺**——文件名是 1-5,9-13）：
   - 6 接口设计：引用 `docs/INTERFACES.md` 的 v2 签名表；
   - 7 数据结构设计：六张配置表 + GameState + 存档结构（引用 DATA_DICTIONARY）；
   - 8 运行设计：启动/恢复/异常/降级四种运行态。
3. RTM 矩阵更新（《手册》§8）状态列：每项写"已验收 / 有条件 / 未做"，附验收记录链接。
4. 交付检查表：`npm test` 全绿、生产站可玩、6 结局可达、文档齐、无密钥入仓。

---

## 3. 自测命令

```bash
npm test
node tests/unit/d-schema.mjs
node tests/accept/w1.mjs
node tests/accept/w2.mjs
node tests/accept/w3.mjs
node tests/accept/w4.mjs
node tests/accept/perf.mjs
```

---

## 4. 常见翻车点

1. **验收脚本写成"跟随实现"**：实现怎么写就怎么断言，永远绿。对策：先按 SRS 写期望（红），实现来满足它。
2. **测试里写死数值**：配置一改就红。测试要"读 config 再算期望"。
3. **为了绿改别人代码**：D 最容易被诱惑。发现是 B/A 的问题 → 提 issue 并让脚本保持红，红是信息。
4. **引入依赖图省事**：`fake-indexeddb`、`jsdom` 都不许装。自己写 30 行桩就够了，答辩也加分（零依赖）。
5. **schema 太严**：B 加内容时天天被卡。规则：**必填项才校验，选填项给默认值**；错误信息必须带"文件 + 字段 + 期望"。
6. **部署后缓存**：`config/*.json` 被 CDN 缓存 → 改了看不到。`_headers` 必须加。

---

## 5. AI 提示词

### 5.1 系统提示词（每次新对话先贴）

```text
你是 SCUSim 项目的「D · 配置/存储/工程/测试」工程师。项目是配置驱动的回合制文字养成 Web 游戏，仓库 D:\My_projects\SCUSim（GitHub lingtang1003/SCUSim，Cloudflare Pages 已部署）。
【技术栈】原生 ES2020 ES Modules；零框架、零构建、**零第三方依赖（含测试依赖）**；`node server.js` 起 5173；测试是纯 Node 脚本；CI 用 GitHub Actions（Node 18，跑 npm test）。
【玩法基线】40 回合、每回合 4 AP、20 点分配、12 标签刷 6 选 3、8 学院、6 行动、固定 2 + 随机 ≥14 事件、6 结局、随机事件 35%、挂科 ≥3 警告、期末 4 门 = 学识×(1±10%)、绩点查 gpaTable。
【你的文件（只能改这些）】src/config/{loader,schema}.js、src/storage/storage.js、config/*.json 的结构、tests/accept/**、tests/fixtures/**、tests/support/**、tests/smoke.mjs、tests/verify_*.mjs、tests/unit/d-*.mjs、package.json、server.js、README.md、.github/**、_headers、docs/（除 CONTRACT/验收/分工）。
【绝对不能改】src/core/**、src/main.js（A）；src/core/{economy,academy,effects}.js、src/events/**、tools/**、config 内容（B）；src/ui/**、index.html、css/**、dev/**（C）。
【红线】1) 零第三方依赖，不许 npm install；2) 测试必须能纯 Node 跑；3) 数值/结构变更必须同步 schema 校验；4) 不为了让测试绿去改别人的代码；5) 必须真实运行并贴输出，不编造。
【工作方式】先读 docs/CONTRACT.md 与你负责的文件，先输出计划（改哪些文件/加哪些用例/怎么跑），我确认后再写。
【输出格式】①改动清单（文件:行号）②校验规则/接口说明 ③测试命令 + 真实输出 ④未覆盖/风险 ⑤需要 A（契约）或 B（内容）配合的事项。
```

### 5.2 W0 · CI 与 fixtures 提示词

```text
【任务 D-W0｜让项目"可验收"】
请完成：
1. .github/workflows/test.yml：on pull_request，Node 18，steps = checkout + setup-node + `npm test`；不需要缓存依赖（无依赖）。
2. .github/pull_request_template.md：含「任务卡编号 / 只改白名单 / 契约是否变更 / 改动说明 / 自测命令与真实输出 / 截图或预览 URL / 遗留风险」。
3. .github/ISSUE_TEMPLATE/bug.yml、contract-change.yml、acceptance-reject.yml 三个模板。
4. tests/fixtures/state.v2.json 与 state.end.json：按 docs/CONTRACT.md §2.3 的 GameState v2 造中局与终局（含 pendingEvent、history、semesterRecords、totalGpa、flags），字段必须能被 schema/引擎消费。
5. 修正 README：把 §5 四人分工改成课程 A/B/C/D 的表述；把 §8「已知占位」重写为 v2 目标与当前状态；补「在线地址 / 预览地址 / 回滚步骤」。
6. 建 docs/验收/README.md：6 周 × 4 人表格 + 每周门禁命令。
约束：不装任何依赖；不改 src/core、src/ui、config 内容。
最后贴：workflow 文件内容、fixtures 的 JSON 片段、以及在本机跑 `npm test` 的真实输出。
```

### 5.3 W1 · schema v2 + 先红验收脚本提示词

```text
【任务 D-W1｜schema v2 与 accept/w1（先红）】
先读 docs/CONTRACT.md §2.2、src/config/schema.js、config/*.json 现状、tests/smoke.mjs。
实现：
1. schema.js 升到 v2，按 CONTRACT 校验 balance/tags/colleges/actions/events/endings 的新字段；重点：
   - events.fixed 必须各有一条 code:"CLUB" 与 code:"THESIS"，缺失 → errors（致命）；
   - tags.eventWeights、colleges.eventBias、endings.condition 里引用的 event/tag/college id 必须存在；
   - endings.condition.type 白名单 + all/any 递归；priority 唯一；
   - actions.mainAttr ∈ attributeKeys 且出现在正向 effects；gpaTable 降序且含 min:0。
2. 错误信息格式统一为「<文件> <字段>: <期望>」，便于 A 在验收时一眼定位。
3. tests/unit/d-schema.mjs：≥15 条负向用例（每类错误 1 条，断言关键词）+ 3 条正向；不要依赖外部文件，用内联对象。
4. tests/accept/w1.mjs：用注入 reader 读真实 config/ 六份 JSON（fs + JSON.parse），固定种子跑 40 回合（每回合 4 次 study + advance），断言：
   - 8 条 semesterRecords，且每条 subjects.length === balance.exam.subjects.length；
   - 每门 score 落在 knowledge*[0.9,1.1] 的取整范围内（用 rng 固定种子复算或直接断言语义区间）；
   - failedCourses === 所有 subjects 中 passed===false 的累计数；
   - failedCourses>=3 → warning===true；
   - 设 money=-3000 后 checkDebt().triggered===true，冷却期内再查为 false。
   输出 `PASS n / FAIL m`，有 FAIL 时 process.exitCode=1。
5. 把 tests/verify_m1.mjs 并入 npm test（package.json 的 test 脚本），并保证总耗时 <10s。
注意：此时 B/A 还没实现，w1 应该是红的——这是设计意图，请把失败项打印清楚（缺什么函数/字段），方便 A/B 对照修。
最后贴 `node tests/unit/d-schema.mjs`、`node tests/accept/w1.mjs` 的真实输出（允许红，但要红得清楚）。
```

### 5.4 W4 · storage v2 提示词

```text
【任务 D-W4｜IndexedDB + 降级 + 配额 + 迁移】
先读 src/storage/storage.js、docs/CONTRACT.md §2.4、src/main.js（只读，看它怎么调你）。
实现 storage v2：
1. 后端优先级：IndexedDB（db 'scusim'，store 'saves'）→ LocalStorage（键 'scusim.save.fallback'）→ 内存；用一个 createStorage(backend?) 工厂注入，Node 测试可注入 fake。
2. API：saveGame(state, slot='current')、loadGame(slot)、listSaves()、clearSave(slot)、getGallery/unlockEnding、exportSaveFile/importSaveFile、getSettings/saveSettings、migrateSave(parsed)。
3. 错误处理：openDb 失败静默降级；事务失败返回 {ok:false, reason:'idb'}；配额超限捕获 QuotaExceededError 返回 {ok:false, reason:'quota'}；任何失败都不能抛未捕获异常。
4. 版本：SAVE_VERSION='2.0.0'；migrateSave 把 v1 存档补 history/flags/semesterRecords/totalGpa/thesis 默认值并返回 {ok:true, state, migrated:true}；未知版本 {ok:false, reason:'version_incompatible'}。
5. tests/support/fake-idb.mjs：自己写最小 IndexedDB 桩（open/get/put/delete + 可模拟 open 失败与 quota 异常），不引入任何依赖。
6. tests/unit/d-storage.mjs：IDB 成功往返、IDB 失败降级 LS、LS 失败降级内存、配额返回 ok:false、v1→v2 迁移、坏 JSON 不清档、gallery 去重、settings 合并。
7. tests/accept/w4.mjs：DOM 桩 + createController 跑完整一局（创建→40 回合→结局→图鉴→模拟刷新读档），断言无异常、结局已解锁、读档后 pendingEvent 能恢复。
约束：不改 main.js/engine；不改 UI；不装依赖。
最后贴 `node tests/unit/d-storage.mjs`、`node tests/accept/w4.mjs`、`npm test` 的真实输出。
```

### 5.5 W5 · 文档补齐提示词

```text
【任务 D-W5｜文档对账】
请以代码为唯一事实来源，做三件事：
1. 逐条核对 README 与实际实现（存储到底是 IndexedDB 还是 localStorage、命令是否可跑、分工是否正确、有无过期占位说明），输出「不一致清单（原文→应改为）」并直接改掉。
2. 若《概要设计说明书》确实缺 6–8 章（文件名是 1-5,9-13），按 GB/T 8567 结构起草：
   - 6 接口设计（引用 docs/INTERFACES.md 的 v2 签名，含调用关系图）
   - 7 数据结构设计（六张配置表字段表 + GameState + 存档结构）
   - 8 运行设计（启动/恢复/异常/降级四种运行态 + 时序）
   输出 Markdown 到 docs/，标注「待 A 审阅后并入 docx」。
3. 更新 docs/团队分工与验收手册.md §8 RTM 矩阵的状态列（已验收/有条件/未做），每行附验收记录文件名。
要求：不要编造没实现的功能；没做的写"未实现（计划 v2.x）"。
最后贴：不一致清单表格 + 生成的文件路径 + 你判断为"文档写了但代码没有"的全部条目。
```

### 5.6 返工提示词

```text
【返工｜PR #<编号>】
A 的验收结论：❌ 退回。必改项：
1) <问题> —— 期望 <…>，实际 <…>，复现 <命令>
2) …
只修这三条；修完跑 <命令> 贴输出；不得通过降低断言强度或删用例来变绿。
```

---

## 6. 每周给 A 的三样东西

1. 本周门禁脚本的真实输出（红也要贴，红得清楚比"绿得可疑"有用）。
2. 配置变更清单（schema 加了哪些字段、谁要跟着填）。
3. 一句风险：本周哪个校验是"为了放行而放宽"的，下周必须收紧。
