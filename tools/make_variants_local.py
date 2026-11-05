"""画像編集 AI を使わずに、元の絵 1 枚から描き分け（部品）をコードで作る。
  目のコマ  ＝ 上まぶた（まつ毛の帯）を元の画素のまま下へ滑らせ、空いた所を上の肌の色で埋める
  表情      ＝ 笑顔（まぶたを ∩ の形で閉じる）・ジト目（まぶたを平らに半分まで下ろす）
  眉        ＝ 眉の濃さ brow_alpha.png と、眉を消した肌 no_brow.png（上げ下げはシェーダー）
  黒目      ＝ 黒目の濃さ iris_alpha.png、黒目を消した白目 no_iris.png、目の開いた所 eye_open.png（視線はシェーダー）
  口なし    ＝ 口の線だけを周りの肌で埋める（開いた口はシェーダーが描く）
  髪なし    ＝ 髪を外し、人物の上は周りの色で埋め（inpaint）、外は背景色にする
  髪だけ    ＝ 髪の画素を残して緑地に

python tools/make_variants_local.py [--gen gen] [--debug out/variants_debug.png]
  gen/src.png と gen/config.json の "local" を読み、gen/ に bald_open.png, hair_only.png, hair_alpha.png, eye_*.png, no_mouth.png を書く。
  そのあと tools/build_layers.py をいつもどおり実行する。

"local" の例（座標は 1024×1024 にそろえた絵の画素）:
  "eyes": [{"box": [x0, y0, x1, y1], "outer": [x, y], "inner": [x, y]}, ...]  目の範囲（眉は入れない）と目じり・目がしら
  "mouth_box": [440, 648, 575, 692]                      口の線の範囲
  "body_poly": [[0, 895], ...]                            服（髪と同じ色の所）の多角形。髪の判定から外す
  "face_poly": [[...], ...]                               顔・耳・首の多角形（中の暗い所は外の髪とつながる毛だけを髪とみなす）
  "keep_boxes": [[x0, y0, x1, y1], ...]                   髪にしない所（眉・口など。目は自動で外す）。髪の毛に掛からないよう小さめに
  "brows": [[x0, y0, x1, y1], ...]                        眉の範囲（上げ下げする。眉は keep_boxes にも入れておく）
  "hair_ymax": 870                                        これより下は髪として扱わない

AI-free variants: slides the original upper-lash band down for blinks, inpaints the mouth line,
and detaches the hair (inpainting what is under it on the body, background elsewhere) so it can sway.
"""
import json, sys
from pathlib import Path
import numpy as np, cv2
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
_arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
G = Path(_arg("--gen", str(ROOT / "gen")))
DEBUG = _arg("--debug", "")
cfg = json.load(open(G / "config.json", encoding="utf-8")) if (G / "config.json").exists() else {}
L = cfg.get("local", {})
N = int(cfg.get("size", 1024))
src = cv2.imread(str(G / "src.png"))
if src is None: sys.exit(f"{G / 'src.png'} がありません")
if src.shape[:2] != (N, N): src = cv2.resize(src, (N, N), interpolation=cv2.INTER_AREA)
S = src.astype(np.float32)
LUMA = np.array([0.114, 0.587, 0.299], np.float32)
Y = S @ LUMA
bg = np.array(cfg.get("background_rgb", [252, 251, 251])[::-1], np.float32)
ES = float(L.get("eye_scale", 1.0))                                                # 目の大きさの倍率（目の幅 150px ほどで 1。全身の絵などで目が小さいときは 0.3 など）
px = lambda v, lo=1: max(lo, int(round(v * ES)))                                  # 目まわりの画素数を倍率で


def poly_mask(pts):
    m = np.zeros((N, N), np.uint8)
    if pts: cv2.fillPoly(m, [np.array(pts, np.int32)], 1)
    return m > 0


# ───────────────────────── 髪 ─────────────────────────
def hair_masks():
    """髪の濃さ（0〜1）。顔の中は外の髪とつながった毛だけ、服の上は赤い毛先だけを髪とみなす"""
    b, g, r = S[..., 0], S[..., 1], S[..., 2]
    notbg = np.abs(S - bg).max(2)
    skin = (Y > 175) & (r > b + 6)
    body = poly_mask(L.get("body_poly")); face = poly_mask(L.get("face_poly"))
    dark = np.clip((200 - Y) / 90.0, 0, 1)                                         # 紺の髪と細い毛
    red = np.clip(((r - np.maximum(g, b)) - 40) / 30.0, 0, 1) * (Y < 160)            # 赤い毛先
    bgY = float(bg @ LUMA)
    matte = np.clip((bgY - 4 - Y) / (bgY - 64), 0, 1)                               # 白地の上の毛：白との混ざり具合が濃さ
    a = np.maximum(dark, red)
    a[skin] = 0
    a = np.where(face | body, a, np.maximum(a, matte * (notbg > 6)))
    a[body] = red[body] * (notbg[body] > 10)                                        # 服（紺）は髪にしない。赤い毛先だけ
    a[int(L.get("hair_ymax", N)):] = 0
    for x0, y0, x1, y1 in L.get("keep_boxes", []): a[y0:y1, x0:x1] = 0             # 目・眉・口は髪にしない
    for e in L.get("eyes", []):                                                     # 目じり〜目がしらの間だけ（外の毛は切らない。切ると揺れたとき境目が線になる）
        x0, y0, x1, y1 = e["box"]; xa, xb = sorted([e["outer"][0], e["inner"][0]])
        a[y0:y1, max(x0, xa - 4):min(x1, xb + 5)] = 0
    # 顔の中の暗い所は、顔の外の髪とつながっているものだけ
    lab, n = ndi.label(a > 0.25)
    out_ids = np.unique(lab[(~face) & (~body) & (lab > 0)])
    keep = np.isin(lab, out_ids) | ((lab > 0) & ~face)
    sizes = ndi.sum(a > 0.25, lab, range(1, n + 1))
    keep &= ~np.isin(lab, 1 + np.nonzero(np.asarray(sizes) < 60)[0])
    core = keep & (a > 0.25)
    near = cv2.dilate(core.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0          # 毛のふちの薄い所も含める
    a = a * near
    return a, core, face, body


# ───────────────────────── 目 ─────────────────────────
def robust_fit(xs, ys, deg):
    xs = np.asarray(xs, np.float64); ys = np.asarray(ys, np.float64); keep = np.ones(len(xs), bool)
    for _ in range(4):
        p = np.polyfit(xs[keep], ys[keep], deg); res = np.abs(np.polyval(p, xs) - ys)
        thr = max(2.5, 2.5 * np.median(res[keep]))
        keep = res < thr
    return p, keep


def eye_geometry(spec):
    """上まつ毛の上端 top(x)・帯の厚み T・下まつ毛 bot(x)。目じり（outer）と目がしら（inner）の間を列ごとに測る。
    spec = {"box": [x0, y0, x1, y1], "outer": [x, y], "inner": [x, y]}（目じり・目がしら＝上下のまぶたが合わさる所）"""
    box = spec["box"]; x0, y0, x1, y1 = box
    (xa, ya), (xb, yb) = sorted([tuple(spec["outer"]), tuple(spec["inner"])])
    xs_t, ys_t, th, xs_b, ys_b = [], [], [], [], []
    for x in range(xa, xb + 1):
        c = Y[y0:y1, x]
        RUN = px(4, 2)
        run = np.convolve((c < 110).astype(int), np.ones(RUN, int), "valid") == RUN  # 何画素か続く暗い所（細い髪や二重の線を避ける）
        idx = np.nonzero(run)[0]
        if not len(idx): continue
        t = idx[0]; xs_t.append(x); ys_t.append(y0 + t)
        k = t
        while k < len(c) and c[k] < 75: k += 1                                     # まつ毛の帯（真っ黒に近い所）
        th.append(k - t)
        seg = c[t + px(20, 4):t + px(100, 20)]
        below = np.nonzero(seg < 175)[0]
        if len(below): xs_b.append(x); ys_b.append(y0 + t + px(20, 4) + below[-1])
    xa_ = np.arange(N, dtype=np.float64)
    ys_t = ndi.median_filter(np.asarray(ys_t, np.float64), px(9, 3), mode="nearest")
    ys_t = ndi.gaussian_filter1d(ys_t, max(0.7, 2.0 * ES), mode="nearest")
    top = np.interp(xa_, xs_t, ys_t)                                               # 範囲の外は端の値のまま
    inner = (np.asarray(xs_b) > xa + 0.15 * (xb - xa)) & (np.asarray(xs_b) < xb - 0.15 * (xb - xa))
    pb, _ = robust_fit(np.asarray(xs_b)[inner], np.asarray(ys_b)[inner], 2)
    bot = np.polyval(pb, xa_)
    T = float(np.clip(np.percentile(th, 60), 8 * ES, 30 * ES))
    ramp = float(spec.get("ramp", 22))
    w = np.clip((xa_ - xa) / ramp, 0, 1) * np.clip((xb - xa_) / ramp, 0, 1)
    w = w * w * (3 - 2 * w)                                                        # 目の端で動きを 0 に
    return {"top": top, "bot": bot, "T": T, "x0": xa, "x1": xb, "ya": ya, "yb": yb, "w": w, "box": box}


CLEAN = {}


def clean_skin(geo):
    """目のまわりの肌から暗い線（跳ねたまつ毛・二重の線・細い髪）を消してぼかした絵。まぶたを埋める色に使う"""
    key = tuple(geo["box"])
    if key in CLEAN: return CLEAN[key]
    x0, y0, x1, y1 = geo["box"]
    reg = np.clip(S[y0:y1, x0:x1], 0, 255).astype(np.uint8)
    yv = reg.astype(np.float32) @ LUMA
    loc = cv2.GaussianBlur(yv, (0, 0), max(1.5, 5 * ES))
    m = ((loc - yv) > 5) | (yv < 205)
    rr = np.arange(y0, y1)[:, None]; cc = np.arange(x0, x1)[None, :]
    m |= (rr >= geo["top"][cc] - px(7, 2)) & (rr <= geo["bot"][cc] + px(4, 1))     # 目そのもの（帯〜下まつ毛）も消す
    m = cv2.dilate(m.astype(np.uint8), np.ones((5, 5), np.uint8))
    out = cv2.inpaint(reg, m, 9, cv2.INPAINT_TELEA).astype(np.float32)
    out = cv2.GaussianBlur(out, (0, 0), 3)
    full = S.copy(); full[y0:y1, x0:x1] = out
    CLEAN[key] = full
    return full


def lid_skin(geo, off, ref):
    """列ごとに、ref(x)+off の高さのきれいな肌の色"""
    cl = clean_skin(geo); x0, y0, x1, y1 = geo["box"]
    col = np.zeros((N, 3), np.float32)
    for x in range(x0, x1):
        yy = int(np.clip(round(ref[x] + off), y0, y1 - 1)); col[x] = cl[yy, x]
    return col


def lash_shadow(geo):
    """まつ毛のすぐ上の薄い影の色（元の絵の、帯の上の数画素の明るい所）。閉じたまぶたの下の方をこの色にする"""
    x0, y0, x1, y1 = geo["box"]
    col = np.zeros((N, 3), np.float32); ok = np.zeros(N, np.float32)
    for x in range(x0, x1):
        t = int(round(geo["top"][x]))
        pp = S[max(0, t - px(6, 2)):t, x]; yv = pp @ LUMA
        pp = pp[yv > 150]
        if len(pp): col[x] = np.median(pp, axis=0); ok[x] = 1
    num = cv2.GaussianBlur((col * ok[:, None])[None], (0, 0), 5)[0]
    den = cv2.GaussianBlur(ok[None], (0, 0), 5)[0]
    return num / np.maximum(den, 1e-3)[:, None]


def corners(geo):
    return (geo["x0"], geo["ya"]), (geo["x1"], geo["yb"])


def crease_line(geo, pad):
    """二重の線の下端（列ごと）。まぶたはこの線より下を引き伸ばして下ろす（線そのものは動かさない）"""
    x0, y0, x1, y1 = geo["box"]
    cb = np.zeros(N, np.float64)
    lo_off, hi_off = px(30, 6), px(3, 1)
    for x in range(x0, x1):
        ys = geo["top"][x] - pad
        r0, r1 = int(max(0, ys - lo_off)), int(max(1, ys - 1))
        col = Y[r0:r1, x]
        found = None
        if len(col) > 2:
            ref = np.percentile(col, 80)
            idx = np.nonzero(col < ref - 18)[0]
            if len(idx): found = r0 + idx[-1] + 1
        cb[x] = found if found is not None else ys - px(14, 3)
    v = ndi.median_filter(cb[x0:x1], px(9, 3), mode="nearest")
    cb[x0:x1] = ndi.gaussian_filter1d(v, max(0.8, 2.0 * ES), mode="nearest")
    for x in range(x0, x1):
        ys = geo["top"][x] - pad
        cb[x] = np.clip(cb[x], ys - lo_off, ys - hi_off)
    return cb


def render_eye(img, geo, line, fill_below=False, thin=0.0, shade=0.06):
    """line(x)＝まつ毛の帯の新しい中心の y。帯（上に跳ねた毛＋まつ毛）を元の画素のまま下ろす。
    まぶた＝二重の線の下から帯の上までの肌（跳ねたまつ毛を消した絵）を、縦に引き伸ばして埋める（色の移り変わりは元の絵のまま）。
    fill_below＝帯の下から下まぶたまでも肌にする（閉じた目・笑顔。目を消してなじませた肌で）。thin＝帯を薄くする割合"""
    x0, y0, x1, y1 = geo["box"]
    pad = max(2.0, 7.0 * ES)
    k = 1.0 - thin
    T0 = geo["T"] + pad
    cb = crease_line(geo, pad)
    clean = clean_skin(geo)
    out = img.copy()
    for x in range(x0, x1):
        top = geo["top"][x]; ys = top - pad
        ww = geo["w"][x]
        if ww <= 0: continue
        nb0 = ys + ww * (line[x] - (pad + geo["T"] * 0.5) * k - ys)                   # 帯の新しい上端（目の端では元の位置）
        d = nb0 - ys
        if d < 0.3: continue
        nb1 = nb0 + T0 * k
        c0 = cb[x]
        for y in range(int(np.floor(c0)), y1):
            if y < 0 or y >= N: continue
            if y < nb0:                                                             # まぶた：二重の線の下〜帯の上の元の肌を引き伸ばす
                u = (y + 0.5 - c0) / max(nb0 - c0, 1e-3)
                sy = c0 + u * (ys - c0) - 0.5
                f = sy - np.floor(sy); a = int(np.floor(sy))
                c = clean[a, x] * (1 - f) + clean[a + 1, x] * f                        # 跳ねたまつ毛を消した肌（縦の筋にならない）
                c = c * (1.0 - shade * np.clip(u, 0, 1) ** 2.5 * min(1.0, d / max(1.0, 6 * ES)))   # 帯の近くに薄い影
            elif y < nb1:                                                           # 帯：元の画素を縦に縮めて置く
                sy = ys + (y - nb0) / k
                f = sy - np.floor(sy); a = int(np.floor(sy))
                c = S[a, x] * (1 - f) + S[a + 1, x] * f
            else:
                if not fill_below: break
                lim = geo["bot"][x] + px(7, 2)
                if y > lim: break
                w = np.clip((y - nb1 + 1) / max(1.0, 2.0 * ES), 0, 1) * np.clip((lim - y) / max(1.0, 3.0 * ES), 0, 1) * ww
                c = out[y, x] * (1 - w) + clean[y, x] * w
            out[y, x] = c
    return out


def arc(geo, sag):
    """目じりと目がしらを結ぶ弧。sag > 0 で下に（‿ 閉じた目）、< 0 で上に（∩ 笑顔）ふくらむ"""
    (xa, ya), (xb, yb) = corners(geo)
    xa_ = np.arange(N, dtype=np.float64)
    u = np.clip((xa_ - xa) / (xb - xa), 0, 1)
    return ya + (yb - ya) * u + sag * 4 * u * (1 - u)


def opening(geo):
    mid = int((geo["x0"] + geo["x1"]) / 2)
    return float(geo["bot"][mid] - geo["top"][mid])


def close_line(geo, c):
    """開いた目の帯の中心 → 閉じた目の弧（‿）へ c の割合で"""
    open_line = geo["top"] + geo["T"] * 0.5
    closed = arc(geo, opening(geo) * 0.26)
    return open_line + c * np.maximum(0, closed - open_line)


def smile_line(geo):
    """笑顔の目：∩ の弧で閉じる"""
    open_line = geo["top"] + geo["T"] * 0.5
    return np.maximum(open_line, arc(geo, -opening(geo) * 0.22))


def jito_line(geo, level=0.42):
    """ジト目：まぶたを平らに半分弱まで"""
    open_line = geo["top"] + geo["T"] * 0.5
    mid = int((geo["x0"] + geo["x1"]) / 2)
    (xa, ya), (xb, yb) = corners(geo)
    xa_ = np.arange(N, dtype=np.float64); u = np.clip((xa_ - xa) / (xb - xa), 0, 1)
    flat = open_line[mid] + level * opening(geo) + (yb - ya) * (u - 0.5) * 0.6
    return np.maximum(open_line, flat)


# ───────────────────────── 口 ─────────────────────────
def remove_mouth(img):
    x0, y0, x1, y1 = L.get("mouth_box", cfg.get("mouth_region", [380, 600, 650, 820]))
    reg = img[y0:y1, x0:x1].astype(np.float32); y = reg @ LUMA
    loc = cv2.GaussianBlur(y, (0, 0), 7)
    m = ((loc - y) > 8).astype(np.uint8)
    if ES >= 0.6: m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))   # 小さい絵では口の線が細いので削らない
    k = px(7, 3) | 1
    m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    full = np.zeros((N, N), np.uint8); full[y0:y1, x0:x1] = m
    out = cv2.inpaint(np.clip(img, 0, 255).astype(np.uint8), full, 6, cv2.INPAINT_TELEA).astype(np.float32)
    # 埋めた所は少しぼかして、ムラを消す
    bl = cv2.GaussianBlur(out, (0, 0), 3)
    mm = cv2.GaussianBlur(full.astype(np.float32), (0, 0), 2)[..., None]
    return out * (1 - mm) + bl * mm, full


# ───────────────────────── 眉 ─────────────────────────
def brow_alpha():
    """眉の濃さ（0〜1）。眉の箱の中の、いちばん大きい暗いかたまり＋ふち。肌との混ざり具合を濃さにする"""
    out = np.zeros((N, N), np.float32)
    for x0, y0, x1, y1 in L.get("brows", []):
        y = Y[y0:y1, x0:x1]
        skinY = float(np.percentile(y, 80)); inkY = float(np.percentile(y, 2))
        m = (y < (skinY + inkY) / 2).astype(np.uint8)
        lab, n = ndi.label(m)
        if n == 0: continue
        sizes = ndi.sum(m, lab, range(1, n + 1)); main = lab == 1 + int(np.argmax(sizes))
        near = cv2.dilate(main.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))) > 0
        a = np.clip((skinY - 3 - y) / max(skinY - inkY, 1), 0, 1) * near
        out[y0:y1, x0:x1] = np.maximum(out[y0:y1, x0:x1], a)
    return out


# ───────────────────────── 黒目（視線） ─────────────────────────
def iris_layers(base_img):
    """黒目（楕円）の濃さ・黒目を消した白目・目の開いた所（上まつ毛の帯の下〜下まつ毛の上）。
    黒目は赤みの強い所に楕円を当てはめる。黒目の下の白目は、行ごとに左右の白目の色を直線でつなぐ"""
    a = np.zeros((N, N), np.float32); opening = np.zeros((N, N), np.float32)
    out = base_img.copy()
    b, g, r = S[..., 0], S[..., 1], S[..., 2]
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    for spec in L.get("eyes", []):
        geo = eye_geometry(spec)
        op = np.zeros((N, N), np.uint8)
        for x in range(geo["x0"] + 3, geo["x1"] - 2):
            ya = int(np.ceil(geo["top"][x] + geo["T"] * 0.8)); yb = int(np.floor(geo["bot"][x] - 2 - (1.5 if ES < 0.6 else 0)))   # 小さい目は下まつ毛から離す
            if yb > ya: op[ya:yb, x] = 1
        cand = (op.astype(bool) & (((r - g) > 45) | (Y < 150))).astype(np.uint8)
        K7 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px(7, 3) | 1, px(7, 3) | 1))
        cand = cv2.erode(cand, K7)                                                     # 細いつながり（目じりの赤み・影）を切る
        lab, n = ndi.label(cand)
        if n == 0: continue
        sizes = ndi.sum(cand, lab, range(1, n + 1)); main = lab == 1 + int(np.argmax(sizes))
        main = cv2.dilate(main.astype(np.uint8), K7) > 0
        ys_, xs_ = np.nonzero(main & op.astype(bool))
        if len(xs_) < 50: continue
        ex0, ex1 = np.percentile(xs_, [0.5, 99.5]); ey1 = np.percentile(ys_, 99.5)
        cx = (ex0 + ex1) / 2; rx = (ex1 - ex0) / 2 + px(2, 0); ry = rx * float(spec.get("iris_aspect", 1.15))
        cy = ey1 + 1 - ry                                                             # 下の端に合わせる（上はまぶたに隠れている）
        d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
        el = np.clip((1.0 - d) * rx / 1.2 + 0.5, 0, 1)                                # ふち 1 画素ぶんなめらかに
        opf = cv2.GaussianBlur(op.astype(np.float32), (0, 0), 0.8)
        a = np.maximum(a, el); opening = np.maximum(opening, opf)                      # 黒目はまぶたで切らない（ずらしたとき上に隙間が出ない）
        # 白目：行ごとに、黒目の外の明るい所（白目）の左右の色を直線でつなぐ。見つからない行は近い行の色
        sclera = op.astype(bool) & (d > 1.08) & (Y > 190) & (np.abs(r - b) < 30)
        rows = {}
        y_lo, y_hi = int(cy - ry) - 2, int(cy + ry) + 3
        for y in range(max(0, y_lo), min(N, y_hi)):
            xl = [x for x in range(int(cx - rx) - 1, int(cx - rx) - px(40, 8), -1) if 0 <= x < N and sclera[y, x]][:4]
            xr = [x for x in range(int(cx + rx) + 1, int(cx + rx) + px(40, 8)) if 0 <= x < N and sclera[y, x]][:4]
            if xl or xr:
                cl = np.mean([S[y, x] for x in xl], 0) if xl else None; cr = np.mean([S[y, x] for x in xr], 0) if xr else None
                rows[y] = (cl if cl is not None else cr, cr if cr is not None else cl)
        if rows:
            ks = np.array(sorted(rows))
            for y in range(max(0, y_lo), min(N, y_hi)):
                cl, cr = rows[int(ks[np.argmin(np.abs(ks - y))])]
                for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                    if not (0 <= x < N) or d[y, x] > 1.12 or not op[y, x]: continue
                    u = np.clip((x - (cx - rx)) / (2 * rx), 0, 1)
                    out[y, x] = cl * (1 - u) + cr * u
        print(f"黒目: 中心 ({cx:.0f}, {cy:.0f}) 半径 {rx:.0f}×{ry:.0f}")
    return a, opening, out


# ───────────────────────── 頭（あごから上）と首 ─────────────────────────
def head_mask(seeds):
    """頭の範囲（顔の肌＋耳。あごの輪郭線で首と分ける）。暗い線を壁にして、鼻と耳から塗りつぶす"""
    wall = (Y < 165).astype(np.uint8)
    wall = cv2.dilate(wall, np.ones((2, 2), np.uint8)) > 0                         # 線のすき間をふさぐ
    allowed = ~wall & poly_mask(L.get("face_poly"))
    lab, n = ndi.label(allowed)
    sizes = np.bincount(lab.ravel())
    ids = set(); r = px(24, 6)
    for x, y in seeds:                                                               # 種のまわりで、いちばん大きいかたまり（線の上に当たっても拾う）
        x, y = int(x), int(y)
        win = lab[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1]
        cand = [v for v in np.unique(win) if v > 0]
        if cand: ids.add(int(max(cand, key=lambda v: sizes[v])))
    m = np.isin(lab, list(ids))
    face = poly_mask(L.get("face_poly"))
    for e in L.get("eyes", []):                                                      # 目・眉・口は頭に（髪とつながっていて穴にならないことがある）
        x0, y0, x1, y1 = e["box"]; m[y0:y1, x0:x1] |= face[y0:y1, x0:x1]
    for x0, y0, x1, y1 in L.get("keep_boxes", []) + L.get("brows", []) + [L.get("mouth_box", [0, 0, 0, 0])]:
        m[y0:y1, x0:x1] |= face[y0:y1, x0:x1]
    m = ndi.binary_fill_holes(m)                                                     # 鼻なども頭に
    k = px(9, 3) | 1
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) > 0
    m = ndi.binary_fill_holes(m)
    k = px(5, 3) | 1
    m = cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) > 0   # 輪郭線（あご・頬・耳）も頭に
    return m


# ───────────────────────── 書き出し ─────────────────────────
hair, core, face, body = hair_masks()
inside = face | body                                                                # 人物の中：髪の下を周りの色で埋める
det = hair > 0.04                                                                  # 外す髪（髪の濃さ hair_alpha と同じ範囲。ずれると止まった絵に線が出る）
fill_in = cv2.dilate((det & inside).astype(np.uint8), np.ones((5, 5), np.uint8))   # 埋める色は、毛のふちの外から取る
inp = cv2.inpaint(src, fill_in, 7, cv2.INPAINT_TELEA).astype(np.float32)
bald = S.copy()
bald[det & inside] = inp[det & inside]
bald[det & ~inside] = bg
ho = np.where((hair > 0.25)[..., None], S, np.array([0, 255, 0], np.float32))      # 髪だけ（緑地）
cv2.imwrite(str(G / "bald_open.png"), np.clip(bald, 0, 255).astype(np.uint8))
cv2.imwrite(str(G / "hair_only.png"), ho.astype(np.uint8))
alpha = np.maximum(hair, (cv2.erode(core.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0).astype(np.float32)) * det   # 毛の中は 1、ふちだけ半透明
cv2.imwrite(str(G / "hair_alpha.png"), np.clip(alpha * 255, 0, 255).astype(np.uint8))
print("髪:", int((hair > 0.25).sum()), "画素（うち人物の上を埋めた所", int((det & inside).sum()), "画素）")

geos = [eye_geometry(b) for b in L.get("eyes", [])]
for i, g in enumerate(geos):
    mid = int((g["x0"] + g["x1"]) / 2)
    print(f"目{i}: x {g['x0']}–{g['x1']}  上まつ毛 y {g['top'][mid]:.1f}  下まつ毛 y {g['bot'][mid]:.1f}  帯の厚み {g['T']:.1f}")


def eyes_with(fn, **kw):
    im = bald.copy()
    for g in geos: im = render_eye(im, g, fn(g), **kw)
    return im


steps = {"eye_12": 0.12, "eye_25": 0.25, "eye_37": 0.37, "eye_half": 0.5, "eye_62": 0.62, "eye_75": 0.75, "eye_87": 0.87}
outs = {}
for name, c in steps.items():
    outs[name] = eyes_with(lambda g: close_line(g, c), thin=0.3 * c * c)
outs["eye_closed"] = eyes_with(lambda g: close_line(g, 1.0), thin=0.4, fill_below=True)
outs["eye_smile"] = eyes_with(smile_line, thin=0.35, fill_below=True)
outs["eye_jito"] = eyes_with(jito_line)
for name, im in outs.items():
    cv2.imwrite(str(G / f"{name}.png"), np.clip(im, 0, 255).astype(np.uint8))
nm, mm = remove_mouth(bald)
cv2.imwrite(str(G / "no_mouth.png"), np.clip(nm, 0, 255).astype(np.uint8))
if L.get("eyes"):                                                                  # 黒目（視線を動かす部品）と、黒目を消した白目
    ia, op, ni = iris_layers(bald)
    cv2.imwrite(str(G / "iris_alpha.png"), np.clip(ia * 255, 0, 255).astype(np.uint8))
    cv2.imwrite(str(G / "eye_open.png"), np.clip(op * 255, 0, 255).astype(np.uint8))
    cv2.imwrite(str(G / "no_iris.png"), np.clip(ni, 0, 255).astype(np.uint8))
hd_ = cfg.get("head") or {}
if hd_.get("nose") and L.get("ears"):                                              # 頭の範囲と、頭の後ろ（首を上へ伸ばした絵）
    hm = head_mask([hd_["nose"][:2]] + L["ears"])
    cv2.imwrite(str(G / "head_alpha.png"), (hm * 255).astype(np.uint8))
    ys_, xs_ = np.nonzero(hm)
    print("頭:", int(hm.sum()), "画素  y", int(ys_.min()), "〜", int(ys_.max()), " x", int(xs_.min()), "〜", int(xs_.max()))
if L.get("brows"):                                                                 # 眉（上げ下げする部品）と、眉を消した肌
    ba = brow_alpha()
    cv2.imwrite(str(G / "brow_alpha.png"), np.clip(ba * 255, 0, 255).astype(np.uint8))
    bm = cv2.dilate((ba > 0.02).astype(np.uint8), np.ones((5, 5), np.uint8))
    nb = cv2.inpaint(np.clip(bald, 0, 255).astype(np.uint8), bm, 7, cv2.INPAINT_TELEA)
    cv2.imwrite(str(G / "no_brow.png"), nb)
    print("眉:", int((ba > 0.5).sum()), "画素")
print("書き出し:", G, sorted(list(outs) + ["bald_open", "hair_only", "no_mouth"]))

if DEBUG:
    Path(DEBUG).parent.mkdir(parents=True, exist_ok=True)
    ex0 = min(g["box"][0] for g in geos); ex1 = max(g["box"][2] for g in geos)
    ey0 = min(g["box"][1] for g in geos); ey1 = max(g["box"][3] for g in geos)
    tiles = []
    for name in ["src"] + list(outs):
        im = S if name == "src" else outs[name]
        t = cv2.resize(np.clip(im[ey0:ey1, ex0:ex1], 0, 255).astype(np.uint8), None, fx=1.5, fy=1.5, interpolation=cv2.INTER_AREA)
        cv2.putText(t, name, (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1); tiles.append(t)
    while len(tiles) % 2: tiles.append(np.full_like(tiles[0], 255))
    grid = np.vstack([np.hstack(tiles[i:i + 2]) for i in range(0, len(tiles), 2)])
    cv2.imwrite(DEBUG, grid)
    vis = S.copy(); vis[(hair > 0.25) & ~inside] = (0, 0, 255); vis[(hair > 0.25) & inside] = (255, 0, 0)
    for pts, col in ((L.get("face_poly"), (0, 160, 0)), (L.get("body_poly"), (0, 200, 200))):
        if pts: cv2.polylines(vis, [np.array(pts, np.int32)], True, col, 2)
    cv2.imwrite(DEBUG.replace(".png", "_hair.png"), vis.astype(np.uint8))
    x0, y0, x1, y1 = L.get("mouth_box", [0, 0, N, N])
    cv2.imwrite(DEBUG.replace(".png", "_mouth.png"), cv2.resize(np.hstack([S[y0 - 10:y1 + 10, x0 - 10:x1 + 10], nm[y0 - 10:y1 + 10, x0 - 10:x1 + 10]]).astype(np.uint8), None, fx=3, fy=3))
    print("確認用:", DEBUG)
