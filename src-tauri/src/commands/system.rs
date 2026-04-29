use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MissingLibrary {
    pub soname: String,
    pub description: String,
    pub deb_package: String,
    pub rpm_package: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SystemPrerequisitesReport {
    pub os: String,
    pub distro_id: Option<String>,
    pub distro_name: Option<String>,
    pub distro_family: Option<String>,
    pub all_present: bool,
    pub missing: Vec<MissingLibrary>,
    pub install_command: Option<String>,
}

struct LibrarySpec {
    soname: &'static str,
    description: &'static str,
    deb_package: &'static str,
    rpm_package: &'static str,
}

const REQUIRED_LIBS: &[LibrarySpec] = &[
    LibrarySpec {
        soname: "libwebkit2gtk-4.1.so.0",
        description: "WebView (WebKit2GTK 4.1)",
        deb_package: "libwebkit2gtk-4.1-0",
        rpm_package: "webkit2gtk4.1",
    },
    LibrarySpec {
        soname: "libgtk-3.so.0",
        description: "GTK 3 widget toolkit",
        deb_package: "libgtk-3-0",
        rpm_package: "gtk3",
    },
    LibrarySpec {
        soname: "libglib-2.0.so.0",
        description: "GLib core library",
        deb_package: "libglib2.0-0",
        rpm_package: "glib2",
    },
    LibrarySpec {
        soname: "libgobject-2.0.so.0",
        description: "GObject runtime",
        deb_package: "libglib2.0-0",
        rpm_package: "glib2",
    },
    LibrarySpec {
        soname: "libsoup-3.0.so.0",
        description: "libsoup HTTP client",
        deb_package: "libsoup-3.0-0",
        rpm_package: "libsoup3",
    },
    LibrarySpec {
        soname: "libjavascriptcoregtk-4.1.so.0",
        description: "JavaScriptCore (WebKit)",
        deb_package: "libjavascriptcoregtk-4.1-0",
        rpm_package: "javascriptcoregtk4.1",
    },
    LibrarySpec {
        soname: "librsvg-2.so.2",
        description: "SVG rendering (icons)",
        deb_package: "librsvg2-2",
        rpm_package: "librsvg2",
    },
];

#[cfg(target_os = "linux")]
const LIB_SEARCH_DIRS: &[&str] = &[
    "/usr/lib",
    "/usr/lib64",
    "/usr/lib/x86_64-linux-gnu",
    "/usr/lib/aarch64-linux-gnu",
    "/lib",
    "/lib64",
    "/lib/x86_64-linux-gnu",
];

#[cfg(target_os = "linux")]
fn lib_present(soname: &str) -> bool {
    for dir in LIB_SEARCH_DIRS {
        if Path::new(dir).join(soname).exists() {
            return true;
        }
    }
    // Some distros place additional libs in /usr/local/lib
    Path::new("/usr/local/lib").join(soname).exists()
}

#[cfg(target_os = "linux")]
fn read_os_release() -> (Option<String>, Option<String>, Option<String>) {
    // Returns (id, pretty_name, family).
    let content = match std::fs::read_to_string("/etc/os-release") {
        Ok(c) => c,
        Err(_) => return (None, None, None),
    };
    let mut id: Option<String> = None;
    let mut pretty: Option<String> = None;
    let mut id_like: Option<String> = None;
    for line in content.lines() {
        if let Some(rest) = line.strip_prefix("ID=") {
            id = Some(rest.trim_matches('"').to_string());
        } else if let Some(rest) = line.strip_prefix("PRETTY_NAME=") {
            pretty = Some(rest.trim_matches('"').to_string());
        } else if let Some(rest) = line.strip_prefix("ID_LIKE=") {
            id_like = Some(rest.trim_matches('"').to_string());
        }
    }
    let family = match id.as_deref() {
        Some("ubuntu" | "debian" | "linuxmint" | "pop" | "elementary" | "kali" | "raspbian") => {
            Some("debian".to_string())
        }
        Some("fedora" | "rhel" | "centos" | "rocky" | "almalinux" | "ol" | "amzn") => {
            Some("fedora".to_string())
        }
        _ => match id_like.as_deref() {
            Some(s) if s.contains("debian") || s.contains("ubuntu") => Some("debian".to_string()),
            Some(s) if s.contains("fedora") || s.contains("rhel") || s.contains("centos") => {
                Some("fedora".to_string())
            }
            _ => None,
        },
    };
    (id, pretty, family)
}

#[cfg(target_os = "linux")]
fn build_report() -> SystemPrerequisitesReport {
    let (distro_id, distro_name, distro_family) = read_os_release();

    let mut missing: Vec<MissingLibrary> = Vec::new();
    for lib in REQUIRED_LIBS {
        if !lib_present(lib.soname) {
            missing.push(MissingLibrary {
                soname: lib.soname.to_string(),
                description: lib.description.to_string(),
                deb_package: lib.deb_package.to_string(),
                rpm_package: lib.rpm_package.to_string(),
            });
        }
    }

    let install_command = if missing.is_empty() {
        None
    } else {
        match distro_family.as_deref() {
            Some("debian") => {
                let pkgs: Vec<&str> = dedup(missing.iter().map(|m| m.deb_package.as_str()));
                Some(format!(
                    "sudo apt update && sudo apt install -y {}",
                    pkgs.join(" ")
                ))
            }
            Some("fedora") => {
                let pkgs: Vec<&str> = dedup(missing.iter().map(|m| m.rpm_package.as_str()));
                Some(format!("sudo dnf install -y {}", pkgs.join(" ")))
            }
            _ => None,
        }
    };

    SystemPrerequisitesReport {
        os: "linux".to_string(),
        distro_id,
        distro_name,
        distro_family,
        all_present: missing.is_empty(),
        missing,
        install_command,
    }
}

#[cfg(not(target_os = "linux"))]
fn build_report() -> SystemPrerequisitesReport {
    SystemPrerequisitesReport {
        os: std::env::consts::OS.to_string(),
        distro_id: None,
        distro_name: None,
        distro_family: None,
        all_present: true,
        missing: Vec::new(),
        install_command: None,
    }
}

fn dedup<'a, I: Iterator<Item = &'a str>>(iter: I) -> Vec<&'a str> {
    let mut seen: Vec<&str> = Vec::new();
    for s in iter {
        if !seen.contains(&s) {
            seen.push(s);
        }
    }
    seen
}

#[tauri::command]
pub fn check_system_prerequisites() -> Result<SystemPrerequisitesReport, String> {
    Ok(build_report())
}

/// Logs a startup banner highlighting any missing native runtime
/// libraries. On non-Linux this is a no-op. On Linux, it reports
/// missing sonames so users running the AppImage (which has no package
/// manager metadata) get a clear hint in the logs even if the app does
/// manage to start.
pub fn log_startup_check() {
    let report = build_report();
    if report.all_present {
        if let Some(name) = report.distro_name {
            tracing::info!("System prerequisites OK ({})", name);
        }
        return;
    }
    tracing::warn!(
        "System prerequisites: {} library(ies) missing",
        report.missing.len()
    );
    for m in &report.missing {
        tracing::warn!("  missing: {} ({})", m.soname, m.description);
    }
    if let Some(cmd) = report.install_command {
        tracing::warn!("  install with: {}", cmd);
    }
}
