#Requires -Version 5.1
<#
.SYNOPSIS
    brows3r - Script di build per Windows.
    Installa automaticamente le dipendenze mancanti e genera il pacchetto .exe (NSIS installer).

.DESCRIPTION
    Dipendenze gestite:
    - Visual Studio Build Tools (C++ workload)
    - Rust (via rustup)
    - Node.js 22 LTS
    - pnpm
    - Tauri CLI
    - WebView2 (incluso in Windows 10 21H2+ / Windows 11)

.NOTES
    Lanciare da build-windows.bat per bypassare le execution policy.
    Richiede connessione internet per il download delle dipendenze.
    Alcune installazioni richiedono privilegi di amministratore.
#>

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # Velocizza Invoke-WebRequest

# ── Colori ──────────────────────────────────────────────────
function Write-Step  { param($msg) Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-OK    { param($msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "[X] $msg" -ForegroundColor Red }

# ── Helpers ─────────────────────────────────────────────────
function Test-Command { param($cmd) return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
    # Aggiungi cargo al PATH se esiste
    $cargoPath = "$env:USERPROFILE\.cargo\bin"
    if (Test-Path $cargoPath) {
        $env:Path = "$cargoPath;$env:Path"
    }
}

function Get-TempFile { param($name) return Join-Path $env:TEMP $name }

# ── Controlla se siamo nella root del progetto ──────────────
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $projectRoot

if (-not (Test-Path "src-tauri\Cargo.toml")) {
    Write-Err "Impossibile trovare src-tauri\Cargo.toml. Eseguire dalla root del progetto."
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor White
Write-Host "  brows3r - Build Windows" -ForegroundColor White
Write-Host "  Progetto: $projectRoot" -ForegroundColor DarkGray
Write-Host "============================================" -ForegroundColor White
Write-Host ""

# ════════════════════════════════════════════════════════════
# 1. Visual Studio Build Tools (C++ compiler)
# ════════════════════════════════════════════════════════════
Write-Step "Verifica Visual Studio Build Tools / C++ compiler..."

$hasVS = $false
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWhere) {
    $vsInstalls = & $vsWhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($vsInstalls) { $hasVS = $true }
}

# Fallback: check for cl.exe in PATH
if (-not $hasVS -and (Test-Command "cl")) { $hasVS = $true }

if ($hasVS) {
    Write-OK "C++ Build Tools trovati"
} else {
    Write-Warn "Visual Studio Build Tools non trovati. Installazione in corso..."
    Write-Warn "NOTA: Questa installazione richiede privilegi di amministratore e puo' richiedere diversi minuti."

    $vsInstaller = Get-TempFile "vs_buildtools.exe"
    Write-Step "Download Visual Studio Build Tools..."
    Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_buildtools.exe" -OutFile $vsInstaller

    Write-Step "Installazione Build Tools (C++ workload)..."
    $proc = Start-Process -FilePath $vsInstaller -ArgumentList `
        "--quiet", "--wait", "--norestart", `
        "--add", "Microsoft.VisualStudio.Workload.VCTools", `
        "--includeRecommended" `
        -Wait -PassThru

    if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
        Write-Err "Installazione Build Tools fallita (exit code: $($proc.ExitCode))"
        Write-Err "Installa manualmente da: https://visualstudio.microsoft.com/visual-cpp-build-tools/"
        exit 1
    }

    Remove-Item $vsInstaller -Force -ErrorAction SilentlyContinue
    Write-OK "Visual Studio Build Tools installati (potrebbe servire un riavvio)"
}

# ════════════════════════════════════════════════════════════
# 2. Rust
# ════════════════════════════════════════════════════════════
Write-Step "Verifica Rust..."
Refresh-Path

if (Test-Command "rustc") {
    $rustVersion = (rustc --version) -replace "rustc\s+", ""
    Write-OK "Rust trovato: $rustVersion"
} elseif (Test-Command "rustup") {
    # rustup exists but rustc not in PATH — update and refresh
    Write-Step "rustup presente, aggiornamento toolchain..."
    $ErrorActionPreference = "Continue"
    & rustup update stable 2>&1 | Out-Null
    $ErrorActionPreference = "Stop"
    Refresh-Path
    if (Test-Command "rustc") {
        Write-OK "Rust aggiornato: $((rustc --version) -replace 'rustc\s+', '')"
    } else {
        Write-Err "rustc non trovato dopo update. Riavvia il terminale e riprova."
        exit 1
    }
} else {
    Write-Step "Installazione Rust via rustup..."
    $rustupInit = Get-TempFile "rustup-init.exe"
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupInit

    # Temporarily allow non-fatal stderr (rustup-init emits warnings about
    # existing configs that PowerShell treats as terminating errors).
    $ErrorActionPreference = "Continue"
    & $rustupInit -y --default-toolchain stable 2>&1 | Out-Null
    $ErrorActionPreference = "Stop"
    Remove-Item $rustupInit -Force -ErrorAction SilentlyContinue

    Refresh-Path

    if (-not (Test-Command "rustc")) {
        Write-Err "Rust non trovato dopo l'installazione. Riavvia il terminale e riprova."
        exit 1
    }
    Write-OK "Rust installato: $((rustc --version) -replace 'rustc\s+', '')"
}

# ════════════════════════════════════════════════════════════
# 3. Node.js
# ════════════════════════════════════════════════════════════
Write-Step "Verifica Node.js..."
Refresh-Path

$needNode = $true
if (Test-Command "node") {
    $nodeVersion = (node --version) -replace "v", ""
    $nodeMajor = [int]($nodeVersion.Split(".")[0])
    if ($nodeMajor -ge 20) {
        Write-OK "Node.js trovato: v$nodeVersion"
        $needNode = $false
    } else {
        Write-Warn "Node.js v$nodeVersion trovato, serve v20+. Aggiornamento..."
    }
}

if ($needNode) {
    Write-Step "Installazione Node.js 22 LTS..."
    $nodeInstaller = Get-TempFile "node-v22-setup.msi"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi" -OutFile $nodeInstaller

    $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i", $nodeInstaller, "/quiet", "/norestart" -Wait -PassThru
    Remove-Item $nodeInstaller -Force -ErrorAction SilentlyContinue

    Refresh-Path

    if (-not (Test-Command "node")) {
        Write-Err "Node.js non trovato dopo l'installazione. Riavvia il terminale e riprova."
        exit 1
    }
    Write-OK "Node.js installato: $((node --version))"
}

# ════════════════════════════════════════════════════════════
# 4. pnpm
# ════════════════════════════════════════════════════════════
Write-Step "Verifica pnpm..."
Refresh-Path

if (Test-Command "pnpm") {
    Write-OK "pnpm trovato: $((pnpm --version))"
} else {
    Write-Step "Installazione pnpm..."
    try {
        corepack enable 2>&1 | Out-Null
        corepack prepare pnpm@latest --activate 2>&1 | Out-Null
    } catch {
        npm install -g pnpm 2>&1 | Out-Null
    }

    Refresh-Path

    if (-not (Test-Command "pnpm")) {
        Write-Err "pnpm non trovato dopo l'installazione."
        exit 1
    }
    Write-OK "pnpm installato: $((pnpm --version))"
}

# ════════════════════════════════════════════════════════════
# 5. Tauri CLI
# ════════════════════════════════════════════════════════════
Write-Step "Verifica Tauri CLI..."

$hasTauriCli = $false
try {
    $tauriVersion = cargo tauri --version 2>&1
    if ($LASTEXITCODE -eq 0) { $hasTauriCli = $true }
} catch {}

if ($hasTauriCli) {
    Write-OK "Tauri CLI trovato: $tauriVersion"
} else {
    Write-Step "Installazione Tauri CLI (puo' richiedere qualche minuto)..."
    $ErrorActionPreference = "Continue"
    cargo install tauri-cli --locked 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    $ErrorActionPreference = "Stop"
    Write-OK "Tauri CLI installato"
}

# ════════════════════════════════════════════════════════════
# 6. Installa dipendenze progetto
# ════════════════════════════════════════════════════════════
Write-Step "Installazione dipendenze frontend..."
$ErrorActionPreference = "Continue"
pnpm install 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
$ErrorActionPreference = "Stop"
Write-OK "Dipendenze frontend installate"

# ════════════════════════════════════════════════════════════
# 7. BUILD
# ════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Avvio build..." -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$buildStart = Get-Date
$ErrorActionPreference = "Continue"
pnpm tauri build 2>&1 | ForEach-Object { Write-Host $_ }
$ErrorActionPreference = "Stop"

if ($LASTEXITCODE -ne 0) {
    Write-Err "Build fallita!"
    exit 1
}

$buildTime = [math]::Round(((Get-Date) - $buildStart).TotalSeconds)

# ════════════════════════════════════════════════════════════
# 8. Risultato
# ════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Build completata in ${buildTime}s" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

$bundlePath = Join-Path $projectRoot "src-tauri\target\release\bundle"

# NSIS installer
$nsisDir = Join-Path $bundlePath "nsis"
if (Test-Path $nsisDir) {
    Write-Host "  NSIS Installer:" -ForegroundColor White
    Get-ChildItem $nsisDir -Filter "*.exe" | ForEach-Object {
        $size = [math]::Round($_.Length / 1MB, 1)
        Write-Host "    $($_.FullName)" -ForegroundColor Cyan
        Write-Host "    Dimensione: ${size} MB" -ForegroundColor DarkGray
    }
}

# MSI (se generato)
$msiDir = Join-Path $bundlePath "msi"
if (Test-Path $msiDir) {
    Write-Host ""
    Write-Host "  MSI Installer:" -ForegroundColor White
    Get-ChildItem $msiDir -Filter "*.msi" | ForEach-Object {
        $size = [math]::Round($_.Length / 1MB, 1)
        Write-Host "    $($_.FullName)" -ForegroundColor Cyan
        Write-Host "    Dimensione: ${size} MB" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "  Cartella bundle: $bundlePath" -ForegroundColor DarkGray
Write-Host ""

# Apri la cartella nel file explorer
explorer.exe $bundlePath
