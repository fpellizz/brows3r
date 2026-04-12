use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use specta::Type;

/// A connection discovered from an external tool's configuration file.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ImportedConnection {
    pub name: String,
    pub endpoint: Option<String>,
    pub region: Option<String>,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    pub session_token: Option<String>,
    pub path_style: Option<bool>,
    pub source: String,
}

/// Scan an external tool's config and return the discovered S3 connections.
///
/// `source` must be one of: `"aws"`, `"rclone"`, `"s3cmd"`, `"minio"`.
/// `file_path` overrides the default config location when provided.
#[tauri::command]
pub fn import_connections(
    source: String,
    file_path: Option<String>,
) -> Result<Vec<ImportedConnection>, String> {
    match source.as_str() {
        "aws" => parse_aws(file_path),
        "rclone" => parse_rclone(file_path),
        "s3cmd" => parse_s3cmd(file_path),
        "minio" => parse_minio(file_path),
        other => Err(format!("Unknown import source: {other}")),
    }
}

// ---------------------------------------------------------------------------
// INI helpers
// ---------------------------------------------------------------------------

/// A minimal INI parser: returns a map of section-name -> key/value pairs.
fn parse_ini(content: &str) -> HashMap<String, HashMap<String, String>> {
    let mut sections: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut current_section = String::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();

        // Skip empty lines and comments
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }

        // Section header
        if line.starts_with('[') && line.ends_with(']') {
            current_section = line[1..line.len() - 1].trim().to_string();
            sections.entry(current_section.clone()).or_default();
            continue;
        }

        // key = value
        if let Some(eq_pos) = line.find('=') {
            let key = line[..eq_pos].trim().to_string();
            let value = line[eq_pos + 1..].trim().to_string();
            sections
                .entry(current_section.clone())
                .or_default()
                .insert(key, value);
        }
    }

    sections
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())
}

fn read_file(path: &PathBuf) -> Result<String, String> {
    std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))
}

// ---------------------------------------------------------------------------
// AWS CLI
// ---------------------------------------------------------------------------

fn parse_aws(file_path: Option<String>) -> Result<Vec<ImportedConnection>, String> {
    let home = home_dir()?;

    // -- credentials file --
    let creds_path = match &file_path {
        Some(p) => PathBuf::from(p),
        None => home.join(".aws").join("credentials"),
    };
    let creds_ini = if creds_path.exists() {
        parse_ini(&read_file(&creds_path)?)
    } else {
        HashMap::new()
    };

    // -- config file (only use default location) --
    let config_path = home.join(".aws").join("config");
    let config_ini = if config_path.exists() {
        parse_ini(&read_file(&config_path)?)
    } else {
        HashMap::new()
    };

    if creds_ini.is_empty() && config_ini.is_empty() {
        return Err(format!(
            "No AWS configuration found at {}",
            creds_path.display()
        ));
    }

    // Collect all profile names from both files
    let mut profile_names: Vec<String> = Vec::new();
    for name in creds_ini.keys() {
        if !profile_names.contains(name) {
            profile_names.push(name.clone());
        }
    }
    for name in config_ini.keys() {
        // config file uses "profile <name>" for non-default profiles
        let clean = name.strip_prefix("profile ").unwrap_or(name).to_string();
        if !profile_names.contains(&clean) {
            profile_names.push(clean);
        }
    }
    profile_names.sort();

    let mut results = Vec::new();

    for profile in &profile_names {
        let creds = creds_ini.get(profile.as_str());
        // config file stores non-default profiles as "profile <name>"
        let cfg = config_ini
            .get(profile.as_str())
            .or_else(|| config_ini.get(&format!("profile {profile}")));

        let access_key = creds.and_then(|c| c.get("aws_access_key_id")).cloned();
        let secret_key = creds
            .and_then(|c| c.get("aws_secret_access_key"))
            .cloned();
        let session_token = creds.and_then(|c| c.get("aws_session_token")).cloned();

        let region = cfg.and_then(|c| c.get("region")).cloned();
        let endpoint = cfg.and_then(|c| c.get("endpoint_url")).cloned();

        // Only include profiles that have at least an access key
        if access_key.is_some() {
            results.push(ImportedConnection {
                name: format!("AWS - {profile}"),
                endpoint,
                region,
                access_key_id: access_key,
                secret_access_key: secret_key,
                session_token,
                path_style: None,
                source: "aws".to_string(),
            });
        }
    }

    Ok(results)
}

// ---------------------------------------------------------------------------
// rclone
// ---------------------------------------------------------------------------

fn parse_rclone(file_path: Option<String>) -> Result<Vec<ImportedConnection>, String> {
    let path = match file_path {
        Some(p) => PathBuf::from(p),
        None => {
            let home = home_dir()?;
            home.join(".config").join("rclone").join("rclone.conf")
        }
    };

    let content = read_file(&path)?;
    let sections = parse_ini(&content);

    let mut results = Vec::new();

    for (name, kv) in &sections {
        // Only import S3-type remotes
        let remote_type = kv.get("type").map(|s| s.as_str()).unwrap_or("");
        if remote_type != "s3" {
            continue;
        }

        let access_key = kv.get("access_key_id").cloned();
        let secret_key = kv.get("secret_access_key").cloned();
        let endpoint = kv.get("endpoint").cloned();
        let region = kv.get("region").cloned();

        // rclone uses "force_path_style" boolean
        let path_style = kv
            .get("force_path_style")
            .map(|v| v == "true" || v == "1");

        results.push(ImportedConnection {
            name: format!("rclone - {name}"),
            endpoint,
            region,
            access_key_id: access_key,
            secret_access_key: secret_key,
            session_token: None,
            path_style,
            source: "rclone".to_string(),
        });
    }

    results.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(results)
}

// ---------------------------------------------------------------------------
// s3cmd
// ---------------------------------------------------------------------------

fn parse_s3cmd(file_path: Option<String>) -> Result<Vec<ImportedConnection>, String> {
    let path = match file_path {
        Some(p) => PathBuf::from(p),
        None => {
            let home = home_dir()?;
            home.join(".s3cfg")
        }
    };

    let content = read_file(&path)?;
    let sections = parse_ini(&content);

    let mut results = Vec::new();

    for (section, kv) in &sections {
        let access_key = kv.get("access_key").cloned();
        let secret_key = kv.get("secret_key").cloned();

        if access_key.is_none() && secret_key.is_none() {
            continue;
        }

        // host_base is the endpoint
        let endpoint = kv.get("host_base").map(|h| {
            let host = h.trim_end_matches('/');
            if host.starts_with("http://") || host.starts_with("https://") {
                host.to_string()
            } else {
                format!("https://{host}")
            }
        });

        let region = kv.get("bucket_location").cloned();

        // If host_bucket contains %(bucket)s it's virtual-hosted style; otherwise path style.
        let path_style = kv.get("host_bucket").map(|hb| !hb.contains("%(bucket)s"));

        let name = if section.is_empty() || section == "default" {
            "s3cmd - default".to_string()
        } else {
            format!("s3cmd - {section}")
        };

        results.push(ImportedConnection {
            name,
            endpoint,
            region,
            access_key_id: access_key,
            secret_access_key: secret_key,
            session_token: None,
            path_style,
            source: "s3cmd".to_string(),
        });
    }

    results.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(results)
}

// ---------------------------------------------------------------------------
// MinIO Client (mc)
// ---------------------------------------------------------------------------

fn parse_minio(file_path: Option<String>) -> Result<Vec<ImportedConnection>, String> {
    let path = match file_path {
        Some(p) => PathBuf::from(p),
        None => {
            let home = home_dir()?;
            home.join(".mc").join("config.json")
        }
    };

    let content = read_file(&path)?;

    let json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Invalid JSON in {}: {e}", path.display()))?;

    // mc config.json has an "aliases" object at the top level
    let aliases = json
        .get("aliases")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "No 'aliases' object found in MinIO Client config".to_string())?;

    let mut results = Vec::new();

    for (name, value) in aliases {
        let obj = match value.as_object() {
            Some(o) => o,
            None => continue,
        };

        let url = obj.get("url").and_then(|v| v.as_str()).map(String::from);
        let access_key = obj
            .get("accessKey")
            .and_then(|v| v.as_str())
            .map(String::from);
        let secret_key = obj
            .get("secretKey")
            .and_then(|v| v.as_str())
            .map(String::from);

        if access_key.is_none() && secret_key.is_none() {
            continue;
        }

        // mc uses path-style by default
        results.push(ImportedConnection {
            name: format!("mc - {name}"),
            endpoint: url,
            region: None,
            access_key_id: access_key,
            secret_access_key: secret_key,
            session_token: None,
            path_style: Some(true),
            source: "minio".to_string(),
        });
    }

    results.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(results)
}
