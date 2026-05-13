use keyring::Entry;
use std::collections::HashMap;
use std::sync::Mutex;

const SERVICE_NAME: &str = "brows3r";

/// In-memory store that always holds credentials.
/// OS keychain is used as additional persistence when available.
static STORE: std::sync::LazyLock<Mutex<HashMap<String, String>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Store a secret access key.
pub fn store_secret_key(connection_id: &str, secret_key: &str) -> Result<(), String> {
    // Always store in memory
    {
        let mut store = STORE.lock().unwrap();
        store.insert(format!("secret:{connection_id}"), secret_key.to_string());
    }

    // Best-effort: also store in OS keychain
    if let Ok(entry) = Entry::new(SERVICE_NAME, connection_id) {
        let _ = entry.set_password(secret_key);
    }

    Ok(())
}

/// Retrieve a secret access key.
pub fn get_secret_key(connection_id: &str) -> Result<String, String> {
    // Try in-memory store first (always authoritative)
    {
        let store = STORE.lock().unwrap();
        if let Some(key) = store.get(&format!("secret:{connection_id}")) {
            return Ok(key.clone());
        }
    }

    // Fallback: try OS keychain (e.g., after app restart)
    if let Ok(entry) = Entry::new(SERVICE_NAME, connection_id) {
        if let Ok(password) = entry.get_password() {
            // Cache it in memory
            let mut store = STORE.lock().unwrap();
            store.insert(format!("secret:{connection_id}"), password.clone());
            return Ok(password);
        }
    }

    Err(format!(
        "Secret key not found for connection {connection_id}"
    ))
}

/// Delete a secret access key.
pub fn delete_secret_key(connection_id: &str) -> Result<(), String> {
    {
        let mut store = STORE.lock().unwrap();
        store.remove(&format!("secret:{connection_id}"));
    }

    if let Ok(entry) = Entry::new(SERVICE_NAME, connection_id) {
        let _ = entry.delete_credential();
    }

    Ok(())
}

/// Store a session token.
pub fn store_session_token(connection_id: &str, token: &str) -> Result<(), String> {
    {
        let mut store = STORE.lock().unwrap();
        store.insert(format!("session:{connection_id}"), token.to_string());
    }

    let key = format!("{connection_id}_session");
    if let Ok(entry) = Entry::new(SERVICE_NAME, &key) {
        let _ = entry.set_password(token);
    }

    Ok(())
}

/// Retrieve a session token.
pub fn get_session_token(connection_id: &str) -> Result<Option<String>, String> {
    {
        let store = STORE.lock().unwrap();
        if let Some(token) = store.get(&format!("session:{connection_id}")) {
            return Ok(Some(token.clone()));
        }
    }

    let key = format!("{connection_id}_session");
    if let Ok(entry) = Entry::new(SERVICE_NAME, &key) {
        if let Ok(token) = entry.get_password() {
            let mut store = STORE.lock().unwrap();
            store.insert(format!("session:{connection_id}"), token.clone());
            return Ok(Some(token));
        }
    }

    Ok(None)
}

/// Delete a session token.
pub fn delete_session_token(connection_id: &str) -> Result<(), String> {
    {
        let mut store = STORE.lock().unwrap();
        store.remove(&format!("session:{connection_id}"));
    }

    let key = format!("{connection_id}_session");
    if let Ok(entry) = Entry::new(SERVICE_NAME, &key) {
        let _ = entry.delete_credential();
    }

    Ok(())
}
