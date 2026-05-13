use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub region: String,
    pub access_key_id: String,
    /// Never serialized to frontend — stored in keychain. Read paths
    /// pull the secret from the keychain directly, so this field is
    /// only here for completeness of the Connection model used by
    /// serde / DB roundtrips.
    #[serde(skip_serializing)]
    #[allow(dead_code)]
    pub secret_access_key: Option<String>,
    pub session_token: Option<String>,
    pub signature_version: SignatureVersion,
    pub path_style: PathStyle,
    pub proxy: Option<String>,
    pub ca_bundle: Option<String>,
    pub timeout_secs: u32,
    pub max_retries: u32,
    pub notes: Option<String>,
    pub group: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateConnectionRequest {
    pub name: String,
    pub endpoint: String,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    pub signature_version: Option<SignatureVersion>,
    pub path_style: Option<PathStyle>,
    pub proxy: Option<String>,
    pub ca_bundle: Option<String>,
    pub timeout_secs: Option<u32>,
    pub max_retries: Option<u32>,
    pub notes: Option<String>,
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UpdateConnectionRequest {
    pub name: Option<String>,
    pub endpoint: Option<String>,
    pub region: Option<String>,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    pub session_token: Option<String>,
    pub signature_version: Option<SignatureVersion>,
    pub path_style: Option<PathStyle>,
    pub proxy: Option<String>,
    pub ca_bundle: Option<String>,
    pub timeout_secs: Option<u32>,
    pub max_retries: Option<u32>,
    pub notes: Option<String>,
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum SignatureVersion {
    V2,
    #[default]
    V4,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum PathStyle {
    #[default]
    Auto,
    Path,
    Virtual,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ConnectionTestResult {
    pub success: bool,
    pub latency_ms: u64,
    pub bucket_count: Option<u32>,
    pub error: Option<String>,
}
