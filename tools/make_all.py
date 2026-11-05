"""作業フォルダから、部品 → 層 → 確認シート（→ 動画）までを一度に作る。
python tools/make_all.py <作業フォルダ（例 gen_b）> [--assets assets_b] [--ai] [--voice 声.wav --timeline 表情.json --subs 字幕.json --out out/b.mp4]
  --assets  層の書き出し先（player/<名前>。既定は assets_<フォルダ名>）
  --ai      部品を作り直さない（画像編集 AI で描いた部品をそのまま使う）。既定はコードで作る（make_variants_local.py）
  --voice   声があれば動画も作る

Run the whole pipeline for one work folder: variants -> layers -> check sheet (-> video).
"""
import argparse, subprocess, sys
from pathlib import Path

R = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("gen"); ap.add_argument("--assets", default=""); ap.add_argument("--ai", action="store_true")
ap.add_argument("--voice", default=""); ap.add_argument("--timeline", default=""); ap.add_argument("--subs", default=""); ap.add_argument("--out", default="")
A = ap.parse_args()
G = Path(A.gen); name = A.assets or f"assets_{G.name}"
run = lambda *c: subprocess.run([sys.executable, *map(str, c)], check=True)
if not A.ai:
    print("── 部品（コードで作る）"); run(R / "tools/make_variants_local.py", "--gen", G, "--debug", f"out/{G.name}_variants.png")
print("── 層"); run(R / "tools/build_layers.py", "--gen", G, "--out", R / "player" / name)
print("── 設定の重ね表示"); run(R / "tools/show_config.py", G, f"out/{G.name}_config.png")
print("── 確認シート"); run(R / "tools/check_sheet.py", "--assets", name, "--out", f"out/{G.name}_check.png")
if A.voice:
    print("── 動画")
    cmd = [R / "tools/make_video.py", A.voice, A.out or f"out/{G.name}.mp4", "--assets", name]
    if A.timeline: cmd += ["--timeline", A.timeline]
    if A.subs: cmd += ["--subs", A.subs]
    run(*cmd)
print(f"できた：player/{name}（スタジオは studio.html?a={name}）、確認は out/{G.name}_config.png と out/{G.name}_check.png")
