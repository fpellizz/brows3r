use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BucketInfo {
    pub name: String,
    pub creation_date: Option<String>,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BucketDetails {
    pub name: String,
    pub region: Option<String>,
    pub creation_date: Option<String>,
    pub versioning: Option<VersioningStatus>,
    pub encryption: Option<String>,
    pub object_count: Option<i64>,
    pub total_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum VersioningStatus {
    Enabled,
    Suspended,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateBucketRequest {
    pub name: String,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BucketEncryption {
    /// SSE algorithm. AWS-side values: `AES256`, `aws:kms`, `aws:kms:dsse`.
    pub algorithm: String,
    /// Required when `algorithm` is `aws:kms` (or `aws:kms:dsse`).
    pub kms_master_key_id: Option<String>,
    pub bucket_key_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CorsRule {
    pub id: Option<String>,
    pub allowed_methods: Vec<String>,
    pub allowed_origins: Vec<String>,
    #[serde(default)]
    pub allowed_headers: Vec<String>,
    #[serde(default)]
    pub expose_headers: Vec<String>,
    pub max_age_seconds: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LifecycleSnapshot {
    pub rules: Vec<LifecycleRule>,
    /// True when one or more lifecycle rules on the server use features
    /// the simplified editor doesn't represent (tag/And filters,
    /// date-based transitions). The UI switches to read-only mode in
    /// that case so the user can't accidentally overwrite them.
    pub has_unsupported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LifecycleRule {
    pub id: Option<String>,
    /// `Enabled` or `Disabled`.
    pub status: String,
    /// Object key prefix the rule applies to. Empty/None = all objects.
    pub prefix: Option<String>,
    #[serde(default)]
    pub transitions: Vec<LifecycleTransition>,
    pub expiration_days: Option<i32>,
    pub expired_object_delete_marker: Option<bool>,
    #[serde(default)]
    pub noncurrent_version_transitions: Vec<LifecycleNoncurrentTransition>,
    pub noncurrent_version_expiration_days: Option<i32>,
    pub abort_incomplete_multipart_upload_days: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LifecycleTransition {
    pub days: i32,
    pub storage_class: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LifecycleNoncurrentTransition {
    pub noncurrent_days: i32,
    pub storage_class: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StorageClassBreakdown {
    pub storage_class: String,
    pub count: i64,
    pub total_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BucketStats {
    pub object_count: i64,
    pub total_bytes: i64,
    pub by_storage_class: Vec<StorageClassBreakdown>,
    /// True when the listing hit `max_objects_to_scan` and we stopped
    /// early — figures are a lower bound, not the full picture.
    pub truncated: bool,
}
