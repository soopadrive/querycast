// RSS fetching from the Rust shell. WebView2 enforces CORS and YouTube's
// RSS feeds at youtube.com/feeds/* don't return CORS headers, so a JS-side
// fetch from the WebView would be blocked. The Rust shell is unconstrained
// by CORS and fetches the XML on JS's behalf.

use std::time::Duration;
use tauri::async_runtime;

const FETCH_TIMEOUT_SECS: u64 = 30;

#[tauri::command]
pub async fn fetch_rss(channel_id: String) -> Result<String, String> {
    if !is_valid_channel_id(&channel_id) {
        return Err("invalid channel_id format".to_string());
    }

    let url = format!(
        "https://www.youtube.com/feeds/videos.xml?channel_id={}",
        channel_id
    );

    let result = async_runtime::spawn_blocking(move || -> Result<String, String> {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(10))
            .timeout_read(Duration::from_secs(FETCH_TIMEOUT_SECS))
            .user_agent("QueryCast/0.1")
            .build();

        match agent.get(&url).call() {
            Ok(resp) if resp.status() == 200 => {
                resp.into_string().map_err(|e| e.to_string())
            }
            Ok(resp) => Err(format!("HTTP {}", resp.status())),
            // 404 means deleted/invalid channel — surface a recognizable string
            // so JS can swallow it gracefully without polluting the console.
            Err(ureq::Error::Status(404, _)) => Err("not_found".to_string()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    result
}

fn is_valid_channel_id(id: &str) -> bool {
    id.len() == 24
        && id.starts_with("UC")
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}
