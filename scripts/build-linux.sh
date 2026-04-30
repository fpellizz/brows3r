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
#   ./scripts/build-linux.sh --clean         # rimuove dist/ + target/release/bundle prima
#   ./scripts/build-linux.sh --skip-checks   # salta il check prerequisiti runtime

set -euo pipefail

BUNDLES="deb,rpm,appimage"
CLEAN=0
SKIP_CHECKS=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -b|--bundles) BUNDLES="$2"; shift 2 ;;
    --clean)      CLEAN=1; shift ;;
    --skip-checks) SKIP_CHECKS=1; shift ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
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

# --- Build -----------------------------------------------------------------
APP_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo "?")"
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
