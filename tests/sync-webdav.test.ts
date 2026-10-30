/**
 * F2-core · WebDAV 同步通道（V1.11 · Stage F）
 *
 * ## 这份测试要钉住的四件事
 *  1. **URL 拼接**是最容易出错又最不显眼的一层：地址一错就是"找不到文件"，
 *     而家长会以为网络坏了。所以覆盖中文、空格、已编码、多余斜杠、非法档案 id。
 *  2. **失败分类必须可断言**：CORS 是**网页版**的现实约束（浏览器不给网页放行跨域），
 *     桌面端自 P3 起改走 Rust 的 `webdav_fetch`（见 `src-tauri/src/net.rs`）已能真正连通；
 *     但两端的失败都必须是一条明确的路，而不是笼统的"失败了"。
 *  3. **合并前置校验**：跨档案的数据必须在进 `planMerge` 之前被拦下 ——
 *     一旦进去，别人家的档案就会被当成"新档案"静默造出来。
 *  4. **单调不减不能被通道破坏**：最后一组用例跑完整条链路
 *     （下载 → 前置校验 → planMerge → applyMergePlan → 落库），
 *     断言本机更晚的行**一行都不会退回去**。这条配了反向验证
 *     （把合并改成覆盖式后它必须变红，红绿原文见 `docs/memory/2026-10-22-v1.11-stage-f.md`）。
 *
 * ## 替身
 * 假 db 来自 `tests/helpers/fakeDexie.ts`（索引清单与 `src/db/index.ts` 的 v4 逐字对应）；
 * fetch 是**注入的替身**，一个真报文都不发。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import type { ProgressRecord } from '@/db'
import type { Bundle, LocalSnapshot } from '@core/backup/types'
import type {
  FetchInitLike,
  FetchLike,
  FetchResponseLike,
  WebDavError,
} from '@core/sync/webdavClient'
import { createFakeDexie } from './helpers/fakeDexie'

const fake = createFakeDexie()
vi.mock('@/db', () => ({ db: fake.db }))

const webdav = await import('@core/sync/webdavClient')
const sync = await import('@core/sync/syncManager')
const { planMerge } = await import('@core/merge/mergeBundle')
const { APP_FORMAT_VERSION } = await import('@core/backup/types')
const { initProfile, __resetProfileForTest } = await import('@core/profile/currentProfile')
const { invalidateOwnerIndex } = await import('@core/progress/ownerIndexCache')

const CFG = { baseUrl: 'https://dav.example.com/dav/', username: 'papa', password: 'secret' }
const T0 = '2025-01-01T00:00:00.000Z'
const T1 = '2025-02-01T00:00:00.000Z'
const T2 = '2025-03-01T00:00:00.000Z'

interface CallRecord {
  url: string
  init?: FetchInitLike
}

function okJson(body: unknown): FetchResponseLike {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    type: 'basic',
    text: async () => text,
    json: async () => JSON.parse(text),
  }
}

/** 透明响应：`mode: 'no-cors'` 请求的形态 —— 拿得到承诺，拿不到任何字节 */
function opaqueResponse(): FetchResponseLike {
  return {
    ok: true,
    status: 0,
    type: 'opaque',
    text: async () => '',
    json: async () => {
      throw new Error('opaque response 没有正文')
    },
  }
}

/** `ok` 由状态码推出 —— 与原生 `Response.ok` 同语义（假的替身不能有一套自己的口径） */
function statusResponse(status: number, statusText: string): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    type: 'basic',
    text: async () => '',
    json: async () => null,
  }
}

/** 造一个会记录调用参数的 fetch 替身 */
function createFetch(
  respond: (url: string, init?: FetchInitLike) => Promise<FetchResponseLike> | FetchResponseLike,
): { impl: FetchLike; calls: CallRecord[] } {
  const calls: CallRecord[] = []
  const impl: FetchLike = async (url: string, init?: FetchInitLike) => {
    calls.push({ url, init })
    return respond(url, init)
  }
  return { impl, calls }
}

/** 永远失败的请求（浏览器拦跨域 / 断网时的形态） */
function throwingFetch(): FetchLike {
  return async () => {
    throw new TypeError('Failed to fetch')
  }
}

/** 断言被拒的是哪一种失败，并把错误对象交回给调用方继续断言文案 */
async function expectCode(promise: Promise<unknown>, code: string): Promise<WebDavError> {
  const err = (await promise.catch((e: unknown) => e)) as WebDavError
  expect(webdav.isWebDavError(err)).toBe(true)
  expect(err.code).toBe(code)
  expect(err.message.length).toBeGreaterThan(10)
  return err
}

/** 一条完整的进度行（`extra` 用来造"内容不同但时间戳相同"这类边界） */
function progressRow(
  profileId: string,
  packageId: string,
  knowledgePointId: string,
  lastStudiedAt: string,
  extra: Record<string, unknown> = {},
): ProgressRecord {
  return {
    profileId,
    packageId,
    knowledgePointId,
    status: '学习中',
    correctCount: 1,
    wrongCount: 0,
    correctStreak: 1,
    wrongStreak: 0,
    lastStudiedAt,
    studySeconds: 60,
    ...extra,
  } as unknown as ProgressRecord
}

function localSnapshotWith(profileId: string, rows: ProgressRecord[]): LocalSnapshot {
  return {
    profiles: [{ id: profileId, name: '老大', createdAt: T0 }],
    activeProfileId: profileId,
    bundles: [
      {
        profileId,
        name: '老大',
        createdAt: T0,
        progress: rows,
        mistakes: [],
        examSessions: [],
        cardCompletions: [],
        settings: {},
      },
    ],
    globalSettings: {},
  }
}

function remoteBundleWith(profileId: string, rows: ProgressRecord[]): Bundle[] {
  return [
    {
      profileId,
      name: '老大',
      createdAt: T0,
      progress: rows,
      mistakes: [],
      examSessions: [],
      cardCompletions: [],
      settings: {},
    },
  ]
}

// ===========================================================================
// A. URL 拼接（纯函数）
// ===========================================================================

describe('WebDAV · URL 拼接', () => {
  it('结尾有没有斜杠结果一致（家长随手复制的地址两种都有）', () => {
    const withSlash = webdav.buildBackupUrl('https://dav.example.com/dav/', 'default')
    const withoutSlash = webdav.buildBackupUrl('https://dav.example.com/dav', 'default')
    expect(withSlash).toBe('https://dav.example.com/dav/fls-backup-default.json')
    expect(withoutSlash).toBe(withSlash)
  })

  it('文件名固定为 fls-backup-<档案 id>.json', () => {
    expect(webdav.remoteBackupFileName('default')).toBe('fls-backup-default.json')
    expect(webdav.BACKUP_FILE_PREFIX).toBe('fls-backup-')
    expect(webdav.BACKUP_FILE_SUFFIX).toBe('.json')
  })

  it('连续斜杠折叠：//dav// 不是"更深一层目录"', () => {
    expect(webdav.buildBackupUrl('https://dav.example.com//dav//', 'default')).toBe(
      'https://dav.example.com/dav/fls-backup-default.json',
    )
  })

  it('中文与空格目录会被逐段编码', () => {
    expect(webdav.buildBackupUrl('https://dav.example.com/家庭学习', 'default')).toBe(
      'https://dav.example.com/%E5%AE%B6%E5%BA%AD%E5%AD%A6%E4%B9%A0/fls-backup-default.json',
    )
    expect(webdav.buildBackupUrl('https://dav.example.com/my backup', 'default')).toBe(
      'https://dav.example.com/my%20backup/fls-backup-default.json',
    )
  })

  it('已编码过的路径不二次编码（%25 是最难查的一类）', () => {
    const encoded = webdav.buildBackupUrl('https://dav.example.com/%E5%AE%B6%E5%BA%AD', 'default')
    expect(encoded).toBe('https://dav.example.com/%E5%AE%B6%E5%BA%AD/fls-backup-default.json')
    expect(encoded).not.toContain('%25')
  })

  it('中文档案 id 编进文件名（pid 可能来自用户建档案时的自动 id）', () => {
    expect(webdav.buildBackupUrl('https://dav.example.com/dav', '小 明')).toBe(
      'https://dav.example.com/dav/fls-backup-%E5%B0%8F%20%E6%98%8E.json',
    )
  })

  it('档案 id 里的斜杠编成 %2F —— 不会在服务器上开出一层假目录', () => {
    expect(webdav.buildBackupUrl('https://dav.example.com/dav', 'a/b')).toBe(
      'https://dav.example.com/dav/fls-backup-a%2Fb.json',
    )
  })

  it('地址的 query / hash 会被丢掉（那是网盘网页用的尾巴）', () => {
    expect(webdav.joinUrlPath('https://dav.example.com/dav/?access=1#x', 'a.json')).toBe(
      'https://dav.example.com/dav/a.json',
    )
  })

  it('目录 URL 以斜杠结尾（PROPFIND 探活用）', () => {
    expect(webdav.joinUrlPath('https://dav.example.com/dav')).toBe('https://dav.example.com/dav/')
    expect(webdav.joinUrlPath('https://dav.example.com/dav///')).toBe(
      'https://dav.example.com/dav/',
    )
  })

  it('空地址 / 缺协议 / 空档案 id → config（人话 + 可断言的 code）', () => {
    expect(() => webdav.buildBackupUrl('', 'default')).toThrow(webdav.WebDavError)
    expect(() => webdav.buildBackupUrl('   ', 'default')).toThrow(webdav.WebDavError)
    expect(() => webdav.buildBackupUrl('dav.example.com/dav', 'default')).toThrow(
      webdav.WebDavError,
    )
    expect(() => webdav.buildBackupUrl('ftp://dav.example.com/dav', 'default')).toThrow(
      webdav.WebDavError,
    )
    expect(() => webdav.buildBackupUrl('https://dav.example.com/dav', '')).toThrow(
      webdav.WebDavError,
    )

    let caught: WebDavError | undefined
    try {
      webdav.buildBackupUrl('', 'default')
    } catch (e) {
      caught = e as WebDavError
    }
    expect(caught?.code).toBe('config')
    expect(caught?.message).toContain('设置页')
  })
})

// ===========================================================================
// B. 传输层
// ===========================================================================

describe('WebDAV · Basic 认证', () => {
  it('中文口令也能编（刻意不用 btoa —— 它只吃 Latin-1）', () => {
    expect(webdav.basicAuthHeader('a', 'b')).toBe('Basic YTpi')
    expect(webdav.basicAuthHeader('爸', '家庭')).toBe(
      `Basic ${Buffer.from('爸:家庭', 'utf-8').toString('base64')}`,
    )
    // 与原生实现逐字节一致（ningar/Nextcloud 都按 RFC 7617 校验）
    expect(webdav.basicAuthHeader('u', 'p:with:colons')).toBe(
      `Basic ${Buffer.from('u:p:with:colons', 'utf-8').toString('base64')}`,
    )
  })
})

describe('WebDAV · PUT / GET', () => {
  it('PUT 用对方法、URL、Content-Type 与正文', async () => {
    const { impl, calls } = createFetch(async () => statusResponse(201, 'Created'))
    const res = await webdav.putBackup(CFG, 'default', minimalBackupV2(), {
      fetchImpl: impl,
      timeoutMs: 0,
    })

    expect(res.status).toBe(201)
    expect(res.url).toBe('https://dav.example.com/dav/fls-backup-default.json')
    expect(calls).toHaveLength(1)
    expect(calls[0].init?.method).toBe('PUT')
    expect(calls[0].init?.headers?.['Content-Type']).toBe('application/json; charset=utf-8')
    expect(calls[0].init?.headers?.Authorization).toBe(webdav.basicAuthHeader('papa', 'secret'))
    expect(JSON.parse(String(calls[0].init?.body)).formatVersion).toBe(APP_FORMAT_VERSION)
  })

  it('没填账号时不发 Authorization（部分网盘对空 Basic 直接回 500）', async () => {
    const { impl, calls } = createFetch(async () => statusResponse(201, 'Created'))
    await webdav.putBackup({ baseUrl: CFG.baseUrl }, 'default', minimalBackupV2(), {
      fetchImpl: impl,
      timeoutMs: 0,
    })
    expect(calls[0].init?.headers?.Authorization).toBeUndefined()
  })

  it('GET 成功，正文解析为对象，且 URL 不含 query', async () => {
    const doc = minimalBackupV2()
    const { impl } = createFetch(async () => okJson(doc))
    const got = await webdav.getBackup(CFG, 'default', { fetchImpl: impl, timeoutMs: 0 })
    expect(got.json).toEqual(doc)
    expect(got.url).toBe('https://dav.example.com/dav/fls-backup-default.json')
    expect(got.bytes).toBeGreaterThan(0)
  })
})

describe('WebDAV · 失败分类（每一类都有 code + 人话）', () => {
  it('401 / 403 → auth，提示"应用专用密码"', async () => {
    for (const status of [401, 403]) {
      const { impl } = createFetch(async () => statusResponse(status, 'Unauthorized'))
      const err = await expectCode(
        webdav.getBackup(CFG, 'default', { fetchImpl: impl, timeoutMs: 0 }),
        'auth',
      )
      expect(err.message).toContain('应用专用密码')
    }
  })

  it('404 → not-found，提示先去另一台设备上传', async () => {
    const { impl } = createFetch(async () => statusResponse(404, 'Not Found'))
    const err = await expectCode(
      webdav.getBackup(CFG, 'default', { fetchImpl: impl, timeoutMs: 0 }),
      'not-found',
    )
    expect(err.message).toContain('上传备份')
  })

  it('500 / 503 → server（不是 401 也不是 404 的其它非 2xx）', async () => {
    const { impl } = createFetch(async () => statusResponse(503, 'Service Unavailable'))
    const err = await expectCode(
      webdav.getBackup(CFG, 'default', { fetchImpl: impl, timeoutMs: 0 }),
      'server',
    )
    expect(err.message).toContain('503')
  })

  it('TypeError + 探活也失败 → network', async () => {
    const err = await expectCode(
      webdav.getBackup(CFG, 'default', {
        fetchImpl: throwingFetch(),
        probeImpl: throwingFetch(),
        timeoutMs: 0,
      }),
      'network',
    )
    expect(err.message).toContain('检查这台设备的网络')
  })

  it('TypeError + 探活成功 → cors（本仓的一等失败类型）', async () => {
    const probe = createFetch(async () => opaqueResponse())
    const err = await expectCode(
      webdav.getBackup(CFG, 'default', {
        fetchImpl: throwingFetch(),
        probeImpl: probe.impl,
        timeoutMs: 0,
      }),
      'cors',
    )
    // ① 明确说不是账号密码的问题 ② 指回本来就通的导出 / 导入通道
    expect(err.message).toContain('同源策略')
    expect(err.message).toContain('导出文件')
    // 探活打目录而不是打文件：不至于为了"能不能连上"把整份备份下载一遍
    expect(probe.calls[0].url).toBe('https://dav.example.com/dav/')
    expect(probe.calls[0].init?.mode).toBe('no-cors')
  })

  it('reachability 三种结论可直接断言', async () => {
    expect(await webdav.probeReachability(CFG, { probeImpl: throwingFetch() })).toBe(
      'unreachable',
    )
    expect(
      await webdav.probeReachability(CFG, {
        probeImpl: createFetch(async () => opaqueResponse()).impl,
      }),
    ).toBe('reachable')
  })

  it('透明响应（opaque）本身就是 CORS 信号，直接报 cors', async () => {
    const { impl } = createFetch(async () => opaqueResponse())
    await expectCode(
      webdav.getBackup(CFG, 'default', { fetchImpl: impl, timeoutMs: 0 }),
      'cors',
    )
  })

  it('200 但正文不是 JSON → payload（多半被预览页替换了）', async () => {
    const { impl } = createFetch(async () => okJson('<!doctype html><html>登录</html>'))
    const err = await expectCode(
      webdav.getBackup(CFG, 'default', { fetchImpl: impl, timeoutMs: 0 }),
      'payload',
    )
    expect(err.message).toContain('登录页')
  })

  it('超时：给的是"太慢了"，而不是"连不上"', async () => {
    // 替身**要在 signal 上兑现 abort**（原生 fetch 就是这样），否则测不到真实行为
    const impl: FetchLike = (_url, init) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(okJson({})), 50)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          const err = new Error('The operation was aborted.')
          err.name = 'AbortError'
          reject(err)
        })
      })
    const err = await expectCode(
      webdav.getBackup(CFG, 'default', { fetchImpl: impl, timeoutMs: 1 }),
      'network',
    )
    expect(err.message).toContain('超时')
  })
})

describe('WebDAV · PROPFIND', () => {
  it('解析出大小与时间（命名空间前缀各家不同：d: / D: / lp1: / 无前缀）', async () => {
    const xml =
      '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response>' +
      '<d:href>/dav/fls-backup-default.json</d:href>' +
      '<d:propstat><d:prop><d:getcontentlength>4096</d:getcontentlength>' +
      '<d:getlastmodified>Mon, 20 Oct 2025 08:00:00 GMT</d:getlastmodified>' +
      '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>' +
      '</d:response></d:multistatus>'
    const { impl, calls } = createFetch(async () => okJson(xml))

    const stat = await webdav.statBackup(CFG, 'default', { fetchImpl: impl, timeoutMs: 0 })
    expect(stat).toEqual({
      exists: true,
      size: 4096,
      lastModified: 'Mon, 20 Oct 2025 08:00:00 GMT',
    })
    expect(calls[0].init?.method).toBe('PROPFIND')
    expect(calls[0].init?.headers?.Depth).toBe('0')
  })

  it('换一套前缀也能解析（写死 d: 是跨服务器最典型的坑）', () => {
    const xml =
      '<D:multistatus xmlns:D="DAV:"><D:response><D:propstat><D:prop>' +
      '<D:getcontentlength>8</D:getcontentlength></D:prop></D:propstat></D:response></D:multistatus>'
    expect(webdav.parsePropfind(xml)).toEqual({ exists: true, size: 8 })
  })

  it('404 → exists: false（不抛异常：远端还没传过是常态）', async () => {
    const { impl } = createFetch(async () => statusResponse(404, 'Not Found'))
    await expect(
      webdav.statBackup(CFG, 'default', { fetchImpl: impl, timeoutMs: 0 }),
    ).resolves.toEqual({ exists: false })
  })

  it('解析不出属性就按"没告诉我"处理，绝不填 0 假装有', () => {
    expect(webdav.parsePropfind('<d:multistatus><d:response/></d:multistatus>')).toEqual({
      exists: true,
    })
    expect(webdav.parsePropfind('')).toEqual({ exists: false })
    expect(webdav.parsePropfind('totally not xml')).toEqual({ exists: false })
  })
})

// ===========================================================================
// C. 冲突三态与前置校验（纯函数，不碰 db）
// ===========================================================================

describe('同步 · 冲突三态（时间基准）', () => {
  it('本机更晚 → local-newer', () => {
    const local = localSnapshotWith('default', [
      progressRow('default', 'pkg-a', 'kp-1', T2, { correctCount: 9 }),
    ])
    const remote = remoteBundleWith('default', [progressRow('default', 'pkg-a', 'kp-1', T1)])
    const report = sync.classifySyncConflict(local, remote)

    expect(report.state).toBe('local-newer')
    expect(report.localNewerRows).toBe(1)
    expect(report.remoteNewerRows).toBe(0)
    expect(report.conflictRows).toBe(0)
    expect(report.rows[0]).toMatchObject({ knowledgePointId: 'kp-1', row: 'local-newer' })
  })

  it('远端更晚 → remote-newer', () => {
    const local = localSnapshotWith('default', [progressRow('default', 'pkg-a', 'kp-1', T1)])
    const remote = remoteBundleWith('default', [
      progressRow('default', 'pkg-a', 'kp-1', T2, { correctCount: 7 }),
    ])
    const report = sync.classifySyncConflict(local, remote)
    expect(report.state).toBe('remote-newer')
    expect(report.remoteNewerRows).toBe(1)
  })

  it('两侧各有更晚的行 → conflict（并发修改，交给家长裁决）', () => {
    const local = localSnapshotWith('default', [
      progressRow('default', 'pkg-a', 'kp-1', T2, { correctCount: 9 }),
      progressRow('default', 'pkg-a', 'kp-2', T1),
    ])
    const remote = remoteBundleWith('default', [
      progressRow('default', 'pkg-a', 'kp-1', T1),
      progressRow('default', 'pkg-a', 'kp-2', T2, { correctCount: 5 }),
    ])
    const report = sync.classifySyncConflict(local, remote)

    expect(report.state).toBe('conflict')
    expect(report.localNewerRows).toBe(1)
    expect(report.remoteNewerRows).toBe(1)
    expect(report.rows.map((r) => r.row).sort()).toEqual(['local-newer', 'remote-newer'])
  })

  it('时间戳相同但内容不同 → conflict（时间轴分不出胜负）', () => {
    const local = localSnapshotWith('default', [
      progressRow('default', 'pkg-a', 'kp-1', T1, { status: '已掌握' }),
    ])
    const remote = remoteBundleWith('default', [
      progressRow('default', 'pkg-a', 'kp-1', T1, { status: '学习中' }),
    ])
    const report = sync.classifySyncConflict(local, remote)

    expect(report.state).toBe('conflict')
    expect(report.conflictRows).toBe(1)
    expect(report.localNewerRows).toBe(0)
    expect(report.remoteNewerRows).toBe(0)
  })

  it('时间戳与内容都相同 → in-sync（不该惊动任何人）', () => {
    const local = localSnapshotWith('default', [progressRow('default', 'pkg-a', 'kp-1', T1)])
    const remote = remoteBundleWith('default', [progressRow('default', 'pkg-a', 'kp-1', T1)])
    const report = sync.classifySyncConflict(local, remote)

    expect(report.state).toBe('in-sync')
    expect(report.conflictRows).toBe(0)
    expect(report.rows).toHaveLength(0)
    expect(report.comparedRows).toBe(1)
  })

  it('单边独有的行单独计数，不混进三态判定', () => {
    const local = localSnapshotWith('default', [
      progressRow('default', 'pkg-a', 'kp-1', T1),
      progressRow('default', 'pkg-a', 'kp-local-only', T1),
    ])
    const remote = remoteBundleWith('default', [
      progressRow('default', 'pkg-a', 'kp-1', T1),
      progressRow('default', 'pkg-a', 'kp-remote-only', T1),
    ])
    const report = sync.classifySyncConflict(local, remote)

    expect(report.state).toBe('in-sync')
    expect(report.localOnlyRows).toBe(1)
    expect(report.remoteOnlyRows).toBe(1)
  })

  it('三态判据与合并引擎同源：结论必须和 planMerge 的实际裁决一致', () => {
    // 本机 lastStudiedAt 更晚（T2 > T1），但 lastReviewAt 更早（T1 < T2）。
    // 只看 lastStudiedAt 会判"本机更新"，而 planMerge 按 progressRank 会让远端胜 ——
    // 这条用例钉住"三态说的话，和点下去真正会发生的事，必须是同一件事"。
    const local = localSnapshotWith('default', [
      progressRow('default', 'pkg-a', 'kp-1', T2, { lastReviewAt: T1 }),
    ])
    const remote = remoteBundleWith('default', [
      progressRow('default', 'pkg-a', 'kp-1', T1, { lastReviewAt: T2 }),
    ])

    expect(sync.classifySyncConflict(local, remote).state).toBe('remote-newer')

    const plan = planMerge(local, remote, T2, {})
    expect(plan.progressUpserts).toHaveLength(1)
    expect(plan.progressUpserts[0].lastReviewAt).toBe(T2)
    expect(plan.stats.progressKeptLocal).toBe(0)
  })
})

describe('同步 · 合并前置校验（防跨档案串数据）', () => {
  it('远端档案与本机一个都对不上 → cross-profile', () => {
    const local = localSnapshotWith('default', [progressRow('default', 'pkg-a', 'kp-1', T1)])
    const remote = remoteBundleWith('someone-else', [
      progressRow('someone-else', 'pkg-z', 'kp-9', T2),
    ])
    const guard = sync.guardRemoteBundles(local, remote)

    expect(guard.ok).toBe(false)
    expect(guard.code).toBe('cross-profile')
    expect(guard.shared).toEqual([])
    expect(guard.detail).toContain('别人网盘')
    expect(guard.detail).toContain('一个字节都没有改动')
  })

  it('本机已有档案 + 远端有共享档案 → 放行，并报出远端新增了哪几个档案', () => {
    const local = localSnapshotWith('default', [progressRow('default', 'pkg-a', 'kp-1', T1)])
    const remote = [
      ...remoteBundleWith('default', [progressRow('default', 'pkg-a', 'kp-1', T1)]),
      ...remoteBundleWith('p_b', [progressRow('p_b', 'pkg-b', 'kp-9', T1)]),
    ]
    const guard = sync.guardRemoteBundles(local, remote)

    expect(guard.ok).toBe(true)
    expect(guard.shared).toEqual(['default'])
    expect(guard.added).toEqual(['p_b'])
  })

  it('本机一个档案都没有（全新设备）→ 不判 cross-profile', () => {
    const emptyLocal: LocalSnapshot = {
      profiles: [],
      activeProfileId: '',
      bundles: [],
      globalSettings: {},
    }
    const guard = sync.guardRemoteBundles(emptyLocal, remoteBundleWith('p_b', []))
    expect(guard.ok).toBe(true)
    expect(guard.added).toEqual(['p_b'])
  })

  it('行内档案标识与所属档案不符 → row-profile-mismatch', () => {
    const bundle: Bundle = {
      profileId: 'default',
      name: '老大',
      createdAt: T0,
      progress: [progressRow('p_other', 'pkg-a', 'kp-1', T1)],
      mistakes: [],
      examSessions: [],
      cardCompletions: [],
      settings: {},
    }
    const guard = sync.guardRemoteBundles(localSnapshotWith('default', []), [bundle])
    expect(guard.ok).toBe(false)
    expect(guard.code).toBe('row-profile-mismatch')
    expect(guard.detail).toContain('别人家的数据')
  })

  it('行内缺少档案标识也算损坏（不能按外层归属静默修复）', () => {
    const bundle: Bundle = {
      profileId: 'default',
      name: '老大',
      createdAt: T0,
      progress: [{ ...progressRow('default', 'pkg-a', 'kp-1', T1), profileId: '' }],
      mistakes: [],
      examSessions: [],
      cardCompletions: [],
      settings: {},
    }
    const guard = sync.guardRemoteBundles(localSnapshotWith('default', []), [bundle])
    expect(guard.code).toBe('row-profile-mismatch')
  })

  it('远端没有档案 → empty-remote', () => {
    const guard = sync.guardRemoteBundles(localSnapshotWith('default', []), [])
    expect(guard.ok).toBe(false)
    expect(guard.code).toBe('empty-remote')
  })
})

// ===========================================================================
// D. 端到端（假 db + 假 fetch）
// ===========================================================================

const T_LOCAL = '2025-04-02T10:00:00.000Z' // 本机这一行更晚
const T_REMOTE = '2025-04-01T10:00:00.000Z' // 远端同一行更早

function minimalBackupV2(): Parameters<typeof webdav.putBackup>[2] {
  return {
    formatVersion: 2,
    exportedAt: T_REMOTE,
    appVersion: '1.10.0',
    activeProfileId: 'default',
    profiles: [
      {
        profileId: 'default',
        name: '老大',
        createdAt: T0,
        progress: [],
        mistakes: [],
        examSessions: [],
        settings: [],
      },
    ],
    globalSettings: [],
  }
}

/** 造一份远端备份：同一个档案的若干进度行 */
function remoteDoc(profileId: string, rows: ProgressRecord[]): Record<string, unknown> {
  return {
    formatVersion: 2,
    exportedAt: T_REMOTE,
    appVersion: '1.10.0',
    activeProfileId: profileId,
    profiles: [
      {
        profileId,
        name: '老大',
        createdAt: T0,
        progress: rows,
        mistakes: [],
        examSessions: [],
        settings: [],
      },
    ],
    globalSettings: [],
  }
}

async function seedLocalProfile(): Promise<void> {
  await fake.settings.put({
    key: 'profiles',
    value: { activeId: 'default', list: [{ id: 'default', name: '老大', createdAt: T0 }] },
  })
  await initProfile()
  await fake.progress.add({
    profileId: 'default',
    packageId: 'pkg-a',
    knowledgePointId: 'kp-1',
    status: '已掌握',
    correctCount: 9,
    wrongCount: 0,
    correctStreak: 9,
    wrongStreak: 0,
    lastStudiedAt: T_LOCAL,
    studySeconds: 300,
  })
  // 播种也会写库，之后要看的是"同步有没有写"，所以把日志清零（它本来就是给断言用的）
  fake.writes.length = 0
}

function rowOf(knowledgePointId: string): Record<string, unknown> | undefined {
  return fake.progress.rows.find(
    (r) => r.profileId === 'default' && r.knowledgePointId === knowledgePointId,
  )
}

beforeEach(() => {
  fake.__reset()
  __resetProfileForTest()
  invalidateOwnerIndex()
  setActivePinia(createPinia())
})

describe('同步 · 端到端（假 db + 假 fetch）', () => {
  it('上传：走 buildBackupV2 打包，PUT 到 fls-backup-<档案 id>.json', async () => {
    await seedLocalProfile()
    const { impl, calls } = createFetch(async () => statusResponse(201, 'Created'))

    const res = await sync.pushBackup(CFG, { fetchImpl: impl, timeoutMs: 0 })

    expect(res.url).toBe('https://dav.example.com/dav/fls-backup-default.json')
    expect(res.profileCount).toBe(1)
    expect(res.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const body = JSON.parse(String(calls[0].init?.body)) as {
      formatVersion: number
      profiles: Array<{ progress: Array<{ knowledgePointId: string }> }>
    }
    expect(body.formatVersion).toBe(APP_FORMAT_VERSION)
    expect(body.profiles[0].progress[0].knowledgePointId).toBe('kp-1')
  })

  it('跨档案的远端备份 → 直接拒绝，一个字节都不写，也不给任何统计数字', async () => {
    await seedLocalProfile()
    const before = fake.progress.rows.map((r) => ({ ...r }))
    const { impl } = createFetch(async () =>
      okJson(remoteDoc('someone-else', [progressRow('someone-else', 'pkg-z', 'kp-9', T_LOCAL)])),
    )

    const preview = await sync.previewPull(CFG, { fetchImpl: impl, timeoutMs: 0, now: T_LOCAL })

    expect(preview.outcome).toBe('reject')
    expect(preview.reject?.code).toBe('cross-profile')
    expect(preview.plan).toBeNull()
    expect(preview.state).toBe('in-sync')
    expect(preview.conflict.comparedRows).toBe(0)
    expect(fake.writes).toHaveLength(0)
    expect(fake.progress.rows).toEqual(before)
  })

  it('下载 + 合并 + 落库：本机更晚的行一步都不退回（单调不减）', async () => {
    await seedLocalProfile()
    const remote = remoteDoc('default', [
      // 同一行但更旧 —— planMerge 必须保持本机
      progressRow('default', 'pkg-a', 'kp-1', T_REMOTE, { correctCount: 1, status: '学习中' }),
      // 远端独有的新知识点 —— 应该被加进来
      progressRow('default', 'pkg-a', 'kp-2', T_REMOTE, { correctCount: 3 }),
    ])
    const { impl } = createFetch(async () => okJson(remote))

    const preview = await sync.previewPull(CFG, { fetchImpl: impl, timeoutMs: 0, now: T_LOCAL })
    expect(preview.outcome).toBe('ready')
    expect(preview.state).toBe('local-newer')
    expect(preview.conflict.remoteOnlyRows).toBe(1)
    // 计划本身也不能违反单调不减：更旧的那一行不该出现在 upsert 里
    expect(preview.plan?.progressUpserts.map((r) => r.knowledgePointId)).toEqual(['kp-2'])
    expect(preview.plan?.stats.progressKeptLocal).toBe(1)

    const applied = await sync.executePull(preview)
    expect(applied.progress).toBe(1)

    const kept = rowOf('kp-1')
    // 时间基准是谁新谁胜的真凭实据；count 也在（没被更旧的远端行顶掉）。
    // ⚠️ 这里**不断言 status**：落库之后 `executeImport` 会跑既有的 E1 重归因
    // （`ensureE1Migrated`），它按掌握度规则重新推导掌握状态（与本次同步无关，
    // 既有行为）。 monotonic 要盯的是"时间不退、数据不丢"，不是这张展示位。
    expect(kept?.lastStudiedAt).toBe(T_LOCAL)
    expect(kept?.correctCount).toBe(9)
    expect(rowOf('kp-2')).toBeTruthy()
  })

  it('远端更晚时按行搬过来（这一也要真的更新，不能反过来变成"永不更新"）', async () => {
    await seedLocalProfile()
    const remote = remoteDoc('default', [
      progressRow('default', 'pkg-a', 'kp-1', '2025-05-01T00:00:00.000Z', {
        correctCount: 12,
        status: '已掌握',
      }),
    ])
    const { impl } = createFetch(async () => okJson(remote))

    const preview = await sync.previewPull(CFG, { fetchImpl: impl, timeoutMs: 0, now: T_LOCAL })
    expect(preview.state).toBe('remote-newer')
    await sync.executePull(preview)

    expect(rowOf('kp-1')?.correctCount).toBe(12)
    expect(rowOf('kp-1')?.lastStudiedAt).toBe('2025-05-01T00:00:00.000Z')
  })

  it('pullSync：两边一致时 outcome 为 noop，一次都不写库', async () => {
    await seedLocalProfile()
    const sameRow = progressRow('default', 'pkg-a', 'kp-1', T_LOCAL, {
      status: '已掌握',
      correctCount: 9,
      correctStreak: 9,
      studySeconds: 300,
    })
    const { impl } = createFetch(async () => okJson(remoteDoc('default', [sameRow])))

    const result = await sync.pullSync(CFG, { fetchImpl: impl, timeoutMs: 0, now: T_LOCAL })
    expect(result.preview.outcome).toBe('noop')
    expect(result.applied).toBeNull()
    expect(fake.writes).toHaveLength(0)
  })

  it('网盘上不是我们的备份（任意 JSON）→ backup-route 拒绝，不会被当成 v1 悄悄过去', async () => {
    await seedLocalProfile()
    const { impl } = createFetch(async () => okJson({ hello: '这是别的文件' }))
    const preview = await sync.previewPull(CFG, { fetchImpl: impl, timeoutMs: 0 })
    expect(preview.outcome).toBe('reject')
    expect(preview.reject?.code).toBe('backup-route')
    expect(preview.reject?.detail).toContain('很早以前版本')
    expect(preview.guard).toBeNull()
    expect(fake.writes).toHaveLength(0)
  })

  it('远端是更新版本的备份 → backup-route 拒绝（版本判据只有 routeBackup 一处）', async () => {
    await seedLocalProfile()
    const { impl } = createFetch(async () =>
      okJson({ ...minimalBackupV2(), formatVersion: 99 }),
    )
    const preview = await sync.previewPull(CFG, { fetchImpl: impl, timeoutMs: 0 })
    expect(preview.outcome).toBe('reject')
    expect(preview.reject?.code).toBe('backup-route')
    expect(preview.reject?.detail).toContain('更新的版本')
  })

  it('CORS 失败时给家长环境实话 + 退路（网页版文案）', async () => {
    await seedLocalProfile()
    const err = await sync
      .previewPull(CFG, {
        fetchImpl: throwingFetch(),
        probeImpl: createFetch(async () => opaqueResponse()).impl,
        timeoutMs: 0,
      })
      .catch((e: unknown) => e)

    expect(webdav.isWebDavError(err)).toBe(true)
    const werr = err as WebDavError
    expect(werr.code).toBe('cors')
    expect(werr.message).toContain('导出文件')
    expect(werr.message).toContain(sync.environmentHint())
    // 没有 __TAURI__ 全局变量时，用的必须是"网页版"那一套说法
    expect(werr.message).toContain('网页版')
  })

  it('PROPFIND 探存在：远端有 / 没有都能拿到确定答案', async () => {
    await seedLocalProfile()
    const xml =
      '<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop>' +
      '<d:getcontentlength>1024</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>'
    const yes = createFetch(async () => okJson(xml))
    expect(await sync.remoteExists(CFG, { fetchImpl: yes.impl, timeoutMs: 0 })).toBe(true)

    const no = createFetch(async () => statusResponse(404, 'Not Found'))
    expect(await sync.remoteExists(CFG, { fetchImpl: no.impl, timeoutMs: 0 })).toBe(false)
  })
})
