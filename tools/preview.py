"""確認用：決まった時刻や状態のコマを描いて 1 枚に並べる（動画を書き出す前に目で見る）。
python tools/preview.py <out.png> --times 0,0.5,1.0 [--lips lips.json] [--timeline tl.json]
python tools/preview.py <out.png> --states '[{"label":"rest"},{"eye":[6,6,0],"label":"closed"},{"open":0.8,"shape":[1,0,0,0,0],"label":"a"}]'
  --crop x0,y0,x1,y1（描いた 1080px の画像での範囲）  --assets 層のフォルダ名  --cols 1 行の枚数
state: open＝口の開き 0〜1、shape＝[あ,い,う,え,お] の重み、eye＝[コマ a, コマ b, 混ぜる割合]（eyes.png の上から何番目か）、still＝髪を揺らさない
"""
import os, sys, base64, json, shutil
from pathlib import Path
import numpy as np, cv2
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
import serve

ROOT = Path(__file__).resolve().parent.parent
a = sys.argv[1:]; out = a[0]
opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
crop = [int(v) for v in opt("--crop").split(",")] if opt("--crop") else None
cols = int(opt("--cols", 4)); cell = int(opt("--cell", 360))
player = Path(opt("--player", str(ROOT / "player"))); assets = opt("--assets", "assets")
items = []
if opt("--times"): items += [("t", float(v)) for v in opt("--times").split(",")]
if opt("--states"): items += [("s", s) for s in json.loads(opt("--states"))]
if not items: sys.exit("--times か --states を指定してください")
q = f"export=1&w=1080&h=1080&assets={assets}"
if opt("--lips"): shutil.copy(opt("--lips"), player / assets / "lips.json"); q += f"&lips={assets}/lips.json"
if opt("--timeline"): shutil.copy(opt("--timeline"), player / assets / "timeline.json"); q += f"&timeline={assets}/timeline.json"
srv, base = serve.start(player)
ims = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1080, "height": 1080})
    pg.goto(f"{base}/index.html?{q}"); pg.wait_for_function("window.ready === true", timeout=120000)
    for kind, v in items:
        if kind == "t":
            d, st = pg.evaluate("(t) => { window.override = null; window.render(t); return [document.getElementById('gl').toDataURL('image/png'), window.state]; }", v)
            lab = f"t={v:.2f} open={st['open']:.2f} eye={st['eye'][0]}"
        else:
            st = dict(v); st.setdefault("still", True)
            d = pg.evaluate("(s) => { window.override = s; window.render(0); return document.getElementById('gl').toDataURL('image/png'); }", st)
            lab = v.get("label", json.dumps({k: x for k, x in v.items() if k != "still"}))[:44]
        im = cv2.imdecode(np.frombuffer(base64.b64decode(d.split(",", 1)[1]), np.uint8), cv2.IMREAD_COLOR)
        if crop: im = im[crop[1]:crop[3], crop[0]:crop[2]]
        im = cv2.resize(im, (cell, int(cell * im.shape[0] / im.shape[1])), interpolation=cv2.INTER_AREA)
        cv2.putText(im, lab, (3, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1); ims.append(im)
    b.close()
srv.shutdown()
rows = [np.hstack(ims[i:i + cols] + [np.full_like(ims[0], 255)] * (cols - len(ims[i:i + cols]))) for i in range(0, len(ims), cols)]
cv2.imwrite(out, np.vstack(rows)); print("wrote", out)
