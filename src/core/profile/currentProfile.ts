/**
 * 当前档案的**唯一真相**（V1.4 · B1 / `system_design-v1.4.md` §5.1）
 *
 * ## 为什么所有写入都从这里取 `profileId`，而不是作为参数传
 * V1.3 把 `recordProgress` 的第 1 参数语义改成了"入口包"，说明"让调用方自己传标识"
 * 这条路是走不通的 —— 4 个调用点能改对，第 5 个不保证。
 * `profileId` 更危险：传错不会报错，只会把记录写进另一个孩子的档案，
 * 而统计层看不出任何异常（数字都对，只是归属错）。
 * 所以这里**不提供参数入口**，只提供"读当前档案"。
 *
 * ## 未初始化时为什么返回 `default` 而不是抛错
 * 设计文档原本写的是"未初始化直接抛（fail loud）"。实施时改成**惰性默认**，
 * 理由是：
 *   1. 应用启动时 `main.ts` 会 `await initProfile()` 后才挂载组件，
 *      在此之前**没有任何用户交互**能触发写入 —— 这个窗口里的"猜错的档案"
 *      在物理上不可能发生。
 *   2. 反过来，抛错会让 2100 条既有的纯逻辑测试全部需要先造档案才能跑，
 *      测试与实现耦合更紧、坏处更实在。
 *   3. 即使 `initProfile()` 读库失败，回落到 `default` 也**正是迁移的口径**
 *      （v4 把所有存量数据放进 `default`），不会写进一个不存在的档案。
 * 所以真正需要 fail loud 的地方是 `createProfile`（超上限）与导入（档案不存在），
 * 那两个地方都抛了。
 *
 * ## 缓存重置
 * `dailyStats` / `attemptedTypes` 都有模块级内存缓存（避免热路径 I/O）。
 * 切档案后这些缓存**必须失效**，否则老二会看到老大的今日题量。
 * 用 `onProfileChange()` 注册回调，由各模块自己登记重置函数 ——
 * `currentProfile` 不 import 它们（否则又是循环依赖）。
 */
import { db } from '@/db'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  MAX_PROFILES,
  PROFILES_KEY,
  ProfileLimitError,
  makeProfileId,
  normalizeProfilesState,
  type ProfileMeta,
  type ProfilesState,
} from './profileTypes'

export {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  MAX_PROFILES,
  PROFILES_KEY,
  ProfileLimitError,
  type ProfileMeta,
  type ProfilesState,
}

let state: ProfilesState = normalizeProfilesState(null)
let initialized = false

const listeners = new Set<(next: ProfilesState, prev: ProfilesState) => void>()

/** 同步读当前档案 id。所有写入路径用它，**不接受外部传入**。 */
export function currentProfileId(): string {
  return state.activeId
}

/** 同步读当前档案元数据 */
export function currentProfile(): ProfileMeta {
  return state.list.find((p) => p.id === state.activeId) ?? state.list[0]
}

/** 同步读整个状态（UI 渲染用） */
export function profilesState(): ProfilesState {
  return state
}

export function listProfilesSync(): ProfileMeta[] {
  return [...state.list]
}

export function isProfileInitialized(): boolean {
  return initialized
}

/**
 * 注册"档案变了"的回调。返回反注册函数。
 * 各带内存缓存的模块在文件底部登记一次即可（见 dailyStats / attemptedTypes）。
 */
export function onProfileChange(
  fn: (next: ProfilesState, prev: ProfilesState) => void
): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(next: ProfilesState, prev: ProfilesState): void {
  for (const fn of listeners) {
    try {
      fn(next, prev)
    } catch (e) {
      // 某个监听器坏了不能拖垮切换流程（否则进不去任何档案）
      console.warn('[profile] onProfileChange 监听器抛错，已忽略', e)
    }
  }
}

/** 读库并落定状态。启动时调用一次（`main.ts`）。读失败 → 保持 default。 */
export async function initProfile(): Promise<ProfilesState> {
  try {
    const rec = await db.settings.get(PROFILES_KEY)
    state = normalizeProfilesState(rec?.value)
  } catch (e) {
    console.warn('[profile] 读取档案列表失败，回落默认档案', e)
    state = normalizeProfilesState(null)
  }
  initialized = true
  // 首次落库：让 `profiles` 键一定存在（否则导出/导入时缺这个键，
  // 备份还原后要靠"没读到就新建"兜，多一条分支）
  try {
    await db.settings.put({ key: PROFILES_KEY, value: state })
  } catch {
    /* 写不进去不影响本次运行，下次启动再补 */
  }
  return state
}

async function persist(next: ProfilesState): Promise<void> {
  await db.settings.put({ key: PROFILES_KEY, value: next })
}

/** 切换当前档案。id 不存在 → 抛错（不静默切换，否则 UI 与数据会不一致） */
export async function switchProfile(id: string): Promise<ProfilesState> {
  if (!state.list.some((p) => p.id === id)) {
    throw new Error(`[profile] 档案不存在：${id}`)
  }
  if (state.activeId === id) return state

  // 切换前要让上层把待结算的东西结算完（成就 toast、每日统计落盘）。
  // 这里不认识那些模块，靠 `beforeSwitch` 钩子。
  await flushBeforeSwitch()

  const prev = state
  const next: ProfilesState = { ...state, activeId: id }
  state = next
  await persist(next)
  emit(next, prev)
  return next
}

type BeforeSwitchHook = () => Promise<void> | void
const beforeSwitchHooks: BeforeSwitchHook[] = []

/** 切换档案**之前**要跑完的事（结算成就、落盘缓存）。可注册多个。 */
export function onBeforeProfileSwitch(fn: BeforeSwitchHook): void {
  beforeSwitchHooks.push(fn)
}

async function flushBeforeSwitch(): Promise<void> {
  for (const fn of beforeSwitchHooks) {
    try {
      await fn()
    } catch (e) {
      // 结算失败不能阻止切换（否则用户被卡死在当前档案里）
      console.warn('[profile] 切换前结算失败，继续切换', e)
    }
  }
}

/** 新建档案。超过上限抛 `ProfileLimitError`。 */
export async function createProfile(name: string, now: Date = new Date()): Promise<ProfileMeta> {
  if (state.list.length >= MAX_PROFILES) throw new ProfileLimitError(MAX_PROFILES)

  const trimmed = name.trim() || `档案 ${state.list.length + 1}`
  const meta: ProfileMeta = {
    id: makeProfileId(now),
    name: trimmed,
    createdAt: now.toISOString(),
  }
  const prev = state
  const next: ProfilesState = { activeId: meta.id, list: [...state.list, meta] }
  state = next
  await persist(next)
  emit(next, prev)
  return meta
}

/** 改名。id 不存在 → 抛错。 */
export async function renameProfile(id: string, name: string): Promise<ProfilesState> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('[profile] 档案名不能为空')
  if (!state.list.some((p) => p.id === id)) throw new Error(`[profile] 档案不存在：${id}`)

  const prev = state
  const next: ProfilesState = {
    ...state,
    list: state.list.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
  }
  state = next
  await persist(next)
  emit(next, prev)
  return next
}

/**
 * 删除档案。**只删档案条目，不删数据行**。
 *
 * 这是有意为之：`progress` / `mistakes` / `achievements:<pid>` 留在库里，
 * 重新建一个同名档案时数据不会被"继承"（id 不同），但这些行成了孤儿。
 * 本版不做物理清理（清理需要跨三张表 + 8 个键的删除，风险远大于收益）；
 * 代价是库里会累积不可见行，量级是每档案几千行，可接受。
 *
 * 至少保留 1 个档案：删到 0 会让 `currentProfileId()` 指向不存在的 id。
 */
export async function deleteProfile(id: string): Promise<ProfilesState> {
  if (state.list.length <= 1) throw new Error('[profile] 至少要保留 1 个档案')
  if (!state.list.some((p) => p.id === id)) throw new Error(`[profile] 档案不存在：${id}`)

  const prev = state
  const list = state.list.filter((p) => p.id !== id)
  const activeId = state.activeId === id ? list[0].id : state.activeId
  const next: ProfilesState = { activeId, list }
  state = next
  await persist(next)
  emit(next, prev)
  return next
}

/** 仅供测试：把状态重置为"只有 default，未初始化" */
export function __resetProfileForTest(): void {
  state = normalizeProfilesState(null)
  initialized = false
  listeners.clear()
  beforeSwitchHooks.length = 0
}
