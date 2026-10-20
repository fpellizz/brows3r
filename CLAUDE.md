# brows3r

Cross-platform S3-compatible object storage browser.

## Stack

- **Backend:** Rust + Tauri v2 + aws-sdk-s3 + tokio + SQLite
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS 4 + Zustand, styled with the Decisyon Design System (see below)
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

Without pnpm (only node/npm installed, `node_modules` already populated):
override `beforeDevCommand` (`pnpm dev` in `tauri.conf.json`) and call the
local binaries directly.

```bash
node_modules/.bin/tauri dev -c '{"build":{"beforeDevCommand":"npm run dev"}}'
node_modules/.bin/biome check src/ && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run
```

If cargo fails with `Permission denied` on `src-tauri/target/debug/.cargo-build-lock`,
an old Docker build left root-owned files in `target/`:
`sudo chown -R $USER: src-tauri/target`.

## UI — Decisyon Design System

Same DS as the sibling project Dialga (`~/GIT/dialga/web`), applied on top of Tailwind:

- `src/styles/ds-tokens.css` — verbatim copy of Dialga's DS tokens. Do not edit: refresh from Dialga/the DS. Excluded from biome.
- `src/styles/globals.css` — maps Tailwind palettes onto the DS: `zinc-*` → DS neutrals, `brand-*` → DS primary green (`#5b8210`). Existing `zinc`/`brand` utilities therefore follow the DS; use `bg-(--token)` / `text-(--token)` for semantic tokens (`--background`, `--border`, `--muted-foreground`, `--pane`, `--pane-accent`, `--sidebar`, `--primary`, …).
- Form controls (`.input-field`, `.select-field`, `.number-field`) live in `@layer components`, so utilities still override them. 32px height, 3:1 `--control-border`, 2px `--ring` focus.
- Dark mode: `src/lib/theme.ts` sets both the `.dark` class (Tailwind `dark:`) and `data-theme` (DS dark tokens) — keep them in step.
- Patterns: 32px buttons (`h-8 px-3 text-sm font-medium rounded-md`), dialogs `rounded-xl border border-(--border) shadow-xl` on a `bg-black/45` overlay, sentence-case table headers, eyebrows `text-[11px] uppercase tracking-[0.14em]`, flat cards (no gradients).
- Keep the brows3r app icon (`public/icon.svg`); Dialga's Decisyon mark is not used.
- Geist is not bundled (same as Dialga): the stack falls back to the bundled Inter Variable.

## Build & Distribution

```bash
# Build Linux packages (default: deb + rpm + appimage)
./scripts/build-linux.sh
./scripts/build-linux.sh -b deb      # solo .deb
./scripts/build-linux.sh --docker    # AppImage portabile (build su Ubuntu 22.04)

# Equivalente manuale
pnpm tauri build

# Build Windows (from Windows machine)
scripts\build-windows.bat
```

Packages output: `src-tauri/target/release/bundle/`

CI/CD (see `bitbucket-pipelines.yml` and `TECH_STACK.md` §5.3):

| Trigger | Bitbucket Pipelines | GitHub (`github.com/fpellizz/brows3r`) |
|---|---|---|
| Push to `main` | lint + typecheck + test, fmt + clippy + test, then mirror `main` + all tags | `.github/workflows/build.yml` builds |
| Tag `v*` | same checks, then push the tag | signed Linux + Windows bundles, GitHub Release + `latest.json` (auto-updater feed) |
| Pull request | lint + test only | — |

The mirror needs the secured repo variable `GITHUB_TOKEN`; if it expires the mirror step fails with `Invalid username or token` and GitHub falls behind (re-run the `main` pipeline after renewing it).

Release: bump the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json` (`chore: bump version to X.Y.Z`), merge, then annotated tag `vX.Y.Z` on `main`.

## Project structure

- `src-tauri/` — Rust backend (commands, S3 layer, transfer engine, store)
- `src/` — React frontend (components, stores, hooks, locales)
- `scripts/` — Dev and install scripts
- `FUNCTIONAL_SPECS.md` — Functional specifications
- `TECH_STACK.md` — Technology stack documentation
