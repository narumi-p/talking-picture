"""台本（セリフと表情）から、声の wav・表情のタイムライン・字幕をまとめて作る（声が無いときの試し用）。
python tools/tts_voice.py <台本.json> <出力の名前> [--half_tone 7 --speed 1.05 --gap 0.55]
  台本.json: {"lines": [{"text": "こんにちは、なるみです。", "expr": "smile"}, {"text": "…", "expr": "jito"}, {"text": "…"}]}
    expr（任意）: smile＝言い終わりに笑う、jito＝言っている間ジト目。gap（任意）: そのセリフの後の間（秒）
  出力: <名前>.wav, <名前>_timeline.json（make_video.py --timeline）, <名前>_subs.json（make_video.py --subs）

声は pyopenjtalk（Open JTalk、pip install pyopenjtalk）で作ります。入っている声は男声なので --half_tone で高くしています。
本番は本人の声やほかの音声合成の wav に差し替え、字幕とタイムラインの秒数だけ合わせてください。

Script (lines + expressions) -> voice wav (Open JTalk via pyopenjtalk), expression timeline and subtitle json.
"""
import argparse, json, wave
from pathlib import Path
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("script"); ap.add_argument("out")
ap.add_argument("--half_tone", type=float, default=7.0); ap.add_argument("--speed", type=float, default=1.05)
ap.add_argument("--gap", type=float, default=0.55); ap.add_argument("--lead", type=float, default=0.5)
A = ap.parse_args()
import pyopenjtalk

lines = json.load(open(A.script, encoding="utf-8"))["lines"]
SR = 48000
parts = [np.zeros(int(A.lead * SR))]; t = A.lead; events = []; subs = []
for ln in lines:
    x, sr = pyopenjtalk.tts(ln["text"], half_tone=A.half_tone, speed=A.speed)
    if sr != SR:
        from scipy.signal import resample_poly
        g = np.gcd(sr, SR); x = resample_poly(x, SR // g, sr // g)
    d = len(x) / SR
    subs.append({"t": round(t, 2), "dur": round(d, 2), "text": ln["text"]})
    if ln.get("expr") == "smile": events.append({"t": round(t + d * 0.55, 2), "dur": 1.3, "expr": "smile"})
    elif ln.get("expr"): events.append({"t": round(t + 0.25, 2), "dur": round(d + 0.3, 2), "expr": ln["expr"]})
    gap = float(ln.get("gap", A.gap))
    parts += [x.astype(np.float64), np.zeros(int(gap * SR))]; t += d + gap
y = np.concatenate(parts); y = y / (np.abs(y).max() + 1e-9) * 0.85 * 32767
out = Path(A.out); out.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(out.with_suffix(".wav")), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(y.astype(np.int16).tobytes())
json.dump({"events": events}, open(f"{out}_timeline.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(subs, open(f"{out}_subs.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{out.with_suffix('.wav')}  {t:.2f}s  表情 {len(events)}  字幕 {len(subs)}")
