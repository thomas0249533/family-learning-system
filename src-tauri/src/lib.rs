mod ai;

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
