# brows3r — Stack Tecnologico

**Versione:** 1.0-draft
**Data:** 2026-04-11

---

## 1. Analisi delle alternative

### 1.1 Matrice comparativa — Framework applicativo

| Criterio | Tauri v2 + React | Electron + React | Wails v2 + React | Flutter Desktop | Qt (C++) | Avalonia (.NET) |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|
| **Cross-platform Linux/macOS/Win** | A | A | A | B | A | A |
| **Supporto arm64 nativo** | A | A | B | A | A | A |
| **Dimensione bundle** | A (10-15 MB) | D (150+ MB) | A (10-15 MB) | B (30-50 MB) | B (30-50 MB) | B (20-40 MB) |
| **Consumo RAM idle** | A (40-80 MB) | D (200+ MB) | A (50-90 MB) | B (80-120 MB) | A (40-80 MB) | B (60-100 MB) |
| **Ricchezza ecosistema UI** | A (React) | A (React) | A (React) | B | B | C |
| **Integrazione OS nativa** | A | B | B | C | A | B |
| **Performance I/O / networking** | A (Rust) | B (Node.js) | A (Go) | B (Dart) | A (C++) | B (C#) |
| **Sicurezza (sandboxing, IPC)** | A | C | B | B | B | B |
| **Maturita' / stabilita'** | B | A | B | C | A | B |
| **Ecosistema librerie per S3** | A | A | A | C | C | B |
| **Efficacia generazione codice AI** | A | A | A | B | C | B |
| **Curva di apprendimento** | B | A | B | B | D | B |

**Legenda:** A = eccellente, B = buono, C = sufficiente, D = inadeguato

### 1.2 Valutazione dettagliata dei candidati principali

#### Opzione 1: Tauri v2 + React/TypeScript + Rust backend (RACCOMANDATO)

**Pro:**
- Il backend Rust e' ideale per il transfer engine (zero-cost abstractions, async I/O con tokio, memory safety senza garbage collector)
- Bundle leggero (10-15 MB) — usa la WebView nativa dell'OS invece di bundlare Chromium
- Modello di sicurezza forte: IPC tipizzato, permessi granulari, sandboxing
- Tauri v2 ha API mature per: file system, dialog, keychain (plugin `stronghold` o OS keychain), system tray, clipboard, drag & drop, auto-updater
- L'ecosistema Rust per S3 e' solido: `aws-sdk-s3` (SDK ufficiale AWS), `aws-sigv4`, `reqwest`/`hyper` per HTTP
- La separazione Rust (core) / TypeScript (UI) mappa perfettamente l'architettura del progetto
- Tauri v2 e' stabile (rilascio ottobre 2024), con una community attiva

**Contro:**
- Rust ha una curva di apprendimento ripida (ma io lo gestisco bene)
- La WebView nativa puo' avere differenze di rendering minori tra OS (mitigabile con testing)
- Meno plugin third-party rispetto a Electron

#### Opzione 2: Electron + React/TypeScript + Node.js backend

**Pro:**
- Ecosistema piu' maturo e vasto (VS Code, Slack, Discord lo usano)
- Rendering identico su tutti gli OS (Chromium bundled)
- Enorme quantita' di librerie npm disponibili

**Contro:**
- Bundle da 150+ MB (include un intero Chromium)
- Consumo RAM elevato (200+ MB idle) — fuori target delle specifiche (< 150 MB)
- Node.js single-threaded per I/O CPU-bound: il transfer engine richiede worker threads
- Sicurezza: superficie di attacco maggiore, modello di sandboxing piu' debole
- **Scartato per: dimensioni bundle e consumo RAM incompatibili con i requisiti**

#### Opzione 3: Wails v2 + React/TypeScript + Go backend

**Pro:**
- Go e' eccellente per networking e concorrenza (goroutines)
- AWS SDK Go v2 e' maturo e ben mantenuto
- Bundle leggero come Tauri
- Piu' semplice di Rust da scrivere e manutenere

**Contro:**
- Wails e' meno maturo di Tauri (community piu' piccola)
- Integrazione OS meno profonda (keychain, auto-updater richiedono librerie esterne)
- Go ha un garbage collector (pause potenziali sotto carico pesante, anche se minime)
- **Alternativa valida, ma Tauri/Rust vince su sicurezza e integrazione OS**

---

## 2. Stack raccomandato

### Architettura: Tauri v2 + React + TypeScript + Rust

```
+-----------------------------------------------------------------+
|                        FRONTEND (WebView)                       |
|  React 19 + TypeScript 5.x                                     |
|  Vite (bundler)                                                 |
|  Zustand (state management)                                     |
|  TanStack Table / Virtual (tabelle performanti)                 |
|  React Aria / Radix UI (componenti accessibili)                 |
|  Monaco Editor (editor policy JSON)                             |
|  Shiki (syntax highlighting)                                    |
|  xterm.js (terminale integrato)                                 |
|  react-pdf, video.js (preview)                                  |
|  Tailwind CSS 4 (styling)                                       |
+-----------------------------------------------------------------+
         | Tauri IPC (invoke commands / events)
         | Tipizzato, serializzato, sandboxed
+-----------------------------------------------------------------+
|                     BACKEND (Rust / Tauri Core)                  |
|                                                                  |
|  +-------------------+  +--------------------+  +-----------+   |
|  | connection_manager |  | bucket_manager     |  | config    |   |
|  | - profiles CRUD    |  | - list/create/del  |  | - settings|   |
|  | - auth providers   |  | - properties       |  | - import  |   |
|  | - test connection  |  | - policy/cors/...  |  | - export  |   |
|  +-------------------+  +--------------------+  +-----------+   |
|                                                                  |
|  +-------------------+  +--------------------+  +-----------+   |
|  | object_manager     |  | transfer_engine    |  | search    |   |
|  | - list/navigate    |  | - upload queue     |  | - filter  |   |
|  | - CRUD operations  |  | - download queue   |  | - regex   |   |
|  | - versioning       |  | - multipart        |  | - metadata|   |
|  | - presigned URLs   |  | - bandwidth ctrl   |  |           |   |
|  | - metadata         |  | - resume/retry     |  |           |   |
|  +-------------------+  +--------------------+  +-----------+   |
|                                                                  |
|  +-----------------------------------------------------------+  |
|  | S3 Abstraction Layer                                       |  |
|  | aws-sdk-s3 + aws-sigv4 + aws-credential-types             |  |
|  | reqwest (HTTP client) + rustls (TLS)                       |  |
|  | tokio (async runtime)                                      |  |
|  +-----------------------------------------------------------+  |
|                                                                  |
|  +-----------------------------------------------------------+  |
|  | Credential Store                                           |  |
|  | keyring-rs (OS keychain) | age (encryption fallback)      |  |
|  +-----------------------------------------------------------+  |
+-----------------------------------------------------------------+
```

---

## 3. Dettaglio componenti

### 3.1 Frontend — UI Layer

| Componente | Libreria | Versione | Motivazione |
|------------|----------|----------|-------------|
| **Framework UI** | React | 19.x | Ecosistema piu' vasto, component model maturo, concurrent rendering |
| **Linguaggio** | TypeScript | 5.x | Type safety, autocompletamento, refactoring sicuro |
| **Bundler** | Vite | 6.x | Velocita' di build, HMR istantaneo, integrazione Tauri nativa |
| **State management** | Zustand | 5.x | Leggero, semplice, performante. Niente boilerplate Redux |
| **Tabelle virtuali** | TanStack Table + TanStack Virtual | 8.x | Virtualizzazione per listing di milioni di righe, ordinamento, filtri |
| **Componenti base** | Radix UI Primitives | latest | Headless, accessibili (WAI-ARIA), composabili, nessun CSS imposto |
| **Styling** | Tailwind CSS | 4.x | Utility-first, tema chiaro/scuro nativo, design system coerente |
| **Icone** | Lucide React | latest | Set completo, consistente, tree-shakeable |
| **Editor codice/JSON** | Monaco Editor | latest | Stesso engine di VS Code, syntax highlighting, validazione JSON Schema |
| **Syntax highlighting** | Shiki | latest | Highlighting accurato per preview file codice sorgente |
| **Terminale** | xterm.js | latest | Terminale integrato performante, usato da VS Code |
| **Preview PDF** | react-pdf | latest | Rendering PDF lato client |
| **Player video/audio** | Integrato HTML5 | - | `<video>` e `<audio>` nativi della WebView, sufficienti per i formati richiesti |
| **Drag & drop** | dnd-kit | latest | Moderno, accessibile, performante |
| **Markdown rendering** | react-markdown + remark-gfm | latest | Preview file .md |
| **Pannelli ridimensionabili** | allotment | latest | Splitter panel performante |
| **Internazionalizzazione** | i18next + react-i18next | latest | Standard de-facto per i18n React |
| **Router (tab/navigazione)** | TanStack Router | latest | Type-safe, leggero |
| **Form/validazione** | React Hook Form + Zod | latest | Per dialog configurazione connessioni |
| **Grafici** | Recharts | latest | Grafici velocita' trasferimento, statistiche |

### 3.2 Backend — Rust Core

| Componente | Crate | Versione | Motivazione |
|------------|-------|----------|-------------|
| **Framework app** | tauri | 2.x | Runtime cross-platform, IPC, lifecycle, plugin system |
| **Async runtime** | tokio | 1.x | Standard de-facto per async Rust, multi-threaded |
| **S3 SDK** | aws-sdk-s3 | latest | SDK ufficiale AWS, supporta tutti gli endpoint S3-compatibili |
| **S3 Auth** | aws-credential-types + aws-sigv4 | latest | Firma V4, credential providers pluggabili |
| **HTTP client** | reqwest | latest | Basato su hyper, supporta proxy, TLS custom, connection pooling |
| **TLS** | rustls + webpki-roots | latest | TLS puro Rust, no dipendenza OpenSSL, supporto CA custom |
| **Serializzazione** | serde + serde_json | 1.x | Standard Rust, usato anche per IPC Tauri |
| **Configurazione** | serde (JSON/YAML) | - | Lettura/scrittura config con tipizzazione forte |
| **Credential storage** | keyring | latest | Wrapper per OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret) |
| **Encryption fallback** | age | latest | Cifratura file credenziali dove non c'e' keychain |
| **Database locale** | SQLite via rusqlite | latest | Storico trasferimenti, coda persistente, cache metadata |
| **Logging** | tracing + tracing-subscriber | latest | Structured logging, livelli, filtri, rotazione |
| **Error handling** | thiserror + anyhow | latest | Errori tipizzati per le API, anyhow per i contesti interni |
| **Checksum** | md-5, sha2 | latest | Calcolo hash per verifica integrita' trasferimenti |
| **Data/ora** | chrono | latest | Parsing/formattazione date S3 |
| **Regex** | regex | latest | Ricerca avanzata, filtri |
| **Concorrenza** | tokio::sync (Semaphore, mpsc) | - | Controllo concorrenza trasferimenti, code |
| **Bandwidth throttling** | governor | latest | Rate limiting per banda configurabile |
| **CSV export** | csv | latest | Export listing oggetti |
| **Glob patterns** | globset | latest | Filtri esclusione file |
| **Piattaforma info** | dirs | latest | Path standard OS per config/data/cache |
| **Auto-updater** | tauri-plugin-updater | 2.x | Aggiornamento in-app con verifica firma |
| **File dialog** | tauri-plugin-dialog | 2.x | Dialog nativi apertura/salvataggio file |
| **Clipboard** | tauri-plugin-clipboard-manager | 2.x | Copia URL, path, ecc. |
| **Shell** | tauri-plugin-shell | 2.x | Apertura file/URL con app di sistema |
| **Notifiche** | tauri-plugin-notification | 2.x | Notifiche OS per trasferimenti completati |

### 3.3 Comunicazione Frontend <-> Backend

| Aspetto | Dettaglio |
|---------|-----------|
| **Meccanismo** | Tauri IPC: `invoke` (request/response) + `emit`/`listen` (eventi) |
| **Serializzazione** | JSON automatico via serde (Rust) e TypeScript |
| **Type safety** | Generazione tipi TypeScript da struct Rust tramite `specta` o `ts-rs` |
| **Pattern comandi** | Un comando Tauri per ogni operazione logica (es. `list_objects`, `upload_file`) |
| **Pattern eventi** | Eventi per notifiche asincrone (progresso trasferimento, errori, completamento) |
| **Streaming** | Per operazioni long-running (listing grandi, trasferimenti): eventi progressivi |

Esempio pattern IPC:

```
Frontend                          Backend (Rust)
   |                                  |
   |-- invoke("list_objects",         |
   |     {conn_id, bucket, prefix})   |
   |     -----------------------------> handle_list_objects()
   |                                  |   -> s3_client.list_objects_v2()
   |     <-----------------------------    -> Ok(ListObjectsResponse)
   |   render table                   |
   |                                  |
   |-- invoke("start_upload",         |
   |     {conn_id, bucket, files})    |
   |     -----------------------------> handle_start_upload()
   |                                  |   -> spawn transfer task
   |     <--- event("transfer:progress", {id, bytes, speed})
   |     <--- event("transfer:progress", {id, bytes, speed})
   |     <--- event("transfer:complete", {id, etag})
   |   update progress bar            |
```

---

## 4. Struttura progetto

```
brows3r/
|
|-- src-tauri/                     # Backend Rust (Tauri app)
|   |-- Cargo.toml
|   |-- tauri.conf.json            # Configurazione Tauri (permessi, window, bundle)
|   |-- capabilities/              # Permessi Tauri v2
|   |-- src/
|   |   |-- main.rs                # Entry point
|   |   |-- lib.rs                 # Setup app Tauri
|   |   |-- commands/              # Comandi IPC (uno per modulo)
|   |   |   |-- mod.rs
|   |   |   |-- connection.rs      # CRUD connessioni, test
|   |   |   |-- bucket.rs          # Operazioni bucket
|   |   |   |-- object.rs          # Operazioni oggetti
|   |   |   |-- transfer.rs        # Gestione coda trasferimenti
|   |   |   |-- search.rs          # Ricerca avanzata
|   |   |   |-- config.rs          # Impostazioni applicazione
|   |   |   |-- sync.rs            # Sincronizzazione
|   |   |-- s3/                    # S3 Abstraction Layer
|   |   |   |-- mod.rs
|   |   |   |-- client.rs          # Wrapper S3 client configurabile
|   |   |   |-- auth.rs            # Provider autenticazione
|   |   |   |-- types.rs           # Tipi condivisi (BucketInfo, ObjectInfo, ecc.)
|   |   |   |-- error.rs           # Errori S3 tipizzati
|   |   |   |-- multipart.rs       # Logica upload multipart
|   |   |   |-- presign.rs         # Generazione URL pre-firmati
|   |   |-- transfer/              # Transfer Engine
|   |   |   |-- mod.rs
|   |   |   |-- queue.rs           # Coda trasferimenti con priorita'
|   |   |   |-- upload.rs          # Upload handler (singolo + multipart)
|   |   |   |-- download.rs        # Download handler (con resume)
|   |   |   |-- throttle.rs        # Bandwidth limiting
|   |   |   |-- checksum.rs        # Verifica integrita'
|   |   |-- store/                 # Persistenza locale
|   |   |   |-- mod.rs
|   |   |   |-- credentials.rs     # Gestione keychain / encrypted store
|   |   |   |-- database.rs        # SQLite (storico, coda, cache)
|   |   |   |-- config.rs          # Lettura/scrittura configurazione
|   |   |   |-- migrations/        # Migrazioni schema SQLite
|   |   |-- models/                # Struct condivise (con derive serde + specta)
|   |   |   |-- mod.rs
|   |   |   |-- connection.rs
|   |   |   |-- bucket.rs
|   |   |   |-- object.rs
|   |   |   |-- transfer.rs
|   |   |   |-- settings.rs
|   |
|-- src/                           # Frontend React/TypeScript
|   |-- main.tsx                   # Entry point React
|   |-- App.tsx                    # Layout principale
|   |-- vite-env.d.ts
|   |-- styles/
|   |   |-- globals.css            # Tailwind base + tema
|   |-- components/
|   |   |-- layout/
|   |   |   |-- AppShell.tsx       # Layout master (toolbar, sidebar, content, panels)
|   |   |   |-- Sidebar.tsx        # Albero connessioni/bucket
|   |   |   |-- Toolbar.tsx        # Barra strumenti principale
|   |   |   |-- StatusBar.tsx      # Barra stato inferiore
|   |   |   |-- Breadcrumb.tsx     # Navigazione percorso
|   |   |-- connection/
|   |   |   |-- ConnectionDialog.tsx    # Creazione/modifica connessione
|   |   |   |-- ConnectionTree.tsx      # Nodi albero connessione
|   |   |   |-- ConnectionTest.tsx      # UI test connessione
|   |   |   |-- ImportDialog.tsx        # Import da AWS CLI/rclone/ecc.
|   |   |-- bucket/
|   |   |   |-- BucketList.tsx
|   |   |   |-- BucketCreateDialog.tsx
|   |   |   |-- BucketProperties.tsx
|   |   |   |-- PolicyEditor.tsx        # Editor JSON con Monaco
|   |   |-- object/
|   |   |   |-- ObjectTable.tsx         # Tabella virtualizzata oggetti
|   |   |   |-- ObjectContextMenu.tsx   # Menu tasto destro
|   |   |   |-- ObjectDetails.tsx       # Pannello dettagli/metadata
|   |   |   |-- VersionList.tsx         # Lista versioni oggetto
|   |   |   |-- PresignDialog.tsx       # Generazione URL pre-firmato
|   |   |-- preview/
|   |   |   |-- PreviewPanel.tsx        # Router preview per tipo file
|   |   |   |-- ImagePreview.tsx
|   |   |   |-- TextPreview.tsx         # Con syntax highlighting
|   |   |   |-- PdfPreview.tsx
|   |   |   |-- MediaPreview.tsx        # Video + audio
|   |   |   |-- MarkdownPreview.tsx
|   |   |-- transfer/
|   |   |   |-- TransferPanel.tsx       # Pannello coda trasferimenti
|   |   |   |-- TransferItem.tsx        # Singolo elemento con progresso
|   |   |   |-- TransferStats.tsx       # Velocita', ETA
|   |   |-- terminal/
|   |   |   |-- TerminalPanel.tsx       # Terminale S3 integrato
|   |   |-- search/
|   |   |   |-- SearchPanel.tsx
|   |   |   |-- SearchFilters.tsx
|   |   |-- settings/
|   |   |   |-- SettingsDialog.tsx
|   |   |   |-- GeneralSettings.tsx
|   |   |   |-- TransferSettings.tsx
|   |   |   |-- ThemeSettings.tsx
|   |   |-- common/                     # Componenti riutilizzabili
|   |   |   |-- ConfirmDialog.tsx
|   |   |   |-- LoadingSpinner.tsx
|   |   |   |-- EmptyState.tsx
|   |   |   |-- ErrorBoundary.tsx
|   |-- hooks/                          # Custom React hooks
|   |   |-- useS3.ts                    # Hook per operazioni S3 via IPC
|   |   |-- useTransfer.ts             # Hook per coda trasferimenti
|   |   |-- useConnection.ts           # Hook per gestione connessioni
|   |   |-- useSettings.ts            # Hook per impostazioni
|   |   |-- useKeyboard.ts            # Hook per shortcut tastiera
|   |-- stores/                        # Zustand stores
|   |   |-- connectionStore.ts
|   |   |-- objectStore.ts
|   |   |-- transferStore.ts
|   |   |-- settingsStore.ts
|   |   |-- uiStore.ts
|   |-- lib/
|   |   |-- tauri.ts                   # Wrapper tipizzato per invoke/events
|   |   |-- format.ts                  # Formattazione dimensioni, date, ecc.
|   |   |-- i18n.ts                    # Setup i18next
|   |-- locales/
|   |   |-- it.json
|   |   |-- en.json
|   |-- types/                         # Tipi TypeScript (generati da Rust)
|   |   |-- generated.ts              # Auto-generato da specta/ts-rs
|
|-- tests/                             # Test
|   |-- rust/                          # Test unitari e integrazione Rust
|   |-- e2e/                           # Test end-to-end
|
|-- package.json
|-- tsconfig.json
|-- vite.config.ts
|-- tailwind.config.ts
|-- index.html                         # Entry point Tauri WebView
|-- FUNCTIONAL_SPECS.md
|-- TECH_STACK.md
```

---

## 5. Tooling e sviluppo

### 5.1 Build e sviluppo

| Tool | Uso |
|------|-----|
| **Cargo** | Build e gestione dipendenze Rust |
| **pnpm** | Package manager frontend (veloce, disk-efficient) |
| **Vite** | Dev server con HMR + build produzione |
| **Tauri CLI** | Dev mode, build, bundle per ogni piattaforma |
| **specta / ts-rs** | Generazione tipi TypeScript da struct Rust |

### 5.2 Testing

| Tipo | Tool | Scope |
|------|------|-------|
| **Unit test Rust** | `cargo test` + `mockall` | S3 layer, transfer engine, config |
| **Unit test TS** | Vitest | Hooks, stores, utility |
| **Component test** | Vitest + Testing Library | Componenti React |
| **Integration test** | MinIO container + `cargo test` | Operazioni S3 end-to-end |
| **E2E test** | Playwright (o WebdriverIO via Tauri) | Flussi utente completi |
| **S3 mock** | MinIO Docker | Server S3 locale per test |

### 5.3 CI/CD

La CI/CD e' gestita tramite **Bitbucket Pipelines** per Linux e **script manuali** per Windows.

Configurazione: `bitbucket-pipelines.yml`

#### 5.3.1 Pipeline Linux (Bitbucket Pipelines)

L'immagine base e' `ubuntu:24.04`. La pipeline installa automaticamente Rust, Node.js 22, pnpm e Tauri CLI.

| Trigger | Step | Cosa fa | Artifacts |
|---------|------|---------|-----------|
| **Ogni push** (default) | Frontend: lint + typecheck + test | `pnpm lint`, `pnpm typecheck`, `pnpm test` | - |
| **Ogni push** (default) | Backend: fmt + clippy + test | `cargo fmt --check`, `cargo clippy`, `cargo test` | - |
| **Ogni push** (default) | Build Linux | `pnpm tauri build` | `.deb`, `.rpm`, `.AppImage` |
| **Pull request** | Frontend + Backend checks | Lint, typecheck, test (no build) | - |
| **Tag `v*`** | Build Linux release | `pnpm tauri build` (release ottimizzato) | `.deb`, `.rpm`, `.AppImage` |
| **Tag `v*`** | Upload to Bitbucket Downloads | Upload pacchetti via Bitbucket API | - |

**Pacchetti generati (Linux):**

| Formato | Path | Destinatari |
|---------|------|-------------|
| `.deb` | `src-tauri/target/release/bundle/deb/` | Ubuntu, Debian, Linux Mint, Pop!_OS |
| `.rpm` | `src-tauri/target/release/bundle/rpm/` | Fedora, RHEL, CentOS, Rocky, Alma |
| `.AppImage` | `src-tauri/target/release/bundle/appimage/` | Qualsiasi distro Linux (portable) |

**Cache Bitbucket Pipelines:**

| Cache | Key | Path | Scopo |
|-------|-----|------|-------|
| `cargo` | `src-tauri/Cargo.lock` | `~/.cargo/registry` | Registry crate Rust |
| `cargo-target` | `src-tauri/Cargo.lock` | `src-tauri/target` | Compilati Rust |
| `pnpm` | `pnpm-lock.yaml` | `.pnpm-store` | Pacchetti npm |

**Dipendenze sistema installate nella pipeline:**

```
build-essential curl pkg-config file rpm
libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev
libayatana-appindicator3-dev librsvg2-dev
libglib2.0-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
```

**Variabili di ambiente richieste per il rilascio (`v*` tags):**

| Variabile | Dove configurarla | Uso |
|-----------|-------------------|-----|
| `BB_AUTH_STRING` | Bitbucket repo settings > Pipelines > Variables | `user:app_password` per upload su Bitbucket Downloads |

#### 5.3.2 Build Windows (manuale)

La build Windows e' gestita da script locali in `scripts/`:

| File | Scopo |
|------|-------|
| `scripts/build-windows.bat` | Launcher — bypassa le PowerShell execution policy e lancia lo script PS1 |
| `scripts/build-windows.ps1` | Script principale — installa dipendenze e builda il pacchetto `.exe` |

**Dipendenze installate automaticamente dallo script (se mancanti):**

| Dipendenza | Metodo installazione | Note |
|------------|---------------------|------|
| Visual Studio Build Tools | `vs_buildtools.exe` (C++ workload) | Richiede privilegi admin |
| Rust | rustup (`rustup-init.exe`) | Toolchain stable |
| Node.js 22 LTS | MSI installer | |
| pnpm | `corepack enable` / `npm install -g` | |
| Tauri CLI | `cargo install tauri-cli --locked` | |

**Utilizzo:**

```
git clone <repo>
cd brows3r
scripts\build-windows.bat
```

Lo script apre automaticamente la cartella contenente l'installer al termine della build.

**Pacchetti generati (Windows):**

| Formato | Path | Tipo |
|---------|------|------|
| `.exe` (NSIS) | `src-tauri/target/release/bundle/nsis/` | Installer con wizard di installazione |

#### 5.3.3 Bundle targets configurati

In `src-tauri/tauri.conf.json`, i target di bundle sono:

```json
"targets": ["deb", "rpm", "appimage", "nsis"]
```

| Target | Piattaforma | Formato |
|--------|-------------|---------|
| `deb` | Linux | Pacchetto Debian `.deb` |
| `rpm` | Linux | Pacchetto RPM `.rpm` |
| `appimage` | Linux | AppImage portable `.AppImage` |
| `nsis` | Windows | Installer `.exe` (NSIS) |

#### 5.3.4 Flusso di rilascio

```
1. Merge PR su main
2. git tag v0.1.0
3. git push --tags
4. Pipeline Bitbucket:
   a. Build .deb + .rpm + .AppImage
   b. Upload su Bitbucket Downloads
5. Su macchina Windows:
   a. git pull
   b. scripts\build-windows.bat
   c. .exe generato in src-tauri/target/release/bundle/nsis/
```

### 5.4 Comandi principali di sviluppo

```bash
# Setup iniziale
pnpm install
cd src-tauri && cargo build

# Dev mode (frontend HMR + backend Rust con hot reload)
pnpm tauri dev

# Build produzione
pnpm tauri build

# Test
cargo test                        # Unit + integration Rust
pnpm test                         # Unit + component TS
pnpm test:e2e                     # E2E con Playwright

# Generazione tipi TS da Rust
cargo test generate_bindings       # via specta

# Lint
cargo clippy -- -D warnings
pnpm lint                         # Biome
```

---

## 6. Dipendenze esterne a runtime

| Dipendenza | Piattaforma | Note |
|------------|-------------|------|
| **WebView2** | Windows | Pre-installato su Windows 10/11 recenti; installer lo include come fallback |
| **WebKitGTK** | Linux | Richiesto da Tauri; presente di default su GNOME, installabile su altre DE |
| **WebKit** | macOS | Incluso nel sistema operativo |
| **SQLite** | Tutte | Embedded via rusqlite (bundled, nessuna dipendenza esterna) |

### 6.0 Logging

Lo stack di tracing è impostato in [src-tauri/src/store/logging.rs](src-tauri/src/store/logging.rs):

- **Subscriber multilayer**: stdout (con ANSI) + file appender giornaliero (`tracing-appender::rolling::daily`) con writer non-bloccante.
- **Configurazione utente** in `settings.json` sotto `general`:
  - `log_level`: directive `EnvFilter` (es. `info`, `debug`, `brows3r=trace,info`)
  - `file_log_enabled`: abilita/disabilita la scrittura su file (default: `true`)
  - `log_directory`: override della cartella log (default: `<data_local_dir>/com.brows3r.app/logs`)
  - `log_retention_days`: giorni di conservazione dei file ruotati (default 14, `0` = disabilita la pulizia)
- **Override via env**: `RUST_LOG`, se settata, prevale sempre sul setting utente — comodo per debug a posteriori senza toccare le impostazioni.
- **Hot-reload del livello**: cambiare `log_level` da UI applica immediatamente il filtro via `tracing_subscriber::reload`. Path/abilitazione file richiedono restart.
- **Retention purge**: all'avvio, i file `brows3r.log.*` più vecchi di `log_retention_days` vengono eliminati. La pulizia ignora qualsiasi altro file nella cartella per non toccare contenuti dell'utente in cartelle custom.
- **Comando Tauri**: `get_log_dir_info()` espone path/file_count/size totale alla UI; il dialog Impostazioni → Log mostra il percorso attivo e un pulsante "Apri cartella".

### 6.1 Verifica prerequisiti runtime su Linux

Per i pacchetti `.deb` e `.rpm` le dipendenze native sono dichiarate nel
bundle Tauri (`src-tauri/tauri.conf.json` → `bundle.linux.deb.depends` e
`bundle.linux.rpm.depends`) e vengono risolte automaticamente da
`apt`/`dnf`. L'AppImage invece non ha gestione di dipendenze esterne,
quindi il progetto include due livelli di check:

1. **Script `scripts/check-system.sh`** — verifica che le librerie native
   richieste (`libwebkit2gtk-4.1`, `libgtk-3`, `libglib2.0`, `libsoup-3.0`,
   `libjavascriptcoregtk-4.1`, `librsvg2`) siano effettivamente presenti
   sul sistema:
   - `./scripts/check-system.sh` → solo verifica, exit 1 con istruzioni
     specifiche per Debian/Ubuntu o Fedora/RHEL/Rocky se manca qualcosa
   - `./scripts/check-system.sh --install` → tenta l'installazione
     automatica via `apt` o `dnf` (richiede `sudo`) e ri-verifica
   - `./scripts/check-system.sh --json` → output machine-readable

2. **Comando Tauri `check_system_prerequisites`** — espone lo stesso
   controllo dal backend Rust al frontend (`commands::system`). Il
   risultato viene mostrato nel dialog "Informazioni" con le librerie
   mancanti e il comando di installazione pronto da copiare. Inoltre,
   all'avvio dell'app, eventuali librerie mancanti vengono loggate via
   `tracing` per diagnosticare crash early-boot.

---

## 7. Considerazioni sulle performance

### 7.1 Listing di grandi quantita' di oggetti

- **TanStack Virtual** per virtualizzazione tabella: renderizza solo le righe visibili, gestisce milioni di righe
- **Paginazione backend** con continuation token: caricamento incrementale, nessun accumulo in memoria di tutto il listing
- **Indicizzazione SQLite** per cache locale dei listing frequenti (opzionale)

### 7.2 Trasferimenti

- **tokio** multi-threaded runtime per I/O asincrono parallelo
- **Semaphore** per controllare la concorrenza (N trasferimenti simultanei, M parti per trasferimento)
- **Streaming** diretto file -> S3 senza buffering completo in RAM (zero-copy dove possibile)
- **governor** per throttling preciso della banda senza busy-wait

### 7.3 Memoria

- Le struct Rust sono stack-allocated dove possibile
- Nessun garbage collector: la memoria viene liberata deterministicamente
- Il frontend usa virtualizzazione per evitare di istanziare migliaia di nodi DOM
- Le preview di file grandi vengono caricate in streaming (range request) non in memoria

---

## 8. Sicurezza dello stack

| Aspetto | Approccio |
|---------|-----------|
| **Memory safety** | Rust elimina buffer overflow, use-after-free, data race a compile time |
| **TLS** | rustls (implementazione puro Rust, no dipendenza da OpenSSL con la sua storia di CVE) |
| **IPC** | Tauri v2 capability-based permissions: ogni comando deve essere esplicitamente autorizzato |
| **Dipendenze** | `cargo audit` e `pnpm audit` in CI per vulnerabilita' note |
| **Credenziali** | Mai in chiaro su disco: keychain OS o cifratura con age |
| **CSP** | Content Security Policy restrittiva nella WebView (no inline script, no eval) |

---

## 9. Roadmap implementativa suggerita

### Fase 1 — MVP (P0)

Obiettivo: connessione, navigazione bucket/oggetti, upload/download base.

1. Scaffolding progetto Tauri + React + Vite
2. S3 Abstraction Layer (client configurabile, auth, signature V4)
3. Connection Manager (CRUD profili, credential store, test connessione)
4. Bucket Manager (list, create, delete, head)
5. Object Manager (list con paginazione, navigazione gerarchica, head)
6. Upload singolo e multipart
7. Download singolo con range support
8. Coda trasferimenti base (progresso, pausa, cancel)
9. UI: layout principale, sidebar, tabella oggetti, toolbar, breadcrumb
10. Presigned URL generation

### Fase 2 — Funzionalita' core (P1)

11. Eliminazione multipla, copia, spostamento, rinomina
12. Preview inline (immagini, testo con syntax highlighting)
13. Proprieta' bucket (versioning, encryption, policy viewer)
14. Versioning oggetti (list versions, download version)
15. Multipart upload avanzato (resume, retry)
16. Trasferimenti paralleli con concorrenza configurabile
17. Import connessioni da AWS CLI
18. Ricerca per prefisso/nome
19. Tema chiaro/scuro
20. Drag & drop upload

### Fase 3 — Avanzate (P2)

21. Sync unidirezionale con dry-run
22. Lifecycle rules editor
23. CORS / bucket policy editor (Monaco)
24. Operazioni batch
25. Bandwidth throttling con fasce orarie
26. Preview PDF, video, audio
27. Trasferimenti cross-connessione
28. Ricerca avanzata (metadata, date, dimensioni)
29. Export listing CSV/JSON
30. Terminale S3 integrato
31. Statistiche e monitoring
32. Auto-updater
33. i18n (italiano + inglese)

---

*Fine del documento — brows3r Stack Tecnologico v1.0-draft*
