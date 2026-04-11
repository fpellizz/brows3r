use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TransferItem {
    pub id: String,
    pub transfer_type: TransferType,
    pub connection_id: String,
    pub bucket: String,
    pub key: String,
    pub local_path: String,
    pub total_bytes: i64,
    pub transferred_bytes: i64,
    pub status: TransferStatus,
    pub speed_bps: Option<i64>,
    pub eta_secs: Option<i64>,
    pub error: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum TransferType {
    Upload,
    Download,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum TransferStatus {
    Queued,
    InProgress,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StartUploadRequest {
    pub connection_id: String,
    pub bucket: String,
    pub prefix: Option<String>,
    pub local_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StartDownloadRequest {
    pub connection_id: String,
    pub bucket: String,
    pub keys: Vec<String>,
    pub local_dir: String,
}

/// Event emitted during transfer progress
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TransferProgressEvent {
    pub id: String,
    pub transferred_bytes: i64,
    pub total_bytes: i64,
    pub speed_bps: i64,
    pub eta_secs: i64,
}

/// Event emitted when a transfer completes
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TransferCompleteEvent {
    pub id: String,
    pub success: bool,
    pub error: Option<String>,
    pub etag: Option<String>,
}

impl TransferItem {
    pub fn new_upload(
        connection_id: String,
        bucket: String,
        key: String,
        local_path: String,
        total_bytes: i64,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            transfer_type: TransferType::Upload,
            connection_id,
            bucket,
            key,
            local_path,
            total_bytes,
            transferred_bytes: 0,
            status: TransferStatus::Queued,
            speed_bps: None,
            eta_secs: None,
            error: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            completed_at: None,
        }
    }

    pub fn new_download(
        connection_id: String,
        bucket: String,
        key: String,
        local_path: String,
        total_bytes: i64,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            transfer_type: TransferType::Download,
            connection_id,
            bucket,
            key,
            local_path,
            total_bytes,
            transferred_bytes: 0,
            status: TransferStatus::Queued,
            speed_bps: None,
            eta_secs: None,
            error: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            completed_at: None,
        }
    }
}
