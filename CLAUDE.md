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

## Build & Distribution

```bash
# Build Linux packages (.deb + .rpm + .AppImage)
pnpm tauri build

# Build Windows (from Windows machine)
scripts\build-windows.bat
```

Packages output: `src-tauri/target/release/bundle/`

CI/CD: Bitbucket Pipelines builds Linux on every push and uploads to Bitbucket Downloads on `v*` tags. See `TECH_STACK.md` section 5.3 for full details.

## Project structure

- `src-tauri/` — Rust backend (commands, S3 layer, transfer engine, store)
- `src/` — React frontend (components, stores, hooks, locales)
- `scripts/` — Dev and install scripts
- `FUNCTIONAL_SPECS.md` — Functional specifications
- `TECH_STACK.md` — Technology stack documentation
