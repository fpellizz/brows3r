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

    /// Remove all cached clients.
    pub async fn clear(&self) {
        let mut clients = self.clients.write().await;
        clients.clear();
    }
}

async fn create_s3_client(config: &S3ClientConfig) -> Result<Client, S3Error> {
    let credentials_provider = build_credentials_provider(config);

    let connect_secs = config.timeout_secs.max(5) as u64;
    let timeout_config = TimeoutConfig::builder()
        .connect_timeout(Duration::from_secs(connect_secs))
        .operation_timeout(Duration::from_secs(connect_secs * 3))
        .build();

    // Use aws_config to get a fully configured SDK config (with HTTP client)
    let sdk_config = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(config.region.clone()))
        .credentials_provider(credentials_provider)
        .endpoint_url(&config.endpoint)
        .timeout_config(timeout_config)
        .load()
        .await;

    let mut s3_config_builder =
        aws_sdk_s3::config::Builder::from(&sdk_config);

    if let Some(force_path_style) = config.force_path_style {
        s3_config_builder = s3_config_builder.force_path_style(force_path_style);
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
