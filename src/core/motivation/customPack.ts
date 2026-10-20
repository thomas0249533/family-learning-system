/**
 * 自定义成就 · JSON 包校验与导入预览（V1.4 · B3 / PRD `P0-1`、设计 `§8.4`）
 *
 * ## 为什么校验器要"一次报全部错"，而不是遇到第一个错就返回
 * 写这份 JSON 的是家长（或家长从别处复制来的），改一轮要重新走"选文件 → 导入 → 看报错"。
 * fail-fast 会变成：改好 title，重来，被告知 desc 也超了；再改，被告知 category 写错……
 * 五轮之后家长就放弃了。所以**一次扫完全部问题**逐条报出来。
 *
 * 但也不能无限报：一份恶意/错乱的 JSON（比如 50 枚全错）能生成上千条 issue 把 UI 卡死，
 * 所以上限 50 条（`MAX_ISSUES`）。到上限后停止收集，已收集的照常返回。
 *
 * ## 为什么 `raw` 是对象而不是字符串
 * `JSON.parse` 抛错的位置信息（行列号、message）不属于校验器的职责，
 * 而且 "JSON 语法错" 与 "JSON 结构错" 对家长的提示完全不同，必须由调用方分两段处理。
 * 校验器只认"已经 parse 成功的值"，这样它就是纯粹的结构校验，可以放心被测试直调。
 *
 * ## 归一化（重要）
 * 校验通过后返回的 `pack` **已经补齐所有可选字段**（`metered` / `target` / `unit` / `noun` / `tier`），
 * 下游（视图装配、进度计算）不需要再写 `?? ` 兜底 —— 那样每多一处兜底，就多一处口径分叉的机会。
 * 唯一的例外是 `tier`：家长**显式写了**合法值就原样保留，不拿 `deriveCustomTier` 覆盖他。
 *
 * ## 纯函数约束
 * 不读 db、不读时钟、不写任何全局状态。`existingPacks` / `builtinIds` 一律由调用方注入
 * （只有 `builtinIds` 有默认值，来自 `ACHIEVEMENTS` 的**只读** import）。
 */
import { ACHIEVEMENTS } from './achievements'
import {
  COUNTER_METRICS,
  CUSTOM_CATEGORIES,
  CUSTOM_ID_PREFIX,
  CUSTOM_PACK_SCHEMA_VERSION,
  CUSTOM_REPEAT_PERIODS,
  CUSTOM_SOURCES,
  CUSTOM_TIERS,
  LIMITS,
  MAX_ACHIEVEMENTS_PER_PACK,
  MAX_PACKS,
  METRIC_META,
  type CounterMetric,
  type CustomAchievement,
  type CustomCategory,
  type CustomPack,
  type CustomRepeatPeriod,
  type CustomRule,
  type CustomSource,
  type CustomTier,
  type PackConflict,
  type PackIssue,
  type PackPreview,
  type StoredPack,
  type ValidationResult,
} from './customPackTypes'

/** 单次校验最多报多少条（防止一份恶意 JSON 撑爆 UI / 日志） */
const MAX_ISSUES = 50

/** packId 允许：字母数字开头，其余可为字母数字 / `_` / `-`（不含空格与点，避免当文件名时出问题） */
const PACK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** 内置 28 枚的 id，懒加载一次（不在模块顶层做 map，避免 import 期白算） */
let builtinIdCache: readonly string[] | null = null

function defaultBuiltinIds(): readonly string[] {
  if (builtinIdCache === null) builtinIdCache = ACHIEVEMENTS.map((a) => a.id)
  return builtinIdCache
}

/** 报错文案里的值摘要：不 `JSON.stringify` 整个对象（可能是深嵌套脏数据） */
function brief(v: unknown): string {
  if (v === undefined) return '缺失'
  if (v === null) return 'null'
  if (typeof v === 'string') return v.length > 24 ? `"${v.slice(0, 24)}…"` : `"${v}"`
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `数组(${v.length})`
  return typeof v === 'object' ? '对象' : typeof v
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * 从 `target` 保守推导稀有度。
 *
 * **这是"没有更好信号时的保守推导"**：一份 JSON 包只有 `target` 这一个数字可依据，
 * 拿它当"难度代理"是最不容易出错的近似（要 100 个知识点当然比要 1 个稀有）。
 * `hidden` 优先：隐藏成就不该因为 target 大就被顶成 `rare` 显形。
 * 家长显式写了合法 `tier` 时**不会被本函数覆盖**（见 `parseCustomPack` 的归一化）。
 */
export function deriveCustomTier(a: CustomAchievement): CustomTier {
  if (a.source === 'hidden') return 'hidden'
  const target = a.target
  if (typeof target !== 'number' || !Number.isFinite(target)) return 'common'
  if (target >= 100) return 'rare'
  if (target >= 30) return 'advanced'
  return 'common'
}

/**
 * 校验一份 `JSON.parse` 后的成就包。
 *
 * @param raw 已经 parse 成功的值（对象，**不是**字符串）
 * @param opts.builtinIds 内置成就 id（缺省取 `ACHIEVEMENTS`；测试可注入小集合）
 * @param opts.existingPacks 已装的自定义包（用于 `MAX_PACKS` 上限判断）
 */
export function parseCustomPack(
  raw: unknown,
  opts: { builtinIds?: readonly string[]; existingPacks?: readonly StoredPack[] } = {},
): ValidationResult {
  const builtinIds = opts.builtinIds ?? defaultBuiltinIds()
  const existingPacks = opts.existingPacks ?? []

  const errors: PackIssue[] = []
  /** 保留出口：将来可以提示"与已停用的包重名"之类**不阻断导入**的信息 */
  const warnings: PackIssue[] = []

  const addError = (path: string, code: string, message: string): void => {
    if (errors.length >= MAX_ISSUES) return
    errors.push({ path, code, message })
  }

  // ---------- 包级 ----------
  if (!isPlainObject(raw)) {
    addError('$', 'E_SHAPE', `成就包必须是一个 JSON 对象（当前：${brief(raw)}）`)
    return { ok: false, errors }
  }

  if (raw['schemaVersion'] !== CUSTOM_PACK_SCHEMA_VERSION) {
    addError(
      '$',
      'E_SCHEMA_VERSION',
      `只支持 schemaVersion: ${CUSTOM_PACK_SCHEMA_VERSION}（当前：${brief(raw['schemaVersion'])}）`,
    )
  }

  const rawPackId = raw['packId']
  const packIdOk =
    typeof rawPackId === 'string' &&
    rawPackId.length <= LIMITS.packId &&
    PACK_ID_RE.test(rawPackId)
  if (!packIdOk) {
    addError(
      '$.packId',
      'E_PACK_ID',
      `packId 必须是 ${LIMITS.packId} 字以内的字母/数字开头标识（可用 _ 与 -；当前：${brief(rawPackId)}）`,
    )
  }

  const rawName = raw['name']
  if (rawName !== undefined && (typeof rawName !== 'string' || rawName.length > LIMITS.packName)) {
    addError(
      '$.name',
      'E_PACK_NAME',
      `包名必须是不超过 ${LIMITS.packName} 字的文本（当前：${brief(rawName)}）`,
    )
  }

  const rawList = raw['achievements']
  if (!Array.isArray(rawList) || rawList.length === 0) {
    addError('$.achievements', 'E_ACHIEVEMENTS', '成就包里至少要有一枚成就（achievements 为非空数组）')
    return { ok: false, errors }
  }
  if (rawList.length > MAX_ACHIEVEMENTS_PER_PACK) {
    addError(
      '$.achievements',
      'E_TOO_MANY',
      `单个成就包最多 ${MAX_ACHIEVEMENTS_PER_PACK} 枚（当前 ${rawList.length} 枚）`,
    )
  }
  // 同名 packId 是"升版覆盖"，不占新名额，所以只对**新** packId 判上限
  if (packIdOk && existingPacks.length >= MAX_PACKS && !existingPacks.some((p) => p.packId === rawPackId)) {
    addError(
      '$.packId',
      'E_TOO_MANY_PACKS',
      `最多只能导入 ${MAX_PACKS} 个自定义包，请先删掉一个再导入（当前已装 ${existingPacks.length} 个）`,
    )
  }

  // ---------- 逐枚 ----------
  const normalized: CustomAchievement[] = []
  const seenIds = new Set<string>()

  for (let i = 0; i < rawList.length; i += 1) {
    const path = `achievements[${i}]`
    const item: unknown = rawList[i]
    if (!isPlainObject(item)) {
      addError(path, 'E_SHAPE', `第 ${i + 1} 枚成就必须是一个对象（当前：${brief(item)}）`)
      continue
    }
    const errorsBefore = errors.length

    // ---- id ----
    const rawId = item['id']
    const idIsString = typeof rawId === 'string'
    if (!idIsString || !rawId.startsWith(CUSTOM_ID_PREFIX) || rawId.length <= CUSTOM_ID_PREFIX.length) {
      addError(
        `${path}.id`,
        'E_ID_PREFIX',
        `id 必须以 ${CUSTOM_ID_PREFIX} 开头且前缀后不能为空（当前：${brief(rawId)}）`,
      )
    }
    if (idIsString) {
      // 内置撞车独立于前缀检查：这里刻意"多查一次"——
      // 万一将来内置改用同前缀，或在别处复制了内置 id，AC-P2-1 也必须拦住。
      if (builtinIds.includes(rawId)) {
        addError(
          `${path}.id`,
          'E_ID_BUILTIN',
          `id「${rawId}」与内置成就重名，请换一个（建议保留 ${CUSTOM_ID_PREFIX} 前缀）`,
        )
      }
      if (seenIds.has(rawId)) {
        addError(`${path}.id`, 'E_ID_DUPLICATE', `id「${rawId}」在本包里重复出现（同一 id 只能有一枚）`)
      }
      seenIds.add(rawId)
    }

    // ---- icon ----
    const rawIcon = item['icon']
    if (
      typeof rawIcon !== 'string' ||
      [...rawIcon].length !== 1 ||
      rawIcon.trim() === ''
    ) {
      addError(
        `${path}.icon`,
        'E_ICON',
        `icon 必须是 1 个字符的 emoji 或符号（当前：${brief(rawIcon)}）`,
      )
    }

    // ---- title / desc ----
    const rawTitle = item['title']
    if (typeof rawTitle !== 'string' || rawTitle.trim() === '' || rawTitle.length > LIMITS.title) {
      addError(
        `${path}.title`,
        'E_TITLE',
        `标题必须是 1~${LIMITS.title} 字的文本（当前：${brief(rawTitle)}）`,
      )
    }
    const rawDesc = item['desc']
    if (typeof rawDesc !== 'string' || rawDesc.trim() === '' || rawDesc.length > LIMITS.desc) {
      addError(
        `${path}.desc`,
        'E_DESC',
        `描述必须是 1~${LIMITS.desc} 字的文本（当前：${brief(rawDesc)}）`,
      )
    }

    // ---- category / source / tier ----
    const rawCategory = item['category']
    if (typeof rawCategory !== 'string' || !(CUSTOM_CATEGORIES as readonly string[]).includes(rawCategory)) {
      addError(
        `${path}.category`,
        'E_CATEGORY',
        `category 只能是 ${CUSTOM_CATEGORIES.join(' / ')}（当前：${brief(rawCategory)}）`,
      )
    }
    const rawSource = item['source']
    if (typeof rawSource !== 'string' || !(CUSTOM_SOURCES as readonly string[]).includes(rawSource)) {
      addError(
        `${path}.source`,
        'E_SOURCE',
        `source 只能是 ${CUSTOM_SOURCES.join(' / ')}（当前：${brief(rawSource)}）`,
      )
    }
    const rawTier = item['tier']
    const tierOk =
      rawTier === undefined ||
      (typeof rawTier === 'string' && (CUSTOM_TIERS as readonly string[]).includes(rawTier))
    if (!tierOk) {
      addError(
        `${path}.tier`,
        'E_TIER',
        `tier 只能是 ${CUSTOM_TIERS.join(' / ')}，也可以整段省略（自动推导；当前：${brief(rawTier)}）`,
      )
    }

    // ---- metered（类型） ----
    const rawMetered = item['metered']
    if (rawMetered !== undefined && typeof rawMetered !== 'boolean') {
      addError(`${path}.metered`, 'E_METERED', `metered 必须是 true / false（当前：${brief(rawMetered)}）`)
    }

    // ---- rule ----
    const rawRule = item['rule']
    let rule: CustomRule | null = null
    if (!isPlainObject(rawRule)) {
      addError(`${path}.rule`, 'E_RULE_KIND', `每枚成就都必须有规则对象 rule（当前：${brief(rawRule)}）`)
    } else {
      const kind = rawRule['kind']
      if (kind === 'manual-check') {
        const rawPrompt = rawRule['prompt']
        if (
          typeof rawPrompt !== 'string' ||
          rawPrompt.trim() === '' ||
          rawPrompt.length > LIMITS.prompt
        ) {
          addError(
            `${path}.rule.prompt`,
            'E_PROMPT',
            `验收提示必须是 1~${LIMITS.prompt} 字的文本（当前：${brief(rawPrompt)}）`,
          )
        }
        rule = {
          kind: 'manual-check',
          prompt: typeof rawPrompt === 'string' ? rawPrompt : '',
        }
      } else if (kind === 'counter') {
        const rawMetric = rawRule['metric']
        const metricOk =
          typeof rawMetric === 'string' && (COUNTER_METRICS as readonly string[]).includes(rawMetric)
        if (!metricOk) {
          addError(
            `${path}.rule.metric`,
            'E_METRIC',
            `metric 只能是 ${COUNTER_METRICS.join(' / ')}（当前：${brief(rawMetric)}）`,
          )
        }
        const rawRuleTarget = rawRule['target']
        const ruleTargetOk =
          typeof rawRuleTarget === 'number' &&
          Number.isInteger(rawRuleTarget) &&
          rawRuleTarget >= 1
        if (!ruleTargetOk) {
          addError(
            `${path}.rule.target`,
            'E_COUNTER_TARGET',
            `计数器规则的 rule.target 必须是 ≥1 的整数（当前：${brief(rawRuleTarget)}）`,
          )
        }
        if (metricOk && ruleTargetOk) {
          rule = {
            kind: 'counter',
            metric: rawMetric as CounterMetric,
            target: rawRuleTarget as number,
          }
        }
      } else {
        // AC-P2-2：expr / script / js / 任何未知 kind 一律这条 —— 白名单之外没有第二种解释
        addError(
          `${path}.rule.kind`,
          'E_RULE_KIND',
          `rule.kind 只支持 manual-check / counter，不支持 ${brief(kind)}（本版不支持表达式或脚本）`,
        )
      }
    }

    // ---- 跨字段一致性 ----
    // 这三条是 B3 的裁决（写进 PRD「自定义包字段一致性」一节）：
    //   1) manual-check + metered: false（含省略）→ **不得**出现 target，因为"勾了就算"没有进度可算；
    //   2) manual-check + metered: true → target 必须恰好为 1，让"勾了就算"的卡也能显示 0/1 进度条；
    //   3) counter 必须可进度化（metered 省略默认 true，写 false 直接拒），
    //      且顶层 target（若写）必须等于 rule.target（两处写同一个数字只会写歪）。
    const rawTarget = item['target']
    if (rule !== null && rule.kind === 'manual-check') {
      if (rawTarget !== undefined && rawMetered !== true) {
        addError(
          `${path}.target`,
          'E_TARGET',
          'manual-check 省略 metered 时按 false 处理，不能写 target；想显示 0/1 进度条请写 metered: true 且 target: 1',
        )
      } else if (rawTarget !== undefined && rawTarget !== 1) {
        addError(
          `${path}.target`,
          'E_TARGET_NOT_ONE',
          `manual-check 的 metered 为 true 时 target 只能为 1（当前：${brief(rawTarget)}）`,
        )
      }
    }
    if (rule !== null && rule.kind === 'counter') {
      if (rawMetered === false) {
        addError(
          `${path}.metered`,
          'E_METERED',
          'counter 规则是累计型，必须可进度化（metered 不能为 false，省略即为 true）',
        )
      }
      if (rawTarget !== undefined && rawTarget !== rule.target) {
        addError(
          `${path}.target`,
          'E_TARGET_MISMATCH',
          `target 与 rule.target 必须一致（当前：${brief(rawTarget)} vs ${rule.target}）`,
        )
      }
    }

    // ---- 可重复达成（V1.5）----
    // 两条规则：
    //   1) 只认白名单里的周期值（`"weekly"`），写别的按"不支持"拒 —— 与 rule.kind 同一套态度：
    //      不猜、不降级，否则家长以为配好了、实际没生效；
    //   2) `manual-check` 不能带 repeat：勾选态是 0/1，没有可累计的量，
    //      "每周再勾一次"需要把 customChecks 改成按周的表，是另一个数据结构。
    const rawRepeat = item['repeat']
    let repeatOk = false
    if (rawRepeat !== undefined) {
      if (!CUSTOM_REPEAT_PERIODS.includes(rawRepeat as CustomRepeatPeriod)) {
        addError(
          `${path}.repeat`,
          'E_REPEAT_PERIOD',
          `repeat 只支持 ${CUSTOM_REPEAT_PERIODS.map((p) => `"${p}"`).join(' / ')}（当前：${brief(rawRepeat)}）`,
        )
      } else if (rule !== null && rule.kind === 'manual-check') {
        addError(
          `${path}.repeat`,
          'E_REPEAT_MANUAL',
          'manual-check 的卡片不能声明 repeat：勾选态是 0/1，没有可累计的量。想每周重复，请改用 counter 规则',
        )
      } else {
        repeatOk = true
      }
    }

    // 这枚有任何问题 → 不参与归一化产物（反正整包会被拒，产物只用于 preview 之外的下游展示）
    if (errors.length !== errorsBefore) continue
    if (rule === null) continue // 理论上到不了：上面必有一条 E_RULE_KIND

    // ---- 归一化 ----
    // counter：metered 恒 true，target 取 rule.target（顶层 target 已校验一致或缺失）
    // manual-check：metered 取家长显式值（省略 = false），metered 为 true 时 target 恒 1
    let meteredOut: boolean
    let targetOut: number | undefined
    let meta: { unit: string; noun: string }
    if (rule.kind === 'counter') {
      meteredOut = true
      targetOut = rule.target
      // 量词默认取指标元信息（`??` 兜住绕过校验的未知 metric）
      meta = METRIC_META[rule.metric] ?? { unit: '', noun: '' }
    } else {
      meteredOut = rawMetered === true
      targetOut = meteredOut ? 1 : undefined
      // manual-check 没有指标可依据，量词默认留空（target=1 的文案不出量词）
      meta = { unit: '', noun: '' }
    }

    const rawUnit = item['unit']
    const rawNoun = item['noun']
    const unitOverride = typeof rawUnit === 'string' && rawUnit.trim() !== '' ? rawUnit : undefined
    const nounOverride = typeof rawNoun === 'string' && rawNoun.trim() !== '' ? rawNoun : undefined

    const achievement: CustomAchievement = {
      id: rawId as string,
      icon: rawIcon as string,
      title: rawTitle as string,
      desc: rawDesc as string,
      category: rawCategory as CustomCategory,
      source: rawSource as CustomSource,
      metered: meteredOut,
      unit: unitOverride ?? meta.unit,
      noun: nounOverride ?? meta.noun,
      rule,
    }
    // `target?: number`：`metered: false` 时**不写**这个键（而不是写 undefined），
    // 这样 `'target' in a === metered` 恒成立，下游判"有没有目标"时不会看到幽灵字段。
    if (targetOut !== undefined) achievement.target = targetOut
    // 家长写的合法 tier 原样保留；没写才推导
    achievement.tier = tierOk && typeof rawTier === 'string' ? (rawTier as CustomTier) : deriveCustomTier(achievement)
    // 同理：没写 repeat 就**不写**这个键（而不是写 undefined），
    // 这样 `'repeat' in a` 恒等于"这张卡可重复"，下游不用区分"没写"和"写了空"
    if (repeatOk) achievement.repeat = rawRepeat as CustomRepeatPeriod

    normalized.push(achievement)
  }

  if (errors.length > 0) return { ok: false, errors }

  const pack: CustomPack = {
    schemaVersion: CUSTOM_PACK_SCHEMA_VERSION,
    packId: rawPackId as string,
    achievements: normalized,
  }
  // 空串包名当"没写"：UI 回落到显示 packId，比显示一片空白好
  if (typeof rawName === 'string' && rawName.trim() !== '') pack.name = rawName

  return { ok: true, pack, warnings }
}

/**
 * 导入前预览：这份包进来会发生什么（净新增哪些卡、保留多少、和谁撞 id、是否升版替换）。
 *
 * 纯函数，不读库、不读时钟 —— 预览结果必须可以在同一份输入上反复重算且完全一致，
 * 否则家长点两次「预览」看到两个数字，就不敢点「导入」了。
 *
 * 三个计数的口径（互不重叠，且恒有 `provided === added.length + retained`）：
 *   - `added`：本版提供的**净新增** id（旧版本没有、不撞内置、不撞别的包、包内不重复）；
 *   - `retained`：旧版本有、本版仍保留的 id 数（标题/描述改了不算新增，仍是同一张卡）；
 *   - `provided`：本版总共提供多少枚（不含冲突项）。
 *
 * 为什么不用一个 `added` 打天下：升版时"与旧版本共有"的卡会被原样保留，
 * 把它们算进 `added` 会让 UI 的"将新增 N 枚"变成"重复导入一批"的误读 ——
 * 这个坑不可能靠文案兜住（下一个调用方一定会按字段名去理解它的）。
 *
 * @param opts.builtinIds 必填（内置 id 会随版本增加，缓存进包体是错的）
 * @param opts.existingPacks 已装的自定义包（同 packId 的那一个用于判 `replaces` / `retained`）
 */
export function previewCustomPack(
  pack: CustomPack,
  opts: { builtinIds: readonly string[]; existingPacks?: readonly StoredPack[] },
): PackPreview {
  const existingPacks = opts.existingPacks ?? []
  const builtin = new Set(opts.builtinIds)
  const samePack = existingPacks.find((p) => p.packId === pack.packId)

  // 旧版本（同 packId）已提供的 id：既不是冲突，也不算新增 —— 它们是"保留"
  const previousIds = new Set<string>(
    samePack ? samePack.pack.achievements.map((a) => a.id) : [],
  )

  // 别的包占用的 id → 那个包的 packId。同 packId 的旧版本**不算**冲突（那是升版）
  const ownedByOtherPack = new Map<string, string>()
  for (const stored of existingPacks) {
    if (stored.packId === pack.packId) continue
    for (const a of stored.pack.achievements) {
      if (!ownedByOtherPack.has(a.id)) ownedByOtherPack.set(a.id, stored.packId)
    }
  }

  const added: PackPreview['added'] = []
  const conflicts: PackConflict[] = []
  const seen = new Set<string>()
  let retained = 0

  for (const a of pack.achievements) {
    const isDuplicate = seen.has(a.id)
    seen.add(a.id)

    if (isDuplicate) {
      conflicts.push({ id: a.id, title: a.title, kind: 'duplicate', with: pack.packId })
      continue
    }
    if (builtin.has(a.id)) {
      conflicts.push({ id: a.id, title: a.title, kind: 'builtin', with: a.id })
      continue
    }
    const otherPackId = ownedByOtherPack.get(a.id)
    if (otherPackId !== undefined) {
      conflicts.push({ id: a.id, title: a.title, kind: 'custom', with: otherPackId })
      continue
    }
    if (previousIds.has(a.id)) {
      retained += 1
      continue
    }
    added.push({
      id: a.id,
      title: a.title,
      category: a.category,
      ruleKind: a.rule.kind,
      // 只在真的可重复时带上这个键（与 `parseCustomPack` 里"没写就不写"同一套约定）
      ...(a.repeat !== undefined ? { repeat: a.repeat } : {}),
    })
  }

  return {
    packId: pack.packId,
    added,
    retained,
    provided: added.length + retained,
    conflicts,
    replaces: samePack ? { packId: samePack.packId, fromVersion: samePack.version } : null,
  }
}
