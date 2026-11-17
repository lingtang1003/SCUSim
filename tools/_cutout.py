"""
把「近白/浅棋盘格底」的立绘抠成透明底，输出 810x1080 RGBA WebP。

做法（无 scipy 依赖）：
  1. 取图像的浅色背景参考色（只采上/左/右三边，避开底部衣物）；
  2. 在 640 长边的缩略图上，把「与背景色差 ≤ tol」的像素标成 bg 候选；
  3. 从顶部/左右边界做 BFS，只有 bg 候选会被填；底部不播种，避免漏进白衣服；
  4. 缩略 mask 放大回原图，再向下「填洞」（图内未连到边界的 bg 候选算前景）；
  5. alpha 羽化 1px，裁到内容包围盒，等比缩到高 1080，底对齐放在 810x1080 透明画布上。
"""
from PIL import Image, ImageFilter
from collections import deque
import numpy as np
import os
import sys

SRC = {
    'jiangxu': '豆包.png',
    'guchi': '豆包 (1).png',
    'linyu': '豆包 (2).png',
    'suwan': '豆包 (3).png',
    'tangtang': '豆包 (5).png',
    'zhouye': '豆包 (6).png',
}
IN_DIR = r"C:\Users\Le'novo\Downloads"
OUT_DIR = os.path.join('media', 'characters')
CHECK_DIR = os.path.join('media', 'shots', 'charcheck')
TOL = int(sys.argv[1]) if len(sys.argv) > 1 else 16
# 个别图的浅色衣服与白底几乎同色，用更低的容差可以让填充停在衣服的阴影边缘
TOL_BY_CHAR = {'guchi': 6}
CHECK = '--check' in sys.argv


def bg_reference(arr):
    h, w, _ = arr.shape
    pts = []
    for x in range(0, w, 7):
        pts.append(arr[2, x]); pts.append(arr[max(0, h // 6), x])
    for y in range(0, h // 2, 7):
        pts.append(arr[y, 2]); pts.append(arr[y, w - 3])
    med = np.median(np.array(pts, dtype=np.float32), axis=0)
    return med


def build_alpha(rgb, tol=TOL):
    arr = np.asarray(rgb, dtype=np.float32)
    h, w, _ = arr.shape
    ref = bg_reference(arr)

    small_max = 640
    scale = min(1.0, small_max / max(h, w))
    sw, sh = max(8, int(w * scale)), max(8, int(h * scale))
    small = np.asarray(rgb.resize((sw, sh), Image.LANCZOS), dtype=np.float32)

    diff = np.abs(small - ref).max(axis=2)
    bg_cand = diff <= tol

    filled = np.zeros((sh, sw), dtype=bool)
    dq = deque()
    # 播种：整条上边界 + 左/右边界上半段。
    # 下半段不播种：那里通常是白衬衫/浅色衣服贴着画面边，播进去会把衣服啃掉一块。
    seed_bottom = int(sh * 0.70)
    for x in range(sw):
        if bg_cand[0, x]:
            filled[0, x] = True; dq.append((0, x))
    for y in range(seed_bottom):
        for x in (0, sw - 1):
            if bg_cand[y, x] and not filled[y, x]:
                filled[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < sh and 0 <= nx < sw and bg_cand[ny, nx] and not filled[ny, nx]:
                filled[ny, nx] = True
                dq.append((ny, nx))

    alpha_small = np.where(filled, 0, 255).astype(np.uint8)
    # 边缘软化：紧贴背景的一圈按「与背景的色差」给半透明，
    # 把白底合成留下的白雾变成自然的柔边，而不是一圈硬白边
    dil = filled.copy()
    for _ in range(4):
        nd = dil.copy()
        nd[1:, :] |= dil[:-1, :]
        nd[:-1, :] |= dil[1:, :]
        nd[:, 1:] |= dil[:, :-1]
        nd[:, :-1] |= dil[:, 1:]
        dil = nd
    band = dil & ~filled
    ramp = (np.clip((diff - 6.0) / 26.0, 0.0, 1.0) * 255.0).astype(np.uint8)
    alpha_small[band] = np.minimum(alpha_small[band], ramp[band])
    alpha = Image.fromarray(alpha_small, 'L').resize((w, h), Image.BILINEAR)
    # 图内「没连到边界的浅色区域」也算前景（白衬衫/白毛衣不被挖空）
    filled_full = np.asarray(alpha, dtype=np.uint8) < 128
    alpha = Image.fromarray(np.where(filled_full, 0, 255).astype(np.uint8), 'L')

    # 羽化边缘
    alpha = alpha.filter(ImageFilter.GaussianBlur(1.0))
    return alpha


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    if CHECK:
        os.makedirs(CHECK_DIR, exist_ok=True)
    for cid, name in SRC.items():
        path = os.path.join(IN_DIR, name)
        im = Image.open(path).convert('RGB')
        # 先切掉底部 10%（AI 水印所在行），再做抠图；游戏里下半身本来就被对话框盖住
        im = im.crop((0, 0, im.width, int(im.height * 0.90)))
        alpha = build_alpha(im, TOL_BY_CHAR.get(cid, TOL))
        # 向内收 1px，去掉浅色背景在边缘留下的白边
        alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
        bbox = alpha.getbbox()
        if not bbox:
            print('!! no content', cid); continue
        cut = im.crop(bbox)
        raw = cut.copy()          # 保留未去白底的原色，KEEP 区域用它覆盖
        a = alpha.crop(bbox)
        cut.putalpha(a)

        # 去白边（decontaminate）：原图是「人像合成在白底」上的，
        # 半透明边缘像素 = a*C + (1-a)*白，反解出 C，避免人物边上留一圈白雾。
        arr = np.asarray(cut.convert('RGB'), dtype=np.float32)
        av = np.asarray(a, dtype=np.float32) / 255.0
        safe = np.clip(av, 0.18, 1.0)[..., None]
        arr = np.clip((arr - (1.0 - safe) * 255.0) / safe, 0, 255).astype(np.uint8)
        cut = Image.fromarray(arr, 'RGB')
        cut.putalpha(a)

        # 等比缩放到高 1080，底对齐放到 810x1080 透明画布
        cw, ch = cut.size
        target_h = 1080
        target_w = max(1, round(cw * target_h / ch))
        if target_w > 810:
            target_w = 810
            target_h = max(1, round(ch * target_w / cw))
        cut = cut.resize((target_w, target_h), Image.LANCZOS)
        raw = raw.resize((target_w, target_h), Image.LANCZOS)
        canvas = Image.new('RGBA', (810, 1080), (0, 0, 0, 0))
        canvas.paste(cut, ((810 - target_w) // 2, 1080 - target_h), cut)

        dst = os.path.join(OUT_DIR, cid + '.webp')
        canvas.save(dst, 'WEBP', quality=88, method=6)
        kept = (np.asarray(canvas.getchannel('A')) > 8).mean() * 100
        print(f'{cid:9s} {name:12s} bbox={bbox} -> {canvas.size} '
              f'{os.path.getsize(dst)}B  opaque={kept:.1f}%')

        if CHECK:
            for tag, bg in (('magenta', (255, 0, 255)), ('dark', (28, 24, 22)), ('paper', (250, 247, 246))):
                flat = Image.new('RGB', canvas.size, bg)
                flat.paste(canvas, (0, 0), canvas)
                flat.convert('RGB').resize((405, 540), Image.LANCZOS).save(
                    os.path.join(CHECK_DIR, f'{cid}-{tag}.jpg'), 'JPEG', quality=88)
    if CHECK:
        print('check composites ->', CHECK_DIR)


main()
