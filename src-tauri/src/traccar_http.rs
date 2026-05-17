use std::{collections::HashMap, time::Duration};

use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Client, Method, Url,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraccarHttpRequestInput {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraccarHttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[tauri::command]
pub async fn traccar_http_request(
    input: TraccarHttpRequestInput,
) -> Result<TraccarHttpResponse, String> {
    let timeout_ms = input.timeout_ms.unwrap_or(10_000);
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| format!("Failed to build Traccar HTTP client: {error}"))?;

    traccar_http_request_with_client(&client, input).await
}

async fn traccar_http_request_with_client(
    client: &Client,
    input: TraccarHttpRequestInput,
) -> Result<TraccarHttpResponse, String> {
    let url = Url::parse(input.url.trim())
        .map_err(|error| format!("Invalid Traccar request URL: {error}"))?;
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err(String::from("Traccar request URL must use http or https.")),
    }

    let method = input
        .method
        .parse::<Method>()
        .map_err(|error| format!("Invalid Traccar request method: {error}"))?;
    let headers = build_header_map(input.headers)?;
    let mut request = client.request(method, url).headers(headers);

    if let Some(body) = input.body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Traccar request failed: {error}"))?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let headers = response_headers_to_map(response.headers());
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read Traccar response body: {error}"))?;

    Ok(TraccarHttpResponse {
        status: status.as_u16(),
        status_text,
        headers,
        body,
    })
}

fn build_header_map(headers: HashMap<String, String>) -> Result<HeaderMap, String> {
    let mut output = HeaderMap::new();

    for (name, value) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("Invalid Traccar request header name `{name}`: {error}"))?;
        let header_value = HeaderValue::from_str(&value).map_err(|error| {
            format!("Invalid Traccar request header value for `{name}`: {error}")
        })?;
        output.insert(header_name, header_value);
    }

    Ok(output)
}

fn response_headers_to_map(headers: &HeaderMap) -> HashMap<String, String> {
    let mut output = HashMap::new();

    for (name, value) in headers {
        if let Ok(value) = value.to_str() {
            output.insert(name.as_str().to_string(), value.to_string());
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    #[tokio::test]
    async fn traccar_http_request_uses_reqwest_for_plain_http_urls() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = vec![0; 4096];
            let bytes_read = stream.read(&mut buffer).await.unwrap();
            let request = String::from_utf8_lossy(&buffer[..bytes_read]);

            assert!(request.starts_with("GET /api/devices HTTP/1.1"));
            assert!(request.contains("cookie: JSESSIONID=session-123"));

            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nset-cookie: JSESSIONID=session-456; Path=/\r\ncontent-length: 21\r\n\r\n[{\"id\":1,\"name\":\"A\"}]",
                )
                .await
                .unwrap();
        });
        let mut headers = HashMap::new();
        headers.insert(String::from("Accept"), String::from("application/json"));
        headers.insert(
            String::from("Cookie"),
            String::from("JSESSIONID=session-123"),
        );

        let response = traccar_http_request_with_client(
            &Client::new(),
            TraccarHttpRequestInput {
                url: format!("http://{address}/api/devices"),
                method: String::from("GET"),
                headers,
                body: None,
                timeout_ms: Some(5_000),
            },
        )
        .await
        .unwrap();

        server.await.unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.status_text, "OK");
        assert_eq!(
            response.headers.get("set-cookie").unwrap(),
            "JSESSIONID=session-456; Path=/"
        );
        assert_eq!(response.body, r#"[{"id":1,"name":"A"}]"#);
    }

    #[tokio::test]
    async fn traccar_http_request_rejects_non_http_urls() {
        let error = traccar_http_request_with_client(
            &Client::new(),
            TraccarHttpRequestInput {
                url: String::from("file:///tmp/devices.json"),
                method: String::from("GET"),
                headers: HashMap::new(),
                body: None,
                timeout_ms: Some(5_000),
            },
        )
        .await
        .unwrap_err();

        assert_eq!(error, "Traccar request URL must use http or https.");
    }
}
