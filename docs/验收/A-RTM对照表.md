# A 成员 · 需求分析 RTM 对照核查（SCUSim-JS-0001 表 3.2.1）

> 核查对象：A 负责的范围（`rng/state/engine/ending/main` + 集成 + 验收）
> 判定口径：**A 侧代码 + 测试通过 = ✅**；A 侧已就绪但依赖他人 UI/配置 = 🟡；按团队决议不触发 = ⚪
> 核查日期：本轮回填｜证据命令：`node tests/unit/a-engine.mjs`（83 项）、`node tests/unit/a-main.mjs`（15 项）、`node tests/unit/a-browser-e2e.mjs`（26 项）、`npm test`（22+14）

## 一、18 项 RTM 逐条核查

| # | 功能编号 | 功能描述 | A 侧承载 | 状态 | 证据 / 说明 |
|---|---|---|---|---|---|
| 1 | RTM-1.1.0 | 角色起名与性别选择 | `state.isValidName` + `newGame` 校验；`createGameState` 存 name/gender | ✅ | 姓名 1–12 字、仅汉字/英文（D-17）；a-engine 9 条姓名用例；UI 输入过滤属 C |
| 2 | RTM-1.2.0 | 学院选择影响初始事件池偏向 | `newGame` 校验 collegeId；`state.player.collegeId` 供 B 的 `computeWeight` 读取 | ✅ | a-engine：cs 与 business 对 ev_r16 权重不同（1.4 vs 1.0） |
| 3 | RTM-1.3.0 | 20 点属性点分配 | `newGame` 强制四项之和 === `attributePointTotal`（20） | ✅ | a-engine：和≠20 → `reason:'attributes'` |
| 4 | RTM-1.4.0 | 6 选 3 标签 + 叠加 | `drawTagCandidates(config,rng)` 抽 6 个；`newGame` 校验 3 个；`applyTagModifiers` 叠加（下限 0） | ✅ A 侧 / 🟡 UI | a-engine：候选 6 个不重复、同种子同批；5/5/5/5 → 7/4/4。**UI 目前仍平铺 12 个标签（C 未接候选）** |
| 5 | RTM-2.1.0 | 回合推进（1 月 = 1 回合，≈40 回合） | `engine.advance`：回合+1、AP 重置、月初结算、事件、终局 | ✅ | a-engine：40 回合停 40、8 学期记录、同种子可复现；E2E 40 回合通关 |
| 6 | RTM-2.2.0 | 行动执行（六类/三档/健康约束） | `actionAvailability` + `doAction`（三档、健康<3 白名单、健康<5 惩罚、pending 阻断） | ✅ | a-engine：9/10/19/20 边界、健康 0/1/2/3/5、AP=0、pending 阻断 |
| 7 | RTM-3.1.0 | 日常收支结算（+2000/−1800） | `advance` 调 B 的 `settleMonthly` | ✅ | 配置现为 2000/**1950**（D-14 待文档确认）；a-engine 按配置净额断言 |
| 8 | RTM-3.2.0 | 额外金钱收支管理 | 行动/事件 effects 统一走 B 的 `applyEffects`，由 `doAction`/`resolvePendingEvent` 触发 | ✅ | a-engine：兼职/事件金额入账；B 单测覆盖 money |
| 9 | RTM-3.3.0 | 负债事件处理 | `advance` 调 `checkDebt` → 作为优先事件塞进 `enterTurn`；选项走 `ev_fixed_debt` | ✅ | **本轮补测**：money −3050 → +50 后触发 `ev_fixed_debt`，选「向家里求助」金钱 +1000、写 `flags.debt` |
| 10 | RTM-4.1.0 | 期末考试（学识 ±10%） | `advance` 在考试回合先弹 `ev_r14`，`resolvePendingEvent` 后调 `runFinalExam` | ✅ | a-engine：4 科、分数 ∈ [passLine,100]、8 学期记录；E2E 结算弹窗 8 次 |
| 11 | RTM-4.2.0 | 挂科判定与学业警告 | `checkWarning` 已接线 | ⚪ | **团队已定「永不挂科」**（D-05）：`failedCourses` 恒 0、`warning` 不触发；`ending_warning` 因此不可达（D-15，D 重排结局时处理）。机制仍在，只是按决议不触发 |
| 12 | RTM-4.3.0 | 绩点结算 | `runFinalExam` 写 `semesterRecords/totalGpa`，`settlement` 透传给 UI | ✅ | a-engine：`semesterGpa/totalGpa` 数值、学期记录；C 的结算面板展示 |
| 13 | RTM-4.4.0 | 社团/学生会招新（大一上固定事件） | B 的 `ev_fixed_club_recruit` + A 的 `enterTurn` 固定事件优先 | ✅ | a-engine：回合 1 生成该事件；resolve 后写 `eventHistory`/flags；E2E 弹窗 |
| 14 | RTM-4.5.0 | 毕业论文/设计（大四下，学识+绩点判定） | **本轮补齐**：`resolvePendingEvent` 在 `ev_fixed_thesis` 结算后调 `academy.judgeThesis`；终局兜底再判一次 | ✅ | a-engine：回合 38 弹论文事件 → 结算返回 `{score,level}` → 写 `academics.thesis` + 履历；跳过事件时第 40 回合兜底判定 |
| 15 | RTM-5.1.0 | 随机事件触发（30–40% + 权重） | A 的 `enterTurn` 调 B 的 `rollEvent`（含 termRange、标签、学院权重） | ✅ | a-engine：同种子确定；B 单测覆盖权重；E2E 事件弹窗多次 |
| 16 | RTM-5.2.0 | 事件选项处理（2–3 选项、前置条件） | `buildPending` 带 enabled/reason；`resolvePendingEvent` 拒绝不满足项并返回 reason | ✅ A 侧 / 🟡 UI 置灰 | a-engine/A-main：无效选项返回 `{ok:false,reason}`；UI 置灰渲染属 C |
| 17 | RTM-6.1.0 | 结局判定（优先级取最高为主结局） | `ending.judgeEnding`：all/any + 8 类条件 + 优先级方向；`advance` 返回主/副结局 | ✅ | a-engine：asc/desc 双向、all/any、副结局顺序；E2E 结局卡 |
| 18 | RTM-6.2.0 | 结局图鉴管理（跨周目保留） | `main` 把主结局与副结局逐个 `unlockEnding`；读档结局直接展示 | ✅ A 侧 | E2E：`localStorage` 含结局；a-main：读档结局 |

## 二、本轮为对齐 RTM 补的东西

| 缺口 | 处理 |
|---|---|
| RTM-4.5 毕业论文只定义了 `judgeThesis` 却**从未被调用** | `resolvePendingEvent` 在论文事件后判定；终局回合兜底；`main` 用 toast 反馈等级 |
| RTM-3.3 负债只有接线没有证据 | 新增 2 条用例（触发优先级 + 选项结算后的金钱/flags） |
| RTM-1.2 学院偏向只有实现没有证据 | 新增权重差异用例（cs vs business） |
| 姓名/连续空窗两项新需求 | 见 `D-17` / `D-18`（姓名 9 条用例、空窗 7 条用例） |

## 三、不在 A 范围、本轮不处理

| RTM | 缺什么 | 归属 |
|---|---|---|
| 1.4 | UI 仍平铺 12 标签，没有"随机 6 选 3 + 换一批" | C |
| 5.2 | UI 未按 `enabled/reason` 置灰选项 | C |
| 11 | `ending_warning` 不可达，需在重排结局时删除/替换 | D |
| 1.1/1.3 | 创建向导的交互细节（默认属性 5/5/5/5、姓名提示） | C |
| 3.1 | 1950 vs SRS 1800 的文档口径 | 全员/文档 |

## 四、结论

**18 项 RTM 中，A 负责的 15 项全部完成并有测试证据；1 项（4.2）按团队决议不触发；2 项（1.4 / 5.2）A 侧 API 已就绪、只差 C 的界面接入。**
