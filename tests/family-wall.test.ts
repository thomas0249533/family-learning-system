import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * V1.4 · B4 家庭成就墙
 *
 * 两件事必须在这里守住：
 *   1. **AC-P2-8 禁词**：页面文本里不出现任何比较级。这条不能靠人工复核兜 ——
 *      下次改文案的人不会记得 PRD，但会看到这条测试红。
 *   2. **按档案取值不串**：墙要一屏读 4 个孩子，而 `dailyStats` / `attemptedTypes`
 *      都是**单档案缓存**。取错的表现是"老二的数字长在老大身上"，且不报错。
 */
const fake = vi.hoisted(() => {
  type Row = { key: string; value: unknown }
  const rows: Row[] = []
  return {
    rows,
    settings: {
      async get(k: string) {
        return rows.find((r) => r.key === k)
      },
      async put(r: Row) {
        const i = rows.findIndex((x) => x.key === r.key)
        if (i >= 0) rows[i] = { ...r }
        else rows.push({ ...r })
        return r.key
      },
    },
    __reset() {
      rows.length = 0
    },
  }
})

vi.mock('@/db', () => ({ db: fake }))

const { buildContextForProfile, loadProfileWall } = await import('@core/motivation/profileContext')
const { loadDailyStats, readDailyStatsFor, resetDailyStatsCache } = await import(
  '@core/motivation/dailyStats'
)
const { readAttemptedTypesFor, resetAttemptedTypesCache } = await import('@core/motivation/attemptedTypes')
const { loadUnlocked } = await import('@core/motivation/achievements')

function seed(key: string, value: unknown): void {
  fake.rows.push({ key, value })
}

beforeEach(() => {
  fake.__reset()
  resetDailyStatsCache()
  resetAttemptedTypesCache()
})

describe('AC-P2-8 — 家庭墙不得出现比较级', () => {
  const FORBIDDEN = ['排名', '第 1 名', '第一名', '第一', '领先', '落后', '超过', '最高分', '完成率', '总分']

  const files = ['src/views/FamilyWall.vue', 'src/components/AchievementWallColumn.vue']

  /**
   * 只取 `<template>` 里的**页面文本**，剥掉注释、`<script>`、`<style>`。
   *
   * 为什么不扫全文：这两个文件的注释里**刻意**写着"不显示最高/领先/落后""不做总分"——
   * 那几句是唯一能拦住下一个人加排行榜的东西（"为什么不能"比"不能"有用）。
   * 扫全文等于逼着把这些理由删掉，守卫就只剩一条没有解释的规矩。
   * 而 AC-P2-8 要求的是**页面文本**不出现比较级，注释不是页面文本；
   * 真有人把注释里的措辞复制进模板，这条测试照样会红。
   */
  function templateText(file: string): string {
    const src = readFileSync(resolve(process.cwd(), file), 'utf8')
    const open = src.indexOf('<template>')
    const close = src.indexOf('</template>')
    const body = open >= 0 && close > open ? src.slice(open, close) : ''
    return body.replace(/<!--[\s\S]*?-->/g, '')
  }

  it('页面文本里不含禁词', () => {
    for (const file of files) {
      const text = templateText(file)
      // 模板取不到就等于"扫了个空字符串"——那种绿是假的，必须显式挡掉
      expect(text.length, `${file} 没取到 template`).toBeGreaterThan(200)
      for (const word of FORBIDDEN) {
        expect(text, `${file} 的页面文本里出现了禁词「${word}」`).not.toContain(word)
      }
    }
  })

  it('反向：判据本身有效（别让上面的循环空跑成"永远绿"）', () => {
    expect(FORBIDDEN.length).toBeGreaterThanOrEqual(8)
    expect('小明的排名更高').toContain(FORBIDDEN[0])
    // 剥注释的逻辑也要能真正剥掉东西：带注释的样本剥完必须变短
    const withComment = '<template><!-- 排名 --><p>hi</p></template>'
    const stripped = withComment.replace(/<!--[\s\S]*?-->/g, '')
    expect(stripped).not.toContain('排名')
    expect(stripped).toContain('hi')
  })
})

describe('buildContextForProfile — 只读目标档案，不碰单档案缓存', () => {
  const STAT_A = { date: '2026-10-01', questionCount: 5, firstStudyAt: '2026-10-01T09:00:00+08:00', lastStudyAt: '2026-10-01T09:30:00+08:00' }
  const STAT_B = { date: '2026-10-02', questionCount: 9, firstStudyAt: '2026-10-02T09:00:00+08:00', lastStudyAt: '2026-10-02T09:30:00+08:00' }

  it('打卡 / 每日统计 / 题型 都按 pid 取，且进度错题按行过滤', async () => {
    seed('studyStreak:p1', { current: 3, longest: 9, lastDate: '2026-10-01' })
    seed('studyStreak:p2', { current: 1, longest: 2, lastDate: '2026-10-02' })
    seed('dailyStats:p1', [STAT_A])
    seed('dailyStats:p2', [STAT_B])
    seed('attemptedTypes:p1', ['single'])
    seed('attemptedTypes:p2', ['single', 'blank'])

    const progress = [
      { profileId: 'p1', packageId: 'pkg', knowledgePointId: 'k1' },
      { profileId: 'p2', packageId: 'pkg', knowledgePointId: 'k1' },
    ] as never[]
    const mistakes = [
      { profileId: 'p1', packageId: 'pkg', exerciseId: 'e1' },
      { profileId: 'p2', packageId: 'pkg', exerciseId: 'e2' },
      { profileId: 'p2', packageId: 'pkg', exerciseId: 'e3' },
    ] as never[]

    const a = await buildContextForProfile('p1', { packages: [], progress, mistakes })
    const b = await buildContextForProfile('p2', { packages: [], progress, mistakes })

    expect(a.streak).toMatchObject({ current: 3, longest: 9 })
    expect(b.streak).toMatchObject({ current: 1, longest: 2 })
    expect(a.dailyStats).toEqual([STAT_A])
    expect(b.dailyStats).toEqual([STAT_B])
    expect(a.attemptedTypes).toEqual(['single'])
    expect(b.attemptedTypes).toEqual(['single', 'blank'])
    expect(a.progress).toHaveLength(1)
    expect(b.progress).toHaveLength(1)
    expect(a.mistakes).toHaveLength(1)
    expect(b.mistakes).toHaveLength(2)
  })

  it('★ 读别的档案不会污染当前档案的缓存（热路径可能因此写错档案）', async () => {
    seed('dailyStats:default', [STAT_A])
    seed('dailyStats:p2', [STAT_B])

    // 先让热路径缓存住当前档案
    const before = await loadDailyStats()
    expect(before).toEqual([STAT_A])

    // 墙去读 p2
    const ctx = await buildContextForProfile('p2', { packages: [], progress: [], mistakes: [] })
    expect(ctx.dailyStats).toEqual([STAT_B])

    // 缓存必须还是 default 的 —— 否则随后的 bumpDailyStats 会把题量记到 p2 头上
    expect(await loadDailyStats()).toEqual([STAT_A])
  })

  it('某个键不存在时给空值，而不是抛', async () => {
    const ctx = await buildContextForProfile('nobody', { packages: [], progress: [], mistakes: [] })
    expect(ctx.streak).toMatchObject({ current: 0 })
    expect(ctx.dailyStats).toEqual([])
    expect(ctx.attemptedTypes).toEqual([])
    expect(ctx.progress).toEqual([])
    expect(ctx.mistakes).toEqual([])
  })
})

describe('readDailyStatsFor / readAttemptedTypesFor — 脏数据不抛', () => {
  it('非数组 → 空数组', async () => {
    seed('dailyStats:x', { nope: 1 })
    seed('attemptedTypes:x', 'single')
    expect(await readDailyStatsFor('x')).toEqual([])
    expect(await readAttemptedTypesFor('x')).toEqual([])
  })

  it('数组里逐项丢弃非法项（缺 date/questionCount、null、字符串）', async () => {
    seed('dailyStats:y', [
      { date: '2026-10-01', questionCount: 3 },
      null,
      'oops',
      { date: '2026-10-02' },
      { questionCount: 4 },
    ])
    seed('attemptedTypes:y', ['single', 42, null, 'blank'])
    expect(await readDailyStatsFor('y')).toEqual([{ date: '2026-10-01', questionCount: 3 }])
    expect(await readAttemptedTypesFor('y')).toEqual(['single', 'blank'])
  })
})

describe('loadProfileWall — 三份数据必然同源', () => {
  it('ctx / records / extraDefs 都来自同一个 pid', async () => {
    seed('studyStreak:p1', { current: 2, longest: 2, lastDate: '2026-10-01' })
    seed('achievements:p1', [{ id: 'first-step', unlockedAt: '2026-10-01' }])
    seed('achievements:p2', [{ id: 'ten-kp', unlockedAt: '2026-10-02' }])

    const p1 = await loadProfileWall('p1', { packages: [], progress: [], mistakes: [] }, async (pid) => [
      { id: `custom::${pid}`, icon: '🧩', title: pid, desc: '', category: 'B', check: () => false },
    ])

    expect(p1.profileId).toBe('p1')
    expect(p1.records.map((r) => r.id)).toEqual(['first-step'])
    expect(p1.extraDefs.map((d) => d.id)).toEqual(['custom::p1'])
    expect(p1.ctx.streak.current).toBe(2)
  })

  it('loadUnlocked(pid) 不会读到当前档案的记录', async () => {
    seed('achievements:default', [{ id: 'first-step', unlockedAt: '' }])
    seed('achievements:p2', [])
    expect(await loadUnlocked('p2')).toEqual([])
    expect((await loadUnlocked('default')).map((r) => r.id)).toEqual(['first-step'])
  })
})
