# 喋る絵（Talking Picture）

1 枚のキャラクターの絵を、**元の絵の画素のまま**しゃべらせる道具です。
まばたき・口パク・表情・眉・髪のゆれ・Live2D 風の顔の向きが動き、止まっているときは元の絵と同じ画素になります（絵の大きさのまま書き出したとき）。

- 顔の向きは「奥行きのずらし」だけ：顔を楕円の奥行き（鼻のあたりが手前）とみなし、奥行きに比例して少しずらす。描き直しはしないので絵は崩れない（大きく横を向くことはできません）
- 目や口は、描いた「コマ」（画像編集 AI か `make_variants_local.py`）に切り替えます
- 1 コマずつ決定論的に描くので、同じ入力からは同じ動画ができます

[English](README.en.md)

## しくみ

```
元の絵 src.png ──┬─ 髪なし bald_open.png ──┬─ 目のコマ eye_12 … eye_closed, eye_jito, eye_smile
（正方形）        │  （画像編集 AI か        ├─ 口なし no_mouth.png
                  │   make_variants_local）  ├─ 眉なし no_brow.png ＋ 眉の濃さ brow_alpha.png（任意）
                  │                          └─ 黒目なし no_iris.png ＋ 黒目の濃さ iris_alpha.png ＋ 目の開いた所 eye_open.png（任意）
                  └─ 髪だけ hair_only.png（緑地）

tools/build_layers.py
  髪の層   = 元の絵 − 髪なし（元の絵の画素。下地に重ねると元の絵に戻る色にしておく）
  下地     = 髪なしの肌 ＋ 奥の髪 ＋ 背景（髪が揺れて見える所）
  目       = コマを「まぶたの高さ」の順に並べる（AI は指示どおりの割合に描かないので測って並べ直す）
  口       = 口なしの肌の上に、声に合わせてコードで描く（開き＝声の大きさ、形＝あいうえお）
  眉       = 眉を消した肌の上に、眉をずらして重ねる（任意）
  視線     = 黒目を消した白目の上に、黒目をずらして重ねる（開いた目のときだけ。任意）
  髪のゆれ = 根元→毛先の線ごとの重み（9 本まで）

player/player.js（WebGL、シェーダー 1 枚）
  下地 → 目のコマ → 視線 → 眉 → 口 → 髪（根元を軸に少し回す）
  顔の向き（左右・上下）＝奥行きに比例したずらし。顔の外の髪は少し手前、後ろは少し奥（視差）。頭の傾き・呼吸（肩）も
  読み出しは Catmull-Rom（止まっているときは元の画素そのもの、動いてもぼけにくい）
  window.render(t) で時刻 t のコマを描く（書き出しはこれを 1 コマずつ呼ぶ）
```

動かす要素は「描いたコマの切り替え」「なめらかなずらし（顔の向き・呼吸・眉）」「髪の根元の回転」だけです。
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

#### 画像編集 AI を使わない場合（コードで作る）

画像編集 AI が無くても、元の絵 1 枚から同じ名前の絵をコードで作れます（`tools/make_variants_local.py`）。

- **目のコマ**：上まつ毛の帯を元の画素のまま下へ滑らせ、二重の線から下のまぶたの肌（跳ねたまつ毛を消した絵）を縦に引き伸ばして埋める。閉じた目は目じりと目がしらを結ぶ ‿ の弧、笑顔は ∩ の弧、ジト目は平らな線まで下ろす
- **口なし**：口の線だけを周りの肌で埋める
- **眉・黒目**：眉は暗いかたまりを取り出して下を埋め、黒目は赤みの強い所に楕円を当てはめ、下の白目は行ごとに左右の白目の色でつなぐ
- **頭と首**：あごの輪郭線を壁にして鼻と耳（`local.ears`）から塗りつぶした範囲を頭（`head_alpha.png`）にする。`build_layers.py` は頭の内側を周りの色で埋めた首の層（`necklayer.png`）を作り、顔が向きを変えても首と襟は止まったまま、あごの下から首が見える
- **髪なし**：髪を全部外し、人物の上は周りの色で埋め、外は背景色にする。髪の濃さも `hair_alpha.png` に書き、`build_layers.py` はそれを使う（止まっているときの誤差 0）

```bash
cp gen/config.local.example.json gen/config.json   # 目じり・目がしら・口・顔と服の範囲・髪の線を自分の絵に合わせる
python tools/make_variants_local.py --gen gen --debug out/variants.png   # out/variants*.png で目のコマと髪の範囲を確認
python tools/build_layers.py --gen gen --out player/assets
```

`config.json` の `"local"` に書くもの（座標は 1024×1024 にそろえた絵の画素）：

| キー | 意味 |
|---|---|
| `eyes` | 目ごとに `box`（目の範囲。眉は入れない）、`outer`（目じり）、`inner`（目がしら）。目じり・目がしらは上下のまぶたが合わさる所 |
| `mouth_box` | 口の線の範囲 |
| `face_poly` | 顔・耳・首の多角形。中の暗い所は、外の髪とつながる毛だけを髪とみなす |
| `body_poly` | 服の多角形。服が髪と同じ色でも髪にしない（中は赤い毛先など、はっきり違う色だけ髪にする） |
| `keep_boxes` | 髪にしない所（眉・口・鼻） |
| `brows` | 眉の範囲（上げ下げする） |
| `hair_ymax` | これより下は髪として扱わない |

`config.local.example.json` は、胸から上・ショートボブ・紺のジャージの絵（なるみ）に合わせた値です。

**全身の絵**は `gen_full/config.local.example.json` が例です（1024×1536 を左右に背景をのばして 1536×1536 にした絵）。顔が小さいので、`local.eye_scale`（目の幅 150px ほどで 1。全身では 0.27）で目まわりの画素数を縮め、`frame`（見せる範囲 [x, y, 幅, 高さ]）で元の大きさのまま書き出し、`head.soft`（首・肩のなじませ幅）と `head.body`（体の角度の軸 `pivot` と大きさ `deg`）を足します。

```bash
python tools/make_variants_local.py --gen gen_full && python tools/build_layers.py --gen gen_full --out player/assets_full
python tools/make_video.py demo/narumi.wav out/full.mp4 --assets assets_full --timeline demo/narumi_timeline.json --subs demo/narumi_subs.json
```

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

声が無いときは、台本から試し用の声・表情のタイミング・字幕を作れます（`pip install pyopenjtalk`。Open JTalk の声を高くしたもの）。

```bash
python tools/tts_voice.py demo/narumi_script.json demo/narumi
python tools/make_video.py demo/narumi.wav out/narumi.mp4 --timeline demo/narumi_timeline.json --subs demo/narumi_subs.json
```

- `声.wav`：16bit/24bit の wav（モノラルでもステレオでも可）
- `--timeline`：表情のタイミング `{"events": [{"t": 2.0, "dur": 1.2, "expr": "smile"}, {"t": 5.0, "dur": 1.0, "expr": "jito"}]}`（t＝始まる秒、dur＝続く秒）。省略可。`smile`（笑顔・少し上を向く）、`jito`（ジト目・横を向いて眉を下げる）、`brow`（驚き：眉を上げる）
- 顔の向き・うなずき（声の強い所）・視線（頭と逆に動いて正面を見続け、ときどき移す）・呼吸は自動で付きます。止めるときは `index.html?motion=0`
- 大きさは既定で絵の大きさのまま（止まっている所は元の絵と同じ画素）。`--w 1080 --h 1920` で縦長（絵は下に寄せる）、`--alpha` で背景を透明にした PNG 連番（`out/<名前>_work/frames/`）も残します。動画編集ソフトに重ねるときに使います
- `--subs`：字幕 `[{"t": 0.5, "dur": 2.1, "text": "こんにちは"}]` を焼き込む（字体は `--font`、既定 IPAGothic）
- まばたきの間隔は決定論的な乱数で決まります（`export.py --seed` で変えられます）
- ブラウザが見つからないときは `CHROMIUM_PATH=/path/to/chrome` で指定できます

### 5. Web で動かす（なるみスタジオ）

```bash
python tools/serve.py        # → http://127.0.0.1:8765/studio.html
```

Live2D のパラメーター盤のように、角度 X/Y/Z・目の開き・目玉 X/Y・眉・口の開きと形（あいうえお）・髪の揺れをつまみで動かせます。

- 表情ボタン（通常・笑顔・ジト目・驚き・目を閉じる）、絵をドラッグして顔の向き、「マウスを見る」で顔と目がカーソルを追う
- 「バストアップ／全身」で絵を切り替え（`studio.html#full` で `player/assets_full`）。全身では「体の角度」も動かせる
- 「デモを再生」：サンプルの声を、台本どおりの表情（`timeline.json`）と前もって作った口の動き（`lips.json`）で通しで動かす
- 声で口パク：サンプルの声（`player/assets/voice.wav`）・音声ファイル・マイク（声の大きさ＝口の開き、ひびき＝あいうえお）
- 自動の動き（まばたき・首のゆれ・呼吸・視線・髪のゆれ）の入り切り、画像の保存と録画（声つき webm）
- 外から動かすときは `window.TP`（`TP.manual = true` にして `TP.params` を変え、`TP.render(t)`）

### 6. 確認する

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
| `head` | 顔の向き（Live2D 風）。奥行き＝頭全体の丸み（`hair` の楕円）＋顔のふくらみ（`face` の楕円）＋鼻の高まり（`nose`＝(x, y, 半径)）を `depth`＝[頭, 顔, 鼻] の割合で足したもの。`face`＝顔の楕円 (cx, cy, rx, ry)、`hair`＝髪全体の楕円、`yaw_px`/`pitch_px`＝左右・上下のずれ（奥行き 1 の所、画素）、`roll_deg`＝傾き（度）、`hair_front`＝顔の外の髪の手前さ、`back`＝後ろの奥さ、`brow_px`＝眉の上げ下げ、`breath_px`＝呼吸の肩の上下、`gaze_px`＝視線（黒目のずれ） |

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
          studio.html, studio.js       なるみスタジオ（つまみ・マウス・声で動かす）
tools/    build_layers.py              描き分け → 層
          make_variants_local.py       画像編集 AI を使わずに描き分けを作る
          tts_voice.py                 台本 → 試し用の声・表情・字幕
          audio_lips.py                声 → 口の開きと形（LPC フォルマント）
          export.py                    1 コマずつ描いて mp4（--alpha で透明 PNG）
          make_video.py                声 → 動画まで一括
          preview.py                   時刻・状態を指定して描いて確認
          check_variants.py            描き分けが局所編集かを検品
          serve.py                     player/ を配る小さなサーバー
prompts/  make_keys.sh, *.txt          画像編集 AI への指示文
gen/      config.example.json          絵ごとの設定の例（自分の絵と描き分けはここに置く。git には入れない）
          config.local.example.json    コードで描き分けを作るときの設定の例
docs/     timeline.example.json        表情のタイムラインの例
demo/     narumi_script.json           台本の例
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
