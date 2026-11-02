# C · UI 与交互负责人 · 任务书

> 你负责玩家能看见、能点的全部东西：主菜单、六步开局、主界面、事件弹窗、学期结算、结局、图鉴、设置、响应式与无障碍。
> 你的硬约束只有两条：**`ui.js` 零 import**、**绝不直接改 `GameState`**。所有数据从 `render(state, view)` 和 callbacks 来。
> 配套阅读：`docs/团队分工与验收手册.md`（下称《手册》）§2.2 配置契约、§2.4 UI 接口、§5.4 手测清单。

---

## 1. 你的边界

### 1.1 你能改（白名单）

| 文件 | 说明 |
|---|---|
| `index.html` | 入口页（根容器 + 模块脚本），保持极简 |
| `css/style.css` | 全部样式（原生 CSS 变量组织） |
| `src/ui/ui.js` | 表现层，**零 import** |
| `dev/ui-lab.html`（新增） | 你的独立调试台：喂 fixture 渲染任意页面，不等 A 集成 |
| `tests/unit/c-ui.mjs`（新增） | DOM 桩下的渲染断言（用 `tests/verify_ui.mjs` 的同款桩） |

### 1.2 你不能改

- A：`src/core/**` `src/main.js`。
- B：`src/events/**` `config/*.json` 内容。
- D：`src/config/**` `src/storage/**` `tests/accept/**` `tests/fixtures/**` `package.json` `README.md`（`tests/unit/c-ui.mjs` 是你自己的）。

> 你**不能**自己算游戏规则（比如"属性 15 时 +2"），只负责把 `view` 里给的数字显示出来。要新数据 → 提 issue 给 A 加 `view` 字段。

### 1.3 你的交付物（按周）

| 周 | 交付物 |
|---|---|
| W0 | UI 清单 + 三档分辨率走查截图 + 交互稿（六步开局/结算/事件/履历/结局/图鉴） |
| W1 | 学期结算弹窗 + 月度收支提示 + 负债条 + 置灰原因 + `showToast` |
| W2 | 六步开局（姓名/性别/学院/属性/标签/立绘）："6 选 3"（含换一批）+ 属性 0 起 + 姓名 12 字 + 标签效果预览 |
| W3 | 事件弹窗 v2（前置置灰）+ 履历面板 + 结局页（主/副）+ 图鉴 |
| W4 | 1366×768 / 375 适配 + 键盘/aria/focus trap + 设置 + 清档确认 |
| W5 | 视觉定稿 + 演示动线 + 截图/录屏素材 |

---

## 2. 先搭你的独立工作台（W0 就做）

没有它，你每周都要等 A 集成完才能看到效果——这是 C 角色最常见的阻塞。

**`dev/ui-lab.html` 要求**：

1. 只 import `../src/ui/ui.js`（不 import core/storage/main）。
2. `fetch('../config/balance.json')` 等六份配置 + `fetch('../tests/fixtures/state.v2.json')`（D 提供）。
3. 顶部一排按钮切换场景：`菜单 / 开局①~④ / 主界面 / 事件 / 学期结算 / 结局 / 图鉴 / 设置 / 错误页`。
4. callbacks 全部打 `console.log`，状态用本地造的 fixture 对象（**不调引擎**）。
5. 支持 `?state=low-health`、`?state=rich`、`?state=fail` 等变体，方便截不同状态的图。

`tests/fixtures/state.v2.json` 由 D 提供，字段见《手册》§2.3。fixture 没到位前，你自己在 ui-lab 里写死一个最小对象（别提交到 src/）。

> 注意：`tests/verify_ui.mjs` 会扫描 `src/ui/ui.js`，断言它没有 `Math.random`、`localStorage`、`indexedDB`、`window.`。所以**随机数不能自己掷**——"换一批标签"要让 main 给你新候选（`callbacks.onRerollTags()`），你只渲染。

---

## 3. 六周任务卡

### W0 · UI 盘点与交互稿

1. 缺口清单：对照《手册》§1.2 里归你的 G17/G18/G19/G33/G35/G36，逐条写"现状 / 目标 / 需要谁给数据"。
2. 走查三档分辨率（用浏览器 DevTools 设备模拟 + 真机）：1920×1080、1366×768、375×812，截图存 `docs/截图/`（每档 3 张：菜单、主界面、事件）。
3. 交互稿（文字 + 线框即可）：
   - 学期结算弹窗：科目表格 4 行、绩点、挂科数、警告徽章、一个"继续"按钮；
   - 履历面板：时间轴/列表，最近 8 条，可展开全部（≤60）；
   - 事件弹窗：标题、正文、2–3 个选项按钮（不可用置灰 + 下方小字原因）；
   - 结局页：主结局大字 + 描述 + 副结局列表 + "再玩一次/回主菜单"。
4. 结论：这周不改代码，只交文档 + 截图。

### W1 · 结算与反馈

**目标**：G33/G35 的一部分。

1. `showExam(settlement)`：模态弹窗渲染 `settlement.subjects`（科目/分数/是否挂科）、`semesterGpa`、`totalGpa`、`failedCourses`、`warning`（有警告时红色徽章）。
2. `showToast(msg, type)`：统一提示条（`info/success/danger`），`showError` 复用它（保留旧签名兼容）。
3. 主界面新增：
   - 本月收支行（`view.monthly = {income, expense, net}`，A 在 W1 提供；没有就隐藏）；
   - 负债警示条：`attrs.money <= view.debtThreshold` 时顶部红条"你已负债，注意触发借钱/吃土事件"；
   - 行动按钮置灰原因：`view.actions[i].reason` 显示在按钮下方小字（不再只靠 `title`）。
4. 学期结算与事件弹窗的**队列兼容**：`showExam` 与 `showEvent` 都只负责渲染，关闭后调 `callbacks.onModalClosed?.()`（A 在 main 里排队，你只通知"关完了"）。
5. 写 `tests/unit/c-ui.mjs`：DOM 桩下断言 `showExam` 生成 4 行科目、`showToast` 有 danger class、置灰按钮带 `disabled` 与原因文本。

**门禁**：`node tests/unit/c-ui.mjs` 全 PASS；`node tests/verify_ui.mjs` 不回归（14 项全 PASS）；ui-lab 里 5 个场景截图。

### W2 · 开局六步（现网已是六步：姓名→性别→学院→属性→标签→立绘）

**目标**：G17/G18/G19。

1. 第⑤步标签：只渲染 `opts.tagCandidates`（6 个 id），选 3 个；不足 6 个时降级 `config.tags.list.slice(0,6)`（保证旧测试 `startCreation()` 无参调用不崩）。
2. "换一批"按钮 → `callbacks.onRerollTags?.()`；A 会重绘并传入新候选。
3. 每个候选标签显示 `name` + `desc` + `modifiers` 摘要（如"学识 +3 / 健康 −1"），让玩家能决策。
4. 属性分配：四项初始 0（`makeCreationState` 改），共 20 点；剩余 0 才能下一步；每项上限 20。
5. 姓名单独一屏（**不要**和性别合并，现网六步已定）：`maxlength=12`，去掉首尾空格，空值拦截；提示"1–12 字"。
6. 学院选择：显示 `desc` 与"该学院事件偏向：…"（从 `config.colleges.list[i].eventBias` 读，只展示前 3 个对应事件名）。
7. 立绘（第⑥步）保持现有 `APPEARANCES` 实现，不改。

**门禁**：`verify_ui` 全 PASS；ui-lab 截 4 张（第⑤步默认/换一批/选满 3/属性未分满）；`accept/w2` 的 UI 断言通过。

### W3 · 事件 / 履历 / 结局 / 图鉴

1. `showEvent(ev)`：`ev.options` 已带 `enabled/reason`（B 在 `buildPending` 里算好），`enabled:false` → `disabled` + 原因小字；点击调 `callbacks.onResolveEvent(id)`。
2. 事件结果反馈：结算后先 `showToast(resultText)` 再关弹窗（或弹窗内"结果"态再关），让玩家看到后果。
3. 履历面板：主界面"📜 履历"按钮 → 抽屉/弹窗，渲染 `state.history`（最近 8 条 + "查看全部"）；空态文案。
4. `showEnding(e)`：主结局（大字 + 描述 + 达成条件摘要）+ `e.subs` 副结局列表（没有就隐藏）+ 按钮"再玩一次"（`callbacks.onNewGame?` 由 A 处理）/ "回主菜单"。
5. `showGallery(g)`：卡片网格，未解锁显示"？？？"与解锁提示；顶部进度条 `已解锁 x/6`；点击已解锁卡片展开描述。
6. 设置：加"显示种子"（`seedDisplay`）与"清除存档"（二次确认 `window.confirm` 不能让测试崩，用 `doc.defaultView?.confirm` 兜底）。

**门禁**：ui-lab 截 6 张（正常事件/置灰事件/履历空/履历满/结局/图鉴半解锁）；`accept/w3` UI 断言通过。

### W4 · 适配与无障碍

1. 三档分辨率：`@media (max-width: 1440px)`、`(max-width: 900px)`、`(max-width: 480px)`；主界面在 375px 下单列、按钮全宽。
2. 键盘：Tab 顺序合理；弹窗打开时 focus 进第一个按钮，Esc 关闭（`onModalClosed` 通知）；`aria-modal="true"`、`role="dialog"`、`aria-labelledby`。
3. 对比度：正文 ≥4.5:1；置灰按钮仍有可读性（不要 `opacity:.3` 到看不清）。
4. `prefers-reduced-motion` 自动降级（配合 `reduce-motion` class）。
5. 加载态：主菜单加载配置时显示骨架/loading（`mount` 前）；错误页样式统一（`showError` 全屏版）。
6. `dev/ui-lab.html` 里加一个"375px 预览"开关，方便演示。

**门禁**：三档截图各 3 张；键盘走查录屏 30s；`verify_ui` 与 `npm test` 全绿。

### W5 · 定稿

1. `style.css` 用 CSS 变量统一色板/间距/圆角，删除无用样式（用 DevTools Coverage 看）。
2. 演示动线：菜单 → 新游戏 → 行动 4 次 → 推进 → 事件 → 考试 → 40 回合结局 → 图鉴，全程无滚动错位。
3. 交付截图包（`docs/截图/`）+ 60s 演示录屏。

---

## 4. 自测命令

```bash
npm test                            # 含 verify_ui，必须 14 项全 PASS
node tests/unit/c-ui.mjs            # 你的渲染断言
node server.js                      # 打开 /dev/ui-lab.html 自己点
```

---

## 5. 常见翻车点

1. **import 了 core**：哪怕只是 `import { ATTRS } from '../core/state.js'`，红线就破了。属性名写死在 ui.js 的 `ATTRIBUTE_META` 里（现在就是这么做的），别动。
2. **自己掷随机数**：`Math.random` 会导致 `verify_ui` 直接红。要随机 → callbacks 让 A 给。
3. **改 state**：`state.player.attributes.knowledge += 1` 这种绝对不行，所有变更走 `callbacks.onAction`。
4. **弹窗叠加**：同时存在两个 overlay 会互相遮。每次 `showX` 先 `closeOverlay()`，并通知 `onModalClosed`。
5. **只在 1920 调**：答辩现场可能是 1366 笔记本，W4 必须过一遍。
6. **文案写死**：事件标题/正文从 `config` 读（`findEventById`），不要复制文案到 ui.js。

---

## 6. AI 提示词

### 6.1 系统提示词（每次新对话先贴）

```text
你是 SCUSim 项目的「C · UI 与交互」前端工程师。项目是配置驱动的回合制文字养成 Web 游戏，仓库 D:\My_projects\SCUSim（GitHub lingtang1003/SCUSim）。
【技术栈】原生 ES2020 ES Modules、原生 CSS、零依赖、无构建；`node server.js` 起 5173；测试是纯 Node 脚本，UI 测试用 DOM 桩（tests/verify_ui.mjs）。
【你的文件（只能改这些）】index.html、css/style.css、src/ui/ui.js、dev/ui-lab.html（可新建）、tests/unit/c-ui.mjs（可新建）。
【绝对不能改】src/core/**、src/main.js（A）；src/events/**、config/*.json（B）；src/config/**、src/storage/**、tests/accept/**、tests/fixtures/**、package.json、README.md（D）。
【两条铁律】1) ui.js 零 import：不 import core/events/storage/config 任何模块；2) 绝不直接改 GameState，所有变更只经 callbacks（onNewGame/onAction/onAdvance/onResolveEvent/onRerollTags/onLoadGame/onExport/onImport/onClearSave/onOpenGallery/onOpenSettings/onOpenMenu/onModalClosed）。
【禁止】Math.random（必须没有）、localStorage、indexedDB、window. 直接访问（用注入的 doc；需要 confirm 用 doc.defaultView?.confirm）。
【数据来源】render(state, view)：view = { availability, actions:[{id,enabled,reason}], tagCandidates, tierInfo, flags, monthly, debtThreshold, seed }；事件用 showEvent(ev)，ev.options 里带 enabled/reason；结算用 showExam(settlement)。
【工作方式】先读 src/ui/ui.js 现状与 docs/团队分工与验收手册.md §2.4，先输出计划（改哪些函数、每个函数改什么、怎么用 ui-lab 验证），我确认后再写。
【输出格式】①改动清单（函数名/行号）②交互说明 ③自测命令 + 真实输出 ④截图/场景清单 ⑤需要 A/B 提供的数据字段。
```

### 6.2 W1 · 结算与反馈提示词

```text
【任务 C-W1｜学期结算弹窗 + 收支提示 + 负债条 + 置灰原因】
先读 src/ui/ui.js（重点 showEvent/showEnding/showError/render/buildActions）、tests/verify_ui.mjs（别破坏它的 14 项断言）、docs/CONTRACT.md §2.4。
实现：
1. showExam(settlement)：模态弹窗，表格渲染 settlement.subjects（科目/分数/及格），显示 semesterGpa、totalGpa、failedCourses；warning 为 true 时红色徽章「学业警告」；一个「继续」按钮，关闭时调 callbacks.onModalClosed?.()。
2. showToast(msg, type='info')：轻提示（info/success/danger），2.2s 自动消失；showError 内部复用它，保持原签名。
3. render(state, view) 主界面新增：本月收支行（view.monthly 存在才渲染）；attrs.money <= view.debtThreshold 时顶部红条负债提示；行动按钮下方小字显示 view.actions[i].reason（置灰时）。
4. 保证 showExam 与 showEvent 互斥：每次弹窗前 closeOverlay()。
5. tests/unit/c-ui.mjs：DOM 桩断言 showExam 生成 4 行科目、warning 时出现 danger 徽章、showToast 生成对应 class、置灰按钮 disabled 且有原因文本。
约束：不得 import 任何模块；不得用 Math.random；不得改 state。
最后贴 `node tests/unit/c-ui.mjs`、`node tests/verify_ui.mjs`、`npm test` 的真实输出，并说明 ui-lab 里怎么点到这个弹窗。
```

### 6.3 W2 · 开局六步提示词

```text
【任务 C-W2｜6 选 3 标签 + 属性 0 起 + 六步开局 + 学院偏向展示】
先读 src/ui/ui.js 的 makeCreationState/creationNameStep/creationGenderStep/creationCollegeStep/creationAttributeStep/creationTagStep/creationAppearanceStep/startCreation/renderCreation。
实现：
1. startCreation(opts)：可选入参 {tagCandidates}；没有时降级 config.tags.list.slice(0,6).map(t=>t.id)（保证 tests/verify_ui.mjs 的无参调用不崩）。
2. 第⑤步只渲染 tagCandidates 对应的 6 个标签；每个显示 name、desc、modifiers 摘要（如「学识 +3 / 健康 −1」）；选满 3 个才能提交；提供「换一批」按钮调 callbacks.onRerollTags?.()。
3. 属性分配四项初始 0、共 20 点、每项 0–20、剩余 0 才能下一步；顶部显示「剩余 N 点」。
4. 姓名单独一屏（现网固定六步：姓名→性别→学院→属性→标签→立绘，不要合并），maxlength=12、trim、空值拦截、提示「1–12 字」。
5. 学院下拉展示 desc；选中后展示「事件偏向」：从 config.colleges.list[i].eventBias 取前 3 个事件 id，用 config.events 找 name 展示。
6. 保持 renderCreation 的「第 N/6 步」文案与现有 DOM 类名（.vn-* / .card / .btn），不要在 W2 动样式体系。
7. 第⑥步立绘（creationAppearanceStep）保持现状，不改。
约束：零 import；不用 Math.random；不改 state；不改 callbacks 协议（只新增 onRerollTags 的使用）。
最后贴 `node tests/verify_ui.mjs`、`npm test` 的真实输出，并给 ui-lab 四张截图说明（默认/换一批/选满/未分满）。
```

### 6.4 W3 · 事件/履历/结局/图鉴提示词

```text
【任务 C-W3｜事件弹窗 v2、履历面板、结局页、图鉴】
先读 src/ui/ui.js（showEvent/showEnding/showGallery/render）、docs/CONTRACT.md §2.2 的 events 结构。
实现：
1. showEvent(ev)：ev.options 每项带 {id,label,enabled,reason}；enabled=false 渲染 disabled 按钮 + 下方小字 reason；点击调 callbacks.onResolveEvent(id)。
2. 结算反馈：事件关闭前先 showToast(resultText)——resultText 由 A 在 resolve 结果里传（或从 ev.resultText 读，兼容两种）。
3. 履历：主界面加「📜 履历」按钮 → 弹层渲染 state.history 最近 8 条（时间/类型/文本），「查看全部」展开到 60 条，空态文案「还没有故事」。
4. showEnding(e)：主结局大字 + 描述 + 条件摘要；e.subs 数组渲染副结局；按钮「回主菜单」（callbacks.onOpenMenu）。
5. showGallery(g)：卡片网格 + 进度「已解锁 x/6」；未解锁显示「？？？」；点击已解锁卡片展开描述（不跳页）。
6. 设置里加「显示种子」开关（读 state.seed，经 render 传入 view.seed）与「清除存档」二次确认（doc.defaultView?.confirm）。
约束：零 import；不用 Math.random；不改 state；只读 view/state 里的字段（缺字段提 issue 给 A）。
最后贴 `node tests/verify_ui.mjs`、`node tests/unit/c-ui.mjs`、`npm test` 的真实输出 + 6 张 ui-lab 截图说明。
```

### 6.5 W4 · 适配与无障碍提示词

```text
【任务 C-W4｜响应式 + 键盘/aria + 设置 + 加载态】
先读 css/style.css（CSS 变量与现有断点）、src/ui/ui.js 的 h()/mount()。
实现：
1. 断点：1440px / 900px / 480px；375px 下主界面单列、按钮全宽、属性卡两列变一列；顶部栏不换行溢出（改用 flex-wrap）。
2. 弹窗：role="dialog"、aria-modal="true"、aria-labelledby 指向标题；打开时 focus 第一个按钮；Esc 关闭并 onModalClosed；关闭后焦点回到触发按钮。
3. 对比度：正文 ≥4.5:1；disabled 按钮保持可读（不要纯 opacity）。
4. prefers-reduced-motion 降级（与 .reduce-motion 一致）。
5. 加载态：mount 前渲染 skeleton（3 个占位块）；错误页 showError 全屏样式（标题 + 原因 + 「返回主菜单」）。
6. dev/ui-lab.html 加「375px 预览」开关（用 iframe 或容器宽度模拟）。
约束：不动 ui.js 的对外方法签名；不引入任何依赖。
最后贴 `node tests/verify_ui.mjs`、`npm test` 的真实输出 + 三档分辨率截图（1920/1366/375 各 3 张）+ 键盘走查录屏路径。
```

### 6.6 返工提示词

```text
【返工｜PR #<编号>】
A 的验收结论：❌ 退回。必改项：
1) <问题> —— 期望 <…>，实际 <…>，复现 <步骤>
2) …
只修这三条；修完跑 `npm test` 与 `node tests/unit/c-ui.mjs` 并贴输出；不要顺手改 core 或改别人文件。
```

---

## 7. 每周给 A 的三样东西

1. 预览 URL 上的 3 张关键截图（本周改动的界面）+ 1 条 30s 录屏。
2. `npm test` 输出（必须包含 `verify_ui` 14 项 PASS）。
3. 一句话：这周有没有"数据不够导致界面做不了"的地方（列字段名，A 去加 view）。
