import Dexie, { type Table } from 'dexie';
import type { LearningPackageManifest } from '../schemas/manifest';
import type { KnowledgePoint } from '../schemas/knowledge-point';
import type { MistakeCause } from '../core/mistake/mistakeCause';
import type { FsrsCardState } from '../core/review/fsrs';
import type { BktState } from '../core/mastery/bkt';
import { migrateProgressV3 } from '../core/storage/migrateV3';
import { migrateProfileV4 } from '../core/storage/migrateV4';

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

export class FamilyLearningDB extends Dexie {
  packages!: Table<LearningPackageRecord, string>;
  progress!: Table<ProgressRecord, number>;
  mistakes!: Table<MistakeRecord, number>;
  settings!: Table<SettingRecord, string>;
  examSessions!: Table<ExamSessionRecord, number>;
  topicSessions!: Table<TopicSessionRecord, number>;
  customSounds!: Table<CustomSoundRecord, number>;

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
  }
}

export const db = new FamilyLearningDB();