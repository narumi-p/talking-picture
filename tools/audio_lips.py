"""声（wav）→ 1 コマごとの口の開き（声の大きさ）と口の形（声のひびき＝フォルマント → あいうえお）。
python tools/audio_lips.py <in.wav> <out.json> [--fps 30]
出力: {"fps", "duration", "open": [...], "shape": [[a,i,u,e,o], ...]}（shape は各母音の重み、合計 1）

Voice (wav) -> per-frame mouth opening (loudness) and vowel shape (LPC formants -> a/i/u/e/o).
The formant table is tuned for a female voice; for a low voice lower the values in VOW by ~15%.
"""
import sys, json, wave
import numpy as np
from scipy.signal import resample_poly, lfilter
args = sys.argv[1:]
src, dst = args[0], args[1]
FPS = int(args[args.index("--fps") + 1]) if "--fps" in args else 30
with wave.open(src) as w:
    sr = w.getframerate(); ch = w.getnchannels(); n = w.getnframes(); sw = w.getsampwidth()
    raw = w.readframes(n)
x = np.frombuffer(raw, dtype={2: np.int16, 4: np.int32}[sw]).astype(np.float64)
if ch > 1: x = x.reshape(-1, ch).mean(1)
x /= np.abs(x).max() + 1e-9
# 16 kHz にそろえる
g = np.gcd(sr, 16000); x16 = resample_poly(x, 16000 // g, sr // g); SR = 16000
dur = len(x) / sr; nf = int(np.ceil(dur * FPS))
win = int(0.040 * SR); hann = np.hanning(win)
VOW = {"a": (850, 1450), "i": (350, 2700), "u": (420, 1550), "e": (600, 2250), "o": (560, 1000)}   # 女性の声のおよそのフォルマント (F1, F2)
KEYS = list(VOW)
def lpc(seg, order=12):
    r = np.correlate(seg, seg, "full")[len(seg) - 1:len(seg) + order]
    if r[0] <= 1e-9: return None
    a = np.zeros(order + 1); a[0] = 1.0; e = r[0]
    for i in range(1, order + 1):                                   # Levinson–Durbin
        k = -(r[i] + np.dot(a[1:i], r[i - 1:0:-1])) / e
        a[1:i] = a[1:i] + k * a[i - 1:0:-1]; a[i] = k; e *= (1 - k * k)
        if e <= 0: return None
    return a
def formants(seg):
    seg = lfilter([1, -0.63], [1], seg) * np.hanning(len(seg))
    a = lpc(seg)
    if a is None: return None
    rts = [r for r in np.roots(a) if np.imag(r) > 0.01]
    fr = sorted((np.angle(r) * SR / (2 * np.pi), -SR / np.pi * np.log(abs(r))) for r in rts)
    fs = [f for f, bw in fr if 200 < f < 4000 and bw < 450]
    return fs[:2] if len(fs) >= 2 else None
rms = np.zeros(nf); shape = np.zeros((nf, 5)); voiced = np.zeros(nf, bool)
for i in range(nf):
    c = int((i + 0.5) / FPS * SR); a0 = max(0, c - win // 2); seg = x16[a0:a0 + win]
    if len(seg) < win: seg = np.pad(seg, (0, win - len(seg)))
    rms[i] = np.sqrt(np.mean(seg ** 2) + 1e-12)
    f = formants(seg) if rms[i] > 0.01 else None
    if f:
        f1, f2 = f
        d = np.array([((f1 - v[0]) / 250.0) ** 2 + ((f2 - v[1]) / 600.0) ** 2 for v in VOW.values()])
        wv = np.exp(-d / 0.6); shape[i] = wv / wv.sum(); voiced[i] = True
db = 20 * np.log10(rms + 1e-9)
peak = np.percentile(db[db > -60], 95) if (db > -60).any() else -10
op = np.clip((db - (peak - 22)) / 22.0, 0, 1) ** 1.5                      # 大きい声ほど大きく開く
# 口の開きはすばやく開いて少しゆっくり閉じる
sm = np.zeros(nf); v = 0.0
for i in range(nf):
    v = v + (op[i] - v) * (0.75 if op[i] > v else 0.45); sm[i] = v
sm = np.minimum(sm, 0.92); sm[sm < 0.06] = 0.0
# 形：無声のコマは前後の有声から補う → なめらかに
last = np.array([1, 0, 0, 0, 0.0])
for i in range(nf):
    if voiced[i]: last = shape[i]
    else: shape[i] = last
from scipy.ndimage import uniform_filter1d
shape = uniform_filter1d(shape, 3, axis=0); shape /= shape.sum(1, keepdims=True)
json.dump({"fps": FPS, "duration": dur, "open": [round(float(v), 3) for v in sm], "shape": [[round(float(t), 3) for t in s] for s in shape],
           "vowels": KEYS}, open(dst, "w"))
top = [KEYS[int(np.argmax(s))] if o > 0 else "-" for s, o in zip(shape, sm)]
print(f"{nf} frames, {dur:.2f}s, open>0: {(sm > 0).mean():.0%}")
print("".join(top))
