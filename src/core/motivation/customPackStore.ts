/**
 * 自定义成就包的**存储层**（V1.4 · B3 / PRD §8、设计 §13.4）
 *
 * ## 为什么存储单独一层，而不是塞进 `customPack.ts`
 * `customPack.ts` 是**纯函数校验器**（可被 200 组属性测试在毫秒级跑完，不读时钟、不碰库）。
 * 一旦让它 `put` 库，"预览"与"确认导入"就没法共用同一份逻辑了。所以：
 *   - `customPack.ts` → 判断"这份 JSON 能不能装"；
 *   - 本文件         → 决定"装进去之后落在哪、审计怎么写、回滚退到哪一版"。
 *
 * ## 五条贯穿全文件的裁决
 * 1. **导入即启用**。家长导入一份包，意图就是"我要用"。让他再点一次"启用"是
 *    凭空多一步，而多出来的那一步恰恰是最容易被忘掉的一步（结果：导入了却看不到卡）。
 *    所以 `importPack` 直接写 `enabled: true` + `enabledAt`；不想要随时停用。
 * 2. **停用 ≠ 销毁**。停用只关掉 `enabled`，**绝不删** `customChecks:<pid>` 与
 *    `achievements:<pid>`。已裁决（PRD §8.2 / 设计 §13 未决 4）：停用的语义是
 *    "我不想要这张卡"，不是"把孩子已经挣到的证据抹掉"。重新启用时勾选与解锁都还在。
 * 3. **回滚只退一版，且只管包**。`previous` 只保留一层快照：回滚把 `pack` 换回
 *    `previous.pack`、`version = previous.version`、`previous = null`。**不碰**启用态、
 *    **不碰**任何 per-profile 键（AC-P2-4「解锁记录一条不少」）。
 * 4. **审计是旁路**。审计写失败只 `console.warn`，绝不让"启用没生效"这种用户可见的
 *    失败被"审计写不进去"这种内部问题掩盖 —— 也不能反过来：让审计失败把已经成功的
 *    启用变成异常。但**状态写入失败必须抛**（见下面「读写异常的处理口径」）。
 * 5. **id 全局唯一**。`UnlockedRecord` 按 id 全局存（不带 packId），所以"两个包用同一个
 *    `custom::xxx`"会让两枚卡串成一张。内置 28 枚有 `custom::` 前缀这层结构隔离，
 *    自定义包之间没有 —— 唯一能用的判据就是"跨包不许重名"，由 `importPack` 的最后
 *    一道闸门（`E_ID_OTHER_PACK`）强制执行。
 *
 * ## 读写异常的处理口径（写清楚，不然三处必然不一致）
 * - **读**（`loadPackState` / `loadChecks` / `readAudit`）：脏数据 → 空集合；读库抛错 →
 *   空集合 + `console.warn`。理由：一个读不出来的包清单不该让整个成就页白屏。
 * - **写**（`savePackState` / `setCheck` / import / enable / disable / rollback）：
 *   **抛**。理由：用户点了"启用"却没生效，界面必须能显示失败；静默吞掉等于骗人。
 * - **例外**：`setCheck` 的"写前读"是**写路径的一部分**（要在原对象上增删键），
 *   读失败时仍然写就等于用空对象覆盖掉孩子的全部勾选 → 这里读失败也抛。
 */
import { db } from '@/db'
import { currentProfileId } from '@core/profile/currentProfile'
import { scopedKey } from '@core/profile/settingsScope'
import { ACHIEVEMENTS } from './achievements'
import { parseCustomPack, previewCustomPack } from './customPack'
import {
  AUDIT_KEY,
  CUSTOM_CHECKS_BASE,
  CUSTOM_PACKS_KEY,
  checkKey,
  type AuditAction,
  type AuditEntry,
  type CustomCheckState,
  type CustomPack,
  type CustomPackState,
  type PackIssue,
  type PackPreview,
  type StoredPack,
} from './customPackTypes'

/** 审计日志上限。超出丢**最旧**的（数组新的在前，所以是尾部）。 */
export const AUDIT_LIMIT = 200

/**
 * 内置 28 枚的 id 快照。
 *
 * 用途单一：交给校验器判断"自定义 id 是否与内置撞"。取 `ACHIEVEMENTS`（唯一真相）
 * 而不是另抄一份清单 —— 抄一份就会在下一轮加徽章时悄悄过期，撞 id 从"结构上不可能"
 * 退化成"运行时才发现"。模块级常量即可：`ACHIEVEMENTS` 是静态数组，不会变。
 */
const BUILTIN_IDS: readonly string[] = ACHIEVEMENTS.map((a) => a.id)

/** 四个合法动作（校验审计脏数据用） */
const AUDIT_ACTIONS: ReadonlySet<string> = new Set<AuditAction>([
  'import',
  'enable',
  'disable',
  'rollback',
])

// ---------------------------------------------------------------------------
// 归一化（脏数据兜底：绝不抛，只丢）
// ---------------------------------------------------------------------------

/** 一个值看起来是不是 `CustomPack`（只做结构判断，**不做字段校验** —— 那是校验器的事） */
function isPackShape(v: unknown): v is CustomPack {
  const p = v as Partial<CustomPack> | null
  return (
    !!p
    && typeof p === 'object'
    && typeof p.packId === 'string'
    && p.packId !== ''
    && typeof p.schemaVersion === 'number'
    && Array.isArray(p.achievements)
  )
}

/** 版本号：非有限数 / <1 一律按 1（宁可显示 v1，也不要 NaN 出现在审计里） */
function toVersion(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1
}

/** `previous` 快照：结构不完整就当"没有上一版"（回滚按钮置灰，好过退到一半） */
function normalizePrevious(v: unknown): { pack: CustomPack; version: number } | null {
  const r = v as { pack?: unknown; version?: unknown } | null
  if (!r || typeof r !== 'object') return null
  if (!isPackShape(r.pack)) return null
  return { pack: r.pack, version: toVersion(r.version) }
}

/** 单条已装包：任一必需字段坏了就整条丢弃（半个包比没有包更危险） */
function normalizeStoredPack(raw: unknown): StoredPack | null {
  const r = raw as Partial<StoredPack> | null
  if (!r || typeof r !== 'object') return null
  if (typeof r.packId !== 'string' || r.packId === '') return null
  if (!isPackShape(r.pack)) return null
  // 内外 packId 不一致：要么被人工改过，要么是旧版本的 bug。无论哪种都不可信。
  if (r.pack.packId !== r.packId) return null

  const stored: StoredPack = {
    packId: r.packId,
    // 只有明确的 true 才算启用：读不清就当停用（少显示一张卡 < 显示一张内容不在的假卡）
    enabled: r.enabled === true,
    version: toVersion(r.version),
    pack: r.pack,
    previous: normalizePrevious(r.previous),
    importedAt: typeof r.importedAt === 'string' ? r.importedAt : '',
  }
  if (typeof r.enabledAt === 'string' && r.enabledAt !== '') stored.enabledAt = r.enabledAt
  return stored
}

/**
 * `achievement:customPacks` 的值 → `CustomPackState`。
 *
 * 不截断 `MAX_PACKS`：上限是**导入时**的准入校验。读侧再截一次等于静默删包，
 * 而"家长装了很多包"这种场景下被删掉的那个包通常是最后装的、最想用的那个。
 */
export function normalizePackState(raw: unknown): CustomPackState {
  const rec = raw as { packs?: unknown } | null
  if (!rec || typeof rec !== 'object' || !Array.isArray(rec.packs)) return { packs: [] }

  const packs: StoredPack[] = []
  const seen = new Set<string>()
  for (const item of rec.packs) {
    const p = normalizeStoredPack(item)
    if (!p) continue
    // 同一个 packId 出现两次：保留**第一条**（先写入的那份更可能是原始导入，
    // 后出现的那份可能是半失败的重复写入）
    if (seen.has(p.packId)) continue
    seen.add(p.packId)
    packs.push(p)
  }
  return { packs }
}

/**
 * `customChecks:<pid>` 的值 → `CustomCheckState`。
 *
 * `at` 不是字符串 → 留空串（显示成"时间未知"），而**不是丢掉这条勾选**：
 * 丢勾选等于抹掉家长已经确认过的事实，代价远大于少一个时间戳。
 */
export function normalizeChecks(raw: unknown): CustomCheckState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: CustomCheckState = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key) continue
    const rec = value as { at?: unknown } | null
    if (!rec || typeof rec !== 'object') continue
    out[key] = { at: typeof rec.at === 'string' ? rec.at : '' }
  }
  return out
}

/** 审计数组归一化：坏条目丢弃（一条坏记录不该让整个审计列表读不出来） */
export function normalizeAudit(raw: unknown): AuditEntry[] {
  if (!Array.isArray(raw)) return []
  const out: AuditEntry[] = []
  for (const item of raw) {
    const r = item as Partial<AuditEntry> | null
    if (!r || typeof r !== 'object') continue
    if (typeof r.at !== 'string' || r.at === '') continue
    if (typeof r.packId !== 'string' || r.packId === '') continue
    if (typeof r.action !== 'string' || !AUDIT_ACTIONS.has(r.action)) continue
    const entry: AuditEntry = {
      at: r.at,
      action: r.action,
      packId: r.packId,
      affected: typeof r.affected === 'number' && Number.isFinite(r.affected)
        ? Math.max(0, Math.floor(r.affected))
        : 0,
    }
    if (typeof r.detail === 'string' && r.detail !== '') entry.detail = r.detail
    out.push(entry)
  }
  return out
}

// ---------------------------------------------------------------------------
// 包清单 / 勾选 / 审计的读写
// ---------------------------------------------------------------------------

/** 读已装包清单。读失败 → 空集合（不抛，见文件头）。 */
export async function loadPackState(): Promise<CustomPackState> {
  try {
    const rec = await db.settings.get(CUSTOM_PACKS_KEY)
    return normalizePackState(rec?.value)
  } catch (e) {
    console.warn('[customPack] 读取自定义包清单失败，按空集合处理', e)
    return { packs: [] }
  }
}

/** 写已装包清单。**失败抛**：用户点了启用却没生效必须让他知道。 */
export async function savePackState(state: CustomPackState): Promise<void> {
  // 写前归一化：保证库里永远只有合法结构（脏数据在下一层就被吃掉，不让它传下去）
  await db.settings.put({ key: CUSTOM_PACKS_KEY, value: normalizePackState(state) })
}

/**
 * 读某个档案的手工勾选态。
 * 键走 `scopedKey(CUSTOM_CHECKS_BASE, profileId ?? currentProfileId())` —— 不自己拼字符串，
 * 否则 `settingsScope` 那张表（迁移/合并/导出的唯一真相）与实际落库的键会悄悄分叉。
 */
export async function loadChecks(profileId?: string): Promise<CustomCheckState> {
  const pid = profileId ?? currentProfileId()
  try {
    const rec = await db.settings.get(scopedKey(CUSTOM_CHECKS_BASE, pid))
    return normalizeChecks(rec?.value)
  } catch (e) {
    console.warn('[customPack] 读取勾选状态失败，按未勾选处理', e)
    return {}
  }
}

/**
 * 写一条勾选 / 取消勾选（当前档案）。
 *
 * `checked === false` 是**删键**而不是写 `false`：`customChecks` 只记"勾过"。
 * 留下 `{ key: { at, checked: false } }` 会让"这条到底算不算勾过"取决于读侧实现，
 * 而读侧有第二套判据的那天，就是两张卡状态不一致的那天。
 */
export async function setCheck(
  packId: string,
  achievementId: string,
  checked: boolean,
  now: Date = new Date(),
): Promise<void> {
  const key = scopedKey(CUSTOM_CHECKS_BASE, currentProfileId())

  // 这里的读是**写路径的一部分**（要在原对象上增删键）：读失败时继续写会用空对象
  // 覆盖掉孩子的全部勾选，所以读失败直接抛，不按"读操作"的口径吞掉。
  const rec = await db.settings.get(key)
  const checks = normalizeChecks(rec?.value)

  const k = checkKey(packId, achievementId)
  if (checked) checks[k] = { at: now.toISOString() }
  else delete checks[k]

  await db.settings.put({ key, value: checks })
}

/** 读审计日志（新的在前）。读失败 → 空数组。 */
export async function readAudit(): Promise<AuditEntry[]> {
  try {
    const rec = await db.settings.get(AUDIT_KEY)
    return normalizeAudit(rec?.value)
  } catch (e) {
    console.warn('[customPack] 读取审计日志失败，按空列表处理', e)
    return []
  }
}

/**
 * 追加一条审计（新的在前，上限 `AUDIT_LIMIT`）。
 *
 * **绝不抛**：审计是旁路。写失败只告警 —— 理由见文件头第 4 条。
 */
async function appendAudit(entry: AuditEntry): Promise<void> {
  try {
    const rec = await db.settings.get(AUDIT_KEY)
    const list = normalizeAudit(rec?.value)
    // 新的在前：家长打开"最近发生了什么"第一眼看到的就是刚才那一步
    const next = [entry, ...list].slice(0, AUDIT_LIMIT)
    await db.settings.put({ key: AUDIT_KEY, value: next })
  } catch (e) {
    console.warn('[customPack] 写审计日志失败，已忽略（不影响本次操作）', e)
  }
}

// ---------------------------------------------------------------------------
// 导入 / 启用 / 停用 / 回滚
// ---------------------------------------------------------------------------

export interface ImportSuccess {
  ok: true
  pack: CustomPack
  preview: PackPreview
  /** 本次落库后的版本号（首次导入 = 1） */
  version: number
}

export interface ImportFailure {
  ok: false
  errors: PackIssue[]
}

export type ImportResult = ImportSuccess | ImportFailure

/**
 * 导入一份 JSON 包（校验 → 跨包闸门 → 落库 → 审计）。
 *
 * 四种情形，行为各不相同：
 * 1. **校验不过** → 一个字节都不写，原样返回 `errors`（UI 用 `path` 定位字段）；
 * 2. **跨包同 id**（`E_ID_OTHER_PACK`）→ 同样一个字节都不写；
 * 3. **全新 packId** → `enabled: true` + `enabledAt = now`、`version = 1`；
 * 4. **同 packId 再导入** → `version + 1`、`previous = { pack: 旧, version: 旧 }`、
 *    `enabled` 与 `enabledAt` **保持原状**。
 *    第 4 条最容易被写错：顺手"重新导入就顺便启用"会悄悄把一个家长特意停用的包打开，
 *    而这件事在界面上没有任何痕迹（卡片就这样出现了）。
 */
export async function importPack(raw: unknown, now: Date = new Date()): Promise<ImportResult> {
  const state = await loadPackState()
  const at = now.toISOString()

  const result = parseCustomPack(raw, {
    builtinIds: BUILTIN_IDS,
    existingPacks: state.packs,
  })
  if (!result.ok) return { ok: false, errors: result.errors }
  const pack = result.pack

  // 预览必须在**写入前**基于当前状态算：它要回答的是"这一次导入会带来什么"
  const preview = previewCustomPack(pack, {
    builtinIds: BUILTIN_IDS,
    existingPacks: state.packs,
  })

  // ---- 最终闸门：跨包同 id 必须拒绝（E_ID_OTHER_PACK）----
  //
  // `UnlockedRecord` 是按 **id** 全局存的（`achievements:<pid>` 里没有 packId）：
  // 两个不同的包写同一个 `custom::xxx` 时，解锁记录会串成一张卡 ——
  // 家长在 A 包勾了，B 包的卡也亮了。这比"与内置撞 id"更隐蔽，因为它**不报错**，
  // 只是两枚卡悄悄变成一个。
  //
  // 内置 28 枚靠 `custom::` 前缀从**结构上**隔离，自定义包之间没有这层隔离
  // （两边都带同一个前缀），唯一能用的判据就是"id 全局唯一" —— 只能靠这一道闸。
  //
  // 为什么判据取自 `preview.conflicts` 而不是自己再扫一遍 `state.packs`：
  // 预览函数已经把"同 packId 的旧版本"排除掉了（那是升版，不是冲突），
  // 自己再写一份判据必然与它对不齐 —— 症状是升版被误伤成"id 被占用"。
  //
  // 注意闸门看的是**全部已装包**（含已停用的）：解锁记录在停用后仍然保留
  // （AC-P2-4），所以一个停用包占用的 id 一旦被新包复用，等它重新启用就立刻串卡。
  if (preview.conflicts.length > 0) {
    const errors: PackIssue[] = preview.conflicts.map((c) => {
      const index = pack.achievements.findIndex((a) => a.id === c.id)
      const path = index >= 0 ? `achievements[${index}].id` : '$'
      if (c.kind === 'custom') {
        return {
          path,
          code: 'E_ID_OTHER_PACK',
          message: `这个 id 已被另一个自定义包使用（${c.with}），请换一个`,
        }
      }
      // 下面两种正常走不到（`parseCustomPack` 已经拒了内置撞名与包内重复）。
      // 保留分支是为了"闸门是完整的一道"：真出现时给出可定位的报错，而不是静默放行。
      if (c.kind === 'duplicate') {
        return { path, code: 'E_ID_DUPLICATE_IN_PACK', message: '同一个包里有两枚卡用了相同的 id，请换一个' }
      }
      return { path, code: 'E_ID_BUILTIN', message: `这个 id 与内置成就重名（${c.with}），请换一个` }
    })
    // 不落库、不写审计：被拒绝的导入不该留下任何痕迹
    return { ok: false, errors }
  }

  const idx = state.packs.findIndex((p) => p.packId === pack.packId)
  const old = idx >= 0 ? state.packs[idx] : null
  const version = old ? old.version + 1 : 1

  const stored: StoredPack = old
    ? {
      packId: pack.packId,
      // 启用态原样保留（见上面第 3 条）
      enabled: old.enabled,
      version,
      pack,
      previous: { pack: old.pack, version: old.version },
      importedAt: at,
      ...(old.enabledAt ? { enabledAt: old.enabledAt } : {}),
    }
    : {
      packId: pack.packId,
      // 导入即启用（见文件头第 1 条）
      enabled: true,
      version,
      pack,
      previous: null,
      importedAt: at,
      enabledAt: at,
    }

  const packs = old
    ? state.packs.map((p, i) => (i === idx ? stored : p))
    : [...state.packs, stored]

  // 先落状态、再写审计：审计失败不能反过来否定一次成功的导入
  await savePackState({ packs })

  // `affected` 口径：新增装的包 = 真正新增的卡数（预览算出来的）；
  // 升版 = 本版枚数（对家长而言"这一版有 N 枚卡"比"差了几枚"更好理解）
  const affected = old ? pack.achievements.length : preview.added.length
  await appendAudit({
    at,
    action: 'import',
    packId: pack.packId,
    affected,
    detail: old ? `v${old.version} → v${version}` : `新装 ${pack.achievements.length} 枚`,
  })

  return { ok: true, pack, preview, version }
}

/** 找到某个包，找不到就抛（写路径不接受"悄悄什么都没发生"） */
function requirePack(state: CustomPackState, packId: string): { pack: StoredPack; index: number } {
  const index = state.packs.findIndex((p) => p.packId === packId)
  if (index < 0) throw new Error(`[customPack] 包不存在：${packId}`)
  return { pack: state.packs[index], index }
}

/**
 * 启用一个已装的包。
 *
 * 已启用时**不改 `enabledAt`**：它是"最早启用时间"，重写等于伪造历史。
 * 重复启用仍然写一条审计（`detail` 里标明状态未变），这样"家长说点过一次没反应"
 * 时能从审计里看到确实点过了。
 */
export async function enablePack(packId: string, now: Date = new Date()): Promise<void> {
  const state = await loadPackState()
  const { pack: target, index } = requirePack(state, packId)
  const at = now.toISOString()

  const stored: StoredPack = {
    ...target,
    enabled: true,
    enabledAt: target.enabledAt ?? at,
  }
  const packs = state.packs.map((p, i) => (i === index ? stored : p))
  await savePackState({ packs })

  await appendAudit({
    at,
    action: 'enable',
    packId,
    affected: target.pack.achievements.length,
    detail: target.enabled ? '重复启用（状态未变）' : '已启用',
  })
}

/**
 * 停用一个包。
 *
 * **只关开关**：`customChecks:<pid>` 与 `achievements:<pid>` 一个字都不动
 * （AC-P2-3 / AC-P2-4）。停用后图鉴里这枚卡不再参与展示，但孩子之前挣到的解锁记录
 * 仍然在库里；重新启用时它们原样回来。
 */
export async function disablePack(packId: string, now: Date = new Date()): Promise<void> {
  const state = await loadPackState()
  const { pack: target, index } = requirePack(state, packId)
  const at = now.toISOString()

  // 显式重建对象而不是 `delete stored.enabledAt`：这里要的是"新对象里没有这个键"，
  // 而不是在共享引用上做可变操作（`loadPackState` 出来的对象可能被别处持有）
  const stored: StoredPack = {
    packId: target.packId,
    enabled: false,
    version: target.version,
    pack: target.pack,
    previous: target.previous,
    importedAt: target.importedAt,
  }
  const packs = state.packs.map((p, i) => (i === index ? stored : p))
  await savePackState({ packs })

  await appendAudit({
    at,
    action: 'disable',
    packId,
    affected: target.pack.achievements.length,
    detail: '已停用（勾选与解锁记录保留）',
  })
}

/**
 * 回滚到上一版（只退一版）。
 *
 * 换的只有三样东西：`pack`、`version`、`previous`。`enabled` 保持原状（一个停用的包
 * 回滚后仍然是停用的 —— 回滚是"内容退版"，不是"状态退版"）。
 *
 * 没有 `previous` → 抛 `Error('没有可回滚的版本')`：UI 靠这条消息决定按钮是否可点，
 * 静默不做事会让家长以为点了没生效。
 */
export async function rollbackPack(
  packId: string,
  now: Date = new Date(),
): Promise<{ fromVersion: number; toVersion: number }> {
  const state = await loadPackState()
  const { pack: target, index } = requirePack(state, packId)
  if (!target.previous) throw new Error('没有可回滚的版本')

  const at = now.toISOString()
  const fromVersion = target.version
  const toVersion = target.previous.version

  const stored: StoredPack = {
    packId: target.packId,
    enabled: target.enabled,
    version: toVersion,
    pack: target.previous.pack,
    // 只退一版：回滚后再点回滚必须报"没有可回滚的版本"，而不是在三代之间来回跳
    previous: null,
    importedAt: target.importedAt,
    ...(target.enabledAt ? { enabledAt: target.enabledAt } : {}),
  }
  const packs = state.packs.map((p, i) => (i === index ? stored : p))
  await savePackState({ packs })

  await appendAudit({
    at,
    action: 'rollback',
    packId,
    // 版本差枚数：正负都无意义，家长关心的是"卡片数变了多少"
    affected: Math.abs(target.pack.achievements.length - target.previous.pack.achievements.length),
    detail: `v${fromVersion} → v${toVersion}`,
  })

  return { fromVersion, toVersion }
}

/** 当前已启用的包（顺序 = 安装顺序，成就视图按此顺序追加卡片） */
export async function enabledPacks(): Promise<StoredPack[]> {
  const state = await loadPackState()
  return state.packs.filter((p) => p.enabled)
}
