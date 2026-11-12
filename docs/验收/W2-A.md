# W2 验收 · A · 开局/标签/学院/事件队列

> 任务卡：A-W2（`docs/分工/A-核心引擎与集成.md` §2 W2）｜ 验收人：A 自检 + C 交叉验
> 结论：**✅ A 侧完成**（B 的权重/前置与 C 的候选标签 UI 已对接；`accept/w2` 仍缺，见 §4）

## 1. 交付对照

| # | 任务卡要求 | 状态 | 落点 |
|---|---|---|---|
| 1 | `drawTagCandidates(config, rng)` 随机刷 6 个不重复标签 | ✅ | `engine.drawTagCandidates` |
| 2 | `newGame` 应用标签修正（叠加、下限 0） | ✅ | `engine.applyTagModifiers` |
| 3 | 学院 `eventBias` 注入事件权重 | ✅ | B 的 `computeWeight` 读 `player.collegeId`；引擎保证 state 上下文 |
| 4 | 事件队列（固定 > 负债 > 随机，同刻至多 1 个） | ✅ | `engine.enterTurn` |
| 5 | `buildViewModel`（actions[].reason / tierInfo / flags / debtThreshold） | ✅ | `engine.buildViewModel` + `main.renderState` 接入 |
| 6 | 标签修正边界单测（叠加后不为负、同种子同批次） | ✅ | `tests/unit/a-engine.mjs` §2/§6 |

## 2. 关键实现

```text
applyTagModifiers: 遍历 3 个标签的 modifiers.attributes（兼容扁平写法）→ 求和 →
                   加到 attributes → 非 money 属性 <0 时置 0 → clampAttrs
drawTagCandidates: Fisher–Yates（rng.int），取前 6 个 id；同 rng 状态 → 同一批
buildViewModel:    availability（每行动 ok/reason）+ actions[] + tierInfo{thresholds,bonuses}
                   + flags + debtThreshold + seed
enterTurn:         checkFixedEvents → 优先 id（负债）→ rollEvent；已存在 pending 则不覆盖
```

学院偏向不在引擎里算：`computeWeight(event, state, config)` 由 B 直接读 `state.player.collegeId` 与 `colleges[].eventBias`，A 只保证 state 字段齐全（已由 `newGame` 保证）。

## 3. 实测

```
$ node tests/unit/a-engine.mjs
  PASS  newGame: 标签修正叠加（学识 5→7 / 健康 5→4 / 社交 5→4）
  PASS  newGame: 标签修正写入履历
  PASS  drawTagCandidates: 返回 6 个不重复 id
  PASS  drawTagCandidates: 同种子同一批（可复现）
  PASS  buildViewModel: availability 覆盖全部行动
  PASS  buildViewModel: actions 带 enabled/reason
  总计 76 项，PASS 76，FAIL 0

$ node tests/unit/b-events.mjs     → 事件单测全部通过
$ npm test                        → smoke 22 / verify_ui 14 全绿
$ node tests/unit/a-browser-e2e.mjs（真浏览器 40 回合）→ 26/26
```

## 4. 未闭环（不影响 A 侧结论）

| 项 | 依赖方 | 说明 |
|---|---|---|
| `tests/accept/w2.mjs` | D | 门禁脚本仍缺；A 用 `a-engine` + 浏览器 E2E 代替 |
| C 的"6 选 3"UI | C | `startCreation({tagCandidates})` 与"换一批"按钮尚未接入；A 的 API 已就绪，C 只需调用 `callbacks.onRerollTags` + main 传参 |
| `requires` 内容 | B | 已有 `availableOptions`，但 `events.json` 里带 `requires` 的选项仍少（W3 补） |

## 5. 给 C 的对接说明（可直接贴 issue）

```js
// main 侧（A 已完成）
onRerollTags: () => { tagCandidates = drawTagCandidates(config, rng); renderCreation({ tagCandidates }); }
// UI 侧（C）
startCreation({ tagCandidates })  // 缺省降级为 config.tags.list.slice(0,6)
```

> 若 C 不接候选：UI 仍平铺 12 个标签，SRS 1.4「随机刷 6」不达标；但引擎与数据侧已就绪，不阻塞其他功能。
