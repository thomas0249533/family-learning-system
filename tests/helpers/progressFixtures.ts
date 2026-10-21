/**
 * V1.3 轨道 B 的单测夹具（**仅供 tests 使用**，不进 src）
 *
 * 存在的理由：`progress-identity` / `progress-merge` / `mastery-summary` 三个测试都要造
 * `LearningPackageRecord` 与 `ProgressRecord`。`manifest` 有十几个必填字段，逐处手写会淹没断言。
 */
import type { LearningPackageRecord, MasteryStatus, ProgressRecord } from '@/db'
import type { LearningPackageManifest } from '@/schemas/manifest'
import type { KnowledgePoint } from '@/schemas/knowledge-point'

export interface KpSpec {
  id: string
  title?: string
}

/** 造一个最小可用的包；`manifest` 用断言补齐（只有 `packageId` / `subject` 被逻辑读到） */
export function makePkg(packageId: string, subject: string, kps: KpSpec[]): LearningPackageRecord {
  const manifest = {
    packageId,
    title: packageId,
    subject,
    grade: 4,
    packageType: 'unit',
    version: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as LearningPackageManifest

  const knowledgePoints: KnowledgePoint[] = kps.map((kp) => ({
    id: kp.id,
    type: 'concept',
    title: kp.title ?? kp.id,
    content: '',
  }))

  return { packageId, manifest, knowledgePoints, exercises: [], units: [] }
}

export interface ProgressSpec {
  id: number
  /** v4 起进度行按档案隔离；不传即单档案场景（'default'），与生产 `DEFAULT_PROFILE_ID` 一致 */
  profileId?: string
  packageId: string
  knowledgePointId: string
  status?: MasteryStatus
  correctCount?: number
  wrongCount?: number
  correctStreak?: number
  wrongStreak?: number
  lastStudiedAt?: string
  studySeconds?: number
  reviewStage?: number
  nextReviewAt?: string
  lastReviewAt?: string | null
  masteryProbability?: number
  bkt?: { pKnown: number; observed: number }
  fsrs?: { due: string; last_review?: string | null; stability?: number; difficulty?: number } & Record<
    string,
    unknown
  >
}

/** 造一条进度行。默认值刻意"中性"（未学 / 0 计数），断言只需改想验的字段 */
export function makeProgress(spec: ProgressSpec): ProgressRecord {
  return {
    id: spec.id,
    profileId: spec.profileId ?? 'default',
    packageId: spec.packageId,
    knowledgePointId: spec.knowledgePointId,
    status: spec.status ?? '学习中',
    correctCount: spec.correctCount ?? 0,
    wrongCount: spec.wrongCount ?? 0,
    correctStreak: spec.correctStreak ?? 0,
    wrongStreak: spec.wrongStreak ?? 0,
    lastStudiedAt: spec.lastStudiedAt ?? '2026-01-01T00:00:00.000Z',
    studySeconds: spec.studySeconds ?? 0,
    reviewStage: spec.reviewStage,
    nextReviewAt: spec.nextReviewAt,
    lastReviewAt: spec.lastReviewAt,
    masteryProbability: spec.masteryProbability,
    bkt: spec.bkt,
    fsrs: spec.fsrs as ProgressRecord['fsrs'],
  }
}

/**
 * english-7 的形状：7 个包各自定义同一套 7 个 kpId，但 title 各不相同 → 49 个不同知识点。
 *
 * @param prefixed `true` = 运行时（zip 导入）形状：id 带包前缀，本来就互不相同；
 *                 `false` = 裸 JSON 单文件导入（调试路径）：7 个包共用 7 个**裸** id ——
 *                 这正是"裸 kpId 去重会把 49 塌成 7"的反例现场，默认用它。
 */
export function makeEnglishSeven(prefixed = false): LearningPackageRecord[] {
  const ids = [
    'kp-reading-001',
    'kp-word-001',
    'kp-sentence-001',
    'kp-grammar-001',
    'kp-grammar-002',
    'kp-phonetic-001',
    'kp-writing-001',
  ]
  const titles: Record<number, string> = {
    1: '寻找朋友的帖子',
    2: '一张家庭照片的描述',
    3: '学校开放日邀请函',
    4: '我的暑假计划',
    5: '一次难忘的旅行',
    6: '图书馆使用说明',
    7: '一封感谢信',
  }
  const packages: LearningPackageRecord[] = []
  for (let i = 1; i <= 7; i += 1) {
    const packageId = `unit-english-7-up-rjb-p${i}`
    packages.push(
      makePkg(
        packageId,
        'english',
        ids.map((id) => ({
          id: prefixed ? `${packageId}::${id}` : id,
          title: `${titles[i]}·${id}`,
        }))
      )
    )
  }
  return packages
}
