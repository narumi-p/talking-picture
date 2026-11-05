"""台本（セリフと表情）から、声の wav・表情のタイムライン・字幕をまとめて作る（声が無いときの試し用）。
python tools/tts_voice.py <台本.json> <出力の名前> [--voice tohoku-f01] [--speed 1.1 --gap 0.5]
  台本.json: {"lines": [{"text": "こんにちは、なるみです。", "expr": "smile"}, {"text": "…", "expr": "jito", "emo": "angry"}, {"text": "…"}]}
    expr（任意）: smile＝言い終わりに笑う、jito＝言っている間ジト目、brow＝言い始めに眉を上げる（驚き）
    emo（任意）: 声の感情 neutral / happy / angry / sad（tohoku-f01 のとき。省略時は smile なら happy、ほかは neutral）
    gap（任意）: そのセリフの後の間（秒）。speed（任意）: そのセリフだけの速さ
  出力: <名前>.wav, <名前>_timeline.json（make_video.py --timeline）, <名前>_subs.json（make_video.py --subs）

声は pyopenjtalk（Open JTalk、pip install pyopenjtalk）で作ります。
  --voice tohoku-f01（既定）: 東北大学の女性話者の HTS 音声（CC BY 4.0、感情 4 種）。初回に voices/ へ取ってくる（git には入れない）
                              動画を公開するときは「HTS voice tohoku-f01 (c) 東北大学 伊藤・能勢研究室, CC BY 4.0」のように表記する
  --voice <file.htsvoice>    : 手元の HTS 音声
  --voice builtin            : pyopenjtalk 内蔵の男声（--half_tone で高くする）
本番は本人の声やほかの音声合成の wav に差し替え、字幕とタイムラインの秒数だけ合わせてください。

Script (lines + expressions) -> voice wav (Open JTalk; female HTS voice tohoku-f01 with emotions by default),
expression timeline and subtitle json.
"""
import argparse, json, urllib.request, wave
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("script"); ap.add_argument("out")
ap.add_argument("--voice", default="tohoku-f01"); ap.add_argument("--half_tone", type=float, default=None)
ap.add_argument("--speed", type=float, default=1.1); ap.add_argument("--gap", type=float, default=0.5); ap.add_argument("--lead", type=float, default=0.5)
A = ap.parse_args()
import pyopenjtalk
from pyopenjtalk.htsengine import HTSEngine

TOHOKU = "https://raw.githubusercontent.com/icn-lab/htsvoice-tohoku-f01/master/tohoku-f01-{}.htsvoice"
EMOS = ["neutral", "happy", "angry", "sad"]


def tohoku(emo):
    d = ROOT / "voices"; d.mkdir(exist_ok=True)
    p = d / f"tohoku-f01-{emo}.htsvoice"
    if not p.exists():
        print("声を取ってくる:", TOHOKU.format(emo))
        urllib.request.urlretrieve(TOHOKU.format(emo), p)
    return p


engines = {}
def synth(text, emo, speed):
    """1 セリフを合成。emo は tohoku-f01 の感情"""
    if A.voice == "builtin":
        x, sr = pyopenjtalk.tts(text, half_tone=7.0 if A.half_tone is None else A.half_tone, speed=speed)
        return x, sr
    path = tohoku(emo if emo in EMOS else "neutral") if A.voice == "tohoku-f01" else Path(A.voice)
    if path not in engines: engines[path] = HTSEngine(str(path).encode())
    eng = engines[path]
    eng.set_speed(speed)
    if A.half_tone: eng.add_half_tone(A.half_tone)
    x = eng.synthesize(pyopenjtalk.extract_fullcontext(text)); sr = eng.get_sampling_frequency()
    eng.refresh()
    return x, sr


lines = json.load(open(A.script, encoding="utf-8"))["lines"]
SR = 48000
parts = [np.zeros(int(A.lead * SR))]; t = A.lead; events = []; subs = []
for ln in lines:
    emo = ln.get("emo") or ("happy" if ln.get("expr") == "smile" else "neutral")
    x, sr = synth(ln["text"], emo, float(ln.get("speed", A.speed)))
    if sr != SR:
        from scipy.signal import resample_poly
        g = np.gcd(sr, SR); x = resample_poly(x, SR // g, sr // g)
    x = np.asarray(x, np.float64)
    nz = np.nonzero(np.abs(x) > np.abs(x).max() * 0.01)[0]                        # 前後の無音を詰める（間は gap でそろえる）
    if len(nz): x = x[max(0, nz[0] - int(0.03 * SR)):nz[-1] + int(0.08 * SR)]
    x = x / (np.abs(x).max() + 1e-9)
    d = len(x) / SR
    subs.append({"t": round(t, 2), "dur": round(d, 2), "text": ln["text"]})
    for ex in ([ln["expr"]] if isinstance(ln.get("expr"), str) else ln.get("expr", [])):
        if ex == "smile": events.append({"t": round(t + d * 0.55, 2), "dur": 1.3, "expr": "smile"})
        elif ex == "brow": events.append({"t": round(t, 2), "dur": 0.9, "expr": "brow"})
        else: events.append({"t": round(t + 0.25, 2), "dur": round(d + 0.3, 2), "expr": ex})
    gap = float(ln.get("gap", A.gap))
    parts += [x, np.zeros(int(gap * SR))]; t += d + gap
y = np.concatenate(parts); y = y / (np.abs(y).max() + 1e-9) * 0.85 * 32767
out = Path(A.out); out.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(out.with_suffix(".wav")), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(y.astype(np.int16).tobytes())
json.dump({"events": events}, open(f"{out}_timeline.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(subs, open(f"{out}_subs.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{out.with_suffix('.wav')}  {t:.2f}s  声 {A.voice}  表情 {len(events)}  字幕 {len(subs)}")
