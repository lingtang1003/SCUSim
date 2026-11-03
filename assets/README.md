# 美术素材（背景 / 立绘）

UI 是**视觉小说形态**：全屏背景 + 左下立绘 + 底部对话框 + 中央选项条。
图片都放在本目录，文件名与 `src/ui/ui.js` 顶部的 `SCENES` / `APPEARANCES` 一一对应。

> 当前状态：**已接入首批素材**（6 张场景 + 2 个立绘），`ART.enabled = true`。
> 缺图的场景会自动回落到 CSS 渐变，缺图的立绘会显示虚线占位框，不会出现裂图。

---

## 1. 目录结构

```
assets/
├─ bg/     背景图（全屏场景，jpg，1920×1080）
└─ char/   立绘（透明底，webp/png，竖版）
```

---

## 2. 场景背景 → `assets/bg/`

场景不再是一张图，而是**一组图**：每个行动对应一个池子，点一次行动换一张
（同一回合内逐张轮换、不重复；换回合起点也会变），每张图还自带地点标签和旁白。

| 行动 / 时机 | 场景键（CSS 类名后缀） | 池内图片 |
|---|---|---|
| 标题页（封面） | `title` | `gate`（老校门，固定） |
| 每周开场、新游戏第一幕、推进回合后 | `campus` | `avenue` / `magnolia` / `plaza-flowerbed` / `dusk-road` / `lawn-pavilion` / `river-bridge` |
| 行动「上课学习」 | `classroom` | `library` / `classroom-sunlit` / `classroom-empty` / `classroom-podium` / `corridor` / `classroom-screen`（仅各上学期第 1 周） |
| 行动「社团活动」 | `clubroom` | `activity-wall` / `plaza-flowerbed` / `corridor` |
| 行动「体育锻炼」 | `track` | `field-track` / `gym-badminton` / `lawn-pavilion` |
| 行动「兼职赚钱」 | `store` | `metro-platform` / `metro-escalator` |
| 行动「社交娱乐」 | `street` | `hotpot` / `bar-live` / `canteen` |
| 行动「休息放松」 | `dorm` | `dusk-road` / `river-bridge` / `lawn-pavilion` / `avenue` |
| 事件弹层 | `event` | 无独立图（沿用当前场景 + 压暗模糊） |

### 21 张图一览

| 文件 | 地点标签（HUD 右上） | 会出现在 |
|---|---|---|
| `library.jpg` | 图书馆 · 自习区 | 上课学习 |
| `classroom-screen.jpg` | 第一教学楼 · 教室（投影「欢迎你，新同学」） | 上课学习（**仅第 1/11/21/31 周，即各个「上学期」的第一周**） |
| `classroom-empty.jpg` | 第一教学楼 · 空教室 | 上课学习 |
| `classroom-podium.jpg` | 第一教学楼 · 讲台 | 上课学习 |
| `classroom-sunlit.jpg` | 第一教学楼 · 午后教室 | 上课学习 |
| `corridor.jpg` | 第一教学楼 · 走廊 | 上课学习、社团活动 |
| `activity-wall.jpg` | 社团活动室 · 展板墙 | 社团活动 |
| `plaza-flowerbed.jpg` | 学生活动中心 · 广场 | 社团活动、每周开场 |
| `field-track.jpg` | 东区操场 · 田径场 | 体育锻炼 |
| `gym-badminton.jpg` | 体育馆 · 羽毛球馆 | 体育锻炼 |
| `lawn-pavilion.jpg` | 校园 · 草坪小亭 | 体育锻炼、休息放松、每周开场 |
| `canteen.jpg` | 食堂 · 二层 | 社交娱乐 |
| `hotpot.jpg` | 校外 · 火锅店 | 社交娱乐 |
| `bar-live.jpg` | 校外 · 驻唱酒吧 | 社交娱乐 |
| `dusk-road.jpg` | 校园 · 回宿舍的路 | 休息放松、每周开场 |
| `river-bridge.jpg` | 江安河 · 栈桥 | 休息放松、每周开场 |
| `avenue.jpg` | 校园 · 林荫道 | 每周开场、休息放松 |
| `magnolia.jpg` | 校园 · 玉兰道 | 每周开场 |
| `metro-platform.jpg` | 地铁 8 号线 · 站台 | 兼职赚钱 |
| `metro-escalator.jpg` | 地铁 8 号线 · 扶梯 | 兼职赚钱 |
| `gate.jpg` | 国立四川大学 · 校门 | 标题页（封面） |

> **事件弹层没有独立背景**：`event` 池为空，出现事件时沿用当前场景 + 压暗模糊。

> **时间窗**：池内每张图可带 `minTurn` / `maxTurn`（周区间）、`oddSemester`（只在第 1/3/5/7 学期）或 `oddSemesterFirstWeek`（只在各上学期第一周）。
> 目前只有「欢迎你，新同学」那张限 `maxTurn: 4`（开学第一个月），之后自动退出池子。

**规格**

- 1920×1080（16:9），jpg，单张 ≤ 400KB（当前 142–387KB）
- 无文字、无水印
- **安全区**：下方约 25% 会被对话框盖住；左侧约 30% 会立着立绘。
  重要画面元素请放在**右侧中上部**。
- 换成竖构图也可以，CSS 用 `cover` 裁切，但请保证主体在中间偏上。

---

## 3. 立绘 → `assets/char/`

玩家在创建角色第 6 步选一个，游戏中常驻画面左下（半身像，底边贴齐屏幕底部）。
**只列出与所选性别匹配的立绘**（现在男/女各一张，后续可以按性别继续追加）。

| 文件名 | id | 名称 | 性别 | 人设 |
|---|---|---|---|---|
| `m_hoodie.webp` | `m_hoodie` | 短发男生1 | 男 | 安静、话不多，耳机不离身 |
| `f_long.webp` | `f_long` | 长发女生1 | 女 | 温柔、有耐心，喜欢在窗边看书 |

**规格**

- 透明底（已抠图），竖版半身像
- **统一画布比例 11:14**（内部 1100×1400，输出 880×1120 webp），两张图必须同比例，
  否则游戏里一高一矮
- 人物**底边贴齐画布底边**、水平居中；头顶留约 2% 空白
- 单张 ≤ 300KB
- 现在用的是你提供的已抠图版本（无白边）；如果给的是白底原图，我再走下面的处理流程

---

## 4. 想加场景 / 加立绘

全部集中在 `src/ui/ui.js` 顶部常量区，不碰引擎与存档结构：

```js
// 新场景（键名会变成 CSS 类名 vn-scene--<key>，并作为渐变兜底的挂载点）
const SCENES = {
  library: { art: 'library.jpg', label: '图书馆 · 三层' },
};
const ACTION_SCENE = { study: 'library' };   // 关联到行动（可选）

// 新立绘
APPEARANCES.push({
  id: 'f_bob', name: '齐肩短发', gender: '女', desc: '一句话人设',
  art: true, file: 'f_bob.webp', c1: '#ffe4ec', c2: '#c98fa8',
});
```

`c1 / c2` 是占位色：美术未就位时用于占位框与色卡。

---

## 5. 处理流程备忘（新图归一化）

1. 取你给的透明图 → 去掉透明边距，得到人物包围盒；
2. 等比缩放到高度 1400（宽度不足时按宽度适配）；
3. 在 1100×1400 画布上**水平居中、底部对齐**（两张图用同一画布，保证比例一致）；
4. 输出 880×1120 webp（q92）。

> 如果是白底照片：先裁半身 → 边缘 flood fill 白底 → 去白边（边界内侧按白度削 alpha + 半透明像素按白底反解颜色）→ 再走上面 2–4 步。

---

## 6. 到位前自检

- [ ] 背景 16:9、1920×1080，压缩后 ≤ 400KB
- [ ] 立绘透明底、无白边、底边贴齐
- [ ] 文件名与上表完全一致（全小写）
- [ ] 桌面 1600×1000 与手机 390×844 下，关键画面不被对话框/选项遮住
- [ ] 控制台无 404




