/**
 * 备份文件的**版本路由**（V1.4 · B2 / `system_design-v1.4.md` §7.2）
 *
 * ## 为什么必须有且只有一个入口
 * 备份文件的版本判断散落在 N 个调用点，最典型的坏结果是"两处口径不一致"：
 * 导出侧认为自己是 v2，导入侧按 v1 解析 —— 于是 `profiles` 数组被当成未知字段丢掉，
 * 用户看到的是"导入成功，但数据没了"。所以判断只写在这个纯函数里，
 * `exportService` / UI / 测试全部走它。
 *
 * ## 为什么**不尝试修复**任何结构性错误
 * 备份可能被人工打开、编辑、再导入。遇到"行内 `profileId` 与外层不一致"这类矛盾时，
 * 有两个选择：
 *   a) 按外层归属静默写入 —— 错误被吃掉，等到合并完成后才以"数据串了"的形式显现，
 *      那时已经无法区分哪条本来是哪个孩子的；
 *   b) 直接拒绝并说明原因 —— 用户会看到"这份备份有问题"，但**数据是干净的**。
 * 本函数一律选 b。唯一允许的"宽容"是：v1 里多余的字段（`packages` 等）按设计忽略。
 *
 * ## 纯函数
 * 不读 db、不读时钟、不产生随机。所以 `tests/backup-route.test.ts` 可以穷举分支。
 */

import {
  APP_FORMAT_VERSION,
  type BackupRejectReason,
  type BackupRoute,
  type BackupV2,
  type LegacyFlat,
} from './types'
import { classifyKey } from '@core/profile/settingsScope'

/** 拼一条拒绝结果（三处 detail 的写法统一在这里，避免各处自己编文案） */
function reject(reason: BackupRejectReason, detail: string): BackupRoute {
  return { kind: 'reject', reason, detail }
}

/** `formatVersion` 探测结果：缺失 / 可识别的数字 / 无法识别 */
type VersionProbe = { kind: 'absent' } | { kind: 'number'; value: number } | { kind: 'bad' }

/**
 * 解析 `formatVersion`。
 *
 * 历史事实：v1 备份里的 `version` 字段是字符串 `'1.0'`（见 `exportService` 旧实现），
 * 而 `formatVersion` 是 v2 新引入的数字。两者都可能出现在文件里，所以这里
 * **只认 `formatVersion`**（`version` 是 v1 自己的字段，语义是"旧格式版本"，不参与路由）。
 */
function probeVersion(raw: unknown): VersionProbe {
  if (raw === undefined || raw === null) return { kind: 'absent' }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { kind: 'bad' }
    return { kind: 'number', value: raw }
  }
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (text === '') return { kind: 'absent' }
    // 只接受纯数字（含 `2.0` 这种写法），`'2-beta'` 之类的花活一律视为无法识别
    if (!/^\d+(?:\.\d+)?$/.test(text)) return { kind: 'bad' }
    const value = Number(text)
    return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'bad' }
  }
  return { kind: 'bad' }
}

/** 是不是"可以当对象看"的值（`null` / 数组 / 原始值都不算） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 数组字段校验：缺省视为"没有数据"，非数组（且非 undefined）视为结构损坏 */
function isArrayOrAbsent(value: unknown): boolean {
  return value === undefined || Array.isArray(value)
}

/** 数组里每一行都得是对象（`null` / 字符串行无法参与合并，只能拒绝） */
function rowsAreObjects(rows: unknown): boolean {
  if (!Array.isArray(rows)) return false
  return rows.every((row) => isPlainObject(row))
}

/**
 * v1 结构校验。
 *
 * 只校验"形状"，不校验业务字段（v1 的业务字段本来就残缺，由适配器按缺失处理）。
 * 但 `progress: "oops"` 这种形状错误必须拒绝 —— 适配器把它当 `[]` 会让用户
 * 以为"导入成功但没数据"，而真实原因是文件坏了。
 */
function validateLegacy(flat: Record<string, unknown>): BackupRoute | null {
  for (const field of ['progress', 'mistakes', 'settings', 'packages'] as const) {
    const value = flat[field]
    if (!isArrayOrAbsent(value)) {
      return reject('malformed', `旧版备份的 ${field} 字段不是数组，文件可能已损坏`)
    }
    if (Array.isArray(value) && !rowsAreObjects(value)) {
      return reject('malformed', `旧版备份的 ${field} 里有非对象的行，文件可能已损坏`)
    }
  }
  return null
}

/**
 * 校验单行数据的 `profileId` 与外层所属档案是否一致。
 *
 * 返回 `'ok'` / `'missing'`（结构缺失）/ `'mismatch'`（明确不一致）。
 * `missing` 也算结构损坏：v2 的行**必填** `profileId`（`@/db` 里是必填字段），
 * 缺了就说明文件被改过，此时"按外层归属写入"正是我们要避免的静默修复。
 */
function checkRowPid(row: Record<string, unknown>, ownerPid: string): 'ok' | 'missing' | 'mismatch' {
  const pid = row.profileId
  if (typeof pid !== 'string' || pid === '') return 'missing'
  return pid === ownerPid ? 'ok' : 'mismatch'
}

/**
 * 校验 `settings` 行的键是否属于本档案。
 *
 * 为什么连 settings 也要查：v2 里 `settings` 的键是**全名**（`dailyStats:p1`），
 * 合并时直接 `settings.put`。若 `p1` 的 bundle 里混进了 `dailyStats:p2`，
 * 会被原样写进 `p2` 的键 —— 与行内 pid 写错是同一类错误，且同样没有任何症状。
 */
function checkSettingKeys(rows: unknown[], ownerPid: string): 'ok' | 'mismatch' {
  for (const row of rows) {
    if (!isPlainObject(row)) continue
    const key = row.key
    if (typeof key !== 'string' || key === '') continue
    const scope = classifyKey(key)
    if (scope.kind === 'profile' && scope.profileId !== ownerPid) return 'mismatch'
  }
  return 'ok'
}

/**
 * v2 结构校验 + 归一化（只做**类型收窄**，不改任何值）。
 * 返回 `null` 表示通过，否则返回拒绝结果。
 */
function validateV2(doc: Record<string, unknown>): BackupRoute | null {
  if (typeof doc.exportedAt !== 'string') {
    return reject('malformed', '备份缺少 exportedAt（导出时间），文件可能已损坏')
  }
  if (typeof doc.appVersion !== 'string') {
    return reject('malformed', '备份缺少 appVersion，文件可能已损坏')
  }
  if (typeof doc.activeProfileId !== 'string') {
    return reject('malformed', '备份缺少 activeProfileId，文件可能已损坏')
  }
  if (!Array.isArray(doc.profiles) || doc.profiles.length === 0) {
    return reject('malformed', '备份里没有任何档案数据（profiles 为空）')
  }
  if (!rowsAreObjects(doc.globalSettings)) {
    return reject('malformed', '备份的 globalSettings 不是数组或含非对象行')
  }

  for (const [index, raw] of (doc.profiles as unknown[]).entries()) {
    if (!isPlainObject(raw)) {
      return reject('malformed', `第 ${index + 1} 个档案不是对象，文件可能已损坏`)
    }
    const pid = raw.profileId
    if (typeof pid !== 'string' || pid === '') {
      return reject('malformed', `第 ${index + 1} 个档案缺少 profileId`)
    }
    if (typeof raw.name !== 'string') {
      return reject('malformed', `档案 ${pid} 缺少 name`)
    }
    if (typeof raw.createdAt !== 'string') {
      return reject('malformed', `档案 ${pid} 缺少 createdAt`)
    }
    for (const field of ['progress', 'mistakes', 'examSessions', 'settings'] as const) {
      const rows = raw[field]
      if (!Array.isArray(rows)) {
        return reject('malformed', `档案 ${pid} 的 ${field} 不是数组`)
      }
      if (!rowsAreObjects(rows)) {
        return reject('malformed', `档案 ${pid} 的 ${field} 里有非对象的行`)
      }
    }

    // 行内 pid 与外层不一致 / settings 键后缀指向别的档案 → mismatch
    for (const field of ['progress', 'mistakes', 'examSessions'] as const) {
      for (const row of raw[field] as Record<string, unknown>[]) {
        const res = checkRowPid(row, pid)
        if (res === 'missing') {
          return reject('malformed', `档案 ${pid} 的 ${field} 有一行缺少 profileId`)
        }
        if (res === 'mismatch') {
          return reject(
            'mismatch',
            `档案 ${pid} 的 ${field} 里有一行的 profileId 是 ${String(row.profileId)}，` +
              `与外层所属档案不一致（备份可能被手工改过）`
          )
        }
      }
    }
    if (checkSettingKeys(raw.settings as unknown[], pid) === 'mismatch') {
      return reject('mismatch', `档案 ${pid} 的 settings 里有关键字指向别的档案（后缀与 pid 不符）`)
    }
  }

  return null
}

/**
 * 把任意输入路由到 v1 / v2 / 拒绝。
 *
 * @param json 已 `JSON.parse` 的备份内容（**不是**字符串）
 * @param appFormatVersion 本设备支持的格式版本，默认 `APP_FORMAT_VERSION`。
 *   单独暴露是为了让测试能模拟"旧客户端读到新备份"。
 */
export function routeBackup(
  json: unknown,
  appFormatVersion: number = APP_FORMAT_VERSION
): BackupRoute {
  // ① 连对象都不是 → unknown（不是"格式坏"，是"根本不是备份"）
  if (!isPlainObject(json)) {
    return reject('unknown', '这不是一份可识别的备份文件（内容不是 JSON 对象）')
  }

  const probe = probeVersion(json.formatVersion)
  if (probe.kind === 'bad') {
    return reject(
      'unknown',
      `无法识别的备份格式版本：${String(json.formatVersion)}，请确认文件是否完整`
    )
  }

  // ② 缺失 → v1（v1 备份根本没有 formatVersion 字段）
  if (probe.kind === 'absent') {
    const bad = validateLegacy(json)
    if (bad) return bad
    return { kind: 'v1', data: json as LegacyFlat }
  }

  // ③ 来自更新的版本
  if (probe.value > appFormatVersion) {
    return reject('too-new', '这份备份来自更新的版本，请先升级本设备')
  }

  // ④ v2
  if (probe.value === APP_FORMAT_VERSION) {
    const bad = validateV2(json)
    if (bad) return bad
    return { kind: 'v2', data: json as unknown as BackupV2 }
  }

  // ⑤ 比 v2 旧（`'1.0'` / `1` / `1.9` 之类）→ 当 v1 处理。
  // 为什么 `1.9` 也当 v1：v1 时代只有一个真实写入过的版本，`version: '1.0'`；
  // 其它小数值都是同一个扁平结构，按 v1 解析比拒绝更接近事实。
  const bad = validateLegacy(json)
  if (bad) return bad
  return { kind: 'v1', data: json as LegacyFlat }
}
