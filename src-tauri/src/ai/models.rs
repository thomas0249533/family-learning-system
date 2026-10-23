//! 模型管理（A2）：目录解析 / 状态 / 下载 / 选文件 / 删除。
//!
//! ## 为什么文件操作全在 Rust 侧
//! 前端**没有任何 fs 权限**（`capabilities/default.json` 只有 `core:default`）。
//! 模型落盘、路径解析、哈希校验、复制全部在这里完成，前端只拿"状态 + 进度 + 错误码"。
//! 这样即便 WebView 里跑进一段恶意脚本，它也读不到任意路径 —— 它连 `invoke` 的
//! 参数里都塞不进路径（`ai_model_pick` 的路径是 Rust 侧弹窗选的，不经过 JS）。
//!
//! ## 为什么选文件用 rfd 而不是 tauri-plugin-dialog
//! 后者要「Rust 插件 + npm 包 + capability」三处联动，而 rfd 只是一条纯 Rust 依赖，
//! 拿到路径后**读取与校验仍在 Rust**，capability 一个字节都不用加。
//!
//! ## 复制而不是引用原路径
//! 家长可能把 .gguf 放在下载目录然后清空下载目录。复制进 `models/` 后，删原文件
//! 不影响 App；代价是磁盘多一份（几百 MB，值得）。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

/// 小于这个字节数的 `.gguf` 一定不是模型（多数是下载中断留下的空壳 / 网页存错的 HTML）。
pub const MIN_VALID_BYTES: u64 = 1024;

/// 下载过程的临时后缀。扫描模型时**必须**排除它，否则半成品会被当成可用模型。
const PART_SUFFIX: &str = ".part";

/// `?download=1` 这类查询串不能进文件名
const URL_QUERY_SEPS: [char; 2] = ['?', '#'];

// ===========================================================================
// 目录与扫描
// ===========================================================================

/// `AppData/<identifier>/models/`，不存在则创建。
pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let base = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("app-data-dir: {e}"))?;
  let dir = base.join("models");
  std::fs::create_dir_all(&dir).map_err(|e| format!("models-dir: {e}"))?;
  Ok(dir)
}

/// 目录下所有 `.gguf`（排除 `.part` 半成品），按文件名排序保证"第一个"是确定的。
pub fn gguf_files(dir: &Path) -> Vec<PathBuf> {
  let mut out: Vec<PathBuf> = match std::fs::read_dir(dir) {
    Ok(entries) => entries
      .filter_map(|e| e.ok())
      .map(|e| e.path())
      .filter(|p| {
        p.is_file()
          && p
            .extension()
            .and_then(|x| x.to_str())
            .map(|x| x.eq_ignore_ascii_case("gguf"))
            .unwrap_or(false)
      })
      .collect(),
    Err(_) => Vec::new(),
  };
  out.sort();
  out
}

/// 第一个"看起来是模型"的 `.gguf`（A1b 推理与 `ai_backend_info` 共用同一口径）。
pub fn first_model(app: &AppHandle) -> Option<PathBuf> {
  let dir = models_dir(app).ok()?;
  gguf_files(&dir)
    .into_iter()
    .find(|p| size_of(p) > MIN_VALID_BYTES)
}

fn size_of(path: &Path) -> u64 {
  std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

// ===========================================================================
// SHA-256（带 mtime 缓存）
// ===========================================================================

/// 缓存键：路径。值：(mtime 秒, 字节数, 十六进制哈希)。
/// 同一个文件在设置页刷新十次不该读十遍 400MB —— 那是把"打开设置"变成一次磁盘风暴。
static SHA_CACHE: LazyLock<Mutex<HashMap<PathBuf, (u64, u64, String)>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));

fn mtime_secs(path: &Path) -> u64 {
  std::fs::metadata(path)
    .and_then(|m| m.modified())
    .ok()
    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
    .map(|d| d.as_secs())
    .unwrap_or(0)
}

/// 计算文件 SHA-256。返回 `(hex, 是否命中缓存)`。
pub fn sha256_file(path: &Path) -> Result<(String, bool), String> {
  let size = size_of(path);
  let mtime = mtime_secs(path);
  if let Ok(cache) = SHA_CACHE.lock() {
    if let Some((m, s, h)) = cache.get(path) {
      if *m == mtime && *s == size {
        return Ok((h.clone(), true));
      }
    }
  }
  let hash = compute_sha256(path)?;
  if let Ok(mut cache) = SHA_CACHE.lock() {
    cache.insert(path.to_path_buf(), (mtime, size, hash.clone()));
  }
  Ok((hash, false))
}

fn compute_sha256(path: &Path) -> Result<String, String> {
  let mut file = std::fs::File::open(path).map_err(|e| format!("read-failed: {e}"))?;
  let mut hasher = Sha256::new();
  let mut buf = vec![0u8; 64 * 1024];
  loop {
    let n = file.read(&mut buf).map_err(|e| format!("read-failed: {e}"))?;
    if n == 0 {
      break;
    }
    hasher.update(&buf[..n]);
  }
  Ok(hex_of(&hasher.finalize()))
}

fn hex_of(bytes: &[u8]) -> String {
  let mut s = String::with_capacity(bytes.len() * 2);
  for b in bytes {
    s.push_str(&format!("{b:02x}"));
  }
  s
}

/// 外部传入的校验值：大小写不敏感、允许 `sha256:` 前缀、允许夹空格。
fn normalize_sha(raw: &str) -> String {
  let t = raw.trim().to_ascii_lowercase();
  let t = t.strip_prefix("sha256:").unwrap_or(&t).trim().to_string();
  t
}

// ===========================================================================
// 状态
// ===========================================================================

#[derive(Clone, Serialize)]
pub struct ModelStatus {
  /// 目录里有体积合法的 `.gguf`
  pub installed: bool,
  /// 可以用于推理（= installed 且哈希算得出来）
  pub available: bool,
  /// `no-model` / `ready` / `model-corrupt`
  pub reason: String,
  pub path: Option<String>,
  pub file_name: Option<String>,
  pub size_bytes: u64,
  pub sha256: Option<String>,
  /// 哈希是否来自缓存（仅用于诊断展示，不影响判定）
  pub sha256_from_cache: bool,
}

fn empty_status(reason: &str) -> ModelStatus {
  ModelStatus {
    installed: false,
    available: false,
    reason: reason.to_string(),
    path: None,
    file_name: None,
    size_bytes: 0,
    sha256: None,
    sha256_from_cache: false,
  }
}

/// 扫描目录给出状态。**不抛**：拿不到目录就报 `no-model`（设置页要能渲染，不能白屏）。
pub fn status_of(app: &AppHandle) -> ModelStatus {
  let dir = match models_dir(app) {
    Ok(d) => d,
    Err(_) => return empty_status("no-model"),
  };
  let files = gguf_files(&dir);
  if files.is_empty() {
    return empty_status("no-model");
  }
  // 优先挑体积合法的；一个都没有则报"文件坏了"（比谎报未安装有用）
  let candidate = files
    .iter()
    .find(|p| size_of(p) > MIN_VALID_BYTES)
    .cloned();
  let Some(path) = candidate else {
    let first = &files[0];
    let mut st = empty_status("model-corrupt");
    st.path = Some(first.to_string_lossy().to_string());
    st.file_name = first.file_name().map(|n| n.to_string_lossy().to_string());
    st.size_bytes = size_of(first);
    return st;
  };
  let size = size_of(&path);
  let (sha, cached) = match sha256_file(&path) {
    Ok((h, c)) => (Some(h), c),
    Err(_) => (None, false),
  };
  ModelStatus {
    installed: true,
    available: sha.is_some(),
    reason: if sha.is_some() { "ready" } else { "model-corrupt" }.to_string(),
    path: Some(path.to_string_lossy().to_string()),
    file_name: path.file_name().map(|n| n.to_string_lossy().to_string()),
    size_bytes: size,
    sha256: sha,
    sha256_from_cache: cached,
  }
}

// ===========================================================================
// commands
// ===========================================================================

#[tauri::command]
pub fn ai_model_status(app: AppHandle) -> ModelStatus {
  status_of(&app)
}

/// URL 末段 → 安全的文件名（只留 `[A-Za-z0-9._-]`），保证以 `.gguf` 结尾。
pub fn file_name_from_url(url: &str) -> String {
  let no_query = url.split(URL_QUERY_SEPS).next().unwrap_or("").trim();
  let last = no_query
    .rsplit('/')
    .find(|s| !s.trim().is_empty())
    .unwrap_or("model.gguf");
  let cleaned: String = last
    .chars()
    .map(|c| {
      if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
        c
      } else {
        '_'
      }
    })
    .collect();
  let cleaned = cleaned.trim_matches('.').to_string();
  let cleaned = if cleaned.is_empty() {
    "model.gguf".to_string()
  } else {
    cleaned
  };
  if cleaned.to_ascii_lowercase().ends_with(".gguf") {
    cleaned
  } else {
    format!("{cleaned}.gguf")
  }
}

/// 不覆盖已有文件：`a.gguf` → `a-1.gguf`
fn unique_path(dir: &Path, name: &str) -> PathBuf {
  let candidate = dir.join(name);
  if !candidate.exists() {
    return candidate;
  }
  let stem = Path::new(name)
    .file_stem()
    .map(|s| s.to_string_lossy().to_string())
    .unwrap_or_else(|| "model".to_string());
  for i in 1..1000 {
    let p = dir.join(format!("{stem}-{i}.gguf"));
    if !p.exists() {
      return p;
    }
  }
  dir.join(format!("{stem}-{}.gguf", std::process::id()))
}

#[derive(Clone, Serialize)]
struct Progress {
  received: u64,
  total: u64,
}

/// 错误串统一带前缀码：`<code>: <detail>`，前端只认冒号前那一段。
fn coded(code: &str, detail: impl std::fmt::Display) -> String {
  format!("{code}: {detail}")
}

/// 流式下载 + 边下边算哈希 + 校验后改名。
///
/// `expected_sha256` 允许为空（很多直链页面不提供哈希）：此时跳过比对，但仍然
/// 算出哈希回填状态 —— 家长可以事后对照，不必重下一次。
#[tauri::command]
pub async fn ai_model_download(
  app: AppHandle,
  url: String,
  expected_sha256: String,
) -> Result<ModelStatus, String> {
  let url = url.trim().to_string();
  if url.is_empty() {
    return Err(coded("bad-request", "缺少下载地址"));
  }
  let dir = models_dir(&app).map_err(|e| coded("io", e))?;
  let final_name = file_name_from_url(&url);
  let part_path = dir.join(format!("{final_name}{PART_SUFFIX}"));

  let client = reqwest::Client::builder()
    .user_agent("family-learning-system/2.0")
    .build()
    .map_err(|e| coded("network", e))?;
  let mut res = client
    .get(&url)
    .send()
    .await
    .map_err(|e| coded("network", e))?;
  if !res.status().is_success() {
    return Err(coded("http", format!("HTTP {}", res.status())));
  }
  let total = res.content_length().unwrap_or(0);

  let mut file = std::fs::File::create(&part_path).map_err(|e| coded("io", e))?;
  let mut hasher = Sha256::new();
  let mut received: u64 = 0;
  let mut last_emit = Instant::now();
  let mut last_bytes: u64 = 0;

  // 磁盘写失败 / 网络中断都要把半成品删掉，否则下次会有一个假的 .part 占着名字
  let stream_result: Result<(), String> = async {
    loop {
      let chunk = res.chunk().await.map_err(|e| coded("network", e))?;
      let Some(bytes) = chunk else { break };
      if bytes.is_empty() {
        continue;
      }
      file.write_all(&bytes).map_err(|e| coded("io", e))?;
      hasher.update(&bytes);
      received += bytes.len() as u64;
      // 节流：每 256KB 或每 120ms 发一次，避免千万级事件把 WebView 打满
      if received - last_bytes >= 256 * 1024 || last_emit.elapsed().as_millis() >= 120 {
        let _ = app.emit("ai-model-progress", Progress { received, total });
        last_emit = Instant::now();
        last_bytes = received;
      }
    }
    Ok(())
  }
  .await;

  if let Err(e) = stream_result {
    drop(file);
    let _ = std::fs::remove_file(&part_path);
    return Err(e);
  }
  file.flush().map_err(|e| coded("io", e))?;
  drop(file);
  let _ = app.emit("ai-model-progress", Progress { received, total });

  if received <= MIN_VALID_BYTES {
    let _ = std::fs::remove_file(&part_path);
    return Err(coded("model-corrupt", "下载内容不是模型文件"));
  }

  let expected = normalize_sha(&expected_sha256);
  if !expected.is_empty() {
    let actual = hex_of(&hasher.finalize());
    if actual != expected {
      let _ = std::fs::remove_file(&part_path);
      return Err(coded(
        "model-corrupt",
        format!("SHA-256 不匹配（期望 {expected}，实际 {actual}）"),
      ));
    }
  }

  let final_path = unique_path(&dir, &final_name);
  std::fs::rename(&part_path, &final_path).map_err(|e| coded("io", e))?;
  Ok(status_of(&app))
}

/// 选本地 `.gguf`：弹窗在 Rust 侧（rfd），拿到路径后**复制**进 models 目录。
///
/// 阻塞式弹窗放在 `spawn_blocking` 里：命令本身是 async 的，直接调会占住
/// tokio worker；退出时窗口不会因为"还有一个对话框在等"而卡死。
#[tauri::command]
pub async fn ai_model_pick(app: AppHandle) -> Result<ModelStatus, String> {
  let picked = tauri::async_runtime::spawn_blocking(|| {
    rfd::FileDialog::new()
      .add_filter("GGUF 模型", &["gguf", "GGUF"])
      .set_title("选择本地 .gguf 模型")
      .pick_file()
  })
  .await
  .map_err(|e| coded("internal", e))?;

  let Some(src) = picked else {
    // 取消不是错误：返回当前状态即可，前端据此决定提示语
    return Ok(status_of(&app));
  };
  let name = src
    .file_name()
    .map(|n| n.to_string_lossy().to_string())
    .unwrap_or_else(|| "model.gguf".to_string());
  if !name.to_ascii_lowercase().ends_with(".gguf") {
    return Err(coded("bad-request", "请选择 .gguf 结尾的模型文件"));
  }
  if size_of(&src) <= MIN_VALID_BYTES {
    return Err(coded("model-corrupt", "这个文件太小，不像是模型"));
  }

  let dir = models_dir(&app).map_err(|e| coded("io", e))?;
  let dst = unique_path(&dir, &name);
  std::fs::copy(&src, &dst).map_err(|e| coded("io", e))?;
  Ok(status_of(&app))
}

#[tauri::command]
pub fn ai_model_remove(app: AppHandle) -> ModelStatus {  if let Ok(dir) = models_dir(&app) {
    for p in gguf_files(&dir) {
      let _ = std::fs::remove_file(&p);
    }
    // 半成品也一起清掉
    if let Ok(entries) = std::fs::read_dir(&dir) {
      for e in entries.filter_map(|e| e.ok()) {
        let p = e.path();
        if p.to_string_lossy().ends_with(PART_SUFFIX) {
          let _ = std::fs::remove_file(&p);
        }
      }
    }
    if let Ok(mut cache) = SHA_CACHE.lock() {
      cache.retain(|k, _| k.exists());
    }
  }
  status_of(&app)
}
