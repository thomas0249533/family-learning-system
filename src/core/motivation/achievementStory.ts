/**
 * 成就故事卡 · **纯展示逻辑**（V1.4 · B6）
 *
 * PRD §P2「重复纪念印记 / 故事卡」：
 * > 故事卡：把"解锁时间 + 证据 + 关联学习记录"拼成一张可保存的卡片。
 *
 * ## 三段话，三种时间
 * 这是本模块唯一需要想清楚的事 —— 三者口径不同，混在一起就会变成谎言：
 *
 * | 段落 | 时间 | 来源 | 会不会变 |
 * |---|---|---|---|
 * | 解锁 | **当时**（固化） | `UnlockedRecord.unlockedAt` | 永不 |
 * | 证据 | **当时**（固化） | `UnlockedRecord.evidence` | 永不 |
 * | 现在的记录 | **此刻** | 实时 `AchievementContext` | 每次都在变 |
 *
 * 所以界面与图片上第三段的标题写的是**「现在的记录」**，不是"达成时的记录"。
 * 我们**无法**重建"达成那一刻"的其他数据（当时没存），事后拿今天的数字去冒充，
 * 就是给家长看一张假的历史照片。证据只能靠 `evidence` 那一句 ——
 * 它是解锁瞬间固化的，且旧记录没有就**不显示该段**（绝不补算，A-06 铁律）。
 *
 * ## 为什么把标签当参数传进来
 * `tierLabel` / `categoryLabel` 由调用方从 `TIER_META` / `CATEGORY_META` 取。
 * 本文件因此**不 import** `achievementMeta`（它运行时 import `achievements` → `@/db`），
 * 单测才能在 node 环境里直接跑纯函数、不需要 Dexie。与 `achievementDetail.detailOf` 同构。
 *
 * ## 关联记录按「类目」给，只对 8 枚做特例
 * 28 枚各写一套"关联什么"会退化成 28 条硬编码文案，改一处口径要核 28 遍。
 * 所以默认按 M/G/B/E 四个类目给 2 行（这是**类目语义**的自然延伸：
 * 精熟看知识点、成长看错题、行为看天数与题量、探索看包与学科）；
 * 只有"关联到**某一个**具体对象"才说得通的 8 枚（单 KP 连对/累计、时段彩蛋、
 * 走通过的知识点）才走特例表。特例**替换**类目默认，不叠加 —— 一张卡上
 * 两行记录刚好，四行就成了报表。
 *
 * ## 拿不到就不写
 * `kpTitleOf` 查不到标题、`packages` 里没有该包、旧数据没有 `dailyStats`……
 * 任何一条都只是**少一行**，绝不用 id 兜底。故事卡是给孩子看的，
 * `math-4-up-rjb-kp-12` 这种东西出现在卡片上比空白更糟。
 */
import type { ProgressRecord } from '@/db'
import type { AchievementContext } from './achievements'
import type { AchievementItem } from './achievementMeta'
import type { DailyStat } from './dailyStats'
import { SUBJECT_LABEL } from './achievementProgress'

/** 一条"标签 : 值"的关联记录 */
export interface RelatedRecord {
  label: string
  value: string
}

export interface StoryOpts {
  /** 档案显示名（页脚与页眉都用它，不用真名以外的任何信息） */
  profileName: string
  /** 生成日期 YYYY-MM-DD。**注入而非读系统时间** —— 否则本函数不是纯函数，单测没法断言 */
  today: string
  /** `TIER_META[tier].label` */
  tierLabel: string
  /** `CATEGORY_META[category].label` */
  categoryLabel: string
  /**
   * 知识点标题解析（包 id + 知识点 id → 标题）。
   * 查不到返回空串；缺失时故事卡仍然成立，只是少一行。
   */
  kpTitleOf?: (packageId: string, kpId: string) => string
}

export interface AchievementStory {
  /** 成就 id（文件名用） */
  id: string
  /** 是否可以保存成图片；剪影与未解锁恒 false */
  canSave: boolean
  /** 不可保存时的一句人话（也便于单测断言"为什么不行"） */
  reason: string
  title: string
  icon: string
  tierLabel: string
  categoryLabel: string
  /** 解锁日期 YYYY-MM-DD；旧数据可能为 '' */
  unlockedAt: string
  /** 重复达成次数（≥2 时画「第 N 次」印记） */
  repeatCount: number
  /** 解锁瞬间固化的证据；空串 = 旧记录没存 → 该段不渲染 */
  evidence: string
  /** 现在的记录（0~2 条） */
  related: RelatedRecord[]
  /** 档案显示名（页眉/页脚） */
  profileName: string
  /** 生成日期 YYYY-MM-DD（页眉） */
  today: string
}

// ==================== 小工具（全部纯函数，不读 db / 不读时钟）====================

const MASTERED = '已掌握'
const TERM_LABEL: Record<string, string> = { up: '上册', down: '下册' }

/** ISO 时间戳 → 日期部分。空值/脏值一律空串，让调用方"少一行"而不是显示 `undefined` */
function dayOf(iso: string | null | undefined): string {
  if (typeof iso !== 'string' || iso.length < 10) return ''
  return iso.slice(0, 10)
}

/** epoch ms → `HH:mm`（本地时区；故事卡给孩子看，不出现时区缩写） */
function clockOf(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 知识点标题：查不到就空串（**绝不用 id 兜底**，见文件头） */
function kpName(packageId: string, kpId: string, opts: StoryOpts): string {
  if (!kpId) return ''
  return opts.kpTitleOf?.(packageId, kpId) ?? ''
}

function subjectLabelOf(packageId: string, ctx: AchievementContext): string {
  const meta = (ctx.packages ?? []).find((p) => p.packageId === packageId)
  if (!meta) return ''
  return SUBJECT_LABEL[meta.subject] ?? meta.subject
}

/** 取 `<` 比较字段 `>` 最大的那条（同值保留先出现的 → 结果稳定可测） */
function maxBy<T>(rows: T[], key: (row: T) => string): T | undefined {
  let best: T | undefined
  for (const row of rows) {
    if (best === undefined || key(row).localeCompare(key(best)) > 0) best = row
  }
  return best
}

/** 过滤掉值为空的记录（"拿不到就不写"） */
function compact(rows: (RelatedRecord | null)[]): RelatedRecord[] {
  return rows.filter((r): r is RelatedRecord => r !== null && r.value !== '')
}

const line = (label: string, value: string): RelatedRecord | null =>
  value === '' ? null : { label, value }

// ==================== 类目默认（M / G / B / E）====================

function baseM(ctx: AchievementContext, opts: StoryOpts): RelatedRecord[] {
  const rows = (ctx.progress ?? []).filter((p) => p.status === MASTERED)
  const latest = maxBy(rows, (p) => dayOf(p.lastStudiedAt) || '')
  const latestName = latest ? kpName(latest.packageId, latest.knowledgePointId, opts) : ''
  const subjects = new Set(
    rows.map((p) => subjectLabelOf(p.packageId, ctx)).filter((s) => s !== ''),
  )
  return compact([
    line('最近掌握', latestName === '' ? '' : `${latestName} · ${dayOf(latest?.lastStudiedAt)}`),
    line(
      '掌握概况',
      rows.length === 0
        ? ''
        : `已掌握 ${rows.length} 个知识点 · 覆盖 ${subjects.size} 个学科`,
    ),
  ])
}

function baseG(ctx: AchievementContext, opts: StoryOpts): RelatedRecord[] {
  const mistakes = ctx.mistakes ?? []
  const cleared = mistakes.filter((m) => m.mastered)
  const latest = maxBy(cleared, (m) => dayOf(m.wrongAt))
  const latestName = latest
    ? kpName(latest.packageId, latest.knowledgePointIds?.[0] ?? '', opts)
    : ''
  const reviewCorrect = mistakes.reduce((sum, m) => sum + (m.reviewCorrectCount ?? 0), 0)
  return compact([
    line('最近攻克', latestName === '' ? '' : `${latestName} · ${dayOf(latest?.wrongAt)}`),
    line(
      '错题记录',
      cleared.length === 0 ? '' : `已攻克 ${cleared.length} 道 · 复习答对 ${reviewCorrect} 次`,
    ),
  ])
}

function baseB(ctx: AchievementContext): RelatedRecord[] {
  const streak = ctx.streak
  const longest = Math.max(streak?.longest ?? 0, streak?.current ?? 0)
  // 单日最多：按题量取最大（同题量保留先出现的，结果稳定）
  let best: DailyStat | undefined
  for (const d of (ctx.dailyStats ?? []) as DailyStat[]) {
    if (best === undefined || (d.questionCount ?? 0) > (best.questionCount ?? 0)) best = d
  }
  return compact([
    line(
      '连续天数',
      longest > 0 ? `最长 ${longest} 天 · 当前 ${streak?.current ?? 0} 天` : '',
    ),
    line(
      '单日最多',
      best && (best.questionCount ?? 0) > 0
        ? `${best.date} 完成 ${best.questionCount} 题`
        : '',
    ),
  ])
}

function baseE(ctx: AchievementContext): RelatedRecord[] {
  const studied = new Set((ctx.progress ?? []).map((p) => p.packageId))
  const combos: string[] = []
  for (const pkg of ctx.packages ?? []) {
    if (!studied.has(pkg.packageId)) continue
    const subject = SUBJECT_LABEL[pkg.subject] ?? pkg.subject
    const term = TERM_LABEL[pkg.term] ?? pkg.term
    const combo = `${subject}·${term}`
    if (!combos.includes(combo)) combos.push(combo)
  }
  return compact([
    line('学过的学习包', studied.size === 0 ? '' : `${studied.size} 个`),
    line('学科与学期', combos.join('，')),
  ])
}

const CATEGORY_BASE: Record<string, (ctx: AchievementContext, opts: StoryOpts) => RelatedRecord[]> = {
  M: baseM,
  G: baseG,
  B: baseB,
  E: baseE,
}

// ==================== 8 枚特例（关联到"某一个具体对象"才说得通）====================

/** 单知识点连对 / 累计题量：命名那个知识点 */
function singleKp(
  rows: ProgressRecord[],
  amount: (p: ProgressRecord) => number,
  unit: string,
  opts: StoryOpts,
): RelatedRecord[] {
  const top = rows.reduce<ProgressRecord | undefined>(
    (best, p) => (best === undefined || amount(p) > amount(best) ? p : best),
    undefined,
  )
  if (!top) return []
  const name = kpName(top.packageId, top.knowledgePointId, opts)
  // 连对/累计次数为 0 时这句话没有意义（"某知识点连对 0 题"）
  if (name === '' || amount(top) <= 0) return []
  return [{ label: '关联知识点', value: `${name} · ${unit} ${amount(top)}` }]
}

const SPECIAL: Record<
  string,
  (ctx: AchievementContext, opts: StoryOpts) => RelatedRecord[]
> = {
  // 这两枚都是"单个知识点连续答对 N 题"，关联对象就是那个知识点
  'perfect-kp': (ctx, opts) =>
    singleKp(ctx.progress ?? [], (p) => p.correctStreak ?? 0, '连对', opts),
  'streak-master': (ctx, opts) =>
    singleKp(ctx.progress ?? [], (p) => p.correctStreak ?? 0, '连对', opts),
  // 耐心是"同一知识点累计答题次数"，答错也算 → 连对数是错的量词
  patience: (ctx, opts) =>
    singleKp(
      ctx.progress ?? [],
      (p) => (p.correctCount ?? 0) + (p.wrongCount ?? 0),
      '累计答对加答错共',
      opts,
    ),

  // 两枚时段彩蛋：把"最早 / 最晚那一次"具体到日期与时刻
  'early-bird': (ctx) => {
    const rows = (ctx.dailyStats ?? []).filter((d) => (d.firstStudyAt ?? 0) > 0)
    if (rows.length === 0) return []
    const first = rows.reduce((a, b) => ((a.firstStudyAt ?? 0) <= (b.firstStudyAt ?? 0) ? a : b))
    const clock = clockOf(first.firstStudyAt)
    return clock === ''
      ? []
      : [{ label: '最早的一天', value: `${first.date} ${clock} 开始学习` }]
  },
  'night-owl': (ctx) => {
    const rows = (ctx.dailyStats ?? []).filter((d) => (d.lastStudyAt ?? 0) > 0)
    if (rows.length === 0) return []
    const last = rows.reduce((a, b) => ((a.lastStudyAt ?? 0) >= (b.lastStudyAt ?? 0) ? a : b))
    const clock = clockOf(last.lastStudyAt)
    return clock === '' ? [] : [{ label: '最晚的一天', value: `${last.date} ${clock} 仍在学习` }]
  },

  // 卷土重来：那枚"错够 3 次还最终学会了"的知识点 —— 这是整枚成就的全部意义
  comeback: (ctx, opts) => {
    const hit = (ctx.progress ?? []).find(
      (p) => p.status === MASTERED && (p.wrongCount ?? 0) >= 3,
    )
    const name = hit ? kpName(hit.packageId, hit.knowledgePointId, opts) : ''
    return name === '' ? [] : [{ label: '走通过的知识点', value: `${name} · 错过 ${hit?.wrongCount} 次` }]
  },

  // 三科通才：分科说清"各多少"，比一句"覆盖 3 个学科"具体
  'subject-master-3': (ctx) => {
    const counted = new Map<string, number>()
    for (const p of ctx.progress ?? []) {
      if (p.status !== MASTERED) continue
      const sub = subjectLabelOf(p.packageId, ctx)
      if (sub === '') continue
      counted.set(sub, (counted.get(sub) ?? 0) + 1)
    }
    if (counted.size === 0) return []
    const parts = [...counted.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([sub, n]) => `${sub} ${n} 个`)
    return [{ label: '分科掌握', value: parts.join(' · ') }]
  },
}

// ==================== 组装 ====================

function empty(reason: string): AchievementStory {
  // 剪影/未解锁：**连标题都不给**，与 `detailOf` 的 closed() 同构（AC-14 不泄底）
  return {
    id: '',
    canSave: false,
    reason,
    title: '',
    icon: '',
    tierLabel: '',
    categoryLabel: '',
    unlockedAt: '',
    repeatCount: 1,
    evidence: '',
    related: [],
    profileName: '',
    today: '',
  }
}

/**
 * 组装一枚成就的故事卡。
 *
 * @param item 图鉴视图项（`buildAchievementItems` 的产物）
 * @param ctx  **实时**上下文（与结算同一份 `buildContext`，避免两处口径不同）
 * @param opts 标签 / 档案名 / 生成日期 / 知识点标题解析
 */
export function storyOf(
  item: AchievementItem,
  ctx: AchievementContext,
  opts: StoryOpts,
): AchievementStory {
  // 剪影：命中即短路，后面的字段一个都不碰
  if (item.silhouetted) return empty('未解锁的隐藏成就不能生成故事卡')
  if (!item.earned) return empty('这枚成就还没有解锁')

  const builder = SPECIAL[item.id] ?? CATEGORY_BASE[item.category]
  let related: RelatedRecord[] = []
  if (builder) {
    try {
      related = builder(ctx, opts)
    } catch (e) {
      // 关联记录是"锦上添花"：解析失败不能连故事卡一起不生成
      console.warn('[achievementStory] 关联记录构建失败，按无关联处理', item.id, e)
    }
  }

  return {
    id: item.id,
    canSave: true,
    reason: '',
    title: item.title,
    icon: item.icon,
    tierLabel: opts.tierLabel,
    categoryLabel: opts.categoryLabel,
    unlockedAt: item.unlockedAt,
    repeatCount: item.repeatCount,
    evidence: item.evidence,
    related: related.slice(0, 2),
    profileName: opts.profileName,
    today: opts.today,
  }
}

/**
 * 故事卡图片文件名。
 *
 * 用 id 而不是标题：标题是中文，虽然多数系统能存，但 `a[download]` 在不同浏览器
 * 对非 ASCII 文件名的处理并不一致（有的转 percent-encoding，用户在下载列表里
 * 看到一串 `%E6%88%90...`）。id 是稳定的机器名，且天然唯一 ——
 * 同一个人保存 28 张也不会互相覆盖。
 *
 * 自定义包的 id 由家长导入的 JSON 决定，可能带空格/斜杠/emoji → 一律折叠成 `-`，
 * 并截断到 48 字符（保留空间给前缀与扩展名）。
 */
export function storyFileName(id: string): string {
  const safe = id
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `achievement-story-${safe === '' ? 'unknown' : safe}.png`
}
