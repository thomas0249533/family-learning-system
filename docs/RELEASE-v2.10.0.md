# 家庭学习系统 V2.10.0 发版说明（D-2 自动更新）

> 发布日期：2026-10-27
> 版本号：2.10.0（package.json / tauri.conf.json / Cargo.toml / version.json 四处同步）
> 构建产物：NSIS 安装包（`target/release/bundle/nsis/...setup.exe`）+ `.sig`；便携版 `app2026-10-27b.exe`

---

## 一、本次核心：D-2 应用内自动更新

把「检查更新」从 D-1 通知式升级为**真正的自动更新**：

- Rust 侧接入 `tauri-plugin-updater`，`tauri.conf.json` 开 `createUpdaterArtifacts`，配置 `pubkey` + 三镜像 `endpoints`（raw / jsdelivr / gitmirror）。
- 前端 `AppShell.vue` 改用 `@tauri-apps/plugin-updater`：`check()` → `downloadAndInstall(进度回调)` → `relaunch()`，更新横幅实时显示下载百分比与安装态。
- **优雅降级**：若不在 Tauri 运行时（纯网页 / dev / 插件未注册），`check()` 抛错后自动回退到 D-1（fetch `version.json`，渲染「前往官网下载 →」链接），绝不白屏。

## 二、分发格式变更（重要）

Tauri v2 Windows 更新器靠**安装器就地替换**，因此：

- 主分发改为 **NSIS 安装包**（被动更新 `installMode: "passive"`，后台进度条、无需交互）。
- 仍额外保留**单文件 exe 便携版** `app2026-10-27b.exe`（`--no-bundle` 产出），供手动/便携使用。
- ⚠️ 你当前的 **2.9.0 是裸 exe、没有更新器**，所以 **2.10.0 需要你手动安装一次**（双击 NSIS 安装包）。装好之后，后续版本点「检查更新」即可一键自动更新。

## 三、国内可用性

- 更新元数据 `latest.json` 提交进仓库，经 raw / jsdelivr / gitmirror 三镜像可达。
- **更新包本体**提交进仓库 `updates/2.10.0/`，经 **gitmirror** 分发（处理大文件、国内最稳；绕开 jsdelivr 对大文件的可能限制）。
- 首次装好 2.10.0 后，点「检查更新」会在国内网络下稳定拉取并安装。

## 四、签名密钥

- 已用 `tauri signer generate` 生成密钥对：
  - 私钥：`C:\Users\Administrator\.tauri\family-learning.key`（本机、不进 git）。
  - 公钥：已写入 `tauri.conf.json` 的 `plugins.updater.pubkey`。
- ⚠️ **丢私钥 = 已装用户无法再收到更新**。后续构建需设置环境变量 `TAURI_SIGNING_PRIVATE_KEY_PATH` 指向该文件，否则不会生成 `.sig`、更新器校验失败。

## 五、验证

- 前端 `vue-tsc` + `vite build` 通过（已修 `contentLength` 类型归一）。
- Rust 侧：`tauri build` 成功产出 NSIS 安装包 + `.sig`（约 52 分钟重编译，因新增 updater 插件）。
- 发布：GitHub `tag v2.10.0` + Release，资产含 NSIS 安装包 / `latest.json` / 便携 exe。
