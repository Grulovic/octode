use crate::secrets::{resolve, SecretValue, Secrets};
use base64::{prelude::BASE64_STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueRow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub secret: bool,
    #[serde(default)]
    pub has_secret: bool,
    #[serde(default)]
    pub file: bool,
}
fn enabled() -> bool {
    true
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRequest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub folder_id: String,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<ValueRow>,
    #[serde(default)]
    pub params: Vec<ValueRow>,
    pub body_mode: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub form: Vec<ValueRow>,
    pub auth: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub credential: SecretValue,
    pub timeout_seconds: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub bytes: usize,
    pub elapsed_ms: u128,
    pub truncated: bool,
    pub content_type: String,
    pub binary: bool,
}

pub fn expand(input: &str, variables: &HashMap<String, String>) -> Result<String, String> {
    let mut rest = input;
    let mut output = String::new();
    while let Some(start) = rest.find("{{") {
        output.push_str(&rest[..start]);
        let following = &rest[start + 2..];
        let end = following
            .find("}}")
            .ok_or("An environment variable is missing its closing braces")?;
        let name = following[..end].trim();
        output.push_str(
            variables
                .get(name)
                .ok_or_else(|| format!("Environment variable '{name}' has no value"))?,
        );
        rest = &following[end + 2..];
    }
    output.push_str(rest);
    Ok(output)
}
pub fn row_value(row: &ValueRow, project: &str, vault: &impl Secrets) -> Result<String, String> {
    resolve(
        &SecretValue {
            id: row.id.clone(),
            value: row.value.clone(),
            secret: row.secret,
            has_secret: row.has_secret,
        },
        project,
        vault,
    )
}

async fn prepare(
    request: ApiRequest,
    environment: Vec<ValueRow>,
    project: &str,
    vault: &impl Secrets,
) -> Result<reqwest::RequestBuilder, String> {
    if serde_json::to_vec(&request)
        .map_err(|_| "Invalid request")?
        .len()
        > 4 * 1024 * 1024
        || serde_json::to_vec(&environment)
            .map_err(|_| "Invalid environment")?
            .len()
            > 4 * 1024 * 1024
    {
        return Err("Request settings and environment must each fit within 4 MB".into());
    }
    let mut variables = HashMap::new();
    for row in environment
        .iter()
        .filter(|row| row.enabled && !row.name.trim().is_empty())
    {
        variables.insert(row.name.clone(), row_value(row, project, vault)?);
    }
    let url = reqwest::Url::parse(&expand(&request.url, &variables)?)
        .map_err(|_| "Enter a valid HTTP or HTTPS URL")?;
    if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() {
        return Err("Only HTTP and HTTPS URLs are supported".into());
    }
    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| "Invalid HTTP method")?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(request.timeout_seconds.clamp(1, 300)))
        .build()
        .map_err(|_| "Could not initialize the HTTP client")?;
    let mut builder = client.request(method, url);
    let params = request
        .params
        .iter()
        .filter(|row| row.enabled && !row.name.trim().is_empty())
        .map(|row| {
            Ok((
                expand(&row.name, &variables)?,
                expand(&row_value(row, project, vault)?, &variables)?,
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;
    builder = builder.query(&params);
    let mut has_content_type = false;
    for row in request
        .headers
        .iter()
        .filter(|row| row.enabled && !row.name.trim().is_empty())
    {
        let name = reqwest::header::HeaderName::from_bytes(row.name.as_bytes())
            .map_err(|_| "A header name is invalid")?;
        has_content_type |= name == reqwest::header::CONTENT_TYPE;
        let mut value = reqwest::header::HeaderValue::from_str(&expand(
            &row_value(row, project, vault)?,
            &variables,
        )?)
        .map_err(|_| "A header value contains invalid characters")?;
        value.set_sensitive(
            row.secret || name == reqwest::header::AUTHORIZATION || name == reqwest::header::COOKIE,
        );
        builder = builder.header(name, value);
    }
    match request.auth.as_str() {
        "bearer" => {
            builder = builder.bearer_auth(expand(
                &resolve(&request.credential, project, vault)?,
                &variables,
            )?)
        }
        "basic" => {
            builder = builder.basic_auth(
                expand(&request.username, &variables)?,
                Some(expand(
                    &resolve(&request.credential, project, vault)?,
                    &variables,
                )?),
            )
        }
        "none" => {}
        _ => return Err("Unknown authentication mode".into()),
    }
    let body = if ["text", "json"].contains(&request.body_mode.as_str()) {
        expand(&request.body, &variables)?
    } else {
        String::new()
    };
    if body.len() > 4 * 1024 * 1024 {
        return Err("Request body exceeds 4 MB".into());
    }
    match request.body_mode.as_str() {
        "none" => {}
        "json" => {
            serde_json::from_str::<serde_json::Value>(&body)
                .map_err(|_| "The JSON body is invalid")?;
            if !has_content_type {
                builder = builder.header(reqwest::header::CONTENT_TYPE, "application/json");
            }
            builder = builder.body(body);
        }
        "text" => builder = builder.body(body),
        "form" => {
            let values = request
                .form
                .iter()
                .filter(|row| row.enabled && !row.name.is_empty())
                .map(|row| {
                    Ok((
                        expand(&row.name, &variables)?,
                        expand(&row_value(row, project, vault)?, &variables)?,
                    ))
                })
                .collect::<Result<Vec<_>, String>>()?;
            builder = builder.form(&values);
        }
        "multipart" => {
            let mut form = reqwest::multipart::Form::new();
            let mut uploaded_bytes = 0u64;
            for row in request
                .form
                .iter()
                .filter(|row| row.enabled && !row.name.is_empty())
            {
                let value = expand(&row_value(row, project, vault)?, &variables)?;
                let name = expand(&row.name, &variables)?;
                if row.file {
                    let metadata = tokio::fs::metadata(&value)
                        .await
                        .map_err(|_| "An upload file could not be read")?;
                    if !metadata.is_file() || metadata.len() > 10 * 1024 * 1024 {
                        return Err("Uploads must be regular files no larger than 10 MB".into());
                    }
                    uploaded_bytes += metadata.len();
                    if uploaded_bytes > 32 * 1024 * 1024 {
                        return Err("Multipart files exceed the combined 32 MB limit".into());
                    }
                    let bytes = tokio::fs::read(&value)
                        .await
                        .map_err(|_| "An upload file could not be read")?;
                    form = form.part(
                        name,
                        reqwest::multipart::Part::bytes(bytes).file_name(
                            std::path::Path::new(&value)
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .into_owned(),
                        ),
                    );
                } else {
                    form = form.text(name, value);
                }
            }
            builder = builder.multipart(form);
        }
        _ => return Err("Unknown request body mode".into()),
    }
    Ok(builder)
}
pub async fn send(
    request: ApiRequest,
    environment: Vec<ValueRow>,
    project: &str,
    vault: &impl Secrets,
) -> Result<ApiResponse, String> {
    let started = Instant::now();
    let builder = prepare(request, environment, project, vault).await?;
    let mut response = builder.send().await.map_err(|e| {
        if e.is_timeout() {
            "Request timed out"
        } else {
            "Request failed; check the URL, connection, and TLS certificate"
        }
    })?;
    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| {
            (
                name.to_string(),
                value.to_str().unwrap_or("<binary>").to_string(),
            )
        })
        .collect();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let mut bytes = Vec::new();
    let mut truncated = false;
    const LIMIT: usize = 2 * 1024 * 1024;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The response body could not be read")?
    {
        let remaining = LIMIT - bytes.len();
        if chunk.len() > remaining {
            bytes.extend_from_slice(&chunk[..remaining]);
            truncated = true;
            break;
        }
        bytes.extend_from_slice(&chunk);
    }
    let length = bytes.len();
    let (body, binary) = match String::from_utf8(bytes) {
        Ok(text) => (text, false),
        Err(error) => (BASE64_STANDARD.encode(error.into_bytes()), true),
    };
    Ok(ApiResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").into(),
        headers,
        body,
        bytes: length,
        elapsed_ms: started.elapsed().as_millis(),
        truncated,
        content_type,
        binary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> ApiRequest {
        serde_json::from_value(serde_json::json!({"id":"one","name":"Test","method":"POST","url":"{{host}}/users","bodyMode":"json","body":"{\"hello\":\"{{name}}\"}","auth":"bearer","credential":{"id":"credential","value":"","secret":true,"hasSecret":true},"timeoutSeconds":30,"params":[{"id":"q","name":"search","value":"a & b","enabled":true},{"id":"off","name":"ignored","value":"no","enabled":false}],"headers":[]})).unwrap()
    }
    #[tokio::test]
    async fn builds_native_request_with_secrets_variables_query_encoding_and_json() {
        use crate::secrets::{tests::Memory, Secrets};
        let vault = Memory::default();
        vault.set("project", "credential", "private-token").unwrap();
        let env = vec![
            ValueRow {
                id: "host".into(),
                name: "host".into(),
                value: "https://example.test".into(),
                enabled: true,
                secret: false,
                has_secret: false,
                file: false,
            },
            ValueRow {
                id: "name".into(),
                name: "name".into(),
                value: "Octode".into(),
                enabled: true,
                secret: false,
                has_secret: false,
                file: false,
            },
        ];
        let built = prepare(request(), env.clone(), "project", &vault)
            .await
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(built.method(), "POST");
        assert_eq!(
            built.url().as_str(),
            "https://example.test/users?search=a+%26+b"
        );
        assert_eq!(built.headers()["authorization"], "Bearer private-token");
        assert!(built.headers()["authorization"].is_sensitive());
        assert_eq!(built.headers()["content-type"], "application/json");
        assert_eq!(
            built.body().unwrap().as_bytes().unwrap(),
            b"{\"hello\":\"Octode\"}"
        );
        assert!(prepare(request(), env, "other-project", &vault)
            .await
            .is_err());
        let mut invalid = request();
        invalid.url = "file:///etc/passwd".into();
        assert!(prepare(invalid, vec![], "project", &vault).await.is_err());
    }
    #[test]
    fn variables_expand_once_and_missing_values_fail() {
        let variables = HashMap::from([
            ("host".into(), "http://localhost".into()),
            ("token".into(), "{{literal}}".into()),
        ]);
        assert_eq!(
            expand("{{ host }}/{{token}}", &variables).unwrap(),
            "http://localhost/{{literal}}"
        );
        assert!(expand("{{missing}}", &variables).is_err());
        assert!(expand("{{broken", &variables).is_err());
    }
}
