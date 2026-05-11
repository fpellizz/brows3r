# brows3r — Specifiche Funzionali

**Versione:** 1.0-draft
**Data:** 2026-04-11

---

## 1. Scopo del progetto

**brows3r** e' un software cross-platform per la gestione e navigazione di repository object storage compatibili con il protocollo Amazon S3. Il software deve consentire all'utente di interagire con bucket e oggetti ospitati su provider cloud pubblici, privati e infrastrutture on-premise, attraverso un'interfaccia unificata.

---

## 2. Obiettivi principali

| # | Obiettivo |
|---|-----------|
| O1 | Fornire un'unica interfaccia per gestire storage S3-compatibile indipendentemente dal provider |
| O2 | Supportare connessioni simultanee a piu' endpoint/provider |
| O3 | Funzionare su Linux, macOS e Windows |
| O4 | Garantire la sicurezza delle credenziali e delle comunicazioni |
| O5 | Offrire prestazioni adeguate anche con bucket contenenti milioni di oggetti |

---

## 3. Provider e piattaforme supportate

### 3.1 Cloud pubblici

| Provider | Endpoint di riferimento | Note |
|----------|------------------------|------|
| Amazon Web Services (S3) | `s3.<region>.amazonaws.com` | Supporto regioni, S3 Express One Zone |
| Google Cloud Storage | `storage.googleapis.com` | Modalita' interoperabilita' S3 |
| Microsoft Azure Blob Storage | Via S3-compatible gateway | Richiede Azurite o gateway S3 |
| Oracle Cloud Infrastructure (OCI) | `<namespace>.compat.objectstorage.<region>.oraclecloud.com` | S3 Compatibility API |
| DigitalOcean Spaces | `<region>.digitaloceanspaces.com` | Pienamente S3-compatibile |
| Backblaze B2 | `s3.<region>.backblazeb2.com` | S3-compatible API |
| Wasabi | `s3.<region>.wasabisys.com` | S3-compatibile |
| Cloudflare R2 | `<account-id>.r2.cloudflarestorage.com` | S3-compatible, no egress fees |
| Scaleway Object Storage | `s3.<region>.scw.cloud` | S3-compatibile |
| OVHcloud Object Storage | `s3.<region>.io.cloud.ovh.net` | S3-compatible (High Performance) |
| Alibaba Cloud OSS | `oss-<region>.aliyuncs.com` | S3 compatibility mode |
| Linode (Akamai) Object Storage | `<cluster>.linodeobjects.com` | S3-compatibile |

### 3.2 Soluzioni on-premise / self-hosted

| Software | Note |
|----------|------|
| MinIO | Riferimento principale per S3-compatible on-premise |
| Ceph (RadosGW) | Gateway S3 per cluster Ceph |
| Dell ECS (Elastic Cloud Storage) | Enterprise object storage |
| NetApp StorageGRID | Enterprise S3-compatible |
| OpenIO | Open-source object storage |
| Seaweed FS | Distributed file system con S3 API |
| LakeFS | Data versioning su S3-compatible backend |
| Garage | Lightweight self-hosted S3-compatible |
| Zenko CloudServer | Open-source S3 server (Scality) |

### 3.3 Requisiti di compatibilita'

Il software deve basarsi sulle API S3 standard e non dipendere da estensioni proprietarie. La compatibilita' con un nuovo provider si ottiene configurando:

- **Endpoint URL** (con supporto path-style e virtual-hosted-style, con auto-detection dall'host)
- **Regione** (o valore fittizio per provider che non la richiedono)
- **Credenziali** (Access Key / Secret Key)
- **Signature Version**: solo V4 (lo stack AWS SDK Rust non supporta V2; era cosmetica nella vecchia UI ed è stata rimossa)

---

## 4. Architettura funzionale

### 4.1 Moduli principali

```
+-------------------------------------------------------------------+
|                         INTERFACCIA UTENTE                        |
|  (GUI cross-platform)                                             |
+-------------------------------------------------------------------+
         |               |               |              |
+----------------+ +-------------+ +-------------+ +-----------+
| Connection     | | Bucket      | | Object      | | Transfer  |
| Manager        | | Manager     | | Manager     | | Engine    |
+----------------+ +-------------+ +-------------+ +-----------+
         |               |               |              |
+-------------------------------------------------------------------+
|                     S3 ABSTRACTION LAYER                          |
|  (Gestione protocollo, firma richieste, retry, throttling)        |
+-------------------------------------------------------------------+
         |
+-------------------------------------------------------------------+
|                     CREDENTIAL STORE                              |
|  (Storage sicuro credenziali, integrazione keychain OS)           |
+-------------------------------------------------------------------+
```

### 4.2 S3 Abstraction Layer

Il layer di astrazione deve:

- Implementare la firma delle richieste con AWS Signature V4 (V2 non supportato — l'AWS SDK Rust è SigV4-only)
- Supportare sia **path-style** (`endpoint/bucket/key`) che **virtual-hosted-style** (`bucket.endpoint/key`), con auto-detection dall'host
- Gestire retry automatico con backoff esponenziale (numero retry configurabile per connessione)
- Implementare throttling adattivo in caso di rate limiting (HTTP 429 / 503 SlowDown)
- Supportare connessioni HTTP e HTTPS
- Permettere la configurazione di proxy HTTP/HTTPS per connessione
- Supportare certificati TLS custom (self-signed) per ambienti on-premise via CA bundle PEM

---

## 5. Gestione connessioni

### 5.1 Profili di connessione

Ogni profilo di connessione (denominato "Connessione" o "Connection") contiene:

| Campo | Obbligatorio | Descrizione |
|-------|:------------:|-------------|
| Nome | Si | Identificativo univoco definito dall'utente |
| Endpoint URL | Si | URL del servizio S3 (es. `https://s3.eu-west-1.amazonaws.com`) |
| Regione | Si | Regione AWS o equivalente (es. `eu-west-1`, `us-east-1`, `auto`) |
| Access Key ID | Si | Chiave di accesso |
| Secret Access Key | Si | Chiave segreta |
| Session Token | No | Token di sessione per credenziali temporanee (STS) |
| Path Style | No | `auto`, `path` o `virtual` (default: `auto` — la UI non mostra Signature V perché lo stack è SigV4-only) |
| Proxy | No | URL proxy HTTP/HTTPS (es. `http://corp-proxy:8080`); SOCKS5 non ancora supportato |
| CA Bundle | No | Percorso a file PEM con certificati CA custom (aggiunti ai root di sistema) |
| Timeout connessione | No | Timeout in secondi (default: 30) |
| Max tentativi retry | No | Numero di retry oltre il primo tentativo (default: 3) |
| Note | No | Campo testo libero per annotazioni utente |

### 5.2 Metodi di autenticazione

| Metodo | Descrizione |
|--------|-------------|
| Access Key + Secret Key | Credenziali statiche (modalita' principale) |
| STS / Credenziali temporanee | Access Key + Secret Key + Session Token con scadenza |
| AWS Profiles | Import da `~/.aws/credentials` e `~/.aws/config` |
| Environment Variables | Lettura da `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` |
| IAM Instance Role | Rilevamento automatico su istanze EC2/ECS (metadata endpoint) |
| Assume Role | Assunzione di un ruolo IAM tramite STS AssumeRole |

### 5.3 Test di connessione

Il software deve fornire una funzione "Test connessione" che:

1. Verifica la raggiungibilita' dell'endpoint
2. Verifica la validita' delle credenziali (`ListBuckets` o `HeadBucket`)
3. Riporta eventuali errori in modo chiaro (DNS, TLS, autenticazione, autorizzazione)
4. Misura e mostra la latenza dell'endpoint

### 5.4 Gestione multi-connessione

- L'utente puo' configurare un numero illimitato di connessioni
- Piu' connessioni possono essere attive contemporaneamente
- Ogni connessione appare come nodo radice nella vista ad albero
- Possibilita' di raggruppare le connessioni in cartelle logiche (es. "Produzione", "Staging", "Dev")

---

## 6. Gestione bucket

### 6.1 Operazioni sui bucket

| Operazione | API S3 | Descrizione |
|------------|--------|-------------|
| Elenco bucket | `ListBuckets` | Visualizzazione di tutti i bucket accessibili |
| Creazione bucket | `CreateBucket` | Con selezione regione e opzioni di configurazione |
| Eliminazione bucket | `DeleteBucket` | Con conferma esplicita; opzione per svuotamento preventivo |
| Informazioni bucket | `GetBucketLocation`, `GetBucketVersioning`, etc. | Pannello dettagli |

### 6.2 Proprieta' bucket visualizzabili

- Regione
- Data creazione (se disponibile)
- Stato versioning (Enabled / Suspended / Disabled)
- Stato encryption (tipo e chiave KMS se applicabile)
- Policy di accesso (visualizzazione JSON della bucket policy)
- CORS configuration
- Lifecycle rules
- Logging configuration
- Numero oggetti e dimensione totale (se il provider lo supporta)

### 6.3 Configurazione bucket (se i permessi lo consentono)

- Abilitazione/disabilitazione versioning
- Configurazione lifecycle rules (con editor visuale)
- Configurazione CORS
- Modifica bucket policy (editor JSON con validazione)
- Configurazione server-side encryption di default
- Configurazione static website hosting

---

## 7. Gestione oggetti

### 7.1 Navigazione

- **Vista gerarchica (folder-like):** navigazione tramite prefissi con delimitatore `/`, presentata come albero di cartelle
- **Vista flat:** elenco completo di tutti gli oggetti senza raggruppamento per prefisso
- **Paginazione progressiva:** caricamento lazy con `ListObjectsV2` e continuation token
- **Ricerca:** filtro per prefisso/nome con supporto wildcard e regex
- **Ordinamento:** per nome, dimensione, data ultima modifica, storage class
- **Breadcrumb:** navigazione rapida tramite percorso cliccabile

### 7.2 Operazioni sugli oggetti

| Operazione | API S3 | Descrizione |
|------------|--------|-------------|
| Elenco oggetti | `ListObjectsV2` | Con paginazione e filtro per prefisso |
| Upload singolo | `PutObject` | Per file fino alla soglia multipart |
| Upload multipart | `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload` | Per file sopra la soglia configurabile (default 100 MB) |
| Download | `GetObject` | Con supporto range request per resume |
| Eliminazione singola | `DeleteObject` | Con conferma |
| Eliminazione multipla | `DeleteObjects` | Batch fino a 1000 oggetti per richiesta |
| Copia | `CopyObject` | Intra-bucket e cross-bucket (anche cross-connessione) |
| Spostamento | `CopyObject` + `DeleteObject` | Copia seguita da eliminazione dell'originale |
| Rinomina | `CopyObject` + `DeleteObject` | Equivalente a spostamento con nuovo nome |
| Creazione "cartella" | `PutObject` con key terminante in `/` | Crea un prefisso vuoto |
| Generazione URL pre-firmato | `Presign GetObject` / `Presign PutObject` | Con scadenza configurabile |
| Visualizzazione metadata | `HeadObject` | Content-Type, dimensione, ETag, metadata custom |
| Modifica metadata | `CopyObject` con `MetadataDirective=REPLACE` | Editing dei metadata custom |
| Modifica storage class | `CopyObject` con `StorageClass` | Cambio classe di storage |
| Restore da Glacier/Archive | `RestoreObject` | Per oggetti in classi di archiviazione |

### 7.3 Preview e visualizzazione inline

Il software deve supportare l'anteprima integrata per i seguenti formati:

| Categoria | Formati |
|-----------|---------|
| Immagini | JPEG, PNG, GIF, BMP, WebP, SVG, TIFF, ICO |
| Testo | TXT, CSV, TSV, JSON, XML, YAML, TOML, INI, LOG |
| Codice sorgente | Syntax highlighting per i linguaggi piu' comuni (rilevamento da estensione) |
| Markdown | Rendering formattato |
| PDF | Visualizzazione integrata |
| Video | MP4, WebM (streaming via range request) |
| Audio | MP3, OGG, WAV, FLAC (player integrato) |

Per i file non supportati o di dimensioni eccessive, mostrare le informazioni del file (metadata, dimensione, tipo MIME) e offrire il download.

### 7.4 Versioning degli oggetti

Quando il versioning e' abilitato sul bucket:

- Visualizzare l'elenco delle versioni di ogni oggetto
- Consentire il download di una versione specifica
- Consentire il restore di una versione precedente (copia come versione corrente)
- Visualizzare i delete marker
- Consentire l'eliminazione permanente di una versione specifica
- Confronto tra versioni (per file di testo)

---

## 8. Motore di trasferimento

### 8.1 Upload

- **Drag & drop** di file e cartelle dalla GUI
- **Upload multipart automatico** sopra soglia configurabile (default: 100 MB)
- **Dimensione parte configurabile** (default: 8 MB, min 5 MB, max 5 GB)
- **Upload parallelo:** upload simultaneo di piu' parti e/o piu' file
- **Concorrenza configurabile:** numero di trasferimenti simultanei (default: 4) e parti simultanee per file (default: 4)
- **Calcolo checksum:** MD5, SHA-256 per verifica integrita'
- **Preservazione struttura directory:** upload ricorsivo di cartelle mantenendo la gerarchia
- **Filtri di esclusione:** pattern glob per escludere file dall'upload (es. `*.tmp`, `.DS_Store`)
- **Rilevamento conflitti:** opzioni configurabili (sovrascrivi, rinomina, salta, chiedi)

### 8.2 Download

- **Download singolo e multiplo** (selezione multipla)
- **Download ricorsivo** di "cartelle" (prefissi) con preservazione struttura
- **Resume download** tramite HTTP Range header
- **Download parallelo:** segmentazione file grandi in range paralleli
- **Verifica integrita':** confronto ETag/checksum dopo il download
- **Scelta destinazione:** dialog di selezione cartella locale

### 8.3 Coda di trasferimento

- **Coda centralizzata** per tutti i trasferimenti (upload e download)
- **Prioritizzazione:** possibilita' di riordinare i trasferimenti in coda
- **Pausa/Resume:** per singolo trasferimento e per l'intera coda
- **Annullamento:** con cleanup delle parti multipart incomplete (`AbortMultipartUpload`)
- **Retry automatico:** con backoff esponenziale per errori transitori
- **Persistenza coda:** i trasferimenti non completati sopravvivono al riavvio dell'applicazione
- **Stato dettagliato per ogni trasferimento:**
  - Nome file e percorso destinazione
  - Dimensione totale e trasferita
  - Velocita' corrente e media
  - Tempo stimato rimanente
  - Barra di progresso
  - Stato (in coda, in corso, in pausa, completato, errore)
  - Dettaglio errore con opzione retry manuale

### 8.4 Trasferimenti cross-connessione

- Copia di oggetti tra bucket appartenenti a connessioni diverse
- Implementazione tramite download temporaneo + upload (server-side copy non disponibile cross-account/cross-provider)
- Opzione per mantenere i metadata originali

### 8.5 Limiti e throttling

- **Banda massima configurabile** (globale e per connessione) in KB/s, MB/s
- **Limiti orari configurabili:** possibilita' di definire fasce orarie con limiti diversi (es. banda ridotta in orario lavorativo)
- **Rispetto dei rate limit** del provider (backoff su HTTP 429/503)

---

## 9. Funzionalita' avanzate

### 9.1 Sincronizzazione

- **Sync unidirezionale:** locale -> remoto e remoto -> locale
- **Modalita' sync:**
  - Solo nuovi (file che non esistono nella destinazione)
  - Aggiornati (confronto per dimensione e/o data modifica e/o ETag)
  - Mirror (la destinazione diventa copia esatta della sorgente, con eliminazione file in eccesso)
- **Dry-run:** simulazione che mostra le operazioni che verrebbero eseguite senza effettuarle
- **Filtri:** inclusione/esclusione per pattern, dimensione, data
- **Log dettagliato** delle operazioni di sync

### 9.2 Ricerca avanzata

- Ricerca per nome (con wildcard e regex) all'interno di un bucket o prefisso
- Ricerca per metadata (key-value)
- Ricerca per intervallo di date (ultima modifica)
- Ricerca per intervallo di dimensioni
- Ricerca per storage class
- Ricerca full-text nel contenuto dei file di testo (opzionale, con limite di dimensione)

### 9.3 Operazioni batch

- Eliminazione massiva con filtri
- Modifica massiva dei metadata
- Modifica massiva della storage class
- Modifica massiva degli ACL/permessi
- Generazione massiva di URL pre-firmati
- Export elenco oggetti in CSV/JSON

### 9.4 Terminale S3 / CLI integrata

- Interfaccia a riga di comando integrata nella GUI
- Sintassi ispirata ai comandi Unix (`ls`, `cp`, `mv`, `rm`, `cat`, `head`)
- Autocompletamento di percorsi e bucket
- Storico comandi
- Output formattato e filtrabile

### 9.5 Editor di bucket policy e IAM

- Editor JSON con syntax highlighting
- Validazione sintattica e semantica delle policy
- Template predefiniti per le policy piu' comuni (public read, cross-account, IP restriction, ecc.)
- Diff visuale per confronto tra policy

### 9.6 Monitoring e statistiche

- Dashboard con statistiche di utilizzo per connessione/bucket:
  - Numero oggetti
  - Spazio occupato totale e per storage class
  - Distribuzione per tipo di file
  - Oggetti piu' grandi
- Storico trasferimenti (log persistente con filtri)
- Grafico velocita' trasferimento in tempo reale

---

## 10. Interfaccia utente

### 10.1 Layout principale

```
+------------------------------------------------------------------+
| Menu | Toolbar (connetti, upload, download, sync, ricerca)       |
+------------------------------------------------------------------+
| Pannello    | Pannello contenuto                          | Info |
| laterale    |                                             | pane |
|             | +------------------------------------------+|      |
| - Conn. 1   | | Breadcrumb: bucket / prefix1 / prefix2  ||      |
|   - Bucket A| +------------------------------------------+|      |
|   - Bucket B| | [x] Nome       Dim.   Data     Classe   ||      |
| - Conn. 2   | | [ ] file1.txt  1.2MB  2026-04  STANDARD ||      |
|   - Bucket C| | [ ] file2.jpg  3.4MB  2026-03  STANDARD ||      |
|   - Bucket D| | [x] img/       -      -        -        ||      |
|              | | [ ] doc.pdf    512KB  2026-04  IA       ||      |
|              | |                                          ||      |
+------------------------------------------------------------------+
| Coda trasferimenti                                   | Terminale |
| file1.txt  =====>-------  45%  2.3 MB/s  ETA 0:32   |  s3> _   |
| file2.jpg  in coda                                   |           |
+------------------------------------------------------------------+
| Status bar: connessioni attive | oggetti selezionati | spazio   |
+------------------------------------------------------------------+
```

### 10.2 Requisiti UI

- **Layout a pannelli ridimensionabili** (splitter)
- **Vista ad albero** nel pannello laterale per connessioni e bucket
- **Vista tabellare** nel pannello principale per gli oggetti con:
  - Selezione multipla (checkbox, Ctrl+click, Shift+click)
  - Ordinamento per colonna
  - Ridimensionamento colonne
  - Menu contestuale (tasto destro)
- **Pannello dettagli/anteprima** (toggle) sul lato destro
- **Pannello coda trasferimenti** (toggle) in basso
- **Pannello terminale** (toggle) in basso
- **Drag & drop:**
  - Da filesystem locale alla vista oggetti (upload)
  - Dalla vista oggetti al filesystem locale (download)
  - Tra pannelli diversi (copia cross-bucket)
- **Shortcut da tastiera** per tutte le operazioni principali
- **Tema chiaro e scuro** con selezione automatica basata su preferenze OS
- **Personalizzazione colonne** visibili nella vista tabellare
- **Tab multipli** per navigare piu' bucket/percorsi contemporaneamente
- **Barra degli indirizzi** editabile (navigazione diretta tramite percorso `s3://bucket/prefix`)

### 10.3 Accessibilita'

- Navigazione completa da tastiera
- Compatibilita' con screen reader (ARIA labels / accessibilita' nativa OS)
- Contrasto sufficiente in entrambi i temi (WCAG 2.1 AA)
- Dimensione font configurabile

---

## 11. Sicurezza

### 11.1 Gestione credenziali

- Le credenziali (Secret Access Key, Session Token) devono essere **cifrate a riposo**
- Integrazione con il keychain/credential manager nativo dell'OS:
  - **macOS:** Keychain
  - **Windows:** Credential Manager / DPAPI
  - **Linux:** libsecret (GNOME Keyring / KDE Wallet) oppure file cifrato con master password
- Opzione master password per cifrare il database credenziali (per ambienti senza keychain)
- Le credenziali non devono mai apparire in chiaro nei log o nei file di configurazione
- Possibilita' di impostare un timeout di blocco (richiede re-autenticazione dopo periodo di inattivita')

### 11.2 Comunicazioni

- **HTTPS obbligatorio di default** (con override esplicito per ambienti di test/sviluppo)
- Validazione certificati TLS con possibilita' di aggiungere CA custom
- Supporto TLS 1.2 come versione minima
- Opzione per accettare certificati self-signed (con warning visibile)

### 11.3 Sicurezza applicativa

- Nessun dato sensibile nei log applicativi (le secret key devono essere mascherate)
- Firma delle richieste S3 conforme alle specifiche (no leak di credenziali nelle URL se non per presigned URL)
- Aggiornamento automatico o notifica disponibilita' aggiornamenti (verifica firma del pacchetto)
- Possibilita' di disabilitare funzionalita' pericolose (es. eliminazione bucket) tramite configurazione

---

## 12. Configurazione e persistenza

### 12.1 File di configurazione

- Formato: JSON o YAML
- Posizione:
  - **Linux:** `~/.config/brows3r/`
  - **macOS:** `~/Library/Application Support/brows3r/`
  - **Windows:** `%APPDATA%\brows3r\`
- Contenuto:
  - Profili di connessione (senza secret key, che risiede nel keychain)
  - Preferenze UI (tema, layout, dimensioni pannelli)
  - Impostazioni trasferimento (concorrenza, soglia multipart, limiti banda)
  - Filtri di esclusione globali
  - Shortcut personalizzati

### 12.2 Import/Export

- **Export configurazione:** esportazione profili di connessione in formato cifrato (con password) o in chiaro (senza secret key)
- **Import configurazione:** importazione da file esportato
- **Import da strumenti esistenti:**
  - AWS CLI (`~/.aws/credentials`, `~/.aws/config`)
  - s3cmd (`~/.s3cfg`)
  - rclone (`~/.config/rclone/rclone.conf`)
  - MinIO Client (`~/.mc/config.json`)

### 12.3 Logging

- Log applicativo con livelli configurabili (ERROR, WARN, INFO, DEBUG, TRACE)
- Log trasferimenti separato (storico operazioni)
- Rotazione log automatica (dimensione e/o data)
- Possibilita' di abilitare log delle richieste HTTP per debugging (con mascheramento credenziali)

---

## 13. Requisiti non funzionali

### 13.1 Piattaforme supportate

| Piattaforma | Versioni minime |
|-------------|----------------|
| Linux | Ubuntu 22.04+, Fedora 38+, Debian 12+ (x86_64, arm64) |
| macOS | 12 Monterey+ (Apple Silicon e Intel) |
| Windows | 10 21H2+ / 11 (x86_64, arm64) |

### 13.2 Prestazioni

| Metrica | Target |
|---------|--------|
| Tempo di avvio applicazione | < 3 secondi |
| Listing di 10.000 oggetti | < 5 secondi (esclusa latenza rete) |
| Memoria RAM in idle | < 150 MB |
| Memoria RAM con listing 100K oggetti | < 500 MB |
| Throughput upload/download | Saturazione della banda disponibile con concorrenza >= 4 |
| Responsivita' UI durante trasferimenti | Nessun freeze (operazioni I/O su thread separati) |

### 13.3 Affidabilita'

- Nessuna perdita dati in caso di crash durante upload multipart (cleanup o resume al riavvio)
- Gestione graceful di disconnessioni di rete (pausa automatica e retry alla riconnessione)
- Validazione integrita' tramite checksum per ogni trasferimento completato

### 13.4 Internazionalizzazione (i18n)

- Interfaccia disponibile almeno in: Italiano, Inglese
- Architettura predisposta per l'aggiunta di ulteriori lingue (file di traduzione esterni)
- Formattazione date, numeri e dimensioni file secondo la locale del sistema

### 13.5 Distribuzione e installazione

| Piattaforma | Formato distribuzione |
|-------------|----------------------|
| Linux | AppImage, .deb, .rpm, Flatpak, Snap |
| macOS | .dmg (universal binary), Homebrew cask |
| Windows | .msi installer, portable .zip, winget |

- Aggiornamento automatico in-app (con verifica firma digitale)
- Possibilita' di installazione silente per deployment aziendale

---

## 14. Operazioni S3 API — Copertura richiesta

### 14.1 Operazioni su bucket

| Operazione | Priorita' |
|------------|:---------:|
| `ListBuckets` | P0 |
| `CreateBucket` | P0 |
| `DeleteBucket` | P0 |
| `HeadBucket` | P0 |
| `GetBucketLocation` | P0 |
| `GetBucketVersioning` / `PutBucketVersioning` | P1 |
| `GetBucketEncryption` / `PutBucketEncryption` | P1 |
| `GetBucketPolicy` / `PutBucketPolicy` / `DeleteBucketPolicy` | P1 |
| `GetBucketCors` / `PutBucketCors` / `DeleteBucketCors` | P2 |
| `GetBucketLifecycleConfiguration` / `PutBucketLifecycleConfiguration` | P2 |
| `GetBucketLogging` / `PutBucketLogging` | P2 |
| `GetBucketWebsite` / `PutBucketWebsite` / `DeleteBucketWebsite` | P2 |
| `GetBucketTagging` / `PutBucketTagging` / `DeleteBucketTagging` | P2 |
| `GetBucketNotificationConfiguration` | P3 |

### 14.2 Operazioni su oggetti

| Operazione | Priorita' |
|------------|:---------:|
| `ListObjectsV2` | P0 |
| `GetObject` | P0 |
| `PutObject` | P0 |
| `DeleteObject` | P0 |
| `DeleteObjects` (batch) | P0 |
| `HeadObject` | P0 |
| `CopyObject` | P0 |
| `CreateMultipartUpload` | P0 |
| `UploadPart` | P0 |
| `CompleteMultipartUpload` | P0 |
| `AbortMultipartUpload` | P0 |
| `ListMultipartUploads` | P1 |
| `ListParts` | P1 |
| `ListObjectVersions` | P1 |
| `RestoreObject` | P2 |
| `GetObjectTagging` / `PutObjectTagging` | P2 |
| `GetObjectAcl` / `PutObjectAcl` | P2 |
| `SelectObjectContent` (S3 Select) | P3 |

### 14.3 Altre operazioni

| Operazione | Priorita' |
|------------|:---------:|
| Presigned URL (GET/PUT) | P0 |
| STS `AssumeRole` | P1 |
| STS `GetSessionToken` | P2 |

**Legenda priorita':**
- **P0:** Funzionalita' core, indispensabile per il rilascio iniziale
- **P1:** Importante, prevista per il rilascio iniziale o la prima minor release
- **P2:** Desiderabile, pianificata per release successive
- **P3:** Nice-to-have, da valutare in base a feedback utenti

---

## 15. Glossario

| Termine | Definizione |
|---------|-------------|
| **Bucket** | Container di primo livello per gli oggetti in un servizio S3 |
| **Oggetto** | Unita' di dati memorizzata in un bucket, identificata da una key univoca |
| **Key** | Identificativo univoco di un oggetto all'interno di un bucket (equivalente al percorso file) |
| **Prefisso** | Parte iniziale della key, usato per simulare una struttura gerarchica a cartelle |
| **ETag** | Hash (tipicamente MD5) dell'oggetto, usato per verifica integrita' e confronto |
| **Multipart Upload** | Meccanismo per caricare oggetti grandi in parti indipendenti |
| **Presigned URL** | URL firmato che consente l'accesso temporaneo a un oggetto senza credenziali |
| **Storage Class** | Categoria di storage che determina costo, durabilita' e tempi di accesso |
| **Versioning** | Funzionalita' che mantiene tutte le versioni di un oggetto nel bucket |
| **Path-style** | Formato URL `endpoint/bucket/key` (legacy ma necessario per alcuni provider) |
| **Virtual-hosted-style** | Formato URL `bucket.endpoint/key` (default per AWS) |
| **Signature V4** | Algoritmo standard per la firma delle richieste S3 |

---

*Fine del documento — brows3r Specifiche Funzionali v1.0-draft*
