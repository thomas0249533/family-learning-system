import { describe, expect, it } from 'vitest'
import type { ExamSessionRecord, MistakeRecord, ProgressRecord } from '@/db'
import {
  isPlanNoop,
  type Bundle,
  type LocalSnapshot,
  type MergePlan,
} from '@core/backup/types'
import type { ProfileMeta } from '@core/profile/profileTypes'
import { planMerge } from '@core/merge/mergeBundle'
import { progressKey, progressRank } from '@core/merge/mergeProgress'
import { mistakeLevelRank } from '@core/merge/mergeMistakes'
import { sessionKey } from '@core/merge/mergeSessions'
import { normalizeUnlocked } from '@core/motivation/achievements'
import { classifyKey } from '@core/profile/settingsScope'

/**
 * `planMerge` 的**性质测试**（AC-P2-12 / AC-P2-13 / AC-P2-14）。
 *
 * ## 为什么不用第三方属性测试库
 * 需要的只是"确定性伪随机 + 三条不变量"。引一个库要多一份依赖、多一层报错口径，
 * 而这里的生成器只有几十行，且**种子固定**——失败可复现，比随机更重要。
 *
 * ## 三条性质
 *   ① 单调：`merged ⊇ local`，且各行的排序值不降低（AC-P2-12）
 *   ② 幂等：`planMerge(merged, remote, now, globals).stats.noop === true`
 *   ③ 自反：`planMerge(local, local.bundles, now, globals).stats.noop === true`
 * ②③ 合起来才是「导两次不翻倍」（AC-P2-13）。只测 ③ 是不够的：
 * 自反只证明"同一份数据不重复写"，而用户真正遇到的是"同一份备份导两次"。
 *
 * 前半部分是 200 组随机的性质测试，后半部分是 `planMerge` 在档案/全局键上的契约。
 */

// ---------------------------------------------------------------------------
// 确定性伪随机（mulberry32）
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NOW = '2026-06-01T00:00:00.000Z'
const PIDS = ['default', 'p_a', 'p_b'] as const
const PKGS = ['pkg-a', 'pkg-b'] as const
const KPS = ['kp-1', 'kp-2', 'kp-3'] as const
const DAYS = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'] as const
const STAMPS = [
  '2026-01-01T10:00:00.000Z',
  '2026-01-02T10:00:00.000Z',
  '2026-01-03T10:00:00.000Z',
  '2026-01-04T10:00:00.000Z',
] as const
const STATUSES = ['未学', '学习中', '已掌握', '需复习'] as const
const LEVELS = ['none', 'partial', 'mastered'] as const

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length]
}

function int(rnd: () => number, max: number): number {
  return Math.floor(rnd() * (max + 1))
}

// ---------------------------------------------------------------------------
// 生成器
// ---------------------------------------------------------------------------
function genProgress(rnd: () => number, pid: string): ProgressRecord {
  return {
    profileId: pid,
    packageId: pick(rnd, PKGS),
    knowledgePointId: pick(rnd, KPS),
    status: pick(rnd, STATUSES),
    correctCount: int(rnd, 5),
    wrongCount: int(rnd, 3),
    correctStreak: int(rnd, 3),
    wrongStreak: int(rnd, 2),
    lastStudiedAt: pick(rnd, [...STAMPS, '']),
    studySeconds: int(rnd, 300),
    lastReviewAt: rnd() < 0.3 ? null : pick(rnd, [...STAMPS, '']),
    ...(rnd() < 0.25 ? { id: int(rnd, 999) } : {}),
  }
}

function genMistake(rnd: () => number, pid: string): MistakeRecord {
  const level = pick(rnd, LEVELS)
  return {
    profileId: pid,
    packageId: pick(rnd, PKGS),
    exerciseId: `ex-${int(rnd, 3)}`,
    knowledgePointIds: [pick(rnd, KPS)],
    wrongAt: pick(rnd, STAMPS),
    wrongCount: int(rnd, 4),
    mastered: level === 'mastered',
    masteryLevel: rnd() < 0.2 ? undefined : level,
    reviewCorrectCount: int(rnd, 2),
    ...(rnd() < 0.25 ? { id: int(rnd, 999) } : {}),
  }
}

function genSession(rnd: () => number, pid: string): ExamSessionRecord {
  return {
    profileId: pid,
    packageId: pick(rnd, PKGS),
    sessionIndex: 1 + int(rnd, 2),
    questionIds: ['q1', 'q2'],
    answers: {},
    currentIndex: int(rnd, 2),
    elapsedSeconds: int(rnd, 600),
    totalCount: 2,
    timeLimit: 600,
    startedAt: pick(rnd, STAMPS),
    status: rnd() < 0.5 ? 'finished' : 'ongoing',
    finalRate: rnd() < 0.5 ? rnd() : undefined,
    ...(rnd() < 0.25 ? { id: int(rnd, 999) } : {}),
  }
}

function genSettings(rnd: () => number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (rnd() < 0.8) {
    const ids = ['ach-a', 'ach-b', 'ach-c'].filter(() => rnd() < 0.6)
    out.achievements = ids.map((id) => ({ id, unlockedAt: pick(rnd, [...DAYS, '']) }))
  }
  if (rnd() < 0.8) {
    out.dailyStats = DAYS.filter(() => rnd() < 0.6).map((date) => ({
      date,
      questionCount: int(rnd, 9),
      firstStudyAt: rnd() < 0.2 ? 0 : 1000 + int(rnd, 500),
      lastStudyAt: rnd() < 0.2 ? 0 : 2000 + int(rnd, 500),
    }))
  }
  if (rnd() < 0.7) {
    out.studyStreak = {
      current: int(rnd, 9),
      longest: int(rnd, 9),
      lastDate: rnd() < 0.2 ? '' : pick(rnd, DAYS),
    }
  }
  if (rnd() < 0.5) {
    out['achievement:discovery'] = {
      v: 1,
      chances: int(rnd, 2),
      revealed: ['comeback', 'early-bird', 'night-owl'].filter(() => rnd() < 0.4),
      streakWithoutNew: int(rnd, 5),
      lastGrantDay: rnd() < 0.2 ? '' : pick(rnd, DAYS),
    }
  }
  if (rnd() < 0.5) out['achievement:collectionSeen'] = rnd() < 0.5
  if (rnd() < 0.5) out['achievement:discoveryEnabled'] = rnd() < 0.5
  if (rnd() < 0.5) out.achievementUi = { v: 1, collapsed: rnd() < 0.5 ? ['earned'] : [] }
  if (rnd() < 0.6) out.attemptedTypes = ['blank', 'judge', 'match'].filter(() => rnd() < 0.5)
  return out
}

function genBundle(rnd: () => number, pid: string): Bundle {
  return {
    profileId: pid,
    name: `名字-${pid}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    progress: Array.from({ length: int(rnd, 4) }, () => genProgress(rnd, pid)),
    mistakes: Array.from({ length: int(rnd, 3) }, () => genMistake(rnd, pid)),
    examSessions: Array.from({ length: int(rnd, 2) }, () => genSession(rnd, pid)),
    settings: genSettings(rnd),
  }
}

function genLocalSnapshot(rnd: () => number): LocalSnapshot {
  // 档案总数不超过 3（< MAX_PROFILES=4），远端再怎么加也不会触发 profile-limit，
  // 于是 200 组都能跑到真正的合并路径上
  const pids = PIDS.filter(() => rnd() < 0.7)
  const list = pids.length > 0 ? pids : ['default']
  return {
    profiles: list.map((id) => ({ id, name: `本机-${id}`, createdAt: '2025-12-01T00:00:00.000Z' })),
    activeProfileId: list[0],
    bundles: list.map((pid) => genBundle(rnd, pid)),
    globalSettings: rnd() < 0.5 ? { 'fls:theme': 'light' } : {},
  }
}

function genRemote(rnd: () => number): { bundles: Bundle[]; globals: Record<string, unknown> } {
  const pids = PIDS.filter(() => rnd() < 0.7)
  const bundles: Bundle[] = []
  for (const pid of pids) {
    bundles.push(genBundle(rnd, pid))
    // 有时同一档案给两份：模拟"同一份备份导两次 / 手工拼接过的备份"
    if (rnd() < 0.25) bundles.push(genBundle(rnd, pid))
  }
  const globals: Record<string, unknown> = {}
  if (rnd() < 0.5) globals['fls:theme'] = 'dark'
  if (rnd() < 0.3) globals['achievement:audit'] = ['x']
  return { bundles, globals }
}

// ---------------------------------------------------------------------------
// 把计划回放到快照上（模拟 applyMergePlan 的语义，纯内存）
// ---------------------------------------------------------------------------
function replaceByKey<T>(rows: T[], row: T, keyOf: (r: T) => string): void {
  const k = keyOf(row)
  const i = rows.findIndex((r) => keyOf(r) === k)
  if (i >= 0) rows[i] = row
  else rows.push(row)
}

function applyPlanToSnapshot(local: LocalSnapshot, plan: MergePlan): LocalSnapshot {
  const profiles: ProfileMeta[] = [...local.profiles]
  for (const p of plan.newProfiles) if (!profiles.some((x) => x.id === p.id)) profiles.push(p)

  const bundles: Bundle[] = local.bundles.map((b) => ({
    ...b,
    progress: [...b.progress],
    mistakes: [...b.mistakes],
    examSessions: [...b.examSessions],
    settings: { ...b.settings },
  }))
  const globalSettings: Record<string, unknown> = { ...local.globalSettings }

  const bundleOf = (pid: string): Bundle => {
    let hit = bundles.find((b) => b.profileId === pid)
    if (!hit) {
      hit = {
        profileId: pid,
        name: pid,
        createdAt: '2026-01-01T00:00:00.000Z',
        progress: [],
        mistakes: [],
        examSessions: [],
        settings: {},
      }
      bundles.push(hit)
    }
    return hit
  }

  for (const row of plan.progressUpserts) replaceByKey(bundleOf(row.profileId).progress, row, progressKey)
  for (const row of plan.mistakeUpserts) replaceByKey(bundleOf(row.profileId).mistakes, row, (r) => r.exerciseId)
  for (const row of plan.sessionUpserts) replaceByKey(bundleOf(row.profileId).examSessions, row, sessionKey)

  for (const u of plan.settingUpserts) {
    const sc = classifyKey(u.key)
    if (sc.kind === 'profile') bundleOf(sc.profileId).settings[sc.base] = u.value
    else if (sc.kind === 'global') globalSettings[u.key] = u.value
  }

  return { profiles, activeProfileId: local.activeProfileId, bundles, globalSettings }
}

function sumQuestions(raw: unknown): number {
  if (!Array.isArray(raw)) return 0
  return raw.reduce((sum, v) => sum + (typeof (v as { questionCount?: number }).questionCount === 'number' ? (v as { questionCount: number }).questionCount : 0), 0)
}

/**
 * 某个 key 下所有行的"最好值"。
 *
 * ## 这里放宽的到底是哪条
 * 放宽的是「**逐行**比」，**不是**「单调性」。单调性本身一点没弱：
 * 仍然是"合并后不差于合并前"，只是度量对象从"每一行"换成"每个 key 的最优行"。
 *
 * 原因是本机可能有**脏数据**（同一个知识点两行，历史遗留），而 `MergePlan` 只有
 * upsert、没有删除能力 —— 合并不会（也不该）顺手删掉重复行。此时"逐行比对"
 * 会把"另一行本来就更差"误报成倒退，掩盖真正的缺陷。
 *
 * 反过来说：如果哪天真出现了"每个 key 的最优行变差"，这个断言一定会红。
 */
function bestBy<T>(rows: readonly T[], keyOf: (r: T) => string, scoreOf: (r: T) => string): Map<string, string> {
  const out = new Map<string, string>()
  for (const row of rows) {
    const k = keyOf(row)
    const s = scoreOf(row)
    const prev = out.get(k)
    if (prev === undefined || s > prev) out.set(k, s)
  }
  return out
}

/** 单调性违规清单（收集后一次性断言，200 组才跑得快、失败信息才看得懂） */
function monotonicViolations(local: LocalSnapshot, merged: LocalSnapshot, seed: number): string[] {
  const bad: string[] = []
  for (const lb of local.bundles) {
    const mb = merged.bundles.find((b) => b.profileId === lb.profileId)
    if (!mb) {
      bad.push(`seed=${seed} 档案 ${lb.profileId} 在合并结果里消失`)
      continue
    }

    const localRank = bestBy(lb.progress, progressKey, progressRank)
    const mergedRank = bestBy(mb.progress, progressKey, progressRank)
    for (const [k, rank] of localRank) {
      const after = mergedRank.get(k)
      if (after === undefined) {
        bad.push(`seed=${seed} 进度行丢失 ${k}`)
        continue
      }
      if (after < rank) bad.push(`seed=${seed} 进度排序值降低 ${k}: ${rank} → ${after}`)
    }

    const localWrongAt = bestBy(lb.mistakes, (m) => m.exerciseId, (m) => m.wrongAt)
    const mergedWrongAt = bestBy(mb.mistakes, (m) => m.exerciseId, (m) => m.wrongAt)
    const localLevel = bestBy(lb.mistakes, (m) => m.exerciseId, (m) => String(mistakeLevelRank(m)))
    const mergedLevel = bestBy(mb.mistakes, (m) => m.exerciseId, (m) => String(mistakeLevelRank(m)))
    for (const [k, wrongAt] of localWrongAt) {
      const after = mergedWrongAt.get(k)
      if (after === undefined) {
        bad.push(`seed=${seed} 错题行丢失 ${k}`)
        continue
      }
      if (after < wrongAt) bad.push(`seed=${seed} 错题 wrongAt 倒退 ${k}`)
      const afterLevel = Number(mergedLevel.get(k) ?? 0)
      if (afterLevel < Number(localLevel.get(k) ?? 0)) {
        bad.push(`seed=${seed} 错题等级倒退 ${k}`)
      }
    }

    for (const row of lb.examSessions) {
      if (!mb.examSessions.some((m) => sessionKey(m) === sessionKey(row))) {
        bad.push(`seed=${seed} 模考场次丢失 ${sessionKey(row)}`)
      }
    }

    // ---- settings 里真正"指标"的那几个，必须单调不减 ----
    const localAch = normalizeUnlocked(lb.settings.achievements).map((r) => r.id)
    const mergedAch = new Set(normalizeUnlocked(mb.settings.achievements).map((r) => r.id))
    for (const id of localAch) if (!mergedAch.has(id)) bad.push(`seed=${seed} 徽章丢失 ${id}`)

    const localQ = sumQuestions(lb.settings.dailyStats)
    const mergedQ = sumQuestions(mb.settings.dailyStats)
    if (mergedQ < localQ) bad.push(`seed=${seed} 每日题量下降 ${localQ} → ${mergedQ}`)

    const ls = lb.settings.studyStreak as { current?: number; longest?: number } | undefined
    const ms = mb.settings.studyStreak as { current?: number; longest?: number } | undefined
    if (ls && ms) {
      if ((ms.current ?? 0) < (ls.current ?? 0)) bad.push(`seed=${seed} 连续天数下降`)
      if ((ms.longest ?? 0) < (ls.longest ?? 0)) bad.push(`seed=${seed} 最长连续天数下降`)
    }

    const ld = lb.settings['achievement:discovery'] as { revealed?: string[] } | undefined
    const md = mb.settings['achievement:discovery'] as { revealed?: string[] } | undefined
    if (ld?.revealed) {
      const got = new Set(md?.revealed ?? [])
      for (const clue of ld.revealed) if (!got.has(clue)) bad.push(`seed=${seed} 线索丢失 ${clue}`)
    }
  }

  // 全局键：本机有的一律保留（本机存在即保留）
  for (const key of Object.keys(local.globalSettings)) {
    if (merged.globalSettings[key] === undefined) bad.push(`seed=${seed} 全局键丢失 ${key}`)
  }
  return bad
}

// ---------------------------------------------------------------------------
// 性质 ① ② ③
// ---------------------------------------------------------------------------
describe('planMerge — 200 组随机数据的性质', () => {
  it('① 单调（merged ⊇ local，排序值不降低）', () => {
    const bad: string[] = []
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = mulberry32(seed * 7919)
      const local = genLocalSnapshot(rnd)
      const remote = genRemote(rnd)

      const plan = planMerge(local, remote.bundles, NOW, remote.globals)
      expect(plan.reject).toBeUndefined()
      const merged = applyPlanToSnapshot(local, plan)
      bad.push(...monotonicViolations(local, merged, seed))
    }
    expect(bad).toEqual([])
  })

  it('② 幂等：把合并结果再当本机，导入同一份备份不再产生任何写入', () => {
    const bad: string[] = []
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = mulberry32(seed * 104729)
      const local = genLocalSnapshot(rnd)
      const remote = genRemote(rnd)

      const first = planMerge(local, remote.bundles, NOW, remote.globals)
      const merged = applyPlanToSnapshot(local, first)
      const second = planMerge(merged, remote.bundles, NOW, remote.globals)
      if (!isPlanNoop(second) || !second.stats.noop) {
        bad.push(
          `seed=${seed} 二次导入仍有写入 grid=${first.progressUpserts.length}/${first.mistakeUpserts.length}/${first.sessionUpserts.length}/${first.settingUpserts.length} ` +
            `again=${second.progressUpserts.length}/${second.mistakeUpserts.length}/${second.sessionUpserts.length}/${second.settingUpserts.length}`,
        )
      }
    }
    expect(bad).toEqual([])
  })

  it('③ 自反：把本机当成备份导入，零写入', () => {
    const bad: string[] = []
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = mulberry32(seed * 1299709)
      const local = genLocalSnapshot(rnd)
      const plan = planMerge(local, local.bundles, NOW, {})
      if (!plan.stats.noop || !isPlanNoop(plan)) {
        bad.push(
          `seed=${seed} 自反不成立 ${plan.progressUpserts.length}/${plan.mistakeUpserts.length}/${plan.sessionUpserts.length}/${plan.settingUpserts.length}`,
        )
      }
    }
    expect(bad).toEqual([])
  })

  it('计划是确定性的：同一输入两次算出逐字节相同的结果', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rnd = mulberry32(seed * 31)
      const local = genLocalSnapshot(rnd)
      const remote = genRemote(rnd)
      const a = JSON.stringify(planMerge(local, remote.bundles, NOW, remote.globals))
      const b = JSON.stringify(planMerge(local, remote.bundles, NOW, remote.globals))
      expect(a).toBe(b)
    }
  })
})

// ---------------------------------------------------------------------------
// 契约：档案、上限、全局键
// ---------------------------------------------------------------------------
function profile(id: string, name = id): ProfileMeta {
  return { id, name, createdAt: '2025-12-01T00:00:00.000Z' }
}

function bundle(pid: string, over: Partial<Bundle> = {}): Bundle {
  return {
    profileId: pid,
    name: `备份名字-${pid}`,
    createdAt: '2024-06-01T00:00:00.000Z',
    progress: [],
    mistakes: [],
    examSessions: [],
    settings: {},
    ...over,
  }
}

function snap(
  profiles: ProfileMeta[],
  bundles: Bundle[],
  globalSettings: Record<string, unknown> = {},
): LocalSnapshot {
  return {
    profiles,
    activeProfileId: profiles[0]?.id ?? 'default',
    bundles,
    globalSettings,
  }
}

describe('planMerge — 档案', () => {
  it('空备份 → noop，全 0', () => {
    const plan = planMerge(snap([profile('default')], [], {}), [], NOW, {})
    expect(plan.stats.noop).toBe(true)
    expect(plan.stats.profilesAdded).toBe(0)
    expect(isPlanNoop(plan)).toBe(true)
  })

  it('★ 备份里的新档案进 newProfiles，name/createdAt 取备份', () => {
    const remote = bundle('p_new', {
      progress: [
        {
          profileId: 'p_new',
          packageId: 'pkg-a',
          knowledgePointId: 'kp-1',
          status: '学习中',
          correctCount: 1,
          wrongCount: 0,
          correctStreak: 0,
          wrongStreak: 0,
          lastStudiedAt: '2026-01-01T00:00:00.000Z',
          studySeconds: 10,
        },
      ],
    })
    const plan = planMerge(snap([profile('default')], [], {}), [remote], NOW, {})

    expect(plan.newProfiles).toEqual([
      { id: 'p_new', name: '备份名字-p_new', createdAt: '2024-06-01T00:00:00.000Z' },
    ])
    expect(plan.stats.profilesAdded).toBe(1)
    expect(plan.progressUpserts).toHaveLength(1)
    expect(plan.progressUpserts[0].profileId).toBe('p_new')
    expect(plan.stats.noop).toBe(false)
  })

  it('★ 已有档案的 name 保持本机（家长的改名不被旧备份覆盖）', () => {
    const local = snap([profile('default', '妈妈改的名字')], [bundle('default')], {})
    const remote = bundle('default', { name: '很久以前的名字' })
    const plan = planMerge(local, [remote], NOW, {})
    expect(plan.newProfiles).toHaveLength(0)
    expect(plan.settingUpserts.some((u) => u.key === 'profiles')).toBe(false)
  })

  it('新档案的 createdAt 缺失 → 用调用方传入的 now 兜底（不读时钟）', () => {
    const remote = bundle('p_new', { createdAt: '' })
    const plan = planMerge(snap([profile('default')], [], {}), [remote], NOW, {})
    expect(plan.newProfiles[0].createdAt).toBe(NOW)
  })

  it('★ 超过上限 → 整笔拒绝，其余字段保持空（AC-P2-14）', () => {
    const local = snap(
      [profile('p1'), profile('p2'), profile('p3'), profile('p4')],
      [bundle('p1')],
      {},
    )
    const remote = bundle('p5', {
      progress: [
        {
          profileId: 'p5',
          packageId: 'pkg-a',
          knowledgePointId: 'kp-1',
          status: '未学',
          correctCount: 0,
          wrongCount: 0,
          correctStreak: 0,
          wrongStreak: 0,
          lastStudiedAt: '',
          studySeconds: 0,
        },
      ],
      settings: { attemptedTypes: ['blank'] },
    })

    const plan = planMerge(local, [remote], NOW, {})
    expect(plan.reject?.reason).toBe('profile-limit')
    expect(plan.reject?.detail).toContain('上限')
    expect(plan.newProfiles).toHaveLength(0)
    expect(plan.progressUpserts).toHaveLength(0)
    expect(plan.mistakeUpserts).toHaveLength(0)
    expect(plan.sessionUpserts).toHaveLength(0)
    expect(plan.settingUpserts).toHaveLength(0)
  })

  it('刚好等于上限 → 不拒绝（3 + 1 = 4）', () => {
    const local = snap([profile('p1'), profile('p2'), profile('p3')], [bundle('p1')], {})
    const plan = planMerge(local, [bundle('p4')], NOW, {})
    expect(plan.reject).toBeUndefined()
    expect(plan.newProfiles).toHaveLength(1)
  })

  it('★ profileId 导入时不重写', () => {
    const row: ProgressRecord = {
      profileId: 'p_b',
      packageId: 'pkg-a',
      knowledgePointId: 'kp-1',
      status: '学习中',
      correctCount: 2,
      wrongCount: 0,
      correctStreak: 1,
      wrongStreak: 0,
      lastStudiedAt: '2026-01-01T00:00:00.000Z',
      studySeconds: 30,
    }
    const plan = planMerge(
      snap([profile('p_b')], [bundle('p_b')], {}),
      [bundle('p_b', { progress: [row] })],
      NOW,
      {},
    )
    expect(plan.progressUpserts[0].profileId).toBe('p_b')
  })

  it('★ 行内 pid 与外层不一致 → 按外层归档（外层是权威）', () => {
    const row: ProgressRecord = {
      profileId: 'p_other',
      packageId: 'pkg-a',
      knowledgePointId: 'kp-1',
      status: '学习中',
      correctCount: 2,
      wrongCount: 0,
      correctStreak: 1,
      wrongStreak: 0,
      lastStudiedAt: '2026-01-01T00:00:00.000Z',
      studySeconds: 30,
    }
    const plan = planMerge(
      snap([profile('p_b')], [bundle('p_b')], {}),
      [bundle('p_b', { progress: [row] })],
      NOW,
      {},
    )
    expect(plan.progressUpserts[0].profileId).toBe('p_b')
  })

  it('★ 同一档案的两份备份折叠成一个 key（不产出两条 upsert）', () => {
    const early: ProgressRecord = {
      profileId: 'p_b',
      packageId: 'pkg-a',
      knowledgePointId: 'kp-1',
      status: '学习中',
      correctCount: 1,
      wrongCount: 0,
      correctStreak: 0,
      wrongStreak: 0,
      lastStudiedAt: '2026-01-01T00:00:00.000Z',
      studySeconds: 10,
    }
    const later: ProgressRecord = { ...early, lastStudiedAt: '2026-03-01T00:00:00.000Z', correctCount: 7 }

    const plan = planMerge(
      snap([profile('p_b')], [bundle('p_b')], {}),
      [bundle('p_b', { progress: [early] }), bundle('p_b', { progress: [later] })],
      NOW,
      {},
    )
    expect(plan.progressUpserts).toHaveLength(1)
    expect(plan.progressUpserts[0].correctCount).toBe(7)
  })
})

describe('planMerge — 全局键', () => {
  it('本机缺失的全局键才写入，键原样不加后缀', () => {
    const plan = planMerge(snap([profile('default')], [], {}), [], NOW, { 'fls:theme': 'dark' })
    expect(plan.settingUpserts).toEqual([{ key: 'fls:theme', value: 'dark' }])
    expect(plan.stats.settingsChanged).toBe(1)
  })

  it('本机已存在的全局键保持本机', () => {
    const plan = planMerge(snap([profile('default')], [], { 'fls:theme': 'light' }), [], NOW, {
      'fls:theme': 'dark',
    })
    expect(plan.settingUpserts).toHaveLength(0)
    expect(plan.stats.settingsKeptLocal).toBe(1)
    expect(plan.stats.noop).toBe(true)
  })

  it('★ achievement:customPacks 绝不合并（否则产出"启用了但内容不在本机"的假卡片）', () => {
    const plan = planMerge(snap([profile('default')], [], {}), [], NOW, {
      'achievement:customPacks': [{ id: 'pack-x' }],
    })
    expect(plan.settingUpserts).toHaveLength(0)
  })

  it('★ profiles 键不在这里写（由 applyMergePlan 负责）', () => {
    const plan = planMerge(snap([profile('default')], [], {}), [], NOW, {
      profiles: { activeId: 'x', list: [{ id: 'x', name: 'x', createdAt: '' }] },
    })
    expect(plan.settingUpserts).toHaveLength(0)
  })

  it('分片键的 legacy 无后缀形态不会被当成全局键搬进来', () => {
    const plan = planMerge(snap([profile('default')], [], {}), [], NOW, {
      dailyStats: [{ date: '2026-01-01', questionCount: 99, firstStudyAt: 1, lastStudyAt: 2 }],
    })
    expect(plan.settingUpserts).toHaveLength(0)
  })

  it('显式传 {} → 本次导入不涉及全局键，本机一个都不动', () => {
    // 第 4 参是**必填**（漏传会在编译期炸，而不是在用户机器上静默少导键）。
    // "这次备份没有全局键"必须由调用方显式写 `{}` 表达出来。
    const plan = planMerge(snap([profile('default')], [], { 'fls:theme': 'light' }), [], NOW, {})
    expect(plan.settingUpserts).toHaveLength(0)
    expect(plan.stats.noop).toBe(true)
  })
})

describe('planMerge — 统计口径', () => {
  it('本机更晚时计入 progressKeptLocal，且不产生写入（AC-P2-12 的可见证据）', () => {
    const localRow: ProgressRecord = {
      id: 1,
      profileId: 'default',
      packageId: 'pkg-a',
      knowledgePointId: 'kp-1',
      status: '已掌握',
      correctCount: 5,
      wrongCount: 0,
      correctStreak: 2,
      wrongStreak: 0,
      lastStudiedAt: '2026-05-01T00:00:00.000Z',
      studySeconds: 100,
    }
    const remoteRow: ProgressRecord = { ...localRow, id: undefined, lastStudiedAt: '2026-01-01T00:00:00.000Z' }

    const local = snap([profile('default')], [bundle('default', { progress: [localRow] })], {})
    const plan = planMerge(local, [bundle('default', { progress: [remoteRow] })], NOW, {})

    expect(plan.stats.progressKeptLocal).toBe(1)
    expect(plan.stats.progressAdded).toBe(0)
    expect(plan.progressUpserts).toHaveLength(0)
    expect(plan.stats.noop).toBe(true)
  })

  it('noop 与 isPlanNoop 永远一致', () => {
    const plan = planMerge(snap([profile('default')], [], {}), [], NOW, { 'fls:theme': 'dark' })
    expect(plan.stats.noop).toBe(isPlanNoop(plan))
  })
})
