# brows3r

Cross-platform S3-compatible object storage browser.

## Stack

- **Backend:** Rust + Tauri v2 + aws-sdk-s3 + tokio + SQLite
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS 4 + Zustand
- **Testing:** MinIO via Docker Compose

## Development

```bash
# Install prerequisites (Ubuntu/Fedora)
./scripts/install-prerequisites.sh

# Start MinIO + app
./scripts/dev-test.sh

# Or manually:
docker compose up -d
pnpm install
pnpm tauri dev
```

## Project structure

- `src-tauri/` — Rust backend (commands, S3 layer, transfer engine, store)
- `src/` — React frontend (components, stores, hooks, locales)
- `scripts/` — Dev and install scripts
- `FUNCTIONAL_SPECS.md` — Functional specifications
- `TECH_STACK.md` — Technology stack documentation
