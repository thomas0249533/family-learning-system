import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * 日期口径守卫（V1.6 · Stage C 补修）
 * ---------------------------------------------------------------------
 * 本仓的**日键**一律是本地日历日（`localDayKey`：getFullYear / getMonth / getDate）。
 * 反面写法是 `x.toISOString().slice(0, 10)`：它得到的是 **UTC 日期**。东八区下
 * 本地零点转 UTC 会退到前一天，于是"今天学过"永远对不上"今天的键"。
 *
 * 这个坑在本仓踩过不止一次（打卡 / 成就 / 复习都被记过账）。Stage C 又发现三处
 * 同源缺陷，全部是同一个写法：
 *   1. `Parent.vue` 连续天数 —— 两边都按 UTC 算、彼此差一天，几乎恒为 0；
 *   2. `Parent.vue` 近 7 天柱状图 —— x 轴标签是本地星期、键是 UTC 日，整图错位一天；
 *   3. `reportGenerator` 近 7 天 —— 同 2；
 *   另有 `Review.vue` 的分组键、`Report.vue` 的导出文件名。
 *
 * 所以用一条静态扫描把它焊死：源码里不许再出现 `toISOString().slice(0, 10)`。
 * 注意**不禁止** `toISOString()` 本身 —— 序列化时间戳（`exportedAt` / FSRS 的
 * `due`）是它的正当用法，只要不截成"日键"就与本地口径无关。
 *
 * 这条测试的价值不在"现在绿"，而在"下次有人手快时立刻红"。
 */

const SRC = resolve(process.cwd(), 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|vue)$/.test(name)) out.push(full)
  }
  return out
}

/** UTCD 日键的三种常见写法，任何一种都算违规 */
const UTC_DAY_KEY = [
  /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/,
  /toISOString\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/,
  /toISOString\(\)\s*\.\s*substring\(\s*0\s*,\s*10\s*\)/,
]

describe('日期口径：日键一律本地，禁止拿 UTC 截断当日键', () => {
  const files = walk(SRC)

  it('扫描到了源码（防 glob 写错导致空扫描恒绿）', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('src/ 下不存在 UTC 日键写法', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (UTC_DAY_KEY.some((re) => re.test(src))) {
        offenders.push(f.slice(SRC.length + 1))
      }
    }
    expect(
      offenders,
      `这些文件拿 UTC 日期当本地日键（改用 localDayKey）：${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('日键工具 localDayKey 用本地 getter 实现', () => {
    const streak = readFileSync(join(SRC, 'core/motivation/streak.ts'), 'utf8')
    expect(streak).toContain('export function localDayKey')
    // 一旦被"优化"成 toISOString，上面那条扫描会红；这里再钉住实现用的是本地 getter
    expect(streak).toMatch(
      /export function localDayKey\(d: Date = new Date\(\)\): string \{\s*const y = d\.getFullYear\(\)/,
    )
  })
})

describe('东八区下的 UTC 日键会退一天（这是上面那条禁令的实证）', () => {
  // 动态 import，避免与静态扫描的加载顺序纠缠
  const localDayKeyOf = async (d: Date): Promise<string> => {
    const { localDayKey } = await import('@core/motivation/streak')
    return localDayKey(d)
  }

  it('本地 00:30 学习：本地日键是今天，UTC 日键是昨天', async () => {
    const earlyMorning = new Date(2026, 9, 22, 0, 30) // 本地 2026-10-22 00:30
    expect(await localDayKeyOf(earlyMorning)).toBe('2026-10-22')
    // UTC+8 的 00:30 → 前一天 16:30Z，这就是"差一天"的来源
    expect(earlyMorning.toISOString().slice(0, 10)).toBe('2026-10-21')
  })

  it('本地 20:00 学习：两者同日的假象，正说明为什么必须统一口径', async () => {
    const evening = new Date(2026, 9, 22, 20, 0) // 本地 2026-10-22 20:00 → 12:00Z
    expect(await localDayKeyOf(evening)).toBe('2026-10-22')
    expect(evening.toISOString().slice(0, 10)).toBe('2026-10-22')
  })

  it('本地零点转 UTC 会退一天（旧实现的第二处错误）', async () => {
    const localMidnight = new Date(2026, 9, 22, 0, 0)
    localMidnight.setHours(0, 0, 0, 0)
    expect(await localDayKeyOf(localMidnight)).toBe('2026-10-22')
    expect(localMidnight.toISOString().slice(0, 10)).toBe('2026-10-21')
  })
})

describe('家长端连续天数只保留一个真相（streak）', () => {
  it('Parent.vue 走 effectiveCurrent(streakState)，不再从 progress 日期集合二次推导', () => {
    const src = readFileSync(join(SRC, 'views/Parent.vue'), 'utf8')
    expect(src).toContain('effectiveCurrent(streakState.value)')
    // 旧实现的特征写法：把 lastStudiedAt 截成 10 位当"天"
    expect(src).not.toMatch(/lastStudiedAt[^\n]*\.slice\(\s*0\s*,\s*10\s*\)/)
  })
})
