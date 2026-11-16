/**
 * 隐藏学习包 · 数据层（P0-1）
 *
 * ## 它解决什么
 * 新版四上词汇包（`chinese-4-up-vocab-2026`）上线后，书架会同时出现新旧两个语文包。
 * 家长需要把旧包从书架主列表撤下，**但绝不删任何学习数据**：进度、错题、打卡都在
 * 原来的 `packageId` 下，只是不展示。以后一键取消隐藏，历史全部回来。
 *
 * ## 存储形状（已裁决，不要改）
 * ```
 * key:   'packages:hidden'                     // GLOBAL_KEYS，设备级
 * value: { v: 1, items: { [packageId]: { hidden: boolean, at: string } } }
 * at:    new Date().toISOString()              // ISO 8601 定长，字典序 = 时间序
 * ```
 *
 * ## 为什么是 global
 * 判据见 `settingsScope.ts` 顶部那句「这个值换了孩子还成立吗」—— 成立。
 * 隐藏的是**书架上的包**，不是"哪个孩子的进度"；老大老二共用同一套书目，
 * 把键按 `profileId` 分片会出现"在老大的档案里藏了、切到老二又冒出来"。
 *
 * ## 墓碑为什么不能"优化"成删 key（本设计最容易被后来人改坏的一处）
 * 设备 A 隐藏 p：`{ p: { hidden: true, at: T1 } }`；设备 B 导入后取消隐藏：
 * `{ p: { hidden: false, at: T2>T1 } }`。若"取消隐藏"实现成**从 items 里删掉 p**，
 * 或整键删掉，A 那条旧记录在下一次合并时没有对手，p 会被**重新隐藏** ——
 * 用户看到的是"我明明取消过，它又自己藏起来了"，而且无法解释、无法修复。
 * 写 `{hidden:false, at}` 墓碑让 LWW 永远有得比，方向唯一正确。
 *
 * ## 为什么 `at` 相同取 `hidden:false`
 * 出错方向要选**看得见**：宁可多显示一个包（用户再点一次隐藏），也不要让包凭空
 * 消失（用户根本不知道怎么找回）。这个规则同时用在 `applyHidden()` 与
 * `mergeHiddenPackages()` 里 —— 两处不一致的话，本机刚隐藏的包会被下一次导入翻回来。
 *
 * ## 墓碑不清理
 * 包数 < 100，一条约 60 字节，全量常驻不到 6 KB。清理墓碑需要"所有设备都已同步"
 * 的全局信息，而离线优先的系统拿不到这个前提；为了省几 KB 引入"已被删除的旧备份
 * 让包复活"的 bug 完全不划算。
 *
 * ## 为什么没有内存镜像
 * 答题反馈（`feedbackSettings.ts`）要在同步热路径里读，才需要镜像。书架是页面级
 * 异步加载，而且导入备份后必须立刻看到合并结果 —— 镜像只会制造"导入完了但列表
 * 还是旧的"这类缓存不一致。这里每次都读 settings 真源。
 */

import { db } from '@/db'

/** 设备级 settings 键。**所有调用点必须 import 这个常量，不写字面量**：
 * `tests/settings-keys.test.ts` 的静态扫描器会跟着 import 解析到字面量，
 * 写 `'packages:hidden'` 也能过，但键名一旦分叉就没人拦得住了。 */
export const HIDDEN_PACKAGES_KEY = 'packages:hidden'

export interface HiddenPackageEntry {
  readonly hidden: boolean
  readonly at: string
}

export interface HiddenPackagesState {
  readonly v: 1
  readonly items: Record<string, HiddenPackageEntry>
}

/** 空状态。每次都新建对象，避免调用方拿到共享引用后改出"全员隐藏"。 */
export function emptyHiddenPackages(): HiddenPackagesState {
  return { v: 1, items: {} }
}

/**
 * 零抛归一化：脏 JSON、老版本、人工编辑过的备份都按"没隐藏"处理。
 *
 * 丢弃的条目：空 packageId、`hidden` 不是 boolean、`at` 不是非空字符串。
 * 丢弃一条墓碑的最坏后果是旧备份可能把包重新隐藏 —— 但那本来就是无法解析的
 * 脏数据，硬留着只会让 LWW 拿到一个不可比的 `at`。
 *
 * **items 的键按 packageId 排序**：不是洁癖。`mergeBundle` 判断"要不要写库"
 * 用的是 JSON.stringify 逐字节比较，对象键序不同会被当成两个值，于是每次导入
 * 都重写一遍、预览永远显示"发现新数据"（幂等性直接失效）。
 */
export function normalizeHiddenPackages(raw: unknown): HiddenPackagesState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyHiddenPackages()
  const obj = raw as Partial<HiddenPackagesState>
  const src = obj.items
  if (!src || typeof src !== 'object' || Array.isArray(src)) return emptyHiddenPackages()

  const items: Record<string, HiddenPackageEntry> = {}
  const ids = Object.keys(src as Record<string, unknown>).sort()
  for (const id of ids) {
    if (!id) continue
    const entry = (src as Record<string, unknown>)[id]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const rec = entry as Partial<HiddenPackageEntry>
    if (typeof rec.hidden !== 'boolean') continue
    if (typeof rec.at !== 'string' || rec.at === '') continue
    items[id] = { hidden: rec.hidden, at: rec.at }
  }
  return { v: 1, items }
}

/** 这个包现在该不该从书架主列表里撤下（`at` 不参与判断，只看最后一个值） */
export function isPackageHidden(state: HiddenPackagesState, packageId: string): boolean {
  if (!packageId) return false
  return state.items[packageId]?.hidden === true
}

/** 当前处于隐藏状态的包数（墓碑不计，否则"取消隐藏 N 次"会让计数虚高） */
export function hiddenPackageCount(state: HiddenPackagesState): number {
  let n = 0
  for (const id of Object.keys(state.items)) if (state.items[id].hidden) n++
  return n
}

/**
 * 写入一条隐藏/取消隐藏记录，返回**新**状态（不改入参）。
 *
 * `at` 相同不是覆盖，而是走与 `mergeHiddenPackages()` 完全相同的合规则
 * （`hidden && 旧值`，即"看得见优先"）。否则同一毫秒内"隐藏→取消→隐藏"会让本机
 * 停在 `hidden:true@T`，而合并结果算出 `false@T`，下一次导入就把它翻回去 ——
 * 用户会看到包自己冒出来。
 *
 * 非法入参（空 packageId / 空 at）原样返回，不抛、不写脏数据。
 */
export function applyHidden(
  state: HiddenPackagesState,
  packageId: string,
  hidden: boolean,
  at: string,
): HiddenPackagesState {
  if (!packageId || typeof at !== 'string' || at === '') return state
  const prev = state.items[packageId]
  const nextHidden = prev && prev.at === at ? hidden && prev.hidden : hidden
  return {
    v: 1,
    items: { ...state.items, [packageId]: { hidden: nextHidden, at } },
  }
}

/**
 * 逐项 LWW：按 `at` 字符串比较（ISO 8601 定长，字典序即时间序）。
 *
 * 不能用"本机整体优先"：两台设备各隐藏不同的包时，整体优先会丢掉另一台那半边。
 * 也不能用并集：取消隐藏的墓碑会被旧的 `hidden:true` 复活。逐项比时间两头都保住。
 *
 * `at` 相同取 `hidden:false`，用 `a.hidden && b.hidden` 表达：两边都 true 才 true，
 * 任一边 false 就是看得见。这与 `applyHidden()` 的同刻规则一致。
 *
 * 纯函数、零 I/O、零时钟、零随机 —— 和 `planMerge` 的其他合并器一样，
 * 这样"预览"与"确认"算出同一个值。
 */
export function mergeHiddenPackages(localRaw: unknown, remoteRaw: unknown): HiddenPackagesState {
  const local = normalizeHiddenPackages(localRaw)
  const remote = normalizeHiddenPackages(remoteRaw)
  const items: Record<string, HiddenPackageEntry> = {}

  for (const id of new Set([...Object.keys(local.items), ...Object.keys(remote.items)])) {
    const a = local.items[id]
    const b = remote.items[id]
    if (!a) items[id] = b
    else if (!b) items[id] = a
    else if (a.at > b.at) items[id] = a
    else if (b.at > a.at) items[id] = b
    else items[id] = { hidden: a.hidden && b.hidden, at: a.at }
  }

  // 这就是 normalize 已排过序仍要重建的原因：合并后的键集变了
  return { v: 1, items: Object.keys(items).sort().reduce<Record<string, HiddenPackageEntry>>(
    (acc, id) => { acc[id] = items[id]; return acc },
    {},
  ) }
}

/**
 * 读当前隐藏表。读失败按"没有隐藏任何包"处理 —— 书架宁可多显示一个包，
 * 也不能因为一条脏 settings 记录整个打不开。
 */
export async function loadHiddenPackages(): Promise<HiddenPackagesState> {
  try {
    const rec = await db.settings.get(HIDDEN_PACKAGES_KEY)
    return normalizeHiddenPackages(rec?.value)
  } catch {
    return emptyHiddenPackages()
  }
}

/** 整表落库（只在下面两个写入口调用，集中成一个访问点便于静态扫描与 review） */
async function writeHiddenPackages(state: HiddenPackagesState): Promise<HiddenPackagesState> {
  await db.settings.put({ key: HIDDEN_PACKAGES_KEY, value: state })
  return state
}

/** 隐藏 / 取消隐藏单个包。取消隐藏写墓碑，不删 items 里的键。 */
export async function savePackageHidden(
  packageId: string,
  hidden: boolean,
): Promise<HiddenPackagesState> {
  const state = await loadHiddenPackages()
  return writeHiddenPackages(applyHidden(state, packageId, hidden, new Date().toISOString()))
}

/**
 * 整表替换：设置页"批量取消隐藏"用。
 *
 * `ids` 里的是**最终要保持隐藏**的包。旧状态里其余包一律写 `hidden:false` 墓碑
 * （同样不删键），否则从旧的隐藏集合里消失的包会在下次与旧备份合并时复活。
 * 去重 + 过滤空白 id，同一批写入共用一个 `at`，顺序稳定。
 */
export async function setHiddenPackages(ids: readonly string[]): Promise<HiddenPackagesState> {
  const state = await loadHiddenPackages()
  const at = new Date().toISOString()
  const want = new Set((ids ?? []).filter((id): id is string => typeof id === 'string' && id.trim() !== ''))
  let next = state
  for (const id of want) next = applyHidden(next, id, true, at)
  for (const id of Object.keys(state.items)) {
    if (!want.has(id)) next = applyHidden(next, id, false, at)
  }
  return writeHiddenPackages(next)
}
