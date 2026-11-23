#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重新生成正文字体子集（晓波花月圆 / 唐美人）。

为什么需要它：assets/fonts/*.woff2 都是「子集」，只包含打子集那一刻仓库里出现过的字符。
新写剧情如果用到子集外的字（生僻字、新符号），浏览器会回退到系统字体（微软雅黑），
表现为「手写体里混进黑体」。改完剧情跑一次本脚本即可。

用法：
  python tools/subset-fonts.py --check     # 只检查缺字，不改文件（推荐每次改完剧情跑）
  python tools/subset-fonts.py             # 重打两支正文字体（写入 assets/fonts/）

字体源默认目录：C:/Users/19337/Documents/SCUSim-字体源
也可用环境变量覆盖：SCUSIM_FONT_DIR
"""
import argparse
import glob
import io
import os
import subprocess
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.environ.get("SCUSIM_FONT_DIR", r"C:\Users\19337\Documents\SCUSim-字体源")

# 输出文件 → (源字体文件名, 说明)
TARGETS = {
    "assets/fonts/display-hy.woff2": ("HYXiaoBoHuaYueYuanW-晓波花月圆.ttf", "正文 / UI"),
    "assets/fonts/ui-tangmei.woff2": ("HYTangMeiRenW-唐美人.ttf", "标题"),
}

# 需要纳入字符集的文本来源（运行时真正会显示的文字都在这里）
TEXT_GLOBS = ["config/*.json"]
TEXT_FILES = ["src/ui/ui.js", "src/main.js", "index.html", "css/style.css"]

# 字体没有、只能用等价字符替代的符号（改文案时别再写左边这些）
UNSUPPORTED = "−◈✦♡▾⌄☰"

# 唐美人没有这些符号，但用到它们的地方（按钮/好感提示/菜单图标）都走正文字体，
# 所以对标题字体不算缺字，只作为提示
DISPLAY_SAFE = "←→↑↓≥≡›‹"


def collect_charset():
    """GB2312 全集 + 仓库用字：覆盖日常中文，改剧情基本不会再缺字。"""
    chars = set()
    for hi in range(0xA1, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    for i in range(0x20, 0x7F):
        chars.add(chr(i))

    sources = []
    for pat in TEXT_GLOBS:
        sources += glob.glob(os.path.join(ROOT, pat))
    sources += [os.path.join(ROOT, f) for f in TEXT_FILES]
    for path in sources:
        if os.path.exists(path):
            for ch in _rendered_text(path):
                if ord(ch) > 127:
                    chars.add(ch)
    return chars, sources


def _rendered_text(path):
    """读取文件里真正会被渲染的文字：JS / CSS 先剥掉注释。"""
    text = io.open(path, encoding="utf-8").read()
    if path.endswith(".js"):
        text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
        text = re.sub(r"(^|\s)//[^\n]*", " ", text)
    elif path.endswith(".css"):
        text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    return text


def coverage(path):
    from fontTools.ttLib import TTFont

    font = TTFont(path)
    cps = set()
    for table in font["cmap"].tables:
        cps |= set(table.cmap.keys())
    return cps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只检查，不重打")
    args = ap.parse_args()

    chars, sources = collect_charset()
    print("字符集：%d 个（GB2312 全集 + 仓库用字，来源 %d 个文件）" % (len(chars), len(sources)))

    charset_path = os.path.join(ROOT, ".font-charset.txt")
    io.open(charset_path, "w", encoding="utf-8", newline="").write("".join(sorted(chars)))

    # 当前子集的缺字情况
    used = set()
    for path in sources:
        if os.path.exists(path):
            used |= {c for c in _rendered_text(path) if ord(c) > 127}

    missing_any = False
    for out, (src_name, label) in TARGETS.items():
        out_path = os.path.join(ROOT, out)
        if os.path.exists(out_path):
            cov = coverage(out_path)
            miss = sorted(c for c in used
                          if ord(c) not in cov and not _is_emoji(c) and c not in DISPLAY_SAFE)
            print("\n%s（%s）当前子集 %d 字，缺 %d 字" % (out.split("/")[-1], label, len(cov), len(miss)))
            if miss:
                missing_any = True
                print("   缺字：" + "".join(miss[:80]) + ("…" if len(miss) > 80 else ""))
                bad_sym = [c for c in UNSUPPORTED if c in used]
                if bad_sym:
                    print("   注意：字体本身没有这些符号，建议换成 - ◆ ≡ ▼：" + "".join(bad_sym))

        if args.check:
            continue

        src_path = os.path.join(FONT_DIR, src_name)
        if not os.path.exists(src_path):
            print("   跳过重打：找不到源字体 %s" % src_path)
            continue
        before = os.path.getsize(out_path) / 1024 if os.path.exists(out_path) else 0
        cmd = [
            sys.executable, "-m", "fontTools.subset", src_path,
            "--text-file=" + charset_path,
            "--flavor=woff2",
            "--no-hinting",
            "--desubroutinize",
            "--layout-features=*",
            "--output-file=" + out_path,
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print("   重打失败：" + (r.stderr or "")[-300:])
            continue
        print("   已重打：%.0f KB → %.0f KB" % (before, os.path.getsize(out_path) / 1024))

    if os.path.exists(charset_path):
        os.remove(charset_path)

    if args.check:
        print("\n检查完成：" + ("发现缺字，跑一次不带 --check 的命令即可重打" if missing_any else "没有缺字，不用重打"))
    return 0


def _is_emoji(ch):
    cp = ord(ch)
    return (
        0x1F300 <= cp <= 0x1FAFF
        or 0x2600 <= cp <= 0x27BF
        or cp in (0xFE0F, 0x200D)
    )


if __name__ == "__main__":
    sys.exit(main())
