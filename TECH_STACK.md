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

| Step | Tool |
|------|------|
| **CI** | Bitbucket Pipelines |
| **Lint Rust** | clippy |
| **Lint TS** | Biome (lint + format, sostituto di ESLint + Prettier) |
| **Format Rust** | rustfmt |
| **Build Linux** | Bitbucket Pipelines (ubuntu:24.04, step 2x per Rust) |
| **Release** | Tauri updater + Bitbucket Downloads (upload via API su tag `v*`) |
| **Code signing** | Apple Developer ID + Windows Authenticode + GPG per Linux |

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
