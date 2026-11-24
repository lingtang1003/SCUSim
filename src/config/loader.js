/**
 * 配置加载层（负责人 D）。
 *
 * 默认用 fetch(new URL('../config/'+path+'.json', import.meta.url))；
 * 测试时通过注入 reader 解耦（Node 环境无 fetch 也可用）。
 *
 * 加载后调用 validateConfigs 校验；不通过则 throw { ok:false, reason, errors[] }。
 */

import { validateConfigs } from './schema.js';

const FILES = ['balance', 'colleges', 'tags', 'actions', 'events', 'endings', 'locations'];
/**
 * v2.1 可选配置：读取失败（文件不存在 / fetch 404 / 注入 reader 不认这个 key）时静默跳过，
 * 对应系统自动降级关闭，不影响必需配置（含 locations）的加载。
 */
// courses：各学院分学期课程表；缺失时考试退回 balance.exam.subjects，不影响启动
const OPTIONAL_FILES = ['characters', 'storylines', 'events-characters', 'courses'];

/**
 * 加载并校验配置。
 * @param {object} [reader] 可选注入 { read(path)->Promise<string|object> }，path 不含扩展名
 * @returns {Promise<{balance,colleges,tags,actions,events,endings,characters?,storylines?}>}
 */
export async function loadConfig(reader) {
  let read;
  if (reader && typeof reader.read === 'function') {
    read = (path) => Promise.resolve(reader.read(path));
  } else {
    // 浏览器默认：fetch + import.meta.url（loader 唯一允许的浏览器 API）
    // 注意：loader.js 位于 src/config/ 下，配置目录在项目根 config/，
    // 因此需 ../../config/（而非 ../config/，后者会解析到 src/config/ 导致 404）。
    read = async (path) => {
      const url = new URL(`../../config/${path}.json`, import.meta.url);
      const res = await fetch(url);
      if (!res.ok) {
        throw { ok: false, reason: `加载 ${path} 失败`, errors: [`${path}.json HTTP ${res.status}`] };
      }
      return res.text();
    };
  }

  const configs = {};
  const errors = [];
  for (const f of FILES) {
    try {
      const raw = await read(f);
      const json = typeof raw === 'string' ? JSON.parse(raw) : raw;
      configs[f] = json;
    } catch (e) {
      errors.push(`加载 ${f} 失败: ${e && e.message ? e.message : String(e)}`);
    }
  }
  if (errors.length > 0) {
    throw { ok: false, reason: '配置加载失败', errors };
  }

  for (const f of OPTIONAL_FILES) {
    try {
      const raw = await read(f);
      const json = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (json && typeof json === 'object') configs[f] = json;
    } catch (_) {
      // 可选配置缺失 = 该子系统关闭（角色/剧情线），不阻塞启动
    }
  }

  // 内容分片：events-characters.json 的 fixed/random 合并进主 events 表，
  // 让角色剧情可以和主表分开维护（B 单文件改主表、内容协笔加自己的分片）。
  const shard = configs['events-characters'];
  delete configs['events-characters'];
  if (shard && configs.events && typeof configs.events === 'object') {
    const ev = configs.events;
    if (!Array.isArray(ev.fixed)) ev.fixed = [];
    if (!Array.isArray(ev.random)) ev.random = [];
    if (Array.isArray(shard.fixed)) ev.fixed = shard.fixed.concat(ev.fixed);
    if (Array.isArray(shard.random)) ev.random = ev.random.concat(shard.random);
  }

  const v = validateConfigs(configs);
  if (!v.ok) {
    throw { ok: false, reason: '配置校验失败', errors: v.errors };
  }
  return configs;
}

export { validateConfigs };
