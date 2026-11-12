# SCUSim 周验收看板

> Owner：A ｜ 模板：`_模板.md` ｜ 规则见 `docs/团队分工与验收手册.md` §5
> 更新于 W3 收口；✅ 通过 / 🟡 有条件 / ❌ 退回 / ⬜ 未交

## 里程碑

| 周 | 主题 | 门禁命令 | A | B | C | D |
|---|---|---|---|---|---|---|
| W0 | 契约与盘点 | — | ✅ | ✅ | — | ⬜ |
| W1 | 经济 + 学业闭环 | `node tests/accept/w1.mjs`（缺） | ✅（A 侧） | ✅ | ✅ | ⬜ |
| W2 | 开局/标签/学院/事件权重 | `node tests/accept/w2.mjs`（缺） | ✅（A 侧） | ✅ | 🟡 | ⬜ |
| W3 | 结局体系 + 内容 + 履历 | `node tests/accept/w3.mjs`（缺） | ✅（A 侧） | ✅ | 🟡 | ⬜ |
| W4 | 存储/工程/部署/性能 | `node tests/accept/w4.mjs`（缺） | 🟡 | — | — | ⬜ |
| W5 | 回归/文档/答辩 | 交付检查表 | ⬜ | ⬜ | ⬜ | ⬜ |

> 读法：A 的"✅（A 侧）"= 代码 + 单测 + 浏览器 E2E 全绿，只差 D 的门禁脚本把它变成机器可复跑的 ✅。
> D 一列全空：`schema.js` v2 校验、`tests/accept/**`、CI、IndexedDB、`migrateSave` 均未交付。

## 每周固定命令（A 复跑用）

```bash
node server.js                 # 浏览器 E2E 需要

# 全局回归
npm test                       # smoke 22 + verify_ui 14

# A 的单测 / E2E
node tests/unit/a-engine.mjs   # 76 项
node tests/unit/a-main.mjs     # 15 项（弹窗队列 + 读档结局）
node tests/unit/a-browser-e2e.mjs   # 26 项 + 9 张截图

# 其他人的单测
node tests/unit/b-economy.mjs
node tests/unit/b-academy.mjs
node tests/unit/b-events.mjs
node tests/verify_m1.mjs       # 29/30（1 条待 D 更新）
```

## 各人验收记录

| 周 | A | B | C | D |
|---|---|---|---|---|
| W0 | [W0-契约冻结](W0-契约冻结.md) | — | — | — |
| W1 | [W1-A](W1-A.md) | （见其单测） | （视觉小说化 + showExam） | — |
| W2 | [W2-A](W2-A.md) | — | — | — |
| W3 | [W3-A](W3-A.md) | — | — | — |
| W4 | [W4-A](W4-A.md) | — | — | — |
| W5 | — | — | — | — |

## 当前阻塞（A 维护）

| 阻塞项 | 影响 | 需要谁 |
|---|---|---|
| `tests/accept/w1–w4.mjs` 不存在 | 机器门禁无法闭环，只能靠 A 的手工命令 + E2E | D |
| `schema.js` v2 校验 | 配置写错只能运行时兜底；`monthlyExpense 1950` 就是这么进来的 | D |
| IndexedDB + `migrateSave` | 存档仍 localStorage；`SAVE_VERSION` 未升 | D |
| CI（GitHub Actions） | PR 无自动门禁 | D |
| Q1 `walletPerMoneyPoint` 值 | 初始钱=点数 vs 事件金额=货币，`小富翁 money≥50` 第 2 回合即达成 | 全员 |
| Q8 月度支出 1950 vs SRS 1800 | 答辩口径不一致 | 全员/文档 |
| Q9 `ending_warning` 不可达 | 永不挂科后该结局永远拿不到 | D（W3 重排结局时处理） |
