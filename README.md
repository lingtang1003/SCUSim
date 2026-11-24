# SCUSim · 我的大学四年，果然有or没问题！

基于**配置驱动**的校园生活模拟 Web 游戏。原生 ES2020 **ES Modules**，无前端框架、无打包器、**无构建步骤**，纯静态资源，可直接部署到 Cloudflare Pages。

---

> 声音：系统设置里可分别调节「背景音乐 / 音效」音量，音乐文件放到 `assets/audio/` 即生效。

> 字体：四支汉仪字体自托管 + 子集化，两支标题字体内联、两支正文字体预加载，`font-display: block` 避免闪烁。

> 玩法：在宿舍起步，点右上角地点打开校园地图，去不同地方做不同的事；行动点用完自动回宿舍。
>
> 换地点规则：**一个行动周期（4 个行动点）内可以随时换地点**，换地点**不消耗行动点**；
> 地图弹窗顶部的「**江安 / 望江**」页签可以在周内自由切换两个校区的地图，站在江安也能翻到望江去上课；
> 行动点用完之后这一周就不能再换（图钉会标「行动点用完」），自动进入下一周。
> 弹窗上会显示「行动点 x / 4 · 换地点不消耗行动点（当前：宿舍 · 地图：望江）」。

## 一、项目简介

- **玩法**：扮演一名四川大学新生，从入学到毕业（**回合制，共 40 回合 ≈ 8 学期**，每 5 回合一学期）。
- **标签**：开局六步（姓名 → 性别 → 学院 → 属性 → 标签 → 立绘），从 12 个性格标签里选 3 个；
  **每条标签都有属性加成与代价**（如「吃货」社交 +2 / 健康 +1 / 金钱 −2），三条的修正直接叠加到开局属性，
  标签页会显示每个标签的增减与「属性合计」，右侧预览同步刷新。
- **驱动方式**：所有数值与规则（属性、动作、事件、结局等）**全部外置到 `config/*.json`**，逻辑层只负责计算。
- **形态**：纯静态前端，**默认无后端、无账号、无云同步**；跨设备同步属第二阶段规划。
- **技术栈**：原生 HTML / CSS / JavaScript（ES Modules），仅依赖浏览器自身能力，零第三方运行时依赖。

### UI 形态：橙光式视觉小说

界面不是表格里点按钮，而是**全屏场景 + 立绘 + 底部对话框 + 中央选项条**：

- **本周行动即选项**：六个行动以半透明选项条立在画面上，点下去切到对应场景（教室 / 活动室 / 操场 / 便利店 / 商业街 / 宿舍），旁白与属性变化写进对话框。
- **立绘**：创建角色时六选一，游戏中常驻画面左侧；设置里可随时更换（存进存档的 `player.appearance`）。
- **菜单**：右上 ☰ 打开右侧抽屉——保存进度 / 读取进度 / 剧情回放 / 系统设置 / 商城（预留）。
- **事件**：触发时压暗场景，事件名 + 选项 + 正文以同样的对话框呈现。
- **素材**：背景与立绘放在 `assets/bg/`、`assets/char/`，命名与规格见 [`assets/README.md`](assets/README.md)；
  目前已接入 6 张场景图 + 2 个立绘，缺图时自动回落到 CSS 渐变 / 占位框。
- 规范与改法见 [`docs/UI_视觉与交互规范.md`](docs/UI_视觉与交互规范.md)。
- 配色 / 组件 / 动效的设计系统见 [`docs/DESIGN.md`](docs/DESIGN.md)。

---

## 二、设计红线（务必遵守）

- **core 不碰 DOM / storage / UI**：`src/core/**`、`src/events/**` 为纯逻辑，可在 Node 直接测试，不得引用 DOM、localStorage、IndexedDB。
- **rng 单入口**：随机源统一来自 `src/core/rng.js`，由协调层（`src/main.js`）持有**唯一实例**并在整局中复用，保证随机可复现（读档用 `rng.setState(state.rngState)` 还原）。
- **数值全配置**：任何平衡数值都在 `config/*.json`，逻辑代码不硬编码。
- **UI 零 import**：`src/ui/ui.js` 不引入任何 `src/core|events|storage|config` 模块；状态变更**只经 callbacks**，绝不自行改写 `GameState`。

---

## 三、本地运行

### 方式一（推荐）：`npm run dev`

```bash
npm run dev
# 终端会打印：SCUSim dev server running at http://localhost:5173
# 浏览器打开 http://localhost:5173
```

### 方式二：任意静态服务器

```bash
node server.js            # 仓库内置的纯 Node 静态服务器（端口 5173，可用 PORT 环境变量改）
# 或
python3 -m http.server 5173
```

> ⚠️ **必须通过 HTTP 访问，禁止直接双击 `index.html`（即 `file://` 协议）。**
> 原因：游戏使用 `<script type="module">` 加载 ES Module，并在运行时用 `fetch()` 动态读取 `config/*.json`。
> 在 `file://` 协议下，浏览器会拦截跨文件的 ES Module 加载与 `fetch()` 本地文件（CORS / 模块安全策略），导致**白屏或 "Failed to load module" / "CORS" 报错**。
> 因此请务必用上面的 HTTP 服务器方式启动。

---

## 四、测试

测试为**纯 Node 逻辑测试**，无需浏览器，也不依赖网络。

```bash
npm test
# 等价于：node tests/smoke.mjs && node tests/verify_ui.mjs
```

| 脚本 | 覆盖内容 |
| --- | --- |
| `tests/smoke.mjs` | 配置校验、规模下限、固定种子跑满 40 回合、同种子复现性、存档往返、core/events 静态红线（`Math.random`/存储/DOM 零引用）。 |
| `tests/verify_ui.mjs` | UI 模块零 import / 不碰 core/storage、main.js 顶层不访问 DOM、最小 DOM 桩下 `createController` 启动与完整回合驱动。 |
| `tests/verify_m1.mjs` | 引擎层（rng/state/engine/economy/academy/ending/eventManager）M1 专项边界与异常用例（独立脚本，不修改其它测试）。 |

`verify_m1.mjs` 当前**未并入** `npm test`（以加快日常反馈），需单独运行：

```bash
node tests/verify_m1.mjs
```

---

## 五、项目结构

```
SCUSim/
├─ index.html              # 入口 HTML（引用 css/style.css 与 src/main.js，均为相对路径）
├─ server.js               # 本地静态开发服务器（纯 Node，非生产后端，不随 Pages 部署）
├─ package.json            # scripts: dev / test
├─ config/                 # 六份驱动数值与规则的配置（全部 JSON）
│  ├─ balance.json         # 总回合数、行动点、属性点数、考试与随机事件参数
│  ├─ colleges.json        # 学院列表
│  ├─ tags.json            # 性格标签列表
│  ├─ actions.json         # 可行动作列表
│  ├─ events.json          # 固定事件 + 随机事件
│  └─ endings.json         # 结局与判定条件
├─ assets/                 # 美术素材（可选；未放图时用 CSS 渐变兜底）
│  ├─ README.md            # 背景 / 立绘的命名、尺寸、启用方式
│  ├─ bg/                  # 场景背景（1920×1080 jpg）
│  └─ char/                # 立绘（900×1400 透明 png）
├─ src/
│  ├─ main.js              # 协调层（装配 engine+storage+ui，持有唯一 rng 实例，负责路由/导入导出）
│  ├─ core/                # 核心引擎（纯逻辑，禁碰 DOM/storage/UI）
│  │  ├─ rng.js            # 随机源（单入口，可存状态复现）
│  │  ├─ state.js          # 游戏状态构造与深拷贝
│  │  ├─ engine.js         # 新游戏/行动/推进/事件结算/结局评估
│  │  ├─ economy.js        # 经济与月度收支
│  │  ├─ academy.js        # 考试与学业警示
│  │  └─ ending.js         # 结局判定
│  ├─ events/              # 事件管理
│  │  └─ eventManager.js   # 固定事件触发 + 随机事件权重抽取
│  ├─ config/              # 配置加载与校验
│  │  ├─ loader.js         # 浏览器端 fetch(import.meta.url) 加载 + 校验（可注入 reader 解耦 Node 测试）
│  │  └─ schema.js         # 纯校验（Node 可直接用）
│  ├─ storage/             # 持久化（localStorage，降级内存）
│  │  └─ storage.js        # 存档/图鉴/设置 + .scusim 导入导出
│  └─ ui/                  # 表现层（零 import，只经 callbacks 改状态）
│     └─ ui.js
├─ css/
│  └─ style.css            # 全部样式（视觉小说皮肤：红白为主、黑色为辅）
└─ tests/                  # 纯 Node 测试（见上文）
```

> 美术素材是**可选的**：`assets/bg/`、`assets/char/` 为空时，场景用 CSS 渐变、立绘用虚线占位框，
> 游戏流程完全不受影响；放图后把 `src/ui/ui.js` 顶部的 `ART.enabled` 改成 `true` 即接入。

### 四人分工（原始交付标签 A / B / C / D）

- **A · 协调层**：`src/main.js` — 装配三大模块、持有唯一 rng、负责路由与导入导出。
- **B · 核心引擎**：`src/core/*` + `src/events/*` — 一切游戏逻辑，纯函数、无 DOM。
- **C · 表现层**：`src/ui/ui.js` — 界面与交互，零 import。
- **D · 配置与存储**：`src/config/*`（loader + schema）+ `src/storage/*`（持久化）。

> 注：以上标签来自交接文档；当前 M5（部署准备 + 文档）由工程师统一收口，**不改动上述模块的游戏逻辑**。

---

## 六、部署到 Cloudflare Pages

本项目无构建步骤、无服务端逻辑，是纯静态站点，非常适合 Cloudflare Pages。

**关键前提（已满足，请继续保持）**：所有资源引用均为**相对路径**；配置加载使用 `import.meta.url` 相对解析。因此无论是 Pages 默认域名 `*.pages.dev`、预览分支域名，还是**自定义域名 / 子路径**部署，路径都能正确解析。

### 方式①：连接 Git 仓库（推荐，零命令）

> 适用于你自有 Git 仓库（GitHub / GitLab 等）。本交付环境**未提交 git**，读者自行连接自己的仓库即可。

1. 登录 Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
2. 选择你的仓库。
3. 构建设置：
   - **Framework preset**：选择 **None**（纯静态 / 无框架）。
   - **Build command**：**留空**（没有构建步骤）。
   - **Build output directory**：填**仓库根目录**——即包含 `index.html` / `src` / `css` / `config` 的那一层，可填 `.`。
4. 点击 **Save and Deploy**。Pages 会把仓库按原样作为静态文件发布。
5. 之后每次 push 到默认分支会自动重新部署。

### 方式②：本地用 `wrangler` 直接发布静态目录（无需 Git）

```bash
# 安装（一次）
npm install -g wrangler        # 或直接使用 npx，无需写进 package.json
# 发布当前目录（仓库根，含 index.html / src / css / config）
npx wrangler pages deploy . --project-name scusim
```

### 自定义域名与 HTTPS

- 在 Pages 项目 **Custom domains** 中添加你的域名，Cloudflare 会自动签发并续期 **HTTPS** 证书，无需自建证书。

### 部署红线（已满足，请继续保持）

- **不要**把任何密钥 / API Key 写进源码。当前设计全部数值在 `config/*.json`，无第三方密钥，天然满足。
- **不要**在代码里写死 `localhost`、`127.0.0.1` 或绝对路径 `/...`。本仓库已全量使用相对路径 + `import.meta.url`，子路径部署也能工作。
- 因仅有单页 `index.html`，无需配置 SPA fallback / `_redirects`；后续若新增多页路由再补充。

---

## 七、浏览器本地存储限制（重要）

- 存档、图鉴、设置保存在**当前浏览器本地**（`localStorage`，纯浏览器 API）：
  - 通常有**容量上限**（多数浏览器约 5 MB / 域名的配额；本游戏数据很小，基本不会触顶）；
  - **清除站点数据 / 浏览器缓存会丢失**存档；
  - **更换浏览器、设备或隐身模式**下不可见。
- **默认无云端同步、无账号、无后端**：跨设备不会自动同步。
- **刷新不丢画面**：刷新页面会自动回到上次的画面 —— 在游戏里刷新就是继续玩（含未结算事件的弹窗），
  只有你主动点「返回主页」或「清除存档」之后，刷新才会停在标题页。记忆键是 `scusim:route`，和存档同域。
- **跨设备迁移方案**：游戏内 **📤 导出存档** 得到 `.scusim` 文件 → 在另一设备 **📥 导入存档**。
- 完整说明见 `src/storage/storage.js`：纯函数 `serializeSave/deserializeSave` 在 Node 下亦可直接测试（不依赖浏览器）。

---

## 八、角色系统（v2.1）

40 个星期里，除了刷属性，你还会遇见 6 个人——**全部是同校学生（同级 / 学长学姐），没有任何师生线**，也**不限玩家性别**。

| 角色 | 学院 · 年级 | 一句话 |
|---|---|---|
| 江叙 | 计算机学院 · 大三 | 独立游戏社技术担当，白天睡觉晚上写代码 |
| 顾迟 | 法学院 · 大三 | 校辩论队队长，说话像在开庭 |
| 林予 | 文学与新闻学院 · 大二 | 校报摄影兼写手，写诗但不给人看 |
| 苏晚 | 艺术学院 · 大二 | 钢琴专业，怕吵、怕生、怕上台 |
| 周野 | 体育学院 · 大二 | 田径队，跑完十公里还能再跑十公里 |
| 唐棠 | 外国语学院 · 大三 | 学生会外联 / 话剧社台柱 |

- **第 2 回合的迎新晚会**是全局分支点：6 个选项 +「一个人待着」，选谁就开启谁的剧情线（一局只走一条）。
- 每条线 3–4 步、按回合窗口强制推进，门槛是好感（8 / 20 / 38）；最后一步决定 `done` 还是 `broken`。
- 好感 0–100，阶段 陌生 → 熟识 → 朋友 → 知己 → 恋人；HUD 有剧情线进度，右上 ♡ 或菜单「关系」看人物卡。
- 事件改成**台词分段演出**（旁白 / 角色台词交替 + 表情），选项上提示好感变化，结算后对话框下方出现「▲ 林予 好感 +10」。
- 结局从 6 条扩到 **18 条**：6 条角色真结局 + 6 条「温暖 / 遗憾」结局 + 6 条学业生活结局；`priority` 升序，角色线优先。
- 全部配置驱动：`config/characters.json`、`config/storylines.json`、`config/events-characters.json`（内容分片，loader 合并）。
  删掉这三张表，角色系统自动关闭，游戏回到 v2.0 行为。

> 设计、字段表、加角色的 8 步流程、立绘规格见 [`docs/角色系统.md`](docs/角色系统.md)；契约增量见 `docs/CONTRACT.md` 附录 C。
> 立绘放在 `media/characters/`（玩家自己的立绘仍在 `assets/char/`）。

---

## 九、已知占位 / 待团队拍板

以下为仍未敲定的数值与字段，留待策划 / 数值同学确认（**不影响部署与运行**）：

1. **属性 0 起 20 点**：`balance.attributePointTotal = 20`，创建角色默认四项各 5（总和 20）；属性下限是否允许 0、UI 初始分配初值待定。
2. **金钱语义（Q1）**：`balance.walletPerMoneyPoint` 仍未定；事件金额是「元」量级、属性是「点」量级，两套并存。
3. **月度收支净额为 0**：`monthlyIncome = monthlyExpense = 2000`，经济压力还没真正建立起来。
4. **角色表情差分**：目前用 CSS 滤镜模拟（smile / sad / shy / surprise），正式差分图到位后按 `lines[].emotion` 切图。
5. **立绘规格**：6 张统一 810×1080 WebP（63–89 KB）；后续换图按同规格覆盖 `media/characters/<id>.webp` 即可，不用改代码。

### 字段命名提示（供数值同学参考）

- 已存在：`balance.randomEventBaseChance`、`balance.exam.*`、`balance.affinityMax`、`balance.endingPriorityOrder`。
- 待补：`walletPerMoneyPoint`（金钱语义）。
- `endings.condition.type` 枚举：`attributeAtLeast` / `gpaAtLeast` / `warningTrue` / `flagEquals` / `tagIncludes` / `collegeIs` /
  `eventDone` / `relationAtLeast` / `lineStatus` / `lineDone` / `all` / `any` / `default`。

---

## 十、其它 / 参考文档

- 本地静态服务器（`server.js`）仅用于开发，不随生产部署；生产环境只读静态文件。
- 更完整的方案与架构见 `docs/开发方案.md`、`docs/架构任务分解.md`（非部署产物，可忽略）。
- 设计约束（无构建、无框架、相对路径）见 `docs/开发方案.md` §1 / §5。
- 角色系统见 [`docs/角色系统.md`](docs/角色系统.md)；剧情化优化路线见 [`docs/剧情化优化路线.md`](docs/剧情化优化路线.md)。

## 字体（改剧情后必看）

正文/标题字体是子集，源字体备份在 `C:\Users\19337\Documents\SCUSim-字体源\`。
改完剧情跑 `npm run fonts:check`：有缺字（生僻字）再 `npm run fonts` 重打，否则不用管。

## 课程与考试科目

期末考试科目按「学院 + 学期」取：`config/courses.json` 的 `public`（公共课，全校一致）+ `colleges[学院]`（专业课，来自各学院真实课表）。公共课改名只改 `public` 一处即可；缺配置时考试回退 `balance.exam.subjects`。
