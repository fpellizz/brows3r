//! Sync engine: compute the diff between a local directory and an S3
//! prefix, then (optionally) execute it.
//!
//! Design notes
//! - Diff key is the path relative to both roots (`local_dir` and `prefix`).
//! - Change detection: prefer the `x-amz-meta-brows3r-mtime` user metadata
//!   stamped by previous syncs; fall back to comparing local mtime vs S3
//!   LastModified when the metadata is absent (files uploaded manually or
//!   before this feature existed).
//! - Folders aren't first-class on S3: any "empty directory" local is just
//!   never represented remotely.
//! - Mirror deletes: the planner emits them; execution requires the caller
//!   to have confirmed via the frontend (the Tauri command that kicks
//!   execute doesn't pre-verify — the UI is the gate).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use aws_sdk_s3::Client;
use chrono::{DateTime, Utc};
use globset::GlobSet;

use crate::models::sync::{
    ExecuteSyncRequest, PlanSyncRequest, SyncAction, SyncActionKind, SyncDirection, SyncMode,
    SyncPlan, SyncSummary,
};

/// Metadata key we stamp on every sync-uploaded object to record the
/// original file's modification time (RFC3339). Read back by later syncs to
/// make "same size, different content" visible. Lowercased because S3
/// normalizes user metadata keys.
pub const MTIME_METADATA_KEY: &str = "brows3r-mtime";

/// Grace window for mtime comparison against S3 LastModified (the fallback
/// path when no `brows3r-mtime` user metadata is present). Filesystem
/// timestamps and S3 clocks don't necessarily agree to the second.
const MTIME_GRACE_SECS: i64 = 2;

#[derive(Debug, Clone)]
pub struct FileInfo {
    /// Kept for debug/log clarity; the rel_path is also the HashMap key
    /// so reading it from the value would be redundant.
    #[allow(dead_code)]
    pub rel_path: String,
    pub size: i64,
    /// Filesystem mtime for local files, S3 LastModified for remote.
    pub mtime: DateTime<Utc>,
}

// --- Enumeration ---------------------------------------------------------

/// Walk `root` recursively, returning every regular file keyed by its path
/// relative to `root` (forward slashes, no leading `/`). Symlinks are not
/// followed — avoids loops and "sync copied my entire home dir" footguns.
/// `exclude` (when `Some`) filters by the file's basename.
pub async fn walk_local(
    root: &Path,
    exclude: Option<&GlobSet>,
) -> Result<HashMap<String, FileInfo>, String> {
    let root = root.to_path_buf();
    let exclude = exclude.cloned();
    // Walking the filesystem synchronously off the tokio worker is fine —
    // it's I/O-bound and tiny compared to the network roundtrips that will
    // follow.
    tokio::task::spawn_blocking(move || walk_local_blocking(&root, exclude.as_ref()))
        .await
        .map_err(|e| format!("walk_local join error: {e}"))?
}

fn walk_local_blocking(
    root: &Path,
    exclude: Option<&GlobSet>,
) -> Result<HashMap<String, FileInfo>, String> {
    let mut out = HashMap::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) => return Err(format!("read_dir {}: {}", dir.display(), e)),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };

            // Skip symlinks to avoid loops and surprises.
            if file_type.is_symlink() {
                continue;
            }

            if file_type.is_dir() {
                stack.push(path);
                continue;
            }

            if !file_type.is_file() {
                continue;
            }

            let basename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            if let Some(set) = exclude {
                if set.is_match(basename) {
                    continue;
                }
            }

            let rel = match path.strip_prefix(root) {
                Ok(p) => p.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };

            let meta = match path.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| DateTime::<Utc>::from(t).into())
                .unwrap_or_else(Utc::now);

            out.insert(
                rel.clone(),
                FileInfo {
                    rel_path: rel,
                    size: meta.len() as i64,
                    mtime,
                },
            );
        }
    }

    Ok(out)
}

/// List every object under `prefix` (paginated), keyed by the portion of
/// the key AFTER the prefix — so the map key matches the local relative
/// path for diffing. Folder placeholders (keys ending in `/`) are skipped.
pub async fn list_remote(
    client: &Client,
    bucket: &str,
    prefix: &str,
    exclude: Option<&GlobSet>,
) -> Result<HashMap<String, FileInfo>, String> {
    let mut out = HashMap::new();
    let mut continuation: Option<String> = None;
    // Normalize the prefix so stripping is unambiguous: always trailing `/`
    // unless it's the bucket root (empty string).
    let norm_prefix = if prefix.is_empty() || prefix.ends_with('/') {
        prefix.to_string()
    } else {
        format!("{prefix}/")
    };

    loop {
        let mut req = client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(&norm_prefix);
        if let Some(t) = continuation.as_ref() {
            req = req.continuation_token(t);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("list_objects_v2: {e}"))?;

        for obj in resp.contents() {
            let Some(key) = obj.key() else { continue };
            if key.ends_with('/') {
                // Folder placeholder — no file content.
                continue;
            }
            let rel = key.strip_prefix(&norm_prefix).unwrap_or(key).to_string();
            if rel.is_empty() {
                continue;
            }

            let basename = rel.rsplit('/').next().unwrap_or("");
            if let Some(set) = exclude {
                if set.is_match(basename) {
                    continue;
                }
            }

            let mtime = obj
                .last_modified()
                .and_then(|lm| DateTime::<Utc>::from_timestamp(lm.secs(), lm.subsec_nanos()))
                .unwrap_or_else(Utc::now);

            out.insert(
                rel.clone(),
                FileInfo {
                    rel_path: rel,
                    size: obj.size().unwrap_or(0),
                    mtime,
                },
            );
        }

        if resp.is_truncated().unwrap_or(false) {
            continuation = resp.next_continuation_token().map(|s| s.to_string());
            if continuation.is_none() {
                break;
            }
        } else {
            break;
        }
    }

    Ok(out)
}

// --- Planning ------------------------------------------------------------

/// Compute the diff. For files that match by name and size we fall back to
/// `head_object` to read `brows3r-mtime` — HEAD calls are the dominant cost
/// so we only issue them when strictly necessary.
pub async fn plan_sync(
    client: &Client,
    req: &PlanSyncRequest,
    exclude: Option<&GlobSet>,
) -> Result<SyncPlan, String> {
    let local = walk_local(Path::new(&req.local_dir), exclude).await?;
    let remote = list_remote(client, &req.bucket, &req.prefix, exclude).await?;

    let (source, dest) = match req.direction {
        SyncDirection::LocalToRemote => (&local, &remote),
        SyncDirection::RemoteToLocal => (&remote, &local),
    };

    let mut actions: Vec<SyncAction> = Vec::new();

    for (rel, src_info) in source.iter() {
        match dest.get(rel) {
            None => {
                actions.push(SyncAction {
                    kind: match req.direction {
                        SyncDirection::LocalToRemote => SyncActionKind::Upload,
                        SyncDirection::RemoteToLocal => SyncActionKind::Download,
                    },
                    rel_path: rel.clone(),
                    size: src_info.size,
                    reason: "absent at destination".to_string(),
                });
            }
            Some(dst_info) => {
                if matches!(req.mode, SyncMode::New) {
                    actions.push(SyncAction {
                        kind: SyncActionKind::Skip,
                        rel_path: rel.clone(),
                        size: src_info.size,
                        reason: "already exists (mode=new)".to_string(),
                    });
                    continue;
                }

                // Updated / Mirror: compare.
                if src_info.size != dst_info.size {
                    actions.push(SyncAction {
                        kind: match req.direction {
                            SyncDirection::LocalToRemote => SyncActionKind::Upload,
                            SyncDirection::RemoteToLocal => SyncActionKind::Download,
                        },
                        rel_path: rel.clone(),
                        size: src_info.size,
                        reason: format!("size differs ({} → {})", dst_info.size, src_info.size),
                    });
                    continue;
                }

                // Same size — we need mtime to decide. HEAD the remote side
                // to read the brows3r-mtime metadata if present.
                let remote_key = compose_remote_key(&req.prefix, rel);
                let stamped = read_stamped_mtime(client, &req.bucket, &remote_key).await;

                // Source/dest mtime depending on direction.
                let (src_mtime, dst_mtime) = match req.direction {
                    SyncDirection::LocalToRemote => {
                        // Source is local → compare local mtime vs stamp (or
                        // fallback to S3 LastModified).
                        (
                            src_info.mtime,
                            stamped.unwrap_or(dst_info.mtime),
                        )
                    }
                    SyncDirection::RemoteToLocal => {
                        // Source is remote (the stamp, if present, IS the
                        // authoritative source mtime); dest is local fs.
                        (stamped.unwrap_or(src_info.mtime), dst_info.mtime)
                    }
                };

                if (src_mtime - dst_mtime).num_seconds().abs() <= MTIME_GRACE_SECS {
                    actions.push(SyncAction {
                        kind: SyncActionKind::Skip,
                        rel_path: rel.clone(),
                        size: src_info.size,
                        reason: "unchanged".to_string(),
                    });
                } else if src_mtime > dst_mtime {
                    actions.push(SyncAction {
                        kind: match req.direction {
                            SyncDirection::LocalToRemote => SyncActionKind::Upload,
                            SyncDirection::RemoteToLocal => SyncActionKind::Download,
                        },
                        rel_path: rel.clone(),
                        size: src_info.size,
                        reason: "source mtime newer".to_string(),
                    });
                } else {
                    // Destination is newer — never overwrite backwards (user
                    // chose unidirectional; if they really want to force, a
                    // mirror-in-the-other-direction is the answer).
                    actions.push(SyncAction {
                        kind: SyncActionKind::Skip,
                        rel_path: rel.clone(),
                        size: src_info.size,
                        reason: "destination mtime newer (not overwriting)".to_string(),
                    });
                }
            }
        }
    }

    // Mirror deletes: anything at dest not in source.
    if matches!(req.mode, SyncMode::Mirror) {
        for (rel, dst_info) in dest.iter() {
            if !source.contains_key(rel) {
                actions.push(SyncAction {
                    kind: match req.direction {
                        SyncDirection::LocalToRemote => SyncActionKind::DeleteRemote,
                        SyncDirection::RemoteToLocal => SyncActionKind::DeleteLocal,
                    },
                    rel_path: rel.clone(),
                    size: dst_info.size,
                    reason: "absent at source (mirror)".to_string(),
                });
            }
        }
    }

    // Stable ordering for a predictable UI.
    actions.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));

    let summary = summarize(&actions);
    Ok(SyncPlan { actions, summary })
}

fn summarize(actions: &[SyncAction]) -> SyncSummary {
    let mut s = SyncSummary::default();
    for a in actions {
        match a.kind {
            SyncActionKind::Upload => {
                s.uploads += 1;
                s.total_bytes_to_transfer += a.size;
            }
            SyncActionKind::Download => {
                s.downloads += 1;
                s.total_bytes_to_transfer += a.size;
            }
            SyncActionKind::DeleteLocal => s.deletes_local += 1,
            SyncActionKind::DeleteRemote => s.deletes_remote += 1,
            SyncActionKind::Skip => s.skipped += 1,
        }
    }
    s
}

fn compose_remote_key(prefix: &str, rel: &str) -> String {
    if prefix.is_empty() {
        rel.to_string()
    } else if prefix.ends_with('/') {
        format!("{prefix}{rel}")
    } else {
        format!("{prefix}/{rel}")
    }
}

/// HEAD the object and extract the `brows3r-mtime` user-metadata value if
/// present. Returns `None` on any failure — callers fall back to comparing
/// against S3 LastModified.
async fn read_stamped_mtime(
    client: &Client,
    bucket: &str,
    key: &str,
) -> Option<DateTime<Utc>> {
    let out = client
        .head_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .ok()?;
    let md = out.metadata()?;
    let raw = md.get(MTIME_METADATA_KEY)?;
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

// --- Execution -----------------------------------------------------------

/// Helper: produce the metadata map a sync upload should stamp, given the
/// local file's mtime. Consumed by `execute_sync` and its tests.
pub fn mtime_metadata(mtime: DateTime<Utc>) -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert(MTIME_METADATA_KEY.to_string(), mtime.to_rfc3339());
    m
}

/// Validate that the rel_paths in an execute request are sane (no
/// `..`/absolute), so a malicious or malformed request can't escape the
/// configured roots.
pub fn validate_execute_paths(req: &ExecuteSyncRequest) -> Result<(), String> {
    for a in &req.actions {
        if a.rel_path.is_empty() {
            return Err("empty rel_path in actions".to_string());
        }
        if a.rel_path.starts_with('/') || a.rel_path.starts_with('\\') {
            return Err(format!("rel_path cannot be absolute: {}", a.rel_path));
        }
        if a.rel_path.split(['/', '\\']).any(|seg| seg == "..") {
            return Err(format!("rel_path cannot contain '..': {}", a.rel_path));
        }
    }
    Ok(())
}
