# 家庭学习系统 · 项目开发总览

> 本文档是项目的"单一事实来源"。新接手的 AI 对话必须先通读本文档，再动手。

---

## 一、项目定位与目标

### 1.1 是什么
一个 **JSON 驱动的家庭学习系统框架**。
- **数据层**：学习包 JSON（学科 + 年级 + 学期 + 教材版本）
- **引擎层**：Vue 3 SPA 负责渲染、练习、错题、复习、推荐
- **分发层**：PWA + Tauri（Windows 桌面 exe）
- **内容层**：由 AI 提示词生成 + 人工校对 + 打包脚本编译

### 1.2 目标优先级
1. **A**：快速给自己孩子用起来
2. **B**：长期可扩展的家庭学习系统
3. **C**：未来可能分享给其他家庭
4. **D**：未来可能产品化/商业化

### 1.3 关键设计决策
| 决策 | 选择 | 理由 |
|---|---|---|
| 数据与渲染 | 分离 | 学习包可独立生产、分发、复用 |
| 学科差异 | 顶层统一 + 内容异构 | manifest 统一，units/topics/modules 各异 |
| 知识点模型 | A+B 混合 | 底层知识点为中心，展示层模块化 |
| 知识点 ID | UUID（无前缀）| 打包时脚本自动加 `{packageId}::` 前缀 |
| 跨版本映射 | 不做 | 不同版本各自独立包 |
| 用户数据 | 与包分离 | 可独立导出/迁移 |
| 存储 | IndexedDB (Dexie) | 容量大、结构化查询 |
| 跨设备同步 | JSON 导出/导入 | 不做账号系统 |

---

## 二、技术栈

### 2.1 前端
| 层 | 选型 | 版本 |
|---|---|---|
| 框架 | Vue 3 + TypeScript | 3.5+ |
| 构建 | Vite | 6.x |
| 路由 | Vue Router | 4.x |
| 状态 | Pinia | 2.x |
| UI | Naive UI | 2.40+ |
| 存储 | Dexie.js (IndexedDB) | 4.x |
| 图表 | ECharts | 5.x |
| Markdown | markdown-it | 14.x |
| 公式 | KaTeX | 0.16+ |
| 校验 | Ajv + JSON Schema | — |
| 压缩 | fflate | — |
| PDF | html2canvas + jspdf | — |

### 2.2 打包/部署
| 层 | 选型 |
|---|---|
| PWA | vite-plugin-pwa (Workbox) |
| Windows | Tauri 2.x + Rust |
| 便携版 | `src-tauri/target/release/app.exe` |

### 2.3 开发环境
- **OS**：Windows 10/11
- **Shell**：PowerShell
- **Node**：v24.x
- **Rust**：latest stable + MSVC 工具链

---

## 三、目录结构

```
D:\study\
├── src/
│   ├── core/                          # 核心能力
│   │   ├── app-shell/                 # 应用外壳
│   │   ├── importer/                  # 导入器
│   │   │   ├── importService.ts       # 单包 + ZIP 导入
│   │   │   ├── normalizePackage.ts    # 规范化 + 校验
│   │   │   ├── dependencyResolver.ts  # 依赖检查
│   │   │   └── resolvePackageUnits.ts # 聚合包解析
│   │   ├── registry/                  # 注册表
│   │   │   ├── moduleRegistry.ts      # 模块渲染器
│   │   │   ├── templateRegistry.ts    # 学科模板
│   │   │   └── registerAll.ts         # 统一注册入口
│   │   ├── stores/                    # Pinia
│   │   │   ├── package.ts             # 学习包
│   │   │   ├── userData.ts            # 用户数据
│   │   │   └── theme.ts               # 主题
│   │   ├── review/                    # 复习引擎
│   │   │   ├── fsrs.ts                # FSRS 内核（包 ts-fsrs）
│   │   │   └── reviewScheduler.ts     # 调度门面（旧签名兼容）
│   │   ├── mastery/                   # 掌握度
│   │   │   ├── bkt.ts                 # 贝叶斯知识追踪
│   │   │   └── masteryRules.ts        # 掌握状态机（纯函数）
│   │   ├── mistake/                   # 错题
│   │   │   └── mistakeRules.ts        # 三级状态规则（纯函数）
│   │   ├── motivation/                # 体验激励
│   │   │   ├── streak.ts              # 连续打卡
│   │   │   ├── achievements.ts        # 成就徽章
│   │   │   └── encouragement.ts       # 鼓励反馈文案
│   │   ├── prerequisites/             # 前置知识
│   │   │   └── prerequisiteEngine.ts
│   │   ├── recommendation/            # 推荐引擎
│   │   │   └── rulesEngine.ts
│   │   ├── search/                    # 搜索
│   │   │   └── searchService.ts
│   │   ├── report/                    # 报告
│   │   │   ├── reportGenerator.ts
│   │   │   └── pdfExporter.ts
│   │   ├── export/                    # 导入导出
│   │   │   └── exportService.ts
│   │   ├── pwa/                       # PWA
│   │   │   ├── usePWAUpdate.ts
│   │   │   └── PWAUpdateBar.vue
│   │   ├── composables/               # 组合式函数
│   │   │   └── useKnowledgePoints.ts
│   │   └── styles/                    # 样式
│   │       ├── variables.scss         # SCSS 变量
│   │       └── index.scss
│   ├── modules/                       # 模块渲染器
│   │   ├── core/
│   │   │   ├── QuizEngine.vue         # 练习引擎（8 种题型）
│   │   │   └── UnknownModule.vue      # 降级组件
│   │   ├── math/                      # 数学
│   │   │   ├── MathFormula.vue
│   │   │   ├── MathConcept.vue
│   │   │   └── MathLife.vue
│   │   ├── chinese/                   # 语文
│   │   │   ├── ChinesePoem.vue
│   │   │   ├── ChineseText.vue
│   │   │   ├── ChineseWords.vue
│   │   │   └── ChineseWriting.vue
│   │   └── english/                   # 英语
│   │       ├── EnglishVocab.vue
│   │       ├── EnglishSentence.vue
│   │       ├── EnglishGrammar.vue
│   │       ├── EnglishReading.vue
│   │       └── EnglishWriting.vue
│   ├── views/                         # 页面
│   │   ├── Home.vue                   # 首页
│   │   ├── Learn.vue                  # 学习容器
│   │   ├── Mistakes.vue               # 错题本
│   │   ├── Search.vue                 # 搜索
│   │   ├── Review.vue                 # 复习
│   │   ├── Report.vue                 # 报告
│   │   ├── Settings.vue               # 设置
│   │   ├── learn/                     # 学习子页
│   │   │   ├── PackageList.vue        # 包列表（3 分组）
│   │   │   ├── UnitList.vue           # 单元列表
│   │   │   ├── TopicList.vue          # 主题列表
│   │   │   ├── TopicDetail.vue        # 主题详情
│   │   │   └── ExamPanel.vue          # 考试面板（专项/冲刺）
│   │   └── settings/
│   │       └── ImportWizard.vue       # 导入向导
│   ├── db/
│   │   └── index.ts                   # Dexie 数据库定义
│   ├── router/
│   │   └── index.ts                   # 路由
│   ├── schemas/                       # JSON Schema
│   ├── App.vue
│   └── main.ts
├── scripts/                           # 内容工具链│   ├── lib/
│   │   ├── idRewrite.ts               # ID 重写
│   │   ├── packSet.ts                 # ZIP 打包
│   │   └── qualityChecks.ts           # 质量检查 W030~W033
│   ├── validate.ts                    # 单包校验
│   ├── validate-lpkgset.ts            # 集合校验
│   └── build-lpkgset.ts               # 集合打包
├── tests/                             # 单测（vitest，1.8 新增）
│   ├── review-scheduler.test.ts       # FSRS 排期 + 每日闸门 + 旧签名兼容
│   ├── bkt.test.ts                    # 掌握概率 / 猜对 vs 真会
│   ├── mastery-rules.test.ts          # 掌握状态机（含防虚假掌握）
│   ├── mistake-rules.test.ts          # 错题三级状态
│   ├── streak.test.ts                 # 打卡口径
│   └── user-data-store.test.ts        # store 集成（内存版 Dexie 替身）
├── docs/
│   ├── spec/
│   │   ├── content-production-sop.md  # 内容生产 SOP
│   │   └── error-codes.md             # 错误码字典
│   └── prompts/
│       ├── engine1-content.md         # 引擎一：内容生成
│       ├── engine2-package.md         # 引擎二：包包装
│       ├── input-templates.md         # 输入模板速查
│       └── SOP.md                     # 总工作流
├── content/                           # 内容目录（gitignore 可选）
│   ├── math-4-up-rjb/
│   ├── chinese-4-up-rjb/
│   └── english-7-up-rjb/
├── public/
│   └── builtin/                       # 内置包（可选）
├── src-tauri/                         # Tauri 项目
│   ├── src/
│   ├── tauri.conf.json
│   └── Cargo.toml
├── package.json
├── vite.config.ts
├── vitest.config.ts                   # 单测配置（缓存目录固定在项目内）
└── README.md（本文档）
```

---

## 四、核心架构设计

### 4.1 五层架构

```
┌────────────────────────────────────┐
│ 应用外壳 (App Shell)                │
│  ├─ 侧边栏（宽屏）/底部 Tab（窄屏） │
│  ├─ Header（返回 + 页面标题 + 日期）│
│  └─ PWAUpdateBar                    │
├────────────────────────────────────┤
│ 视图层 (Views)                      │
│  Home / Learn / Mistakes / Search  │
│  Review / Report / Settings        │
├────────────────────────────────────┤
│ 业务组件层 (Modules)                │
│  Core: QuizEngine                   │
│  Math: MathFormula / Concept / Life │
│  Chinese: Poem / Text / Words / ... │
│  English: Vocab / Grammar / ...     │
├────────────────────────────────────┤
│ 核心能力层 (Core)                   │
│  Importer / Registry / Stores       │
│  Review / Prerequisite / Recommend  │
│  Search / Report / Export           │
├────────────────────────────────────┤
│ 数据层 (Data)                       │
│  IndexedDB: packages/progress/...   │
│  JSON Schema: 校验                   │
│  Workbox: SW + 缓存                  │
└────────────────────────────────────┘
```

### 4.2 数据模型

#### LearningPackage（学习包）
```json
{
  "manifest": {
    "schemaVersion": "1.0",
    "packageId": "unit-math-4-up-rjb-p1",
    "packageType": "base | unit | term | special | sprint | mistake",
    "isInternal": false,
    "examMode": false,
    "subject": "math | chinese | english",
    "templateId": "math.primary.v1",
    "grade": 4,
    "term": "up | down",
    "edition": "人教版",
    "title": "第一单元 xxx",
    "dependencies": ["unit-...-p0"],
    "sourceUnitIds": ["unit-...-p4::u5"]
  },
  "knowledgePoints": [
    {
      "id": "uuid 或 语义 ID",
      "type": "concept | formula | poem | word | grammar | ...",
      "title": "标题",
      "content": "Markdown + LaTeX",
      "prerequisites": ["其他 kp id"],
      "exerciseIds": [],       // 打包时自动生成
      "metadata": {}
    }
  ],
  "exercises": [],             // 单元包顶层池（语文包常用）
  "units": [
    {
      "id": "u1",
      "name": "第一单元",
      "title": "标题",
      "desc": "描述",
      "topics": [
        {
          "id": "u1-t1",
          "title": "主题标题",
          "knowledgePointIds": ["kp-xxx"],
          "modules": [
            {
              "id": "u1-t1-m1",
              "type": "math.concept",
              "title": "模块标题",
              "knowledgePointIds": ["kp-xxx"],
              "data": {}
            }
          ],
          "exercises": []
        }
      ]
    }
  ]
}
```

#### ProgressRecord（学习进度）
```ts
{
  id?: number
  packageId: string
  knowledgePointId: string
  status: '未学' | '学习中' | '已掌握' | '需复习'
  correctCount: number
  wrongCount: number
  correctStreak: number    // 连续答对
  wrongStreak: number      // 连续答错
  lastStudiedAt: string
  studySeconds: number
  reviewStage?: number     // 艾宾浩斯阶段 0~6
  nextReviewAt?: string    // 下次复习时间
  lastReviewAt?: string
}
```

#### MistakeRecord（错题）
```ts
{
  id?: number
  packageId: string
  exerciseId: string
  knowledgePointIds: string[]
  wrongAt: string
  wrongCount: number
  mastered: boolean
  questionData: any
}
```

### 4.3 掌握度状态机 + BKT 概率

状态机（4 态，对外视觉语义不变）：
```
未学 → 学习中：首次学习
学习中 → 已掌握：连续答对 ≥ 3 且正确率 ≥ 80%  且 掌握概率 ≥ 0.6
学习中 → 已掌握：（BKT 提前通道）掌握概率 ≥ 0.9 且 连对 ≥ 2 且 从未答错
学习中 → 需复习：连续答错 ≥ 2
已掌握 → 需复习：连错 1 次 或 7 天未学
需复习 → 已掌握：复习后连续答对 ≥ 2
```

**BKT（贝叶斯知识追踪）**：每个知识点维护一个"已学会"的概率，
每答一次用贝叶斯公式更新。关键在于**蒙对率按题型走**——
判断题 50%、4 选 1 单选题 25%、填空题 5%——所以"答对"的证据强度天差地别：

| 题型 | 连对 2 次的掌握概率 | 效果 |
|---|---|---|
| 填空题 | ≈ 99% | 直接触发提前掌握 |
| 判断题 | ≈ 70% | 还需更多证据 |

这正是用来区分「猜对」和「真会」的。界面上它作为 4 态标签旁的
「掌握度 xx%」副标展示，不替代原有状态标签。

实现：`src/core/mastery/bkt.ts`（算法）+ `src/core/mastery/masteryRules.ts`（状态机纯函数）。
阈值在 `masteryRules.ts` 的 `MASTERY_RULES`。

### 4.4 FSRS 复习调度（已取代固定间隔表）

用 **FSRS**（Free Spaced Repetition Scheduler，Anki 现行默认算法）替代
原来的固定表 `[1,2,4,7,15,30,60]`。FSRS 为每个知识点维护
Difficulty（难度）/ Stability（记忆稳定性）/ Retrievability（可提取性）三状态，
按目标记忆率反推下次复习时间。

参数（`src/core/review/fsrs.ts`）：

| 参数 | 取值 | 理由 |
|---|---|---|
| `request_retention` | 0.92 | FSRS 默认 0.9；小学生遗忘更快，取略保守值 |
| `enable_short_term` | true | 配合日粒度学习步 |
| `learning_steps` / `relearning_steps` | `['1d']` | 默认是分钟级（1m/10m），本系统按天用，改成日粒度 |
| `enable_fuzz` | false | 关闭随机抖动，同样输入必须得到同样排期（可单测） |
| `maximum_interval` | 365 天 | 间隔上限 |

实际排期曲线（一路答对）：**首次 2 天 → 8 → 28 → 87 → …**；答错 → 1 天后回补。

**四档评分自动推断**（孩子零额外操作，`rateFromOutcome`）：

| 情况 | 评分 |
|---|---|
| 答错 | 忘记 |
| 刚答错过、这次补上了 | 困难 |
| 连续答对 ≥3 且 ≤12 秒答完 | 轻松 |
| 其余答对 | 记得 |

⚠️ **最关键的一道闸门 `shouldAdvanceSchedule`**：一个 topic 里同一知识点会被连续答对
多次（如 8 道口算全对），如果每次答对都推进 FSRS，一节课内间隔就会从 2 天冲到几十天。
所以规则是——**同一天内只推进一次，答错除外**（答错要立刻把复习拉回来）。
这条规则由 `tests/review-scheduler.test.ts` 里一个「一节课连答对 8 次」的用例锁住。

`reviewScheduler.ts` 对外保留全部旧函数签名（`computeNextReview` 等），
所以 userData store 与各页面的调用方式一行都没改。

### 4.5 模板/模块注册表

**注册表**（`registerAll.ts`）：
```ts
registerModule('math.formula', MathFormula)
registerModule('math.concept', MathConcept)
registerModule('math.life', MathLife)
registerModule('chinese.poem', ChinesePoem)
// ...
```

**渲染**（`TopicDetail.vue`）：
```vue
<component :is="getModuleComponent(mod.type)" ... />
```

**推断兜底**（topic 没有 modules 时）：
```ts
inferModuleType(kp) → 根据 subject + kp.type 推断
```

### 4.6 包类型与分组

| packageType | isInternal | examMode | 学习页分组 |
|---|---|---|---|
| unit | true | false | 隐藏 |
| term | false | false | 📚 教材 |
| special | false | true | 🎯 专项突破 |
| sprint | false | true | 🏁 冲刺模拟 |

---

## 五、学习包开发规范

### 5.1 包类型
- **base**：基础包（已废弃，不用）
- **unit**：单元包（`isInternal: true`）
- **term**：学期包（聚合 unit）
- **special**：专项测验（examMode）
- **sprint**：冲刺模拟（examMode）
- **mistake**：错题强化（未实现）

### 5.2 ID 规范

**引擎一输出**（裸 ID）：
- 知识点：`kp-[分类]-[3位]`（如 `kp-num-001`）
- 单元：`u[N]`
- 主题：`u[N]-t[M]`
- 模块：`u[N]-t[M]-m[K]`
- 题目：`u[N]-ex-[3位]`

**打包脚本自动重写**：
- `kp-num-001` → `unit-math-4-up-rjb-p1::kp-num-001`

**专项/冲刺包**（跨包引用）：
- 引用其他包知识点时，写**完整 ID**：`unit-chinese-4-up-rjb-u4::kp-chinese-014`
- 本包产生的 ID 写裸 ID

### 5.3 题型
| type | answer 格式 | 额外字段 |
|---|---|---|
| single | `"C"` | `options: []` |
| blank | `"答案文本"` | — |
| multiple | `"ABC"` 或 `["A","B"]` | `options` |
| judge | `"对"` 或 `"错"` | — |
| matching | `[1, 2, 0]` | `left[]`、`right[]` |
| spelling | `"word"` | `hint` |

### 5.4 错误码

| 码 | 含义 |
|---|---|
| E001-E003 | 顶层结构 / manifest |
| E004 | 知识点 ID 重复 |
| E005-E007 | 题目缺 id/type/answer |
| E008 | 题目无知识点关联 |
| E009 | 引用了不存在的知识点 |
| E010 | JSON 语法错误 |
| E012 | 连线题字段不合法 |
| E013 | 前置引用不存在 |
| E014 | 前置循环依赖 |
| E020-E021 | 依赖项非法/自依赖 |
| E022 | 包依赖循环 |
| W001 | 知识点缺 id |
| W002 | 题目 id 重复 |
| W020 | 依赖重复 |
| W021 | 依赖包未找到 |
| W030 | 题在顶层 exercises（建议移到 topic）|
| W031 | topic 没有 modules |
| W032 | 知识点 ID 已带 :: 前缀 |
| W033 | 题目 ID 已带 :: 前缀 |

---

## 六、内容生产流程

### 6.1 三个引擎

| 引擎 | 文件 | 职责 |
|---|---|---|
| 引擎一 | `docs/prompts/engine1-content.md` | 内容生成（Content IR，裸 ID）|
| 引擎二 | `docs/prompts/engine2-package.md` | 包结构包装（加 manifest）|
| 手动 | `docs/prompts/SOP.md` | term 包手写 + `_set.json` |

### 6.2 完整流程

```
1. 引擎一：AI 生成 Content IR（裸 ID，无 manifest）
   ↓
2. 引擎二：AI 加 manifest
   ↓
3. 手动：写 term-xxx.json 和 _set.json
   ↓
4. npm run validate:set -- content/xxx   （预检）
   ↓
5. npm run build:lpkgset -- content/xxx  （打包 ZIP）
   ↓
6. App 导入 ZIP
   ↓
7. 验证 3 分组 + 内容显示
```

### 6.3 目录结构

```
content/
└── chinese-4-up-rjb/
    ├── _set.json                          # 集合配置
    ├── unit-chinese-4-up-rjb-u1.json      # 单元包
    ├── ...
    ├── term-chinese-4-up-rjb.json         # 学期包
    ├── special-chinese-4-up-xxx.json      # 专项包
    └── sprint-chinese-4-up-final.json     # 冲刺包
```

### 6.4 `_set.json` 结构

```json
{
  "setId": "chinese-4-up-rjb-term-set",
  "title": "语文四年级上册（人教版）",
  "subject": "chinese",
  "grade": 4,
  "term": "up",
  "edition": "人教版",
  "importOrder": [
    "unit-chinese-4-up-rjb-u1",
    "unit-chinese-4-up-rjb-u2",
    "...",
    "term-chinese-4-up-rjb"
  ],
  "packages": [
    {
      "file": "unit-chinese-4-up-rjb-u1.json",
      "packageId": "unit-chinese-4-up-rjb-u1",
      "type": "unit",
      "visible": false,
      "dependencies": []
    },
    {
      "file": "term-chinese-4-up-rjb.json",
      "packageId": "term-chinese-4-up-rjb",
      "type": "term",
      "visible": true,
      "dependencies": ["unit-chinese-4-up-rjb-u1", "..."]
    }
  ]
}
```

### 6.5 ZIP 结构

```
manifest.json           # 集合元数据
packages/
  ├── unit-xxx-u1.json
  ├── unit-xxx-u2.json
  ├── ...
  └── term-xxx.json
```

---

## 七、已实现功能清单

### 7.1 内容侧
- ✅ 单 JSON 导入
- ✅ ZIP 批量导入（事务）
- ✅ 规范化 + 跨包 ID 校验
- ✅ 依赖解析（环检测）
- ✅ 聚合包解析（term/special/sprint）
- ✅ 质量检查 W030~W033
- ✅ 命令行校验 `validate:set`
- ✅ 命令行打包 `build:lpkgset`

### 7.2 学习侧
- ✅ 学习包列表（3 分组）
- ✅ 单元列表
- ✅ 主题列表
- ✅ 主题详情（知识卡片 + 练习）
- ✅ 7 种题型练习引擎（single/blank/multiple/judge/matching/spelling/essay）
- ✅ 逐题上报驱动状态机
- ✅ 错题自动收集
- ✅ 错题本（按知识点分组）
- ✅ 掌握度 4 态
- ✅ 学习进度统计（ECharts）
- ✅ 学习报告（含 PDF 导出）
- ✅ 搜索（知识点/题目/错题）
- ✅ 搜索历史

### 7.3 复习/推荐
- ✅ **FSRS 复习调度**（取代固定间隔表，含四档评分自动推断）
- ✅ 复习计划页（展示掌握度 %、记忆强度 %）
- ✅ 前置知识检查（**诊断性热身**：可直接拉起前置知识点的题做微型复习，非阻断）
- ✅ 推荐引擎（错题/需复习/新知识/前置）
- ✅ 首页推荐卡片

### 7.4 掌握度与错题
- ✅ 掌握度 4 态 + **BKT 掌握概率副标**（区分猜对与真会）
- ✅ 错题三级状态（未掌握 / 部分掌握 / 已掌握）
- ✅ 部分掌握的题降频保留 + 「再答对 N 次就掌握了」提示

### 7.5 体验激励
- ✅ 连续学习天数（打卡 streak，本地日期口径，晚间打卡不会算到第二天）
- ✅ 成就徽章（9 枚：掌握知识点里程碑 / 连续天数 / 错题清道夫 / 稳固连对）
- ✅ 首页成就墙 + 新解锁即时祝贺
- ✅ 非打击式反馈文案（答错不再说"掉进陷阱"，练习反馈按正确率分级但措辞只指向题目）

### 7.6 工程质量
- ✅ **vitest 单测 101 例**（5 个文件：FSRS 排期 / BKT / 掌握状态机 / 错题三级 / 打卡 + store 集成测试）
- ✅ 用内存版 Dexie 替身覆盖 `recordProgress` 全链路，老数据升级路径有回归网

### 7.7 系统侧
- ✅ IndexedDB 存储
- ✅ 深/浅/跟随系统主题
- ✅ 字号调整
- ✅ 用户数据导出（错题/进度/包/全量）
- ✅ 用户数据导入（合并模式）
- ✅ PWA 离线可用
- ✅ PWA 更新提示
- ✅ Tauri 打包 exe
- ✅ 宽屏侧边栏 + 窄屏底部 Tab
- ✅ 深层页返回按钮

---

## 八、关键实现细节

### 8.1 Vue Proxy 与 IndexedDB
**坑**：Vue 的 reactive/ref 对象是 Proxy，IndexedDB 不能直接存。
**解**：所有入 DB 的数据先深拷贝：
```ts
function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}
```

### 8.2 错题"复活"
**坑**：mastered=true 的错题再错时不出现。
**解**：`addMistake` 更新分支必须 `mastered: false`。

### 8.3 字段名统一
**坑**：早期用 `manifest.type`，新规范用 `manifest.packageType`。
**解**：
- `build-lpkgset.ts` 统一写 `packageType` 并删除 `type`
- 前端 `getPackageType(pkg)` 兼容两种
- `normalizePackage.ts` 支持两种

### 8.4 聚合包处理
**坑**：term 包不该合并自己的 units（空壳），只用依赖的 unit 包。
**解**：`resolvePackageUnits` 判断"依赖包有无 units"，不用 dependencies 判断。

### 8.5 ID 前缀剥离
**坑**：跨格式 ID（带/不带前缀）匹配失败。
**解**：`stripPrefix(id)` 剥掉 `::` 前部分再比对。

### 8.6 topic 兜底渲染
**场景**：topic 没有 modules 时。
**解**：从 `knowledgePointIds` 拉知识点，按 `subject + kp.type` 推断模块组件。

### 8.7 topic 题源兜底
**场景**：题在单元包顶层 exercises 池。
**解**：从顶层池筛出属于本 topic 知识点的题（剥前缀比对）。

### 8.8 Tauri 缓存
**坑**：exe 更新后仍加载旧前端。
**解**：
- 清 `%LOCALAPPDATA%\com.family.learning`
- 或换 `identifier`
- 或每次大改版换新 identifier

### 8.9 Tauri 打包
- **首次编译**：5~20 分钟（400+ crates）
- **命令**：`npx tauri build --no-bundle`（跳过 NSIS）
- **NSIS 下载失败**：用 `--no-bundle` 只出 exe
- **便携版**：`src-tauri/target/release/app.exe`（约 10 MB）

---

## 九、调试过的坑（按类别）

### 9.1 数据层
| 坑 | 表现 | 修复 |
|---|---|---|
| Proxy 写入 IndexedDB | DataCloneError | 深拷贝 |
| mastered 不复活 | 错题不出现 | update 时置 false |
| 字段名 packageType/type 混用 | 学习页分组错 | 兼容两种 |
| packageId 主键缺失 | 导入失败 | 规范化时同步到顶层 |
| 悬空引用（E009） | 导入失败 | 跨包 ID 池校验 |

### 9.2 视图层
| 坑 | 表现 | 修复 |
|---|---|---|
| TopicList/TopicDetail 混淆 | 单元下主题列表空 | 分清职责 |
| 聚合包 units 空壳 | 单元列表 16 项 | 只用依赖包 units |
| 依赖过滤过严 | 数学 term 只剩 1 单元 | 按有无 units 判断 |
| topic 无 modules | 详情页空白 | 知识点自动渲染兜底 |
| topic 无 exercises | 详情页无题 | 顶层池筛题兜底 |

### 9.3 打包层
| 坑 | 表现 | 修复 |
|---|---|---|
| Tauri 首次编译慢 | 等 5~20 分钟 | 正常 |
| NSIS 下载超时 | bundle 失败 | `--no-bundle` |
| 中文产品名问题 | WiX light.exe 失败 | 改用英文 productName |
| identifier 默认值 | 打包报错 | 改 `com.family.learning` |
| Vite watcher 监控 src-tauri | EBUSY 错误 | ignore src-tauri |

### 9.4 缓存层
| 坑 | 表现 | 修复 |
|---|---|---|
| WebView2 缓存旧前端 | exe 更新无效 | 清 `%LOCALAPPDATA%\com.family.learning` |
| PWA SW 缓存旧版 | dev 页面不更新 | Application → Unregister SW |
| Vite HMR 失效 | 改动不生效 | 硬刷新 / 重启 dev |

---

## 十、用户偏好（重要）

### 10.1 输出风格
- **中文回答**
- **直接给完整代码文件**，不分步粘贴
- **一次覆盖完毕**，不要"再改一次"
- **命令简短直接**，不要长篇解释
- **Markdown 格式**，用代码块包裹文件内容

### 10.2 技术偏好
- **PowerShell** 命令
- **Node 命令**用 `npm run xxx`
- **不用 NSIS**（用 `--no-bundle`）
- **不用 base 包层**
- **文件名规范**：`unit-{学科}-{年级}-{学期}-{版本}-u{N}`
- **避免中途打断**：给完整方案再执行

### 10.3 调试习惯
- 用**浏览器 Console** 快速验证数据结构
- 用 **`dir`** 看文件时间戳
- 用**开发环境** `npm run dev` 优先测试
- 用 **Tauri dev** 测试原生窗口
- 验证通过后才重新打包 exe

### 10.4 提问习惯
- 会附上**当前完整代码**和**报错日志**
- 会附上**现有目录截图**
- 期望 AI **准确修改**，不要猜测
- 期望 AI **不要重复给一样的代码**

---

## 十一、命令速查

```bash
# 开发
npm run dev                          # 启动 dev 服务器（5173）
npx tauri dev                        # 启动 Tauri 原生窗口

# 测试（1.8 新增）
npm test                             # 跑 vitest 单测（5 个文件 / 101 用例）
npx vitest run                       # 同上，跑一次即退出
npx vitest                           # watch 模式

# 校验
npm run validate -- <file.json>      # 单包校验
npm run validate:set -- content/xxx  # 集合校验（含 W030~W033）

# 打包
npm run build:lpkgset -- content/xxx # 打包成 ZIP
npx tauri build --no-bundle          # 打 exe
npm run build                        # 只构建前端

# 清理
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\com.family.learning"
Remove-Item -Recurse -Force node_modules/.vite
```

> ⚠️ **打包踩坑（必读）**：`tauri build` 会再跑一次 `npm run build`，Vite 清空
> `dist/assets`（100+ 文件）会被本机安全策略拦截。先 `mv dist .dist-prev` 再构建，
> 完成后清理。另外 `npx vitest` 的缓存目录已在 `vitest.config.ts` 里固定到
> `node_modules/.vitest-cache`，否则默认写在 `%TEMP%` 会被拦截导致测试加载不全。

---

## 十二、关键文件索引

| 功能 | 文件 |
|---|---|
| 导入器 | `src/core/importer/importService.ts` |
| 规范化 | `src/core/importer/normalizePackage.ts` |
| 依赖解析 | `src/core/importer/dependencyResolver.ts` |
| 聚合解析 | `src/core/importer/resolvePackageUnits.ts` |
| 模块注册 | `src/core/registry/registerAll.ts` |
| 练习引擎 | `src/modules/core/QuizEngine.vue` |
| 用户数据 | `src/core/stores/userData.ts` |
| **FSRS 内核** | `src/core/review/fsrs.ts` |
| 复习调度门面 | `src/core/review/reviewScheduler.ts` |
| **BKT 掌握概率** | `src/core/mastery/bkt.ts` |
| **掌握状态机（纯函数）** | `src/core/mastery/masteryRules.ts` |
| **错题三级规则** | `src/core/mistake/mistakeRules.ts` |
| **连续打卡** | `src/core/motivation/streak.ts` |
| **成就徽章** | `src/core/motivation/achievements.ts` |
| **鼓励反馈文案** | `src/core/motivation/encouragement.ts` |
| 推荐引擎 | `src/core/recommendation/rulesEngine.ts` |
| 包列表 | `src/views/learn/PackageList.vue` |
| 单元列表 | `src/views/learn/UnitList.vue` |
| 主题列表 | `src/views/learn/TopicList.vue` |
| 主题详情（含前置热身/掌握度面板） | `src/views/learn/TopicDetail.vue` |
| 考试面板 | `src/views/learn/ExamPanel.vue` |
| 导入向导 | `src/views/settings/ImportWizard.vue` |
| 数据库 | `src/db/index.ts` |
| 路由 | `src/core/router/index.ts` |
| **单测** | `tests/*.test.ts` + `vitest.config.ts` |
| ID 重写 | `scripts/lib/idRewrite.ts` |
| ZIP 打包 | `scripts/lib/packSet.ts` |
| 质量检查 | `scripts/lib/qualityChecks.ts` |
| 集合校验 | `scripts/validate-lpkgset.ts` |
| 集合打包 | `scripts/build-lpkgset.ts` |
| 内容提示词 | `docs/prompts/engine1-content.md` |
| 包装提示词 | `docs/prompts/engine2-package.md` |
| 输入模板 | `docs/prompts/input-templates.md` |
| SOP | `docs/prompts/SOP.md` |

---

## 十三、待办与后续方向

### 13.1 短期（有明确需求）
- [ ] 专项/冲刺包生成流程实战验证
- [ ] 内容生产 SOP 走一遍完整流程
- [ ] exe 分发方案（内置包 vs 手动导入）
- [ ] **进度记录的 packageId 归一化**（已知遗留问题，见下）

> ⚠️ **1.8 遗留的已知问题（不影响使用，但值得排期）**
>
> `recordProgress(packageId, kpId, …)` 用 `[packageId + knowledgePointId]` 作为主键。
> 现在同一个知识点可能从不同入口被上报到不同的 packageId——
> 从「学期包」进去是 `term-xxx`，从「单元包」进去是 `unit-xxx-p1`，
> 从「专项包」进去是它的 `dependencies[0]`。于是同一个知识点可能产生多条进度记录，
> 掌握率统计会被稀释。
>
> 修法：让 store（或调用方）先把 packageId 归一化成**该知识点的归属包**。
> 注意这是升级前就存在的历史问题，1.8 没有把它改得更糟，但也没有解决。

### 13.2 中期（可优化）
- [ ] PWA chunk 优化（echarts 按需引入）
- [ ] 首页性能优化
- [ ] 学习页「继续学习」快捷入口
- [ ] 错题本导出为 PDF
- [ ] 学习报告图表增强

### 13.3 长期（未来方向）
- [ ] 语文/数学/英语多版本教材包
- [ ] 跨设备云同步（可选）
- [ ] 家长视图（孩子 vs 家长）
- [ ] 语音朗读（语文/英语）
- [ ] AI 生成变式题
- [ ] 内容包市场

---

## 十四、如何接续开发（新 AI 对话必读）

### 14.1 开场给 AI 的信息
```
1. 本文档（README.md）
2. 一句话需求（例如："帮我加一个 xxx 功能"）
3. 涉及的现有代码（如果需要）
```

### 14.2 AI 应遵守的规则
1. **先读文档**，理解架构再动手
2. **不要随意改字段名**（packageType 等已统一）
3. **不要用 base 包**
4. **不要碰 ID 重写逻辑**（脚本自动做）
5. **给完整覆盖版本**，不分步
6. **中文回答 + 代码块包裹**
7. **遇到不确定的地方，先问再改**
8. **改核心算法前先跑 `npm test`，改完必须再跑一遍**（101 例是回归基线）
9. **不要为了"看起来更聪明"降低现有判定门槛**——`masteryRules.ts` 与
   `reviewScheduler.ts` 里保留旧规则的段落都写了理由，动之前先读注释
10. **DB 字段只增不改**：`ProgressRecord.fsrs / bkt / masteryProbability`、
    `MistakeRecord.masteryLevel / reviewCorrectCount` 都是新增字段；
    老数据靠 `ensureFields` 与 `legacyCardFromStage` 平滑接管，不要清理用户库

### 14.3 遇到问题时的排查顺序
1. **数据结构**：Console 打印包 JSON
2. **代码位置**：看 `src/core/...` 还是 `src/views/...`
3. **缓存问题**：清 WebView2 / PWA SW / Vite
4. **日志**：浏览器 Console + Tauri dev Console
5. **回归**：最近改了哪个文件

---

## 十五、版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| 0.1.0 | 2026-09 | 项目初始化 |
| 1.0 | 2026-09 | 首版完成：导入/学习/练习/错题/复习/推荐/报告/PWA/Tauri |
| 1.5 | 2026-10-08 | 专项/冲刺包考试模式、主观题（essay）题型 |
| 1.6 | 2026-10-15 | 每日一练包 + 「口算/竖式/脱式/思维」四板块导航 |
| 1.7 | 2026-10-15 | essay 题型自评链路完整化 |
| 1.8 | 2026-10-15 | **学习内核升级**：复习调度 → FSRS；掌握度 → BKT 概率（区分猜对/真会）；错题 → 三级状态；前置知识 → 诊断性热身；新增体验激励层（连续打卡 / 成就徽章 / 非打击式鼓励反馈）；新增 101 个单测 |

---

**最后更新**：2026-09-29
**维护者**：家长（自己）
**接续方式**：新对话贴本文档 + 一句话需求即可