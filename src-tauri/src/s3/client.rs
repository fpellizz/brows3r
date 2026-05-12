use std::collections::HashMap;
use std::time::{Duration, Instant};

use aws_sdk_s3::config::{BehaviorVersion, Region};
use aws_sdk_s3::Client;
use aws_config;
use aws_config::timeout::TimeoutConfig;
use tokio::sync::RwLock;

use super::auth::build_credentials_provider;
use super::error::S3Error;
use super::types::{S3Bucket, S3ClientConfig, S3ListResult, S3Object};

/// Pool of S3 clients keyed by connection ID.
pub struct S3ClientPool {
    clients: RwLock<HashMap<String, Client>>,
}

impl S3ClientPool {
    pub fn new() -> Self {
        Self {
            clients: RwLock::new(HashMap::new()),
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

        // Create a new client
        let client = create_s3_client(config).await?;

        let mut clients = self.clients.write().await;
        clients.insert(connection_id.to_string(), client.clone());

        Ok(client)
    }

    /// Remove a cached client (e.g., when connection config changes).
    pub async fn remove(&self, connection_id: &str) {
        let mut clients = self.clients.write().await;
        clients.remove(connection_id);
    }
}

async fn create_s3_client(config: &S3ClientConfig) -> Result<Client, S3Error> {
    let credentials_provider = build_credentials_provider(config);

    let connect_secs = config.timeout_secs.max(5) as u64;
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
    let proxy_url = config.proxy.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let ca_bundle_path = config
        .ca_bundle
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if proxy_url.is_some() || ca_bundle_path.is_some() {
        use aws_smithy_http_client::{proxy, tls, Builder as HttpClientBuilder, Connector};

        let proxy_cfg = if let Some(url) = proxy_url {
            let cfg = proxy::ProxyConfig::all(url).map_err(|e| {
                S3Error::ConfigError(format!("invalid proxy URL '{url}': {e}"))
            })?;
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
                .map_err(|e| {
                    S3Error::ConfigError(format!("invalid CA bundle '{path}': {e}"))
                })?;
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

    let mut s3_config_builder =
        aws_sdk_s3::config::Builder::from(&sdk_config);

    if let Some(force_path_style) = config.force_path_style {
        s3_config_builder = s3_config_builder.force_path_style(force_path_style);
        tracing::info!(
            "S3 client addressing: {} (endpoint={})",
            if force_path_style { "path-style" } else { "virtual-hosted" },
            config.endpoint
        );
    }

    let s3_config = s3_config_builder.build();
    Ok(Client::from_conf(s3_config))
}

// --- Operations ---

pub async fn list_buckets(client: &Client) -> Result<Vec<S3Bucket>, S3Error> {
    let output = client
        .list_buckets()
        .send()
        .await
        .map_err(|e| {
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

pub async fn delete_objects(
    client: &Client,
    bucket: &str,
    keys: &[String],
) -> Result<(), S3Error> {
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
                kms_master_key_id: default
                    .kms_master_key_id()
                    .map(|s| s.to_string()),
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
    let default = default_builder.build().map_err(|e| {
        S3Error::ConfigError(format!("invalid encryption config: {e}"))
    })?;

    let mut rule_builder = ServerSideEncryptionRule::builder()
        .apply_server_side_encryption_by_default(default);
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
pub async fn delete_bucket_encryption(
    client: &Client,
    bucket: &str,
) -> Result<(), S3Error> {
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
pub async fn get_bucket_policy(
    client: &Client,
    bucket: &str,
) -> Result<Option<String>, S3Error> {
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
pub async fn set_bucket_policy(
    client: &Client,
    bucket: &str,
    policy: &str,
) -> Result<(), S3Error> {
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
pub async fn delete_bucket_policy(
    client: &Client,
    bucket: &str,
) -> Result<(), S3Error> {
    client
        .delete_bucket_policy()
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
