use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::models::connection::{Connection as ConnProfile, SignatureVersion, PathStyle};
use crate::models::transfer::{
    RecoverableUpload, TransferHistoryEntry, TransferItem, TransferType, UploadedPart,
};

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
            created_at TEXT NOT NULL,
            upload_id TEXT,
            uploaded_parts TEXT,
            part_size_bytes INTEGER,
            updated_at TEXT
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

    // Migration: add multipart resume columns to pending_transfers if missing
    // (existing DBs that predate the feature).
    let pending_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(pending_transfers)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    if !pending_cols.iter().any(|c| c == "upload_id") {
        conn.execute_batch(
            "ALTER TABLE pending_transfers ADD COLUMN upload_id TEXT;
             ALTER TABLE pending_transfers ADD COLUMN uploaded_parts TEXT;
             ALTER TABLE pending_transfers ADD COLUMN part_size_bytes INTEGER;
             ALTER TABLE pending_transfers ADD COLUMN updated_at TEXT;",
        )?;
    }

    // Index on upload_id is created after the column is guaranteed to exist
    // (either by the initial CREATE TABLE for fresh DBs, or by the ALTER
    // above for migrated DBs). Cannot live in the first batch because for
    // existing DBs the CREATE TABLE IF NOT EXISTS is a no-op and the index
    // would reference a not-yet-added column.
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_pending_transfers_upload_id
             ON pending_transfers(upload_id);",
    )?;

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

// --- Pending transfers / multipart resume ---
//
// `pending_transfers` records in-flight uploads so a multipart upload can be
// resumed across app restarts. The flow is:
//   1. `insert_pending_transfer` when a transfer is enqueued
//   2. `update_pending_upload_id` after `create_multipart_upload` returns
//   3. `append_pending_part` after each `upload_part` succeeds
//   4. `delete_pending_transfer` after `complete_multipart_upload` (or after
//      a user-initiated cancel + abort)
// Single-part uploads only hit (1) and (4) — they aren't resumable but we
// still track them so the queue UI can survive a restart.

/// Insert a queued transfer into pending_transfers. Idempotent on `id`
/// (uses INSERT OR REPLACE so re-enqueueing is safe).
pub fn insert_pending_transfer(db: &Database, item: &TransferItem) -> Result<(), rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    let transfer_type = match item.transfer_type {
        crate::models::transfer::TransferType::Upload => "upload",
        crate::models::transfer::TransferType::Download => "download",
    };
    conn.execute(
        "INSERT OR REPLACE INTO pending_transfers (
            id, transfer_type, connection_id, bucket, key, local_path,
            total_bytes, transferred_bytes, status, priority, created_at,
            upload_id, uploaded_parts, part_size_bytes, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, NULL, NULL, ?12)",
        rusqlite::params![
            item.id,
            transfer_type,
            item.connection_id,
            item.bucket,
            item.key,
            item.local_path,
            item.total_bytes,
            item.transferred_bytes,
            "queued",
            0,
            item.created_at,
            item.created_at,
        ],
    )?;
    Ok(())
}

/// Record the S3-issued multipart `upload_id` and the chosen part size, so
/// startup recovery can find this upload and use the same chunking.
pub fn update_pending_upload_id(
    db: &Database,
    transfer_id: &str,
    upload_id: &str,
    part_size_bytes: i64,
) -> Result<(), rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE pending_transfers
         SET upload_id = ?2, part_size_bytes = ?3, updated_at = ?4
         WHERE id = ?1",
        rusqlite::params![transfer_id, upload_id, part_size_bytes, now],
    )?;
    Ok(())
}

/// Append a successfully-uploaded part to the persisted parts list and bump
/// `transferred_bytes`. Reads the current JSON, mutates, writes back — done
/// under the same lock so concurrent part-completion callbacks can't race.
pub fn append_pending_part(
    db: &Database,
    transfer_id: &str,
    part: UploadedPart,
) -> Result<(), rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();

    let existing_json: Option<String> = conn
        .query_row(
            "SELECT uploaded_parts FROM pending_transfers WHERE id = ?1",
            [transfer_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    let mut parts: Vec<UploadedPart> = existing_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let part_size = part.size;
    parts.push(part);
    let new_json = serde_json::to_string(&parts).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "UPDATE pending_transfers
         SET uploaded_parts = ?2,
             transferred_bytes = transferred_bytes + ?3,
             updated_at = ?4
         WHERE id = ?1",
        rusqlite::params![transfer_id, new_json, part_size, now],
    )?;
    Ok(())
}

/// Remove a pending transfer (called on successful completion, user cancel,
/// or after a Discard action from the recovery UI).
pub fn delete_pending_transfer(db: &Database, transfer_id: &str) -> Result<(), rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "DELETE FROM pending_transfers WHERE id = ?1",
        [transfer_id],
    )?;
    Ok(())
}

/// Fetch a single pending transfer's resume metadata. Returns `None` if the
/// row doesn't exist or isn't a multipart upload (no upload_id).
pub fn get_pending_multipart(
    db: &Database,
    transfer_id: &str,
) -> Result<Option<RecoverableUpload>, rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT p.id, p.connection_id, c.name, p.bucket, p.key, p.local_path,
                p.total_bytes, p.transferred_bytes, p.upload_id,
                p.part_size_bytes, p.uploaded_parts, p.created_at, p.updated_at
         FROM pending_transfers p
         LEFT JOIN connections c ON c.id = p.connection_id
         WHERE p.id = ?1 AND p.upload_id IS NOT NULL",
    )?;
    let mut rows = stmt.query_map([transfer_id], row_to_recoverable)?;
    rows.next().transpose()
}

/// List all interrupted multipart uploads (rows with a non-null `upload_id`).
/// Joined with `connections` so the UI can show the connection name and
/// detect orphaned uploads (connection deleted while upload was in flight).
pub fn list_recoverable_uploads(db: &Database) -> Result<Vec<RecoverableUpload>, rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT p.id, p.connection_id, c.name, p.bucket, p.key, p.local_path,
                p.total_bytes, p.transferred_bytes, p.upload_id,
                p.part_size_bytes, p.uploaded_parts, p.created_at, p.updated_at
         FROM pending_transfers p
         LEFT JOIN connections c ON c.id = p.connection_id
         WHERE p.upload_id IS NOT NULL
         ORDER BY p.created_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_recoverable)?;
    rows.collect()
}

// --- Transfer history (completed / failed) --------------------------------

/// Record a finished transfer. Called from the upload/download task
/// completion paths, before deleting the pending row.
pub fn insert_transfer_history(
    db: &Database,
    item: &TransferItem,
) -> Result<(), rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    let tt = match item.transfer_type {
        TransferType::Upload => "upload",
        TransferType::Download => "download",
    };
    let status = match item.status {
        crate::models::transfer::TransferStatus::Completed => "completed",
        crate::models::transfer::TransferStatus::Failed => "failed",
        crate::models::transfer::TransferStatus::Cancelled => "cancelled",
        _ => "unknown",
    };
    conn.execute(
        "INSERT OR REPLACE INTO transfer_history
            (id, transfer_type, connection_id, bucket, key, local_path,
             total_bytes, status, error, created_at, completed_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        rusqlite::params![
            item.id,
            tt,
            item.connection_id,
            item.bucket,
            item.key,
            item.local_path,
            item.total_bytes,
            status,
            item.error,
            item.created_at,
            item.completed_at,
        ],
    )?;
    Ok(())
}

/// Fetch the most recent transfer history entries, newest first.
pub fn list_transfer_history(
    db: &Database,
    limit: i64,
) -> Result<Vec<TransferHistoryEntry>, rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, transfer_type, connection_id, bucket, key, local_path,
                total_bytes, status, error, created_at, completed_at
         FROM transfer_history ORDER BY completed_at DESC, created_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], |row| {
        let tt_str: String = row.get(1)?;
        Ok(TransferHistoryEntry {
            id: row.get(0)?,
            transfer_type: if tt_str == "upload" {
                TransferType::Upload
            } else {
                TransferType::Download
            },
            connection_id: row.get(2)?,
            bucket: row.get(3)?,
            key: row.get(4)?,
            local_path: row.get(5)?,
            total_bytes: row.get(6)?,
            status: row.get(7)?,
            error: row.get(8)?,
            created_at: row.get(9)?,
            completed_at: row.get(10)?,
        })
    })?;
    rows.collect()
}

/// Load all pending transfers (not just multiparts). Used at startup to
/// re-populate the in-memory queue so the UI shows items that were in
/// flight when the app was last closed.
pub fn list_all_pending(db: &Database) -> Result<Vec<TransferItem>, rusqlite::Error> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, transfer_type, connection_id, bucket, key, local_path,
                total_bytes, transferred_bytes, status, created_at
         FROM pending_transfers ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        let tt_str: String = row.get(1)?;
        let status_str: String = row.get(8)?;
        Ok(TransferItem {
            id: row.get(0)?,
            transfer_type: if tt_str == "upload" {
                TransferType::Upload
            } else {
                TransferType::Download
            },
            connection_id: row.get(2)?,
            bucket: row.get(3)?,
            key: row.get(4)?,
            local_path: row.get(5)?,
            total_bytes: row.get(6)?,
            transferred_bytes: row.get(7)?,
            status: match status_str.as_str() {
                "completed" => crate::models::transfer::TransferStatus::Completed,
                "failed" => crate::models::transfer::TransferStatus::Failed,
                "cancelled" => crate::models::transfer::TransferStatus::Cancelled,
                "inprogress" => crate::models::transfer::TransferStatus::Queued, // was in-progress → treat as queued on restart
                _ => crate::models::transfer::TransferStatus::Queued,
            },
            speed_bps: None,
            eta_secs: None,
            error: None,
            created_at: row.get(9)?,
            completed_at: None,
        })
    })?;
    rows.collect()
}

fn row_to_recoverable(row: &rusqlite::Row<'_>) -> rusqlite::Result<RecoverableUpload> {
    let parts_json: Option<String> = row.get(10)?;
    let uploaded_parts: Vec<UploadedPart> = parts_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    Ok(RecoverableUpload {
        id: row.get(0)?,
        connection_id: row.get(1)?,
        connection_name: row.get(2)?,
        bucket: row.get(3)?,
        key: row.get(4)?,
        local_path: row.get(5)?,
        total_bytes: row.get(6)?,
        uploaded_bytes: row.get(7)?,
        upload_id: row.get(8)?,
        part_size_bytes: row.get::<_, Option<i64>>(9)?.unwrap_or(0),
        uploaded_parts,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}
