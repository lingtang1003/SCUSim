/**
 * 可复现伪随机数发生器（Mulberry32 算法）。
 *
 * 这是项目中【唯一】的随机入口；core/events 严禁直接使用原生随机函数。
 * 内部状态为 32-bit uint32，可序列化进 GameState.rngState，
 * 读档后通过 setState 还原，保证随机序列连续且可复现。
 */

/**
 * 用种子创建 RNG。
 * @param {number} seed uint32 种子
 * @returns {{
 *   next: () => number,
 *   int: (min: number, max: number) => number,
 *   chance: (p: number) => boolean,
 *   pick: (arr: any[]) => any,
 *   getState: () => number,
 *   setState: (s: number) => void,
 *   fork: () => any
 * }}
 */
export function createRng(seed) {
  let state = (seed >>> 0);

  /** [0,1) 浮点 */
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 闭区间整数 [min,max] */
  function int(min, max) {
    const lo = Math.floor(min);
    const hi = Math.floor(max);
    if (hi < lo) return lo;
    return lo + Math.floor(next() * (hi - lo + 1));
  }

  /** 以概率 p(0..1) 返回 true */
  function chance(p) {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return next() < p;
  }

  /** 等概率取数组一项 */
  function pick(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    return arr[Math.floor(next() * arr.length)];
  }

  /** 当前 32-bit 内部状态（用于序列化） */
  function getState() {
    return state >>> 0;
  }

  /** 还原内部状态（读档用） */
  function setState(s) {
    state = (s >>> 0);
  }

  /** 派生独立子发生器 */
  function fork() {
    const childSeed = (next() * 4294967296) >>> 0;
    return createRng(childSeed);
  }

  return { next, int, chance, pick, getState, setState, fork };
}
