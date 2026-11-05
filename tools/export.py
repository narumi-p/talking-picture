"""喋る絵の書き出し：ブラウザ（headless Chromium）で 1 コマずつ render(t) → PNG 連番 → 声と合わせて mp4。
python tools/export.py --audio <voice.wav> --lips <lips.json> --out out/demo [--fps 30 --w 1080 --h 1920 --timeline <tl.json> --assets assets --seed 7]
  --w/--h  書き出しの大きさ（既定は絵の大きさのまま＝止まった絵が元の絵と同じ画素）。縦長は絵を下に寄せる
  --assets  player/ の中の層のフォルダ名（複数のキャラを置くとき。既定 assets）
  --alpha   背景を透明にした連番 PNG も残す（動画編集ソフトに重ねるとき）
出力: <out>/frames/f_00000.png …, <out>/talk.mp4（決定論：同じ入力なら同じコマ）
"""
import argparse, base64, json, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
import serve

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--audio", required=True); ap.add_argument("--lips", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--fps", type=int, default=30); ap.add_argument("--w", type=int, default=0); ap.add_argument("--h", type=int, default=0)   # 0＝絵の大きさのまま
ap.add_argument("--timeline", default=""); ap.add_argument("--seed", default="7")
ap.add_argument("--player", default=str(ROOT / "player")); ap.add_argument("--assets", default="assets")
ap.add_argument("--tail", type=float, default=0.6, help="声の後ろに足す秒数")
ap.add_argument("--alpha", action="store_true", help="透明な背景で書き出す（mp4 は白地、PNG 連番は透明）")
A = ap.parse_args()
OUT = Path(A.out); fr = OUT / "frames"
if fr.exists(): shutil.rmtree(fr)
fr.mkdir(parents=True)
ASSETS = Path(A.player) / A.assets
def put(src, name):
    dst = ASSETS / name
    if not (dst.exists() and Path(src).resolve() == dst.resolve()): shutil.copy(src, dst)
put(A.lips, "lips.json")
tl = ""
if A.timeline: put(A.timeline, "timeline.json"); tl = f"&timeline={A.assets}/timeline.json"
dur = json.load(open(A.lips))["duration"] + A.tail
n = int(round(dur * A.fps))
srv, base = serve.start(A.player)
_c = json.load(open(ASSETS / "config.json")); _f = _c.get("frame") or [0, 0, _c["size"], _c["size"]]
A.w = A.w or _f[2]; A.h = A.h or _f[3]                                           # 既定は絵（frame）の大きさのまま
url = f"{base}/index.html?export=1&w={A.w}&h={A.h}&assets={A.assets}&lips={A.assets}/lips.json&seed={A.seed}{tl}" + ("&alpha=1" if A.alpha else "")
t0 = time.time()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": A.w, "height": A.h})
    pg.goto(url); pg.wait_for_function("window.ready === true", timeout=120000)
    for i in range(n):
        data = pg.evaluate("(t) => { window.render(t); return document.getElementById('gl').toDataURL('image/png'); }", i / A.fps)
        (fr / f"f_{i:05d}.png").write_bytes(base64.b64decode(data.split(",", 1)[1]))
        if i % 30 == 0: print(f"  {i}/{n}  {time.time() - t0:.0f}s", flush=True)
    b.close()
srv.shutdown()
mp4 = OUT / "talk.mp4"
vf = ["-vf", "format=yuv420p"] if not A.alpha else ["-filter_complex", "color=white:s={}x{}:r={}[bg];[bg][1:v]overlay=shortest=1,format=yuv420p".format(A.w, A.h, A.fps)]
if A.alpha:
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=white:s={A.w}x{A.h}:r={A.fps}", "-framerate", str(A.fps), "-i", str(fr / "f_%05d.png"), "-i", A.audio,
           "-filter_complex", "[0][1]overlay=shortest=1,format=yuv420p[v]", "-map", "[v]", "-map", "2:a",
           "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-af", "apad", "-c:a", "aac", "-b:a", "192k", "-shortest", str(mp4)]
else:
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(A.fps), "-i", str(fr / "f_%05d.png"), "-i", A.audio,
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-af", "apad", "-c:a", "aac", "-b:a", "192k", "-shortest", str(mp4)]
subprocess.run(cmd, check=True)
print("wrote", mp4, f"{n} frames {time.time() - t0:.0f}s")
