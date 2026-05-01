mod auth;
mod feed;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            auth::start_oauth_listener,
            auth::open_url,
            feed::fetch_rss,
        ])
        .run(tauri::generate_context!())
        .expect("error while running QueryCast");
}
