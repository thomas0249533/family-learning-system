/**
 * 自定义成就 · 规则求值（V1.4 · B3 / PRD `P0-1`、设计 `§8.4`）
 *
 * ## 为什么这里只有"有限 switch"，没有表达式引擎
 * 家长导入的是一份 JSON 文件 —— 它是**不可信输入**。任何 `eval` / `new Function` /
 * 自研表达式解析器都等于把"能跑代码的入口"塞进孩子每天打开的页面里，
 * 收益（"能写 `masteredKp > 10 && streak > 3`"）远小于风险。
 * 所以求值只有两个分支，指标是一个**枚举白名单**（`CounterMetric`）。
 * 真要组合条件，等 V1.5 用 `schemaVersion: 2` 配沙箱重来（见 `customPackTypes` 的 D2 裁决）。
 *
 * ## 为什么指标口径要和 `achievementProgress.ts` 一个字一个字对齐
 * 内置 28 枚的进度条由 `achievementProgress.ts` 算，自定义卡片的进度条由本文件算。
 * 如果两边口径不同（比如一边算「已掌握」行数、另一边算「有作答」行数），
 * 家长会看到「自定义卡说掌握 10 个，内置卡说掌握 8 个」—— 同一个孩子的同一份数据，
 * 两个数字，信任当场归零。所以这里的四个指标是照着 `achievementProgress.ts` 的
 * 统计基元（`masteredKp` / `totalKp` 系列）抄的口径，注释里逐条标了出处。
 *
 * ## 为什么 `manual-check` 的求值恒为 0
 * 「家长手工勾选」这个事实**不在任何一张数据库表里** —— 它在 `customChecks:<pid>` 里，
 * 由视图层读出来、构造成一个 `check` 传给它自己的渲染分支。
 * 本文件是纯函数：不读库、不读 store、不读时钟。所以它对 `manual-check` 的职责只有一个：
 * **不参与计数**（返回 0），并把度量定成 0/1 的 `binary`，
 * 让「勾了就算」的卡也能长出一条 0/1 进度条（与 PRD 草案示例一致）。
 *
 * 纯函数约束（与 `achievementProgress.ts` 同一套）：
 *   1. 不读 db / store / `Date.now()`；时间只能来自 `ctx`。
 *   2. `current` 恒 `clamp(floor(raw), 0, target)` —— 永不出现 `11/10`。
 *   3. 不缓存历史最大值（`Math.max(current, lastSeen)` 这类写法一律禁止）。
 */
import type { AchievementContext } from './achievements'
import type { Measure } from './achievementProgress'
import { METRIC_META, type CounterMetric, type CustomRule } from './customPackTypes'

/**
 * 穷尽检查的载体。
 *
 * `void v` 而不是函数体留空：本仓库开着 `noUnusedLocals`，参数不用会报错；
 * 而 `v: never` 的作用是 —— 将来给 `CustomRule` 加第三种 `kind` 时，
 * 求值函数的 `default` 分支拿到的不再是 `never`，**编译期就报错**，
 * 逼着实现者同时写求值分支，而不是运行期静默返回 0。
 */
function assertNeverKind(v: never): void {
  // 运行期到不了这里；真到了（脏数据），下面的 return 0 保证不炸页面。
  void v
}

/**
 * 单个指标的原始值（未 floor / 未 clamp）。
 *
 * 口径出处逐条标注，与 `achievementProgress.ts` 的统计基元**必须**一致：
 * - `masteredKp`    ← `masteredKp(ctx)`：`progress` 里 `status === '已掌握'` 的行数
 * - `totalAttempts` ← 对应 `maxAnswerCount` 的单行口径 `correctCount + wrongCount`，
 *                     这里按 PRD「累计作答次数」求和（所有行相加）
 * - `studyDays`     ← `dailyStats` 里 `questionCount > 0` 的天数（"有作答才算学习日"）
 * - `streak`        ← `bestDayStreak(ctx)`：`Math.max(longest, current)`，
 *                     **不调用** `streak.ts` 的 `bestStreak()`（它内部默认 `new Date()`，
 *                     会把本模块变成非纯函数；`touchStudyDay` 保证两者在合法数据上恒等）
 *
 * 缺字段一律当 0（`?? 0`）：老数据 / 半迁移态的 progress 行没有 `correctCount` 是常态，
 * 不能因此算出 `NaN`（`NaN` 会让进度条渲染成空白）。
 */
function metricValue(metric: CounterMetric, ctx: AchievementContext): number {
  switch (metric) {
    case 'masteredKp':
      return ctx.progress.filter((p) => p.status === '已掌握').length

    case 'totalAttempts':
      return ctx.progress.reduce(
        (sum, p) => sum + (p.correctCount ?? 0) + (p.wrongCount ?? 0),
        0,
      )

    case 'studyDays':
      return (ctx.dailyStats ?? []).filter((s) => (s.questionCount ?? 0) > 0).length

    case 'streak':
      return Math.max(ctx.streak?.current ?? 0, ctx.streak?.longest ?? 0)

    default: {
      assertNeverKind(metric)
      return 0
    }
  }
}

/**
 * 规则求值：返回**原始计数值**（不做 floor / clamp，clamp 是 `ruleMeasure` 的事）。
 *
 * 为什么把 floor/clamp 留到 `ruleMeasure`：`evaluateRule` 的语义是"当下数据算出来的值"，
 * 调用方（视图层、测试、将来可能的导出功能）需要看到真实值；
 * 而"显示成 7/10 还是 10/10"是**展示决策**，属于 `Measure`。
 *
 * `manual-check` 恒返回 0 —— 详见文件头「为什么 manual-check 的求值恒为 0」。
 * 它是否达成由视图层用 `customChecks` 的勾选态决定，本函数只负责"不参与计数"。
 */
export function evaluateRule(rule: CustomRule, ctx: AchievementContext): number {
  switch (rule.kind) {
    case 'manual-check':
      return 0

    case 'counter':
      return metricValue(rule.metric, ctx)

    default: {
      // 未知 kind（只可能来自绕过校验的脏数据）：不猜、不抛错，按 0 处理。
      // 页面渲染一条 0/N 的进度条，好过整页白屏。
      assertNeverKind(rule)
      return 0
    }
  }
}

/**
 * 把 `counter` 的 `target` 归一成「≥1 的整数」。
 *
 * 校验器（`parseCustomPack`）保证入库的 `target` 一定是 ≥1 的整数，
 * 但 `evaluateRule` / `ruleMeasure` 是导出函数，可能被直接调用（测试、视图传了脏值）。
 * `target = 0` 会产生 `0/0` 与除零，`target = NaN` 会让进度条空白，都必须兜住。
 */
function safeTarget(raw: number): number {
  if (!Number.isFinite(raw)) return 1
  const n = Math.floor(raw)
  return n >= 1 ? n : 1
}

/** 量词覆盖的取值口径：`undefined` 或空白串都视为"没覆盖"，回落到指标默认值 */
function pickText(override: string | undefined, fallback: string): string {
  return typeof override === 'string' && override.trim() !== '' ? override : fallback
}

export interface MeasureOverride {
  /** 量词覆盖（家长在包里写的 `unit`） */
  unit?: string
  /** 名词覆盖（家长在包里写的 `noun`） */
  noun?: string
}

/**
 * 规则 → 度量工厂。返回的函数是**纯函数**，同一个工厂可以被不同 `ctx` 反复调用
 * （视图层每次刷新数据都会重建 `ctx`，工厂本身不捕获任何数据状态）。
 *
 * `manual-check` → `{ current: 0, target: 1, kind: 'binary' }`：
 * "勾了就算"的卡显示一条 0/1 进度条（PRD 草案示例），勾选后由视图层把 `current` 顶到 1
 * —— 也就是说本函数给出的是**未勾选态**，`target` 恒为 1，勾选态由视图层替换。
 *
 * `counter` → `current = clamp(floor(evaluateRule(...)), 0, target)`，
 * 与 `achievementProgress.counter()` **同口径：floor + clamp**（那是个未导出的私有构造函数，
 * 所以这里按同样规则重写一遍，而不是去改它的可见性）。
 * `kind` 在 `target === 1` 时降级为 `binary` —— 与 `counter()` 完全一致，
 * 这样单次事件型自定义卡（"读一本课外书"×1）的文案也是「完成一次即可解锁」。
 */
export function ruleMeasure(
  rule: CustomRule,
  override?: MeasureOverride,
): (ctx: AchievementContext) => Measure {
  if (rule.kind === 'manual-check') {
    // 手工勾选：没有可累计的指标，量词/名词默认留空（progressText 对 target=1 不出量词）
    const unit = pickText(override?.unit, '')
    const noun = pickText(override?.noun, '')
    return () => ({ current: 0, target: 1, unit, noun, kind: 'binary' })
  }

  if (rule.kind === 'counter') {
    const target = safeTarget(rule.target)
    // 未知 metric（脏数据）时 METRIC_META 取不到，回落到空串而不是抛错
    const meta = METRIC_META[rule.metric] ?? { unit: '', noun: '' }
    const unit = pickText(override?.unit, meta.unit)
    const noun = pickText(override?.noun, meta.noun)

    return (ctx: AchievementContext) => {
      const raw = evaluateRule(rule, ctx)
      // NaN / Infinity 兜底：脏数据不该让进度条渲染成空白
      const safe = Number.isFinite(raw) ? raw : 0
      const current = Math.max(0, Math.min(target, Math.floor(safe)))
      return { current, target, unit, noun, kind: target === 1 ? 'binary' : 'counter' }
    }
  }

  // 未知 kind（只可能来自绕过校验的脏数据）：给一条恒 0 的 binary 度量，绝不抛错。
  assertNeverKind(rule)
  const unit = pickText(override?.unit, '')
  const noun = pickText(override?.noun, '')
  return () => ({ current: 0, target: 1, unit, noun, kind: 'binary' })
}
