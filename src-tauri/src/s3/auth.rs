use aws_credential_types::provider::SharedCredentialsProvider;
use aws_credential_types::Credentials;

use super::types::S3ClientConfig;

/// Build an AWS credentials provider from our connection config.
pub fn build_credentials_provider(config: &S3ClientConfig) -> SharedCredentialsProvider {
    let credentials = Credentials::new(
        &config.access_key_id,
        &config.secret_access_key,
        config.session_token.clone(),
        None, // expiry
        "brows3r",
    );

    SharedCredentialsProvider::new(credentials)
}
