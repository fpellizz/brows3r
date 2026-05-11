use tauri::State;

use crate::models::connection::{
    Connection, ConnectionTestResult, CreateConnectionRequest, PathStyle,
    UpdateConnectionRequest,
};
use crate::s3::client::S3ClientPool;
use crate::s3::types::S3ClientConfig;
use crate::store::credentials;
use crate::store::database::Database;

#[tauri::command]
pub fn list_connections(db: State<'_, Database>) -> Result<Vec<Connection>, String> {
    crate::store::database::list_connections(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_connection(db: State<'_, Database>, id: String) -> Result<Option<Connection>, String> {
    crate::store::database::get_connection(&db, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_connection(
    db: State<'_, Database>,
    request: CreateConnectionRequest,
) -> Result<Connection, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    let connection = Connection {
        id: id.clone(),
        name: request.name,
        endpoint: request.endpoint,
        region: request.region,
        access_key_id: request.access_key_id,
        secret_access_key: None,
        session_token: None,
        signature_version: request.signature_version.unwrap_or_default(),
        path_style: request.path_style.unwrap_or_default(),
        proxy: request.proxy,
        ca_bundle: request.ca_bundle,
        timeout_secs: request.timeout_secs.unwrap_or(30),
        max_retries: request.max_retries.unwrap_or(3),
        notes: request.notes,
        group: request.group,
        created_at: now.clone(),
        updated_at: now,
    };

    // Store connection metadata in database
    crate::store::database::insert_connection(&db, &connection).map_err(|e| e.to_string())?;

    // Store secret key in memory + DB
    credentials::store_secret_key(&id, &request.secret_access_key)?;
    crate::store::database::store_db_secret(&db, &id, &request.secret_access_key)
        .map_err(|e| e.to_string())?;

    // Store session token if provided
    if let Some(ref token) = request.session_token {
        credentials::store_session_token(&id, token)?;
        crate::store::database::store_db_session_token(&db, &id, token)
            .map_err(|e| e.to_string())?;
    }

    Ok(connection)
}

#[tauri::command]
pub async fn update_connection(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    id: String,
    request: UpdateConnectionRequest,
) -> Result<Connection, String> {
    let existing = crate::store::database::get_connection(&db, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Connection not found: {id}"))?;

    let now = chrono::Utc::now().to_rfc3339();

    let updated = Connection {
        id: id.clone(),
        name: request.name.unwrap_or(existing.name),
        endpoint: request.endpoint.unwrap_or(existing.endpoint),
        region: request.region.unwrap_or(existing.region),
        access_key_id: request.access_key_id.unwrap_or(existing.access_key_id),
        secret_access_key: None,
        session_token: None,
        signature_version: request.signature_version.unwrap_or(existing.signature_version),
        path_style: request.path_style.unwrap_or(existing.path_style),
        proxy: request.proxy.or(existing.proxy),
        ca_bundle: request.ca_bundle.or(existing.ca_bundle),
        timeout_secs: request.timeout_secs.unwrap_or(existing.timeout_secs),
        max_retries: request.max_retries.unwrap_or(existing.max_retries),
        notes: request.notes.or(existing.notes),
        group: request.group.or(existing.group),
        created_at: existing.created_at,
        updated_at: now,
    };

    // Update secret key if provided
    if let Some(ref secret) = request.secret_access_key {
        credentials::store_secret_key(&id, secret)?;
    }

    // Update session token if provided
    if let Some(ref token) = request.session_token {
        credentials::store_session_token(&id, token)?;
    }

    crate::store::database::update_connection(&db, &updated).map_err(|e| e.to_string())?;

    // Invalidate the cached S3 client so the next operation picks up
    // the new endpoint/path-style/credentials. Without this, settings
    // changes from the UI silently fail to take effect.
    pool.remove(&id).await;

    Ok(updated)
}

#[tauri::command]
pub async fn delete_connection(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    id: String,
) -> Result<(), String> {
    // Delete credentials from keychain
    let _ = credentials::delete_secret_key(&id);
    let _ = credentials::delete_session_token(&id);

    // Drop any cached S3 client for this connection.
    pool.remove(&id).await;

    // Delete from database
    crate::store::database::delete_connection(&db, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_connection(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    id: String,
) -> Result<ConnectionTestResult, String> {
    let conn = crate::store::database::get_connection(&db, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Connection not found: {id}"))?;

    let secret_key = credentials::get_secret_key(&id)
        .or_else(|_| {
            crate::store::database::get_db_secret(&db, &id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Secret key not found for connection {id}"))
        })?;
    let session_token = credentials::get_session_token(&id)
        .unwrap_or_else(|_| {
            crate::store::database::get_db_session_token(&db, &id).unwrap_or(None)
        });

    let config = build_s3_config(&conn, &secret_key, session_token.as_deref());

    // Force recreate client for test (config might have changed)
    pool.remove(&id).await;
    let client = pool
        .get_or_create(&id, &config)
        .await
        .map_err(|e| e.to_string())?;

    crate::s3::client::test_connection(&client)
        .await
        .map_err(|e| e.to_string())
}

/// Test a connection without saving it (for new connection dialog).
#[tauri::command]
pub async fn test_connection_inline(
    endpoint: String,
    region: String,
    access_key_id: String,
    secret_access_key: String,
    session_token: Option<String>,
    path_style: Option<String>,
) -> Result<ConnectionTestResult, String> {
    let force_path_style = match path_style.as_deref() {
        Some("path") => Some(true),
        Some("virtual") => Some(false),
        _ => Some(crate::s3::types::infer_force_path_style(&endpoint)),
    };

    let config = S3ClientConfig {
        endpoint,
        region,
        access_key_id,
        secret_access_key,
        session_token,
        force_path_style,
        proxy: None,
        ca_bundle: None,
        timeout_secs: 15,
        max_retries: 1,
    };

    let client = crate::s3::client::S3ClientPool::new()
        .get_or_create("_test_inline", &config)
        .await
        .map_err(|e| format!("Client creation failed: {e}"))?;

    tracing::info!("Testing inline connection to {}", config.endpoint);

    let result = crate::s3::client::test_connection(&client).await;

    match &result {
        Ok(r) => tracing::info!("Test result: success={}, latency={}ms", r.success, r.latency_ms),
        Err(e) => tracing::error!("Test connection error: {e:?}"),
    }

    result.map_err(|e| e.to_string())
}

/// Build an S3ClientConfig from a Connection profile + credentials.
pub fn build_s3_config(
    conn: &Connection,
    secret_key: &str,
    session_token: Option<&str>,
) -> S3ClientConfig {
    let force_path_style = match conn.path_style {
        PathStyle::Auto => Some(crate::s3::types::infer_force_path_style(&conn.endpoint)),
        PathStyle::Path => Some(true),
        PathStyle::Virtual => Some(false),
    };

    S3ClientConfig {
        endpoint: conn.endpoint.clone(),
        region: conn.region.clone(),
        access_key_id: conn.access_key_id.clone(),
        secret_access_key: secret_key.to_string(),
        session_token: session_token.map(String::from),
        force_path_style,
        proxy: conn.proxy.clone(),
        ca_bundle: conn.ca_bundle.clone(),
        timeout_secs: conn.timeout_secs as u64,
        max_retries: conn.max_retries,
    }
}
