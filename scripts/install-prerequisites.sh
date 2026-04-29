#!/usr/bin/env bash
set -euo pipefail

# brows3r — Installazione prerequisiti
# Supporta: Ubuntu/Debian, Fedora/RHEL/CentOS
# Uso: chmod +x scripts/install-prerequisites.sh && ./scripts/install-prerequisites.sh

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${BOLD}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

NODE_VERSION="22"
PNPM_VERSION="latest"

# --- Detect distro ---
detect_distro() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    case "$ID" in
      ubuntu|debian|linuxmint|pop)
        DISTRO_FAMILY="debian"
        ;;
      fedora|rhel|centos|rocky|alma)
        DISTRO_FAMILY="fedora"
        ;;
      *)
        if [ -n "${ID_LIKE:-}" ]; then
          case "$ID_LIKE" in
            *debian*|*ubuntu*)
              DISTRO_FAMILY="debian"
              ;;
            *fedora*|*rhel*)
              DISTRO_FAMILY="fedora"
              ;;
            *)
              error "Distribuzione non riconosciuta: $ID (ID_LIKE=$ID_LIKE)"
              error "Supportate: Ubuntu/Debian, Fedora/RHEL/CentOS e derivate"
              exit 1
              ;;
          esac
        else
          error "Distribuzione non riconosciuta: $ID"
          exit 1
        fi
        ;;
    esac
    info "Distribuzione rilevata: $PRETTY_NAME (famiglia: $DISTRO_FAMILY)"
  else
    error "Impossibile rilevare la distribuzione (/etc/os-release non trovato)"
    exit 1
  fi
}

# --- Controlla se un comando esiste ---
has_cmd() {
  command -v "$1" &>/dev/null
}

# --- Installa dipendenze di sistema ---
install_system_deps() {
  info "Installazione dipendenze di sistema per Tauri v2..."

  if [ "$DISTRO_FAMILY" = "debian" ]; then
    sudo apt update
    sudo apt install -y \
      build-essential \
      curl \
      wget \
      pkg-config \
      libssl-dev \
      libgtk-3-dev \
      libwebkit2gtk-4.1-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libglib2.0-dev \
      libsoup-3.0-dev \
      libjavascriptcoregtk-4.1-dev

  elif [ "$DISTRO_FAMILY" = "fedora" ]; then
    sudo dnf groupinstall -y "Development Tools"
    sudo dnf install -y \
      curl \
      wget \
      pkg-config \
      openssl-devel \
      gtk3-devel \
      webkit2gtk4.1-devel \
      libappindicator-gtk3-devel \
      librsvg2-devel \
      glib2-devel \
      libsoup3-devel \
      javascriptcoregtk4.1-devel
  fi

  ok "Dipendenze di sistema installate"
}

# --- Installa Rust ---
install_rust() {
  if has_cmd rustc; then
    local current_version
    current_version=$(rustc --version | awk '{print $2}')
    ok "Rust gia' installato: $current_version"
  else
    info "Installazione Rust via rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env"
    ok "Rust installato: $(rustc --version | awk '{print $2}')"
  fi

  # Assicurati che cargo sia nel PATH per il resto dello script
  export PATH="$HOME/.cargo/bin:$PATH"
}

# --- Installa Node.js via nvm ---
install_node() {
  # Carica nvm se esiste
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

  if has_cmd node; then
    local current_version
    current_version=$(node --version)
    local major=${current_version%%.*}
    major=${major#v}
    if [ "$major" -ge "$NODE_VERSION" ]; then
      ok "Node.js gia' installato: $current_version"
      return
    else
      warn "Node.js $current_version trovato, richiesta v$NODE_VERSION+"
    fi
  fi

  if ! has_cmd nvm; then
    info "Installazione nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    # shellcheck source=/dev/null
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  fi

  info "Installazione Node.js v$NODE_VERSION via nvm..."
  nvm install "$NODE_VERSION"
  nvm use "$NODE_VERSION"
  nvm alias default "$NODE_VERSION"
  ok "Node.js installato: $(node --version)"
}

# --- Installa pnpm ---
install_pnpm() {
  if has_cmd pnpm; then
    ok "pnpm gia' installato: $(pnpm --version)"
  else
    info "Installazione pnpm..."
    if has_cmd corepack; then
      corepack enable
      corepack prepare "pnpm@$PNPM_VERSION" --activate
    else
      # Fallback: install via npm
      npm install -g pnpm
    fi
    ok "pnpm installato: $(pnpm --version)"
  fi
}

# --- Installa Tauri CLI ---
install_tauri_cli() {
  if cargo install --list 2>/dev/null | grep -q "tauri-cli"; then
    ok "Tauri CLI gia' installato"
  else
    info "Installazione Tauri CLI (puo' richiedere qualche minuto)..."
    cargo install tauri-cli --locked
    ok "Tauri CLI installato"
  fi
}

# --- Riepilogo ---
print_summary() {
  echo ""
  echo -e "${BOLD}=========================================${NC}"
  echo -e "${BOLD}  brows3r — Prerequisiti installati${NC}"
  echo -e "${BOLD}=========================================${NC}"
  echo ""
  echo -e "  Rust:       $(rustc --version 2>/dev/null | awk '{print $2}' || echo 'N/A')"
  echo -e "  Cargo:      $(cargo --version 2>/dev/null | awk '{print $2}' || echo 'N/A')"
  echo -e "  Node.js:    $(node --version 2>/dev/null || echo 'N/A')"
  echo -e "  pnpm:       $(pnpm --version 2>/dev/null || echo 'N/A')"
  echo -e "  Tauri CLI:  $(cargo tauri --version 2>/dev/null || echo 'N/A')"
  echo ""
  echo -e "${BOLD}Prossimi passi:${NC}"
  echo "  cd $(dirname "$(dirname "$(readlink -f "$0")")")"
  echo "  pnpm install"
  echo "  pnpm tauri dev"
  echo ""

  if [ -z "${CARGO_HOME:-}" ] && [ -f "$HOME/.cargo/env" ]; then
    warn "Se i comandi cargo/rustc non funzionano, esegui:"
    echo "  source ~/.cargo/env"
    echo ""
  fi
}

# --- Verifica finale runtime ---
verify_runtime_prereqs() {
  local script_dir
  script_dir="$(dirname "$(readlink -f "$0")")"
  if [ -x "$script_dir/check-system.sh" ]; then
    info "Verifica prerequisiti runtime..."
    if ! "$script_dir/check-system.sh"; then
      warn "Alcuni prerequisiti runtime risultano ancora mancanti."
      warn "Segui le istruzioni stampate sopra per installarli manualmente."
      return 1
    fi
    ok "Prerequisiti runtime verificati"
  fi
}

# --- Main ---
main() {
  echo ""
  echo -e "${BOLD}brows3r — Installazione prerequisiti${NC}"
  echo ""

  detect_distro

  install_system_deps
  install_rust
  install_node
  install_pnpm
  install_tauri_cli

  print_summary

  # Sanity check: le librerie runtime sono effettivamente presenti?
  verify_runtime_prereqs || true

  # --- Installa dipendenze progetto e avvia ---
  PROJECT_DIR="$(dirname "$(dirname "$(readlink -f "$0")")")"
  info "Installazione dipendenze progetto..."
  cd "$PROJECT_DIR"
  pnpm install
  ok "Dipendenze installate"

  info "Avvio brows3r in modalita' sviluppo..."
  pnpm tauri dev
}

main "$@"
