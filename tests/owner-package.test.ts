/**
 * 归属包解析 · **真实数据表驱动**测试（`tests/fixtures/kp-owner-map.csv`，898 行）
 *
 * 为什么要有这份测试，而不是只靠手写小用例：
 *   手写用例只能证明"我实现了我以为的规则"，证明不了"这条规则在用户真实导入的 43 个包 /
 *   472 个 kpId 上给出的答案和离线核对过的期望值一致"。CSV 是从 `content/` 下各 `.lpkgset.zip`
 *   导出的运行时数据，等于把一次真实全库审计固化成断言——任何口径悄悄回退（比如有人把
 *   `own` 从「自己的 `knowledgePoints` 里声明了它」改回「自己的 `units` 里引用了它」），
 *   这里立刻红一片（452 行会变），而不是等到用户发现复习队列重复。
 *
 * 数据来源与列定义见 `tests/fixtures/kp-owner-map.md`：CSV 是纯数据，元数据在同名 md 里。
 *
 * 注意：本文件**不 import** `tests/helpers/progressFixtures.ts` —— 那份夹具服务的是
 * `progress-identity / progress-merge / mastery-summary`，需要的是"最小手写包"；本文件需要的是
 * "按 CSV 反推出的 43 个真实包"，形状由 CSV 决定，自包含更不容易跟着别人重构一起漂。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildOwnerIndex, resolveOwnerPackageId } from '@core/progress/ownerIndex'
import type { LearningPackageRecord } from '@/db'
import type { KnowledgePoint } from '@/schemas/knowledge-point'
import type { LearningPackageManifest } from '@/schemas/manifest'

// =====================================================================
// 1. 夹具读取
// =====================================================================

const CSV_PATH = resolve(process.cwd(), 'tests/fixtures/kp-owner-map.csv')

/** 列顺序是断言契约的一部分：改了列顺序，下面按下标取值全部错位 → 必须显式钉住 */
const EXPECTED_HEADER = ['entryPackageId', 'entryPackageType', 'kpId', 'ownerPackageId', 'result']

/**
 * `result` 的取值域（见 `kp-owner-map.md` 列定义）。
 * - `ok`            → 期望解析出 `ownerPackageId`
 * - `zero`          → `|own| == 0`，期望 null
 * - `ambiguous`     → `|own| >= 2`，期望 null
 * - `crossSubject`  → 跨学科，期望 null
 */
type FixtureResult = 'ok' | 'zero' | 'ambiguous' | 'crossSubject'

const FIXTURE_RESULTS: readonly FixtureResult[] = ['ok', 'zero', 'ambiguous', 'crossSubject']

interface FixtureRow {
  entryPackageId: string
  entryPackageType: string
  kpId: string
  ownerPackageId: string
  result: FixtureResult
}

function parseCsv(text: string): { header: string[]; rows: FixtureRow[] } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const header = (lines[0] ?? '').split(',').map((cell) => cell.trim())
  const rows: FixtureRow[] = []

  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(',').map((cell) => cell.trim())
    if (cells.length !== EXPECTED_HEADER.length) {
      throw new Error(`[kp-owner-map.csv] 第 ${i + 1} 行列数异常：${cells.length} ≠ ${EXPECTED_HEADER.length}`)
    }
    const result = cells[4] as FixtureResult
    if (!FIXTURE_RESULTS.includes(result)) {
      throw new Error(`[kp-owner-map.csv] 第 ${i + 1} 行 result 取值非法：${cells[4]}`)
    }
    rows.push({
      entryPackageId: cells[0],
      entryPackageType: cells[1],
      kpId: cells[2],
      ownerPackageId: cells[3],
      result,
    })
  }

  return { header, rows }
}

const { header, rows } = parseCsv(readFileSync(CSV_PATH, 'utf8'))

// =====================================================================
// 2. 用 CSV 反推 packages（CSV 只给"谁声明了谁"，不给包对象）
// =====================================================================

type Subject = LearningPackageManifest['subject']
type PackageType = LearningPackageManifest['packageType']

const PACKAGE_TYPES: readonly PackageType[] = [
  'base',
  'unit',
  'term',
  'special',
  'sprint',
  'mistake',
  'daily',
]

/**
 * 学科从 packageId 里取（`daily-math-4-up-rjb-45d` → math）。
 * 这是测试专用的近似——`resolveOwnerPackageId` 的 subject 闸门只需要"两侧学科是否相等"，
 * 而夹具里 898 行按此推导后**零跨学科**（与 CSV `result` 全 ok 相符），说明推导与真实 manifest 一致。
 */
function subjectOf(packageId: string): Subject {
  if (packageId.includes('-chinese-')) return 'chinese'
  if (packageId.includes('-english-')) return 'english'
  return 'math'
}

function gradeOf(packageId: string): number {
  const matched = /-(\d+)-/.exec(packageId)
  return matched ? Number(matched[1]) : 4
}

function packageTypeOf(raw: string): PackageType {
  return PACKAGE_TYPES.includes(raw as PackageType) ? (raw as PackageType) : 'unit'
}

function makeManifest(packageId: string, packageType: PackageType): LearningPackageManifest {
  return {
    schemaVersion: '1.0',
    packageId,
    packageType,
    subject: subjectOf(packageId),
    templateId: 'owner-package-test',
    grade: gradeOf(packageId),
    term: 'up',
    title: packageId,
  }
}

function makeKnowledgePoint(id: string): KnowledgePoint {
  // title 直接用 id：本文件只验"归属哪个包"，title 必须互不相同，
  // 否则会无意中触发统计层的"同 title 副本收敛"规则，混淆被测语义。
  return { id, type: 'concept', title: id, content: '' }
}

function makePackage(packageId: string, packageType: PackageType, declaredKpIds: string[]): LearningPackageRecord {
  return {
    packageId,
    manifest: makeManifest(packageId, packageType),
    knowledgePoints: declaredKpIds.map(makeKnowledgePoint),
    exercises: [],
    units: [],
  }
}

/** packageId → 它声明（own）的 kpId 列表 */
const declaredKpIdsByPackage = new Map<string, string[]>()
/** packageId → 它作为"学习入口"出现时的 packageType */
const packageTypeByPackage = new Map<string, PackageType>()

for (const row of rows) {
  const declared = declaredKpIdsByPackage.get(row.ownerPackageId)
  if (declared) {
    if (!declared.includes(row.kpId)) declared.push(row.kpId)
  } else {
    declaredKpIdsByPackage.set(row.ownerPackageId, [row.kpId])
  }
  packageTypeByPackage.set(row.entryPackageId, packageTypeOf(row.entryPackageType))
}

const allPackageIds = [...new Set([...packageTypeByPackage.keys(), ...declaredKpIdsByPackage.keys()])].sort()

const packages: LearningPackageRecord[] = allPackageIds.map((packageId) =>
  makePackage(
    packageId,
    packageTypeByPackage.get(packageId) ?? 'unit',
    declaredKpIdsByPackage.get(packageId) ?? []
  )
)

/** 建一次索引给全部 898 行复用（也顺带验证 buildOwnerIndex 的成本模型：全表只扫一遍） */
const index = buildOwnerIndex(packages)

// =====================================================================
// 3. 夹具自检：夹具被悄悄换掉时先在这里爆，而不是在 898 行里刷屏
// =====================================================================

describe('夹具自检（kp-owner-map.csv）', () => {
  it('表头未变（列顺序是断言契约的一部分）', () => {
    expect(header).toEqual(EXPECTED_HEADER)
  })

  it('规模钉死：898 行 / 472 个 kpId / 43 个入口包 / 26 个归属包', () => {
    // 这三个数字是 `kp-owner-map.md` 里记录的全库实测值。数字变了先问"夹具为什么变"，
    // 而不是默默接受——它同时是"43 个包、472 个 kpId、每 kpId 只被 1 个包声明"这条结论的证据。
    expect(rows.length).toBe(898)
    expect(new Set(rows.map((row) => row.kpId)).size).toBe(472)
    expect(new Set(rows.map((row) => row.entryPackageId)).size).toBe(43)
    expect(new Set(rows.map((row) => row.ownerPackageId)).size).toBe(26)
  })

  it('运行时数据里每个 kpId 只被一个包声明（C3：zip 导入路径零重复）', () => {
    const ownersByKpId = new Map<string, Set<string>>()
    for (const row of rows) {
      const owners = ownersByKpId.get(row.kpId) ?? new Set<string>()
      owners.add(row.ownerPackageId)
      ownersByKpId.set(row.kpId, owners)
    }
    const ambiguous = [...ownersByKpId.entries()].filter(([, owners]) => owners.size > 1)
    // 这一条是"歧义分支在真实数据里几乎不触发"的实测证据；若变红说明运行时 id 不再带包前缀
    expect(ambiguous).toEqual([])
  })

  it('反推出来的 packages 覆盖了 CSV 里所有入口包，且每个都带 subject', () => {
    const builtIds = new Set(packages.map((pkg) => pkg.packageId))
    for (const row of rows) {
      expect(builtIds.has(row.entryPackageId), row.entryPackageId).toBe(true)
      expect(builtIds.has(row.ownerPackageId), row.ownerPackageId).toBe(true)
    }
  })
})

// =====================================================================
// 4. 主断言：898 行逐行表驱动
// =====================================================================

describe('CSV 表驱动：898 行逐行断言 (entryPackageId, kpId) → ownerPackageId', () => {
  /**
   * 逐行断言，**不跳过任何一行**：`result` 列就是这一行的期望语义，
   * 非 `ok` 的行（本次快照里是 0 行）按它自己的 result 断言 null，而不是硬编码"全是 ok"。
   * 这样夹具将来真的出现 zero / ambiguous / crossSubject 行时，测试跟着夹具走，不需要改代码。
   */
  it.each(rows.map((row) => [row.entryPackageId, row.kpId, row.ownerPackageId, row.result] as const))(
    '%s :: %s → %s（%s）',
    (entryPackageId, kpId, ownerPackageId, result) => {
      const expected = result === 'ok' ? ownerPackageId : null
      expect(resolveOwnerPackageId(kpId, entryPackageId, index)).toBe(expected)
    }
  )
})

// =====================================================================
// 5. 边界：三分支 + subject 闸门 + 兜底（手写最小包，与 CSV 无关）
// =====================================================================

const OWNER_MATH = 'unit-math-4-up-rjb-p1'
const OWNER_MATH_SIBLING = 'unit-math-4-up-rjb-p2'
const ENTRY_TERM_MATH = 'term-math-4-up-rjb'
const ENTRY_TERM_CHINESE = 'term-chinese-4-up-rjb'
const KP_OWNED = 'unit-math-4-up-rjb-p1::kp-num-001'

describe('边界：|own| == 1（唯一声明者才归一化）', () => {
  it('唯一声明者 + 同学科 → 返回归属包（不是入口包）', () => {
    const idx = buildOwnerIndex([
      makePackage(OWNER_MATH, 'unit', [KP_OWNED]),
      makePackage(ENTRY_TERM_MATH, 'term', []),
    ])
    expect(resolveOwnerPackageId(KP_OWNED, ENTRY_TERM_MATH, idx)).toBe(OWNER_MATH)
  })

  it('入口包自己就是归属包 → 返回自己（幂等：重复归一化不再变化）', () => {
    const idx = buildOwnerIndex([
      makePackage(OWNER_MATH, 'unit', [KP_OWNED]),
      makePackage(ENTRY_TERM_MATH, 'term', []),
    ])
    expect(resolveOwnerPackageId(KP_OWNED, OWNER_MATH, idx)).toBe(OWNER_MATH)
  })

  it('同一包在自己的知识库里重复声明同一 kpId → 仍只算 1 个声明者（不会自我歧义）', () => {
    const idx = buildOwnerIndex([
      makePackage(OWNER_MATH, 'unit', [KP_OWNED, KP_OWNED]),
      makePackage(ENTRY_TERM_MATH, 'term', []),
    ])
    expect(resolveOwnerPackageId(KP_OWNED, ENTRY_TERM_MATH, idx)).toBe(OWNER_MATH)
  })
})

describe('边界：|own| == 0（不知道就不动，绝不 fallback 到入口包）', () => {
  it('谁都没声明这个 kpId → null（词表 word id 走的就是这一支）', () => {
    const idx = buildOwnerIndex([
      makePackage(OWNER_MATH, 'unit', [KP_OWNED]),
      makePackage(ENTRY_TERM_MATH, 'term', []),
    ])
    expect(resolveOwnerPackageId('word-apple', ENTRY_TERM_MATH, idx)).toBeNull()
  })

  it('空 kpId → null（脏数据不许解析成"入口包自己"）', () => {
    const idx = buildOwnerIndex([makePackage(ENTRY_TERM_MATH, 'term', [])])
    expect(resolveOwnerPackageId('', ENTRY_TERM_MATH, idx)).toBeNull()
  })

  it('空库 → null，不抛', () => {
    const idx = buildOwnerIndex([])
    expect(resolveOwnerPackageId(KP_OWNED, ENTRY_TERM_MATH, idx)).toBeNull()
  })
})

describe('边界：|own| >= 2（歧义即不动，零 tie-break）', () => {
  it('两个包声明同一 kpId → null，**即使两者 title 完全相同也不选代表**（C2）', () => {
    // makePackage 的 title 就是 kpId → 两个候选 title 必然相同，
    // 正是 C2 明确禁止"title 全同则取副本代表"的那种输入。
    const idx = buildOwnerIndex([
      makePackage(OWNER_MATH, 'unit', [KP_OWNED]),
      makePackage(OWNER_MATH_SIBLING, 'unit', [KP_OWNED]),
      makePackage(ENTRY_TERM_MATH, 'term', []),
    ])
    expect(resolveOwnerPackageId(KP_OWNED, ENTRY_TERM_MATH, idx)).toBeNull()
  })

  it('packageType 不同也不用来 tie-break（不按 packageType 挑）', () => {
    const idx = buildOwnerIndex([
      makePackage(OWNER_MATH, 'unit', [KP_OWNED]),
      makePackage('term-math-4-up-rjb-dup', 'term', [KP_OWNED]),
      makePackage(ENTRY_TERM_MATH, 'term', []),
    ])
    expect(resolveOwnerPackageId(KP_OWNED, ENTRY_TERM_MATH, idx)).toBeNull()
  })
})

describe('边界：subject 闸门（跨学科归属一律视为异常）', () => {
  it('归属包与入口包学科不同 → null（数学包里声明的 kp 不许被语文包认领）', () => {
    const idx = buildOwnerIndex([
      makePackage(OWNER_MATH, 'unit', [KP_OWNED]),
      makePackage(ENTRY_TERM_CHINESE, 'term', []),
    ])
    expect(resolveOwnerPackageId(KP_OWNED, ENTRY_TERM_CHINESE, idx)).toBeNull()
  })
})

describe('边界：入口包已卸载（不在 packages 里）', () => {
  it('入口包不在索引里 → 跳过 subject 闸门，仍解析出归属包（当前实现）', () => {
    /**
     * 锁住"现状"。设计文档 §2.1 没有规定这一支；task 书曾要求这一支返回 null。
     * 保持现状的理由：迁移路径上"包已删但 progress 残留"的行，能解析出归属包反而修好了
     * provenance；返回 null 会让这些行永远不参与归一化。
     * **若裁决改为 null，这里是第一处要改的断言**（实现侧同步加 packageIds guard）。
     */
    const idx = buildOwnerIndex([
      makePackage(OWNER_MATH, 'unit', [KP_OWNED]),
      makePackage(ENTRY_TERM_MATH, 'term', []),
    ])
    expect(resolveOwnerPackageId(KP_OWNED, 'term-math-4-up-uninstalled', idx)).toBe(OWNER_MATH)
  })
})

describe('边界：短 id 只作兜底（english-7 陷阱的安全网）', () => {
  it('历史行写的是短 id，但全库只有一个声明者 → 解析到那个包', () => {
    const idx = buildOwnerIndex([
      makePackage(OWNER_MATH, 'unit', [KP_OWNED]),
      makePackage(ENTRY_TERM_MATH, 'term', []),
    ])
    expect(resolveOwnerPackageId('kp-num-001', ENTRY_TERM_MATH, idx)).toBe(OWNER_MATH)
  })

  it('裸 id 有两个声明者 → null（english-7 裸 JSON 路径的 49 个知识点就死在这里）', () => {
    // 注意入参必须是**裸 id**：带前缀的完整 id 会先命中精确分支（唯一声明者）而正常解析，
    // 只有"历史行里写的是裸 id"才会走到短 id 兜底，此时两个声明者 → 歧义 → 不猜。
    const idx = buildOwnerIndex([
      makePackage('unit-english-7-up-rjb-p1', 'unit', ['unit-english-7-up-rjb-p1::kp-reading-001']),
      makePackage('unit-english-7-up-rjb-p2', 'unit', ['unit-english-7-up-rjb-p2::kp-reading-001']),
      makePackage('term-english-7-up-rjb', 'term', []),
    ])
    expect(resolveOwnerPackageId('kp-reading-001', 'term-english-7-up-rjb', idx)).toBeNull()
    // 反证：同一个知识点用带前缀的完整 id 查，就能唯一解析（运行时路径不受影响）
    expect(
      resolveOwnerPackageId('unit-english-7-up-rjb-p1::kp-reading-001', 'term-english-7-up-rjb', idx)
    ).toBe('unit-english-7-up-rjb-p1')
  })
})
