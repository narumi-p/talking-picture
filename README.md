# 喋る絵（Talking Picture）

1 枚のキャラクターの絵を、**元の絵の画素のまま**しゃべらせる道具です。
まばたき・口パク・表情・髪のゆれが動き、止まっているときは元の絵と同じ見た目になります。

- 顔は横に向けません（向けると絵が崩れるので、わざと作っていません）
- 元の絵を変形しません。動く所だけ、画像編集 AI に描かせた「コマ」に切り替えます
- 1 コマずつ決定論的に描くので、同じ入力からは同じ動画ができます

narumi-p と Claude（Anthropic の AI）が、ふたりで一から作りました。

[English](README.en.md)

## しくみ

```
元の絵 src.png ──┬─ 髪なし bald_open.png ──┬─ 目のコマ eye_12 … eye_closed, eye_jito, eye_smile
（1024×1024）     │  （画像編集 AI）         └─ 口なし no_mouth.png
                  └─ 髪だけ hair_only.png（緑地）

tools/build_layers.py
  髪の層   = 元の絵 − 髪なし（元の絵の画素。下地に重ねると元の絵に戻る色にしておく）
  下地     = 髪なしの肌 ＋ 奥の髪 ＋ 背景（髪が揺れて見える所）
  目       = コマを「まぶたの高さ」の順に並べる（AI は指示どおりの割合に描かないので測って並べ直す）
  口       = 口なしの肌の上に、声に合わせてコードで描く（開き＝声の大きさ、形＝あいうえお）
  髪のゆれ = 根元→毛先の線ごとの重み（9 本まで）

player/player.js（WebGL、シェーダー 1 枚）
  下地 → 目のコマ → 口 → 髪（根元を軸に少し回す）→ 頭をわずかに傾ける
  window.render(t) で時刻 t のコマを描く（書き出しはこれを 1 コマずつ呼ぶ）
```

動かす要素は「描いたコマの切り替え」と「髪の根元の回転」だけです。
コマの間を光学フローで補間して半透明に重ねる方法も試しましたが、二重に見えたり裂けたりするのでやめました（`--sub` に残してあります）。

## 必要なもの

- Python 3.11 以上と `pip install -r requirements.txt`（numpy, scipy, opencv-python, playwright）
- `playwright install chromium`（書き出しと確認に headless Chromium を使う）
- ffmpeg（PATH に通っていること）
- 画像編集 AI：「指定した所以外は 1 画素も変えない」局所編集ができるもの。
  手元では OpenAI **Codex CLI** の画像編集（`codex exec -i 絵.png -- "指示"`）を使いました。ChatGPT などに手で貼っても作れます（`prompts/README.md`）
- 元の絵：正面向き・胸から上・背景は無地の明るい色・1024×1024（違う大きさは縮めて使います）

## 手順

### 1. 元の絵を置く

```
gen/src.png
```

### 2. 描き分けを作る（画像編集 AI）

```bash
bash prompts/make_keys.sh gen          # Codex CLI の場合。他のツールは prompts/README.md
python tools/check_variants.py --gen gen
```

`gen/` に次の絵ができます：`bald_open`（髪なし）・`hair_only`（髪だけ、緑地）・`eye_12/25/37/62/75/closed`・`eye_jito`・`eye_smile`・`no_mouth`。
`check_variants.py` が全部 OK になるまで作り直します（NG＝絵全体が描き直されている）。

### 3. 層（レイヤー）を作る

```bash
cp gen/config.example.json gen/config.json   # 髪の線などを自分の絵に合わせる（下の「設定」）
python tools/build_layers.py --gen gen --out player/assets
```

「止まっているときの再現誤差」が 1 以下なら、止まった状態は元の絵と同じです。

### 4. 声から動画を作る

```bash
python tools/make_video.py 声.wav out/talk.mp4 --timeline docs/timeline.example.json
```

- `声.wav`：16bit/24bit の wav（モノラルでもステレオでも可）
- `--timeline`：表情のタイミング `{"events": [{"t": 2.0, "dur": 1.2, "expr": "smile"}, {"t": 5.0, "dur": 1.0, "expr": "jito"}]}`（t＝始まる秒、dur＝続く秒）。省略可
- `--w 1080 --h 1920` で縦長、`--alpha` で背景を透明にした PNG 連番（`out/<名前>_work/frames/`）も残します。動画編集ソフトに重ねるときに使います
- まばたきの間隔は決定論的な乱数で決まります（`export.py --seed` で変えられます）

### 5. 確認する

```bash
python tools/serve.py                       # → http://127.0.0.1:8765/  「声と一緒に再生」（player/assets/voice.wav を置く）
python tools/preview.py out/check.png --times 0,1.5,3 --lips out/talk_work/lips.json
python tools/preview.py out/check.png --states '[{"label":"rest"},{"eye":[6,6,0],"label":"closed"},{"open":0.8,"shape":[1,0,0,0,0],"label":"a"}]'
```

動画を人に渡す前に、全コマの一覧（`ffmpeg -i talk.mp4 -vf "fps=3,scale=240:-1,tile=7x4" tiles.png`）と目・口の拡大を自分の目で見ることを勧めます。数値が合っていても絵が壊れていることがあります。

## 設定（gen/config.json）

| キー | 意味 |
|---|---|
| `strands` | 揺らす髪。`pts` は根元→毛先の点（画素）、`sig` は線のまわりの幅、`amp` は揺れの大きさ（度）。最大 9 本。元の絵を画像ソフトで開いて座標を読む |
| `pivot`, `neck_y` | 頭を傾ける軸（首の付け根）と、傾けない下限の高さ |
| `mouth_region` | 口を探す範囲 (x0, y0, x1, y1) |
| `body_check` | 髪が無い所（描き分けの位置ずれを確かめる） |
| `background_rgb` | 背景の色 |
| `eye_keys`, `expressions` | 目のコマの名前（開→閉の順）と表情の名前 |

`config.example.json` の値は 1024×1024・胸から上・髪が肩までの絵に合わせたものです。髪の線だけは絵ごとに引き直してください。

## 複数のキャラクター

層のフォルダを分けて `--assets` で切り替えます。

```bash
python tools/build_layers.py --gen gen_b --out player/assets_b
python tools/make_video.py 声.wav out/b.mp4 --assets assets_b
```

ブラウザでは `index.html?assets=assets_b`。

## ファイル

```
player/   index.html, player.js        再生（WebGL）。assets/ に層が入る
tools/    build_layers.py              描き分け → 層
          audio_lips.py                声 → 口の開きと形（LPC フォルマント）
          export.py                    1 コマずつ描いて mp4（--alpha で透明 PNG）
          make_video.py                声 → 動画まで一括
          preview.py                   時刻・状態を指定して描いて確認
          check_variants.py            描き分けが局所編集かを検品
          serve.py                     player/ を配る小さなサーバー
prompts/  make_keys.sh, *.txt          画像編集 AI への指示文
gen/      config.example.json          絵ごとの設定の例（自分の絵と描き分けはここに置く。git には入れない）
docs/     timeline.example.json        表情のタイムラインの例
```

## うまくいかないときに分かったこと

- **コマの間を補間しない。** フローで曲げて半透明に重ねると二重・裂けが出る。描いたコマを細かく（6〜7 段）して切り替える方がきれい
- **目のコマは測って並べる。** AI は「半目」を 37% と同じ高さに描くことがある。まぶたの高さ（瞳の列で上から最初の暗い画素）で順に並べ、逆順のものは外す
- **目と口は髪なしの絵の上に描かせる。** 髪に隠れた所まで描かれるので、髪が揺れても欠けない
- **描き分けは「局所編集・ビット同一」を明記する。** 全体を描き直されると差分で部品が取れない。返ってきた大きさが違うときは元に戻す
- **服を着せ替えるときは、髪なしの絵に着せてから元の髪を重ねる。** 元の絵の細い首に沿って襟を描かせると、襟が細い筒になって首が長く見える
- **GPU のシェーダーで sampler を関数の引数に渡さない**（ANGLE/D3D で別のテクスチャを読むことがある）。`#define` マクロで書く

## ライセンス

MIT（`LICENSE`）。描き分けの指示文も自由に使ってください。キャラクターの絵は含まれていません。
