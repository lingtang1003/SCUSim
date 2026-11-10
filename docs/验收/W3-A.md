# W3 验收 · A · 结局体系与内容

> 任务卡：A-W3（`docs/分工/A-核心引擎与集成.md` §2 W3）｜ 验收人：D 交叉验
> 结论：**✅ A 侧完成**；`endings.json` 的 6 条 SRS 结局与方向切换仍由 D 交付（见 §4）

## 1. 交付对照

| # | 任务卡要求 | 状态 | 落点 |
|---|---|---|---|
| 1 | 条件求值支持 `all/any` + 7 类叶子条件 | ✅ | `ending.evaluateCondition` |
| 2 | `judgeEnding` 返回主结局 + 副结局 | ✅ | `ending.judgeEnding` |
| 3 | 优先级方向配置化（`asc` = 越小越高） | ✅ | `ending.sortByPriority` |
| 4 | 副结局写入图鉴 | ✅ | `main.onAdvance`（主 + 每个 sub 调 `unlockEnding`） |
| 5 | 结局条件单测（组合/边界/未知类型） | ✅ | `tests/unit/a-engine.mjs` §5 |
| 6 | 浏览器端到端验证结局可达 | ✅ | `a-browser-e2e` 40 回合 → 结局弹层 + 图鉴写入 |

## 2. 条件类型与语义

| type | 参数 | 语义 |
|---|---|---|
| `attributeAtLeast` | `key`, `value` | 属性 ≥ 阈值 |
| `gpaAtLeast` | `value` | `totalGpa` ≥ 阈值 |
| `warningTrue` | —（可 `negate`） | 学业警告为真 |
| `flagEquals` | `key`, `value` | `player.flags[key] === value` |
| `tagIncludes` | `tagId`/`value` | 携带标签包含该 id |
| `collegeIs` | `collegeId`/`value` | 学院匹配 |
| `eventDone` | `eventId`/`value` | `eventHistory` 里出现过 |
| `default` | — | 恒真（兜底，应最低优先级） |
| `all` / `any` | `conditions[]` | 递归组合；任一子条件可带 `negate` |

主结局 = 按 `balance.endingPriorityOrder` 排序后第一个命中；其余命中项按同顺序作为副结局返回（`advance().endingSubs`）。

## 3. 实测

```
$ node tests/unit/a-engine.mjs
  PASS  ending: 未配置方向时保持 desc 兼容（学识 40 → 学术之星）
  PASS  ending: endingPriorityOrder=asc 时按「越小越高」命中（→ 平凡四年）
  PASS  ending: all/any/多类型组合命中主结局 E1
  PASS  ending: 其余命中项记为副结局
  PASS  ending: all 中任一不满足则不命中（warning 为真）
  PASS  ending: 未知类型不命中且不抛错
  总计 59 项，PASS 59，FAIL 0

$ node tests/unit/a-browser-e2e.mjs
  PASS  结局已判定（endingId 非空）
  PASS  结局弹层出现
  PASS  图鉴写入 localStorage 且含本次结局
  总计 26 项，PASS 26，FAIL 0
```

## 4. 未闭环（D 的 W3）

| 项 | 说明 |
|---|---|
| `endings.json` 重排 | 现仍是"学术之星/社交名流/小富翁/养生达人/学业警示/平凡四年"（priority 100→1），不是 SRS 的保研/留学/就业/结婚/普通毕业/延毕 |
| `endingPriorityOrder: "asc"` | 必须在重排**同一个 PR** 里加，否则全员落到 priority 1 的默认结局 |
| `ending_warning` 失效 | 永不挂科（D-05）后 `warning` 恒 false，该结局不可达；重排时应删除或改条件（D-15） |
| `小富翁` 阈值 | 现为 `money ≥ 50`，而月度净 +50、事件金额 ±15/+1000，第 2 回合即达成；重排时改金额阈值（如 ≥3000）或等 Q1 定资金汇率 |

## 5. 引擎侧已知限制

1. 结局判定**不写 state**（除 `endingId` 与履历），副结局只随 `advance()` 返回，不落库——读档后若重算会一致，因为判定是纯函数。
2. 条件里的 `flagEquals` 用 `String()` 比较，`true` 与 `'true'` 视为相等；配置里请统一写字符串。
3. `all`/`any` 为空数组时分别返回 `true`/`false`（数学约定），配置里不要留空数组。
