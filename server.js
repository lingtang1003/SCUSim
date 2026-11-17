// SCUSim 本地静态开发服务器（纯 Node，无第三方依赖）
// 仅用于本地开发：npm run dev -> http://localhost:5173
// 注意：它不是 Cloudflare Pages 的生产后端。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg'
};

/** 代码类文件不缓存（改完刷新即生效）；字体/图片/音频缓存一天，避免每次刷新重下。 */
const NO_STORE_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map']);

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    // 防目录穿越：解析后必须仍在 ROOT 内
    const resolved = normalize(join(ROOT, urlPath));
    if (resolved !== ROOT && !resolved.startsWith(ROOT + sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    const data = await readFile(resolved);
    const mime = MIME[extname(resolved).toLowerCase()] || 'application/octet-stream';
    // 本地开发：禁用缓存，改完代码刷新即生效，避免「改了但页面没变」
    const ext = extname(resolved).toLowerCase();
    const cache = NO_STORE_EXT.has(ext) ? 'no-store' : 'public, max-age=86400';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cache });
    res.end(data);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`SCUSim dev server running at http://localhost:${PORT}`);
});

