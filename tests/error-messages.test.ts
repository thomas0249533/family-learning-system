import { describe, expect, it } from 'vitest'
import {
  FALLBACK_FRIENDLY,
  errorCodeOf,
  friendlyOf,
  hasFriendlyMessage,
  type FriendlyError,
} from '@core/errors/messages'

/**
 * 错误码 → 人话（V1.6 · Stage B · B4）
 *
 * 这张表守的不是"有没有文案"，而是三件更容易坏的事：
 *   1. **错误码不许漏到界面上** —— 标题里出现 `stale-local-data` 等于没翻译；
 *   2. **`friendlyOf` 永远给得出一句话** —— 一旦返回 null/undefined，模板会渲染成空白，
 *      比显示英文更糟（家长连"失败了"都看不到）；
 *   3. **`profile-limit` 的标题里必须留着「超过 4 个档案」** ——
 *      `tests/e2e/backup-roundtrip.spec.ts` 断言的就是这几个字。改文案时同步改断言，
 *      这条用例在这里替你把两边钉在一起。
 */

const KNOWN = ['stale-local-data', 'DataCloneError', 'profile-limit'] as const

/** 中文出现即认为"翻译过了"（不追求覆盖率，只防"整句是英文技术词"） */
const HAS_CJK = /[\u4e00-\u9fa5]/

describe('errorCodeOf — 从任意异常里抠错误码', () => {
  it('优先取 `code`', () => {
    const err = Object.assign(new Error('boom'), { code: 'stale-local-data' })
    expect(errorCodeOf(err)).toBe('stale-local-data')
  })

  it('★ 没有 `code` 时退回 `name`（`DataCloneError` 是 DOMException，只有 name）', () => {
    const err = new Error('could not be cloned')
    err.name = 'DataCloneError'
    expect(errorCodeOf(err)).toBe('DataCloneError')
  })

  it('`code` 为空串时不吞掉 `name`', () => {
    const err = Object.assign(new Error('boom'), { code: '', name: 'DataCloneError' })
    expect(errorCodeOf(err)).toBe('DataCloneError')
  })

  it('非对象 / null / undefined / 字符串 → 空串（不抛错）', () => {
    expect(errorCodeOf(null)).toBe('')
    expect(errorCodeOf(undefined)).toBe('')
    expect(errorCodeOf('stale-local-data')).toBe('')
    expect(errorCodeOf(42)).toBe('')
  })

  it('普通 Error（name 恒为 Error）→ 返回 "Error"，调用方据此走兜底', () => {
    expect(errorCodeOf(new Error('boom'))).toBe('Error')
  })
})

describe('friendlyOf — 每个已知码都翻成了人话', () => {
  it.each(KNOWN)('★ %s 的标题是中文，且不含错误码本身', (code) => {
    const msg = friendlyOf(code)
    expect(msg.title).toMatch(HAS_CJK)
    expect(msg.title).not.toContain(code)
    expect(msg.hint).toMatch(HAS_CJK)
    expect(msg.hint).not.toContain(code)
  })

  it('★ 未知码 / 空码一律走兜底（永不返回 null，否则模板会渲染成空白）', () => {
    for (const code of ['', null, undefined, 'E999', 'W020', 'some-new-code']) {
      const msg = friendlyOf(code)
      expect(msg).toBe(FALLBACK_FRIENDLY)
      expect(msg.title).toMatch(HAS_CJK)
    }
  })

  it('兜底文案必须说明"一行都没写进去"这层意思（AC-P2-15）', () => {
    expect(FALLBACK_FRIENDLY.title).toContain('没有写入任何数据')
    expect(FALLBACK_FRIENDLY.action).toBeNull()
  })
})

describe('friendlyOf — 动作语义（core 不认识路由）', () => {
  it('`stale-local-data` → 重新预览，不是"去导出"', () => {
    const msg: FriendlyError = friendlyOf('stale-local-data')
    expect(msg.action?.id).toBe('repreview')
  })

  it('★ `profile-limit` → 去导出/删档案，且标题保留 e2e 断言的那几个字', () => {
    const msg = friendlyOf('profile-limit')
    expect(msg.action?.id).toBe('export-profiles')
    // 与 `tests/e2e/backup-roundtrip.spec.ts` 的 `.import-reject` 断言同源
    expect(msg.title).toContain('超过 4 个档案')
  })

  it('`DataCloneError` 不给按钮（家长能做的只有重试，给按钮是假动作）', () => {
    expect(friendlyOf('DataCloneError').action).toBeNull()
  })
})

describe('hasFriendlyMessage — 只对翻译过的码为真', () => {
  it('已知码为真、未知码为假', () => {
    for (const code of KNOWN) expect(hasFriendlyMessage(code)).toBe(true)
    expect(hasFriendlyMessage('E999')).toBe(false)
    // 原型链上的键不能被当成"翻译过了"
    expect(hasFriendlyMessage('toString')).toBe(false)
    expect(hasFriendlyMessage('constructor')).toBe(false)
  })
})
