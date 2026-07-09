use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use aws_config;
use aws_config::timeout::TimeoutConfig;
use aws_sdk_s3::config::{BehaviorVersion, Region};
use aws_sdk_s3::Client;
use tokio::sync::RwLock;

use super::auth::build_credentials_provider;
use super::error::S3Error;
use super::types::{S3Bucket, S3ClientConfig, S3ListResult, S3Object};

/// Pool of S3 clients keyed by connection ID.
pub struct S3ClientPool {
    clients: RwLock<HashMap<String, Client>>,
    /// Connection IDs whose addressing was auto-downgraded to path-style
    /// this session (virtual-hosted turned out to be unreachable) and not
    /// yet persisted. Drained by `take_pending_downgrade` at the command
    /// layer, which writes the choice back to the connection profile.
    pending_downgrades: RwLock<HashSet<String>>,
}

impl S3ClientPool {
    pub fn new() -> Self {
        Self {
            clients: RwLock::new(HashMap::new()),
            pending_downgrades: RwLock::new(HashSet::new()),
        }
    }

    /// Get or create an S3 client for the given connection.
    pub async fn get_or_create(
        &self,
        connection_id: &str,
        config: &S3ClientConfig,
    ) -> Result<Client, S3Error> {
        // Check if we already have a client
        {
            let clients = self.clients.read().await;
            if let Some(client) = clients.get(connection_id) {
                return Ok(client.clone());
            }
        }

        // Decide the addressing style *before* building the real client, so
        // that every subsequent operation — including un-retryable streaming
        // uploads — talks to a working endpoint. Some S3-compatible backends
        // serve `ListBuckets` on the base host but cannot be reached via the
        // per-bucket virtual-hosted hostname (`<bucket>.endpoint`), typically
        // because their TLS certificate only covers the base host, or because
        // there is no wildcard DNS. In that case fall back to path-style.
        let mut effective = config.clone();
        if should_probe_addressing(config) && virtual_hosted_addressing_unreachable(config).await {
            tracing::warn!(
                "virtual-hosted addressing is unreachable for endpoint {} \
                 (the TLS certificate or DNS likely does not cover per-bucket \
                 subdomains); falling back to path-style for this connection",
                config.endpoint
            );
            effective.force_path_style = Some(true);
            self.pending_downgrades
                .write()
                .await
                .insert(connection_id.to_string());
        }

        // Create a new client
        let client = create_s3_client(&effective).await?;

        let mut clients = self.clients.write().await;
        clients.insert(connection_id.to_string(), client.clone());

        Ok(client)
    }

    /// Remove a cached client (e.g., when connection config changes).
    pub async fn remove(&self, connection_id: &str) {
        let mut clients = self.clients.write().await;
        clients.remove(connection_id);
        // Drop any un-consumed downgrade flag too: the config is about to be
        // rebuilt (and re-probed if needed), so a stale flag must not cause a
        // later persist that overrides a freshly-edited addressing choice.
        self.pending_downgrades.write().await.remove(connection_id);
    }

    /// Consume (and clear) the "addressing was auto-downgraded" flag for a
    /// connection. Returns `true` exactly once per detected downgrade, so the
    /// caller can persist the path-style choice to the connection profile.
    pub async fn take_pending_downgrade(&self, connection_id: &str) -> bool {
        self.pending_downgrades.write().await.remove(connection_id)
    }
}

async fn create_s3_client(config: &S3ClientConfig) -> Result<Client, S3Error> {
    let credentials_provider = build_credentials_provider(config);

    let connect_secs = config.timeout_secs.max(5);
    let timeout_config = TimeoutConfig::builder()
        .connect_timeout(Duration::from_secs(connect_secs))
        .operation_timeout(Duration::from_secs(connect_secs * 3))
        .build();

    // `max_retries` in the UI is the number of retries *after* the
    // initial attempt; the AWS SDK's `max_attempts` is the total
    // attempts including the first one. Map between them and force
    // a floor of 1 so we never end up with zero attempts.
    let max_attempts = config.max_retries.saturating_add(1).max(1);
    let retry_config = aws_config::retry::RetryConfig::standard().with_max_attempts(max_attempts);

    let mut loader = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(config.region.clone()))
        .credentials_provider(credentials_provider)
        .endpoint_url(&config.endpoint)
        .timeout_config(timeout_config)
        .retry_config(retry_config);

    // Plug a custom HTTP client when the connection profile carries
    // a proxy URL or a CA bundle path — the default client built by
    // `aws_config::defaults()` knows nothing about either setting,
    // so without this step those UI fields are silently ignored.
    let proxy_url = config
        .proxy
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let ca_bundle_path = config
        .ca_bundle
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if proxy_url.is_some() || ca_bundle_path.is_some() {
        use aws_smithy_http_client::{proxy, tls, Builder as HttpClientBuilder, Connector};

        let proxy_cfg = if let Some(url) = proxy_url {
            let cfg = proxy::ProxyConfig::all(url)
                .map_err(|e| S3Error::ConfigError(format!("invalid proxy URL '{url}': {e}")))?;
            tracing::info!("S3 client using HTTP proxy: {}", url);
            Some(cfg)
        } else {
            None
        };

        let tls_context = if let Some(path) = ca_bundle_path {
            let pem = std::fs::read(path).map_err(|e| {
                S3Error::ConfigError(format!("cannot read CA bundle '{path}': {e}"))
            })?;
            // Trust the user-provided cert *in addition to* the system
            // roots — the on-prem-with-self-signed-cert scenario, but
            // the same connection might still need to reach AWS too.
            let store = tls::TrustStore::default().with_pem_certificate(pem);
            let ctx = tls::TlsContext::builder()
                .with_trust_store(store)
                .build()
                .map_err(|e| S3Error::ConfigError(format!("invalid CA bundle '{path}': {e}")))?;
            tracing::info!("S3 client using custom CA bundle: {}", path);
            Some(ctx)
        } else {
            None
        };

        // proxy_config / tls_context live on ConnectorBuilder, not on
        // the top-level Builder, so we route through
        // `build_with_connector_fn` to plug a Connector that knows
        // about both.
        let proxy_cfg = proxy_cfg.map(std::sync::Arc::new);
        let tls_context = tls_context.map(std::sync::Arc::new);
        let http_client = HttpClientBuilder::new().build_with_connector_fn(
            move |settings, _runtime_components| {
                let mut b = Connector::builder();
                if let Some(s) = settings {
                    b = b.connector_settings(s.clone());
                }
                if let Some(p) = proxy_cfg.as_ref() {
                    b = b.proxy_config((**p).clone());
                }
                let mut b = b.tls_provider(tls::Provider::Rustls(
                    tls::rustls_provider::CryptoMode::Ring,
                ));
                if let Some(ctx) = tls_context.as_ref() {
                    b = b.tls_context((**ctx).clone());
                }
                b.build()
            },
        );
        loader = loader.http_client(http_client);
    }

    let sdk_config = loader.load().await;

    let mut s3_config_builder = aws_sdk_s3::config::Builder::from(&sdk_config);

    if let Some(force_path_style) = config.force_path_style {
        s3_config_builder = s3_config_builder.force_path_style(force_path_style);
        tracing::info!(
            "S3 client addressing: {} (endpoint={})",
            if force_path_style {
                "path-style"
            } else {
                "virtual-hosted"
            },
            config.endpoint
        );
    }

    // aws-sdk-s3 >= 1.85 defaults to `WhenSupported`, which means every
    // PutObject / UploadPart gets a trailing CRC32 checksum (Transfer-Encoding:
    // chunked + `x-amz-checksum-crc32` trailer). AWS S3 understands this, but
    // many S3-compatible backends (older Ceph RadosGW, MinIO before 2024,
    // OCI, Wasabi, ...) reject those uploads with cryptic 4xx errors. Pin to
    // `WhenRequired` so the SDK only emits checksums when the operation
    // strictly needs one — restoring the pre-1.85 behavior.
    s3_config_builder = s3_config_builder
        .request_checksum_calculation(aws_sdk_s3::config::RequestChecksumCalculation::WhenRequired)
        .response_checksum_validation(aws_sdk_s3::config::ResponseChecksumValidation::WhenRequired);

    let s3_config = s3_config_builder.build();
    Ok(Client::from_conf(s3_config))
}

/// Bucket name used only by the virtual-hosted reachability probe. It is
/// never created; we only care whether the request can reach the server.
const VHOST_PROBE_BUCKET: &str = "brows3r-vhost-probe";

/// Whether it is worth probing virtual-hosted reachability for this config.
/// Only meaningful for a custom endpoint that would use virtual-hosted
/// addressing — i.e. path-style is not already forced. Plain AWS (no custom
/// endpoint) and connections explicitly pinned to path-style are skipped.
fn should_probe_addressing(config: &S3ClientConfig) -> bool {
    !config.endpoint.trim().is_empty() && config.force_path_style != Some(true)
}

/// Probe whether virtual-hosted addressing can actually reach the backend.
/// Builds a throwaway, no-retry client pinned to virtual-hosted addressing
/// and issues a single `HeadBucket` against a sentinel bucket. A transport
/// (`DispatchFailure`) error — TLS certificate name mismatch, DNS failure,
/// connection refused — means the per-bucket hostname is unusable. Any HTTP
/// response (404 NoSuchBucket, 403, ...) proves the hostname resolved,
/// connected and completed TLS, so virtual-hosted addressing is fine.
async fn virtual_hosted_addressing_unreachable(config: &S3ClientConfig) -> bool {
    use aws_sdk_s3::error::SdkError;

    let mut probe_cfg = config.clone();
    probe_cfg.force_path_style = Some(false); // force virtual-hosted for the probe
    probe_cfg.max_retries = 0; // single attempt — don't wait through backoff
    probe_cfg.timeout_secs = probe_cfg.timeout_secs.min(8); // keep the probe snappy

    let client = match create_s3_client(&probe_cfg).await {
        Ok(c) => c,
        // If we can't even build the probe client, don't second-guess the
        // configured addressing — let the real request surface the error.
        Err(_) => return false,
    };

    matches!(
        client.head_bucket().bucket(VHOST_PROBE_BUCKET).send().await,
        Err(SdkError::DispatchFailure(_))
    )
}

// --- Operations ---

pub async fn list_buckets(client: &Client) -> Result<Vec<S3Bucket>, S3Error> {
    let output = client.list_buckets().send().await.map_err(|e| {
        let msg = super::error::sdk_error_detail(&e);
        tracing::error!("ListBuckets failed: {msg}");
        S3Error::SdkError(msg)
    })?;

    let buckets = output
        .buckets()
        .iter()
        .map(|b| S3Bucket {
            name: b.name().unwrap_or_default().to_string(),
            creation_date: b.creation_date().map(|d| d.to_string()),
        })
        .collect();

    Ok(buckets)
}

pub async fn list_objects(
    client: &Client,
    bucket: &str,
    prefix: Option<&str>,
    delimiter: Option<&str>,
    max_keys: Option<i32>,
    continuation_token: Option<&str>,
) -> Result<S3ListResult, S3Error> {
    let mut request = client.list_objects_v2().bucket(bucket);

    if let Some(p) = prefix {
        request = request.prefix(p);
    }
    if let Some(d) = delimiter {
        request = request.delimiter(d);
    }
    if let Some(m) = max_keys {
        request = request.max_keys(m);
    }
    if let Some(t) = continuation_token {
        request = request.continuation_token(t);
    }

    let output = request
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    let objects = output
        .contents()
        .iter()
        .map(|o| S3Object {
            key: o.key().unwrap_or_default().to_string(),
            size: o.size().unwrap_or(0),
            last_modified: o.last_modified().map(|d| d.to_string()),
            etag: o.e_tag().map(|s| s.to_string()),
            storage_class: o.storage_class().map(|s| s.as_str().to_string()),
        })
        .collect();

    let common_prefixes = output
        .common_prefixes()
        .iter()
        .filter_map(|cp| cp.prefix().map(|s| s.to_string()))
        .collect();

    Ok(S3ListResult {
        objects,
        common_prefixes,
        continuation_token: output.next_continuation_token().map(|s| s.to_string()),
        is_truncated: output.is_truncated().unwrap_or(false),
    })
}

pub async fn head_object(
    client: &Client,
    bucket: &str,
    key: &str,
) -> Result<crate::models::object::ObjectDetails, S3Error> {
    let output = client
        .head_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    let metadata = output
        .metadata()
        .map(|m| {
            m.iter()
                .map(|(k, v)| crate::models::object::MetadataEntry {
                    key: k.to_string(),
                    value: v.to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(crate::models::object::ObjectDetails {
        key: key.to_string(),
        size: output.content_length().unwrap_or(0),
        last_modified: output.last_modified().map(|d| d.to_string()),
        etag: output.e_tag().map(|s| s.to_string()),
        content_type: output.content_type().map(|s| s.to_string()),
        storage_class: output.storage_class().map(|s| s.as_str().to_string()),
        metadata,
        version_id: output.version_id().map(|s| s.to_string()),
    })
}

pub async fn delete_objects(client: &Client, bucket: &str, keys: &[String]) -> Result<(), S3Error> {
    use aws_sdk_s3::types::{Delete, ObjectIdentifier};

    let objects: Vec<ObjectIdentifier> = keys
        .iter()
        .map(|k| ObjectIdentifier::builder().key(k).build().unwrap())
        .collect();

    let delete = Delete::builder()
        .set_objects(Some(objects))
        .build()
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    client
        .delete_objects()
        .bucket(bucket)
        .delete(delete)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    Ok(())
}

/// Bulk delete a slice of (key, optional version_id) pairs. Required for
/// emptying versioned buckets — DeleteObjects without versionId leaves
/// historical versions in place.
pub async fn delete_object_versions(
    client: &Client,
    bucket: &str,
    items: &[(String, Option<String>)],
) -> Result<(), S3Error> {
    use aws_sdk_s3::types::{Delete, ObjectIdentifier};

    let objects: Vec<ObjectIdentifier> = items
        .iter()
        .map(|(k, v)| {
            let mut b = ObjectIdentifier::builder().key(k);
            if let Some(version_id) = v {
                b = b.version_id(version_id);
            }
            b.build().unwrap()
        })
        .collect();

    let delete = Delete::builder()
        .set_objects(Some(objects))
        .build()
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    client
        .delete_objects()
        .bucket(bucket)
        .delete(delete)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    Ok(())
}

/// Paginate ListObjectsV2 over a prefix and bulk-delete every key found.
/// Use this for "delete folder" (prefix-scoped) — S3 has no native folder
/// concept, so the folder is just every key under that prefix.
pub async fn delete_prefix(client: &Client, bucket: &str, prefix: &str) -> Result<u64, S3Error> {
    let mut deleted: u64 = 0;
    let mut continuation: Option<String> = None;
    loop {
        let mut req = client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix)
            .max_keys(1000);
        if let Some(t) = continuation.as_deref() {
            req = req.continuation_token(t);
        }
        let out = req
            .send()
            .await
            .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

        let keys: Vec<String> = out
            .contents()
            .iter()
            .filter_map(|o| o.key().map(|s| s.to_string()))
            .collect();

        if !keys.is_empty() {
            delete_objects(client, bucket, &keys).await?;
            deleted += keys.len() as u64;
        }

        if out.is_truncated().unwrap_or(false) {
            continuation = out.next_continuation_token().map(|s| s.to_string());
            if continuation.is_none() {
                break;
            }
        } else {
            break;
        }
    }
    Ok(deleted)
}

/// Empty a bucket: deletes every object key. When `include_versions` is true,
/// also deletes every non-current version and delete-marker via
/// ListObjectVersions — required for versioned buckets before they can be
/// deleted (the bucket reports BucketNotEmpty as long as any version exists).
pub async fn empty_bucket(
    client: &Client,
    bucket: &str,
    include_versions: bool,
) -> Result<u64, S3Error> {
    let mut deleted: u64 = 0;

    // Pass 1: current keys via ListObjectsV2 (works whether versioning is on or off)
    deleted += delete_prefix(client, bucket, "").await?;

    if include_versions {
        // Pass 2: every version + every delete marker
        let mut key_marker: Option<String> = None;
        let mut version_marker: Option<String> = None;
        loop {
            let mut req = client.list_object_versions().bucket(bucket).max_keys(1000);
            if let Some(m) = key_marker.as_deref() {
                req = req.key_marker(m);
            }
            if let Some(m) = version_marker.as_deref() {
                req = req.version_id_marker(m);
            }

            let out = req
                .send()
                .await
                .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

            let mut batch: Vec<(String, Option<String>)> = Vec::new();
            for v in out.versions() {
                if let Some(k) = v.key() {
                    batch.push((k.to_string(), v.version_id().map(|s| s.to_string())));
                }
            }
            for dm in out.delete_markers() {
                if let Some(k) = dm.key() {
                    batch.push((k.to_string(), dm.version_id().map(|s| s.to_string())));
                }
            }

            if !batch.is_empty() {
                // Chunk by 1000 (DeleteObjects per-request limit)
                for chunk in batch.chunks(1000) {
                    delete_object_versions(client, bucket, chunk).await?;
                }
                deleted += batch.len() as u64;
            }

            if out.is_truncated().unwrap_or(false) {
                key_marker = out.next_key_marker().map(|s| s.to_string());
                version_marker = out.next_version_id_marker().map(|s| s.to_string());
                if key_marker.is_none() && version_marker.is_none() {
                    break;
                }
            } else {
                break;
            }
        }
    }

    Ok(deleted)
}

pub async fn copy_object(
    client: &Client,
    source_bucket: &str,
    source_key: &str,
    dest_bucket: &str,
    dest_key: &str,
) -> Result<(), S3Error> {
    let copy_source = format!("{}/{}", source_bucket, source_key);

    client
        .copy_object()
        .copy_source(&copy_source)
        .bucket(dest_bucket)
        .key(dest_key)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    Ok(())
}

/// Apply metadata / content-type / storage-class changes to an
/// existing object via an in-place `CopyObject` with
/// `MetadataDirective=REPLACE`. Caller passes the values they want to
/// end up with on the object — anything left as `None` is preserved
/// from the source via a preceding `HeadObject`.
pub async fn copy_object_in_place_replace(
    client: &Client,
    bucket: &str,
    key: &str,
    new_content_type: Option<&str>,
    new_metadata: Option<std::collections::HashMap<String, String>>,
    new_storage_class: Option<&str>,
) -> Result<(), S3Error> {
    use aws_sdk_s3::types::{MetadataDirective, StorageClass};

    // Resolve the values we want to write. For each field, prefer the
    // explicit override; otherwise preserve what's already on the
    // object so the user doesn't accidentally clear metadata they care
    // about by changing only the storage class.
    let head = client
        .head_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    let preserved_content_type = head.content_type().map(|s| s.to_string());
    let preserved_metadata: std::collections::HashMap<String, String> = head
        .metadata()
        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();

    let final_content_type = new_content_type
        .map(|s| s.to_string())
        .or(preserved_content_type);
    let final_metadata = new_metadata.unwrap_or(preserved_metadata);

    let copy_source = format!("{}/{}", bucket, key);
    let mut req = client
        .copy_object()
        .copy_source(&copy_source)
        .bucket(bucket)
        .key(key)
        .metadata_directive(MetadataDirective::Replace);

    if let Some(ct) = final_content_type {
        req = req.content_type(ct);
    }
    for (k, v) in final_metadata {
        req = req.metadata(k, v);
    }
    if let Some(sc) = new_storage_class {
        req = req.storage_class(StorageClass::from(sc));
    }

    req.send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;
    Ok(())
}

/// Apply a canned ACL to an object (`private`, `public-read`,
/// `public-read-write`, `authenticated-read`, `bucket-owner-read`,
/// `bucket-owner-full-control`).
pub async fn put_object_acl(
    client: &Client,
    bucket: &str,
    key: &str,
    acl: &str,
) -> Result<(), S3Error> {
    use aws_sdk_s3::types::ObjectCannedAcl;
    client
        .put_object_acl()
        .bucket(bucket)
        .key(key)
        .acl(ObjectCannedAcl::from(acl))
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;
    Ok(())
}

pub async fn create_bucket(
    client: &Client,
    bucket: &str,
    region: Option<&str>,
) -> Result<(), S3Error> {
    let mut request = client.create_bucket().bucket(bucket);

    // Only set LocationConstraint if region is not us-east-1
    if let Some(r) = region {
        if r != "us-east-1" {
            use aws_sdk_s3::types::{BucketLocationConstraint, CreateBucketConfiguration};
            let constraint = BucketLocationConstraint::from(r);
            let config = CreateBucketConfiguration::builder()
                .location_constraint(constraint)
                .build();
            request = request.create_bucket_configuration(config);
        }
    }

    request
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    Ok(())
}

pub async fn delete_bucket(client: &Client, bucket: &str) -> Result<(), S3Error> {
    client
        .delete_bucket()
        .bucket(bucket)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    Ok(())
}

// --- Versioning operations --------------------------------------------

/// List versions (and delete markers) for objects under `prefix`. Paginated
/// via `(key_marker, version_id_marker)` per S3 semantics.
pub async fn list_object_versions(
    client: &Client,
    bucket: &str,
    prefix: Option<&str>,
    key_marker: Option<&str>,
    version_id_marker: Option<&str>,
    max_keys: Option<i32>,
) -> Result<
    (
        Vec<crate::models::object::ObjectVersion>,
        Option<String>,
        Option<String>,
        bool,
    ),
    S3Error,
> {
    let mut req = client.list_object_versions().bucket(bucket);
    if let Some(p) = prefix {
        req = req.prefix(p);
    }
    if let Some(m) = key_marker {
        req = req.key_marker(m);
    }
    if let Some(m) = version_id_marker {
        req = req.version_id_marker(m);
    }
    if let Some(n) = max_keys {
        req = req.max_keys(n);
    }

    let out = req
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    let mut versions: Vec<crate::models::object::ObjectVersion> = Vec::new();
    for v in out.versions() {
        versions.push(crate::models::object::ObjectVersion {
            key: v.key().unwrap_or_default().to_string(),
            version_id: v.version_id().unwrap_or_default().to_string(),
            is_latest: v.is_latest().unwrap_or(false),
            is_delete_marker: false,
            size: v.size().unwrap_or(0),
            last_modified: v.last_modified().map(|d| d.to_string()),
            etag: v.e_tag().map(|s| s.to_string()),
            storage_class: v.storage_class().map(|s| s.as_str().to_string()),
        });
    }
    for dm in out.delete_markers() {
        versions.push(crate::models::object::ObjectVersion {
            key: dm.key().unwrap_or_default().to_string(),
            version_id: dm.version_id().unwrap_or_default().to_string(),
            is_latest: dm.is_latest().unwrap_or(false),
            is_delete_marker: true,
            size: 0,
            last_modified: dm.last_modified().map(|d| d.to_string()),
            etag: None,
            storage_class: None,
        });
    }

    // Interleave versions + delete markers by last_modified descending so
    // the UI shows one unified chronological timeline per key.
    versions.sort_by(|a, b| {
        let ak = a.key.cmp(&b.key);
        if ak != std::cmp::Ordering::Equal {
            return ak;
        }
        // Newest first within same key
        b.last_modified
            .as_deref()
            .unwrap_or("")
            .cmp(a.last_modified.as_deref().unwrap_or(""))
    });

    Ok((
        versions,
        out.next_key_marker().map(|s| s.to_string()),
        out.next_version_id_marker().map(|s| s.to_string()),
        out.is_truncated().unwrap_or(false),
    ))
}

/// Read the versioning configuration of a bucket (Enabled / Suspended /
/// Unversioned). `Unversioned` means versioning was never enabled — the
/// S3 API returns an empty/missing status.
pub async fn get_bucket_versioning(
    client: &Client,
    bucket: &str,
) -> Result<crate::models::object::BucketVersioningStatus, S3Error> {
    let out = client
        .get_bucket_versioning()
        .bucket(bucket)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    let status = out
        .status()
        .map(|s| s.as_str().to_string())
        .unwrap_or_else(|| "Unversioned".to_string());
    let mfa_delete = out
        .mfa_delete()
        .map(|s| s.as_str() == "Enabled")
        .unwrap_or(false);

    Ok(crate::models::object::BucketVersioningStatus { status, mfa_delete })
}

/// Enable or suspend versioning on a bucket. S3 does not let you go
/// back from Enabled to "never versioned" — Suspended keeps the
/// existing version history but stops creating new versions.
pub async fn set_bucket_versioning(
    client: &Client,
    bucket: &str,
    enabled: bool,
) -> Result<(), S3Error> {
    use aws_sdk_s3::types::{BucketVersioningStatus, VersioningConfiguration};

    let status = if enabled {
        BucketVersioningStatus::Enabled
    } else {
        BucketVersioningStatus::Suspended
    };
    let cfg = VersioningConfiguration::builder().status(status).build();

    client
        .put_bucket_versioning()
        .bucket(bucket)
        .versioning_configuration(cfg)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    Ok(())
}

/// Read the default server-side encryption configuration of a bucket.
/// Returns `None` when encryption has not been set up. Algorithm is one
/// of `AES256` (SSE-S3), `aws:kms` (SSE-KMS) or `aws:kms:dsse`.
pub async fn get_bucket_encryption(
    client: &Client,
    bucket: &str,
) -> Result<Option<crate::models::bucket::BucketEncryption>, S3Error> {
    match client.get_bucket_encryption().bucket(bucket).send().await {
        Ok(out) => {
            let cfg = out.server_side_encryption_configuration();
            let rule = cfg.and_then(|c| c.rules().first());
            let Some(rule) = rule else {
                return Ok(None);
            };
            let Some(default) = rule.apply_server_side_encryption_by_default() else {
                return Ok(None);
            };
            Ok(Some(crate::models::bucket::BucketEncryption {
                algorithm: default.sse_algorithm().as_str().to_string(),
                kms_master_key_id: default.kms_master_key_id().map(|s| s.to_string()),
                bucket_key_enabled: rule.bucket_key_enabled(),
            }))
        }
        // S3 returns ServerSideEncryptionConfigurationNotFoundError when
        // encryption was never configured — surface it as `None` instead
        // of a hard error. Detect via the chained-error message because
        // matching on the deprecated `GetBucketEncryptionError::Unhandled`
        // variant is no longer forward-compatible.
        Err(e) => {
            let detail = super::error::sdk_error_detail(&e);
            if detail.contains("ServerSideEncryptionConfigurationNotFoundError") {
                Ok(None)
            } else {
                Err(S3Error::SdkError(detail))
            }
        }
    }
}

/// Apply a default server-side encryption configuration to a bucket.
/// `algorithm` must be `AES256` or `aws:kms`. `kms_master_key_id` is
/// required when the algorithm is `aws:kms`, ignored otherwise.
pub async fn set_bucket_encryption(
    client: &Client,
    bucket: &str,
    algorithm: &str,
    kms_master_key_id: Option<&str>,
    bucket_key_enabled: Option<bool>,
) -> Result<(), S3Error> {
    use aws_sdk_s3::types::{
        ServerSideEncryption, ServerSideEncryptionByDefault, ServerSideEncryptionConfiguration,
        ServerSideEncryptionRule,
    };

    let sse_alg = ServerSideEncryption::from(algorithm);

    let mut default_builder = ServerSideEncryptionByDefault::builder().sse_algorithm(sse_alg);
    if let Some(key) = kms_master_key_id {
        default_builder = default_builder.kms_master_key_id(key);
    }
    let default = default_builder
        .build()
        .map_err(|e| S3Error::ConfigError(format!("invalid encryption config: {e}")))?;

    let mut rule_builder =
        ServerSideEncryptionRule::builder().apply_server_side_encryption_by_default(default);
    if let Some(b) = bucket_key_enabled {
        rule_builder = rule_builder.bucket_key_enabled(b);
    }
    let rule = rule_builder.build();

    let cfg = ServerSideEncryptionConfiguration::builder()
        .rules(rule)
        .build()
        .map_err(|e| S3Error::ConfigError(format!("invalid encryption config: {e}")))?;

    client
        .put_bucket_encryption()
        .bucket(bucket)
        .server_side_encryption_configuration(cfg)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;
    Ok(())
}

/// Remove the default server-side encryption configuration from a
/// bucket. New writes will no longer be auto-encrypted (the per-object
/// encryption metadata of existing objects is untouched).
pub async fn delete_bucket_encryption(client: &Client, bucket: &str) -> Result<(), S3Error> {
    client
        .delete_bucket_encryption()
        .bucket(bucket)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;
    Ok(())
}

/// Read the bucket policy as a JSON string. Returns `None` if no
/// policy is attached (`NoSuchBucketPolicy` from S3).
pub async fn get_bucket_policy(client: &Client, bucket: &str) -> Result<Option<String>, S3Error> {
    match client.get_bucket_policy().bucket(bucket).send().await {
        Ok(out) => Ok(out.policy().map(|p| p.to_string())),
        Err(e) => {
            let detail = super::error::sdk_error_detail(&e);
            if detail.contains("NoSuchBucketPolicy") {
                Ok(None)
            } else {
                Err(S3Error::SdkError(detail))
            }
        }
    }
}

/// Replace the bucket policy with the given JSON document. The S3
/// service does the syntactic + permissions validation; we surface
/// its error verbatim.
pub async fn set_bucket_policy(client: &Client, bucket: &str, policy: &str) -> Result<(), S3Error> {
    client
        .put_bucket_policy()
        .bucket(bucket)
        .policy(policy)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;
    Ok(())
}

/// Remove the bucket policy entirely.
pub async fn delete_bucket_policy(client: &Client, bucket: &str) -> Result<(), S3Error> {
    client
        .delete_bucket_policy()
        .bucket(bucket)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;
    Ok(())
}

/// Read the CORS configuration of a bucket. Returns `None` when no
/// CORS configuration is attached (S3 returns
/// `NoSuchCORSConfiguration`).
pub async fn get_bucket_cors(
    client: &Client,
    bucket: &str,
) -> Result<Option<Vec<crate::models::bucket::CorsRule>>, S3Error> {
    match client.get_bucket_cors().bucket(bucket).send().await {
        Ok(out) => {
            let rules: Vec<_> = out
                .cors_rules()
                .iter()
                .map(|r| crate::models::bucket::CorsRule {
                    id: r.id().map(|s| s.to_string()),
                    allowed_methods: r.allowed_methods().to_vec(),
                    allowed_origins: r.allowed_origins().to_vec(),
                    allowed_headers: r.allowed_headers().to_vec(),
                    expose_headers: r.expose_headers().to_vec(),
                    max_age_seconds: r.max_age_seconds(),
                })
                .collect();
            Ok(Some(rules))
        }
        Err(e) => {
            let detail = super::error::sdk_error_detail(&e);
            if detail.contains("NoSuchCORSConfiguration") {
                Ok(None)
            } else {
                Err(S3Error::SdkError(detail))
            }
        }
    }
}

/// Replace the CORS configuration with the given list of rules.
pub async fn set_bucket_cors(
    client: &Client,
    bucket: &str,
    rules: &[crate::models::bucket::CorsRule],
) -> Result<(), S3Error> {
    use aws_sdk_s3::types::{CorsConfiguration, CorsRule as SdkCorsRule};

    let sdk_rules: Vec<SdkCorsRule> = rules
        .iter()
        .map(|r| {
            let mut b = SdkCorsRule::builder()
                .set_allowed_methods(Some(r.allowed_methods.clone()))
                .set_allowed_origins(Some(r.allowed_origins.clone()));
            if let Some(id) = &r.id {
                b = b.id(id);
            }
            if !r.allowed_headers.is_empty() {
                b = b.set_allowed_headers(Some(r.allowed_headers.clone()));
            }
            if !r.expose_headers.is_empty() {
                b = b.set_expose_headers(Some(r.expose_headers.clone()));
            }
            if let Some(age) = r.max_age_seconds {
                b = b.max_age_seconds(age);
            }
            b.build()
                .map_err(|e| S3Error::ConfigError(format!("invalid CORS rule: {e}")))
        })
        .collect::<Result<_, _>>()?;

    let cfg = CorsConfiguration::builder()
        .set_cors_rules(Some(sdk_rules))
        .build()
        .map_err(|e| S3Error::ConfigError(format!("invalid CORS config: {e}")))?;

    client
        .put_bucket_cors()
        .bucket(bucket)
        .cors_configuration(cfg)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;
    Ok(())
}

/// Remove the CORS configuration from a bucket entirely.
pub async fn delete_bucket_cors(client: &Client, bucket: &str) -> Result<(), S3Error> {
    client
        .delete_bucket_cors()
        .bucket(bucket)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;
    Ok(())
}

/// Read the lifecycle configuration of a bucket and convert it to
/// our simplified `LifecycleSnapshot`. Returns `None` when no
/// configuration is attached. Rules using features outside the
/// simplified editor (tag/And filters, date-based transitions, ...)
/// are skipped and `has_unsupported` is set to `true` — the UI
/// switches to read-only mode in that case.
pub async fn get_bucket_lifecycle(
    client: &Client,
    bucket: &str,
) -> Result<Option<crate::models::bucket::LifecycleSnapshot>, S3Error> {
    use aws_sdk_s3::types::TransitionStorageClass;

    let res = client
        .get_bucket_lifecycle_configuration()
        .bucket(bucket)
        .send()
        .await;
    let out = match res {
        Ok(o) => o,
        Err(e) => {
            let detail = super::error::sdk_error_detail(&e);
            if detail.contains("NoSuchLifecycleConfiguration") {
                return Ok(None);
            }
            return Err(S3Error::SdkError(detail));
        }
    };

    let mut rules = Vec::new();
    let mut has_unsupported = false;

    for r in out.rules() {
        // Filter: support only "no filter" or "Prefix-only". Any
        // tag / size / And combination means the rule is too rich for
        // our simplified editor — mark unsupported and skip.
        let prefix: Option<String> = match r.filter() {
            None => None,
            Some(f) => {
                if f.tag().is_some()
                    || f.object_size_greater_than().is_some()
                    || f.object_size_less_than().is_some()
                    || f.and().is_some()
                {
                    has_unsupported = true;
                    continue;
                }
                f.prefix().map(|s| s.to_string())
            }
        };

        // Transitions: require days, skip rule if any uses date or has
        // no storage class.
        let mut transitions = Vec::new();
        let mut tx_unsupported = false;
        for t in r.transitions() {
            if t.date().is_some() {
                tx_unsupported = true;
                break;
            }
            let (Some(days), Some(sc)) = (t.days(), t.storage_class()) else {
                tx_unsupported = true;
                break;
            };
            transitions.push(crate::models::bucket::LifecycleTransition {
                days,
                storage_class: sc.as_str().to_string(),
            });
        }
        if tx_unsupported {
            has_unsupported = true;
            continue;
        }

        // Expiration: only days variant.
        let (expiration_days, expired_marker) = match r.expiration() {
            None => (None, None),
            Some(exp) => {
                if exp.date().is_some() {
                    has_unsupported = true;
                    continue;
                }
                (
                    exp.days().filter(|d| *d > 0).map(|d| d),
                    exp.expired_object_delete_marker(),
                )
            }
        };

        // Noncurrent version transitions.
        let nct = r
            .noncurrent_version_transitions()
            .iter()
            .map(|t| {
                let storage_class = t
                    .storage_class()
                    .map(|s| s.as_str().to_string())
                    .unwrap_or_else(|| TransitionStorageClass::StandardIa.as_str().to_string());
                crate::models::bucket::LifecycleNoncurrentTransition {
                    noncurrent_days: t.noncurrent_days().unwrap_or(0),
                    storage_class,
                }
            })
            .collect();

        let nce_days = r
            .noncurrent_version_expiration()
            .and_then(|n| n.noncurrent_days());

        let abort_days = r
            .abort_incomplete_multipart_upload()
            .and_then(|a| a.days_after_initiation());

        rules.push(crate::models::bucket::LifecycleRule {
            id: r.id().map(|s| s.to_string()),
            status: r.status().as_str().to_string(),
            prefix,
            transitions,
            expiration_days,
            expired_object_delete_marker: expired_marker,
            noncurrent_version_transitions: nct,
            noncurrent_version_expiration_days: nce_days,
            abort_incomplete_multipart_upload_days: abort_days,
        });
    }

    Ok(Some(crate::models::bucket::LifecycleSnapshot {
        rules,
        has_unsupported,
    }))
}

/// Replace the lifecycle configuration with the given rules. Each rule
/// translates to a `LifecycleRule` with at most a `Prefix` filter and
/// day-based transitions/expirations.
pub async fn set_bucket_lifecycle(
    client: &Client,
    bucket: &str,
    rules: &[crate::models::bucket::LifecycleRule],
) -> Result<(), S3Error> {
    use aws_sdk_s3::types::{
        AbortIncompleteMultipartUpload, BucketLifecycleConfiguration, ExpirationStatus,
        LifecycleExpiration, LifecycleRule as SdkLifecycleRule, LifecycleRuleFilter,
        NoncurrentVersionExpiration, NoncurrentVersionTransition, Transition,
        TransitionStorageClass,
    };

    let mut sdk_rules = Vec::new();
    for r in rules {
        let status = match r.status.as_str() {
            "Enabled" => ExpirationStatus::Enabled,
            _ => ExpirationStatus::Disabled,
        };

        // Filter is required when no top-level Prefix is set (S3
        // would reject an empty rule). Always include one with the
        // user prefix (or empty string = all objects).
        let filter = LifecycleRuleFilter::builder()
            .set_prefix(Some(r.prefix.clone().unwrap_or_default()))
            .build();

        let mut b = SdkLifecycleRule::builder().status(status).filter(filter);
        if let Some(id) = &r.id {
            b = b.id(id);
        }

        // Transitions
        for t in &r.transitions {
            b = b.transitions(
                Transition::builder()
                    .days(t.days)
                    .storage_class(TransitionStorageClass::from(t.storage_class.as_str()))
                    .build(),
            );
        }

        // Expiration: only set if any subfield is meaningful.
        if r.expiration_days.is_some() || r.expired_object_delete_marker.is_some() {
            let mut eb = LifecycleExpiration::builder();
            if let Some(d) = r.expiration_days {
                eb = eb.days(d);
            }
            if let Some(m) = r.expired_object_delete_marker {
                eb = eb.expired_object_delete_marker(m);
            }
            b = b.expiration(eb.build());
        }

        // Noncurrent version transitions
        for nct in &r.noncurrent_version_transitions {
            b = b.noncurrent_version_transitions(
                NoncurrentVersionTransition::builder()
                    .noncurrent_days(nct.noncurrent_days)
                    .storage_class(TransitionStorageClass::from(nct.storage_class.as_str()))
                    .build(),
            );
        }

        if let Some(d) = r.noncurrent_version_expiration_days {
            b = b.noncurrent_version_expiration(
                NoncurrentVersionExpiration::builder()
                    .noncurrent_days(d)
                    .build(),
            );
        }

        if let Some(d) = r.abort_incomplete_multipart_upload_days {
            b = b.abort_incomplete_multipart_upload(
                AbortIncompleteMultipartUpload::builder()
                    .days_after_initiation(d)
                    .build(),
            );
        }

        let rule = b
            .build()
            .map_err(|e| S3Error::ConfigError(format!("invalid lifecycle rule: {e}")))?;
        sdk_rules.push(rule);
    }

    let cfg = BucketLifecycleConfiguration::builder()
        .set_rules(Some(sdk_rules))
        .build()
        .map_err(|e| S3Error::ConfigError(format!("invalid lifecycle config: {e}")))?;

    client
        .put_bucket_lifecycle_configuration()
        .bucket(bucket)
        .lifecycle_configuration(cfg)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;
    Ok(())
}

/// Remove the lifecycle configuration from a bucket entirely.
pub async fn delete_bucket_lifecycle(client: &Client, bucket: &str) -> Result<(), S3Error> {
    client
        .delete_bucket_lifecycle()
        .bucket(bucket)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;
    Ok(())
}

/// Permanently delete a specific version of an object. Bypasses the
/// "soft delete" (delete marker) behavior — the version is gone.
pub async fn delete_object_version(
    client: &Client,
    bucket: &str,
    key: &str,
    version_id: &str,
) -> Result<(), S3Error> {
    client
        .delete_object()
        .bucket(bucket)
        .key(key)
        .version_id(version_id)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;
    Ok(())
}

/// Restore a previous version as the current one by copying it onto
/// itself via `x-amz-copy-source: bucket/key?versionId=...`. S3 creates
/// a new version (the latest) with the restored content.
pub async fn restore_object_version(
    client: &Client,
    bucket: &str,
    key: &str,
    version_id: &str,
) -> Result<String, S3Error> {
    // URL-encode the key for the copy source (S3 requires path-style
    // encoding). `uri_encode` is what the SDK uses internally; we just
    // replace the worst offenders manually for readability.
    let encoded_key = key.replace(' ', "%20").replace('+', "%2B");
    let copy_source = format!("{bucket}/{encoded_key}?versionId={version_id}");
    let out = client
        .copy_object()
        .bucket(bucket)
        .key(key)
        .copy_source(copy_source)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    Ok(out
        .copy_object_result()
        .and_then(|r| r.e_tag())
        .unwrap_or_default()
        .to_string())
}

pub async fn test_connection(
    client: &Client,
) -> Result<crate::models::connection::ConnectionTestResult, S3Error> {
    let start = Instant::now();

    match list_buckets(client).await {
        Ok(buckets) => {
            let latency = start.elapsed().as_millis() as u64;
            Ok(crate::models::connection::ConnectionTestResult {
                success: true,
                latency_ms: latency,
                bucket_count: Some(buckets.len() as u32),
                error: None,
            })
        }
        Err(e) => {
            let latency = start.elapsed().as_millis() as u64;
            Ok(crate::models::connection::ConnectionTestResult {
                success: false,
                latency_ms: latency,
                bucket_count: None,
                error: Some(e.to_string()),
            })
        }
    }
}
