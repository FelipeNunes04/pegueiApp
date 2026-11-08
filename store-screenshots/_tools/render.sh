#!/bin/bash
# Renders store marketing images from raw app screenshots with headless Chrome.
# (Same recipe as PescaCerta's store-screenshots/_tools/render.sh, Peguei brand.)
# Usage: render.sh <W> <H> <outdir> [rawdir] [only-slide-number]
#   rawdir defaults to ../raw (iPhone captures). Use ../raw-ipad for iPad.
# Shortcut: render.sh all   -> renders every App Store / Google Play target
#   plus the Google Play feature graphic into ../app-store-* and ../google-play.
set -euo pipefail
TOOLS="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Chrome screenshots are normally opaque; strip alpha anyway (App Store rejects it).
no_alpha() {
  if sips -g hasAlpha "$1" | grep -q 'hasAlpha: yes'; then
    sips -s format jpeg -s formatOptions 100 "$1" --out "$1.jpg" >/dev/null
    sips -s format png "$1.jpg" --out "$1" >/dev/null && rm -f "$1.jpg"
  fi
}

if [ "${1:-}" = "all" ]; then
  SS="$TOOLS/.."
  "$0" 1320 2868 "$SS/app-store-iphone-6.9"
  "$0" 1206 2622 "$SS/app-store-iphone-6.3"
  "$0" 2064 2752 "$SS/app-store-ipad-13" "$SS/raw-ipad"
  "$0" 1080 2160 "$SS/google-play"
  mkdir -p "$SS/google-play/feature"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --allow-file-access-from-files --virtual-time-budget=3000 \
    --window-size=1024,500 --screenshot="$SS/google-play/feature/feature-graphic-1024x500.png" \
    "file://$TOOLS/feature.html" >/dev/null 2>&1
  no_alpha "$SS/google-play/feature/feature-graphic-1024x500.png"
  echo "ok $SS/google-play/feature/feature-graphic-1024x500.png"
  exit 0
fi

W=$1; H=$2; OUT=$3
RAW="${4:-$TOOLS/../raw}"; RAW="$(cd "$RAW" && pwd)"
ONLY=${5:-}
FONT=$TOOLS/fonts
WORK="${TMPDIR:-/tmp}/peguei-render"; mkdir -p "$WORK" "$OUT"

# slide|raw file|headline (accent in [])|subline
SLIDES=(
  "1|01-onboarding|O momento [já foi salvo]|O Peguei grava sem parar e guarda só os últimos segundos"
  "2|03-camera|O [antes] vem junto|Toque pra gravar: o clipe já inclui os segundos anteriores"
  "3|04-settings|Ajuste [do seu jeito]|Buffer de 15 a 60 s, até 4K e modo bolso pra poupar bateria"
  "4|05-gallery|Reveja e [compartilhe]|Seus clipes ficam na galeria do app, prontos pra enviar"
  "5|06-tips|Aproveite [ao máximo]|Dicas de bateria, armazenamento e uso no dia a dia"
  "6|02-permissions|Tudo fica [no aparelho]|Gravação local. Cada permissão é explicada antes de pedir"
)

# Raw screenshot aspect ratio (width/height) from the first slide's capture.
RW=$(sips -g pixelWidth "$RAW/01-onboarding.png" | awk '/pixelWidth/{print $2}')
RH=$(sips -g pixelHeight "$RAW/01-onboarding.png" | awk '/pixelHeight/{print $2}')

# Layout scales with canvas width (designed at 1320 wide).
S=$(echo "scale=4; $W/1320" | bc)
px() { printf '%.0f' "$(echo "$1*$S" | bc)"; }
HEAD=$(px 100); SUB=$(px 46); TOP=$(px 190); GAP=$(px 28); BEZEL=$(px 16)
TEXT_BLOCK=$(px 560)
AVAIL_H=$(( H - TEXT_BLOCK - $(px 40) ))
DEV_W=$(printf '%.0f' "$(echo "$AVAIL_H*$RW/$RH" | bc -l)")
MAX_W=$(printf '%.0f' "$(echo "$W*0.76" | bc -l)")
if [ "$DEV_W" -gt "$MAX_W" ]; then DEV_W=$MAX_W; fi
# Tablets: bigger device anchored under the text and cropped at the bottom edge,
# so the app UI stays legible. Phones: whole device anchored to the bottom.
DEV_POS="bottom:$(px 40)px"
if [ $(( RW * 100 / RH )) -gt 60 ]; then
  DEV_W=$(( W * 84 / 100 )); RADIUS=$(( DEV_W * 4 / 100 )); DEV_POS="top:$(( TEXT_BLOCK - $(px 40) ))px"
else
  RADIUS=$(( DEV_W * 96 / 1000 ))
fi

for row in "${SLIDES[@]}"; do
  IFS='|' read -r n raw head sub <<<"$row"
  [ -n "$ONLY" ] && [ "$ONLY" != "$n" ] && continue
  if [ ! -f "$RAW/$raw.png" ]; then echo "skip $n: missing $RAW/$raw.png" >&2; continue; fi
  headhtml=$(printf '%s' "$head" | sed -E 's#\[([^]]+)\]#<span class="a">\1</span>#')
  cat > "$WORK/slide.html" <<EOF
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;font-weight:400;src:url("file://$FONT/Inter_400Regular.ttf")}
@font-face{font-family:Inter;font-weight:800;src:url("file://$FONT/Inter_800ExtraBold.ttf")}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
body{font-family:Inter,-apple-system,sans-serif;color:#fff;
  background:radial-gradient(120% 60% at 50% 0%,#0B4F4F 0%,#0A2E2E 50%,#0A1414 100%);
  display:flex;flex-direction:column;align-items:center}
h1{margin:${TOP}px $(px 90)px 0;font-weight:800;font-size:${HEAD}px;line-height:1.08;
  letter-spacing:-0.02em;text-align:center;text-wrap:balance}
.a{color:#F5A623}
p{margin:${GAP}px $(px 110)px 0;font-size:${SUB}px;line-height:1.3;color:#cfdedc;text-align:center;text-wrap:balance}
.dev{position:absolute;${DEV_POS};left:50%;transform:translateX(-50%);
  width:${DEV_W}px;border-radius:${RADIUS}px;padding:${BEZEL}px;background:#050a0a;
  box-shadow:0 $(px 40)px $(px 120)px rgba(0,0,0,.55),0 0 0 $(px 3)px rgba(255,255,255,.08)}
.dev img{display:block;width:100%;border-radius:$((RADIUS-BEZEL))px}
</style></head><body>
<h1>$headhtml</h1><p>$sub</p>
<div class="dev"><img src="file://$RAW/$raw.png"></div>
</body></html>
EOF
  name="$(printf '%02d' "$n")-${raw#*-}.png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --allow-file-access-from-files --virtual-time-budget=3000 \
    --window-size="$W,$H" --screenshot="$OUT/$name" \
    "file://$WORK/slide.html" >/dev/null 2>&1
  no_alpha "$OUT/$name"
  echo "ok $OUT/$name"
done
