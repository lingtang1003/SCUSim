/**
 * 布局回归：窄桌面窗口（561–980px）不能把「行动选项」钉到 HUD 上
 * 运行：node tests/verify_layout.mjs
 *
 * 背景：PC 上把窗口拖窄（例如 805px）时，原来的 @media (max-width:980px)
 * 把 .vn-choices:not(.vn-choices--event) 改成 top:96px / bottom:auto / width:92vw，
 * 选项条直接压在 HUD 第二行（角色胶囊）上，看起来像整块布局错位。
 *
 * 这里用静态断言守住：
 *  A) 除手机档（≤560px）外，没有任何媒体查询把行动选项钉到 top
 *  B) 561–980px 这一档把选项留在「对话框上方」并靠右让开立绘
 *  C) 同一档把 HUD 压成一行（右侧图标组不换行、胶囊缩小）
 *  D) 手机档仍然保留原来的顶部排版（避免这次改动误伤小屏）
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(join(root, 'css', 'style.css'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.error(`  FAIL  ${name}  ${detail}`); }
}

/** 取出所有 @media 块（做花括号配平，避免嵌套误判） */
function mediaBlocks(src) {
  const out = [];
  const re = /@media([^{]+)\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }
    out.push({ cond: m[1].trim(), body: src.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

/** 在 css 片段里取某个选择器的声明块（必须是一个规则的开头，避免匹配到组合选择器） */
function declsOf(selector, body) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:^|\\n[ \\t]*|\\})' + esc + '[ \\t]*\\{', 'm');
  const m = re.exec(body);
  if (!m) return null;
  const open = body.indexOf('{', m.index);
  const close = body.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  return body.slice(open + 1, close);
}

const ACTION_CHOICES = '.vn-choices:not(.vn-choices--event)';
const blocks = mediaBlocks(css);
check('A: 样式表里能解析出媒体查询', blocks.length > 10, String(blocks.length));

// ---------------------------------------------------------------------------
// A) 除手机档外，不许把行动选项钉到 top
// ---------------------------------------------------------------------------
const pinned = [];
for (const b of blocks) {
  const decls = declsOf(ACTION_CHOICES, b.body);
  if (!decls) continue;
  const isPhone = /max-width:\s*560px/.test(b.cond);
  const topPinned = /top:\s*\d+(\.\d+)?(px|rem|em|vh|%)/.test(decls);
  if (topPinned && !isPhone) pinned.push(`${b.cond} → ${decls.replace(/\s+/g, ' ').trim()}`);
}
check('A: 非手机档没有把行动选项钉到 top', pinned.length === 0, pinned.join(' | '));

// ---------------------------------------------------------------------------
// B) 561–980px 档：仍在对话框上方、靠右让开立绘
// ---------------------------------------------------------------------------
const band = blocks.find((b) => /min-width:\s*561px/.test(b.cond) && /max-width:\s*980px/.test(b.cond));
check('B: 存在 561–980px 这一档媒体查询', !!band, 'missing');
const bandChoices = band ? declsOf(ACTION_CHOICES, band.body) : null;
check('B: 这一档里给行动选项定了位', !!bandChoices, 'missing selector');
if (bandChoices) {
  const d = bandChoices.replace(/\s+/g, ' ');
  check('B: 选项仍然靠下（bottom 而不是 top）', /bottom:/.test(d) && /top:\s*auto/.test(d), d.trim());
  check('B: 选项靠右，让开左侧立绘', /right:/.test(d) && /left:\s*auto/.test(d), d.trim());
  check('B: 去掉了居中位移（不然右对齐会错位）', /transform:\s*none/.test(d), d.trim());
  check('B: 限高可滚，选项多了也不会顶到 HUD', /max-height:/.test(d) && /overflow-y:\s*auto/.test(d), d.trim());
  check('B: 宽度不会溢出窗口', /width:\s*min\(470px,\s*54vw\)/.test(d), d.trim());
}

// ---------------------------------------------------------------------------
// C) 同一档：HUD 一行放得下
// ---------------------------------------------------------------------------
if (band) {
  const group = declsOf('.vn-hud__group', band.body) || '';
  check('C: HUD 胶囊组不再换行', /flex-wrap:\s*nowrap/.test(group), group.replace(/\s+/g, ' ').trim());
  const icon = declsOf('.vn-icon', band.body) || '';
  check('C: 图标缩小到 34px', /width:\s*34px/.test(icon) && /height:\s*34px/.test(icon), icon.replace(/\s+/g, ' ').trim());
  const chip = declsOf('.vn-chip', band.body) || '';
  check('C: 胶囊字号压到 12px', /font-size:\s*12px/.test(chip), chip.replace(/\s+/g, ' ').trim());
  const loc = declsOf('.vn-loc', band.body) || '';
  check('C: 地点胶囊也缩小', /font-size:\s*11px/.test(loc), loc.replace(/\s+/g, ' ').trim());
}

// ---------------------------------------------------------------------------
// D) 手机档保持原样
// ---------------------------------------------------------------------------
const phone = blocks.find((b) => /max-width:\s*560px/.test(b.cond)
  && (declsOf('.vn-choices', b.body) || '').includes('top'));
check('D: 手机档仍然保留顶部排版（本改动不误伤小屏）', !!phone, 'missing');
if (phone) {
  const d = (declsOf('.vn-choices', phone.body) || '').replace(/\s+/g, ' ');
  check('D: 手机档选项仍贴顶 78px 且不换行位移', /top:\s*78px/.test(d), d.trim());
}

console.log(`\n总计 ${pass + failures.length} 项，PASS ${pass}，FAIL ${failures.length}`);
if (failures.length) console.error('失败用例: ' + failures.join(' | '));
process.exit(failures.length === 0 ? 0 : 1);
