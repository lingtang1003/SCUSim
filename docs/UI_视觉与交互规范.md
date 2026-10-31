# SCUSim · UI 视觉与交互规范（视觉小说形态）

> 对应代码：`src/ui/ui.js`（表现层） + `css/style.css`（皮肤）
> 归属：C · 表现层。红线不变：**UI 零 import、只读 state、状态变更只经 callbacks**。
> 素材契约见 `assets/README.md`。

---

## 1. 一句话定位

从"表单式数值游戏"改成**橙光式视觉小说**：全屏场景 + 立绘 + 底部对话框 + 中央选项条 + 右侧菜单抽屉。
所有 40 回合的玩法（行动点、事件、考试、结局）都保留，只是换成"读故事 → 做选择"的表达。

---

## 2. 界面清单

| 界面 | 入口 | 结构 | 关键类名 |
|---|---|---|---|
| 标题页 | 启动 / 返回标题 | 徽记 + 标题 + 竖排菜单 + 导入存档 | `.vn-title` `.vn-menu-btn` |
| 创建角色（6 步） | 开始新游戏 | 左：立绘预览 + 角色摘要；右：步骤表单 | `.vn-create` `.vn-step` `.vn-opt` `.vn-tag` |
| 主舞台 | 新游戏 / 读档 | 背景层 + 立绘 + HUD + 选项条（2 列 × 3 行）+ 对话框 | `.vn-stage` `.vn-sprite` `.vn-hud` `.vn-choices` `.vn-dialogue` |
| 事件弹层 | 回合触达事件 | 暗化场景 + 事件名 + 选项 + 对话框正文 | `.vn-event` `.vn-choices--event` |
| 结局 | 第 40 回合 | 整屏渐变 + 结局卡 + 属性回顾 | `.vn-ending` |
| 菜单抽屉 | HUD ☰ | 右侧玻璃面板：保存/读取/回放/设置/商城 | `.vn-drawer` `.vn-scrim` |
| 剧情回放 | HUD 📖 / 抽屉 | 对话历史 + 行动记录 | `.vn-modal` `.vn-backlog` |
| 结局图鉴 | 标题页 | 已解锁/未解锁列表 | `.vn-gallery` |
| 系统设置 | 标题页 / 抽屉 | 减弱动效 + 换立绘 | `.vn-setting` `.vn-switch` |

---

## 3. 主舞台的分层（z 轴）

```
.vn-bg            固定铺满：__paint（渐变兜底）→ __art（美术图）→ __veil（氛围/压暗）
.vn-sprite        左下角立绘（无图时显示虚线占位框）
.vn-hud           顶栏：回合 / 学期 / 行动点 …… 场景名 / 💾 📖 ☰
.vn-choices       底部上方的行动条（AP=0 时只剩金色「进入下一周」）
.vn-dialogue      底部对话框：说话人牌 + 正文 + 效果 chips + ▼
```

**选项条布局**：6 个基础行动固定 **2 列 × 3 行**（`.vn-choices` 用 grid，整体居中偏右，给左侧立绘让位；
`left: 57%`）。AP 用尽时金色「进入下一周」跨两列（`grid-column: 1 / -1`）。
**突发事件的选项不受此影响**：`.vn-choices--event` 强制单列，居中显示在对话框上方。
窄屏（≤560px）时两列布局整体移到顶部，避免压住立绘的脸。

行动 → 背景的映射在 `ACTION_SCENE`（图已就位，`ART.enabled = true`）：

| 行动 | 场景键 | 背景文件 | 画面 |
|---|---|---|---|
| 上课学习 `study` | classroom | `assets/bg/study.jpg` | 第一教学楼教室 |
| 社团活动 `club` | clubroom | `assets/bg/clubroom.jpg` | 社团活动室 · 照片墙 |
| 体育锻炼 `exercise` | track | `assets/bg/track.jpg` | 体育馆羽毛球馆 |
| 兼职赚钱 `parttime` | store | `assets/bg/store.jpg` | 地铁 8 号线站台 |
| 社交娱乐 `socialize` | street | `assets/bg/street.jpg` | 校外火锅店 |
| 休息放松 `rest` | dorm | `assets/bg/rest.jpg` | 回宿舍的小路 |

立绘（`APPEARANCES`）：`m_hoodie`（深蓝卫衣 · 男）、`f_long`（黑长直 · 女），
文件在 `assets/char/*.webp`，创建第 6 步二选一，设置里可换。

> 每次点击行动：切背景 → 台词换成该场景的旁白 → 对话框右侧显示本次属性变化 chips。

---

## 4. 状态与数据流

```
main.js（唯一协调层）
  ├─ 持有 state / rng
  ├─ render(state, { availability, actionId, actionSeq })
  │     └─ UI 只读：切场景、写台词、渲染选项
  └─ callbacks：onAction / onAdvance / onResolveEvent / onSave / onLoadGame
                onChangeAppearance / onExport / onImport / onOpenMenu ...
```

UI 内部视图状态（**不是** GameState，不参与结算、不进存档）：
`appearanceId / scene / speaker / text / effects / history / reduceMotion`。

唯一写进 GameState 的外观字段：`player.appearance`，由 `main.js` 在
`onNewGame` / `onChangeAppearance` 时写入（纯展示，不参与任何公式）。

---

## 5. 交互与可访问性

- 所有可点击元素都是原生 `<button>`；`aria-label` 标注图标按钮（💾 / 📖 / ☰）。
- `Esc` 关闭任意弹层（菜单抽屉 / 弹层 / 设置）。
- 设置里的「减弱动效」= `documentElement.classList += reduce-motion`，
  UI 的打字机与 CSS 动画都会同时关掉；系统级 `prefers-reduced-motion` 也尊重。
- 焦点环：`focus-visible` 双层高亮，深色场景上仍清晰。
- 对话框正文 `19px / 1.95`，正文最小高度 2.6em，避免单行时抖动。

---

## 6. 响应式断点

| 断点 | 变化 |
|---|---|
| ≥ 881px | 创建页左右两栏；立绘 380px；选项条 430px |
| ≤ 880px | 创建页单栏（预览横排）；立绘 300px；字号降一档 |
| ≤ 560px | HUD 折行、只留行动点圆点；隐藏立绘占位框；对话框 96vw；选项条 88vw |
| 高度 ≤ 640px | 选项条最大高 42vh，对话框压缩 |

---

## 7. 改皮肤 / 加内容的最小改法

| 想改什么 | 改哪里 |
|---|---|
| 配色、玻璃拟态、圆角、阴影 | `css/style.css` §1 设计令牌 |
| 场景渐变兜底 | `css/style.css` `.vn-scene--<key>` |
| 台词、旁白、行动效果文案 | `src/ui/ui.js` 的 `ACTION_FLAVOR` / `WEEK_LINES` |
| 行动 → 背景映射 | `src/ui/ui.js` 的 `ACTION_SCENE` |
| 立绘列表 | `src/ui/ui.js` 的 `APPEARANCES` |
| 背景/立绘图片 | `assets/bg/`、`assets/char/`（见 `assets/README.md`） |
| 菜单项（如新开"商城"） | `src/ui/ui.js` 的 `openMenu()` 列表 |

> 不要为了加内容去改 `src/core/**`、`src/events/**`：台词与场景都是表现层数据。

---

## 8. 还没做的（下一轮可加）

1. **声音**：BGM / 点击音 / 打字音（需要 `assets/audio/` 与一次用户交互后才能播放）。
2. **CG 鉴赏**：事件插图单独成册，和图鉴并列。
3. **自动播放 / 快进**：对话框控制行（Auto / Skip）。
4. **多存档槽位**：目前是单槽自动存档 + 手动保存。
5. **更多立绘 / 场景**：新增人物与场景只需改 `APPEARANCES` / `SCENES` 并放图（见 `assets/README.md`）。
