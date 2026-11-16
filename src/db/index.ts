import Dexie, { type Table } from 'dexie';
import type { LearningPackageManifest } from '../schemas/manifest';
import type { KnowledgePoint } from '../schemas/knowledge-point';
import type { MistakeCause } from '../core/mistake/mistakeCause';
import type { FsrsCardState } from '../core/review/fsrs';
import type { BktState } from '../core/mastery/bkt';
import { migrateProgressV3 } from '../core/storage/migrateV3';
import { migrateProfileV4 } from '../core/storage/migrateV4';

/**
 * Dexie 的 `Table` 类型从这里再导出一次。
 *
 * 为什么：调用方要声明「某张表可能不存在」（见 `core/stores/userData.ts` 的
 * `cardCompletionsTable` —— 单测的 fakeDexie 只实现了 6 张表），需要拿到
 * `Table<Row, Key>` 这个类型。让调用方直接 `import { type Table } from 'dexie'`
 * 会绕过本文件这一层，读者也看不出「为什么这里要 Dexie 的类型」。
 */
export type { Table };

export interface LearningPackageRecord {
  packageId: string;
  manifest: LearningPackageManifest;
  knowledgePoints: KnowledgePoint[];
  exercises: any[];
  units: any[];
}

export type MasteryStatus = '未学' | '学习中' | '已掌握' | '需复习';

/**
 * P3 · 错题三级状态
 *   none     未掌握：刚从错题本收进来
 *   partial  部分掌握：复习答对过 1 次，仍会出现但降频
 *   mastered 已掌握：连续答对 2 次，移出待复习（记录留档）
 */
export type MistakeMasteryLevel = 'none' | 'partial' | 'mastered';

export interface ProgressRecord {
  id?: number;
  /**
   * 归属档案（V1.4 · B1）。**必填**，没有"全局/默认"形态 ——
   * 可空就意味着存在一条代码路径忘了判断，而写错档案不会报错、只会静默串数据。
   * 取值只有一个来源：`currentProfileId()`（见 core/profile/currentProfile.ts）。
   */
  profileId: string;
  packageId: string;
  knowledgePointId: string;
  status: MasteryStatus;
  correctCount: number;
  wrongCount: number;
  correctStreak: number;
  wrongStreak: number;
  lastStudiedAt: string;
  studySeconds: number;
  /** @deprecated 保留用于展示与老数据换算，真实排期以 fsrs 为准 */
  reviewStage?: number;
  nextReviewAt?: string;
  lastReviewAt?: string | null;
  /** P0 · FSRS 卡片状态（Difficulty / Stability / Retrievability） */
  fsrs?: FsrsCardState;
  /** P1 · BKT 已掌握概率 0~1 */
  masteryProbability?: number;
  /** P1 · BKT 完整状态 */
  bkt?: BktState;
}

export interface MistakeRecord {
  id?: number;
  /** 归属档案（V1.4 · B1），同 `ProgressRecord.profileId` */
  profileId: string;
  packageId: string;
  exerciseId: string;
  knowledgePointIds: string[];
  wrongAt: string;
  wrongCount: number;
  mastered: boolean;
  questionData?: any;
  /** ✅ 最近一次答错时的用户答案 */
  lastUserAnswer?: string;
  /** P3 · 三级掌握状态（mastered 字段保留兼容，等价于 masteryLevel === 'mastered'） */
  masteryLevel?: MistakeMasteryLevel;
  /** P3 · 收进错题本之后，复习答对的次数 */
  reviewCorrectCount?: number;
  /** C1 · 归因标签；旧数据为 undefined（UI 显示「未分类」，逻辑按 knowledge 兜底） */
  mistakeCause?: MistakeCause;
}

export interface SettingRecord {
  key: string;
  value: any;
}

export interface ExamSessionRecord {
  id?: number;
  /** 归属档案（V1.4 · B1）。考试记录也必须分片，否则老二能看到老大的成绩。 */
  profileId: string;
  packageId: string;
  sessionIndex: number;
  questionIds: string[];
  answers: Record<string, { userAnswer: any; isCorrect: boolean }>;
  currentIndex: number;
  elapsedSeconds: number;
  totalCount: number;
  timeLimit: number;
  startedAt: string;
  finishedAt?: string;
  status: 'ongoing' | 'finished';
  finalCorrect?: number;
  finalRate?: number;
}

/**
 * V2.0 · 专题练习的断点（与 `examSessions` **刻意分开**）。
 *
 * 为什么不复用 `examSessions`：那张表是 ExamPanel 的"历史卷子"列表数据源，
 * 把每做几道的专题练习塞进去，会在模考页冒出一堆"未完成"的卷子。
 * 为什么也不叫 `SessionRecord`：那是方案草稿里的平行概念，本仓已有 `ExamSessionRecord`
 * 作为"会话"的唯一形状，多造一个只会让后来人不知道该看哪个 —— 直接叫
 * `TopicSessionRecord`，按 `topicId` 归档，字段形状仿 `ExamSessionRecord`。
 *
 * **设备本地瞬态**：不进 `bundleIO` 备份、不进 `planMerge` 合并、不进 `routeBackup`。
 * 把"做到一半的练习"搬到另一台机器没有意义 —— 那边会莫名其妙弹"继续上次"。
 * 有测试钉住备份字段集合（tests/topic-session.test.ts「备份口径」）。
 */
export interface TopicSessionRecord {
  id?: number;
  /** 归属档案（V1.4 · B1 规则：**必填**，取值只有 `currentProfileId()` 一个来源） */
  profileId: string;
  packageId: string;
  topicId: string;
  questionIds: string[];
  answers: Record<string, { userAnswer: any; isCorrect: boolean }>;
  currentIndex: number;
  totalCount: number;
  startedAt: string;
  updatedAt: string;
  status: 'ongoing' | 'finished';
}

/**
 * V2.7 · 轨道 B2：用户导入的本地环境音（MP3 / M4A / OGG…）。
 *
 * 为什么把 Blob 直接放 IndexedDB 而不是 objectURL + 内存缓存：
 *   · objectURL 必须手动 `revokeObjectURL`，刷新页面后旧 URL 一律失效 —— 存 URL 等于存垃圾；
 *   · Blob 由 IndexedDB 持久化，跨会话可用，删除行即释放（无第二处引用）。
 *
 * **设备本地资产**：不进备份、不进合并（与 `topicSessions` 同一条边界 ——
 * 几十 MB 的音频不该跟着"家庭备份"一起搬，也不该悄悄占满另一台设备的配额）。
 */
export interface CustomSoundRecord {
  /** 自增主键（Dexie 生成） */
  id?: number;
  /** 归属档案（V1.4 · B1 规则：必填，取值只有 `currentProfileId()` 一个来源） */
  profileId: string;
  /** 稳定的业务 id（导出/删除都按它 + profileId 定位） */
  soundId: string;
  /** 用户看到的名字（默认取文件名去扩展名） */
  name: string;
  mime: string;
  /** 字节数（列表里展示体积、并用于配额提示） */
  size: number;
  /** 音频二进制本体 */
  blob: Blob;
  createdAt: string;
}

/**
 * V2.12 · 学习包图片资产（题干配图）。
 *
 * ## 为什么不用 base64 内嵌进包 JSON
 * 一张 300dpi 的图形题配图约 40~120KB，base64 后膨胀 33%，而且**每道引用的题都各带一份**。
 * 更要命的是 `db.packages` 是整包整行读写的（`put(normalized)` 写、`toArray()` 读），
 * 图片内嵌意味着每次读包列表都要把几十 MB 字符串解析一遍。
 *
 * ## 为什么不存 objectURL
 * 与 `CustomSoundRecord` 同一条理由：objectURL 刷新即失效，必须手动 revoke，
 * 存 URL 等于存垃圾。这里只存 Blob，URL 由渲染组件**临时创建、卸载即释放**。
 *
 * ## 归属边界：**包级，不是档案级**
 * 与 `packages` 表一致 —— 图片是学习包的内容资产，不是某个孩子的学习记录。
 * 因此不进备份、不进合并（`buildBackupV2` 只搬进度/错题/会话/设置）。
 * 兄弟档案共用同一份配图是正确行为，不需要按 profileId 分片。
 *
 * ## 主键选择：`[packageId+path]`
 * 包内 JSON 用**相对路径**引用（`assets/shape-01.png`），而不是自增 id。
 * 这样：① 包源文件可读、可 review；② 重复导入幂等（同路径覆盖）；
 * ③ 不用在导入时改写题目内容（改写会让包 JSON 与源文件不一致）。
 */
export interface PackageAssetRecord {
  /** 自增主键（Dexie 生成） */
  id?: number;
  packageId: string;
  /** 包内相对路径，规范化后形如 `assets/shape-01.png`（无前导 `./`、无反斜杠） */
  path: string;
  mime: string;
  size: number;
  /** 图片二进制本体 */
  blob: Blob;
  createdAt: string;
}

export interface CardCompletionRecord {
  /** 自增主键（Dexie 生成） */
  id?: number;
  /** 归属档案（V1.4 · B1 规则：必填，取值只有 `currentProfileId()` 一个来源） */
  profileId: string;
  /**
   * 卡片种类：
   * - `unit`    —— 每日打卡的「一天」/ 专项练习的「知识点章节」（单元）
   * - `package` —— 整个学习包（包列表里那张卡）
   */
  kind: 'unit' | 'package';
  /** 入口包 id（`ru.sourcePackageId` 或包自身的 `packageId`） */
  packageId: string;
  /** 卡片 id：单元 id 或包 id */
  targetId: string;
  createdAt: string;
  /**
   * ✅ **进备份、进合并**（V3.0 · M4 起；此前 V1.4 的决定是"不进"）。
   *
   * 为什么改口：V1.4 时它只是便利标记，而当时的验收里没有换机场景。M4 把
   * 「换机后标记不丢」写进了里程碑验收（`docs/plan/v3.0-milestone.md`），
   * 而且这条标记有一个别处没有的性质 —— **无法从备份里重建**：
   * 自动判定只能把"所有知识点都学过且没错题"的卡片判绿，家长手动点绿的往往是
   * "这个单元我让孩子口算过了，不用刷题"，那是家长的判断，不在任何数据里。
   *
   * 代价可控：5 个标量字段、无 Blob、行数上限＝单元数×孩子数。
   * 合并语义是**纯并集**（`core/merge/mergeCardCompletions.ts`）。
   *
   * 仍然不进的邻居（同一条边界，别顺手加）：`topicSessions`（断点，设备级）、
   * `customSounds`（设备资产）、`packageAssets`（图片二进制，太大且随包走）。
   */
}
/**
 * V4.1 · 「手写作答」的一次作答（题目级随手练）。
 *
 * ## 场景边界：**题目级**，不是整批听写
 * 用户的原话是「手写板填答案」——在**一道题**里手写填格子，写完就地批改。
 * 所以这里按 `exerciseId` 归档，一次一行；**不做**「一次听写 N 个词 = 一个批次」
 * 那种会话级模型（那会让「待批改」变成「待批一整卷」，交互完全不同）。
 *
 * ## `status` 为什么必须有 `pending` 通道
 * 手写是"先写完、再批改"的两段式：孩子写完关掉页面，家长晚上回来批。
 * 若只有对/错两态，中间那一刻就没有合法的落库形态 —— 要么丢掉（孩子白写），
 * 要么默认判对（污染掌握度统计）。`pending` 就是这个中间态，且它是
 * **待批改队列**：`retention` 永不清理它（见 `core/handwriting/retention.ts`）。
 *
 * ## 判定方向：人判，机器只记账
 * `cells` 是孩子写下的内容（**逐格序列化笔迹**，`serializeStrokes()` 的产物，
 * 没写的格是 `'[]'`），`correctAnswer` 是参考答案的**快照**（包可能被删/被更新，
 * 批改时不该再去库里反查）。对错由 `gradeHandwriting(id, verdict)` 显式传入，
 * 本表**不做自动判分** —— 手写的"形近字/笔顺"误判代价太高，自动判错会把孩子的
 * 信心和统计一起搞坏。
 *
 * ## 为什么有 `partial` 而不只是对/错
 * 「犬/大」「人/入」这类字形差异肉眼都难分。只给对/错二选一时，家长面对
 * "差不多但有一笔不对"只能二选一：判对 → 错题本漏收；判错 → 错题本被"其实
 * 会写"的字污染。`partial` 让结论落在中间，并把"哪几格不对"记在 `wrongCells`
 * 里（**只给展示用，不进 `mistakes`** —— 那张表是题目粒度，逐字信息没有下游消费者）。
 *
 * ## 归属边界：**档案级，设备本地**
 * - 按 `profileId` 分片（V1.4 · B1 规则：必填，取值只有 `currentProfileId()`）；
 * - **不进备份、不进合并、不进 FSRS**。理由与 `topicSessions` 同源：手写内容
 *   是"这一台设备上的一次书写痕迹"，搬到另一台机器没有意义（那边没有对应的
 *   格子布局，回放出来只会错位）；而 `cells` 的对错结论已经在 `gradeHandwriting`
 *   里回流进 `progress` / `mistakes` —— 那两张表进备份，结论就不会丢。
 *   所以丢掉的只是"原笔迹"，不是"学习结果"。
 *
 * ## 索引说明（4 条，每条都有唯一查询对应）
 * - `[profileId+exerciseId]`：按题回看历史（同一题允许留多份，见 retention 的 K=2）；
 * - `[profileId+packageId]`：包被删除/重导入时的整包清理；
 * - `[profileId+status]`：待批改队列（`pending`）的唯一查询入口。`status` 是
 *   **必填**的，所以这一行永远建得进索引 —— 若做成可选的 `verdict?`，
 *   未批改时值是 `undefined`，IndexedDB **不会为 key path 为 undefined 的行建索引**，
 *   待批改列表就只能 `toArray()` 全量读（每行还带着几十 KB 的笔迹串）再内存筛；
 * - 单列 `profileId`：`purgeOldHandwriting` 先 `count()` 判阈值、超了才 `toArray()`。
 *   漏了它就会退化成全表扫（跨档案），正是 `check:profile-scope` 要拦的形态。
 *
 * 刻意**不建** `[profileId+createdAt]`：它的唯一用途是"不读行按时间排序"，那需要
 * `.between()`（本仓 fakeDexie 不支持，真库也没人这么写）；实际排序都在内存里做。
 * 一个没有查询会用的索引就是死索引 —— 与架构评审里要清理的那类技术债是同一种东西。
 */
export interface HandwritingRecord {
  /** 自增主键（Dexie 生成） */
  id?: number;
  /** 归属档案（V1.4 · B1 规则：必填，取值只有 `currentProfileId()` 一个来源） */
  profileId: string;
  /** 入口包 id（与 `recordProgress` 的第 1 参数同口径） */
  packageId: string;
  /** 题目 id：一题一行，不是一批一行 */
  exerciseId: string;
  /** 本题触达的知识点（批改回流时喂给 `recordProgress` / `addMistake`） */
  knowledgePointIds: string[];
  /** 题干快照（批改时原包可能已更新，题干以**作答那一刻**看到的为准） */
  prompt: string;
  /** 参考答案快照（人判时的对照；不参与自动判分） */
  correctAnswer: string;
  /**
   * 逐格**序列化笔迹**：`cells[i]` 是第 i 格的 `serializeStrokes()` 产物。
   *
   * 三条约定：
   * 1. **不是文本**。这里是笔迹 JSON，回放用 `deserializeStrokes(cells[i])`；
   *    数据层不解析它（解析是渲染组件的事，否则同一条轨迹会有两处口径）。
   * 2. **没写的格是 `'[]'`**，不是缺席 —— `cells` 的长度恒等于格子数，
   *    "第 2 格空着"本身就是给家长的信息。
   * 3. **永不修改**。擦掉重写 = append 新行：旧行是"孩子当时写了什么"的事实，
   *    改写它等于编辑历史，K=2 保留策略的唯一价值（这次 vs 上次的进步）当场作废。
   */
  cells: string[];
  /** 格子总数（等于 `cells.length`；单独存是为了回放时不依赖数组长度） */
  cellCount: number;
  /**
   * 批改结论：
   *   `pending` 待批改（**永不自动清理**，它是队列不是历史）
   *   `correct` 全对
   *   `wrong`   全错（进错题本）
   *   `partial` 部分对（同样进错题本 —— 与 `wrong` 在统计上完全同构，
   *              差别只在 `wrongCells` 的展示）
   */
  status: 'pending' | 'correct' | 'wrong' | 'partial';
  createdAt: string;
  /** 批改时间（`pending` 时为 undefined） */
  reviewedAt?: string;
  /**
   * 写错的格子下标（0-based，指向 `cells`）。**仅 `status === 'partial'` 时有意义**。
   *
   * 为什么不塞进 `mistakes`：那张表是**题目级**的，有三级掌握状态机与 `wrongCount`
   * 语义；逐字错误没有下游消费者，硬塞进去会把它的口径搞脏。
   * 读取侧容错：非 `partial` 的行即使带着它，也当脏数据忽略（不报错）。
   */
  wrongCells?: number[];
}
export class FamilyLearningDB extends Dexie {
  packages!: Table<LearningPackageRecord, string>;
  progress!: Table<ProgressRecord, number>;
  mistakes!: Table<MistakeRecord, number>;
  settings!: Table<SettingRecord, string>;
  examSessions!: Table<ExamSessionRecord, number>;
  topicSessions!: Table<TopicSessionRecord, number>;
  customSounds!: Table<CustomSoundRecord, number>;
  packageAssets!: Table<PackageAssetRecord, number>;
  cardCompletions!: Table<CardCompletionRecord, number>;
  handwritings!: Table<HandwritingRecord, number>;

  constructor() {
    super('FamilyLearningDB');
    this.version(1).stores({
      packages: 'packageId, manifest.subject, manifest.grade',
      progress: '++id, [packageId+knowledgePointId], packageId, status',
      mistakes: '++id, packageId, exerciseId, mastered',
      settings: 'key'
    });
    this.version(2).stores({
      packages: 'packageId, manifest.subject, manifest.grade',
      progress: '++id, [packageId+knowledgePointId], packageId, status',
      mistakes: '++id, packageId, exerciseId, mastered',
      settings: 'key',
      examSessions: '++id, packageId, status, startedAt'
    });
    // V1.3 · E-01：升到 v3 **只为了拿到 upgrade() 钩子**，schema 与 v2 逐字符相同。
    // 这一点是本方案最重要的安全属性：即使迁移永远失败，v2 结构也能正常跑，下次打开自动重试。
    this.version(3)
      .stores({
        packages: 'packageId, manifest.subject, manifest.grade',
        progress: '++id, [packageId+knowledgePointId], packageId, status',
        mistakes: '++id, packageId, exerciseId, mastered',
        settings: 'key',
        examSessions: '++id, packageId, status, startedAt'
      })
      // 迁移实现见 core/storage/migrateV3.ts：纯函数算计划 + 哑 IO 应用，永不 rethrow
      .upgrade((tx) => migrateProgressV3(tx));
    // V1.4 · B1：三张表加 profileId + settings 按档案分片。
    //
    // 与 v3 的一个关键差异：**这里删掉了 `[packageId+knowledgePointId]` 旧索引**。
    // 保留它 = 旧查询继续能跑 = 跨档案串数据（老大答错的题出现在老二错题本里）且不报错。
    // 删掉后任何漏改的 `where('[packageId+knowledgePointId]')` 会直接抛，逼调用点改。
    this.version(4)
      .stores({
        packages: 'packageId, manifest.subject, manifest.grade',
        progress:
          '++id, [profileId+packageId+knowledgePointId], [profileId+packageId], profileId, status',
        // 错题仍按 exerciseId 去重，但同一条错题在两个档案里是两行 → 复合索引
        mistakes: '++id, [profileId+exerciseId], packageId, profileId, mastered',
        settings: 'key',
        examSessions: '++id, [profileId+packageId], profileId, status, startedAt'
      })
      // 迁移实现见 core/storage/migrateV4.ts：加列 + 搬键，永不 rethrow
      .upgrade((tx) => migrateProfileV4(tx));
    // V2.0 · 专题练习断点（纯新增表，**不写 upgrade 钩子**：没有存量数据要搬，
    // 加钩子只会多一条"迁移失败"的失败路径）。
    //
    // 索引 `[profileId+topicId]`：一个档案的一个专题只该有**一行** ongoing，
    // 恢复时按这个复合索引 `.first()` 取 —— 少传 profileId 在本仓 fakeDexie 里会炸，
    // 在真库里会静默查不到（见 tests/helpers/fakeDexie.ts 文件头差异第 4 条）。
    this.version(5).stores({
      packages: 'packageId, manifest.subject, manifest.grade',
      progress:
        '++id, [profileId+packageId+knowledgePointId], [profileId+packageId], profileId, status',
      mistakes: '++id, [profileId+exerciseId], packageId, profileId, mastered',
      settings: 'key',
      examSessions: '++id, [profileId+packageId], profileId, status, startedAt',
      topicSessions: '++id, [profileId+topicId], profileId, packageId, updatedAt'
    });
    // V2.7 · 轨道 B2：本地环境音（纯新增表，无存量数据要搬 → **不写 upgrade 钩子**，
    // 与 v5 加 topicSessions 的处理一致：加钩子只会多一条"迁移失败"的失败路径）。
    this.version(6).stores({
      packages: 'packageId, manifest.subject, manifest.grade',
      progress:
        '++id, [profileId+packageId+knowledgePointId], [profileId+packageId], profileId, status',
      mistakes: '++id, [profileId+exerciseId], packageId, profileId, mastered',
      settings: 'key',
      examSessions: '++id, [profileId+packageId], profileId, status, startedAt',
      topicSessions: '++id, [profileId+topicId], profileId, packageId, updatedAt',
      customSounds: '++id, [profileId+soundId], profileId, createdAt'
    });
    // V2.12 · 学习包图片资产（纯新增表，无存量数据要搬 → **不写 upgrade 钩子**，
    // 与 v5 加 topicSessions、v6 加 customSounds 的处理一致）。
    //
    // 索引 `[packageId+path]`：一道题按 (包, 路径) 取一张图，且重复导入走覆盖写入。
    // 单独的 `packageId` 索引用于"重导入时整包替换"与将来的配额清理。
    this.version(7).stores({
      packages: 'packageId, manifest.subject, manifest.grade',
      progress:
        '++id, [profileId+packageId+knowledgePointId], [profileId+packageId], profileId, status',
      mistakes: '++id, [profileId+exerciseId], packageId, profileId, mastered',
      settings: 'key',
      examSessions: '++id, [profileId+packageId], profileId, status, startedAt',
      topicSessions: '++id, [profileId+topicId], profileId, packageId, updatedAt',
      customSounds: '++id, [profileId+soundId], profileId, createdAt',
      packageAssets: '++id, [packageId+path], packageId'
    });
    // V2.12.3 · 学习卡片的**手动「全部完成」标记**（纯新增表，无存量数据要搬 →
    // **不写 upgrade 钩子**，与 v5 加 topicSessions、v6 加 customSounds、v7 加
    // packageAssets 的处理一致：加钩子只会多一条「迁移失败」的失败路径）。
    //
    // ## 为什么单独一张表，而不是写进 `progress.status`
    //
    // `progress.status` 是 BKT / FSRS / 掌握率统计 / 成就 / 弱项推荐的共同输入。
    // 「一键把某天的 status 改成已掌握」会污染这一整条链的统计口径 —— 这正是
    // V2.4「虚拟 Good」踩过的红线（见 `core/stores/userData.ts` 的
    // `markReviewedVirtual` 注释：绝不写 status / bkt / correctCount / wrongCount）。
    //
    // 所以手动标记**独立存**，只在卡片渲染时作为 override 生效：
    // 掌握率统计仍然是原来那套干净口径，且标记可以随时撤销。
    //
    // 索引 `[profileId+kind+targetId]`：一个档案的同一张卡只该有一行标记；
    // 重复标记走 update（幂等），取消标记走 delete。
    this.version(8).stores({
      packages: 'packageId, manifest.subject, manifest.grade',
      progress:
        '++id, [profileId+packageId+knowledgePointId], [profileId+packageId], profileId, status',
      mistakes: '++id, [profileId+exerciseId], packageId, profileId, mastered',
      settings: 'key',
      examSessions: '++id, [profileId+packageId], profileId, status, startedAt',
      topicSessions: '++id, [profileId+topicId], profileId, packageId, updatedAt',
      customSounds: '++id, [profileId+soundId], profileId, createdAt',
      packageAssets: '++id, [packageId+path], packageId',
      cardCompletions: '++id, [profileId+kind+targetId], profileId, kind'
    });
    // V4.1 · 「手写作答」（题目级随手练）—— 纯新增表，无存量数据要搬 →
    // **不写 upgrade 钩子**，与 v5 加 topicSessions、v6 加 customSounds、
    // v7 加 packageAssets、v8 加 cardCompletions 的处理一致：
    // 没有数据要搬时，加钩子只会多一条「迁移失败」的失败路径。
    //
    // ★★★ 维护者注意（唯一一处抄漏就毁数据的点）★★★
    // 上面 9 行必须与 `version(8)` **逐字一致**。Dexie 的语义是：`version(n)` 的
    // `.stores()` 是**该版本的完整表清单**，不是增量。少抄一行 = 升级到 v9 时
    // 那张表被判定为"已删除" → 用户数据消失，且**不会报错**。
    // 唯一的防线是 `tests/fakeDexie-guard.test.ts` 与人工逐行核对。
    //
    // 索引选择见 `HandwritingRecord` 的注释。刻意**不建** `[profileId+createdAt]`：
    // 没有查询会用到它（排序在内存里做），死索引是技术债。
    this.version(9).stores({
      packages: 'packageId, manifest.subject, manifest.grade',
      progress:
        '++id, [profileId+packageId+knowledgePointId], [profileId+packageId], profileId, status',
      mistakes: '++id, [profileId+exerciseId], packageId, profileId, mastered',
      settings: 'key',
      examSessions: '++id, [profileId+packageId], profileId, status, startedAt',
      topicSessions: '++id, [profileId+topicId], profileId, packageId, updatedAt',
      customSounds: '++id, [profileId+soundId], profileId, createdAt',
      packageAssets: '++id, [packageId+path], packageId',
      cardCompletions: '++id, [profileId+kind+targetId], profileId, kind',
      handwritings:
        '++id, [profileId+exerciseId], [profileId+packageId], [profileId+status], profileId'
    });
  }
}

export const db = new FamilyLearningDB();