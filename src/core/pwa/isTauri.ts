// =====================================================================
// PWA / Tauri 分端判定（B4 · 零依赖）
// ---------------------------------------------------------------------
// 依据：package.json 无 @tauri-apps/api（仅 @tauri-apps/cli devDep），
//   故不引入依赖，改用 Tauri 注入的全局变量探测：
//     · Tauri v2 注入 __TAURI_INTERNALS__
//     · Tauri v1 注入 __TAURI__
// Web 端两者皆无 → 返回 false（行为不变）。
// =====================================================================

/** 是否运行在 Tauri 桌面容器内。 */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' &&
  (('__TAURI_INTERNALS__' in window) || ('__TAURI__' in window))
