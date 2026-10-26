# SCUSim 统一接口规范（草案 v0.1）

> 状态：**草案**。四人确认后冻结，随后并行开发。
> 依据：01_需求与架构基线 §10；02_四人分工与协作规范 §4。
> 本文件是并行开发的“契约”，任何签名变更需走 02 §7 冲突处理流程并更新本文档。

---

## 0. 全局约定

### 0.1 统一返回结构
所有核心/存储/配置接口一律返回结构化结果对象，禁止散落抛出未分类异常：

```js
// 成功
{ ok: true, state?: <GameState>, data?: any, message?: string }
// 失败
{ ok: false, reason: string, data?: any }
```

### 0.2 状态模型（架构决策 #2，详见 开发方案 §0）
- **可变状态 + 明确所有权**：`GameState` 在引擎中**就地修改**，`engine` 函数接收 `state` 并修改后返回结果对象；除 `newGame` 外不新建 GameState。
- UI（C）**绝不**直接修改 `state`，只能通过 `main.js` 暴露的回调调用引擎。
- `core/` 与 `events/` **不得**依赖 DOM / IndexedDB / LocalStorage；依赖方向单向，无循环依赖。
- 若团队坚持不可变更新，须全员统一并在本文档标注。

### 0.3 环境无关性
- 纯逻辑（rng / state / engine / economy / academy / eventManager / ending / schema）**不触碰** `window` / `indexedDB` / `localStorage` / `fetch`，可在 Node 测试环境直接 import。
- 配置加载与存储这两层才允许使用浏览器 API；测试时通过**注入 reader / mock storage** 解耦。

---

## 1. RNG —— `src/core/rng.js`（负责人 A）

唯一随机入口，禁止任何模块直接调用 `Math.random()`。

```js
/**
 * 用种子创建可复现随机数发生器。
 * @param {number} seed - uint32 种子
 * @returns {Rng}
 */
createRng(seed) -> {
  next(): number,            // [0,1) 浮点
  int(min, max): number,     // 闭区间整数 [min,max]
  chance(p): boolean,        // 以概率 p(0..1) 返回 true
  pick(arr): any,            // 等概率取数组一项
  getState(): number,        // 当前 32-bit 内部状态（用于序列化）
  setState(s): void,         // 还原内部状态（读档用）
  fork(): Rng                // 派生独立子发生器（如需）
}
```
- 算法建议：Mulberry32（纯函数、可序列化内部状态、无需第三方库）。
- `GameState.rngState` 持久化内部状态，读档后 `setState` 还原，保证序列连续。

---

## 2. 状态工厂 —— `src/core/state.js`（负责人 A）

```js
/**
 * 创建空白/初始 GameState（不含规则计算，仅结构）。
 * @param {object} options - { name, gender, collegeId, attributes, tags, seed? }
 * @returns {GameState}
 */
createGameState(options) -> GameState

/**
 * 深拷贝（存档快照/测试用）。优先 structuredClone，降级 JSON 克隆。
 */
clone(state) -> GameState
```

---

## 3. 核心引擎 —— `src/core/engine.js`（负责人 A，集成 B 的规则模块）

```js
/**
 * 新建一局游戏。
 * @param {object} options - 角色创建结果 {name,gender,collegeId,attributes,tags,seed?}
 * @param {Configs} config - loadConfig() 的结果
 * @param {Rng} rng - createRng(seed)
 * @returns { ok, state, message? }  失败 { ok:false, reason }
 * 副作用：新建并初始化 GameState（turn=1, AP=4）。
 */
newGame(options, config, rng) -> { ok, state, message? }

/**
 * 判断某行动当前是否可用（不修改 state）。
 * @returns { ok, reason? }  ok=false 时 reason 说明原因（AP不足/条件不满足/健康受限等）
 */
actionAvailability(state, actionId, config) -> { ok, reason? }

/**
 * 执行一个行动。就地修改 state（扣 AP、应用属性效果）。
 * @returns { ok, state, message?, reason? }
 */
doAction(state, actionId, config, rng) -> { ok, state, message?, reason? }

/**
 * 推进一个回合：月度结算 + 学期考试 + 固定事件 + 随机事件 + 结局判定。
 * 就地修改 state；可能产生 pendingEvent 或写入 endingId。
 * @returns { ok, state, settlement?, pendingEvent?, endingId?, message? }
 */
advance(state, config, rng) -> { ok, state, settlement?, pendingEvent?, endingId?, message? }

/**
 * 结算当前待处理事件的一个选项。
 * @returns { ok, state, result?, message?, reason? }
 */
resolvePendingEvent(state, choiceId, config, rng) -> { ok, state, result?, message?, reason? }

/**
 * 按优先级判定当前应命中结局（不修改 state）。
 * @returns { ok, endingId: string|null }
 */
getEnding(state, config) -> { ok, endingId: string|null }
```

> `economy.js` / `academy.js` / `eventManager.js` / `ending.js` 作为 `engine` 的**被调用方**，由 A 在 `engine` 中编排，不对外暴露给 UI。

---

## 4. 规则模块（负责人 B，被 engine 调用）

### 4.1 `src/core/economy.js`
```js
applyActionEconomy(state, action, config, rng) -> void   // 就地：金钱/消费类效果
monthlyEconomy(state, config) -> void                    // 就地：每月固定收支
```

### 4.2 `src/core/academy.js`
```js
takeExam(state, config, rng) -> { ok, score, passed }    // 每学期考试，写 academics
checkWarning(state) -> boolean                           // 挂科>=3 置 warning
```

### 4.3 `src/events/eventManager.js`
```js
rollRandomEvent(state, config, rng) -> { eventId: string|null, options }  // 按35%基率+权重
checkFixedEvents(state, config) -> string[]                               // 社团招新/毕业论文等
resolveEvent(state, eventId, choiceId, config, rng) -> { ok, result?, message? }
```

### 4.4 `src/core/ending.js`
```js
evaluateEnding(state, config) -> string|null   // 按优先级返回第一个命中结局 id
```

---

## 5. 配置层 —— `src/config/loader.js` + `src/config/schema.js`（负责人 D）

```js
/**
 * 加载并校验六份配置。
 * @param {object} [reader] - 可选注入：{ read(path)->Promise<string|object> }
 *   浏览器默认用 fetch(new URL('../config/'+path, import.meta.url))；
 *   Node 测试注入本地读取器（见 开发方案 §0 决策#3）。
 * @returns Promise<Configs> 失败抛出 { ok:false, reason, errors[] }
 */
loadConfig(reader?) -> Promise<Configs>

/**
 * 纯函数校验（架构决策 #1，可在 Node 直接测，不依赖浏览器）。
 * @param {Configs} configs
 * @returns { ok, errors: string[] }
 */
validateConfigs(configs) -> { ok, errors: string[] }
```
`Configs = { balance, colleges, tags, actions, events, endings }`

---

## 6. 存储层 —— `src/storage/storage.js`（负责人 D，仅 main.js 调用）

```js
saveGame(state) -> Promise<{ok, message?}>
loadGame() -> Promise<{ok, state?, reason?}>
clearSave() -> Promise<{ok}>
getGallery() -> Promise<{ok, gallery}>
unlockEnding(endingId) -> Promise<{ok}>
exportSaveFile(state) -> Promise<Blob>      // 产出 .scusim 文本
importSaveFile(file) -> Promise<{ok, state?, reason?}>  // 校验失败不覆盖
getSettings() -> Promise<{ok, settings}>
saveSettings(settings) -> Promise<{ok}>
```
- 首选 IndexedDB；不可用时降级 LocalStorage 并提示。
- 核心逻辑**不得**调用本模块（由 `main.js` 协调）。

---

## 7. UI 层 —— `src/ui/ui.js`（负责人 C）

```js
/**
 * 创建 UI 应用。仅通过 callbacks 与协调层交互，绝不直接改写 GameState。
 * @param {object} ctx - { config, callbacks }
 *   callbacks: {
 *     onNewGame(options), onLoadGame(), onAction(actionId),
 *     onAdvance(), onResolveEvent(choiceId), onExport(), onImport(file),
 *     onClearSave(), onOpenGallery(), onOpenSettings()
 *   }
 * @returns { mount(rootEl), render(state), showEvent(ev), showEnding(e), showError(msg), showGallery(g) }
 */
createApp(ctx) -> { mount, render, showEvent, showEnding, showError, showGallery }
```

---

## 8. 协调层 —— `src/main.js`（负责人 A）
- 入口：加载配置 → 初始化 UI → 绑定回调 → 路由（新游戏/继续/图鉴/设置）。
- 负责把引擎结果写入存储（`saveGame` / `unlockEnding`），并驱动 `ui.render`。
- 是唯一同时接触 `engine` + `storage` + `ui` 的模块。

---

## 9. 调用关系（谁调用谁）
- UI(C) → main(A) → engine(A) → {state, rng, economy(B), academy(B), eventManager(B), ending(A)}
- engine → config(经 main 注入) ；eventManager → config/rng
- main → storage(D)；main → loader(D)
- **禁止反向**：core/events/config **不**调用 storage / ui / DOM。
