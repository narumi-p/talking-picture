"""声（wav）から喋る動画を作る：音声→口の動き→1コマずつ描画→mp4。
python tools/make_video.py <voice.wav> <out.mp4> [--timeline 表情.json] [--w 1080 --h 1080] [--assets assets] [--alpha]
表情.json の例: {"events": [{"t": 2.0, "dur": 1.2, "expr": "smile"}, {"t": 5.0, "dur": 1.0, "expr": "jito"}]}
"""
import argparse, shutil, subprocess, sys
from pathlib import Path
R = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("voice"); ap.add_argument("out"); ap.add_argument("--timeline", default="")
ap.add_argument("--w", default="1080"); ap.add_argument("--h", default="1080"); ap.add_argument("--assets", default="assets")
ap.add_argument("--fps", default="30"); ap.add_argument("--alpha", action="store_true")
A = ap.parse_args()
work = R / "out" / (Path(A.out).stem + "_work"); work.mkdir(parents=True, exist_ok=True)
lips = work / "lips.json"
subprocess.run([sys.executable, str(R / "tools/audio_lips.py"), A.voice, str(lips), "--fps", A.fps], check=True)
cmd = [sys.executable, str(R / "tools/export.py"), "--audio", A.voice, "--lips", str(lips), "--out", str(work), "--w", A.w, "--h", A.h, "--fps", A.fps, "--assets", A.assets]
if A.timeline: cmd += ["--timeline", A.timeline]
if A.alpha: cmd += ["--alpha"]
subprocess.run(cmd, check=True)
Path(A.out).parent.mkdir(parents=True, exist_ok=True)
shutil.copy(work / "talk.mp4", A.out)
print("できた:", A.out, " コマ:", work / "frames")
