"""描き分けの検品：それぞれの絵が「指定した所だけ」変わっているか（局所編集になっているか）を数える。
python tools/check_variants.py [--gen gen]
  OK  … 変わった所が一か所にまとまっていて、その外は元と同じ
  NG  … 外側まで変わっている（絵全体を描き直している）→ build_layers の差分がくずれる。作り直す
"""
import sys
from pathlib import Path
import numpy as np, cv2

ROOT = Path(__file__).resolve().parent.parent
a = sys.argv[1:]
G = Path(a[a.index("--gen") + 1]) if "--gen" in a else ROOT / "gen"
N = 1024


def rd(n):
    im = cv2.imread(str(G / n))
    if im is None: return None
    if im.shape[:2] != (N, N):
        print(f"  ※ {n} は {im.shape[1]}x{im.shape[0]}（{N}x{N} に縮めて使う。描き分けは同じ大きさで出すのが安全）")
        im = cv2.resize(im, (N, N), interpolation=cv2.INTER_AREA)
    return im.astype(np.float32)


src = rd("src.png"); bald = rd("bald_open.png")
if src is None: sys.exit(f"src.png がありません（{G}）")
bx0, by0, bx1, by1 = 300, 930, 700, 1024                                  # 髪の無い所（config.json の body_check と同じ）
cfg = G / "config.json"
if cfg.exists():
    import json
    bx0, by0, bx1, by1 = json.load(open(cfg, encoding="utf-8")).get("body_check", [bx0, by0, bx1, by1])
PAIRS = [("bald_open.png", "src.png", "髪 → 髪なし（髪の所だけ変わる）")]
if bald is not None:
    for f in sorted(G.glob("eye_*.png")): PAIRS.append((f.name, "bald_open.png", "目だけ"))
    PAIRS.append(("no_mouth.png", "bald_open.png", "口だけ"))
ok_all = True
for name, ref, what in PAIRS:
    im = rd(name)
    if im is None:
        print(f"-- {name:16s} なし"); continue
    base = rd(ref)
    d = np.abs(im - base).max(2)
    m = (d > 12).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        print(f"NG {name:16s} 何も変わっていない（{what}）"); ok_all = False; continue
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    box = np.zeros((N, N), bool); box[max(0, y0 - 8):y1 + 9, max(0, x0 - 8):x1 + 9] = True
    inside = int(m[box].sum()); outside = int((d > 12)[~box].sum())
    frac = (d > 12)[~box].mean() * 100 if (~box).any() else 0.0
    if name == "bald_open.png":                                       # 髪は広いので範囲の大きさは問わない。位置ずれだけ見る
        shift = float(d[by0:by1, bx0:bx1].mean())
        verdict = "OK" if shift < 2.0 else "NG"
        note = f"髪の無い所（{bx0},{by0}-{bx1},{by1}）の平均差 {shift:.2f}（2 未満なら位置が合っている）"
    else:
        verdict = "OK" if frac < 0.1 else "NG"
        note = f"その外の差>12: {outside} px ({frac:.2f}%)"
    if verdict == "NG": ok_all = False
    print(f"{verdict} {name:16s} 変わった所 x{x0}-{x1} y{y0}-{y1} ({inside} px)  {note}  …{what}")
ho = rd("hair_only.png")
if ho is not None:
    g = ho[..., 1] - np.maximum(ho[..., 0], ho[..., 2])
    print(f"-- hair_only.png  緑の割合 {(g > 60).mean() * 100:.0f}%（髪以外が緑になっていること。髪の形は src と同じ位置か目で確認）")
print("結果:", "すべて OK" if ok_all else "NG あり → NG の絵は「This must be a LOCAL edit… bit-identical」を足して作り直す")
