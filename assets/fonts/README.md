# 字体（assets/fonts/）

四支**子集化**自托管字体，只包含界面里实际用到的字符，合计约 **453 KB**，不依赖任何 CDN。

| 文件 | 字体（授权已购） | 用在 | 体积 |
|---|---|---|---|
| `title-wood.woff2` | 汉仪铸字木头人 W | 主标题「我的大学四年 / 果然有or没问题！」 | 6.7 KB |
| `sub-child.woff2` | 汉仪铸字儿童乐园 W | 副标题「在这里度过你的大学时光」 | 6.9 KB |
| `ui-tangmei.woff2` | 汉仪唐美人 W | **系统 UI 字体**（`--font`：HUD、选项、对话、菜单、弹窗、存档） | 430 KB |
| `display-hy.woff2` | 汉仪晓波花月圆 W | **展示字体**（`--font-display`：徽记 SCUSim、需要装饰性的地方） | 9 KB |
| `title.css` | — | 四个 `@font-face`，被 `css/style.css` 顶部 `@import` 引入 | — |

## 说明

- **授权**：以上均为汉仪正版字体，作者已购买授权，可随项目使用；
- **子集化**：`ui-tangmei` 覆盖了配置文件与源码里出现的全部字符（1512 个），
  玩家自定义名字里若出现生僻字，会按 CSS 字体栈回落到系统黑体，不会显示成方框；
- **重新生成子集**：

```bash
python -m pip install fonttools brotli
python -m fontTools.subset 原字体.ttf --text-file=charset.txt --flavor=woff2 \
  --no-hinting --desubroutinize --output-file=assets/fonts/xxx.woff2
```

- **替换/新增**：把子集放进本目录，在 `title.css` 加 `@font-face`，
  再到 `css/style.css` 的 `--font` / `--font-display` / `.vn-logo` / `.vn-logo__sub` 里改字体栈即可。
