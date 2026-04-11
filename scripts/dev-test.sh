#!/usr/bin/env bash
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${BOLD}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
step()  { echo -e "\n${CYAN}=== $1 ===${NC}\n"; }

PROJECT_DIR="$(dirname "$(dirname "$(readlink -f "$0")")")"
cd "$PROJECT_DIR"

cleanup() {
  if [ "${KEEP_MINIO:-}" != "1" ]; then
    info "Arresto MinIO..."
    docker compose down -v --remove-orphans 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --------------------------------------------------
step "1. Verifica prerequisiti"
# --------------------------------------------------

MISSING=()
command -v docker &>/dev/null        || MISSING+=("docker")
command -v docker compose &>/dev/null 2>&1 || command -v docker-compose &>/dev/null || MISSING+=("docker compose")
command -v pnpm &>/dev/null          || MISSING+=("pnpm")
command -v cargo &>/dev/null         || MISSING+=("cargo (rust)")

if [ ${#MISSING[@]} -gt 0 ]; then
  error "Prerequisiti mancanti: ${MISSING[*]}"
  error "Esegui prima: ./scripts/install-prerequisites.sh"
  exit 1
fi

ok "Tutti i prerequisiti presenti"

# --------------------------------------------------
step "2. Avvio MinIO (docker compose)"
# --------------------------------------------------

# Ferma eventuali istanze precedenti
docker compose down -v --remove-orphans 2>/dev/null || true

info "Avvio MinIO..."
docker compose up -d

info "Attesa che MinIO sia pronto..."
RETRIES=30
until docker compose exec -T minio mc ready local 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    error "MinIO non si e' avviato in tempo"
    docker compose logs minio
    exit 1
  fi
  sleep 1
done

ok "MinIO pronto su http://localhost:9000"
ok "MinIO Console su http://localhost:9001"

# Attendi che il setup crei i bucket
info "Attesa creazione bucket di test..."
sleep 3
docker compose logs minio-setup 2>/dev/null | tail -3

echo ""
ok "Bucket di test creati:"
echo "   - test-bucket  (con file di esempio)"
echo "   - photos       (vuoto)"
echo "   - backups      (vuoto)"

# --------------------------------------------------
step "3. Installazione dipendenze frontend"
# --------------------------------------------------

if [ ! -d "node_modules" ]; then
  info "Esecuzione pnpm install..."
  pnpm install
else
  ok "node_modules gia' presente"
fi

# Approva build scripts se necessario (biome, esbuild)
pnpm approve-builds 2>/dev/null || true

# --------------------------------------------------
step "4. Avvio brows3r in dev mode"
# --------------------------------------------------

echo ""
echo -e "${BOLD}==========================================${NC}"
echo -e "${BOLD}  brows3r — Ambiente di test pronto${NC}"
echo -e "${BOLD}==========================================${NC}"
echo ""
echo -e "  MinIO S3 API:    ${CYAN}http://localhost:9000${NC}"
echo -e "  MinIO Console:   ${CYAN}http://localhost:9001${NC}"
echo -e "  MinIO User:      ${BOLD}minioadmin${NC}"
echo -e "  MinIO Password:  ${BOLD}minioadmin${NC}"
echo ""
echo -e "${BOLD}  Nella GUI di brows3r:${NC}"
echo ""
echo "  1. Clicca  +  nella sidebar"
echo "  2. Seleziona provider: MinIO"
echo "  3. Compila:"
echo -e "     Name:       ${BOLD}Local MinIO${NC}"
echo -e "     Access Key: ${BOLD}minioadmin${NC}"
echo -e "     Secret Key: ${BOLD}minioadmin${NC}"
echo "  4. Clicca 'Test Connection' o 'Create'"
echo "  5. Espandi la connessione → vedrai 3 bucket"
echo "  6. Clicca su 'test-bucket' per navigare i file"
echo "  7. Prova upload, download, tasto destro, ecc."
echo ""
echo -e "  ${YELLOW}Ctrl+C per fermare tutto${NC}"
echo ""

# Avvia tauri dev (bloccante — Ctrl+C per uscire)
pnpm tauri dev
