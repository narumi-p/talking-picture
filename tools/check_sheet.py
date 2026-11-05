"""確認シート：表情・まばたき・口・顔の向き・傾き・視線・眉を 1 枚に並べて描く（顔のまわりを拡大）。
動画を作る前・人に渡す前に、これで目と口と首が崩れていないかを見る。止まった絵と元の絵の差も出す。

python tools/check_sheet.py [--assets assets] [--out out/check_sheet.png] [--cell 300]

Render a sheet of expressions, blinks, mouth shapes, head turns, tilts, gaze and brows around the face,
and report how far the still frame is from the source.
"""
import argparse, base64, json, os, sys
from pathlib import Path
import numpy as np, cv2
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
import serve

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--assets", default="assets"); ap.add_argument("--out", default="")
ap.add_argument("--cell", type=int, default=300); ap.add_argument("--player", default=str(ROOT / "player"))
A = ap.parse_args()
out = Path(A.out or f"out/check_{A.assets}.png")
cfg = json.load(open(Path(A.player) / A.assets / "config.json", encoding="utf-8"))
N = cfg["size"]; fr = cfg.get("frame") or [0, 0, N, N]
fx, fy, frx, fry = (cfg.get("head") or {}).get("face", [N / 2, N / 2, N / 4, N / 4])
# 顔のまわり（書き出しの画素。frame の左上を原点に）
x0, y0 = int(fx - frx * 1.55 - fr[0]), int(fy - fry * 1.25 - fr[1]); x1, y1 = int(fx + frx * 1.55 - fr[0]), int(fy + fry * 1.6 - fr[1])
x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(fr[2], x1), min(fr[3], y1)
V = lambda i: [1 if k == i else 0 for k in range(5)]
S = [  # (ラベル, TP.params に入れる値)
    ("止まった絵", {}), ("半目", {"eyeOpen": 0.5}), ("閉じた目", {"eyeOpen": 0}), ("笑顔", {"expr": "smile", "exprK": 1}),
    ("ジト目", {"expr": "jito", "exprK": 1}), ("あ", {"mouthOpen": 0.75, "shape": V(0)}), ("い", {"mouthOpen": 0.5, "shape": V(1)}),
    ("う", {"mouthOpen": 0.5, "shape": V(2)}), ("え", {"mouthOpen": 0.6, "shape": V(3)}), ("お", {"mouthOpen": 0.6, "shape": V(4)}),
    ("角度X -30", {"yaw": -1.5}), ("角度X +30", {"yaw": 1.5}), ("角度Y 上", {"pitch": -1.5}), ("角度Y 下", {"pitch": 1.5}),
    ("角度Z +30", {"roll": -1.5}), ("角度Z -30", {"roll": 1.5}), ("目玉 左", {"gazeX": -1}), ("目玉 右", {"gazeX": 1}),
    ("眉 上", {"brow": 1}), ("ななめ＋笑顔", {"yaw": 1.0, "pitch": 0.5, "roll": 0.6, "expr": "smile", "exprK": 1, "mouthOpen": 0.3}),
]
srv, base = serve.start(A.player)
ims, still = [], None
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1280, "height": 1280})
    pg.goto(f"{base}/index.html?export=1&assets={A.assets}"); pg.wait_for_function("window.ready === true", timeout=180000)
    js = """(s) => { const T = window.TP; T.manual = true; Object.keys(T.auto).forEach((k) => T.auto[k] = false);
      Object.assign(T.params, {yaw: 0, pitch: 0, roll: 0, body: 0, eyeOpen: 1, expr: '', exprK: 0, gazeX: 0, gazeY: 0, brow: 0, mouthOpen: 0, shape: [1,0,0,0,0], hair: 1}, s);
      window.render(1.0); return document.getElementById('gl').toDataURL('image/png'); }"""
    for lab, st in S:
        d = pg.evaluate(js, st)
        im = cv2.imdecode(np.frombuffer(base64.b64decode(d.split(",", 1)[1]), np.uint8), cv2.IMREAD_COLOR)
        if still is None: still = im.copy()
        c = im[y0:y1, x0:x1]; c = cv2.resize(c, (A.cell, int(A.cell * c.shape[0] / c.shape[1])), interpolation=cv2.INTER_AREA)
        cv2.putText(c, lab.encode("ascii", "ignore").decode() or "", (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1)
        ims.append((lab, c))
    b.close()
srv.shutdown()
# 日本語のラベルは PIL があれば描く（無ければ英数字だけ）
try:
    from PIL import Image, ImageDraw, ImageFont
    font = None
    for f in ["/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", "C:/Windows/Fonts/meiryo.ttc", "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"]:
        if Path(f).exists(): font = ImageFont.truetype(f, 16); break
    if font:
        out_ims = []
        for lab, c in ims:
            pil = Image.fromarray(cv2.cvtColor(c, cv2.COLOR_BGR2RGB)); dr = ImageDraw.Draw(pil)
            dr.rectangle([0, 0, A.cell, 20], fill=(255, 255, 255)); dr.text((4, 1), lab, font=font, fill=(200, 0, 0))
            out_ims.append(cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR))
        ims = [(l, c) for (l, _), c in zip(ims, out_ims)]
except ImportError:
    pass
cols = 5
rows = [np.hstack([c for _, c in ims[i:i + cols]] + [np.full_like(ims[0][1], 255)] * (cols - len(ims[i:i + cols]))) for i in range(0, len(ims), cols)]
out.parent.mkdir(parents=True, exist_ok=True)
cv2.imwrite(str(out), np.vstack(rows))
# 止まった絵と元の絵の差
orig = cv2.imread(str(Path(A.player) / A.assets / "original.png"))
if orig is not None and still is not None:
    o = orig[fr[1]:fr[1] + fr[3], fr[0]:fr[0] + fr[2]]
    if o.shape == still.shape:
        e = np.abs(o.astype(np.int16) - still.astype(np.int16)).max(2)
        print(f"止まった絵と元の絵の差：平均 {e.mean():.3f}、最大 {int(e.max())}（2 以下なら同じ）")
print("wrote", out)
