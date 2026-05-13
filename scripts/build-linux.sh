#!/usr/bin/env bash
# brows3r — Build script per Linux
#
# Compila i pacchetti distribuibili (.deb, .rpm, .AppImage) usando
# `pnpm tauri build`. Verifica i prerequisiti, installa le dipendenze
# Node se mancanti, esegue la build e stampa un riepilogo dei file
# prodotti con dimensione.
#
# Uso:
#   ./scripts/build-linux.sh                 # default: deb + rpm + appimage
#   ./scripts/build-linux.sh -b deb          # solo .deb
#   ./scripts/build-linux.sh -b deb,rpm      # subset arbitrario
#   ./scripts/build-linux.sh --docker        # build dentro Ubuntu 22.04 (AppImage portabile)
#   ./scripts/build-linux.sh --clean         # rimuove dist/ + target/release/bundle prima
#   ./scripts/build-linux.sh --skip-checks   # salta il check prerequisiti runtime
#   ./scripts/build-linux.sh --no-sign       # build senza firmare gli artefatti updater

set -euo pipefail

BUNDLES="deb,rpm,appimage"
CLEAN=0
SKIP_CHECKS=0
USE_DOCKER=0
NO_SIGN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -b|--bundles) BUNDLES="$2"; shift 2 ;;
    --clean)      CLEAN=1; shift ;;
    --skip-checks) SKIP_CHECKS=1; shift ;;
    --docker)     USE_DOCKER=1; shift ;;
    --no-sign)    NO_SIGN=1; shift ;;
    -h|--help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Argomento sconosciuto: $1" >&2; exit 2 ;;
  esac
done

if [ "$BUNDLES" = "all" ]; then
  BUNDLES="deb,rpm,appimage"
fi

# Risolve i percorsi (script_dir e project_root) per essere lanciabile
# da qualunque cwd.
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

step()  { echo -e "${BOLD}==>${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }
have()  { command -v "$1" >/dev/null 2>&1; }

# --- Modo Docker (build su Ubuntu 22.04 per AppImage portabili) -----------
# Builda su una distro più vecchia per ottenere AppImage compatibili con
# qualsiasi Linux ragionevolmente recente. Senza questo, l'AppImage
# generato sulla workstation lega `libwebkit2gtk-4.1.so.0` al glibc
# locale (es. 2.42 su Ubuntu 25) e non parte sulle macchine target con
# libc più vecchia.
if [ "$USE_DOCKER" -eq 1 ]; then
  step "Modo Docker: build dentro Ubuntu 22.04 per AppImage portabile"
  if ! have docker; then
    err "docker non trovato. Installa Docker Engine o Podman e riprova."
    exit 1
  fi

  IMAGE_TAG="brows3r-build:ubuntu22.04"
  if ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
    step "Build immagine Docker $IMAGE_TAG (richiesto solo la prima volta)"
    docker build -f "$SCRIPT_DIR/Dockerfile.build-linux" -t "$IMAGE_TAG" "$SCRIPT_DIR"
  else
    ok "Immagine Docker $IMAGE_TAG già presente"
  fi

  # Cache di pnpm/cargo dentro al workspace, in una dir gitignored, così
  # i run successivi non riscaricano tutto. UID host così i file prodotti
  # in `src-tauri/target/` sono leggibili dall'utente fuori dal container.
  CACHE_DIR="$PROJECT_DIR/.dockercache"
  mkdir -p "$CACHE_DIR"/{home,cargo,pnpm}

  # Se la chiave updater è solo su filesystem (~/.tauri/...), la
  # carichiamo qui prima di lanciare il container così possiamo passarla
  # via -e: il container vede solo /work e non l'$HOME dell'host.
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ "$NO_SIGN" -eq 0 ]; then
    KEY_FILE="${BROWS3R_UPDATER_KEY_FILE:-$HOME/.tauri/brows3r-updater.key}"
    if [ -f "$KEY_FILE" ]; then
      export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
    fi
  fi
  # Stessa logica passphrase del ramo non-docker, ma eseguita qui
  # sull'host TTY: dentro il container stdin è chiuso e un eventuale
  # prompt di Tauri muore con `os error 6 (ENXIO)`.
  if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ "$NO_SIGN" -eq 0 ] \
     && [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]; then
    if [ -n "${BROWS3R_UPDATER_KEY_PASSWORD:-}" ]; then
      export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$BROWS3R_UPDATER_KEY_PASSWORD"
    elif [ -t 0 ]; then
      read -r -s -p "Passphrase chiave updater (lascia vuota se nessuna): " TAURI_SIGNING_PRIVATE_KEY_PASSWORD
      echo
      export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    else
      err "Nessun TTY: imposta TAURI_SIGNING_PRIVATE_KEY_PASSWORD o BROWS3R_UPDATER_KEY_PASSWORD prima di --docker, oppure usa --no-sign."
      exit 1
    fi
  fi

  INNER_FLAGS=(-b "$BUNDLES" --skip-checks)
  [ "$NO_SIGN" -eq 1 ] && INNER_FLAGS+=(--no-sign)

  step "Esecuzione build dentro container (senza --docker per evitare ricorsione)"
  docker run --rm --init \
    -u "$(id -u):$(id -g)" \
    -e HOME=/work/.dockercache/home \
    -e CARGO_HOME=/work/.dockercache/cargo \
    -e RUSTUP_HOME=/opt/rust \
    -e PNPM_HOME=/work/.dockercache/pnpm \
    -e TAURI_SIGNING_PRIVATE_KEY \
    -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
    -v "$PROJECT_DIR:/work" \
    -w /work \
    "$IMAGE_TAG" \
    bash scripts/build-linux.sh "${INNER_FLAGS[@]}"
  exit 0
fi

# --- Sanity check toolchain -------------------------------------------------
require_tool() {
  local cmd="$1" hint="$2"
  if ! have "$cmd"; then
    err "comando '$cmd' non trovato. $hint"
    err "Suggerimento: lancia ./scripts/install-prerequisites.sh"
    exit 1
  fi
}

step "Verifica toolchain"
require_tool pnpm   "Servono pnpm + Node 22+."
require_tool cargo  "Serve la toolchain Rust (rustup)."
if ! cargo tauri --version >/dev/null 2>&1; then
  err "tauri-cli non installato. Esegui:  cargo install tauri-cli --locked"
  exit 1
fi
ok "pnpm  $(pnpm --version)"
ok "rustc $(rustc --version | awk '{print $2}')"
ok "tauri $(cargo tauri --version 2>/dev/null | awk '{print $2}')"

# Per generare il .rpm da una macchina Debian/Ubuntu serve `rpmbuild`
# (pacchetto `rpm`). Su Fedora/RHEL è già nel groupinstall "Development
# Tools". Se manca quando rpm è fra i bundle richiesti, fallisco subito
# con un messaggio chiaro invece di buttare via 2+ minuti di cargo build
# e ricevere un errore criptico al momento del bundling.
if [[ ",$BUNDLES," == *,rpm,* ]] && ! have rpmbuild; then
  err "rpmbuild non trovato ma è fra i bundle richiesti."
  if [ -r /etc/os-release ] && grep -qE '^ID(_LIKE)?=.*(debian|ubuntu)' /etc/os-release; then
    err "Su Debian/Ubuntu installa con:  sudo apt install -y rpm"
  else
    err "Installa il pacchetto 'rpm' (su Fedora/RHEL è in 'Development Tools')."
  fi
  err "Oppure lancia:  ./scripts/build-linux.sh -b deb,appimage"
  exit 1
fi

# `linuxdeploy-plugin-gstreamer` richiama `patchelf` per riscrivere gli
# rpath dei binari nell'AppDir. Se manca, il plugin esce con codice 2 e
# Tauri stampa il criptico "failed to run linuxdeploy" senza dare
# dettagli — fallisco subito con il fix.
if [[ ",$BUNDLES," == *,appimage,* ]] && ! have patchelf; then
  err "patchelf non trovato ma serve per impacchettare l'AppImage."
  if [ -r /etc/os-release ] && grep -qE '^ID(_LIKE)?=.*(debian|ubuntu)' /etc/os-release; then
    err "Installa con:  sudo apt install -y patchelf"
  elif [ -r /etc/os-release ] && grep -qE '^ID(_LIKE)?=.*(fedora|rhel|centos)' /etc/os-release; then
    err "Installa con:  sudo dnf install -y patchelf"
  else
    err "Installa il pacchetto 'patchelf' tramite il package manager della tua distro."
  fi
  err "Oppure lancia:  ./scripts/build-linux.sh -b deb,rpm"
  exit 1
fi

# --- Verifica prerequisiti runtime di sistema -------------------------------
if [ "$SKIP_CHECKS" -eq 0 ] && [ -x "$SCRIPT_DIR/check-system.sh" ]; then
  step "Verifica librerie runtime di sistema"
  if ! "$SCRIPT_DIR/check-system.sh"; then
    err "Mancano dipendenze runtime. Lancia: $SCRIPT_DIR/check-system.sh --install"
    exit 1
  fi
fi

# --- Pulizia opzionale -----------------------------------------------------
if [ "$CLEAN" -eq 1 ]; then
  step "Pulizia output precedenti"
  rm -rf dist src-tauri/target/release/bundle
  ok "dist/ e src-tauri/target/release/bundle/ rimossi"
fi

# --- Dipendenze Node -------------------------------------------------------
if [ ! -d node_modules ]; then
  step "Installazione dipendenze Node"
  pnpm install
fi

# --- Workaround AppImage / FUSE / Snap ------------------------------------
# Tauri scarica `linuxdeploy-x86_64.AppImage` e lo lancia per impacchettare
# l'AppImage. Due problemi comuni gestiti qui:
#
# 1. Su Ubuntu 24+ il pacchetto libfuse2 non è installato di default
#    (la distro è passata a libfuse3), quindi il mount FUSE
#    dell'AppImage di linuxdeploy fallisce con un criptico
#    "failed to run linuxdeploy". `APPIMAGE_EXTRACT_AND_RUN=1` fa
#    auto-estrarre il runtime in /tmp invece di montarsi via FUSE.
#
# 2. Se l'utente sta lanciando lo script da un terminale dentro VS Code
#    installato come Snap, l'env contiene `GTK_PATH=/snap/code/.../gtk-3.0`
#    e altre var che fanno cercare a `linuxdeploy-plugin-gtk` i moduli
#    GTK in `/snap/code/...`. Quei moduli sono compilati per la GTK di
#    Snap (libc privata) e generano una pioggia di
#    `g_module_open() failed`. Cosmetico ma rumoroso. Unsettiamo le
#    var GTK Snap-related per uno script log più pulito.
if [[ ",$BUNDLES," == *,appimage,* ]]; then
  export APPIMAGE_EXTRACT_AND_RUN=1
  unset GTK_PATH GTK_EXE_PREFIX GTK_DATA_PREFIX
  unset GDK_PIXBUF_MODULE_FILE GIO_MODULE_DIR
fi

# --- Versioni: allinea i tre campi `version` -------------------------------
# Tauri legge la versione del bundle da `tauri.conf.json`, Vite legge da
# `package.json`, cargo legge da `Cargo.toml`. Se uno dei tre è indietro
# i log mostrano una versione mista (es. "Compiling brows3r v1.5.0" mentre
# il bundle finale è 1.7.1). Cosmetico, ma confonde — segnalo qui.
APP_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo "?")"
CARGO_VERSION="$(awk -F'"' '/^version *= *"/ {print $2; exit}' src-tauri/Cargo.toml)"
TAURI_VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version" 2>/dev/null || echo "?")"
if [ "$APP_VERSION" != "$CARGO_VERSION" ] || [ "$APP_VERSION" != "$TAURI_VERSION" ]; then
  warn "Versioni disallineate (i bundle usano quella di tauri.conf.json):"
  warn "  package.json    : $APP_VERSION"
  warn "  Cargo.toml      : $CARGO_VERSION"
  warn "  tauri.conf.json : $TAURI_VERSION"
fi

# --- TAURI updater signing --------------------------------------------------
# `createUpdaterArtifacts: true` in tauri.conf.json (aggiunto con la PR
# dell'auto-updater) fa generare un .sig accanto all'AppImage; la firma
# richiede `TAURI_SIGNING_PRIVATE_KEY` in env. In CI le secret arrivano
# come repository variables; localmente lo script cerca la chiave in
# `~/.tauri/brows3r-updater.key` (o nel file indicato da
# BROWS3R_UPDATER_KEY_FILE) e — se manca la passphrase — la chiede
# interattivamente. Con `--no-sign` patcha temporaneamente la config
# per disabilitare la firma per build locali di prova.
if [ "$NO_SIGN" -eq 1 ]; then
  CONFIG="$PROJECT_DIR/src-tauri/tauri.conf.json"
  cp "$CONFIG" "$CONFIG.bak"
  trap '[ -f "$CONFIG.bak" ] && mv -f "$CONFIG.bak" "$CONFIG"' EXIT
  python3 -c "
import json
with open('$CONFIG') as f: c = json.load(f)
c.get('bundle', {}).pop('createUpdaterArtifacts', None)
with open('$CONFIG', 'w') as f: json.dump(c, f, indent=2)
"
  warn "createUpdaterArtifacts disabilitato per questa build (--no-sign)"
else
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    KEY_FILE="${BROWS3R_UPDATER_KEY_FILE:-$HOME/.tauri/brows3r-updater.key}"
    if [ -f "$KEY_FILE" ]; then
      export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
      ok "Chiave privata updater caricata da $KEY_FILE"
    fi
  fi

  if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] \
     && [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]; then
    if [ -n "${BROWS3R_UPDATER_KEY_PASSWORD:-}" ]; then
      export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$BROWS3R_UPDATER_KEY_PASSWORD"
    elif [ -t 0 ]; then
      read -r -s -p "Passphrase chiave updater (lascia vuota se nessuna): " TAURI_SIGNING_PRIVATE_KEY_PASSWORD
      echo
      export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    fi
  fi

  if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    err "Chiave privata updater non trovata."
    err "Soluzioni:"
    err "  1. Esporta TAURI_SIGNING_PRIVATE_KEY (e _PASSWORD se serve) prima di lanciare lo script"
    err "  2. Posiziona la chiave in ~/.tauri/brows3r-updater.key"
    err "     (la generi con: cargo tauri signer generate -w ~/.tauri/brows3r-updater.key)"
    err "  3. Rilancia con --no-sign per buildare bundle non firmati (no updater)"
    exit 1
  fi
fi

# --- Build -----------------------------------------------------------------
step "Build pacchetti: ${BUNDLES}  ${DIM}(versione ${APP_VERSION})${NC}"
pnpm tauri build --bundles "$BUNDLES"

# --- Riepilogo -------------------------------------------------------------
BUNDLE_DIR="src-tauri/target/release/bundle"
echo ""
step "Output prodotti"
shopt -s nullglob
declare -a PRODUCED=()
for ext in deb rpm AppImage; do
  case "$ext" in
    deb)      sub="deb" ;;
    rpm)      sub="rpm" ;;
    AppImage) sub="appimage" ;;
  esac
  for f in "$BUNDLE_DIR/$sub"/*${APP_VERSION}*.${ext} "$BUNDLE_DIR/$sub"/*${APP_VERSION}*.${ext,,}; do
    [ -f "$f" ] && PRODUCED+=("$f")
  done
done
shopt -u nullglob

if [ "${#PRODUCED[@]}" -eq 0 ]; then
  warn "Nessun file di output trovato in $BUNDLE_DIR (controlla manualmente)."
else
  for f in "${PRODUCED[@]}"; do
    size_human="$(du -h "$f" | awk '{print $1}')"
    echo -e "  ${GREEN}•${NC} $f  ${DIM}($size_human)${NC}"
  done
fi

echo ""
ok "Build completata."
