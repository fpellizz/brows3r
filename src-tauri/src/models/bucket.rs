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
