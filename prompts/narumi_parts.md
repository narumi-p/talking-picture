# なるみの部品：画像編集 AI へのプロンプト

ChatGPT（画像編集）や Codex などで、**元の絵をそのまま入力**にして 1 枚ずつ作ってください。
できた絵はファイル名のとおりに保存して、まとめて渡してください（このあと `make_variants_local.py` の代わりに使い、目と口を差し替えます）。

- 入力：バストアップの元の絵（1254×1254）。全身版は全身の絵（1024×1536）で同じものを（顔が小さいので、うまくいかなければバストアップだけで大丈夫です）
- 大きさが変わって返ってきても大丈夫です（こちらで元の大きさに戻します）。**絵全体が描き直されていないか**だけ見てください（髪や服の形が変わっていたら作り直し）
- 1 つのチャットで続けると前の編集が混ざることがあるので、1 枚ごとに新しいチャットで元の絵から

## 毎回の前書き（各プロンプトの前に貼る）

```
Edit the attached illustration. This must be a LOCAL edit: change ONLY the part described below and keep every other pixel exactly as it is (same canvas size, same framing, same hair, face shape, clothes, background, colors, line weight and art style). Do not redraw, re-render, upscale or restyle the rest of the image. No text, no watermark.
```

## 目（5 枚）

| ファイル名 | プロンプト |
|---|---|
| `eye_half.png` | `Change ONLY the two eyes: lower the upper eyelids and upper eyelashes to the middle of the irises (half-closed, as in the middle of a blink). Keep the same eyelash shape, thickness and color, the same lower eyelids and the same eye positions. Do NOT change the eyebrows, nose, mouth, hair or anything else.` |
| `eye_75.png` | `Change ONLY the two eyes: lower the upper eyelids so the eyes are almost closed, leaving only a thin sliver of the irises just above the lower eyelids, as just before the eyes close in a blink. Keep the same eyelash style and color. Do NOT change anything else.` |
| `eye_closed.png` | `Change ONLY the two eyes: close both eyes gently as in a natural blink. Each eye becomes a soft closed eyelid line of the same dark eyelashes, curving slightly downward, placed at the height of the lower part of the open eye, with the same skin tone on the closed eyelid. Keep the eyebrows exactly as they are. Do NOT change anything else.` |
| `eye_smile.png` | `Change ONLY the two eyes: make happy smiling closed eyes. Each eye is drawn as an upward-curved arc of the same dark eyelashes (like ^ ^), with the cheeks under the eyes unchanged. Do NOT change the eyebrows, mouth, hair or anything else.` |
| `eye_jito.png` | `Change ONLY the two eyes: make a half-lidded, unimpressed "jito-me" look. The upper eyelids are flat and straight, lowered to the middle of the irises, the irises still looking straight at the viewer, the same eyelash style. Do NOT change the eyebrows, mouth, hair or anything else.` |

## 口（6 枚）

| ファイル名 | プロンプト |
|---|---|
| `mouth_small.png` | `Change ONLY the mouth: open it slightly as when starting to speak, a small dark opening under the same smiling upper lip line, a hint of the tongue. Same line color and thickness as the original mouth, same width. Do NOT change the nose, chin, face outline, eyes or anything else.` |
| `mouth_a.png` | `Change ONLY the mouth: open it wide as when saying "a" (あ), a rounded open mouth with a dark red inside and a pink tongue at the bottom, the upper lip line keeping the same color and thickness as the original. Keep the mouth centered at the same place. Do NOT change anything else.` |
| `mouth_i.png` | `Change ONLY the mouth: shape it as when saying "i" (い): a wide, thin horizontal opening showing the upper teeth as a white band, the corners pulled slightly sideways. Same line color and thickness as the original. Do NOT change anything else.` |
| `mouth_u.png` | `Change ONLY the mouth: shape it as when saying "u" (う): a small, rounded, slightly pursed opening, narrower than the original mouth. Same line color and thickness. Do NOT change anything else.` |
| `mouth_e.png` | `Change ONLY the mouth: shape it as when saying "e" (え): a medium-wide opening, a little wider than tall, with the upper teeth slightly visible. Same line color and thickness. Do NOT change anything else.` |
| `mouth_o.png` | `Change ONLY the mouth: shape it as when saying "o" (お): a rounded oval opening, taller than "u" and narrower than "a", dark red inside. Same line color and thickness. Do NOT change anything else.` |

## あると、さらに良くなるもの（任意）

| ファイル名 | プロンプト |
|---|---|
| `brow_up.png` | `Change ONLY the eyebrows: raise both eyebrows a little as in mild surprise, keeping their exact shape, thickness and color. Do NOT change anything else.` |
| `face_blush.png` | `Change ONLY the cheeks: make the pink blush on both cheeks a little stronger, with the same soft style. Do NOT change anything else.` |
