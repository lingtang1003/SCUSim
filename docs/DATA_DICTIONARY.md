# SCUSim 数据字典（草案 v0.1）

> 状态：**草案**。开工第一天由四人共同确认后冻结。
> 依据：01_需求与架构基线 §6、§9；02_四人分工与协作规范 §3。
> 命名唯一原则：同一概念只用一组字段名，禁止别名。

## 0. 说明
- 本字典定义 `GameState` 顶层字段、玩家字段、四项核心属性、回合数/学期、行动点、学业、待处理事件、RNG 状态、存档版本、图鉴结构。
- 每个字段标注：类型、必填与否、默认值、范围、由谁修改、是否持久化。
- `month` / `semester` 由 `turn` 推导，**不**单独存储，避免多源不一致。
- 带 ⚠️ 的字段为**待确认项**，需团队拍板后才能冻结（见 开发方案 §2）。

---

## 1. GameState 顶层

| 字段 | 类型 | 必填 | 默认值 | 范围 / 说明 | 修改方 | 持久化 |
|---|---|---|---|---|---|---|
| `version` | string | 是 | `"1.0.0"` | semver | loader(D) | 是 |
| `seed` | number | 是 | 创建时生成 | uint32 | `newGame`(A) | 是 |
| `rngState` | number | 是 | —— | uint32，RNG 内部状态 | rng / engine | 是 |
| `turn` | number | 是 | `1` | `1..40`（第 40 回合结束即终局） | engine(A) | 是 |
| `actionPoints` | number | 是 | `4` | `0..4`，每回合开始重置为 4 | engine(A) | 是 |
| `player` | object | 是 | —— | 见 §2 | 创建(C) / 规则(B) | 是 |
| `academics` | object | 是 | —— | 见 §3 | academy(B) | 是 |
| `pendingEvent` | object \| null | 否 | `null` | 见 §4 | eventManager(B) | 是 |
| `eventHistory` | string[] | 是 | `[]` | 已结算事件 id 列表（防重复） | eventManager(B) | 是 |
| `log` | string[] | 是 | `[]` | 玩家可见事件/结算文本，UI 只读 | engine / events | 是 |
| `endingId` | string \| null | 否 | `null` | 命中结局后写入 | ending(A) | 是 |

推导规则：
- `semester = Math.ceil(turn / 5)`（40 回合 = 8 学期）。
- `month` 仅用于展示，等于 `turn`（每回合 1 个月）。

---

## 2. player（玩家角色）

| 字段 | 类型 | 必填 | 默认值 | 范围 / 说明 | 修改方 | 持久化 |
|---|---|---|---|---|---|---|
| `name` | string | 是 | —— | ⚠️ 提议 `1..16` 字符（中文/字母/数字/常见符号） | 创建(C) | 是 |
| `gender` | enum | 是 | —— | ⚠️ 提议 `['男','女']` | 创建(C) | 是 |
| `collegeId` | string | 是 | —— | 必须存在于 `colleges.json` | 创建(C) | 是 |
| `attributes` | object | 是 | —— | 见 §2.1 | 创建(C) / 规则(B) | 是 |
| `tags` | string[3] | 是 | —— | 必须存在于 `tags.json`，严格 3 个 | 创建(C) | 是 |

### 2.1 attributes（四项核心属性）
`{ knowledge, social, health, money }`，均为 number。

| 属性 | 含义 | ⚠️ 范围 | 创建规则 |
|---|---|---|---|
| `knowledge` | 学识 | `0..?` | 创建时分配 |
| `social` | 社交 | `0..?` | 创建时分配 |
| `health` | 健康 | `0..?` | 创建时分配 |
| `money` | 金钱 | `0..?`（可为负？⚠️） | 创建时分配 |

**创建约束**：四项之和**严格等于 20**（验收硬性要求）。
⚠️ **待确认**：四项初始基线是否从 0 起分配，还是每项有基础值（如每项基础 1）+ 20 点额外分配。该问题直接影响“健康 < 3 受限”规则在开局是否触发。

---

## 3. academics（学业）

| 字段 | 类型 | 必填 | 默认值 | 范围 / 说明 | 修改方 | 持久化 |
|---|---|---|---|---|---|---|
| `semesterScores` | number[] | 是 | `[]` | 每学期考试成绩 | academy(B) | 是 |
| `failedCourses` | number | 是 | `0` | `>=0`，累计挂科门数 | academy(B) | 是 |
| `warning` | boolean | 是 | `false` | 达到 3 门挂科置 `true` | academy(B) | 是 |

---

## 4. pendingEvent（待处理事件）

| 字段 | 类型 | 必填 | 默认值 | 说明 | 修改方 | 持久化 |
|---|---|---|---|---|---|---|
| `eventId` | string | 是（存在时） | —— | 来自 `events.json` | eventManager(B) | 是 |
| `options` | `{id,label}[]` | 是（存在时） | —— | 选项列表，供 UI 渲染 | eventManager(B) | 是 |
| `resolved` | boolean | 否 | `false` | 是否已结算 | eventManager(B) | 是 |

> 同一时刻至多一个 `pendingEvent`。结算后清空并写入 `eventHistory`。

---

## 5. 图鉴 gallery（跨周目持久化，独立于 GameState）

存储于 storage 的**独立 key**，与当前存档分离，避免新游戏覆盖已解锁结局。

```json
{ "version": "1.0.0", "unlocked": ["ending_id_1", "ending_id_2"] }
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | string | 与 GameState 同版本策略 |
| `unlocked` | string[] | 已解锁结局 id，去重 |

---

## 6. 存档文件 `.scusim`（导入/导出格式）

```json
{
  "format": "scusim",
  "version": "1.0.0",
  "state": { "<完整 GameState>" }
}
```

- 导入校验：必须有 `format==="scusim"`、`version` 可识别、`state` 结构合法；否则报错且**不覆盖**当前有效存档。
- ⚠️ 版本不兼容时：当前版本策略为**直接拒绝并提示**（暂不做迁移）。

---

## 7. RNG 种子与内部状态

| 项 | 说明 |
|---|---|
| `seed` | 创建角色时生成（用户未指定时由 `createRng` 派生的随机种子）；用于复现 |
| `rngState` | 32-bit 内部状态（如 Mulberry32），序列化进 `GameState.rngState`，保证读档后随机序列连续且可复现 |
| 约束 | 核心逻辑**禁止**直接调用 `Math.random()`；唯一入口 `src/core/rng.js` |

---

## 8. settings（设置，独立持久化）

| 字段 | 类型 | 说明 |
|---|---|---|
| `seedDisplay` | boolean | 是否在 UI 显示种子 |
| `reduceMotion` | boolean | 减弱动画 |
| `lastSaveAt` | number | 时间戳，仅展示 |

> 设置存于 storage 独立 key，不参与 GameState 序列化。

---

## 9. 待确认清单（映射到 开发方案 §2）
1. ⚠️ 属性初始基线（0 起 vs 含基础值）—— 影响健康<3 规则。
2. ⚠️ 姓名长度上限与性别枚举最终值。
3. ⚠️ 属性数值上限（`money` 是否允许为负）。
4. ⚠️ “三档加成”的精确定义（属性分段阈值与加成幅度）。
5. ⚠️ 考试公式与数值（放到 `balance.json` / `academy.js`，需团队确认公式形）。
6. ⚠️ 行动点是否跨回合累积（默认：每回合重置为 4，不累积）。
