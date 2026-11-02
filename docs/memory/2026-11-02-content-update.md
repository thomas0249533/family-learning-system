# 2026-11-02 · 题库在线更新（检查 + 静默更新）与 u3-ex-007 修复

## 背景与结论

用户报了两张截图：①`积是五位数的是` 答案标 C 但解析只有 B 是五位数；②答对的判断题弹红色「容易踩坑」警示。
全量审计（`scripts/audit-content.mjs`，66 包 / 4958 题）结论：**真正的答案硬伤只有 u3-ex-007 一处**；截图②是 App 反馈渲染疑点（`QuizEngine.vue` 判卷/反馈链路），不是内容错，待另查。

审计误报教训（脚本已修正）：多选无逗号写法 `ABD`（App `split('')` 拆字，合法）、英语 judge 用 `T/F`、多子题 judge 数组、选项内嵌题干、全角 `A．` 分隔符、`A.选文`（字母后无空格）。

## u3-ex-007 修复

`content/math-4-up-rjb/unit-math-4-up-rjb-p3.json` answer `C`→`B`，**并把 manifest.version 升到 1.0.1**——不升版本家庭端永远收不到这次修复（目录比对只认 version）。

## 题库在线更新（V3.1）

用户拍板：手动按钮触发 + GitHub raw/ghproxy 托管 + 整套实现。

- **镜像链** `src/core/content/mirrors.ts`：raw.githubusercontent → ghproxy.net → ghproxy.com，与 App 自动更新同仓（复用 `UPDATE_REPO`）。jsDelivr 不用（V2.12.4 被墙教训）。
- **目录** `content-dist/content-catalog.json`：packageId + version + title + sha256。
- **生成** `scripts/gen-content-dist.ts`（vite-node）：扫描 content/<学科>/*.json（跳过 _set/manifest/all_exercises/子目录），先 `rewriteIdsInPackage` 收敛成限定 ID（与 zip 导入形态一致——进度接续的前提），再 normalizePackage 全量校验，产出 66 包 + 目录。
  - **护栏**：内容变了 version 没升 → 退出码 1（`--force` 可越）。护栏只对「已有旧 dist」生效，**首次生成后改内容必须手动升版本**。
- **更新器** `src/core/content/contentUpdater.ts`：`checkForUpdates`（只比对已安装的包，未装的不偷偷拉进来）+ `applyUpdate`（下载 → sha256 核对 → normalize 校验 → packageId 身份核对 → `db.packages.put` 覆盖）+ `applyAllUpdates`（串行）。
- **收尾唯一化**：`afterPackagesChanged` 从 importService 导出（归属索引失效 + E1 重归因 + 今日队列失效），手动导入与在线更新共用。
- **UI**：PackageList 工具栏「🔄 检查题库更新」按钮，有更新红点 + 文案变化，Toast 反馈，成功后 `packageStore.loadPackages()`。
- **类型**：`LearningPackageManifest` 加可选 `version?: string`（老包缺号按 0.0.0 比对）。
- **测试**：`tests/content-updater.test.ts` 15 项，钉死两条契约：①更新不洗 progress（回归锁死）；②脏数据拒收（sha 不符/校验不过/身份不符/下载失败）。

## 踩坑

- vitest 静态 import 被提升到 `fake` 初始化之前 → 与 backup 系测试一致用动态 `await import`。
- 联合类型收窄：`expect(res.ok).toBe(false)` 不参与 TS 收窄，写 `expectFail()` helper 显式 guard。
- gen 脚本第一版漏了 `rewriteIdsInPackage`：base-chinese-4-up-rjb 包内自引用是限定形式、kp id 是裸的，E013 满屏。与 build-lpkgset 对齐后通过。
- base 包不在任何 _set 集合里且源文件自不自洽（手动单包导入会被 E013 拒）→ 家庭端不可能装着裸 ID 形态的它，dist 全限定形态安全。

## 门禁

- `npm run verify` 全绿：123 文件 / 4099 项（新增 15 项）。
- typecheck / typecheck:test 通过。
