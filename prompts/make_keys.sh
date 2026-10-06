#!/bin/bash
# 1 枚の絵（gen/src.png）から、動かすための描き分けを画像編集 AI に描かせる。
# 既定は OpenAI Codex CLI の画像編集（codex exec -i）。他のツールを使うときは prompts/*.txt の文章をそのまま貼る。
#
#   bash prompts/make_keys.sh [gen フォルダ] [段階]
#     段階 1: bald_open（髪なし）・hair_only（髪だけ、緑地）
#     段階 2: 目のキー（12/25/37/62/75/閉じ）・表情（ジト目・笑顔）・no_mouth（口なし） ※ bald_open の上に描く
#     省略すると 1 → 2 の順に両方
#   環境変数 CODEX でコマンドを変えられる（既定: codex）。1 枚 1〜4 分、同時に 4〜5 枚まで。
#   うまくいったか: python tools/check_variants.py --gen <gen フォルダ>
set -u
GEN="${1:-gen}"; STAGE="${2:-12}"
CX="${CODEX:-codex}"
P="$(cd "$(dirname "$0")" && pwd)"
cd "$GEN" || { echo "no dir: $GEN"; exit 1; }

K() { cat "$P/_common.txt" | sed "s/{IN}/$1/g"; }      # 共通の前書き（局所編集・同じ大きさ・ビット同一）
run() {  # run <出力名> <元の絵> <プロンプトファイル>
  local prompt; prompt="$(K "$2") $(cat "$P/$3") Save as $1.png in the current directory."
  "$CX" exec --skip-git-repo-check -s workspace-write -C . -i "$2" -- "$prompt" > "log_$1.txt" 2>&1
  [ -f "$1.png" ] && echo "$1 ok" || echo "$1 FAILED (see log_$1.txt)"
}

if [[ "$STAGE" == *1* ]]; then
  [ -f src.png ] || { echo "src.png がありません"; exit 1; }
  run bald_open src.png bald_open.txt &
  sleep 5
  run hair_only src.png hair_only.txt &
  wait
fi
if [[ "$STAGE" == *2* ]]; then
  [ -f bald_open.png ] || { echo "bald_open.png がありません（先に段階 1）"; exit 1; }
  for k in eye_12 eye_25 eye_37 eye_62; do run "$k" bald_open.png "$k.txt" & sleep 5; done; wait
  for k in eye_75 eye_closed eye_jito eye_smile no_mouth; do run "$k" bald_open.png "$k.txt" & sleep 5; done; wait
fi
ls -la *.png 2>/dev/null
grep -il "usage limit" log_*.txt 2>/dev/null && echo "※ 利用上限に当たった絵があります。時間をおいて同じコマンドをもう一度（できた絵は残ります）"
echo DONE
