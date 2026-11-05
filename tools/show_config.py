"""設定（config.json）を元の絵に重ねて描く。座標が合っているかを目で確かめる。
python tools/show_config.py <作業フォルダ（例 gen）> [出力.png]
  出力（既定 out/<フォルダ名>_config.png）：左に全体、右に顔の拡大
  色：目＝緑（目じり・目がしらは点）、眉＝水色、口＝赤、髪にしない所＝灰、顔の多角形＝黄、服の多角形＝橙、
      耳と鼻＝桃の点、顔の楕円＝白、髪の楕円＝紫、揺らす髪の線＝青（太さ＝影響する幅）、首の高さ＝赤の横線、frame＝緑の枠

Draw the config over the source picture to check the coordinates.
"""
import json, sys
from pathlib import Path
import numpy as np, cv2

G = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("gen")
out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("out") / f"{G.name}_config.png"
c = json.load(open(G / "config.json", encoding="utf-8")); L = c.get("local", {}); hd = c.get("head", {})
im = cv2.imread(str(G / "src.png")); N = c.get("size", im.shape[0])
if im.shape[0] != N: im = cv2.resize(im, (N, N), interpolation=cv2.INTER_AREA)
v = (im.astype(np.float32) * 0.55 + 255 * 0.45).astype(np.uint8)                 # 薄くして線を見やすく
t = max(1, N // 600)
P = lambda q: (int(round(q[0])), int(round(q[1])))
def box(b, col): cv2.rectangle(v, P(b[:2]), P(b[2:]), col, t)
def poly(pts, col): cv2.polylines(v, [np.array(pts, np.int32)], True, col, t)
def dot(q, col, r=None): cv2.circle(v, P(q), r or 3 * t, col, -1)
for st in c.get("strands", []):
    pts = np.array(st["pts"], np.int32)
    cv2.polylines(v, [pts], False, (230, 170, 120), max(1, int(st["sig"] * 0.6)))
    cv2.polylines(v, [pts], False, (200, 80, 0), t); dot(st["pts"][0], (200, 80, 0), 4 * t)
if "face" in hd: cv2.ellipse(v, P(hd["face"][:2]), P(hd["face"][2:]), 0, 0, 360, (255, 255, 255), t)
if "hair" in hd: cv2.ellipse(v, P(hd["hair"][:2]), P(hd["hair"][2:]), 0, 0, 360, (200, 60, 160), t)
if L.get("face_poly"): poly(L["face_poly"], (0, 200, 230))
if L.get("body_poly"): poly(L["body_poly"], (0, 140, 255))
for b in L.get("keep_boxes", []): box(b, (140, 140, 140))
for b in L.get("brows", []): box(b, (230, 200, 0))
if L.get("mouth_box"): box(L["mouth_box"], (0, 0, 230))
for e in L.get("eyes", []):
    box(e["box"], (0, 170, 0)); dot(e["outer"], (0, 120, 0)); dot(e["inner"], (0, 220, 0))
for q in L.get("ears", []): dot(q, (180, 80, 255), 5 * t)
if "nose" in hd: dot(hd["nose"][:2], (180, 80, 255), 4 * t)
if "neck_y" in c: cv2.line(v, (0, c["neck_y"]), (N - 1, c["neck_y"]), (0, 0, 220), t)
if "pivot" in c: dot(c["pivot"], (0, 0, 220), 5 * t)
if L.get("hair_ymax"): cv2.line(v, (0, L["hair_ymax"]), (N - 1, L["hair_ymax"]), (0, 140, 255), t)
if c.get("frame"): f = c["frame"]; cv2.rectangle(v, (f[0], f[1]), (f[0] + f[2] - 1, f[1] + f[3] - 1), (0, 200, 0), 2 * t)
# 右：顔の拡大
fx, fy, frx, fry = hd.get("face", [N // 2, N // 2, N // 4, N // 4])
x0, y0 = int(max(0, fx - frx * 1.5)), int(max(0, fy - fry * 1.3)); x1, y1 = int(min(N, fx + frx * 1.5)), int(min(N, fy + fry * 1.3))
zoom = cv2.resize(v[y0:y1, x0:x1], (900, int(900 * (y1 - y0) / max(1, x1 - x0))), interpolation=cv2.INTER_CUBIC)
whole = cv2.resize(v, (900, 900), interpolation=cv2.INTER_AREA)
hgt = max(whole.shape[0], zoom.shape[0])
pad = lambda a: cv2.copyMakeBorder(a, 0, hgt - a.shape[0], 0, 0, cv2.BORDER_CONSTANT, value=(255, 255, 255))
out.parent.mkdir(parents=True, exist_ok=True)
cv2.imwrite(str(out), np.hstack([pad(whole), pad(zoom)]))
print("wrote", out)
