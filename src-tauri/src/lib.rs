mod ai;

use tauri::Manager;

/// 清掉 WebView2 残留的 Service Worker 缓存（V2.12.1）。
///
/// 背景：本项目同时是 PWA，`usePWAUpdate` 在桌面端也注册了 Service Worker；
/// `http://tauri.localhost` 是合法 http origin，`navigateFallback: 'index.html'`
/// 又让 SW 连页面导航一起接管。结果是换掉 exe 之后，WebView2 仍然从 Cache Storage
/// 里取旧的 index.html 与旧 chunk —— 界面、题型白名单、组件实现全部停在升级前那
/// 一版，而且全程不报错，看着就像"新 exe 没生效"。
///
/// 为什么必须在 Rust 里做：SW 一旦接管，跑在画面上的就是旧 JS，新前端逻辑压根没
/// 机会执行；只有这里（WebView2 尚未初始化）能先手把 profile 里的 SW 拿掉。
///
/// 只在版本号变化时清一次，平时启动零开销；只动 Service Worker 与 CacheStorage，
/// IndexedDB（全部做题记录、导入的学习包）不碰。
fn purge_stale_sw_cache(app: &tauri::AppHandle) {
  const VERSION: &str = env!("CARGO_PKG_VERSION");

  let Ok(local_dir) = app.path().app_local_data_dir() else {
    return;
  };
  let stamp = local_dir.join(".sw-cache-version");
  if std::fs::read_to_string(&stamp)
    .map(|v| v.trim() == VERSION)
    .unwrap_or(false)
  {
    return;
  }

  let profile = local_dir.join("EBWebView").join("Default");
  let mut cleared: Vec<&str> = Vec::new();
  for name in ["Service Worker", "CacheStorage"] {
    let dir = profile.join(name);
    if dir.exists() && std::fs::remove_dir_all(&dir).is_ok() {
      cleared.push(name);
    }
  }

  let _ = std::fs::create_dir_all(&local_dir);
  let _ = std::fs::write(&stamp, VERSION);
  log::info!("WebView2 SW 缓存已清（{VERSION}）：{cleared:?}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // 取消标志表：全局一份，按请求 id 隔离（见 ai/inference.rs 顶部）
    .manage(ai::StreamRegistry::default())
    // D-2 自动更新插件（前端走 @tauri-apps/plugin-updater）
    .plugin(tauri_plugin_updater::Builder::new().build())
    // D-2 更新完成后 relaunch（前端 @tauri-apps/plugin-process）
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![
      ai::ai_backend_info,
      ai::inference::ai_chat_stream,
      ai::inference::ai_chat_abort,
      ai::models::ai_model_status,
      ai::models::ai_model_download,
      ai::models::ai_model_pick,
      ai::models::ai_model_remove,
    ])
    .setup(|app| {
      // 必须在窗口/WebView2 创建之前：SW 把导航接管了的话，前端拿到的是旧资源，
      // 新加的任何清理逻辑都跑不到。
      purge_stale_sw_cache(app.handle());
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
