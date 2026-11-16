# 2026-11-16 · 新版词语包 + 手写作答 + 隐藏包

## 需求（用户）
1. 新教材四上词语表照片（17 课 + 4 园地 = 21 组 / 220 词）更新进学习包，按课次选择。
2. 采购手写板，系统支持手写作答 + 笔顺描红。
3. 采纳隐藏旧包，新旧包不同时出现。

## 用户裁决
- 新版 220 词**新建独立包**，旧包隐藏（不覆盖、不混入）。
- 手写出题级随手练（不是整批听写），**笔迹作答 + 家长肉眼批改**，不引入 OCR/识别。
- 硬件：无屏手写板 ¥300–600（绘王 H640P ¥330 主推 / Wacom CTL-472 ¥349–399）。
- 课次做 **unit** 不做 topic（硬约束：`ChineseWords.vue:91-96` 优先取 `deriveUnitKnowledgePointIds`）。

## 关键设计（踩过的坑，别重犯）
- **笔迹单一序列化真相**：只用 `src/core/reading/ink.ts` 的 `serializeStrokes`/`deserializeStrokes`（45 单测、零抛、InkPoint={x,y}）。前端曾提过第二套 `{v:1,cells:[...]}` codec，已否决删除。
- **`pending` 待批改通道**：手写题不即时判分（`gradeBlank('')` 必 false，会全进错题本 + FSRS 全排明天）。`AnswerPayload` 加 `pending?` + `cells?`，三处消费方早退。
- **判分对称性**：`wrong`/`partial` 也必须 `recordProgress(..., false)`（`addMistake` 只写 mistakes 不写 progress），否则手写 BKT 只涨不跌。`f8f8df1` 修复。
- **Dexie v9** 加 `handwritings` 表，`status` 必填（不索引 undefined）。索引 `'++id, [profileId+exerciseId], [profileId+packageId], [profileId+status], profileId'`，刻意不建 `[profileId+createdAt]`（死索引）。
- **回滚用 `put` 整行**不用 `update({reviewedAt: undefined})`（本仓 update 载荷过 JSON 往返丢 undefined 键，patch 变空对象）。
- **`GradeOutcome` 四值**：`'graded'|'replaced'|'already'|'ignored'`。回流抛错仍 throw（行已回 pending 可重试；返回 ignored 会让家长以为没救了）。`'ignored'` 只在入参非法/行不存在/跨档案/update 打空且无同题行时用。
- **正确率分母**减掉会话内 pending（`gradedScoreOf`）。
- **隐藏包 = `packages:hidden` global 键**，值 `{v:1, items:{[pkgId]:{hidden,at}}}`。取消隐藏写 `{hidden:false,at}` **墓碑不删 key**（否则另一台设备的旧 hidden:true 会在合并时复活）。逐项 LWW 按 `at` 字典序，at 相同取 `hidden:false`（出错方向选"看得见"）。必须登记进 `GLOBAL_KEYS`（漏登记 → classifyKey 判 unknown → mergeBundle 静默跳过，不报错）；`mergeBundle.ts` 全局键段插专用分支（本机优先对这个是错的）。归一化时 items 按 packageId 排序，保证 JSON 逐字节比较稳定、导入幂等。
- **隐藏的功能边界**：退出书架主列表 + 退出今日计划；进度/错题/统计保留，错题本可继续作答；搜索/知识图谱不过滤；开关用组件内 ref 不持久化。
- **三条禁区（写错不报错）**：`buildOwnerIndex(packageStore.packages)` 传全量（少一个包 = 进度导入时判孤儿）；检查题库更新（repairCandidates/installable）不受隐藏影响；`buildIndex(packages)` 仍吃全量（否则隐藏包错题只显 id）。

## 并发提交坑
- 两个 worker 曾撞共享 `git index.lock`，把对方暂存卷进自己的 commit（两次）。规矩：路径限定 `git commit -F - -- <显式路径>`。
- 陈旧 `index.lock` 会留盘导致后续所有提交失败。撞锁先 `tasklist` 确认无 git 进程再删锁。
- 顺序 artifact：`ef7f549`（书架 UI）单独 checkout 会 import 尚未入库的 hiddenPackages，那一笔自身过不了 typecheck；`c3e3154` 补齐后 HEAD 全绿。bisect 到 ef7f549 时会踩到，不是代码缺陷。

## 429 教训
- 两个 worker 同刻撞账户级 429（各跑 6m47s），重置 2026-11-17 09:19。**429 只影响 worker 模型调用，不影响本地跑 verify/e2e**（Node 进程不消耗模型额度）。验证一直由主理人本地跑，不必等额度。

## 最终提交序列
- `cbdd300` 新词汇包（21 unit / 220 kp / 220 题 + 220 mp3 assets.zip 1.19MB；源 assets 目录不入库，只入库 assets.zip —— 与其他包一致）
- `f0edc29` P1 手写前端 → `b2846d2` 数据层 → `7c95336` partial+删死代码 → `8fdc8bf` P2 待批改断点 → `21fbf4d` v9 守卫 → `fa8e96f` P3 描红 → `0003947` 清空数据补 handwritings → `65c7360` 分母 → `f8f8df1` 判分对称性 → `0d5f0b1` 空笔迹提示
- `d527959` GradeOutcome 四值 → `9aba154` 批改页四分支 → `ef7f549` 书架隐藏 + 今日计划 → `c3e3154` 隐藏包数据层 → `8131784` 补 pending-note 图标登记 → `c50a933` 对比度文档随动

## 验收（全绿）
- `npm run verify`：exit 0，**136 文件 / 4347 单测全过**（15 步门禁）。中途两处红灯已修：`icon-contrast` 发现门禁要求新图标登记（8131784），`a11y:contrast:check` 要求文档同步重生成（c50a933）。
- `PW_TRACE=off npx playwright test --output=/c/tmp/pw-out-final`：**192 passed (9.6m)**，exit 0。
  - 坑：`PW_TRACE=off` 规避本机安全软件拦 `test-results/**` 写入导致 browserContext.close EPERM 误报。
  - 坑：`--output` 必须指全新目录，否则 safe-delete shim 拦清理。

## 新包使用
- packageId `special-chinese-4-up-vocab-2026`，标题「四上语文 · 词语表默写（新版 · 按课次）」。
- 书架出现该包 → 单元列表按课次（第1/2/4/5…25课 + 语文园地），每课可单独进入练习。
- 词语表下拉按课切换（`units.length > 1` 才显示）。
- 旧包 `special-chinese-4-up-vocab` 在书架卡片「⋯」→「隐藏」，顶部「显示已隐藏(N)」可找回。
