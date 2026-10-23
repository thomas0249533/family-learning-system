//! 本地 GGUF 推理（A1b）：逐 token 流式 emit，支持取消与并发隔离。
//!
//! ## 为什么必须"一个 token 一次 emit"
//! 攒够一批再发等于把流式退回非流式：孩子看到的是"卡十几秒 → 整段蹦出来"，
//! 而这十几秒里没有任何东西证明机器在工作。所以循环里**每 decode 出一个增量就发**。
//!
//! ## 为什么按 `general.architecture` 分派
//! candle 0.11 的 `quantized_qwen2` 与 `quantized_qwen3` 是两套独立实现（qwen3 多了
//! `attention.key_length`、去掉了 qwen2 的掩码缓存形状假设），喂错结构不是"效果差一点"
//! 而是加载就失败。GGUF 头部自带 arch 字段，读它比让用户选"这是 qwen2 还是 qwen3"可靠。
//!
//! ## 错误码：每一种都要能落到一句人话
//! `no-model`（没装） / `model-corrupt`（文件坏了/架构不支持） / `oom`（内存不够）
//! / `decode-failed`（推理中途炸了）。前端 `AiFailReason` 有对应文案，UI 不会白屏。
//!
//! ## 为什么取消用 `AtomicBool` 而不是 `AbortHandle`
//! 推理是同步 CPU 循环（candle 的 forward 不返回 future），能打断它的只有循环自己
//! 每轮查一次标志位。`AbortController` 到不了那一层 —— 前端 abort → invoke
//! `ai_chat_abort` → 置位 → 下一个 token 前退出。

use std::collections::HashMap;
use std::io::{Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use candle_core::quantized::gguf_file;
use candle_core::quantized::tokenizer::TokenizerFromGguf;
use candle_core::{Device, Tensor};
use candle_transformers::generation::LogitsProcessor;
use candle_transformers::models::{quantized_qwen2, quantized_qwen3};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::models;

/// 默认生成长度：讲评场景 150 字左右，256 token 足够且不至于让孩子等太久。
pub const DEFAULT_MAX_NEW_TOKENS: usize = 256;
pub const DEFAULT_TEMPERATURE: f64 = 0.7;
pub const DEFAULT_TOP_P: f64 = 0.9;

/// 固定种子：同样的输入给同样的输出，便于家长/开发复现"这次为什么这么说"。
const SAMPLING_SEED: u64 = 299_792_458;

// ===========================================================================
// 取消登记表（全局，按 id）
// ===========================================================================

#[derive(Default)]
pub struct StreamRegistry {
  inner: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl StreamRegistry {
  /// 锁中毒时取回内部数据而不是 panic：一次推理的锁中毒不该让整个 App 停摆。
  fn map(&self) -> MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
    self.inner.lock().unwrap_or_else(|e| e.into_inner())
  }
}

// ===========================================================================
// 事件载荷
// ===========================================================================

#[derive(Clone, Serialize)]
struct ChunkPayload {
  id: String,
  delta: String,
}

#[derive(Clone, Serialize)]
struct DonePayload {
  id: String,
}

#[derive(Clone, Serialize)]
struct ErrorPayload {
  id: String,
  code: String,
}

// ===========================================================================
// 错误
// ===========================================================================

#[derive(Debug)]
pub struct StreamError {
  code: &'static str,
  detail: String,
}

impl StreamError {
  fn new(code: &'static str, detail: impl std::fmt::Display) -> Self {
    Self {
      code,
      detail: detail.to_string(),
    }
  }

  /// candle 的错误先看是不是"内存不够"，再落到调用方给的默认码。
  ///
  /// OOM 在 candle 里没有专门变体，只会以字符串形式冒出来（`allocation of ... failed`
  /// 或 `out of memory`）。这里认字符串不是优雅，是唯一可行的判据 —— 而"内存不够"
  /// 与"文件坏了"对家长的意义完全不同（前者换小模型，后者重下）。
  fn from_candle(default_code: &'static str, err: candle_core::Error) -> Self {
    let text = err.to_string();
    let lower = text.to_ascii_lowercase();
    if lower.contains("allocation") || lower.contains("out of memory") || lower.contains("memory") {
      return Self::new("oom", text);
    }
    Self::new(default_code, text)
  }
}

// ===========================================================================
// 模型家族
// ===========================================================================

enum AnyModel {
  Qwen2(quantized_qwen2::ModelWeights),
  Qwen3(quantized_qwen3::ModelWeights),
}

impl AnyModel {
  fn forward(&mut self, x: &Tensor, index_pos: usize) -> candle_core::Result<Tensor> {
    match self {
      Self::Qwen2(m) => m.forward(x, index_pos),
      Self::Qwen3(m) => m.forward(x, index_pos),
    }
  }
}

/// 生成参数（命令参数可覆盖默认值）。
struct GenParams {
  max_new_tokens: usize,
  temperature: f64,
  top_p: f64,
}

impl Default for GenParams {
  fn default() -> Self {
    Self {
      max_new_tokens: DEFAULT_MAX_NEW_TOKENS,
      temperature: DEFAULT_TEMPERATURE,
      top_p: DEFAULT_TOP_P,
    }
  }
}

/// Qwen 系列的 ChatML 模板。
///
/// 不自己拼"系统提示\n\n用户问题"：Instruct 模型是在 ChatML 上微调的，
/// 少了 `<|im_start|>` 它会当成一篇待续写的文章，而不是一次对话。
fn chatml(system: Option<&str>, user: &str) -> String {
  let sys = system.map(|s| s.trim()).filter(|s| !s.is_empty());
  let mut s = String::new();
  s.push_str("<|im_start|>system\n");
  s.push_str(sys.unwrap_or("你是一位耐心的小学老师，一次只提示一步，绝不直接给出答案。"));
  s.push_str("<|im_end|>\n<|im_start|>user\n");
  s.push_str(user.trim());
  s.push_str("<|im_end|>\n<|im_start|>assistant\n");
  s
}

// ===========================================================================
// 推理主体
// ===========================================================================

fn load_model(
  path: &std::path::Path,
) -> Result<(AnyModel, tokenizers::Tokenizer, Vec<u32>), StreamError> {
  let mut file = std::fs::File::open(path).map_err(|e| StreamError::new("model-corrupt", e))?;
  let ct = gguf_file::Content::read(&mut file).map_err(|e| StreamError::from_candle("model-corrupt", e))?;

  let arch = ct
    .metadata
    .get("general.architecture")
    .and_then(|v| v.to_string().ok())
    .map(|s| s.to_ascii_lowercase())
    .unwrap_or_default();

  let tokenizer = tokenizers::Tokenizer::from_gguf(&ct)
    .map_err(|e| StreamError::from_candle("model-corrupt", e))?;

  // EOS：GGUF 头里的 id + 常见 Qwen 结束符，两个都收（不同转换脚本写法不一）
  let mut eos: Vec<u32> = Vec::new();
  if let Some(id) = ct
    .metadata
    .get("tokenizer.ggml.eos_token_id")
    .and_then(|v| v.to_u32().ok())
  {
    eos.push(id);
  }
  for tok in ["<|im_end|>", "<|endoftext|>", "<|end_of_text|>"] {
    if let Some(id) = tokenizer.token_to_id(tok) {
      if !eos.contains(&id) {
        eos.push(id);
      }
    }
  }

  file
    .seek(SeekFrom::Start(0))
    .map_err(|e| StreamError::new("model-corrupt", e))?;
  let device = Device::Cpu;

  let model = match arch.as_str() {
    "qwen2" => AnyModel::Qwen2(
      quantized_qwen2::ModelWeights::from_gguf(ct, &mut file, &device)
        .map_err(|e| StreamError::from_candle("model-corrupt", e))?,
    ),
    "qwen3" => AnyModel::Qwen3(
      quantized_qwen3::ModelWeights::from_gguf(ct, &mut file, &device)
        .map_err(|e| StreamError::from_candle("model-corrupt", e))?,
    ),
    other => {
      let shown = if other.is_empty() { "unknown" } else { other };
      return Err(StreamError::new(
        "model-corrupt",
        format!("不支持的模型架构 `{shown}`（当前支持 qwen2 / qwen3）"),
      ));
    }
  };

  Ok((model, tokenizer, eos))
}

fn generate(
  window: &tauri::Window,
  app: &AppHandle,
  id: &str,
  prompt: &str,
  system: Option<&str>,
  params: &GenParams,
  cancel: &AtomicBool,
) -> Result<(), StreamError> {
  let model_path = models::first_model(app)
    .ok_or_else(|| StreamError::new("no-model", "models 目录下没有可用的 .gguf"))?;

  let (mut model, tokenizer, eos) = load_model(&model_path)?;
  let device = Device::Cpu;

  let text = chatml(system, prompt);
  let tokens = tokenizer
    .encode(text.as_str(), false)
    .map_err(|e| StreamError::new("decode-failed", e))?
    .get_ids()
    .to_vec();
  if tokens.is_empty() {
    return Err(StreamError::new("decode-failed", "提示词编码后为空"));
  }

  // 预填充：整段提示词一次前向，拿到最后一格的 logits
  let input = Tensor::new(tokens.as_slice(), &device)
    .map_err(|e| StreamError::from_candle("decode-failed", e))?
    .unsqueeze(0)
    .map_err(|e| StreamError::from_candle("decode-failed", e))?;
  let logits = model
    .forward(&input, 0)
    .map_err(|e| StreamError::from_candle("decode-failed", e))?;
  let seq_len = tokens.len();
  let mut last = logits
    .squeeze(0)
    .and_then(|t| t.get(seq_len - 1))
    .map_err(|e| StreamError::from_candle("decode-failed", e))?;

  let mut sampler = LogitsProcessor::new(
    SAMPLING_SEED,
    Some(params.temperature),
    Some(params.top_p),
  );
  let mut pos = seq_len;
  // 流式解码器：单 token 解码会把一个汉字的多字节 UTF-8 切断（吐 `�`），
  // `decode_stream` 会把不完整的字节先攒着，等下一个 token 补齐再出字。
  let mut decoder = tokenizer.decode_stream(true);

  for _ in 0..params.max_new_tokens {
    if cancel.load(Ordering::SeqCst) {
      // 取消也走"正常结束"：前端收到 done 才会把打字机停下来
      return Ok(());
    }
    let next = sampler
      .sample(&last)
      .map_err(|e| StreamError::from_candle("decode-failed", e))?;
    if eos.contains(&next) {
      return Ok(());
    }

    match decoder.step(next) {
      Ok(Some(delta)) if !delta.is_empty() => {
        let _ = window.emit(
          "ai-stream-chunk",
          ChunkPayload {
            id: id.to_string(),
            delta,
          },
        );
      }
      // None = 字节还没凑齐（半个汉字），下一轮自然会出字
      Ok(_) => {}
      // 病态 token（词表里没有）：跳过而不是中断整次生成
      Err(_) => {}
    }

    let step = Tensor::new(&[next], &device)
      .map_err(|e| StreamError::from_candle("decode-failed", e))?
      .unsqueeze(0)
      .map_err(|e| StreamError::from_candle("decode-failed", e))?;
    let out = model
      .forward(&step, pos)
      .map_err(|e| StreamError::from_candle("decode-failed", e))?;
    pos += 1;
    last = out
      .squeeze(0)
      .and_then(|t| t.squeeze(0))
      .map_err(|e| StreamError::from_candle("decode-failed", e))?;
  }
  Ok(())
}

// ===========================================================================
// commands
// ===========================================================================

/// 起一次流式推理。
///
/// **立刻返回**：真正的生成在 `spawn_blocking` 里跑，全程用事件推给前端。
/// 这样同一个 id 可以被第二次 invoke 打断（命令不占着不返回），也不会因为
/// 一条命令跑 30 秒而让 Tauri 的命令通道看起来"卡死"。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn ai_chat_stream(
  window: tauri::Window,
  app: AppHandle,
  state: State<'_, StreamRegistry>,
  id: String,
  prompt: String,
  system: Option<String>,
  max_new_tokens: Option<usize>,
  temperature: Option<f64>,
  top_p: Option<f64>,
) -> Result<(), String> {
  if id.trim().is_empty() {
    return Err("bad-request: id 不能为空".to_string());
  }

  let cancel = Arc::new(AtomicBool::new(false));
  {
    let mut map = state.map();
    // 并发防串流：同 id 重入 = 用户重开了这次讲评，先掐掉旧的，事件才不会交错
    if let Some(old) = map.insert(id.clone(), cancel.clone()) {
      old.store(true, Ordering::SeqCst);
    }
  }

  let params = GenParams {
    max_new_tokens: max_new_tokens.filter(|n| *n > 0).unwrap_or(DEFAULT_MAX_NEW_TOKENS),
    temperature: temperature.filter(|t| *t >= 0.0).unwrap_or(DEFAULT_TEMPERATURE),
    top_p: top_p.filter(|p| *p > 0.0 && *p <= 1.0).unwrap_or(DEFAULT_TOP_P),
  };

  let window_bg = window.clone();
  let app_bg = app.clone();
  let id_bg = id.clone();
  let cancel_bg = cancel.clone();

  tauri::async_runtime::spawn_blocking(move || {
    let result = generate(
      &window_bg,
      &app_bg,
      &id_bg,
      &prompt,
      system.as_deref(),
      &params,
      &cancel_bg,
    );
    match result {
      Ok(()) => {
        let _ = window_bg.emit("ai-stream-done", DonePayload { id: id_bg.clone() });
      }
      Err(e) => {
        let _ = window_bg.emit(
          "ai-stream-error",
          ErrorPayload {
            id: id_bg.clone(),
            code: e.code.to_string(),
          },
        );
        // 详情只进日志：错误码已经是契约，长串内部信息不该出现在孩子的界面上
        eprintln!("[ai_chat_stream] {}: {}", e.code, e.detail);
      }
    }
    // 只清理"自己那一格"：否则会把后来者的取消标志删掉，导致新请求无法中止
    let registry = app_bg.state::<StreamRegistry>();
    let mut map = registry.map();
    let ours = map
      .get(&id_bg)
      .map(|f| Arc::ptr_eq(f, &cancel_bg))
      .unwrap_or(false);
    if ours {
      map.remove(&id_bg);
    }
  });

  Ok(())
}

/// 前端 AbortController → 这里置位 → 推理循环下一个 token 前退出并发 done。
#[tauri::command]
pub fn ai_chat_abort(state: State<'_, StreamRegistry>, id: String) {
  if let Some(flag) = state.map().get(&id) {
    flag.store(true, Ordering::SeqCst);
  }
}
