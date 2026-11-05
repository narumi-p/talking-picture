"""クリックした点（points.json）と元の絵から、作業フォルダ（src.png と config.json）を作る。
新しい絵は、player/setup.html で点を置いて points.json を書き出し、これを動かすだけで設定がそろう。

python tools/prepare.py <元の絵> <points.json> <作業フォルダ（例 gen_b）> [--full]
  --full  全身の絵（体の角度を足す。points.json の "full": true でも同じ）

points.json（座標は元の絵の画素。向かって左＝L、向かって右＝R）:
  eyeL_outer, eyeL_inner, eyeR_inner, eyeR_outer   目じり・目がしら（上下のまぶたが合わさる所）
  browL_out, browL_in, browR_in, browR_out          眉の両端
  nose, mouth_l, mouth_r, chin                      鼻先・口角・あご先
  earL, earR                                        耳のまん中（髪で隠れていれば顔の横の端）
  forehead                                          おでこの髪の生え際（まん中）
  collar_l, collar_r                                襟の上の両端（首の付け根の左右）
  shoulder_l, shoulder_r                            肩のいちばん上（服の輪郭）
  hair_top, hair_l, hair_r, hair_bottom             髪のいちばん上・左・右・下（毛先）

正方形でない絵は、背景の色をのばして正方形にする（設定の frame で元の範囲のまま書き出す）。
細かい値（目の範囲・顔の楕円・髪の線・首・服の範囲・揺れの大きさ）は、なるみの絵で手で詰めた値の比率から計算する。
できたら: python tools/show_config.py <作業フォルダ> で絵に重ねて確かめ、make_all.py で部品→層→確認シート。

Build a work folder (square src.png + config.json) from the source picture and the clicked points (player/setup.html).
"""
import json, sys
from pathlib import Path
import numpy as np, cv2

# なるみ（バストアップ）で手で詰めた髪の線を、髪の楕円 (cx, cy, rx, ry) で割った形（短めの髪の既定の揺れ方）
HAIR_E = (627, 560, 560, 600)
STRANDS = [
    ("L_fly", [[269, 196], [159, 343], [92, 490], [61, 588]], 19.6, 3.0),
    ("L_outer", [[318, 294], [196, 490], [141, 686], [147, 845], [184, 931]], 51.4, 1.8),
    ("L_mid", [[367, 392], [288, 588], [257, 772], [288, 931], [325, 1016]], 46.5, 1.5),
    ("L_tip", [[374, 735], [380, 857], [410, 967], [435, 1035]], 31.8, 1.6),
    ("R_tip", [[882, 735], [876, 857], [845, 967], [820, 1035]], 31.8, 1.6),
    ("R_mid", [[888, 392], [967, 588], [998, 772], [967, 931], [931, 1016]], 46.5, 1.5),
    ("R_outer", [[937, 294], [1059, 490], [1108, 686], [1096, 845], [1053, 943]], 51.4, 1.8),
    ("R_fly", [[980, 220], [1078, 392], [1127, 576], [1163, 747]], 19.6, 3.0),
    ("top", [[576, 49], [527, 22], [478, 10]], 14.7, 3.0),
]
# 顔・耳・首の多角形を、顔の楕円 (cx, cy, rx, ry) で割った形
FACE_E = (627, 650, 300, 330)
FACE_POLY = [[404, 404], [490, 333], [627, 316], [759, 333], [857, 404], [884, 551], [958, 576], [958, 765], [884, 790], [847, 863],
             [762, 921], [757, 970], [500, 970], [492, 921], [407, 851], [367, 790], [284, 765], [279, 576], [362, 551]]


def main():
    a = sys.argv[1:]
    if len(a) < 3: sys.exit(__doc__)
    src_path, pts_path, out = a[0], a[1], Path(a[2])
    P = json.load(open(pts_path, encoding="utf-8"))
    full = "--full" in a or bool(P.get("full"))
    im = cv2.imread(src_path)
    if im is None: sys.exit(f"絵を読めません: {src_path}")
    h, w = im.shape[:2]
    # 正方形にする（短い方の両側に、端の色をのばす）
    N = max(w, h); ox, oy = (N - w) // 2, (N - h) // 2
    sq = cv2.copyMakeBorder(im, oy, N - h - oy, ox, N - w - ox, cv2.BORDER_REPLICATE)
    out.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out / "src.png"), sq)
    p = {k: (np.array(v, np.float64) + [ox, oy]) for k, v in P.items() if isinstance(v, list) and len(v) == 2}
    need = ["eyeL_outer", "eyeL_inner", "eyeR_inner", "eyeR_outer", "nose", "mouth_l", "mouth_r", "chin", "earL", "earR", "forehead"]
    miss = [k for k in need if k not in p]
    if miss: sys.exit("足りない点: " + ", ".join(miss))
    I = lambda v: [int(round(x)) for x in v]

    # 顔の楕円：耳の間の幅、おでこ〜あごの高さ
    cx = (p["earL"][0] + p["earR"][0]) / 2
    rx = (p["earR"][0] - p["earL"][0]) / 2 * 1.03
    cy = (p["forehead"][1] + p["chin"][1]) / 2 + 0.03 * (p["chin"][1] - p["forehead"][1])
    ry = (p["chin"][1] - p["forehead"][1]) / 2 * 1.05
    s = rx / FACE_E[2]                                                                # なるみの顔との大きさの比
    face_poly = [I([cx + (x - FACE_E[0]) / FACE_E[2] * rx, cy + (y - FACE_E[1]) / FACE_E[3] * ry]) for x, y in FACE_POLY]

    # 目：目じり・目がしらから、目の範囲と大きさの倍率
    eyes = []
    for o, i_, bs in (("eyeL_outer", "eyeL_inner", ("browL_out", "browL_in")), ("eyeR_outer", "eyeR_inner", ("browR_in", "browR_out"))):
        po, pi = p[o], p[i_]; ew = abs(po[0] - pi[0])
        x0, x1 = min(po[0], pi[0]) - 0.2 * ew, max(po[0], pi[0]) + 0.2 * ew
        y0, y1 = min(po[1], pi[1]) - 0.40 * ew, max(po[1], pi[1]) + 0.52 * ew
        if all(b in p for b in bs): y0 = max(y0, max(p[bs[0]][1], p[bs[1]][1]) + 0.2 * ew)   # 眉は目の範囲に入れない（まつ毛と見まちがえる）
        eyes.append({"box": I([x0, y0, x1, y1]), "outer": I(po), "inner": I(pi), "ramp": max(4, int(round(0.165 * ew)))})
    ew = np.mean([abs(p["eyeL_outer"][0] - p["eyeL_inner"][0]), abs(p["eyeR_outer"][0] - p["eyeR_inner"][0])])
    es = float(np.clip(ew / 164.0, 0.2, 1.5))

    # 眉
    brows = []
    for a_, b_ in (("browL_out", "browL_in"), ("browR_in", "browR_out")):
        if a_ in p and b_ in p:
            q0, q1 = p[a_], p[b_]; bw = abs(q1[0] - q0[0])
            brows.append(I([min(q0[0], q1[0]) - 0.03 * bw, min(q0[1], q1[1]) - 0.09 * bw - 4 * es, max(q0[0], q1[0]) + 0.03 * bw, max(q0[1], q1[1]) + 0.12 * bw + 4 * es]))

    # 口・鼻
    ml, mr = p["mouth_l"], p["mouth_r"]; mw = abs(mr[0] - ml[0]); my = (ml[1] + mr[1]) / 2
    mouth_box = I([min(ml[0], mr[0]) - 0.19 * mw, my - 0.18 * mw - 2, max(ml[0], mr[0]) + 0.21 * mw, my + 0.27 * mw + 2])
    mouth_region = I([mouth_box[0] - 0.05 * mw, mouth_box[1] - 0.1 * mw, mouth_box[2] + 0.05 * mw, mouth_box[3] + 0.1 * mw])
    nx, ny = p["nose"]; fw = 2 * rx
    nose_box = I([nx - 0.062 * fw, ny - 0.05 * fw, nx + 0.062 * fw, ny + 0.072 * fw])
    keep = [I([b[0] - 2, b[1] - 2, b[2] + 2, b[3]]) for b in brows] + [mouth_region, nose_box]

    # 首・服：襟の上の両端と肩
    if "collar_l" in p and "collar_r" in p:
        cl, cr = p["collar_l"], p["collar_r"]; col_y = (cl[1] + cr[1]) / 2
    else:
        col_y = p["chin"][1] + 0.12 * (2 * ry); cl, cr = np.array([cx - 0.65 * rx, col_y]), np.array([cx + 0.65 * rx, col_y])
    if "shoulder_l" in p and "shoulder_r" in p:
        sl, sr = p["shoulder_l"], p["shoulder_r"]
    else:
        sl, sr = np.array([cx - 2.6 * rx, col_y + 0.4 * rx]), np.array([cx + 2.6 * rx, col_y + 0.4 * rx])
    shy = max(sl[1], sr[1]); d = 0.01 * N
    body_poly = [I(v) for v in ([0, shy + 2.6 * d], sl, [cl[0] - d, shy - d], cl, cr, [cr[0] + d, shy - d], sr, [N, shy + 2.6 * d], [N, N], [0, N])]
    neck_y = int(round(col_y + 0.083 * (2 * ry)))

    # 髪の楕円と揺れる線（なるみの短めの髪の揺れ方を、この絵の髪の大きさに合わせる）
    ht = p.get("hair_top", np.array([cx, p["forehead"][1] - 0.45 * ry]))
    hb = p.get("hair_bottom", np.array([cx, p["chin"][1] + 0.3 * ry]))
    hl = p.get("hair_l", np.array([cx - 1.8 * rx, cy])); hr = p.get("hair_r", np.array([cx + 1.8 * rx, cy]))
    hcx = cx; hrx = max(cx - hl[0], hr[0] - cx) * 1.02
    hcy = (ht[1] + hb[1]) / 2 + 0.02 * (hb[1] - ht[1]); hry = (hb[1] - ht[1]) / 2 * 1.18
    strands = [{"name": n, "pts": [I([hcx + (x - HAIR_E[0]) / HAIR_E[2] * hrx, hcy + (y - HAIR_E[1]) / HAIR_E[3] * hry]) for x, y in pts],
                "sig": round(sig * hrx / HAIR_E[2], 1), "amp": amp} for n, pts, sig, amp in STRANDS]

    # 背景の色（四隅）
    cs = np.concatenate([sq[:20, :20].reshape(-1, 3), sq[:20, -20:].reshape(-1, 3)])
    bgc = [int(v) for v in np.median(cs, 0)[::-1]]

    cfg = {
        "_comment": "tools/prepare.py が points.json から作った設定。座標は正方形にした src.png の画素。直すときは player/setup.html で点を直して作り直すか、ここを直接。",
        "size": N, "background_rgb": bgc, "body_check": [0, N - 60, int(N * 0.25), N],
        "mouth_region": mouth_region, "pivot": [int(round(cx)), neck_y], "neck_y": neck_y,
        "eye_keys": ["eye_12", "eye_25", "eye_37", "eye_half", "eye_62", "eye_75", "eye_87", "eye_closed"],
        "expressions": ["eye_jito", "eye_smile"],
        "strands": strands,
        "head": {"face": I([cx, cy, rx, ry]), "hair": I([hcx, hcy, hrx, hry]), "nose": I([nx, ny, 0.14 * rx]),
                 "depth": [0.55, 0.45, 0.12], "yaw_px": round(0.127 * rx, 1), "pitch_px": round(0.073 * rx, 1), "roll_deg": 7.0,
                 "hair_front": 0.3, "back": 0.0, "brow_px": round(0.047 * rx, 1), "breath_px": round(max(1.0, 0.0067 * rx), 1),
                 "gaze_px": round(0.025 * rx, 1), "soft": round(s, 3)},
        "local": {"eye_scale": round(es, 3), "eyes": eyes, "mouth_box": mouth_box, "face_poly": face_poly, "body_poly": body_poly,
                  "hair_ymax": int(round(shy + 1.4 * d)), "keep_boxes": keep, "brows": brows, "ears": [I(p["earL"]), I(p["earR"])]},
    }
    if ox or oy: cfg["frame"] = [ox, oy, w, h]
    if full: cfg["head"]["body"] = {"pivot": [int(round(cx)), int(round(oy + h * 0.977))], "deg": 0.5}
    json.dump(cfg, open(out / "config.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{out}/src.png（{N}×{N}、元 {w}×{h}）と config.json を作りました。目の幅 {ew:.0f}px → eye_scale {es:.2f}、顔の幅 {2 * rx:.0f}px")
    print(f"確かめる: python tools/show_config.py {out}")


if __name__ == "__main__":
    main()
