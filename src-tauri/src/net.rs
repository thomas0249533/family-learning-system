//! WebDAV 同步的 HTTP 传输层（P3 · 打通云端同步）。
//!
//! ## 为什么需要它
//!
//! 桌面端跑在 WebView2 里，`fetch` 同样受同源策略约束 —— 跨域的网盘
//! （坚果云 `dav.jianguoyun.com`、Nextcloud、自建 NAS）一律被 CORS 拦掉，
//! 前端只能拿到一个 opaque 响应。把请求搬到 Rust 侧发出，才真正可用。
//!
//! ## 为什么不用 `tauri-plugin-http`
//!
//! 它依赖 reqwest **0.12**，而本仓已因本地 AI 推理依赖 reqwest **0.13**
//! （见 `Cargo.toml` 里那条实测注释）。两个大版本会各编一份 hyper/rustls，
//! 让 release build 多花十几分钟，纯粹为了一层转发不值当。
//! 这里复用现成的 reqwest，只加一个薄 command，编译增量基本为零。
//!
//! ## 安全边界
//!
//! 只接受 `http://` / `https://`，且只允许前端传入的方法和头。
//! 这是本地家庭应用：目标是"用户自己填的网盘地址能用"，不做通用代理。

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponsePayload {
    pub status: u16,
    pub status_text: String,
    pub body: String,
    /// 重定向后的最终 URL（部分网盘的容器地址会 301，前端按需读）
    pub url: String,
}

/// 全局复用一个 Client：一次同步要打好几个报文（PROPFIND → GET → PUT），
/// 每次新建客户端等于每次重做一次 TLS 握手，还会丢掉连接池。
/// 超时因此改在**单次请求**上设（`RequestBuilder::timeout`），不再绑死在 Client 上。
fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            // WebDAV 正常不重定向；限 5 次是给"容器目录少了尾斜杠"这类小意外留余地，
            // 同时避免被一个坏地址拖进无限跳转。
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// 发一次 HTTP 请求并原样返回状态码与正文。
///
/// 非 2xx **不作为错误**：WebDAV 要靠 404 / 401 做业务判断（探存在、判鉴权），
/// 把状态码交给前端翻译，比在 Rust 里猜语义更准确。
#[tauri::command]
pub async fn webdav_fetch(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<HttpResponsePayload, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("只允许 http/https 地址，拒绝：{url}"));
    }

    let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())
        .map_err(|_| format!("非法 HTTP 方法：{method}"))?;

    let mut req = client().request(method, &url);
    if let Some(ms) = timeout_ms {
        if ms > 0 {
            req = req.timeout(Duration::from_millis(ms));
        }
    }
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("请求超时：{url}")
        } else if e.is_connect() {
            format!("连不上服务器（域名解析/网络/证书问题）：{url}")
        } else {
            format!("请求失败：{e}")
        }
    })?;

    let status = resp.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let final_url = resp.url().to_string();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取响应正文失败：{e}"))?;

    Ok(HttpResponsePayload {
        status: status.as_u16(),
        status_text,
        // WebDAV 的 XML 与备份 JSON 都是 UTF-8；非法字节按替换字符走，
        // 不要因为一个坏字节让整次同步失败。
        body: String::from_utf8_lossy(&bytes).into_owned(),
        url: final_url,
    })
}
