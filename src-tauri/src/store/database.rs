use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::models::connection::{Connection as ConnProfile, SignatureVersion, PathStyle};

/// Application database state, managed by Tauri.
pub struct Database {
    pub conn: Mutex<Connection>,
}

/// Get the database file path for the current platform.
fn db_path(app: &AppHandle) -> PathBuf {
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to resolve app data dir");
    std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
    app_dir.join("brows3r.db")
}

/// Initialize the database and run migrations. Call this in Tauri setup.
pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let path = db_path(app);
    let conn = Connection::open(&path)?;

    // Enable WAL mode for better concurrent read performance
    conn.pragma_update(None, "journal_mode", "wal")?;

    run_migrations(&conn)?;

    app.manage(Database {
        conn: Mutex::new(conn),
    });

    Ok(())
}

fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            endpoint TEXT NOT NULL,
            region TEXT NOT NULL,
            access_key_id TEXT NOT NULL,
            encrypted_secret TEXT,
            encrypted_session_token TEXT,
            signature_version TEXT NOT NULL DEFAULT 'v4',
            path_style TEXT NOT NULL DEFAULT 'auto',
            proxy TEXT,
            ca_bundle TEXT,
            timeout_secs INTEGER NOT NULL DEFAULT 30,
            max_retries INTEGER NOT NULL DEFAULT 3,
            notes TEXT,
            group_name TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS transfer_history (
            id TEXT PRIMARY KEY,
            transfer_type TEXT NOT NULL,
            connection_id TEXT NOT NULL,
            bucket TEXT NOT NULL,
            key TEXT NOT NULL,
            local_path TEXT NOT NULL,
            total_bytes INTEGER NOT NULL,
            status TEXT NOT NULL,
            error TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (connection_id) REFERENCES connections(id)
        );

        CREATE TABLE IF NOT EXISTS pending_transfers (
            id TEXT PRIMARY KEY,
            transfer_type TEXT NOT NULL,
            connection_id TEXT NOT NULL,
            bucket TEXT NOT NULL,
            key TEXT NOT NULL,
            local_path TEXT NOT NULL,
            total_bytes INTEGER NOT NULL,
            transferred_bytes INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'queued',
            priority INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_transfer_history_conn
            ON transfer_history(connection_id);
        CREATE INDEX IF NOT EXISTS idx_transfer_history_date
            ON transfer_history(created_at);
        CREATE INDEX IF NOT EXISTS idx_pending_transfers_status
            ON pending_transfers(status);
        ",
    )?;

    // Migration: add encrypted_secret columns if missing (existing DBs)
    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(connections)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !cols.iter().any(|c| c == "encrypted_secret") {
        conn.execute_batch(
            "ALTER TABLE connections ADD COLUMN encrypted_secret TEXT;
             ALTER TABLE connections ADD COLUMN encrypted_session_token TEXT;",
        )?;
    }

    Ok(())
}

// --- Connection CRUD ---

pub fn list_connections(db: &Database) -> Result<Vec<ConnProfile>, rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, name, endpoint, region, access_key_id, signature_version,
                path_style, proxy, ca_bundle, timeout_secs, max_retries,
                notes, group_name, created_at, updated_at
         FROM connections ORDER BY name",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(ConnProfile {
            id: row.get(0)?,
            name: row.get(1)?,
            endpoint: row.get(2)?,
            region: row.get(3)?,
            access_key_id: row.get(4)?,
            secret_access_key: None, // Never read from DB, use keychain
            session_token: None,
            signature_version: parse_sig_version(row.get::<_, String>(5)?),
            path_style: parse_path_style(row.get::<_, String>(6)?),
            proxy: row.get(7)?,
            ca_bundle: row.get(8)?,
            timeout_secs: row.get(9)?,
            max_retries: row.get(10)?,
            notes: row.get(11)?,
            group: row.get(12)?,
            created_at: row.get(13)?,
            updated_at: row.get(14)?,
        })
    })?;

    rows.collect()
}

pub fn insert_connection(db: &Database, profile: &ConnProfile) -> Result<(), rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO connections (id, name, endpoint, region, access_key_id,
            signature_version, path_style, proxy, ca_bundle, timeout_secs,
            max_retries, notes, group_name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        rusqlite::params![
            profile.id,
            profile.name,
            profile.endpoint,
            profile.region,
            profile.access_key_id,
            sig_version_str(&profile.signature_version),
            path_style_str(&profile.path_style),
            profile.proxy,
            profile.ca_bundle,
            profile.timeout_secs,
            profile.max_retries,
            profile.notes,
            profile.group,
            profile.created_at,
            profile.updated_at,
        ],
    )?;
    Ok(())
}

pub fn update_connection(db: &Database, profile: &ConnProfile) -> Result<(), rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE connections SET name=?2, endpoint=?3, region=?4, access_key_id=?5,
            signature_version=?6, path_style=?7, proxy=?8, ca_bundle=?9,
            timeout_secs=?10, max_retries=?11, notes=?12, group_name=?13, updated_at=?14
         WHERE id=?1",
        rusqlite::params![
            profile.id,
            profile.name,
            profile.endpoint,
            profile.region,
            profile.access_key_id,
            sig_version_str(&profile.signature_version),
            path_style_str(&profile.path_style),
            profile.proxy,
            profile.ca_bundle,
            profile.timeout_secs,
            profile.max_retries,
            profile.notes,
            profile.group,
            profile.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete_connection(db: &Database, id: &str) -> Result<(), rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    conn.execute("DELETE FROM connections WHERE id = ?1", [id])?;
    Ok(())
}

pub fn get_connection(db: &Database, id: &str) -> Result<Option<ConnProfile>, rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, name, endpoint, region, access_key_id, signature_version,
                path_style, proxy, ca_bundle, timeout_secs, max_retries,
                notes, group_name, created_at, updated_at
         FROM connections WHERE id = ?1",
    )?;

    let mut rows = stmt.query_map([id], |row| {
        Ok(ConnProfile {
            id: row.get(0)?,
            name: row.get(1)?,
            endpoint: row.get(2)?,
            region: row.get(3)?,
            access_key_id: row.get(4)?,
            secret_access_key: None,
            session_token: None,
            signature_version: parse_sig_version(row.get::<_, String>(5)?),
            path_style: parse_path_style(row.get::<_, String>(6)?),
            proxy: row.get(7)?,
            ca_bundle: row.get(8)?,
            timeout_secs: row.get(9)?,
            max_retries: row.get(10)?,
            notes: row.get(11)?,
            group: row.get(12)?,
            created_at: row.get(13)?,
            updated_at: row.get(14)?,
        })
    })?;

    rows.next().transpose()
}

// --- Helpers ---

fn parse_sig_version(s: String) -> SignatureVersion {
    match s.as_str() {
        "v2" => SignatureVersion::V2,
        _ => SignatureVersion::V4,
    }
}

fn sig_version_str(v: &SignatureVersion) -> &str {
    match v {
        SignatureVersion::V2 => "v2",
        SignatureVersion::V4 => "v4",
    }
}

fn parse_path_style(s: String) -> PathStyle {
    match s.as_str() {
        "path" => PathStyle::Path,
        "virtual" => PathStyle::Virtual,
        _ => PathStyle::Auto,
    }
}

fn path_style_str(v: &PathStyle) -> &str {
    match v {
        PathStyle::Auto => "auto",
        PathStyle::Path => "path",
        PathStyle::Virtual => "virtual",
    }
}

// --- Secrets stored in DB (base64-obfuscated, not truly encrypted) ---

pub fn store_db_secret(db: &Database, connection_id: &str, secret: &str) -> Result<(), rusqlite::Error> {
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(secret);
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE connections SET encrypted_secret = ?1 WHERE id = ?2",
        rusqlite::params![encoded, connection_id],
    )?;
    Ok(())
}

pub fn get_db_secret(db: &Database, connection_id: &str) -> Result<Option<String>, rusqlite::Error> {
    use base64::Engine;
    let conn = db.conn.lock().unwrap();
    let result: Option<String> = conn.query_row(
        "SELECT encrypted_secret FROM connections WHERE id = ?1",
        [connection_id],
        |row| row.get(0),
    ).ok().flatten();

    Ok(result.and_then(|encoded| {
        base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
    }))
}

pub fn store_db_session_token(db: &Database, connection_id: &str, token: &str) -> Result<(), rusqlite::Error> {
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(token);
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE connections SET encrypted_session_token = ?1 WHERE id = ?2",
        rusqlite::params![encoded, connection_id],
    )?;
    Ok(())
}

pub fn get_db_session_token(db: &Database, connection_id: &str) -> Result<Option<String>, rusqlite::Error> {
    use base64::Engine;
    let conn = db.conn.lock().unwrap();
    let result: Option<String> = conn.query_row(
        "SELECT encrypted_session_token FROM connections WHERE id = ?1",
        [connection_id],
        |row| row.get(0),
    ).ok().flatten();

    Ok(result.and_then(|encoded| {
        base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
    }))
}
