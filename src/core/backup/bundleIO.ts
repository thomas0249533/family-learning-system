/**
 * 本机数据 → 快照 / v2 备份文件的**读取层**（V1.4 · B2 / `system_design-v1.4.md` §6.4、§7.1、§7.3）
 *
 * ## 为什么读快照要"逐档案"读，而不是 `toArray()` 再分组
 * v4 之后三张表的复合索引都是 `[profileId+...]`。按 `where('profileId').equals(pid)`
 * 读，Dexie 走索引；`toArray()` 会把整表搬进内存再在 JS 里分组。
 * 更重要的不是性能，而是**正确性**：`db.progress.toArray()` 是 `scripts/check-profile-scope.mjs`
 * 判定为"跨档案读"的写法，它出现在导出路径上会让"导出"与"档案"脱钩 ——
 * 一旦将来有人把这段代码复制到读取路径上，两个孩子就串了。
 * 所以本文件**没有一处**裸 `toArray()` 读这四张表（V3.0 · M4 起含 `cardCompletions`）。
 *
 * ## 为什么导出的 settings 要两套口径
 * - `LocalSnapshot.bundles[].settings` 是 `Record<基名, 值>`（合并引擎用它，键不带 pid，
 *   由合并函数再拼回去，见 `types.ts` 的 `Bundle` 注释）。**只取 `PROFILE_SCOPED_KEYS`
 *   里登记的分片键**（V1.4·B3 起含 `customChecks`）：
 *   合并函数只认识登记过的那些，塞进去更多只会被静默丢掉，反而掩盖问题。
 * - `BackupV2.profiles[].settings` 是 `SettingRecord[]`（**全名**键，直接 `settings.put`）。
 *   这里**要尽量带全** —— 备份是"用户的全部数据"，静默漏掉一个键，用户恢复后
 *   那个键就永久消失了，且没有任何提示。所以除了登记过的分片键，还带上
 *   "能确定属于这个档案的未知键"（见 `splitSettings`）。
 *
 * ## 全局键的黑名单
 * `migration:v3` / `migration:v4` / `owner:indexCache` / `progress:lastRecovery` 这些是
 * **"本机跑过什么"** 的记录，不是用户数据。把它们搬进备份、再恢复到另一台设备上，
 * 那台设备会误以为自己已经迁移过 → 跳过真正的迁移（这是最坏的后果：新设备上
 * 存量数据永远不迁移）。所以导出时直接排除，不从备份里还原。
 */

import { db } from '@/db'
import type {
  CardCompletionRecord,
  ExamSessionRecord,
  MistakeRecord,
  ProgressRecord,
  SettingRecord,
} from '@/db'
import {
  listProfilesSync,
  profilesState,
} from '@core/profile/currentProfile'
import type { ProfileMeta } from '@core/profile/profileTypes'
import { classifyKey } from '@core/profile/settingsScope'
import pkg from '../../../package.json'
import { APP_FORMAT_VERSION, type BackupV2, type Bundle, type LocalSnapshot } from './types'

/**
 * 应用版本：**仅排障用，不参与任何判断**（`types.ts` 里 `appVersion` 的注释）。
 * 从 `package.json` 直接取，避免手写常量与真实版本漂移（写死 `'1.4.0'` 会在
 * 下一次发版时变成谎言，而备份文件正是排查"哪个版本写出来的"时唯一的线索）。
 */
const pkgVersion = (pkg as { version?: unknown }).version
const APP_VERSION: string =
  typeof pkgVersion === 'string' && pkgVersion !== '' ? pkgVersion : 'unknown'

/** 导出时要排除的全局键（见文件头"全局键的黑名单"） */
export const EXPORT_EXCLUDED_GLOBAL_KEYS: ReadonlySet<string> = new Set([
  'migration:v3',
  'migration:v4',
  'owner:indexCache',
  'progress:lastRecovery',
  'progress:lastStartupRecovery',
  // V3.0 · M4：自动快照本身就是一份备份。跟着备份导出会自我嵌套（备份里 7 份备份，
  // 每份又含快照），体积指数膨胀；且恢复一台新设备时不需要别人的快照。
  'backup:snapshots',
])

/** 单个档案在库里的四张表行（V3.0 · M4 起 `cardCompletions` 也在内） */
interface ProfileRows {
  progress: ProgressRecord[]
  mistakes: MistakeRecord[]
  examSessions: ExamSessionRecord[]
  cardCompletions: CardCompletionRecord[]
}

/**
 * 一条已确定归属的 settings 行。
 *
 * 为什么要带上 `base` 与 `registered`：两个导出函数需要的形态不同
 * （Bundle 要基名、备份文件要全名），但**归属判断必须只做一次** ——
 * 两处各判一次就会出现"备份里有、快照里没有"这种自相矛盾的导出结果。
 */
interface ScopedSetting {
  profileId: string
  /** 剥掉 `:<pid>` 之后的基名（`dailyStats`） */
  base: string
  /** 是不是 `PROFILE_SCOPED_KEYS` 里登记过的键之一 */
  registered: boolean
  record: SettingRecord
}

/** 一次读库的原始结果（两个导出函数共用，避免读两遍） */
interface LocalDump {
  profiles: ProfileMeta[]
  activeProfileId: string
  rows: Map<string, ProfileRows>
  /** 只含**当前档案列表里**的档案 */
  scopedSettings: ScopedSetting[]
  /** 全局键现值（含"分不清归属"的未知键，见 splitSettings） */
  globalSettings: SettingRecord[]
}

/**
 * 把 settings 表拆成"按档案分片"与"全局"两份。
 *
 * 三种归属不明的键怎么处理，都在这里定死：
 *   1. `profile` 且 pid **已不在档案列表里**（删过档案留下的孤儿）→ **丢弃**。
 *      与三张表的口径一致：只导当前档案列表里的档案。若把孤儿键带上，
 *      导入时合并引擎会为一个"已删除的档案"建新档案 —— 复活一个用户明确删掉的档案，
 *      还可能撞 4 个的上限导致整笔导入被拒（AC-P2-14）。
 *   2. `profile-legacy`（无后缀，v4 迁移后不该存在）→ 归入"全局"。
 *      不猜它属于谁：猜错等于把一个孩子的徽章挪给另一个。
 *   3. `unknown`（任何清单都没登记）→ 能按 `:<pid>` 认出归属就按档案带；认不出就归入"全局"。
 *      宁可多带（恢复后至少还在），也不静默丢。
 */
function splitSettings(
  allRows: SettingRecord[],
  knownPids: ReadonlySet<string>
): { scoped: ScopedSetting[]; global: SettingRecord[] } {
  const scoped: ScopedSetting[] = []
  const global: SettingRecord[] = []

  for (const row of allRows) {
    if (!row || typeof row.key !== 'string' || row.key === '') continue
    const key = row.key
    const scope = classifyKey(key)

    if (scope.kind === 'global') {
      if (!EXPORT_EXCLUDED_GLOBAL_KEYS.has(key)) global.push({ key, value: row.value })
      continue
    }
    if (scope.kind === 'profile') {
      if (knownPids.has(scope.profileId)) {
        scoped.push({
          profileId: scope.profileId,
          base: scope.base,
          registered: true,
          record: { key, value: row.value },
        })
      }
      continue
    }
    if (scope.kind === 'profile-legacy') {
      global.push({ key, value: row.value })
      continue
    }
    // unknown：尝试用已知 pid 的后缀认领
    const owner = [...knownPids].find((pid) => key.endsWith(`:${pid}`))
    if (owner) {
      scoped.push({
        profileId: owner,
        base: key.slice(0, key.length - owner.length - 1),
        registered: false,
        record: { key, value: row.value },
      })
    } else {
      global.push({ key, value: row.value })
    }
  }

  return { scoped, global }
}

/**
 * 读一次库，得到两个导出函数需要的一切。
 *
 * **在事务外读**（§6.4）：导入/导出都不该把"读快照"塞进写事务里，
 * 否则大库的读耗时会撞 Dexie 的 5 秒事务超时。
 */
async function dumpLocal(): Promise<LocalDump> {
  const profiles = listProfilesSync()
  const activeProfileId = profilesState().activeId
  const rows = new Map<string, ProfileRows>()
  // 单测替身（fakeDexie）不一定建了 `cardCompletions`（db v8 才加的表）。
  // 真库里一定在。查一次存在性，避免在循环里包 try/catch 掩盖真正的读库错误。
  const marksTable = (db as unknown as { cardCompletions?: typeof db.cardCompletions })
    .cardCompletions

  for (const profile of profiles) {
    const pid = profile.id
    // 四张表都走 `where('profileId')`：这是门禁要求的写法，也是唯一正确的读法
    const progress = await db.progress.where('profileId').equals(pid).toArray()
    const mistakes = await db.mistakes.where('profileId').equals(pid).toArray()
    const examSessions = await db.examSessions.where('profileId').equals(pid).toArray()
    // 读不到表 → 当"没有标记"：备份少带几条便利标记可以忍，整笔导入失败不可忍
    const cardCompletions = marksTable
      ? await marksTable.where('profileId').equals(pid).toArray()
      : []
    rows.set(pid, { progress, mistakes, examSessions, cardCompletions })
  }

  const allSettings = await db.settings.toArray()
  const knownPids = new Set(profiles.map((p) => p.id))
  const { scoped, global } = splitSettings(allSettings, knownPids)

  return { profiles, activeProfileId, rows, scopedSettings: scoped, globalSettings: global }
}

/** 空档案的四张表（避免各处写 `?? []` 时漏字段） */
function emptyRows(): ProfileRows {
  return { progress: [], mistakes: [], examSessions: [], cardCompletions: [] }
}

/**
 * 读本机现状，供合并引擎使用。
 *
 * `bundles` 的 `settings` 是**基名 → 值**，且只含登记过的分片键中出现过的那些
 * （`Bundle` 契约）。某张表为空 → `[]`，不省略字段。
 */
export async function readLocalSnapshot(): Promise<LocalSnapshot> {
  const dump = await dumpLocal()

  // 基名 → 值，按 pid 分组，便于 O(1) 取（避免 8 × N 次字符串比较）
  const settingsByPid = new Map<string, Record<string, unknown>>()
  for (const profile of dump.profiles) settingsByPid.set(profile.id, {})
  for (const entry of dump.scopedSettings) {
    // 只有登记过的分片键进 Bundle：合并函数只认识这些，其它塞进来会被静默丢掉，
    // 反而掩盖"某个键没被合并"的问题（未知键在备份文件里仍然带，见 buildBackupV2）
    if (!entry.registered) continue
    const bucket = settingsByPid.get(entry.profileId)
    if (!bucket) continue
    bucket[entry.base] = entry.record.value
  }

  const bundles: Bundle[] = dump.profiles.map((profile) => {
    const rows = dump.rows.get(profile.id) ?? emptyRows()
    return {
      profileId: profile.id,
      name: profile.name,
      createdAt: profile.createdAt,
      progress: rows.progress,
      mistakes: rows.mistakes,
      examSessions: rows.examSessions,
      cardCompletions: rows.cardCompletions,
      settings: settingsByPid.get(profile.id) ?? {},
    }
  })

  const globalSettings: Record<string, unknown> = {}
  for (const row of dump.globalSettings) globalSettings[row.key] = row.value

  return {
    profiles: dump.profiles,
    activeProfileId: dump.activeProfileId,
    bundles,
    globalSettings,
  }
}

/**
 * 构建一份完整的 v2 备份文件内容（不含下载/落盘，纯数据）。
 *
 * 与 `readLocalSnapshot` 同源同构，唯一差别是 settings 保留**全名**键
 * （备份文件要能被 `settings.put` 直接写回，见文件头第二段）。
 *
 * 空档案也照样输出：`profiles: []` 的场景不该出现（至少有 1 个档案），
 * 但空表必须写 `[]` 而不是省略 —— 省略会让 `routeBackup` 判定为结构损坏。
 */
export async function buildBackupV2(): Promise<BackupV2> {
  const dump = await dumpLocal()

  const settingsByPid = new Map<string, SettingRecord[]>()
  for (const profile of dump.profiles) settingsByPid.set(profile.id, [])
  for (const entry of dump.scopedSettings) {
    // 备份**带全**（含未登记的未知键）：静默漏一个键，用户恢复后那个键就永久消失了
    settingsByPid.get(entry.profileId)?.push(entry.record)
  }

  return {
    formatVersion: APP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    activeProfileId: dump.activeProfileId,
    profiles: dump.profiles.map((profile) => {
      const rows = dump.rows.get(profile.id) ?? emptyRows()
      return {
        profileId: profile.id,
        name: profile.name,
        createdAt: profile.createdAt,
        progress: rows.progress,
        mistakes: rows.mistakes,
        examSessions: rows.examSessions,
        cardCompletions: rows.cardCompletions,
        // 键已带 `:<pid>` 后缀（`scopedKey` 拼出来的就是全名，这里只是把契约写明）
        settings: settingsByPid.get(profile.id) ?? [],
      }
    }),
    globalSettings: dump.globalSettings,
  }
}
