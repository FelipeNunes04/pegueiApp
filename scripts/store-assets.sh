#!/bin/bash
# Regenera as imagens e vídeos das lojas a partir do app rodando no simulador.
#
#   scripts/store-assets.sh            # tudo: footage, build, capture, frame, video, marketing, validate
#   scripts/store-assets.sh <passo>... # só os passos pedidos, na ordem dada
#
# Passos:
#   footage    placeholders de vídeo/foto de pescaria (se não houver material real)
#   build      build Debug do app para simulador (Xcode 26, ver CLAUDE.md global)
#   capture    abre o app em modo demo (-pegueiDemo) e captura as telas cruas
#   frame      monta as artes finais (moldura + título) nos tamanhos das lojas
#   video      grava e monta os vídeos de preview (App Store e YouTube/Play)
#   marketing  posts, stories, one-pager PDF, media kit e site/ (marketing-assets.mjs, build-site.mjs)
#   validate   confere os limites de caractere dos textos das lojas
#
# Nada aqui envia arquivo para loja nenhuma. Upload: ver marketing/README.md.
#
# Variáveis opcionais: PEGUEI_METRO_PORT (8097), PEGUEI_SIM_PHONE / PEGUEI_SIM_IPAD
# (UDID de simuladores iOS 26.5), DEVELOPER_DIR (Xcode 26.5).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M="$ROOT/marketing"
TPL="$M/templates"
RAW="$M/screenshots/raw"
FOOT="$M/footage"
OUTV="$M/video"
FL="$ROOT/fastlane"
WORK="${TMPDIR:-/tmp}/peguei-store-assets"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BUNDLE=com.felipenunes.pegueiapp
PORT="${PEGUEI_METRO_PORT:-8097}"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Volumes/DevSSD/Applications/Xcode-26.5.0.app/Contents/Developer}"
APP="$ROOT/ios/build/StoreAssets/Build/Products/Debug-iphonesimulator/Peguei.app"
RUNTIME=com.apple.CoreSimulator.SimRuntime.iOS-26-5
mkdir -p "$WORK"

log() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }

# render <W> <H> <out.png> <url> [transparent]
render() {
  local bg=()
  [ "${5:-}" = transparent ] && bg=(--default-background-color=00000000)
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --allow-file-access-from-files --virtual-time-budget=5000 ${bg[@]+"${bg[@]}"} \
    --window-size="$1,$2" --screenshot="$3" "$4" >/dev/null 2>&1
  [ -s "$3" ] || { echo "render falhou: $3" >&2; exit 1; }
}

# App Store recusa PNG com canal alfa.
no_alpha() {
  if sips -g hasAlpha "$1" | grep -q 'hasAlpha: yes'; then
    sips -s format jpeg -s formatOptions 100 "$1" --out "$1.jpg" >/dev/null
    sips -s format png "$1.jpg" --out "$1" >/dev/null && rm -f "$1.jpg"
  fi
}

urlenc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }

# Material real tem prioridade sobre o placeholder (scripts/swap-footage.sh).
frame_src() { [ -f "$FOOT/frame.jpg" ] && echo "$FOOT/frame.jpg" || echo "$FOOT/placeholder/frame.png"; }
clip_src() { [ -f "$FOOT/pescaria.mp4" ] && echo "$FOOT/pescaria.mp4" || echo "$FOOT/placeholder/pescaria.mp4"; }
music_src() { for f in "$FOOT"/trilha.{m4a,mp3,wav,aac}; do [ -f "$f" ] && { echo "$f"; return; }; done; echo ""; }

# ---------------------------------------------------------------- footage
step_footage() {
  log "placeholders de pescaria em $FOOT/placeholder"
  mkdir -p "$FOOT/placeholder"
  render 1320 2868 "$FOOT/placeholder/frame.png" "file://$TPL/footage-placeholder.html?compact=1"
  # Clipe de 12 s: espera, fisgada (antes do toque), toque, peixe. Mostra o que o
  # clipe salvo pelo Peguei contém: os segundos de ANTES do toque.
  local steps=("0 a 3 s: esperando" "3 a 6 s: a fisgada (antes do toque)" "6 s: toque na tela" "6 a 12 s: peixe na mão")
  local i=0 list="$WORK/footage.txt"; : >"$list"
  for s in "${steps[@]}"; do
    i=$((i + 1))
    render 1080 1920 "$WORK/foot-$i.png" "file://$TPL/footage-placeholder.html?step=$(urlenc "$s")"
    local d=3; [ $i -eq 4 ] && d=3
    printf "file '%s'\nduration %s\n" "$WORK/foot-$i.png" "$d" >>"$list"
  done
  printf "file '%s'\n" "$WORK/foot-4.png" >>"$list"
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$list" \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 -shortest \
    -vf "fps=30,format=yuv420p" -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k \
    -t 12 "$FOOT/placeholder/pescaria.mp4"
  echo "ok $FOOT/placeholder/{frame.png,pescaria.mp4}"
}

# ---------------------------------------------------------------- build
step_build() {
  log "build Debug para simulador com $(xcodebuild -version | head -1)"
  xcodebuild -workspace "$ROOT/ios/Peguei.xcworkspace" -scheme Peguei -configuration Debug \
    -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$ROOT/ios/build/StoreAssets" build -quiet
  echo "ok $APP"
}

# ---------------------------------------------------------------- simulator helpers
sim_for() { # sim_for <name> <device type>
  local udid
  udid=$(xcrun simctl list devices available | grep -F "$1 (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/' || true)
  [ -n "$udid" ] || udid=$(xcrun simctl create "$1" "$2" "$RUNTIME")
  echo "$udid"
}

ensure_metro() {
  if ! curl -s "http://localhost:$PORT/status" | grep -q running; then
    log "Metro na porta $PORT"
    (cd "$ROOT" && nohup npx react-native start --port "$PORT" >"$WORK/metro.log" 2>&1 &)
    for _ in $(seq 60); do curl -s "http://localhost:$PORT/status" | grep -q running && break; sleep 1; done
  fi
}

prepare_sim() { # prepare_sim <udid>
  local u=$1
  xcrun simctl boot "$u" 2>/dev/null || true
  xcrun simctl bootstatus "$u" -b >/dev/null
  # Simulador em pt-BR (data da barra de status no iPad, textos do sistema).
  if ! xcrun simctl spawn "$u" defaults read -g AppleLocale 2>/dev/null | grep -q pt_BR; then
    xcrun simctl spawn "$u" defaults write -g AppleLanguages -array pt-BR
    xcrun simctl spawn "$u" defaults write -g AppleLocale pt_BR
    xcrun simctl shutdown "$u"; xcrun simctl boot "$u"; xcrun simctl bootstatus "$u" -b >/dev/null
  fi
  xcrun simctl status_bar "$u" override --time 9:41 --batteryState charged --batteryLevel 100 \
    --cellularMode active --cellularBars 4 --wifiBars 3 --dataNetwork wifi
  xcrun simctl install "$u" "$APP"
  xcrun simctl privacy "$u" grant camera "$BUNDLE" 2>/dev/null || true
  xcrun simctl privacy "$u" grant microphone "$BUNDLE" 2>/dev/null || true
  local data; data=$(xcrun simctl get_app_container "$u" "$BUNDLE" data)
  mkdir -p "$data/Documents/demo" "$data/Documents/PegueiClips"
  rm -f "$data/Documents/PegueiClips"/clip_*.mp4
  sips -s format jpeg "$(frame_src)" --out "$data/Documents/demo/frame.jpg" >/dev/null
  # Nome no formato de encodeClipFilename (src/shared/utils/files.ts): duração no nome.
  local ms; ms=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$(clip_src)" | awk '{printf "%d", $1*1000}')
  cp "$(clip_src)" "$data/Documents/PegueiClips/clip_$(($(date +%s) * 1000))_d$ms.mp4"
}

launch_scene() { # launch_scene <udid> <scene>
  xcrun simctl terminate "$1" "$BUNDLE" 2>/dev/null || true
  xcrun simctl launch "$1" "$BUNDLE" -RCT_jsLocation "localhost:$PORT" -pegueiDemo 1 -demoScene "$2" >/dev/null
}

# ---------------------------------------------------------------- capture
# n|cena|espera (s)
SCENES=("01|buffering|7" "02|recording|8" "03|settings|8" "04|wide|7" "05|export|10")

capture_device() { # capture_device <udid> <outdir>
  local u=$1 out=$2; mkdir -p "$out"
  prepare_sim "$u"
  launch_scene "$u" buffering; sleep 15 # primeira carga do bundle
  for row in "${SCENES[@]}"; do
    IFS='|' read -r n scene wait <<<"$row"
    launch_scene "$u" "$scene"; sleep "$wait"
    xcrun simctl io "$u" screenshot "$out/$n-$scene.png" >/dev/null 2>&1
    echo "ok $out/$n-$scene.png"
  done
  xcrun simctl terminate "$u" "$BUNDLE" 2>/dev/null || true
}

step_capture() {
  [ -d "$APP" ] || step_build
  ensure_metro
  local phone ipad
  phone="${PEGUEI_SIM_PHONE:-$(sim_for 'Peguei Shots 6.9' 'iPhone 17 Pro Max')}"
  ipad="${PEGUEI_SIM_IPAD:-$(sim_for 'Peguei Shots iPad 13' 'iPad Pro 13-inch (M5)')}"
  log "capturas iPhone 6,9\" ($phone)"
  capture_device "$phone" "$RAW/iphone-6.9"
  log "capturas iPad 13\" ($ipad)"
  capture_device "$ipad" "$RAW/ipad-13"
  xcrun simctl shutdown "$ipad" 2>/dev/null || true
}

# ---------------------------------------------------------------- frame
# n|cena|título ([destaque])|linha de apoio
CAPTIONS=(
  "01|buffering|Nunca mais perca a [fisgada]|O Peguei fica gravando e guarda só os últimos segundos"
  "02|recording|Grava os segundos [antes] de você tocar|Tocou na tela: o clipe já começa antes do toque"
  "03|settings|Até [60 segundos] de buffer|Escolha de 15 a 60 s e a qualidade do vídeo"
  "04|wide|Lente [0,5x] para pegar a cena toda|Nos celulares com câmera ultra-angular"
  "05|export|Pronto para [Reels e TikTok]|Exporta em 9:16 com espécie e peso no vídeo"
)

frame_set() { # frame_set <W> <H> <rawdir> <outdir> <prefix> [android]
  local W=$1 H=$2 raw=$3 out=$4 prefix=$5 android=${6:-}
  mkdir -p "$out"
  for row in "${CAPTIONS[@]}"; do
    IFS='|' read -r n scene title sub <<<"$row"
    local src="$raw/$n-$scene.png"
    [ -f "$src" ] || { echo "falta $src (rode o passo capture)" >&2; exit 1; }
    local island=1 dst
    if [ -n "$android" ]; then
      # Corta a barra de status do iOS: no Android a moldura não tem ilha.
      ffmpeg -y -loglevel error -i "$src" -vf "crop=iw:ih-170:0:170" "$WORK/a.png"
      src="$WORK/a.png"; island=0; dst="$out/$((10#$n)).png"
    else
      dst="$out/${n}_${prefix}_${scene}.png"
    fi
    render "$W" "$H" "$dst" "file://$TPL/screenshot.html?img=$(urlenc "file://$src")&title=$(urlenc "$title")&sub=$(urlenc "$sub")&island=$island"
    no_alpha "$dst"
    echo "ok $dst"
  done
}

step_frame() {
  log "artes finais"
  frame_set 1320 2868 "$RAW/iphone-6.9" "$FL/screenshots/pt-BR" iphone69
  frame_set 2064 2752 "$RAW/ipad-13" "$FL/screenshots/pt-BR" ipad13
  frame_set 1080 1920 "$RAW/iphone-6.9" "$FL/metadata/android/pt-BR/images/phoneScreenshots" play android
  local img="$FL/metadata/android/pt-BR/images"
  render 1024 500 "$img/featureGraphic.png" "file://$TPL/feature-graphic.html"
  no_alpha "$img/featureGraphic.png"
  sips -z 512 512 "$TPL/icon-1024.png" --out "$img/icon.png" >/dev/null
  echo "ok $img/featureGraphic.png $img/icon.png"
}

# ---------------------------------------------------------------- video
# Linha do tempo da cena "story" (src/demo/useDemoCircularBuffer.ts): toque aos 6 s,
# para aos 10 s, aviso de salvo aos 11,2 s, contados da montagem da câmera.
record_scene() { # record_scene <udid> <scene> <seconds> <out.mov>
  xcrun simctl terminate "$1" "$BUNDLE" 2>/dev/null || true
  xcrun simctl io "$1" recordVideo --codec=h264 --force "$4" >/dev/null 2>&1 &
  local rec=$!
  sleep 1.5
  launch_scene "$1" "$2"
  sleep "$3"
  kill -INT $rec; wait $rec 2>/dev/null || true
}

# Primeiro instante em que a câmera demo aparece: o botão de gravar (vermelho #E5484D)
# no centro, a 90,4% da altura. Antes disso é a tela inicial e o carregamento do bundle.
scene_start() { # scene_start <mov>
  ffmpeg -loglevel error -i "$1" -vf "fps=10,crop=40:40:iw/2-20:ih*0.904-20,scale=1:1,format=rgb24" -f rawvideo - |
    od -An -tu1 -v | tr -s ' ' '\n' | awk 'NF' | paste - - - |
    awk '{ if ($1>170 && $2<120) { printf "%.1f", (NR-1)/10 + 0.2; exit } }'
}

caption_png() { # caption_png <out> <text> [pos] [tap]
  render 886 1920 "$1" "file://$TPL/caption.html?text=$(urlenc "$2")&pos=${3:-top}&tap=${4:-}" transparent
}

step_video() {
  [ -d "$APP" ] || step_build
  ensure_metro
  local u; u="${PEGUEI_SIM_PHONE:-$(sim_for 'Peguei Shots 6.9' 'iPhone 17 Pro Max')}"
  log "gravando as cenas no simulador ($u)"
  prepare_sim "$u"
  launch_scene "$u" buffering; sleep 15
  record_scene "$u" story 17 "$WORK/story.mov"
  record_scene "$u" clip 20 "$WORK/clip.mov"
  xcrun simctl terminate "$u" "$BUNDLE" 2>/dev/null || true

  local s0 c0
  s0=$(scene_start "$WORK/story.mov"); c0=$(scene_start "$WORK/clip.mov")
  # A cena clip abre Galeria e depois o clipe (~2 s); começa quando o player já está na tela.
  c0=$(echo "$c0 + 2.2" | bc)
  echo "story começa em ${s0}s, clip em ${c0}s"

  log "legendas"
  caption_png "$WORK/c1.png" "Esperando a [fisgada]…" bottom
  caption_png "$WORK/c2.png" "Fisgou? [Toque na tela]" top "50,86.5"
  caption_png "$WORK/c3.png" "Salvo com os [segundos de antes]" bottom
  caption_png "$WORK/c4.png" "O clipe já tem a fisgada que veio [antes do toque]"
  render 886 1920 "$WORK/end-ios.png" "file://$TPL/endcard.html?cta=$(urlenc 'Grátis e sem assinatura')"
  render 1080 1920 "$WORK/end-play.png" "file://$TPL/endcard.html?cta=$(urlenc 'Baixe grátis no Android e no iPhone')"

  mkdir -p "$OUTV"
  local music; music=$(music_src)
  local audio_in=(-f lavfi -t 28 -i anullsrc=channel_layout=stereo:sample_rate=48000)
  [ -n "$music" ] && audio_in=(-t 28 -i "$music")
  # 886x1920, 30 fps, H.264 High 4.0, ~10 Mb/s, AAC estéreo 256 kb/s: spec da Apple para 6,9".
  # 0-12 s: espera + toque + salvo | 12-24,5 s: o clipe salvo tocando no app | 24,5-28 s: cartão final.
  ffmpeg -y -loglevel error \
    -ss "$s0" -t 12.5 -i "$WORK/story.mov" \
    -ss "$c0" -t 12 -i "$WORK/clip.mov" \
    -loop 1 -t 3.5 -i "$WORK/end-ios.png" \
    -i "$WORK/c1.png" -i "$WORK/c2.png" -i "$WORK/c3.png" -i "$WORK/c4.png" \
    "${audio_in[@]}" \
    -filter_complex "
      [0:v]fps=30,scale=886:-2,crop=886:1920,setsar=1,setpts=PTS-STARTPTS[a0];
      [a0][3:v]overlay=enable='between(t,0.3,5.5)'[a1];
      [a1][4:v]overlay=enable='between(t,5.6,8.4)'[a2];
      [a2][5:v]overlay=enable='between(t,10.9,12.5)'[A];
      [1:v]fps=30,scale=886:-2,crop=886:1920,setsar=1,setpts=PTS-STARTPTS[b0];
      [b0][6:v]overlay=enable='between(t,0.4,11.6)'[B];
      [2:v]fps=30,scale=886:1920,setsar=1,format=yuv420p[C];
      [A][B][C]concat=n=3:v=1:a=0,format=yuv420p[v];
      [7:a]aformat=sample_rates=48000:channel_layouts=stereo,afade=t=out:st=26.5:d=1.5[aud]" \
    -map "[v]" -map "[aud]" -t 28 -r 30 \
    -c:v libx264 -preset veryfast -profile:v high -level 4.0 -b:v 10M -maxrate 12M -bufsize 20M \
    -c:a aac -b:a 256k -ar 48000 -ac 2 -movflags +faststart \
    "$WORK/preview-ios-base.mp4"
  cp "$WORK/preview-ios-base.mp4" "$OUTV/app-preview-ios-886x1920.mp4"
  echo "ok $OUTV/app-preview-ios-886x1920.mp4"

  # Vertical 1080x1920 (YouTube Shorts, Reels, TikTok) com o cartão final da Play.
  ffmpeg -y -loglevel error -i "$WORK/preview-ios-base.mp4" -loop 1 -t 28 -i "$WORK/end-play.png" \
    -filter_complex "[0:v]scale=1080:1920,setsar=1[v0];[v0][1:v]overlay=enable='gte(t,24.5)'[v]" \
    -map "[v]" -map 0:a -c:v libx264 -preset veryfast -profile:v high -b:v 12M -maxrate 14M -bufsize 24M \
    -c:a copy -movflags +faststart -t 28 "$OUTV/preview-vertical-1080x1920.mp4"
  echo "ok $OUTV/preview-vertical-1080x1920.mp4"

  # Horizontal 1920x1080 para o YouTube (link no campo "vídeo de pré-visualização" da Play).
  render 1920 1080 "$WORK/yt-bg.png" "file://$TPL/youtube-frame.html"
  ffmpeg -y -loglevel error -loop 1 -t 28 -i "$WORK/yt-bg.png" -i "$OUTV/preview-vertical-1080x1920.mp4" \
    -filter_complex "[1:v]scale=-2:960[p];[0:v][p]overlay=x=W-w-250:y=60,format=yuv420p[v]" \
    -map "[v]" -map 1:a -r 30 -c:v libx264 -preset veryfast -profile:v high -b:v 12M -maxrate 14M -bufsize 24M \
    -c:a copy -movflags +faststart -t 28 "$OUTV/preview-youtube-1920x1080.mp4"
  echo "ok $OUTV/preview-youtube-1920x1080.mp4"
  for f in "$OUTV"/*.mp4; do
    ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,profile,width,height,r_frame_rate:format=duration -of compact=p=0 "$f"
  done
}

# ---------------------------------------------------------------- marketing / validate
step_marketing() { log "marketing"; node "$ROOT/scripts/marketing-assets.mjs"; node "$ROOT/scripts/build-site.mjs"; }
step_validate() { log "limites de texto"; node "$ROOT/scripts/validate-store-text.mjs"; }

STEPS=("$@")
[ ${#STEPS[@]} -eq 0 ] && STEPS=(footage build capture frame video marketing validate)
for s in "${STEPS[@]}"; do
  case "$s" in
    footage | build | capture | frame | video | marketing | validate) "step_$s" ;;
    *) echo "passo desconhecido: $s" >&2; exit 2 ;;
  esac
done
