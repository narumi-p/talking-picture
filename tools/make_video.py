"""声（wav）から喋る動画を作る：音声→口の動き→1コマずつ描画→mp4。
python tools/make_video.py <voice.wav> <out.mp4> [--timeline 表情.json] [--subs 字幕.json] [--w 1080 --h 1080] [--assets assets] [--alpha]
表情.json の例: {"events": [{"t": 2.0, "dur": 1.2, "expr": "smile"}, {"t": 5.0, "dur": 1.0, "expr": "jito"}]}
字幕.json の例: [{"t": 0.5, "dur": 2.1, "text": "こんにちは"}]（tts_voice.py が作る）。--font で字体（既定 IPAGothic）
"""
import argparse, shutil, subprocess, sys
from pathlib import Path
R = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("voice"); ap.add_argument("out"); ap.add_argument("--timeline", default="")
ap.add_argument("--w", default="1080"); ap.add_argument("--h", default="1080"); ap.add_argument("--assets", default="assets")
ap.add_argument("--fps", default="30"); ap.add_argument("--alpha", action="store_true")
ap.add_argument("--subs", default=""); ap.add_argument("--font", default="IPAGothic")
A = ap.parse_args()
work = R / "out" / (Path(A.out).stem + "_work"); work.mkdir(parents=True, exist_ok=True)
lips = work / "lips.json"
subprocess.run([sys.executable, str(R / "tools/audio_lips.py"), A.voice, str(lips), "--fps", A.fps], check=True)
cmd = [sys.executable, str(R / "tools/export.py"), "--audio", A.voice, "--lips", str(lips), "--out", str(work), "--w", A.w, "--h", A.h, "--fps", A.fps, "--assets", A.assets]
if A.timeline: cmd += ["--timeline", A.timeline]
if A.alpha: cmd += ["--alpha"]
subprocess.run(cmd, check=True)
Path(A.out).parent.mkdir(parents=True, exist_ok=True)
if A.subs:                                                                         # 字幕を焼き込む（ASS → libass）
    import json
    W, H = int(A.w), int(A.h); fs = max(24, int(min(W, H) * 0.045))
    ts = lambda v: f"{int(v // 3600)}:{int(v % 3600 // 60):02d}:{v % 60:05.2f}"
    ass = [f"[Script Info]\nScriptType: v4.00+\nPlayResX: {W}\nPlayResY: {H}\nWrapStyle: 0\n",
           "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
           f"Style: Default,{A.font},{fs},&H00FFFFFF,&H00FFFFFF,&H00402A33,&H64000000,-1,0,0,0,100,100,0,0,1,{max(2, fs // 9)},1,2,{W // 14},{W // 14},{int(H * 0.05)},1\n",
           "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    per = max(8, int((W - 2 * (W // 14)) / (fs * 1.02)))                          # 1 行に入る文字数（日本語は空白で折り返されない）
    def wrap(t):                                                                   # 行の長さがそろうよう、句読点の近くで折る
        lines = []
        while len(t) > per:
            n = -(-len(t) // per); goal = len(t) / n
            cands = [i + 1 for i, ch in enumerate(t[:per]) if ch in "、。，．！？!? " and i + 1 >= goal * 0.5]
            cut = min(cands, key=lambda c: abs(c - goal)) if cands else per
            lines.append(t[:cut]); t = t[cut:]
        return "\\N".join(lines + [t])
    for e in json.load(open(A.subs, encoding="utf-8")):
        e = dict(e, text=wrap(e["text"]))
        ass.append(f"Dialogue: 0,{ts(e['t'])},{ts(e['t'] + e['dur'] + 0.15)},Default,,0,0,0,,{e['text']}")
    (work / "subs.ass").write_text("\n".join(ass) + "\n", encoding="utf-8")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(work / "talk.mp4"), "-vf", "ass=subs.ass",
                    "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "copy", str(Path(A.out).resolve())], check=True, cwd=work)
else:
    shutil.copy(work / "talk.mp4", A.out)
print("できた:", A.out, " コマ:", work / "frames")
