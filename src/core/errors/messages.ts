/**
 * 错误码 → 人话（V1.6 · Stage B · B4）
 *
 * ## 为什么要有这个文件
 * 家长看到的每一句话都应该是"发生了什么 + 现在怎么办"。在这之前，导入链路的文案
 * 散在 `ImportPreview.vue` 里（`REJECT_COPY` / `PROFILE_LIMIT_COPY` / `STALE_LOCAL_COPY`），
 * 而同一个 `profile-limit` 在 `Parent.vue` 里又是一句手写的 `message.error(...)` ——
 * 两处口径迟早分叉，分叉的方向通常是"一处说了怎么办、另一处只说了不行"。
 *
 * ## 三条纪律
 * 1. **键是错误码，值里不许出现错误码**。UI 只负责选择，不负责翻译。
 * 2. `title` 说的是"发生了什么"，`hint` 说的是"现在怎么办"。
 *    只写"导入失败"等于没说 —— 家长既不知道该重试还是该换文件（AC-P2-15 的教训）。
 * 3. `action` 只描述**动作的语义**（`id` + 按钮文案），**不写路由**。
 *    core 不认识 `/settings`、`/parent`；跳哪儿是 UI 的事，core 一旦引了路由就再也测不了。
 *
 * ## 为什么 `DataCloneError` 也在里面
 * 它不是我们抛的，是 Dexie 在 `put()` 时发现对象不能被结构化克隆抛的（深层 reactive
 * 代理进事务）。它的名字是英文技术词，直接显示给家长等于什么也没说。
 */

/** 用户可以点的那一步（`id` 由 UI 翻译成具体行为） */
export type FriendlyActionId = 'export-profiles' | 'repreview'

export interface FriendlyAction {
  id: FriendlyActionId
  label: string
}

export interface FriendlyError {
  /** 第一行：发生了什么 */
  title: string
  /** 第二行：现在怎么办（没有明确动作时，至少要说明"数据没动"） */
  hint: string
  /** 需要家长做一个具体动作时给出；`null` = 只解释，不需要按钮 */
  action: FriendlyAction | null
}

/**
 * 错误码 → 人话。
 *
 * 只收**会出现在家长面前**的码。学习包导入的 `E001`/`W020` 那套是给内容作者看的
 * 校验报告（`scripts/validate.ts` 的输出），不在这里翻译 —— 混进来会让这张表
 * 失去"只放高频事故"的边界。
 */
const MESSAGES: Record<string, FriendlyError> = {
  /**
   * 预览之后本机又产生了新记录（A6 · L2 陈旧快照守卫）。
   *
   * 这是**好的**失败：宁可让家长多点一次"确认导入"，也不能用备份里的旧值
   * 盖掉孩子刚才答对的题 —— 而后者不会报错，症状只是"刚答对的题又变回未掌握"。
   */
  'stale-local-data': {
    title: '检测到新的学习记录',
    hint: '为了数据安全，这次没有写入任何一行。请返回首页同步一下，再重新预览一次并导入。',
    action: { id: 'repreview', label: '重新选择文件' },
  },

  /**
   * 导入后档案数会超过上限（AC-P2-14：整笔拒绝，不做部分导入）。
   *
   * 文案里必须保留「超过 4 个档案」这几个字：`tests/e2e/backup-roundtrip.spec.ts`
   * 断言的就是它（家长搜这句话能找到原因）。改文案时同步改断言，别只改一边。
   */
  'profile-limit': {
    title: '导入后会超过 4 个档案',
    hint: '档案上限是 4 个。先导出一份备份，再删掉一个不用的档案，就能继续导入了。',
    action: { id: 'export-profiles', label: '导出并删除旧档案' },
  },

  /**
   * Dexie 拒绝写入：待写对象里有不能被结构化克隆的东西（典型是 Vue 的深层
   * reactive 代理）。属于**我们的** bug，但家长能做的只有"重试/刷新后重试"。
   */
  DataCloneError: {
    title: '这次导入没有写入任何数据',
    hint: '本机数据保持原样。请刷新页面后重新导入一次；如果反复出现，把下面的技术细节反馈给我们。',
    action: null,
  },
}

/** 未知错误码的兜底：只说"没写进去"，不猜原因（猜错比不说更糟） */
export const FALLBACK_FRIENDLY: FriendlyError = {
  title: '这次导入没有写入任何数据',
  hint: '本机数据保持原样，可以重新试一次；如果一直失败，把下面的技术细节反馈给我们。',
  action: null,
}

/**
 * 从任意异常里抠出错误码。
 *
 * 先看 `code`（我们自己抛的 Error 用这个），再退回 `name`
 * （`DataCloneError` 是 DOMException，只有 `name`）。两者都没有就返回空串 ——
 * 调用方据此走兜底文案，**不要**把 `e.message` 直接当文案显示。
 */
export function errorCodeOf(err: unknown): string {
  if (!err || typeof err !== 'object') return ''
  const { code, name } = err as { code?: unknown; name?: unknown }
  if (typeof code === 'string' && code.length > 0) return code
  if (typeof name === 'string' && name.length > 0) return name
  return ''
}

/**
 * 查表。命中返回人话，未命中返回 `FALLBACK_FRIENDLY`（**永不返回 null**）。
 *
 * 为什么兜底而不是 null：调用方写 `friendlyOf(code)?.title ?? '兜底'` 时，
 * 那个 `??` 一旦漏写就会渲染成 `undefined`。永不返回 null 就没有这个空档。
 */
export function friendlyOf(code: string | null | undefined): FriendlyError {
  if (!code) return FALLBACK_FRIENDLY
  return MESSAGES[code] ?? FALLBACK_FRIENDLY
}

/** 这个码是否被翻译过（测试与排障用；UI 不需要） */
export function hasFriendlyMessage(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(MESSAGES, code)
}
