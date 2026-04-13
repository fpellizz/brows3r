use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncDirection {
    /// Push local filesystem → S3 bucket
    LocalToRemote,
    /// Pull S3 bucket → local filesystem
    RemoteToLocal,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncMode {
    /// Only copy files absent at the destination. Never overwrite, never
    /// delete.
    New,
    /// Like `New` plus: re-copy files where size differs or the source's
    /// `brows3r-mtime` (or fallback mtime) is newer than the destination's.
    /// Still never deletes.
    Updated,
    /// Like `Updated` plus: DELETE anything at the destination that doesn't
    /// exist at the source. Destructive — the frontend requires an explicit
    /// second confirmation before executing a plan that contains deletes.
    Mirror,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncActionKind {
    Upload,
    Download,
    DeleteLocal,
    DeleteRemote,
    Skip,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SyncAction {
    pub kind: SyncActionKind,
    /// Path relative to both `local_dir` and `prefix` — the diff key.
    pub rel_path: String,
    /// Size of the source side (for Skip, of whichever side has it).
    pub size: i64,
    /// One-line human-readable explanation (`"new at destination"`,
    /// `"size differs (1024 → 2048)"`, `"mtime stamp newer"`, …).
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct SyncSummary {
    pub uploads: u32,
    pub downloads: u32,
    pub deletes_local: u32,
    pub deletes_remote: u32,
    pub skipped: u32,
    pub total_bytes_to_transfer: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SyncPlan {
    pub actions: Vec<SyncAction>,
    pub summary: SyncSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PlanSyncRequest {
    pub connection_id: String,
    pub bucket: String,
    /// Remote root. Empty string = bucket root.
    pub prefix: String,
    /// Local root directory (absolute path).
    pub local_dir: String,
    pub direction: SyncDirection,
    pub mode: SyncMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ExecuteSyncRequest {
    pub sync_id: String,
    pub connection_id: String,
    pub bucket: String,
    pub prefix: String,
    pub local_dir: String,
    pub actions: Vec<SyncAction>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncActionStatus {
    Started,
    Completed,
    Failed,
}

/// Event emitted for each action as the executor processes it. The frontend
/// uses these to render a live log.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SyncActionEvent {
    pub sync_id: String,
    pub rel_path: String,
    pub kind: SyncActionKind,
    pub status: SyncActionStatus,
    pub error: Option<String>,
}

/// Event emitted once at the end of a sync run with aggregate counts.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SyncCompleteEvent {
    pub sync_id: String,
    pub succeeded: u32,
    pub failed: u32,
    pub skipped: u32,
}
