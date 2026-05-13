// Updater install-kind detection.
//
// The Tauri updater plugin can perform an in-place upgrade only for
// AppImage (Linux), NSIS (Windows) and `.app.tar.gz` (macOS). For users
// who installed brows3r from the `.deb` / `.rpm`, replacing the binary
// in `/usr/bin` would clash with the package manager database, so we
// expose the install kind to the frontend and show a "new version
// available, download here" banner instead of triggering the updater.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)] // variants are platform-specific; cfg gating hides others
pub enum InstallKind {
    /// Linux AppImage (env `APPIMAGE` set by the AppImage runtime).
    AppImage,
    /// Linux installed via apt/dpkg or dnf/rpm — package manager owns
    /// the binary, the updater must NOT touch it.
    LinuxSystem,
    /// Windows NSIS installer (the updater downloads and re-runs it).
    WindowsNsis,
    /// macOS `.app` bundle.
    MacApp,
    /// `cargo tauri dev` / `cargo run` — never offer updates.
    Dev,
    /// Anything we can't classify.
    Unknown,
}

impl InstallKind {
    /// Whether the Tauri updater plugin can perform an in-place upgrade
    /// for this install. When `false`, the frontend should only notify
    /// the user that a new version exists and let them download it
    /// manually.
    fn supports_in_place_update(self) -> bool {
        matches!(self, Self::AppImage | Self::WindowsNsis | Self::MacApp)
    }
}

#[derive(Debug, Serialize)]
pub struct InstallInfo {
    pub kind: InstallKind,
    pub supports_in_place_update: bool,
}

fn detect_install_kind() -> InstallKind {
    if cfg!(debug_assertions) {
        return InstallKind::Dev;
    }

    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("APPIMAGE").is_some() {
            return InstallKind::AppImage;
        }
        return InstallKind::LinuxSystem;
    }

    #[cfg(target_os = "windows")]
    {
        return InstallKind::WindowsNsis;
    }

    #[cfg(target_os = "macos")]
    {
        return InstallKind::MacApp;
    }

    #[allow(unreachable_code)]
    InstallKind::Unknown
}

#[tauri::command]
pub fn get_install_info() -> InstallInfo {
    let kind = detect_install_kind();
    InstallInfo {
        kind,
        supports_in_place_update: kind.supports_in_place_update(),
    }
}
