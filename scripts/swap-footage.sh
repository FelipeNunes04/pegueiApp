#!/bin/bash
# Troca os placeholders "VÍDEO REAL DE PESCARIA AQUI" pelo material real e regenera
# screenshots, vídeos de preview e peças de marketing.
#
#   scripts/swap-footage.sh <video.mp4|mov> [foto.jpg] [trilha.m4a|mp3]
#
# video  clipe vertical da pescaria (12 a 20 s): espera, fisgada, peixe na mão.
#        Vira marketing/footage/pescaria.mp4 (1080x1920, 30 fps, H.264).
# foto   quadro que aparece no preview da câmera (vertical). Sem ela, usa o
#        quadro do segundo 1 do vídeo.
# trilha música sem direitos autorais para os previews (o fim leva fade de 1,5 s).
#
# Os arquivos reais ficam fora do git (.gitignore); só os placeholders são versionados.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FOOT="$ROOT/marketing/footage"
[ $# -ge 1 ] || { sed -n '2,13p' "$0"; exit 2; }
mkdir -p "$FOOT"
ffmpeg -y -loglevel error -i "$1" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p" \
  -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 192k -ac 2 -movflags +faststart -t 20 "$FOOT/pescaria.mp4"
if [ -n "${2:-}" ]; then
  sips -s format jpeg "$2" --out "$FOOT/frame.jpg" >/dev/null
else
  ffmpeg -y -loglevel error -ss 1 -i "$FOOT/pescaria.mp4" -frames:v 1 "$FOOT/frame.jpg"
fi
if [ -n "${3:-}" ]; then
  ext="${3##*.}"; cp "$3" "$FOOT/trilha.$ext"
fi
echo "Material real em $FOOT. Regenerando..."
"$ROOT/scripts/store-assets.sh" capture frame video marketing
