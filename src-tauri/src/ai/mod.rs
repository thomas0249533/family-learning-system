//! 离线 AI（Candle）后端。
//!
//! V2.0 · A1a 冒烟闸门：本模块**不加载任何模型**，只证明 candle 能在本机编译/链接，
//! 并给前端一个可调用的 command。真实推理（`ai_chat_stream`）在 A1b，模型管理在 A2。
//! 在那之前 `available` 恒为 `false`、`reason` 为 `no-model`（或探测失败的原因）。

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
#[tauri::command]
pub fn ai_backend_info() -> serde_json::Value {
  // A1a 阶段既没有模型也没有推理通道，所以对前端一律「不可用」；
  // 探测失败时把原因透出去，便于设置页区分「引擎坏了」与「还没装模型」。
  let reason = match backend_probe() {
    Ok(()) => "no-model".to_string(),
    Err(e) => e,
  };
  serde_json::json!({
    "available": false,
    "reason": reason,
    "candleVersion": CANDLE_VERSION,
  })
}
