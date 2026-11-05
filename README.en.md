# Talking Picture

Make a single character illustration talk **with its original pixels untouched**: blinking, lip sync, expressions, brows, swaying hair and a Live2D-like head turn. At rest the output is identical to the source image (when exported at the image's own size).

- The head turn is a depth-based shift only (the face is treated as an ellipsoid, nose closest; outer hair slightly in front, the back slightly behind), sampled with Catmull-Rom, so nothing is redrawn. Large turns are not possible.
- Nothing is warped. Only the moving parts switch between frames drawn by an image-editing AI.
- Every frame is rendered deterministically, so the same input always gives the same video.

[日本語](README.md)

## How it works

```
src.png ─────┬─ bald_open.png (hair removed) ──┬─ eye frames eye_12 … eye_closed, eye_jito, eye_smile
(1024×1024)  │   (image-editing AI)            └─ no_mouth.png
             └─ hair_only.png (hair on green)

tools/build_layers.py
  hair layer = source − hairless (source pixels; colour solved so hair-over-base == source)
  base       = hairless skin + back hair + background (what shows when hair sways)
  eyes       = frames sorted by measured eyelid height (the AI does not draw the requested %)
  mouth      = painted in the shader over the mouthless skin (opening = loudness, shape = vowel)
  hair sway  = per-strand weights (root → tip polylines, up to 9)

player/player.js (one WebGL shader)
  base → eye frame → mouth → hair (rotated about its root) → slight head tilt
  window.render(t) draws the frame at time t; export calls it frame by frame
```

Only two kinds of motion exist: frame switching and root rotation of hair. Optical-flow in-betweens (`--sub`) were tried and dropped: cross-fades look doubled or torn.

## Requirements

- Python 3.11+, `pip install -r requirements.txt` (numpy, scipy, opencv-python, playwright), `playwright install chromium`
- ffmpeg on PATH
- An image-editing AI that can do **local edits** (everything outside the described area stays pixel-identical). OpenAI Codex CLI's image editing was used here; pasting the prompts into ChatGPT etc. also works (`prompts/README.md`).
- Source art: front-facing bust, plain light background, 1024×1024 (other sizes are resized).

## Steps

1. Put your picture at `gen/src.png`.
2. Generate the variants: `bash prompts/make_keys.sh gen` (Codex CLI) then `python tools/check_variants.py --gen gen` until everything is OK.
3. Build the layers: copy `gen/config.example.json` to `gen/config.json`, adjust the hair strands, then `python tools/build_layers.py --gen gen --out player/assets`.
4. Make a video: `python tools/make_video.py voice.wav out/talk.mp4 --timeline docs/timeline.example.json` (`--w 1080 --h 1920` for portrait, `--alpha` to also keep transparent PNG frames).
5. Check: `python tools/serve.py` → http://127.0.0.1:8765/ , or `python tools/preview.py out/check.png --times 0,1.5,3`.

**No image-editing AI?** `tools/make_variants_local.py` builds the same variants from the source alone: blinks slide the original upper-lash band down and fill the lid with skin, closed/smile/half-lidded eyes follow arcs between the eye corners you give, the mouth line is inpainted, and the hair is detached with an exact alpha (`hair_alpha.png`, used by `build_layers.py`), so the still frame stays identical to the source. Start from `gen/config.local.example.json`.

**No voice yet?** `tools/tts_voice.py demo/narumi_script.json demo/narumi` makes a placeholder voice (pyopenjtalk), an expression timeline and subtitles; `make_video.py ... --subs demo/narumi_subs.json` burns the subtitles in.

See the Japanese README for the config keys, multi-character setup and lessons learned.

## License

MIT. The character art is not included.
