"""描き分けた絵 → 動かすための層（レイヤー）を作る。
  元の絵 − 髪なし ＝ 髪の層（元の絵の画素のまま。下地に重ねると元の絵に戻るように色を逆算する）
  下地 ＝ 髪が揺れたときに見える所（髪なしの肌 ＋ 奥の髪 ＋ 背景）
  目 ＝ 描き分けたコマ（開 → 少し閉じ → … → 閉じ）＋ 表情（ジト目・笑顔）
  口 ＝ 口なしの肌（コードで口を描く台）＋ 元の口の位置と曲がり
  髪の揺れ ＝ 根元→毛先の線（strands）ごとの重みの画像

python tools/build_layers.py [--gen gen] [--out player/assets] [--config gen/config.json] [--sub 0]
  --gen    描き分けの PNG が入ったフォルダ（src.png, bald_open.png, hair_only.png, no_mouth.png, eye_*.png。任意で hair_alpha.png）
  --out    層の書き出し先（player/index.html が読む assets フォルダ）
  --config 絵ごとの設定（髪の線など。無ければ 1024px の胸から上の絵向けの既定値）
  --sub    キーとキーの間に光学フローで作る中間コマの数。既定 0（中間コマは二重・裂けが出やすいので、描いたコマの切り替えだけを勧める）

Build the animation layers from the AI-edited variants (see prompts/). With --sub 0 (default) no torch is needed.
"""
import json, sys, shutil
from pathlib import Path
import numpy as np, cv2
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
_arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
G = Path(_arg("--gen", str(ROOT / "gen")))
A = Path(_arg("--out", str(ROOT / "player" / "assets"))); A.mkdir(parents=True, exist_ok=True)
CFG_PATH = Path(_arg("--config", str(G / "config.json")))
SUB = int(_arg("--sub", "0"))
ERR_OK = float(_arg("--err", "22"))

# ── 絵ごとの設定（config.json で上書きできる）。既定値は 1024×1024・胸から上・背景が白の絵向け ──
DEFAULTS = {
    "size": 1024,
    "background_rgb": [252, 251, 251],          # 背景の色（RGB）
    "body_check": [300, 930, 700, 1024],        # 位置ずれの確認に使う、髪が無い所 (x0, y0, x1, y1)
    "mouth_region": [380, 600, 650, 820],       # 口を探す範囲 (x0, y0, x1, y1)
    "pivot": [512, 860],                        # 頭を少し傾けるときの軸（首の付け根）
    "neck_y": 860,                              # ここより下は傾けない
    "eye_keys": ["eye_12", "eye_25", "eye_37", "eye_half", "eye_62", "eye_75", "eye_87", "eye_closed"],   # 開→閉の順の候補（無いものは飛ばす）
    "expressions": ["eye_jito", "eye_smile"],   # 表情の目（名前の eye_ を取ったものがタイムラインの expr 名）
    # 揺らす髪：根元→毛先の点列（画素）、sig＝線のまわりの幅、amp＝揺れの大きさ（度）。最大 9 本
    "strands": [
        {"name": "L_loose", "pts": [[120, 330], [75, 420], [45, 500], [40, 550]], "sig": 16, "amp": 4.0},
        {"name": "L_outer", "pts": [[150, 300], [115, 450], [100, 600], [115, 720], [150, 820]], "sig": 42, "amp": 2.2},
        {"name": "L_mid", "pts": [[220, 330], [190, 480], [180, 640], [200, 760], [210, 860]], "sig": 40, "amp": 1.7},
        {"name": "L_inner", "pts": [[250, 560], [255, 680], [280, 790], [320, 880]], "sig": 30, "amp": 1.4},
        {"name": "R_inner", "pts": [[775, 560], [775, 680], [760, 790], [720, 880]], "sig": 30, "amp": 1.4},
        {"name": "R_mid", "pts": [[810, 330], [845, 480], [850, 640], [830, 760], [820, 860]], "sig": 40, "amp": 1.7},
        {"name": "R_outer", "pts": [[870, 300], [905, 450], [915, 600], [900, 720], [870, 820]], "sig": 42, "amp": 2.2},
        {"name": "R_loose", "pts": [[890, 470], [925, 560], [955, 630], [975, 665]], "sig": 16, "amp": 4.0},
        {"name": "top", "pts": [[470, 60], [420, 32], [370, 22]], "sig": 12, "amp": 3.0},
    ],
}
C = dict(DEFAULTS)
if CFG_PATH.exists():
    C.update(json.load(open(CFG_PATH, encoding="utf-8")))
    print("設定:", CFG_PATH)
N = int(C["size"])
STRANDS = C["strands"][:9]
if len(STRANDS) < 9:                                                              # 9 本未満なら、動かないダミーで埋める
    STRANDS = STRANDS + [{"name": f"none{i}", "pts": [[-100, -100], [-101, -101]], "sig": 1, "amp": 0.0} for i in range(9 - len(STRANDS))]
print("材料:", G, " 書き出し:", A, " 中間コマ:", SUB)


def rd(n):
    im = cv2.imread(str(G / n))
    if im is None: return None
    if im.shape[:2] != (N, N): im = cv2.resize(im, (N, N), interpolation=cv2.INTER_AREA)
    return im.astype(np.float32)


src = rd("src.png"); bald = rd("bald_open.png"); ho = rd("hair_only.png")
for nm, im in (("src.png", src), ("bald_open.png", bald), ("hair_only.png", ho)):
    if im is None: sys.exit(f"{nm} がありません（--gen {G}）")
bx0, by0, bx1, by1 = C["body_check"]
body = np.zeros((N, N), bool); body[by0:by1, bx0:bx1] = True
print("位置ずれ確認（髪の無い所の平均差。大きいと描き分けが局所編集になっていない）: bald", round(float(np.abs(src - bald)[body].mean()), 2))

# ── 1) 髪だけ（緑地）→ 奥の髪 ──
b_, g_, r_ = ho[..., 0], ho[..., 1], ho[..., 2]
green = g_ - np.maximum(r_, b_)
a_ho = 1.0 - np.clip((green - 40) / 70.0, 0, 1)                                   # 緑の強さで透明に
a_ho = ndi.median_filter(a_ho, 3)
ho_rgb = ho.copy(); ho_rgb[..., 1] = np.minimum(g_, np.maximum(r_, b_) * 1.05 + 6)  # 緑かぶり除去

# ── 2) 髪なしの人物の形（肌・目鼻・首・肩）。背景の薄い線は消す ──
bg = np.array(C["background_rgb"][::-1], np.float32)                               # BGR
nonwhite = (np.abs(bald - bg).max(2) > 14).astype(np.uint8)
nonwhite = cv2.morphologyEx(nonwhite, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
lab, n = ndi.label(nonwhite); sizes = ndi.sum(nonwhite, lab, range(1, n + 1))
person = ndi.binary_fill_holes(lab == (1 + int(np.argmax(sizes))))
person = cv2.GaussianBlur(person.astype(np.float32), (0, 0), 1.0)

# ── 3) 髪（前の層）の濃さ ＝ 元の絵と髪なしの差（髪だけの範囲の中） ──
diff = np.abs(src - bald).max(2)
hair_zone = cv2.dilate((a_ho > 0.2).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
a_hair = np.clip((diff - 9) / 48.0, 0, 1) * hair_zone                            # 細い毛のふちまで髪に入れる
_ha = cv2.imread(str(G / "hair_alpha.png"), cv2.IMREAD_GRAYSCALE)                # 髪の濃さが分かっているとき（make_variants_local.py が書く）はそれを使う
if _ha is not None:
    if _ha.shape != (N, N): _ha = cv2.resize(_ha, (N, N), interpolation=cv2.INTER_AREA)
    a_hair = _ha.astype(np.float32) / 255.0
    print("髪の濃さ: hair_alpha.png を使う")
lab, n = ndi.label(a_hair > 0.3); sizes = ndi.sum(a_hair > 0.3, lab, range(1, n + 1))
a_hair[np.isin(lab, 1 + np.nonzero(np.asarray(sizes) < 40)[0])] = 0

# ── 4) 下地：髪の範囲だけ作り直す（外周の帯は背景、内側は奥の髪、人物の中は髪なしの肌） ──
hz = cv2.dilate((a_hair > 0.01).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))) > 0   # 毛のふちの外まで下地を作り直す（動いた跡に線が残らない）
if _ha is not None: hz = a_hair > 0.004                                             # 髪の濃さが正確に分かっているときは、髪の所だけ作り直す
hair_sil = (a_ho > 0.5).astype(np.uint8)
inner_hair = cv2.erode(hair_sil, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))).astype(np.float32)
inner_hair = cv2.GaussianBlur(inner_hair, (0, 0), 3.0) * a_ho
under = bg[None, None, :] * (1 - inner_hair[..., None]) + ho_rgb * inner_hair[..., None]
# 髪なしの肌に残った髪の切れ端（暗い細い線）を消す：髪に隠れていた所だけ
skin = bald.copy()
luma = skin @ np.array([0.114, 0.587, 0.299], np.float32)
loc = cv2.GaussianBlur(luma, (0, 0), 6)
dark = ((loc - luma) > 18) & (a_hair > 0.3) & (person > 0.5)
dark = cv2.dilate(dark.astype(np.uint8), np.ones((3, 3), np.uint8))
skin = cv2.inpaint(np.clip(skin, 0, 255).astype(np.uint8), dark, 5, cv2.INPAINT_TELEA).astype(np.float32)
under = under * (1 - person[..., None]) + skin * person[..., None]
base = src * (1 - hz[..., None]) + under * hz[..., None]

# ── 5) 髪の色を「下地の上に重ねると元の絵になる」ように戻す（止まっているとき元の絵と同じ） ──
if _ha is not None:                                                               # 下地の上で元の色に戻せるだけの濃さは必ず持たせる
    need = np.where(src < base, 1 - src / np.maximum(base, 1), (src - base) / np.maximum(255 - base, 1)).max(2)
    a_hair = np.where(hz, np.maximum(a_hair, np.clip(need, 0, 1)), a_hair)
a = a_hair[..., None]
H = np.where(a > 0.04, (src - (1 - a) * base) / np.maximum(a, 0.04), src)
H = np.clip(H, 0, 255)
recon = H * a + base * (1 - a)
print("止まっているときの再現誤差（元の絵との平均差）:", round(float(np.abs(recon - src).mean()), 3))
cv2.imwrite(str(A / "base.png"), base.astype(np.uint8))
cv2.imwrite(str(A / "hair.png"), np.dstack([H, a_hair * 255]).astype(np.uint8))
cv2.imwrite(str(A / "original.png"), src.astype(np.uint8))
# 下地の不透明さ（透明な背景で書き出すとき用）：人物（髪なしの形）と奥の髪は 1、背景は 0
mask = np.clip(np.maximum(person, inner_hair), 0, 1)
cv2.imwrite(str(A / "mask.png"), (np.dstack([mask, mask, mask]) * 255).astype(np.uint8))

# ── 6) 目：コマ ──
keys = ["bald_open.png"] + [k + ".png" for k in C["eye_keys"]]
extra = [k + ".png" for k in C["expressions"]]
have = [k for k in keys if (G / k).exists()]
ex_have = [k for k in extra if (G / k).exists()]
print("目のキー:", have, "表情:", ex_have)
K = [rd(k) for k in have]; E = [rd(k) for k in ex_have]
chg = np.zeros((N, N), bool)
for im in K[1:] + E: chg |= (np.abs(im - bald).max(2) > 20)
chg = cv2.morphologyEx(chg.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
ys, xs = np.nonzero(chg)
if len(ys) == 0:
    print("目のキーがまだない → 目は動かさない（仮）"); ex0, ex1, ey0, ey1 = int(N * 0.29), int(N * 0.71), int(N * 0.46), int(N * 0.59)
else:
    ex0, ex1 = max(0, xs.min() - 16), min(N, xs.max() + 17); ey0, ey1 = max(0, ys.min() - 16), min(N, ys.max() + 17)
print("目の範囲:", ex0, ey0, ex1, ey1)


def eye_frame(im):
    """キーの目の部分：変わった所はキーの画素、それ以外は下地（髪の切れ端を出さない）"""
    d = np.abs(im - bald).max(2)
    m = np.maximum(cv2.GaussianBlur((d > 6).astype(np.float32), (0, 0), 1.2), (d > 6).astype(np.float32))
    f = base * (1 - m[..., None]) + im * m[..., None]
    return f[ey0:ey1, ex0:ex1]


def raft(a, b):
    """光学フロー（--sub > 0 のときだけ使う。torch と torchvision が要る）"""
    import torch
    from torchvision.models.optical_flow import raft_large, Raft_Large_Weights
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    if not hasattr(raft, "m"): raft.m = raft_large(weights=Raft_Large_Weights.DEFAULT).to(dev).eval()
    def prep(im):
        t = torch.from_numpy(cv2.cvtColor(np.clip(im, 0, 255).astype(np.uint8), cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float()[None] / 255.0
        return (t * 2 - 1).to(dev)
    h, w = a.shape[:2]; H8, W8 = (h + 7) // 8 * 8, (w + 7) // 8 * 8
    pa = cv2.copyMakeBorder(a, 0, H8 - h, 0, W8 - w, cv2.BORDER_REPLICATE); pb = cv2.copyMakeBorder(b, 0, H8 - h, 0, W8 - w, cv2.BORDER_REPLICATE)
    with torch.no_grad():
        f = raft.m(prep(pa), prep(pb), num_flow_updates=24)[-1][0].permute(1, 2, 0).cpu().numpy()
    return f[:h, :w]


def morph(a, b, ts):
    """a→b の間のコマ：半透明で重ねると二重に見えるので、前半は a を b の方へ、後半は b を a の方へ曲げる（重ねない）"""
    fab = raft(a, b); fba = raft(b, a)
    h, w = a.shape[:2]; yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); out = []
    for t in ts:
        if t < 0.5:
            out.append(cv2.remap(a, xx + t * fba[..., 0], yy + t * fba[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE))
        else:
            out.append(cv2.remap(b, xx + (1 - t) * fab[..., 0], yy + (1 - t) * fab[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE))
    return out


def lid_y(f, cols):
    """上まぶた（まつげ）の高さ：瞳の上の列で、上から見て最初の暗い画素の y の中央値（大きいほど閉じている）"""
    g = f.astype(np.float32) @ np.array([0.114, 0.587, 0.299], np.float32)
    ys = []
    for x in cols:
        d = np.nonzero(g[8:, x] < 80)[0]
        if len(d): ys.append(d[0] + 8)
    return float(np.median(ys)) if ys else 1e9


KF = [eye_frame(k) for k in K]; EF = [eye_frame(e) for e in E]
# 瞳の列（開いた目と閉じた目で一番変わる列）
chg_cols = ndi.gaussian_filter1d((np.abs(KF[0] - KF[-1]).max(2) > 30).sum(0).astype(np.float32), 6)
wmid = KF[0].shape[1] // 2
cL = int(np.argmax(chg_cols[:wmid])); cR = wmid + int(np.argmax(chg_cols[wmid:]))
Wd = KF[0].shape[1]
cols = [x for x in list(range(cL - 14, cL + 15, 2)) + list(range(cR - 14, cR + 15, 2)) if 0 <= x < Wd]
print("瞳の列:", cL, cR)
ly = [lid_y(f, cols) for f in KF]
print("上まぶたの高さ（名前の順）:", {k: round(v, 1) for k, v in zip(have, ly)})
keep = [0]                                                                       # 開→閉の順で、まぶたが下がっていくものだけ使う
for i in range(1, len(KF)):
    if ly[i] > ly[keep[-1]] + 1.0 and (i == len(KF) - 1 or ly[i] < ly[-1] - 1.0): keep.append(i)
    else: print("  順番が合わないので除外:", have[i])
KF = [KF[i] for i in keep]
print("使うキー（開→閉）:", [have[i] for i in keep])


def warp_err(a, b):
    """a を b へ曲げきった時のずれ（変わる所だけの平均）。小さいほど途中のコマがきれい"""
    fba = raft(b, a); h, w = a.shape[:2]; yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    wa = cv2.remap(a, xx + fba[..., 0], yy + fba[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    chg = np.abs(a - b).max(2) > 20
    return float(np.abs(wa - b).max(2)[chg].mean()) if chg.any() else 0.0


frames = [KF[0]]
ts = [(j + 1) / (SUB + 1) for j in range(SUB)]
for i in range(len(KF) - 1):
    use = False
    if SUB > 0:
        e = warp_err(KF[i], KF[i + 1]); use = e < ERR_OK
        print(f"  キー{i}→{i + 1}: 曲げたときのずれ {e:.1f} → 間のコマ {'あり' if use else 'なし'}")
    frames += (morph(KF[i], KF[i + 1], ts) if use else []) + [KF[i + 1]]
blink_n = len(frames)
# まばたきのコマごとのまぶたの高さ（0＝開、1＝閉）。まばたきはこの高さに比例して進める
lids = [lid_y(f, cols) for f in frames]
blink_lid = [round((v - lids[0]) / max(lids[-1] - lids[0], 1e-6), 3) for v in lids]
print("まばたきのコマのまぶたの高さ:", blink_lid)
# 表情：途中の絵は作らない。まばたきのキーを表情のまぶたの高さまで通ってから表情に切り替える
expr = {}
for name, ef in zip(ex_have, EF):
    key = name.replace(".png", "").replace("eye_", "")
    lv = (lid_y(ef, cols) - lids[0]) / max(lids[-1] - lids[0], 1e-6)
    path = [i for i in range(blink_n) if blink_lid[i] < lv - 0.05]
    frames.append(ef); path.append(len(frames) - 1)
    expr[key] = path
    print(f"表情 {key}: まぶたの高さ {lv:.2f} → 通るコマ {path}")
cv2.imwrite(str(A / "eyes.png"), np.clip(np.vstack(frames), 0, 255).astype(np.uint8))
print(f"目のコマ: まばたき {blink_n} 枚（キー {len(KF)}・間 {SUB}）、表情 {expr}")

# ── 7) 口：口なしの肌と元の口の形 ──
mouth = None
nm = rd("no_mouth.png")
if nm is not None:
    mx_lo, my_lo, mx_hi, my_hi = C["mouth_region"]
    d = np.abs(nm - bald).max(2); m = cv2.morphologyEx((d > 14).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    lab, n = ndi.label(m); ids = []
    for i in range(n):                                                           # 口の範囲の中のかたまりを全部（線が細く途切れていても 1 つの口に）
        yy_, xx_ = np.nonzero(lab == i + 1)
        if len(yy_) < 30: continue
        if mx_lo < xx_.mean() < mx_hi and my_lo < yy_.mean() < my_hi: ids.append(i + 1)
    best = (0, -1) if ids else None
    if ids: lab = np.where(np.isin(lab, ids), -1, lab)
    if best:
        yy_, xx_ = np.nonzero(lab == best[1])
        mx0, mx1, my0, my1 = xx_.min(), xx_.max(), yy_.min(), yy_.max()
        luma_o = src @ np.array([0.114, 0.587, 0.299], np.float32)
        reg = lab == best[1]
        sel = reg & (luma_o < (np.median(luma_o[reg]) - 10))
        sy, sx = np.nonzero(sel); cxm = (mx0 + mx1) / 2
        if len(sx) > 10:
            Aa = np.stack([np.ones_like(sx, dtype=np.float64), (sx - cxm) ** 2], 1)
            c, k = np.linalg.lstsq(Aa, sy.astype(np.float64), rcond=None)[0]
        else:
            c, k = (my0 + my1) / 2, 0.0
        pad = 34
        rx0, rx1 = int(max(0, mx0 - pad)), int(min(N, mx1 + pad)); ry0, ry1 = int(max(0, my0 - pad)), int(min(N, my1 + pad + 20))
        mm = cv2.GaussianBlur(cv2.dilate((d > 6).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32), (0, 0), 2)
        skinm = base * (1 - mm[..., None]) + nm * mm[..., None]
        cv2.imwrite(str(A / "mouthskin.png"), skinm[ry0:ry1, rx0:rx1].astype(np.uint8))
        mouth = {"rect": [rx0, ry0, rx1, ry1], "cx": float(cxm), "cy": float(c), "k": float(k), "halfw": float((mx1 - mx0) / 2),
                 "line_rect": [int(mx0), int(my0), int(mx1), int(my1)]}
        print("口:", mouth)
    else:
        print("口が見つかりません（mouth_region を確認）→ 口は動かさない")
else:
    print("no_mouth.png が無い → 口は動かさない")

# ── 7.5) 眉（任意）：眉の濃さ brow_alpha.png と眉を消した肌 no_brow.png があれば、上げ下げできる層にする ──
brow = None
_ba = cv2.imread(str(G / "brow_alpha.png"), cv2.IMREAD_GRAYSCALE); _nb = rd("no_brow.png")
if _ba is not None and _nb is not None:
    if _ba.shape != (N, N): _ba = cv2.resize(_ba, (N, N), interpolation=cv2.INTER_AREA)
    ba = _ba.astype(np.float32) / 255.0
    ys_, xs_ = np.nonzero(ba > 0.02)
    if len(ys_):
        pad = int(N * 0.03)                                                        # 動かす幅のぶんの余白
        bx0, bx1 = max(0, xs_.min() - pad), min(N, xs_.max() + pad); by0, by1 = max(0, ys_.min() - pad), min(N, ys_.max() + pad)
        bskin = base.copy(); bm = cv2.GaussianBlur(cv2.dilate((ba > 0.02).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32), (0, 0), 1.5)[..., None]
        bskin = bskin * (1 - bm) + _nb * bm                                         # 眉の所だけ、眉を消した肌
        a_ = ba[..., None]
        need = np.where(src < bskin, 1 - src / np.maximum(bskin, 1), (src - bskin) / np.maximum(255 - bskin, 1)).max(2)[..., None]
        a_ = np.where(a_ > 0.004, np.maximum(a_, need), 0)                           # 肌の上に重ねて元の色に戻る濃さ
        Hb = np.clip(np.where(a_ > 0.02, (src - (1 - a_) * bskin) / np.maximum(a_, 0.02), src), 0, 255)
        cv2.imwrite(str(A / "brows.png"), np.dstack([Hb, a_ * 255])[by0:by1, bx0:bx1].astype(np.uint8))
        cv2.imwrite(str(A / "browskin.png"), bskin[by0:by1, bx0:bx1].astype(np.uint8))
        brow = {"rect": [int(bx0), int(by0), int(bx1), int(by1)]}
        print("眉:", brow)

# ── 7.6) 黒目（任意）：iris_alpha.png・no_iris.png・eye_open.png があれば、視線を動かせる層にする（目の範囲で切り出す） ──
iris = None
_ia = cv2.imread(str(G / "iris_alpha.png"), cv2.IMREAD_GRAYSCALE); _ni = rd("no_iris.png"); _eo = cv2.imread(str(G / "eye_open.png"), cv2.IMREAD_GRAYSCALE)
if _ia is not None and _ni is not None and _eo is not None:
    if _ia.shape != (N, N): _ia = cv2.resize(_ia, (N, N), interpolation=cv2.INTER_AREA); _eo = cv2.resize(_eo, (N, N), interpolation=cv2.INTER_AREA)
    ia = _ia.astype(np.float32)[..., None] / 255.0; eo = _eo.astype(np.float32)[..., None] / 255.0
    sc = base * (1 - eo) + _ni * eo                                                 # 目の開いた所だけ、黒目を消した白目
    need = np.where(src < sc, 1 - src / np.maximum(sc, 1), (src - sc) / np.maximum(255 - sc, 1)).max(2)[..., None]
    ia = np.where((ia > 0.004) & (eo > 0.02), np.maximum(ia, need), ia)
    Hi = np.clip(np.where(ia > 0.02, (src - (1 - ia) * sc) / np.maximum(ia, 0.02), src), 0, 255)
    Hi = np.where(eo > 0.5, Hi, src)                                                # まぶたの下は元の画素（ずらしたとき影のように見える）
    ex0_, ey0_, ex1_, ey1_ = ex0, ey0, ex1, ey1
    cv2.imwrite(str(A / "iris.png"), np.dstack([Hi, ia * 255])[ey0_:ey1_, ex0_:ex1_].astype(np.uint8))
    cv2.imwrite(str(A / "sclera.png"), sc[ey0_:ey1_, ex0_:ex1_].astype(np.uint8))
    cv2.imwrite(str(A / "eyeopen.png"), np.dstack([eo, eo, eo])[ey0_:ey1_, ex0_:ex1_].__mul__(255).astype(np.uint8))
    iris = {"rect": [int(ex0_), int(ey0_), int(ex1_), int(ey1_)]}
    print("黒目:", iris)

# ── 8) 揺らす髪（根元→毛先）と重み ──
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
W = np.zeros((9, N, N), np.float32); S = np.zeros((9, N, N), np.float32)
for i, st in enumerate(STRANDS):
    P = np.array(st["pts"], np.float32); seg = np.diff(P, axis=0); sl = np.linalg.norm(seg, axis=1); tot = sl.sum(); acc = np.concatenate([[0], np.cumsum(sl)])
    best_d = np.full((N, N), 1e9, np.float32); best_s = np.zeros((N, N), np.float32)
    for j in range(len(seg)):
        a0 = P[j]; v = seg[j]; L2 = float(v @ v)
        t = np.clip(((xx - a0[0]) * v[0] + (yy - a0[1]) * v[1]) / max(L2, 1e-6), 0, 1)
        dd = np.hypot(xx - (a0[0] + t * v[0]), yy - (a0[1] + t * v[1]))
        upd = dd < best_d; best_d[upd] = dd[upd]; best_s[upd] = ((acc[j] + t * sl[j]) / max(tot, 1e-6))[upd]
    W[i] = np.exp(-(best_d / st["sig"]) ** 2); S[i] = best_s
W = W / np.maximum(W.sum(0), 1.0)
W *= (cv2.dilate((a_hair > 0.05).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0)[None]
W = np.stack([cv2.GaussianBlur(w, (0, 0), 2.0) for w in W])
for k in range(3):   # 9 本を RGB×3 枚に詰める（重みと根元からの位置）
    cv2.imwrite(str(A / f"sw{k}.png"), np.clip(np.dstack([W[3 * k + 2], W[3 * k + 1], W[3 * k]]) * 255, 0, 255).astype(np.uint8))
    cv2.imwrite(str(A / f"ss{k}.png"), np.clip(np.dstack([S[3 * k + 2], S[3 * k + 1], S[3 * k]]) * 255, 0, 255).astype(np.uint8))

cfg = {"size": N, "eye": {"rect": [int(ex0), int(ey0), int(ex1), int(ey1)], "blink_frames": blink_n, "blink_lid": blink_lid, "keys": len(KF), "sub": SUB, "expr": expr, "count": len(frames)},
       "mouth": mouth, "brow": brow, "iris": iris, "strands": STRANDS, "pivot": C["pivot"], "neck_y": C["neck_y"], "head": C.get("head")}
json.dump(cfg, open(A / "config.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("書き出し:", A)
