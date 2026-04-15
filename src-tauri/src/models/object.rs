use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ObjectInfo {
    pub key: String,
    pub display_name: String,
    pub is_folder: bool,
    pub size: Option<i64>,
    pub last_modified: Option<String>,
    pub etag: Option<String>,
    pub storage_class: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ObjectDetails {
    pub key: String,
    pub size: i64,
    pub last_modified: Option<String>,
    pub etag: Option<String>,
    pub content_type: Option<String>,
    pub storage_class: Option<String>,
    pub metadata: Vec<MetadataEntry>,
    pub version_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MetadataEntry {
    pub key: String,
    pub value: String,
}

/// A single version (or delete marker) of an object, as returned by
/// ListObjectVersions. `is_delete_marker = true` means this entry is a
/// tombstone — no actual content, signals that the object was deleted
/// at this point in history.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ObjectVersion {
    pub key: String,
    pub version_id: String,
    pub is_latest: bool,
    pub is_delete_marker: bool,
    pub size: i64,
    pub last_modified: Option<String>,
    pub etag: Option<String>,
    pub storage_class: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ListObjectVersionsRequest {
    pub connection_id: String,
    pub bucket: String,
    pub prefix: Option<String>,
    pub key_marker: Option<String>,
    pub version_id_marker: Option<String>,
    pub max_keys: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ListObjectVersionsResponse {
    pub versions: Vec<ObjectVersion>,
    pub next_key_marker: Option<String>,
    pub next_version_id_marker: Option<String>,
    pub is_truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BucketVersioningStatus {
    /// `Enabled`, `Suspended`, or `Unversioned` (never enabled).
    pub status: String,
    pub mfa_delete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ListObjectsRequest {
    pub connection_id: String,
    pub bucket: String,
    pub prefix: Option<String>,
    pub delimiter: Option<String>,
    pub max_keys: Option<i32>,
    pub continuation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ListObjectsResponse {
    pub objects: Vec<ObjectInfo>,
    pub common_prefixes: Vec<String>,
    pub continuation_token: Option<String>,
    pub is_truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DeleteObjectsRequest {
    pub connection_id: String,
    pub bucket: String,
    pub keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CopyObjectRequest {
    pub connection_id: String,
    pub source_bucket: String,
    pub source_key: String,
    pub dest_bucket: String,
    pub dest_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PresignedUrlRequest {
    pub connection_id: String,
    pub bucket: String,
    pub key: String,
    pub expiry_secs: u64,
    pub method: PresignMethod,
    /// Optional — when set, the presigned URL targets this specific
    /// version of the object rather than the current one. Only valid
    /// for GET.
    #[serde(default)]
    pub version_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum PresignMethod {
    Get,
    Put,
}
