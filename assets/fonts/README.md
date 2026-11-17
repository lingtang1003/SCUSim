# 字体（assets/fonts/）

四支**子集化**自托管字体，只含界面实际用到的字符，合计约 **625 KB**，不依赖任何 CDN。

| 文件 | 字体（授权已购） | 用在 | 体积 |
|---|---|---|---|
| `display-hy.woff2` | 汉仪晓波花月圆 W | **正文 / UI**（`--font`：HUD、选项、对话、按钮、存档内容） | 181 KB |
| `ui-tangmei.woff2` | 汉仪唐美人 W | **标题**（`--font-display`：弹窗/表单/抽屉/创建页标题、结局名、事件标签、徽记） | 430 KB |
| `title-wood.woff2` | 汉仪铸字木头人 W | 主标题（已内联进 `title.css` 的 data URI） | 6.7 KB |
| `sub-child.woff2` | 汉仪铸字儿童乐园 W | 副标题（已内联进 `title.css`） | 6.9 KB |
| `title.css` | — | 四个 `@font-face`，被 `css/style.css` 顶部 `@import` 引入 | — |

## 说明

- **授权**：以上均为汉仪正版字体，作者已购买授权，可随项目使用；
- **角色互换**：正文用晓波花月圆（细笔画、长文好读），标题用唐美人（手写感），
  改法就是交换 `css/style.css` 里 `--font` 与 `--font-display` 的第一顺位；
- **子集化**：两支正文字体都覆盖配置与源码中出现的全部 1512 个字符；
  玩家自定义名字里的生僻字按字体栈回落系统黑体，不会出现方框；
- **重新生成子集**：

```bash
python -m pip install fonttools brotli
python -m fontTools.subset 原字体.ttf --text-file=charset.txt --flavor=woff2 \
  --no-hinting --desubroutinize --output-file=assets/fonts/xxx.woff2
```


## 加载策略（避免“字体还在加载”）

| 手段 | 效果 |
|---|---|
| 两支标题字体**内联**成 `data:` URI | 不产生网络请求，标题永不闪 |
| 两支正文字体 `<link rel="preload">` | 与 CSS 并行下载，先于首次绘制 |
| `font-display: fallback` | 100ms 极短阻塞期，之后先用回退字形显示（避免文字长时间空白），字体到位再替换 |
| 服务端 `Cache-Control: max-age=86400` | 刷新不重下（dev 服务器原本是 `no-store`，所以每次都重新下载） |
| 子集化 | 只含界面实际用字，合计 ~620 KB |

> 网页字体本质是资源，第一次访问必然要下载一次；能做到的是**只下一次**、且**不闪烁**。
