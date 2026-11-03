# SCUSim 周验收看板

> Owner：A ｜ 模板：`_模板.md` ｜ 规则见 `docs/团队分工与验收手册.md` §5
> 每周六 20:00 更新；✅ 通过 / 🟡 有条件 / ❌ 退回 / ⬜ 未交

## 里程碑

| 周 | 主题 | 门禁命令 | A | B | C | D |
|---|---|---|---|---|---|---|
| W0 | 契约与盘点 | — | ✅ | ⬜ | ⬜ | ⬜ |
| W1 | 经济 + 学业闭环 | `node tests/accept/w1.mjs` | 🟡 | ⬜ | ⬜ | ⬜ |
| W2 | 开局/标签/学院/事件权重 | `node tests/accept/w2.mjs` | ⬜ | ⬜ | ⬜ | ⬜ |
| W3 | 结局体系 + 内容 + 履历 | `node tests/accept/w3.mjs` | ⬜ | ⬜ | ⬜ | ⬜ |
| W4 | 存储/工程/部署/性能 | `node tests/accept/w4.mjs` | ⬜ | ⬜ | ⬜ | ⬜ |
| W5 | 回归/文档/答辩 | 交付检查表 | ⬜ | ⬜ | ⬜ | ⬜ |

> 🟡 的含义：A 自己的代码与单测已绿，但本周门禁还依赖 B/D 的产物（见 `W1-A.md` §5），所以不能算 ✅。

## 每周固定命令（A 复跑用）

```bash
# 1) 本周门禁（D 提供；未提供时先用各人单测 + npm test）
node tests/accept/w<N>.mjs

# 2) 全局回归
npm test                      # = smoke.mjs + verify_ui.mjs

# 3) 各人单测
node tests/unit/a-engine.mjs
node tests/unit/b-economy.mjs
node tests/unit/b-academy.mjs
node tests/unit/c-ui.mjs
node tests/unit/d-schema.mjs
```

## 各人验收记录

| 周 | A | B | C | D |
|---|---|---|---|---|
| W0 | [W0-契约冻结](W0-契约冻结.md) | — | — | — |
| W1 | [W1-A](W1-A.md) | — | — | — |
| W2 | — | — | — | — |
| W3 | — | — | — | — |
| W4 | — | — | — | — |
| W5 | — | — | — | — |

## 当前阻塞（A 维护）

| 阻塞项 | 影响 | 需要谁 | 截止 |
|---|---|---|---|
| `tests/accept/w1.mjs` 不存在 | W1 机器门禁无法闭环 | D | W1 周五 |
| `balance.json` 缺 v2 字段（月度/负债/绩点/三档/惩罚/资金兑换） | 多项能力"就绪未激活" | D | W1 周二 |
| `walletPerMoneyPoint` 取值未定（Q1：不采用 200） | 初始资金兑换无法激活，结局金额阈值也定不了 | D/B 定值 | W1 周三 |
| `tags.modifiers` / `actions.mainAttr` 为空 | 标签与三档加成不生效 | B | W1 周四 |
| `verify_m1.mjs` 有 1 条用例与新行为冲突 | 旧脚本 29/30 | D | W1 周五 |
| 预览 URL 未在 PR 里出现 | A 无法在浏览器验收 | A 检查 Pages 设置 | W1 周一 |
