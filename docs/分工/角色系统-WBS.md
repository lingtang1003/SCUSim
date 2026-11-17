# 角色系统（可攻略角色）· 四人分工与工作包

> 目标：把「匿名事件 + 属性结局」升级为「有名字、有好感、有阶段、有专属结局的角色线」，交付版本 v2.1.0。
> 依据：`docs/剧情化优化路线.md` §4 P2、`docs/CONTRACT.md` §1（文件所有权）、`docs/团队分工与验收手册.md` §0.3（周节奏）、§5（验收 SOP）。
> 周期：**4 周（CC0 契约 + CC1/CC2/CC3）**，总投入约 **40 人日**（A 12 / B 10 / C 10 / D 10，按每人每周 2.5–3 有效人日）。
> 红线不变：原生 ESM、无框架无构建、配置驱动、core 不碰 DOM/storage、rng 单入口、UI 零 import。

---

## 0. 一句话分工

| 角色 | 一句话 | 本周期核心交付 |
|---|---|---|
| **A** | 定契约、写好感和剧情线的引擎、唯一改 `main.js` 的人 | `relation.js` + `storyline.js` + 引擎接线 + 结局条件 + 集成 |
| **B** | 唯一的内容产能：角色表 + 剧情线 + 事件文案 + 数值 | 4 角色 × 6–10 事件（**先绑定 24 个现有事件，只新写 16 个**）+ 8 条结局 |
| **C** | 让玩家"看得见"好感：人物卡、好感条、台词、表情、立绘 | 人物卡面板 + 好感提示 + `lines` 台词渲染 + 立绘表情差分 |
| **D** | 让系统不炸：schema、存档迁移、门禁、内容 lint、模拟器 | 4 张新表校验 + `accept/cc1..3` + `migrateSave` + 内容 lint + 好感曲线模拟 |

> 最关键的一句：**A 不先冻结契约，B/C/D 三天的活会在第四天全部返工**。这就是 CC0 存在的唯一理由。

---

## 1. 交付目标（DoD，验收就看这几条）

| # | 目标 | 量化 |
|---|---|---|
| 1 | 可攻略角色 | **2 名**（林予·文学 / 程一·计算机），各 3 个关系阶段、≥6 个专属事件、3 个结局（真/普通/坏） |
| 2 | 配角 | **2 名**（周野·体育社团 / 陈老师·导师），各 ≥5 个绑定事件、1 个结局变体 |
| 3 | 好感可见 | 人物卡（立绘 + 好感条 + 阶段 + 已解锁事件）、事件选项好感提示、结算浮标 `▲ 林予 好感 +8` |
| 4 | 好感生效 | 好感影响事件权重与选项解锁；结局条件新增 `relationAtLeast` |
| 5 | 台词化 | ≥30% 的事件有 `lines` 台词（有 speaker），不再全篇旁白 |
| 6 | 兼容 | v2.0 旧档导入后自动补 `relations` 默认值，不报错 |
| 7 | 门禁 | `accept/cc1..cc3` 全绿；`npm test` 不回归；模拟器 200 局：每条攻略线完成率 ≥ 40%、无 0% 结局 |

**本周期不做**：CG 图鉴、成就、二周目、语音、限时选项（留给下一周期，见 §11 裁剪表）。

---

## 2. 必须先冻结的 5 件契约（CC0，A 出稿，B/C/D approve 后开工）

> 原则：契约只定**字段名 / 类型 / 默认值 / 谁读谁写**，不定实现细节。任何一项未冻结，对应泳道不准动代码。

### 2.1 `config/characters.json`（结构 D 定，内容 B 填）

```json
{ "version": "1.0.0",
  "list": [
    { "id": "linyu", "name": "林予", "gender": "女", "role": "可攻略",
      "college": "literature", "title": "文学与新闻学院 · 同级",
      "intro": "图书馆四楼常客，读诗的人。",
      "portrait": { "base": "linyu_neutral.webp",
        "emotions": { "neutral": "linyu_neutral.webp", "smile": "linyu_smile.webp",
                      "sad": "linyu_sad.webp", "shy": "linyu_shy.webp" } },
      "initialAffinity": 0,
      "stages": [ { "at": 0,  "id": "stranger", "name": "陌生" },
                  { "at": 15, "id": "friend",   "name": "朋友" },
                  { "at": 35, "id": "close",    "name": "知己" },
                  { "at": 60, "id": "lover",    "name": "恋人" } ],
      "likedEvents": ["ev_r25", "ev_r09"],
      "dislikedEvents": ["ev_r12"] }
  ] }
```

- `id`：小写英文/拼音，**全库唯一**；事件 id 前缀 `ev_cr_<charId>_<step>`。
- 好感范围 0–100；单次变化建议 +3～+10；阶段阈值写在 `stages`，**不写进代码**。
- 缺图回落顺序：正式图 → 现有 9 张立绘 + 色调区分 → 纯色剪影（C 实现）。

### 2.2 `config/storylines.json`（结构 D 定，内容 B 填）

```json
{ "version": "1.0.0",
  "lines": [
    { "id": "romance_linyu", "charId": "linyu", "name": "林予线",
      "window": [2, 38], "priority": 5,
      "breakOn": { "affinityBelow": 10, "forTurns": 6 },
      "steps": [
        { "id": "meet",    "eventId": "ev_r23", "window": [2, 6] },
        { "id": "dinner",  "eventId": "ev_r24", "window": [6, 14],
          "gate": { "relationAtLeast": { "charId": "linyu", "value": 10 } },
          "next": { "dinner": "walk", "refuse": "cool_down" } },
        { "id": "walk",    "eventId": "ev_r25", "window": [10, 22] },
        { "id": "confess", "eventId": "ev_cr_linyu_confess", "window": [18, 34],
          "gate": { "relationAtLeast": { "charId": "linyu", "value": 45 } } }
      ],
      "endings": { "true": "ending_linyu_true", "normal": "ending_linyu_normal", "bad": "ending_linyu_bad" } }
  ] }
```

- `steps[]` 严格顺序推进；`gate` 不满足 → 停在本步，窗口过期 → 走 `endings.bad`。
- `next` 的 key 必须是本步事件的选项 id（D 的 schema 必须校验这条交叉引用）。

### 2.3 `state` 增量（全部带默认值，旧档可迁移）

```js
player: {
  relations: { /* charId: { affinity: 0, stage: 'stranger', met: false, lastTurn: 0 } */ },
  romance: 'none'          // 保留，由 relations 的 lover 阶段单向同步（防破坏现有结局）
},
storylines: { /* lineId: { step: 0, status: 'idle|active|done|broken', since: 1 } */ }
// 本周期不做 scheduled（延迟事件队列）；下一周期再加
```

### 2.4 `effects` / `requires` 增量（B 实现，A 消费）

```json
{ "effects": {
    "attributes": { "social": 1 },
    "money": -150,
    "flags": { "crush": true },
    "relation": { "linyu": 8 },                 // 好感增减
    "relationStage": { "linyu": "close" }       // 强制跃迁（可选）
  } }
```
```json
{ "requires": { "relationAtLeast": { "charId": "linyu", "value": 45 } } }
```

- **所有 relation 写入必须走 `effects.applyEffects`**（`src/core/effects.js:83`），禁止在 engine/UI 里直接改 `player.relations`。
- `availableOptions` 要把"好感不足"映射成可读的 `reason`（置灰原因），B 负责。

### 2.5 UI 契约增量（A 定义，C 实现）

| 新增 | 方向 | 说明 |
|---|---|---|
| `view.relations` | main → UI | `{ linyu: { affinity, stage, stageName } }` |
| `view.characters` | main → UI | 角色静态表（名字/立绘/阶段阈值） |
| `app.showRelationPanel(relations, characters)` | main → UI | 人物卡面板 |
| `callbacks.onOpenRelations()` | UI → main | 菜单/按钮触发 |
| 事件 `lines: [{ speaker, text, emotion }]` | config → UI | 逐段播放，播完再出选项；`text` 旧字段保留回退 |
| `view.affinityHints` | main → UI | 选项上的好感提示（`+8`） |

---

## 3. 前置清账（不清就会返工，建议 CC0 期间顺手做掉）

| # | 项 | 现状 | Owner | 不清的后果 |
|---|---|---|---|---|
| 1 | schema v2 未覆盖新字段 | `src/config/schema.js` 仍是 v1 | D | 角色表写错只在玩家玩到时炸 |
| 2 | `SAVE_VERSION` 未升、无迁移（D-07） | 仍 `1.0.0` | D | 加 `relations` 后**旧档直接打不开** |
| 3 | 结局仍是属性阈值（Q9：`ending_warning` 0% 可达） | `config/endings.json` 6 条 | B | 角色专属结局没位置插，优先级会打架 |
| 4 | 金钱语义未决（Q1：`walletPerMoneyPoint` 缺省） | 事件金额是"元"、属性是"点" | B+D | 礼物/约会类角色事件的金额无法定义 |

> 建议顺序：**CC0 先花半天定 Q1**（推荐 `walletPerMoneyPoint: 200`、`monthlyIncome 1500 / monthlyExpense 1950`），其余三项在 CC1 内并行清掉；**D 的 `migrateSave` 必须先于 A 的 relations 合入**。

---

## 4. 文件归属调整（本周期新增文件，其余沿用 `CONTRACT.md §1`）

| 新增/修改 | 结构 Owner | 内容 Owner | 说明 |
|---|---|---|---|
| `config/characters.json` | D（校验） | **B** | 角色静态度量 |
| `config/storylines.json` | D（校验） | **B** | 剧情线步骤与分支 |
| `src/core/relation.js` | **A** | A | 好感/阶段纯逻辑 |
| `src/core/storyline.js` | **A** | A | 剧情线状态机纯逻辑 |
| `src/core/state.js`、`engine.js`、`ending.js`、`main.js` | **A** | A | 接线 + 组装 |
| `src/core/effects.js`、`src/events/eventManager.js` | **B** | B | relation 写入 / 好感前置 |
| `config/events.json` | D（结构） | **B** | 绑定 24 个现有事件 + 新增 16 个 |
| `assets/char/<charId>_*.webp`、`dev/ui-lab.html` | **C** | C | 立绘与独立调试页 |
| `src/ui/ui.js`、`css/style.css` | **C** | C | 人物卡、好感条、台词渲染 |
| `docs/内容/`（**新增目录**） | **B** | B | 文案初稿与演出标注（需 A 批准的 1 行契约变更，否则协笔没地方放） |
| `tests/accept/cc1..cc3.mjs`、`tests/fixtures/state.relations.json` | **D** | D | 门禁与夹具 |
| `tests/unit/a-relation.mjs` / `b-characters.mjs` / `d-schema-characters.mjs` | 各自作者 | 各自 | 单测归作者 |

**冲突铁律**：任何人不得"顺手"改别人白名单里的文件；跨文件需求走 `[契约变更]` PR，A 24 小时内裁决。

---

## 5. 依赖图与四条泳道

```
CC0 契约冻结（A，全员 approve）
   │
   ├─▶ D: schema + fixtures + migrateSave + accept/cc1（先红）
   │        └─▶ B: characters/storylines/events 内容
   │                 └─▶ A: engine 接线 + main 组装
   │                          └─▶ D: accept/cc1 转绿 ──▶ A 验收
   │
   ├─▶ A: relation.js + storyline.js + ending 条件（可与 D 并行，纯 Node 单测）
   └─▶ C: 立绘 + 人物卡 + 好感条（用 dev/ui-lab.html + fixtures，不等 A 集成）
```

**关键并行点**：
- C 全程不等 A：用 `dev/ui-lab.html` + `tests/fixtures/state.relations.json` 造数据；
- B 全程不等 A：纯 Node 单测 + 配置校验；
- D 的 `accept/cc1.mjs` **必须周一先红**（先红后绿，防止自己写测试自己过）；
- 只有 A 改 `main.js`。

---

## 6. 四周分配（主体）

> 每格格式：**任务 → 产出（人日）**。

### CC0 · 契约冻结（第 0 周，2–3 天）

| 角色 | 任务 | 产出 |
|---|---|---|
| **A** | 写 `docs/CONTRACT.md` 附录 C「角色系统 v2.1」：§2.1–§2.5 五个冻结项 + 角色/事件 ID 命名规范 + 版本策略；开 issue 标签 `cc`；确认 `docs/内容/` 归属 | 契约附录（1.5d） |
| **B** | 出「角色 ↔ 现有事件映射表」：24 个现有事件分别绑给谁、要改哪几句；`characters.json` 草案（4 角色）；每角色 4 个新增事件标题 | 映射表 + 草案（1d） |
| **C** | 出「角色视觉规格」：立绘 900×1400 透明 WebP、表情清单（neutral/smile/sad/shy）、命名 `charId_emotion.webp`、缺图降级链；人物卡线框图（1 张） | 规格文档 + 线框（1d） |
| **D** | 出 schema v2 草案（4 张新表的字段校验 + 交叉引用规则）；建 `tests/fixtures/state.relations.json`；**提交 `accept/cc1.mjs` 并跑成红色** | schema 草案 + 夹具 + 红门禁（1.5d） |

**门禁**：`docs/CONTRACT.md` 附录 C 有 4 个 approve；`node tests/accept/cc1.mjs` 失败且报错信息可读（说明它能抓住缺失）。

### CC1 · 垂直切片：林予线端到端（第 1 周）

| 角色 | 任务 | 产出 |
|---|---|---|
| **A** | ① `relation.js`：`changeAffinity / stageOf（按 characters.stages）/ syncRomance`；② `ending.js` 加 `relationAtLeast`；③ `engine.newGame` 初始化 `relations/storylines`、`resolvePendingEvent` 应用 relation、`buildViewModel` 带 `relations`；④ `main.js` 组装 `view.relations/affinityHints` + `onOpenRelations`；⑤ `tests/unit/a-relation.mjs` | 引擎打通（4d） |
| **B** | ① `characters.json` 只写林予；② `storylines.json` 只写林予线 4 步；③ `ev_r23–26` 文案改写（"ta"→"林予"，加 `charId` + 2 处 `lines` 台词）；④ 新写 2 个事件（`ev_cr_linyu_confess` 等）；⑤ `effects.relation` / `requires.relationAtLeast` 实现 + `b-characters.mjs` | 一条完整线（3d） |
| **C** | ① 人物卡面板（立绘 + 好感条 + 阶段名 + 已解锁事件）；② 选项好感提示 `↑ 林予 +8`；③ 结算浮标 `▲ 林予 好感 +8`；④ `showEvent` 支持 `lines` 逐段播放 + 点击继续；⑤ `dev/ui-lab.html` 骨架 | 好感可见（3d） |
| **D** | ① schema 校验 characters/storylines（含 `next` key 必须是选项 id、`charId` 必须存在）；② `migrateSave` 补 `relations/storylines` 默认值 + `SAVE_VERSION → 2.1.0`；③ `accept/cc1` 转绿；④ `tests/unit/d-schema-characters.mjs` | 系统不炸（3d） |

**CC1 门禁（浏览器手测，12 项）**：
1. 新游戏能正常开局（旧行为无回归）；
2. 第 2–6 回合内遇见林予，事件带名字和台词；
3. 选项上显示好感提示；选完出现 `▲ 林予 好感 +N`；
4. 菜单/侧栏能打开人物卡，好感条正确、阶段名正确；
5. 好感不足时"告白"选项置灰且有原因；
6. 第 40 回合结局文案里出现"林予"（`ending_linyu_*`）；
7. 读档后 `relations` 还在；
8. **v2.0 旧档导入不报错**，人物卡显示"陌生 0"；
9. 同种子两次运行，好感序列完全一致（rng 未被污染）；
10. `npm test` 全绿；
11. `accept/cc1` 全绿；
12. 控制台无报错。

### CC2 · 扩展到 4 角色（第 2–3 周）

| 角色 | 任务 | 产出 |
|---|---|---|
| **A** | ① `storyline.js` 状态机（步骤推进 / 窗口过期 / `breakOn` 失败分支）；② `engine.enterTurn` 接入（优先级：固定 > 剧情线 > 负债 > 随机）；③ 结局条件组合（`relationAtLeast` + `flagEquals`）；④ 剧情线单测 + 40 回合回归 | 剧情线引擎（5d） |
| **B** | ① 绑定剩余 18 个现有事件（程一 5 / 周野 5 / 陈老师 5 / 室友 3）；② 新增 12 个事件；③ 8 条角色结局（2 攻略线 × 3 + 2 配角 × 1）；④ 好感数值调平（增速/阶段阈值/事件权重） | 内容量产（6d） |
| **C** | ① 4 角色立绘（先"复用现有图 + 色调"占位，再替换正式图）；② 表情切换（按 `lines[].emotion` 交叉淡入）；③ 人物卡支持多角色切换；④ 台词行样式（说话人名牌 + 高亮当前说话人） | 演出基础（5d） |
| **D** | ① `accept/cc2`；② 内容 lint：`charId/eventId/optionId` 引用完整性、好感极值、孤立事件（有权重但永不可达）、`next` 指向不存在的选项；③ 模拟器加"好感曲线/攻略线完成率"；④ CI 接 cc 门禁 | 质量门（4d） |

**CC2 门禁**：
- `accept/cc2` 全绿；`node tools/sim.mjs --runs 200` 输出：每条攻略线完成率 ≥ 40%、每条角色结局 ≥ 2%、无孤立事件；
- 4 角色在浏览器里各能走完 1 条线（A 逐条手测，截图留档）；
- 旧档、坏档、跨设备导入导出的回归用例仍全绿。

### CC3 · 打磨与发布（第 4 周）

| 角色 | 任务 | 产出 |
|---|---|---|
| **A** | 集成回归（40 回合 × 4 条线）、性能（单回合 < 500ms）、`docs/验收/总报告-角色系统.md`、v2.1.0 tag | 发布（3d） |
| **B** | 数值最后一轮调平 + 文案口吻统一（同一角色用词/称呼一致）+ 角色口吻卡 | 定稿（3d） |
| **C** | 表情/转场/音乐切换打磨、响应式（375/768/1366）、演示截图与录屏 | 视觉定稿（3d） |
| **D** | CI 全量 + `CONTRACT/DATA_DICTIONARY/README/assets/README` 同步 + 部署复核（Pages 刷新无 404） | 工程收口（3d） |

**CC3 门禁**：生产站 4 条线各走一遍；旧档导入成功；`npm test` + `accept/cc1..cc3` 全绿；`docs/验收/CC*-*.md` 补齐。

---

## 7. 每周门禁命令（A 验收时直接跑）

```bash
npm test                                  # smoke + verify_ui，不许回归
node tests/accept/cc1.mjs                 # 本周门禁（D 周一先红）
node tests/unit/a-relation.mjs            # A：好感/阶段边界
node tests/unit/b-characters.mjs          # B：事件绑定/前置/权重
node tests/unit/d-schema-characters.mjs   # D：配置负向用例
node tools/sim.mjs --runs 200 --report affinity   # D：好感与结局分布
grep -rn "Math.random" src/core src/events src/config   # 必须为空
grep -rnE "localStorage|indexedDB|document|window\." src/core src/events   # 必须为空
```

---

## 8. 内容产能方案（B 是唯一瓶颈，必须给他减负）

**核心思路：先绑定，后新增。**

| 动作 | 数量 | 成本 | 效果 |
|---|---|---|---|
| 给现有事件加 `charId` + 改 1–2 句（"ta"→"林予"） | **24 个** | 约 3 人日 | 角色立刻"有存在感"，几乎不花文案 |
| 新写"关系推进"事件（初识确认/升温/冲突/收束） | **16 个** | 约 4 人日 | 让好感有台阶，而不是随机攒 |
| 角色专属结局 | **8 条** | 约 1 人日 | 结局读取 flag/好感，玩家能看到自己那条线 |

**24 个现有事件的绑定建议**（B 在 CC0 出表确认）：

| 角色 | 绑定事件 | 说明 |
|---|---|---|
| 林予（可攻略） | `ev_r23` 邂逅、`ev_r24` 聚餐、`ev_r25` 散步、`ev_r26` 吵架、`ev_r33` 甜蜜自习、`ev_r34` 走出失恋、`ev_r05` 失恋、`ev_r15` 告白 | 已有完整恋爱链，只需把"ta"变成"她" |
| 程一（可攻略） | `ev_r16` 竞赛、`ev_r30` 组队、`ev_r31` 成绩、`ev_r17` 实习、`ev_r32` 转正 | 学业/就业线，与保研互斥 |
| 周野（配角） | `ev_r03` 马拉松、`ev_r40` 体测、`ev_r29` 健身卡、`ev_r36` 社团竞选、`ev_r42` 例会 | 社团/运动线 |
| 陈老师（配角） | `ev_r12` 导师约谈、`ev_r09` 讲座、`ev_r35` 保研 | 学业线，保研资格门 |
| 室友（配角，可选） | `ev_r07` 夜聊、`ev_r37` 火锅、`ev_r41` 外卖 | 生活线，D 写 3 条当 schema 样板 |

**协笔规则**（解决"一个人写 40 个事件"的问题）：
1. A/C 可写初稿，放 `docs/内容/<线>-初稿.md`（含 `charId`、`lines`、effects 草案）；
2. **`config/events.json` 永远只有 B 改**——协笔交 md，B 定稿并提交，避免四人同时改一个 JSON 的合并灾难；
3. C 额外提供「演出标注」（emotion / 转场 / 音乐），写在初稿 md 里，B 合并。

**不要拆 `events.json`**：本周期总量约 70 条，单文件仍可控；超过 100 条再按线拆分，届时由 D 改 loader 做合并加载。

---

## 9. 立绘与素材方案（C，无美术也能交付）

| 情形 | 做法 | 有效期 |
|---|---|---|
| 没有正式立绘 | 复用现有 9 张 + CSS 色调/裁剪区分，或纯色剪影 + 名字首字 | 可撑到 CC2 |
| 有正式立绘 | 900×1400 透明 WebP，`assets/char/<charId>_<emotion>.webp`，每角色 1 基础 + 3 表情 | CC1 起逐步替换 |
| 缺图 | 自动回落（`ART.enabled` + 渐变占位已实现，`ui.js:46-50`） | 永久兜底 |

- 版权：只使用自制 / CC0 / 已授权素材，来源记进 `assets/README.md`（D 复核）。
- 本周期验收以**功能**为主：表情差分只要求"能切换"，不要求每角色都齐。

---

## 10. 风险与裁决策略（A 每周看一眼）

| 风险 | 触发信号 | 对策 | 决策人 |
|---|---|---|---|
| B 产能不足 | 周三还差 3 个事件 | 立即降级为"2 条攻略线 + 配角只绑定不新增" | A |
| 契约漂移 | 一周出现 2 次 `[契约变更]` | 新字段推迟到下一周期，先冻结当前 5 项 | A |
| 好感数值失衡 | 模拟器显示 3 回合就满好感 / 40 回合好感永远是 0 | B 调增速与阈值，D 重跑 200 局 | B + D |
| 旧档失效 | 导入 v2.0 存档报错 | `migrateSave` 必须先于 relations 合入；冒烟加"旧档往返"用例 | D |
| C 空等 A | 周三还调不了 UI | 用 `dev/ui-lab.html` + fixtures 造数据，A 最后只换数据源 | C |
| 内容返工 | 结构改一次要重写 40 个事件 | CC0 冻结 `storylines` 结构；**先写林予 1 条线验证，再量产另外 3 条** | A + B |
| 结局优先级打架 | 角色结局与属性结局同时命中 | 用 `endingPriorityOrder: 'asc'` 重排，角色真结局 priority 1–8 | B |

---

## 11. 裁剪方案（剩 2 周 / 1 周怎么办）

| 剩余时间 | 保留 | 砍掉 |
|---|---|---|
| **2 周** | CC0（合并进第一天）+ CC1 + CC2 的"另 1 条攻略线" | 延迟事件、章节卡、表情差分（先 1 张基础图）、配角新增事件（只绑定）、内容 lint |
| **1 周** | **林予线端到端**（CC0 半天 + CC1 四天） | 其余 3 角色、剧情线状态机（先用固定 `flags` 链）、人物卡多角色切换 |
| **3 天** | 只做"绑定 24 个现有事件 + 好感数值 + 人物卡" | 剧情线引擎、新增事件、专属结局（用现有结局 + flag 条件顶） |

---

## 12. 四人整周期任务总览（可直接复制进群）

### A
- CC0 契约附录 C（1.5d）→ CC1 relation.js + 结局条件 + engine/main 接线 + 单测（4d）→ CC2 storyline.js + enterTurn + 回归（5d）→ CC3 发布与验收报告（3d）
- 每周固定：周一定任务卡、周五预验收、周六写 `docs/验收/CC<N>-<角色>.md`、周日 `dev → main`
- 红线：只有你改 `main.js`；只调 B 的规则函数，不把规则写进 engine

### B
- CC0 角色↔事件映射表 + characters 草案（1d）→ CC1 林予线（3d）→ CC2 绑定 18 个 + 新增 12 个 + 8 条结局 + 数值调平（6d）→ CC3 定稿（3d）
- 你只改：`config/{characters,storylines,events}.json` 内容、`effects.js`、`eventManager.js`、`tests/unit/b-*.mjs`
- 红线：`effects.relation` 必须走 `applyEffects`；好感数值全部来自 `characters.json`，不硬编码

### C
- CC0 视觉规格 + 线框（1d）→ CC1 人物卡 + 好感提示 + lines 渲染 + ui-lab（3d）→ CC2 立绘/表情/多角色切换（5d）→ CC3 打磨与截图（3d）
- 你只改：`src/ui/ui.js`、`css/style.css`、`assets/char/*`、`dev/ui-lab.html`
- 红线：UI 零 import、只经 callbacks、绝不改 `state`（好感只读 `view.relations`）

### D
- CC0 schema 草案 + fixtures + `accept/cc1` 先红（1.5d）→ CC1 schema 校验 + `migrateSave` + 门禁转绿（3d）→ CC2 `accept/cc2` + 内容 lint + 模拟器（4d）→ CC3 CI + 文档 + 部署（3d）
- 你只改：`src/config/{loader,schema}.js`、`src/storage/storage.js`、`tests/**`、`config/*.json` 结构、`docs/**`（除 CONTRACT/验收/分工）、`.github/**`
- 红线：schema 必须校验交叉引用（`charId/eventId/optionId`），否则内容错误只能靠玩到才发现

---

## 附录 A · CC1 周一可直接发群的任务卡

**A（CC1）**
> 目标：好感与结局条件打通，林予线端到端能跑。
> 1. 新增 `src/core/relation.js`：`changeAffinity(state, charId, delta, config)`、`stageOf(state, charId, config)`（按 `characters.json` 的 `stages.at` 取最高档）、`syncRomance(state)`（lover 阶段 → `player.romance='dating'`）。
> 2. `ending.js` 的 `evaluateCondition` 增加 `relationAtLeast`（`{charId, value}`）。
> 3. `engine.newGame` 按 `characters.json` 初始化 `player.relations`；`resolvePendingEvent` 不直接写 relations（由 `effects.applyEffects` 统一写），只调用 `relation.syncRomance`。
> 4. `buildViewModel` 增加 `relations`（含 `stageName`）；`main.js` 把 `view.relations/affinityHints` 传给 UI，新增 `callbacks.onOpenRelations`。
> 5. 写 `tests/unit/a-relation.mjs`：好感边界（0/100）、阶段跃迁（15/35/60）、`relationAtLeast` 真/假、lover 同步 romance、40 回合回归不抛错。
> 产出 + 自测输出贴 PR；**不要动 B/C/D 的文件**。

**B（CC1）**
> 1. `config/characters.json`：只写 `linyu` 一名角色（字段见 CONTRACT 附录 C §2.1）。
> 2. `config/storylines.json`：只写 `romance_linyu` 一条线（4 步，见 §2.2）。
> 3. `config/events.json`：`ev_r23–26` 加 `charId: "linyu"` 并把"ta"改成"林予"；其中 2 个事件补 `lines: [{speaker, text, emotion}]`；新增 2 个事件（`ev_cr_linyu_confess` 等）。
> 4. `effects.js` 支持 `effects.relation`；`eventManager.availableOptions` 支持 `requires.relationAtLeast` 并给可读 reason。
> 5. `tests/unit/b-characters.mjs`：绑定关系、好感增减、前置置灰、权重不受影响。
> 产出：`accept/cc1` 中属于内容侧断言转绿。

**C（CC1）**
> 1. 新建 `dev/ui-lab.html`：注入 `tests/fixtures/state.relations.json` 造的假 state，独立调试 UI（不依赖 A 的集成）。
> 2. `ui.js` 增加 `showRelationPanel(relations, characters)`：角色卡（立绘占位 + 好感条 0–100 + 阶段名 + 已解锁事件列表）。
> 3. 选项上显示好感提示（来自 `view.affinityHints`）；事件结算后对话框下方飘 `▲ 林予 好感 +8`（复用 `effectChips` 样式）。
> 4. `showEvent` 支持 `lines` 逐段播放（打字机 + 点击继续），播完再显示选项；旧 `text` 格式保持兼容。
> 5. 立绘缺图时按降级链回落，不出现破图。
> 红线：零 import、只读 view。

**D（CC1）**
> 1. `schema.js` 校验 `characters.json`/`storylines.json`：id 唯一、`stages.at` 递增、`likedEvents` 引用存在、`steps[].eventId` 存在、`next` 的 key 必须是该事件的 option id、`charId` 必须存在。
> 2. `storage.js`：`migrateSave` 给旧档补 `player.relations`（按 characters 初始化 0/stranger）与 `storylines`；`SAVE_VERSION → 2.1.0`。
> 3. `tests/accept/cc1.mjs`（周一先红）：新游戏初始化 relations、好感变化、阶段跃迁、结局条件、旧档迁移、同种子一致性。
> 4. `tests/fixtures/state.relations.json` + `tests/unit/d-schema-characters.mjs`（≥10 条负向用例）。
> 产出：`accept/cc1` 全绿。

---

## 附录 B · 文件清单（一眼看清谁动哪个）

```
新增
  config/characters.json            D 结构 / B 内容
  config/storylines.json            D 结构 / B 内容
  src/core/relation.js              A
  src/core/storyline.js             A
  assets/char/<charId>_*.webp       C
  dev/ui-lab.html                   C
  docs/内容/<线>-初稿.md            B（新增目录）
  tests/accept/cc1..cc3.mjs         D
  tests/fixtures/state.relations.json  D
  tests/unit/a-relation.mjs         A
  tests/unit/b-characters.mjs       B
  tests/unit/d-schema-characters.mjs D

修改
  src/core/state.js engine.js ending.js main.js        A
  src/core/effects.js src/events/eventManager.js       B
  config/events.json（绑定 + 新增）                     B（结构 D）
  src/ui/ui.js css/style.css                            C
  src/config/{loader,schema}.js src/storage/storage.js  D
  docs/CONTRACT.md docs/验收/**                          A
  docs/DATA_DICTIONARY.md README.md assets/README.md     D
```

---

> 落款约定：所有 PR 标题 `A-CC1: relation.js 与结局条件`、`B-CC1: 林予线内容`、`C-CC1: 人物卡与好感 UI`、`D-CC1: schema 与迁移`；验收记录 `docs/验收/CC<N>-<角色>.md`，模板沿用 `docs/验收/_模板.md`。
