//! 离线 AI（Candle）后端。
//!
//! - `inference`：GGUF 逐 token 流式推理 + 取消（A1b）；
//! - `models`：模型状态 / 下载 / 选文件 / 删除（A2）。
//!
//! ## 权限口径（贯穿整个模块）
//! 模型落盘、路径解析、文件读取**全部在 Rust 侧**完成，前端只拿"状态 + 进度 + 错误码"。
//! `capabilities/default.json` 只有 `core:default`，没有 `fs:allow-*` —— 即便 WebView 里
//! 跑进一段恶意脚本，它也没有读任意路径的能力。

pub mod inference;
pub mod models;

// 只 re-export 非 command 项：`#[tauri::command]` 生成的宏必须留在模块内，
// 在 lib.rs 里要用 `ai::inference::xxx` 的全路径注册（否则宏找不到）。
pub use inference::StreamRegistry;

/// 与 `src-tauri/Cargo.lock` 一致的 candle 版本，仅用于前端诊断展示。
pub const CANDLE_VERSION: &str = "0.11.0";

/// 极简后端探测：构造一个 1×1 空张量，证明 CPU 后端可初始化。
/// **不读磁盘、不加载模型、不分配大内存。**
pub fn backend_probe() -> Result<(), String> {
  candle_core::Tensor::zeros((1, 1), candle_core::DType::F32, &candle_core::Device::Cpu)
    .map(|_| ())
    .map_err(|e| format!("cpu-probe-failed: {e}"))
}

/// 前端查询本地 AI 后端能力。
///
/// `available` 的判据与 `ai_chat_stream` **同口径**（`models::first_model`）：
/// 设置页说"已就绪"而讲评说"没模型"是最难查的那类 bug，两处必须一起改。
#[tauri::command]
pub fn ai_backend_info(app: tauri::AppHandle) -> serde_json::Value {
  let probe = backend_probe();
  let status = models::status_of(&app);
  let reason = match &probe {
    Err(e) => e.clone(),
    Ok(()) => status.reason.clone(),
  };
  serde_json::json!({
    "available": probe.is_ok() && status.available,
    "reason": reason,
    "candleVersion": CANDLE_VERSION,
    "model": status.file_name,
    "sizeBytes": status.size_bytes,
  })
}
