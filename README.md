<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="brows3r logo">
</p>

<h1 align="center">brows3r</h1>

<p align="center">
  <strong>Cross-platform S3-compatible object storage browser</strong><br>
  One app to browse them all.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/platforms-Linux%20%7C%20Windows%20%7C%20macOS-brightgreen" alt="Platforms">
  <img src="https://img.shields.io/badge/license-proprietary-red" alt="License">
  <img src="https://img.shields.io/badge/rust-1.77%2B-orange" alt="Rust">
  <img src="https://img.shields.io/badge/node-22%2B-green" alt="Node">
</p>

---

## What is brows3r?

**brows3r** is a fast, lightweight desktop application for browsing and managing S3-compatible object storage across cloud providers and on-premise solutions. Built with Rust and React for native performance and modern UX.

### Supported Providers

| Cloud | On-Premise |
|-------|------------|
| Amazon S3 | MinIO |
| Google Cloud Storage | Ceph (RadosGW) |
| Azure Blob (via S3 gateway) | Dell ECS |
| Oracle Cloud (OCI) | NetApp StorageGRID |
| DigitalOcean Spaces | Seaweed FS |
| Backblaze B2 | LakeFS |
| Wasabi | Garage |
| Cloudflare R2 | Zenko CloudServer |
| Scaleway, OVH, Alibaba, Linode | ...any S3-compatible endpoint |

---

## Features

### Connection Management
- Multiple simultaneous connections with named profiles
- Provider presets (AWS, MinIO, Backblaze, R2, Wasabi, GCS, OCI, ...)
- Signature V2/V4, path-style/virtual-hosted auto-detection
- Connection testing with latency measurement
- Import connections from **AWS CLI**, **rclone**, **s3cmd**, **MinIO Client**
- Secure credential storage (OS keychain + SQLite fallback with encryption)

### Object Browsing
- Hierarchical folder-like navigation with breadcrumb
- **Editable address bar** (`s3://bucket/prefix/`) for direct navigation
- **Multiple tabs** for browsing different buckets simultaneously
- Sortable columns (name, size, date, storage class)
- Checkbox multi-selection (click, Ctrl+click, Shift+click)
- Client-side search/filter with **glob** (`*.txt`, `img*`) and **regex** (`/pattern/`) support
- Pagination with lazy loading (continuation tokens)
- Drag & drop file upload with visual drop zone

### Object Operations
- Upload (single + **parallel multipart** with configurable concurrency)
- Download with folder selection dialog
- Copy / Move / Rename via context menu (intra-bucket and cross-bucket)
- Batch delete with confirmation dialog showing file list
- Create / delete folders
- Presigned URL generation (GET/PUT, configurable expiry)
- **Metadata editing** (content-type + custom key-value pairs)

### Bucket Management
- Create / delete buckets from the sidebar
- Bucket info panel (region, versioning status)

### File Preview
- **Text** with line numbers
- **Images** (JPEG, PNG, GIF, WebP, SVG, BMP, ICO)
- **Markdown** with formatted rendering (headings, lists, code blocks, links)
- **PDF** via embedded viewer
- **Video** (MP4, WebM) with HTML5 player
- **Audio** (MP3, OGG, WAV, FLAC) with HTML5 player

### Transfer Engine
- Concurrent transfer queue with pause/resume/cancel
- **Parallel multipart upload** (configurable part count, default 4)
- Progress tracking with speed and ETA
- Automatic multipart threshold (default 100 MB)
- Configurable bandwidth limits

### Settings
- Light / Dark / System theme with instant switching
- Language: English / Italiano
- Transfer tuning (concurrency, part size, multipart threshold, bandwidth)
- Log level configuration

---

## Screenshots

> _Coming soon_

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Rust + Tauri v2 + aws-sdk-s3 + tokio |
| **Frontend** | React 19 + TypeScript + Vite + Tailwind CSS 4 |
| **State** | Zustand (per-tab state management) |
| **UI Components** | Radix UI + Lucide icons + Allotment (split panes) |
| **Storage** | SQLite (rusqlite) + OS keychain (keyring-rs) |
| **Preview** | react-markdown + HTML5 video/audio + iframe (PDF) |
| **i18n** | i18next + react-i18next |

Bundle size: **~15 MB** | RAM idle: **~60 MB**

---

## Getting Started

### Prerequisites

The automated setup script detects your distro and installs everything:

```bash
./scripts/install-prerequisites.sh    # Ubuntu/Debian, Fedora/RHEL/CentOS
```

Or install manually per distro:

<details>
<summary><strong>Ubuntu / Debian / Linux Mint / Pop!_OS</strong></summary>

```bash
sudo apt update
sudo apt install -y build-essential curl wget pkg-config \
  libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev \
  libglib2.0-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev

# Per generare pacchetti .rpm da Debian (opzionale)
sudo apt install -y rpm
```
</details>

<details>
<summary><strong>Fedora 38+</strong></summary>

```bash
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y curl wget pkg-config \
  openssl-devel gtk3-devel webkit2gtk4.1-devel \
  libappindicator-gtk3-devel librsvg2-devel \
  glib2-devel libsoup3-devel javascriptcoregtk4.1-devel
```
</details>

<details>
<summary><strong>RHEL 9 / CentOS Stream 9 / Rocky Linux 9 / AlmaLinux 9</strong></summary>

```bash
# Abilita EPEL e CRB (necessari per alcune dipendenze)
sudo dnf install -y epel-release
sudo dnf config-manager --set-enabled crb    # CentOS/Rocky/Alma
# oppure: sudo subscription-manager repos --enable codeready-builder-for-rhel-9-x86_64-rpms   # RHEL

sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y curl wget pkg-config \
  openssl-devel gtk3-devel webkit2gtk4.1-devel \
  libappindicator-gtk3-devel librsvg2-devel \
  glib2-devel libsoup3-devel javascriptcoregtk4.1-devel
```

> **Nota:** Su RHEL/CentOS/Rocky, `webkit2gtk4.1-devel` potrebbe non essere disponibile nei repo standard. In tal caso:
> ```bash
> # Verificare la disponibilita'
> dnf search webkit2gtk
> # Se non disponibile, considerare Fedora o compilare WebKitGTK da sorgente
> ```
</details>

<details>
<summary><strong>Rust + Node.js + pnpm + Tauri CLI (tutte le distro)</strong></summary>

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Node.js 22+ (via NodeSource)
# Debian/Ubuntu:
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
# Fedora/RHEL:
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs

# pnpm
corepack enable
corepack prepare pnpm@latest --activate

# Tauri CLI
cargo install tauri-cli --locked
```
</details>

<details>
<summary><strong>Windows</strong></summary>

See [Build for Windows](#build-for-windows) below. The build script installs all dependencies automatically.
</details>

### Development

```bash
# Start MinIO (test S3 server) + app
./scripts/dev-test.sh

# Or manually:
docker compose up -d          # MinIO on localhost:9000
pnpm install
pnpm tauri dev                # HMR frontend + Rust backend
```

MinIO console: http://localhost:9001 (user: `minioadmin`, password: `minioadmin`)

### Testing

```bash
# Frontend
pnpm lint                     # Biome linter
pnpm typecheck                # TypeScript
pnpm test                     # Vitest

# Backend
cd src-tauri
cargo fmt -- --check          # Format check
cargo clippy -- -D warnings   # Linter
cargo test                    # Unit + integration tests
```

---

## Building

### Build for Linux

```bash
pnpm tauri build
```

Output in `src-tauri/target/release/bundle/`:

| Package | Path | Install command |
|---------|------|-----------------|
| `.deb` | `bundle/deb/brows3r_1.0.0_amd64.deb` | `sudo dpkg -i brows3r_*.deb` |
| `.rpm` | `bundle/rpm/brows3r-1.0.0-1.x86_64.rpm` | `sudo rpm -i brows3r-*.rpm` |
| `.AppImage` | `bundle/appimage/brows3r_1.0.0_amd64.AppImage` | `chmod +x brows3r_*.AppImage && ./brows3r_*.AppImage` |

> **Nota:** Per generare il pacchetto `.rpm` da una macchina Debian/Ubuntu serve il pacchetto `rpm`:
> ```bash
> sudo apt install rpm
> ```
> Su Fedora/RHEL non serve: `rpmbuild` e' gia' incluso nel gruppo "Development Tools".

### Build for Windows

From a Windows machine:

```
git clone <repo-url>
cd brows3r
scripts\build-windows.bat
```

The script automatically installs missing dependencies:
- Visual Studio Build Tools (C++ workload)
- Rust (via rustup)
- Node.js 22 LTS
- pnpm
- Tauri CLI

Output: `src-tauri\target\release\bundle\nsis\brows3r_1.0.0_x64-setup.exe`

---

## CI/CD

Automated via **Bitbucket Pipelines** (`bitbucket-pipelines.yml`):

| Event | What happens |
|-------|-------------|
| Every push | Frontend lint/typecheck/test + Backend fmt/clippy/test + Linux build |
| Pull request | Frontend + Backend checks (no build) |
| Tag `v*` | Linux release build + upload to Bitbucket Downloads |

### Creating a Release

```bash
# 1. Update version in src-tauri/tauri.conf.json and Cargo.toml
# 2. Commit and tag
git tag v1.0.0
git push --tags

# 3. Pipeline builds .deb + .rpm + .AppImage and uploads to Bitbucket Downloads
# 4. Build Windows .exe manually on a Windows machine
```

Required Bitbucket variable: `BB_AUTH_STRING` = `user:app_password` (repo settings > Pipelines > Variables)

---

## Project Structure

```
brows3r/
  src-tauri/                    # Rust backend
    src/
      commands/                 # Tauri IPC commands
        connection.rs           #   Connection CRUD + test
        bucket.rs               #   Bucket operations
        object.rs               #   Object ops + preview + metadata
        transfer.rs             #   Upload/download queue
        import.rs               #   Import from AWS CLI/rclone/s3cmd/mc
        config.rs               #   App settings
      s3/                       # S3 abstraction layer
        client.rs               #   Client pool + operations
        multipart.rs            #   Parallel multipart upload
        presign.rs              #   Presigned URL generation
      transfer/                 # Transfer engine
        upload.rs download.rs queue.rs throttle.rs checksum.rs
      store/                    # Persistence
        database.rs             #   SQLite (connections, secrets)
        credentials.rs          #   OS keychain integration
      models/                   # Shared types (serde + specta)
  src/                          # React frontend
    components/
      layout/                   # AppShell, Sidebar, Toolbar, TabBar, Breadcrumb, StatusBar
      connection/               # ConnectionDialog, ImportDialog
      object/                   # ObjectTable, ObjectContextMenu, ObjectDetails
      preview/                  # PreviewPanel, Text/Image/Pdf/Video/Audio/MarkdownPreview
      transfer/                 # TransferPanel
      settings/                 # SettingsDialog
      common/                   # ConfirmDialog, InputDialog, ErrorBoundary
    stores/                     # Zustand (connectionStore, objectStore, transferStore, uiStore, settingsStore)
    locales/                    # i18n (en.json, it.json)
    lib/                        # Utilities (tauri.ts, format.ts, theme.ts, i18n.ts)
    styles/globals.css          # Tailwind + custom form styles
  scripts/
    install-prerequisites.sh    # Linux setup script
    build-windows.bat           # Windows build launcher
    build-windows.ps1           # Windows build + dependency installer
    dev-test.sh                 # Start MinIO + dev mode
  docker-compose.yml            # MinIO for testing
  bitbucket-pipelines.yml       # CI/CD pipeline
```

---

## Configuration

App data is stored in the OS-standard location:

| OS | Path |
|----|------|
| Linux | `~/.config/brows3r/` |
| macOS | `~/Library/Application Support/brows3r/` |
| Windows | `%APPDATA%\brows3r\` |

Credentials are stored in the OS keychain when available, with encrypted SQLite fallback.

---

## Roadmap

- [x] Connection management with provider presets
- [x] Bucket browsing and CRUD
- [x] Object navigation with breadcrumb + address bar
- [x] Multiple tabs
- [x] Upload (single + parallel multipart)
- [x] Download with folder selection
- [x] Copy / Move / Rename
- [x] Search/filter (substring, glob, regex)
- [x] Drag & drop upload
- [x] File preview (text, images, PDF, video, audio, markdown)
- [x] Object metadata editing
- [x] Transfer queue with progress
- [x] Settings (theme, language, transfer tuning)
- [x] Import connections (AWS CLI, rclone, s3cmd, MinIO Client)
- [x] CI/CD pipeline (Linux) + Windows build scripts
- [ ] Object versioning (list versions, restore, delete markers)
- [ ] Bucket properties (versioning, encryption, policy, CORS, lifecycle)
- [ ] Sync (unidirectional, with dry-run)
- [ ] Integrated S3 terminal (ls, cp, mv, rm, cat)
- [ ] Batch operations (mass metadata/storage class/ACL changes)
- [ ] Cross-connection transfers
- [ ] Bandwidth throttling with time-based schedules
- [ ] Dashboard and statistics
- [ ] macOS build + code signing
- [ ] Auto-updater

---

## Contributing

This is currently a private project. See `FUNCTIONAL_SPECS.md` for the full functional specification and `TECH_STACK.md` for architectural decisions.

---

<p align="center">
  Built with Rust and React. Because life's too short for slow S3 browsers.
</p>
