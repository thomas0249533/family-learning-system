# 家庭学习系统 V2.9.0 发版说明

> 发布日期：2026-10-27
> 版本号：2.9.0（package.json / tauri.conf.json / Cargo.toml / version.json 四处同步）
> 构建产物：`app2026-10-27a.exe`

---

## 一、更新亮点（UI 审美七轮迭代）

本次发版集中打磨界面审美与可读性的「质感」，全部灵感来自公众号 AI 出题系统文章、豆包高级文字效果方案，以及多轮候选建议投票（4 项全选）。

| # | 模块 | 改动 |
|---|---|---|
| ① | 报告页 | 渐变英雄横幅 + 大字号掌握率 + 等级胶囊 + 2×2 信息胶囊；掌握率改为 148px SVG 渐变圆环（环心 48px 数字）；周柱状图渐变圆角顶 |
| ② | 首页 | 欢迎横幅改为毛玻璃圆角徽章 + 0.9s 一次性低速入场；「今日计划 / 学习进度」启用渐变标题 |
| ③ | 答题卡（QuizEngine） | 题号条三层结构：图例行「■已答 N·□未答 N」/ 34px 数字格 / 渐变进度微条；图例与已答格统一口径（修了考试模式下一处真 bug） |
| ④ | 学科 / 来源包 | PackageList / UnitList / TopicList 学科彩色软底胶囊（math / chinese / english 三色），来源包绿色软底，难度 primary 强调 |
| ⑤ | 考试结果页 | 交卷后「📇 本卷答题卡」回放卡：对错双色数字格总览 + 点击平滑滚动到对应解析；限时剩余比例色阶（≤20% 橙 / ≤10% 红脉冲） |
| ⑥ | 技能树 | 虚拟根合并多学科树，支持学科切换 chips（全部 / 各学科）+ 高度自适应（420–1600px），修复「导入多学科后只显示其一、无法切换、内容多看不清」 |
| ⑦ | 高级文字效果 | 渐变标题（`-webkit-text-fill-color` 裁切）、深色柔浮雕（多层浅影）、按钮 hover 流光（非循环）、低速一次性入场；全程遵守 `reduced-motion` 与「正文零动画 / 禁频闪」禁区 |

**学习小贴士**：报告页新增「💡 学习小贴士」卡，由纯函数 `buildStudyTip` 按优先级生成（无记录 → 到期复习 → 清错题 → 保持 → 主攻 → 连学 3 天 → 兜底）。

---

## 二、修复内容

- **技能树多学科 bug**（用户反馈）：echarts tree 多根 data 只画第一棵；切换时 `setOption` 抛 `__edge null` 崩溃。根因修复 + 高度自适应。
- **答题卡图例口径 bug**（自查）：考试模式「下一题」不判分导致已答题数为 0，图例与数字格不一致。统一 `isAnswered` 口径。
- **5 个历史坏 e2e 探针**：首页 AchievementSection 类名已换 AchievementHall，兼容双类名等待探针。
- 顺带修复 2.8.2 遗留的两处：`checkUpdate` 多镜像容错（不再 `Failed to fetch`）、每日一练已做单元列表颜色标记。

---

## 三、回归与验证（发版前实测）

- 单元测试：**3702 passed**（102 文件），含新增 `study-tip.test.ts`（+8）。
- 静态门禁：`typecheck:test` ✅ / `check:hex` ✅（61 文件无硬编码色）/ `check:text-color` ✅ / `lint:styles` ✅。
- 构建：`tauri build --no-bundle` 成功（exit 0）。
- 远端核验：main / tag `v2.9.0` / Release / exe 资产四项一致。

新增 / 转正回归用例：`exam-nav.spec.ts`、`exam-replay.spec.ts`、`graph-subjects.spec.ts`、`study-tip.test.ts`。

---

## 四、如何更新（重要）

当前「检查更新」为 **D-1 通知式**设计，**不会自动下载并替换 exe**：

1. 应用内点击「检查更新」→ 读取 `version.json`（raw / jsdelivr / gitmirror 三镜像容错），发现 2.9.0 后提示「🎉 有新版本」并给出「前往官网下载 →」链接；
2. 点击链接跳转 <https://github.com/thomas0249533/family-learning-system/releases/latest>；
3. 下载 `app2026-10-27a.exe`，**手动覆盖**旧的 `app.exe` 即可。

> 若希望「点一下就自动更新换上新版」，需接入 `tauri-plugin-updater`（Rust 改动 + 签名密钥 + CI，约 52 分钟重编译），属 D-2 方案，本次未做。

---

## 五、下载地址

- Release 页：<https://github.com/thomas0249533/family-learning-system/releases/tag/v2.9.0>
- 资产：`app2026-10-27a.exe`（约 17.6 MB，单文件绿色版，免安装）
