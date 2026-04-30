// OAuth localhost loopback listener for the PKCE auth code flow (RFC 8252).
// Front-end (JS) calls start_oauth_listener, gets a port, opens the system
// browser at the Google auth URL with redirect_uri=http://127.0.0.1:PORT.
// Browser hits the listener after consent; we capture ?code=..., respond
// with a "you can close this tab" page, and emit the code to JS via event.

use std::thread;
use std::time::Duration;

use tauri::{Emitter, WebviewWindow};
use tiny_http::{Header, Response, Server};

const LISTENER_TIMEOUT_SECS: u64 = 300; // 5 minutes for user to complete OAuth

#[tauri::command]
pub fn start_oauth_listener(window: WebviewWindow) -> Result<u16, String> {
    let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| "listener bound to non-IP address".to_string())?
        .port();

    thread::spawn(move || {
        match server.recv_timeout(Duration::from_secs(LISTENER_TIMEOUT_SECS)) {
            Ok(Some(request)) => {
                let code = parse_query_param(request.url(), "code");
                let error = parse_query_param(request.url(), "error");

                let body = "<!DOCTYPE html><html><head><title>QueryCast</title></head>\
                    <body style='font-family:sans-serif;text-align:center;padding:3rem;\
                    background:#0f1117;color:#c9d1d9;'>\
                    <h2 style='color:#7eb8ff;'>You can close this tab.</h2>\
                    <p>Returning to QueryCast.</p></body></html>";
                let header = "Content-Type: text/html; charset=utf-8"
                    .parse::<Header>()
                    .expect("static header parses");
                let response = Response::from_string(body).with_header(header);
                let _ = request.respond(response);

                if let Some(c) = code {
                    let _ = window.emit("oauth-code", c);
                } else if let Some(e) = error {
                    let _ = window.emit("oauth-error", e);
                } else {
                    let _ = window.emit("oauth-error", "no code or error in callback");
                }
            }
            Ok(None) => {
                let _ = window.emit("oauth-error", "timeout — user did not complete sign-in");
            }
            Err(e) => {
                let _ = window.emit("oauth-error", e.to_string());
            }
        }
    });

    Ok(port)
}

fn parse_query_param(url: &str, key: &str) -> Option<String> {
    let query = url.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let k = parts.next()?;
        let v = parts.next()?;
        if k == key {
            return Some(url_decode(v));
        }
    }
    None
}

fn url_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                if let Ok(c) = u8::from_str_radix(
                    std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""),
                    16,
                ) {
                    out.push(c as char);
                    i += 3;
                } else {
                    out.push(bytes[i] as char);
                    i += 1;
                }
            }
            b => {
                out.push(b as char);
                i += 1;
            }
        }
    }
    out
}
