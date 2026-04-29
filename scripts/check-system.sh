#!/usr/bin/env bash
# brows3r — Runtime prerequisites check
#
# Verifica che le librerie native richieste dall'app (webkit2gtk, gtk3,
# glib, libsoup, ecc.) siano installate. Se mancano qualcosa e viene
# passato --install lo installa via apt/dnf. In caso contrario stampa il
# comando esatto da lanciare per la propria distribuzione.
#
# Uscita:
#   0 = tutti i prerequisiti presenti
#   1 = mancano prerequisiti (anche dopo eventuale tentativo di install)
#   2 = distribuzione non supportata / errore di rilevamento
#
# Uso:
#   ./scripts/check-system.sh                # solo verifica
#   ./scripts/check-system.sh --install      # tenta auto-install via sudo
#   ./scripts/check-system.sh --json         # output machine-readable

set -uo pipefail

MODE="check"
JSON=0
ASSUME_YES=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --install) MODE="install" ;;
    --json)    JSON=1 ;;
    -y|--yes)  ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Argomento sconosciuto: $1" >&2; exit 2 ;;
  esac
  shift
done

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

if [ "$JSON" -eq 1 ]; then
  log()   { :; }
  warn()  { :; }
  err()   { :; }
else
  log()   { echo -e "$1"; }
  warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
  err()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }
fi

# --- Rilevamento distribuzione ---------------------------------------------
DISTRO_FAMILY=""
DISTRO_ID=""
DISTRO_NAME=""

detect_distro() {
  if [ ! -r /etc/os-release ]; then
    err "/etc/os-release non leggibile: distribuzione sconosciuta"
    return 2
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  DISTRO_ID="${ID:-unknown}"
  DISTRO_NAME="${PRETTY_NAME:-$DISTRO_ID}"

  case "$DISTRO_ID" in
    ubuntu|debian|linuxmint|pop|elementary|kali|raspbian)
      DISTRO_FAMILY="debian" ;;
    fedora|rhel|centos|rocky|almalinux|ol|amzn)
      DISTRO_FAMILY="fedora" ;;
    *)
      case "${ID_LIKE:-}" in
        *debian*|*ubuntu*) DISTRO_FAMILY="debian" ;;
        *fedora*|*rhel*|*"centos"*) DISTRO_FAMILY="fedora" ;;
        *) DISTRO_FAMILY="" ;;
      esac
      ;;
  esac
}

# --- Tabella librerie richieste --------------------------------------------
# Ogni riga: <soname>|<deb_pkg>|<rpm_pkg>|<descrizione>
REQUIRED_LIBS=(
  "libwebkit2gtk-4.1.so.0|libwebkit2gtk-4.1-0|webkit2gtk4.1|WebView (WebKit2GTK 4.1)"
  "libgtk-3.so.0|libgtk-3-0|gtk3|GTK 3 widget toolkit"
  "libglib-2.0.so.0|libglib2.0-0|glib2|GLib core library"
  "libgobject-2.0.so.0|libglib2.0-0|glib2|GObject runtime"
  "libsoup-3.0.so.0|libsoup-3.0-0|libsoup3|libsoup HTTP client"
  "libjavascriptcoregtk-4.1.so.0|libjavascriptcoregtk-4.1-0|javascriptcoregtk4.1|JavaScriptCore (WebKit)"
  "librsvg-2.so.2|librsvg2-2|librsvg2|SVG rendering (icone)"
)

# Cache di ldconfig -p (più affidabile di find su /usr/lib*)
LDCONFIG_CACHE=""
build_ldconfig_cache() {
  if command -v ldconfig >/dev/null 2>&1; then
    LDCONFIG_CACHE=$(ldconfig -p 2>/dev/null || true)
  fi
}

lib_present() {
  local soname="$1"
  if [ -n "$LDCONFIG_CACHE" ] && echo "$LDCONFIG_CACHE" | grep -q "[[:space:]]${soname}[[:space:]]"; then
    return 0
  fi
  # Fallback: cerca direttamente nelle tipiche directory di sistema
  for d in /usr/lib /usr/lib64 /usr/lib/x86_64-linux-gnu /usr/lib/aarch64-linux-gnu /lib /lib64; do
    [ -e "$d/$soname" ] && return 0
  done
  return 1
}

# --- Risultati globali ------------------------------------------------------
declare -a MISSING_SONAMES=()
declare -a MISSING_PKGS_DEB=()
declare -a MISSING_PKGS_RPM=()
declare -a MISSING_DESCS=()

check_libs() {
  local row soname deb rpm desc
  for row in "${REQUIRED_LIBS[@]}"; do
    IFS='|' read -r soname deb rpm desc <<<"$row"
    if lib_present "$soname"; then
      [ "$JSON" -eq 0 ] && echo -e "  ${GREEN}OK${NC}    $soname  ${DIM}($desc)${NC}"
    else
      MISSING_SONAMES+=("$soname")
      MISSING_DESCS+=("$desc")
      # Evita duplicati nei pacchetti
      case " ${MISSING_PKGS_DEB[*]:-} " in *" $deb "*) ;; *) MISSING_PKGS_DEB+=("$deb") ;; esac
      case " ${MISSING_PKGS_RPM[*]:-} " in *" $rpm "*) ;; *) MISSING_PKGS_RPM+=("$rpm") ;; esac
      [ "$JSON" -eq 0 ] && echo -e "  ${RED}MISS${NC}  $soname  ${DIM}($desc)${NC}"
    fi
  done
}

# --- Auto-install -----------------------------------------------------------
have_sudo() { command -v sudo >/dev/null 2>&1; }

run_with_privilege() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif have_sudo; then
    sudo "$@"
  else
    err "Servono privilegi di root per installare i pacchetti, ma 'sudo' non è disponibile."
    return 1
  fi
}

apt_yes_flag() { [ "$ASSUME_YES" -eq 1 ] && echo "-y" || echo ""; }
dnf_yes_flag() { [ "$ASSUME_YES" -eq 1 ] && echo "-y" || echo ""; }

attempt_install() {
  case "$DISTRO_FAMILY" in
    debian)
      log "${BOLD}Tentativo di installazione via apt...${NC}"
      run_with_privilege apt-get update || return 1
      # shellcheck disable=SC2046
      run_with_privilege apt-get install $(apt_yes_flag) "${MISSING_PKGS_DEB[@]}" || return 1
      ;;
    fedora)
      local pm
      if command -v dnf >/dev/null 2>&1; then pm="dnf"
      elif command -v yum >/dev/null 2>&1; then pm="yum"
      else err "Né dnf né yum trovati."; return 1
      fi
      log "${BOLD}Tentativo di installazione via $pm...${NC}"
      # shellcheck disable=SC2046
      run_with_privilege "$pm" install $(dnf_yes_flag) "${MISSING_PKGS_RPM[@]}" || return 1
      ;;
    *)
      err "Auto-install non supportato per questa distribuzione."
      return 1
      ;;
  esac
}

# --- Stampa istruzioni manuali ---------------------------------------------
print_manual_instructions() {
  case "$DISTRO_FAMILY" in
    debian)
      log ""
      log "${BOLD}Installa con:${NC}"
      log "  sudo apt update && sudo apt install -y ${MISSING_PKGS_DEB[*]}"
      ;;
    fedora)
      log ""
      log "${BOLD}Installa con:${NC}"
      log "  sudo dnf install -y ${MISSING_PKGS_RPM[*]}"
      log ""
      log "${DIM}Nota: su RHEL/Rocky/Alma webkit2gtk4.1 può richiedere EPEL.${NC}"
      log "${DIM}      sudo dnf install -y epel-release${NC}"
      ;;
    *)
      log ""
      log "${BOLD}Distribuzione non riconosciuta.${NC} Pacchetti necessari (nomi indicativi):"
      log "  Debian/Ubuntu : ${MISSING_PKGS_DEB[*]}"
      log "  Fedora/RHEL   : ${MISSING_PKGS_RPM[*]}"
      log ""
      log "Cerca nel package manager della tua distro le librerie:"
      printf '  - %s\n' "${MISSING_SONAMES[@]}"
      ;;
  esac
}

# --- Output JSON ------------------------------------------------------------
json_array_from() {
  # Stampa un array JSON dal nome di una variabile array (passata per nome).
  local -n _arr="$1"
  local first=1 item
  printf '['
  if [ "${#_arr[@]}" -gt 0 ]; then
    for item in "${_arr[@]}"; do
      [ $first -eq 1 ] && first=0 || printf ','
      printf '"%s"' "$(printf '%s' "$item" | sed 's/"/\\"/g')"
    done
  fi
  printf ']'
}

emit_json() {
  local status="$1"
  printf '{'
  printf '"status":"%s",' "$status"
  printf '"distro_id":"%s",' "$DISTRO_ID"
  printf '"distro_family":"%s",' "$DISTRO_FAMILY"
  printf '"missing_sonames":%s,' "$(json_array_from MISSING_SONAMES)"
  printf '"missing_packages_deb":%s,' "$(json_array_from MISSING_PKGS_DEB)"
  printf '"missing_packages_rpm":%s' "$(json_array_from MISSING_PKGS_RPM)"
  printf '}\n'
}

# --- Main -------------------------------------------------------------------
main() {
  log ""
  log "${BOLD}brows3r — Verifica prerequisiti runtime${NC}"
  log ""

  detect_distro || true
  if [ -z "$DISTRO_FAMILY" ]; then
    warn "Distribuzione non riconosciuta: ${DISTRO_NAME:-sconosciuta}. Verifico comunque le librerie."
  else
    log "Distribuzione: ${DISTRO_NAME} ${DIM}(${DISTRO_FAMILY})${NC}"
  fi
  log ""

  build_ldconfig_cache
  check_libs

  if [ "${#MISSING_SONAMES[@]}" -eq 0 ]; then
    log ""
    log "${GREEN}Tutti i prerequisiti runtime sono presenti.${NC}"
    [ "$JSON" -eq 1 ] && emit_json "ok"
    exit 0
  fi

  log ""
  warn "Mancano ${#MISSING_SONAMES[@]} libreria/e."

  if [ "$MODE" = "install" ]; then
    if ! attempt_install; then
      err "Installazione automatica fallita."
      print_manual_instructions
      [ "$JSON" -eq 1 ] && emit_json "missing"
      exit 1
    fi

    # Verifica dopo l'installazione
    log ""
    log "${BOLD}Ri-verifica dopo l'installazione...${NC}"
    MISSING_SONAMES=(); MISSING_PKGS_DEB=(); MISSING_PKGS_RPM=(); MISSING_DESCS=()
    build_ldconfig_cache
    check_libs

    if [ "${#MISSING_SONAMES[@]}" -eq 0 ]; then
      log ""
      log "${GREEN}Tutti i prerequisiti runtime sono ora presenti.${NC}"
      [ "$JSON" -eq 1 ] && emit_json "ok"
      exit 0
    else
      err "Anche dopo l'installazione mancano alcune librerie."
      print_manual_instructions
      [ "$JSON" -eq 1 ] && emit_json "missing"
      exit 1
    fi
  else
    print_manual_instructions
    log ""
    log "${DIM}Suggerimento: rilancia con --install per tentare l'installazione automatica.${NC}"
    [ "$JSON" -eq 1 ] && emit_json "missing"
    exit 1
  fi
}

main "$@"
