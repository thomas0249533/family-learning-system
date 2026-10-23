/**
 * G3 · 二维码分发单测（V1.12 Stage G）
 * =====================================================================
 * 覆盖四组：
 *   A. 载荷往返 —— buildShareString → parseShareString 还原一致
 *   B. 校验和 —— FNV-1a 通过 / 篡改失败 / 手输错码失败
 *   C. 防御性解析全集 —— 注入串 / 超长 / 伪协议 / 缺字段 / 重复字段 / 未知字段，
 *      全部返回结构化错误（绝不抛裸异常）
 *   D. QR 矩阵基本性质 —— 尺寸公式、finder pattern 位置、确定性
 */
import { describe, it, expect } from 'vitest'
import { buildShareString, drawQrToCanvas, checksumOf, SHARE_URI_PREFIX } from '@core/share/qrcode'
import { parseShareString } from '@core/share/parser'
import { QrCode } from '@core/share/vendor/qrcodegen'

// =====================================================================
// A · 载荷往返
// =====================================================================

describe('载荷往返（组装 → 解析还原）', () => {
  it('最简载荷：packageId 往返一致', () => {
    const s = buildShareString({ packageId: 'math-4a-unit1' })
    expect(s.startsWith(SHARE_URI_PREFIX)).toBe(true)
    const r = parseShareString(s)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.type).toBe('pkg')
      expect(r.payload.packageId).toBe('math-4a-unit1')
      expect(r.payload.url).toBeUndefined()
    }
  })

  it('带 url 的载荷：往返一致', () => {
    const s = buildShareString({
      packageId: 'chinese-g3-daily',
      url: 'http://192.168.1.20:8080/packs/chinese-g3-daily.lpkgset',
    })
    const r = parseShareString(s)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.packageId).toBe('chinese-g3-daily')
      expect(r.payload.url).toBe('http://192.168.1.20:8080/packs/chinese-g3-daily.lpkgset')
    }
  })

  it('packageId 含特殊白名单字符（: . _ -）往返一致', () => {
    const s = buildShareString({ packageId: 'set01:pkg_2.sub-3' })
    const r = parseShareString(s)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.packageId).toBe('set01:pkg_2.sub-3')
  })

  it('url 含需要编码的字符（& ? 空格）往返一致', () => {
    const s = buildShareString({
      packageId: 'pkg-x',
      url: 'http://192.168.1.5:9000/a b?name=x&y=1',
    })
    const r = parseShareString(s)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.url).toBe('http://192.168.1.5:9000/a b?name=x&y=1')
  })

  it('后缀码手输（去掉协议头）也能解析', () => {
    const full = buildShareString({ packageId: 'math-4a-unit1' })
    const suffix = full.slice(SHARE_URI_PREFIX.length)
    const r = parseShareString(suffix)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.packageId).toBe('math-4a-unit1')
  })
})

// =====================================================================
// B · 校验和
// =====================================================================

describe('校验和（FNV-1a，组装/解析同一口径）', () => {
  it('checksumOf 输出 8 位小写 hex，且确定', () => {
    const c1 = checksumOf('pkg', 'math-4a-unit1')
    const c2 = checksumOf('pkg', 'math-4a-unit1')
    expect(c1).toMatch(/^[0-9a-f]{8}$/)
    expect(c1).toBe(c2)
  })

  it('url 变化会改变校验和', () => {
    expect(checksumOf('pkg', 'p1')).not.toBe(checksumOf('pkg', 'p1', 'http://a.b/c'))
  })

  it('合法分享码的校验和必然通过解析', () => {
    const s = buildShareString({ packageId: 'english-g5-listening' })
    const r = parseShareString(s)
    expect(r.ok).toBe(true)
  })

  it('篡改 pkgId → checksum-mismatch', () => {
    const s = buildShareString({ packageId: 'math-4a-unit1' })
    const tampered = s.replace('pkgId=math-4a-unit1', 'pkgId=math-4a-unit2')
    const r = parseShareString(tampered)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('checksum-mismatch')
  })

  it('手输错码（checksum 抄错一位）→ checksum-mismatch', () => {
    const s = buildShareString({ packageId: 'math-4a-unit1' })
    const wrong = s.replace(/checksum=[0-9a-f]{8}/, 'checksum=00000000')
    const r = parseShareString(wrong)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('checksum-mismatch')
  })
})

// =====================================================================
// C · 防御性解析全集（恶意输入一律结构化错误，绝不抛裸异常）
// =====================================================================

describe('防御性解析', () => {
  /** 断言：输入被拒且错误码匹配（若给定） */
  function expectRejected(input: unknown, code?: string): void {
    const r = parseShareString(input)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(typeof r.error.code).toBe('string')
      expect(typeof r.error.message).toBe('string')
      expect(r.error.message).not.toContain('<')
      if (code) expect(r.error.code).toBe(code)
    }
  }

  it('空输入', () => {
    expectRejected('', 'empty-input')
    expectRejected('   ', 'empty-input')
    expectRejected(null, 'empty-input')
    expectRejected(undefined, 'empty-input')
    expectRejected(42, 'empty-input')
    expectRejected({}, 'empty-input')
  })

  it('超长输入（总长上限 1024）', () => {
    const long = 'type=pkg&pkgId=' + 'a'.repeat(2000) + '&checksum=00000000'
    expectRejected(long, 'too-long')
  })

  it('伪协议 / 协议白名单外', () => {
    expectRejected('javascript:alert(1)', 'bad-protocol')
    expectRejected('data:text/html,<script>alert(1)</script>', 'bad-protocol')
    expectRejected('file:///etc/passwd', 'bad-protocol')
    expectRejected('OtherApp://import?type=pkg&pkgId=x&checksum=00000000', 'bad-protocol')
    expectRejected('vbscript:msgbox', 'bad-protocol')
  })

  it('协议头大小写变体（familylearning:// / FAMILYLEARNING://）拒绝', () => {
    expectRejected('familylearning://import?type=pkg&pkgId=x&checksum=00000000', 'bad-protocol')
    expectRejected('FAMILYLEARNING://import?type=pkg&pkgId=x&checksum=00000000', 'bad-protocol')
  })

  it('脚本注入串：pkgId 带尖括号 / 引号 / 反斜杠', () => {
    // 组装端根本造不出这种载荷（charset 白名单），只能手工构造 query
    const evil1 = 'type=pkg&pkgId=%3Cscript%3Ealert(1)%3C%2Fscript%3E&checksum=00000000'
    expectRejected(evil1, 'bad-pkg-id')
    const evil2 = 'type=pkg&pkgId=a%22onmouseover%3D%22alert(1)&checksum=00000000'
    expectRejected(evil2, 'bad-pkg-id')
    const evil3 = 'type=pkg&pkgId=a%5C&checksum=00000000'
    expectRejected(evil3, 'bad-pkg-id')
  })

  it('url 字段拒绝 javascript: / data: / 凭据 / 控制字符', () => {
    const base = checksumOf('pkg', 'p1')
    expectRejected(`type=pkg&pkgId=p1&checksum=${base}&url=javascript%3Aalert(1)`, 'bad-url')
    expectRejected(`type=pkg&pkgId=p1&checksum=${base}&url=data%3Atext%2Fhtml%2C%3Cscript%3E`, 'bad-url')
    expectRejected(`type=pkg&pkgId=p1&checksum=${base}&url=http%3A%2F%2Fuser%3Apass%40host%2Fx`, 'bad-url')
    expectRejected(`type=pkg&pkgId=p1&checksum=${base}&url=ftp%3A%2F%2Fhost%2Fx`, 'bad-url')
    // 控制字符（%0A = 换行）→ bad-url（URL API 会静默剥离换行，必须显式拒绝）
    expectRejected(`type=pkg&pkgId=p1&checksum=${base}&url=http%3A%2F%2Fhost%2F%0Aevil`, 'bad-url')
  })

  it('url 超长（> 512）', () => {
    // 手工构造（组装端对超长 url 直接抛 RangeError，属于编程错误）；
    // 解析端必须在 checksum 复核之前就拒绝
    const longUrl = 'http://host/' + 'a'.repeat(600)
    const s = `type=pkg&pkgId=p1&checksum=00000000&url=${encodeURIComponent(longUrl)}`
    expectRejected(s, 'bad-url')
  })

  it('缺字段：type / pkgId / checksum 各自缺失都拒绝', () => {
    const base = checksumOf('pkg', 'p1')
    expectRejected(`pkgId=p1&checksum=${base}`, 'missing-field')
    expectRejected(`type=pkg&checksum=${base}`, 'missing-field')
    expectRejected(`type=pkg&pkgId=p1`, 'missing-field')
    expectRejected('type=pkg&pkgId=p1&checksum=', 'bad-checksum-format')
  })

  it('未知字段（含 password / token / secret）拒绝 —— 白名单里没有口令的位置', () => {
    const base = checksumOf('pkg', 'p1')
    expectRejected(`type=pkg&pkgId=p1&checksum=${base}&password=123`, 'unknown-field')
    expectRejected(`type=pkg&pkgId=p1&checksum=${base}&token=abc`, 'unknown-field')
    expectRejected(`type=pkg&pkgId=p1&checksum=${base}&secret=key`, 'unknown-field')
  })

  it('重复字段拒绝', () => {
    const base = checksumOf('pkg', 'p1')
    expectRejected(`type=pkg&pkgId=p1&pkgId=p2&checksum=${base}`, 'duplicate-field')
    expectRejected(`type=pkg&type=pkg&pkgId=p1&checksum=${base}`, 'duplicate-field')
    expectRejected(`type=pkg&pkgId=p1&checksum=${base}&checksum=${base}`, 'duplicate-field')
  })

  it('type 不在白名单', () => {
    expectRejected('type=user&pkgId=p1&checksum=00000000', 'bad-type')
    expectRejected('type=profile&pkgId=p1&checksum=00000000', 'bad-type')
  })

  it('pkgId 超长（> 128）与非法 charset', () => {
    const longId = 'a'.repeat(129)
    const s1 = 'type=pkg&pkgId=' + longId + '&checksum=' + checksumOf('pkg', longId)
    expectRejected(s1, 'bad-pkg-id')
    const s2 = 'type=pkg&pkgId=a%20b&checksum=' + checksumOf('pkg', 'a b')
    expectRejected(s2, 'bad-pkg-id')
    const s3 = 'type=pkg&pkgId=a%2Fb&checksum=' + checksumOf('pkg', 'a/b')
    expectRejected(s3, 'bad-pkg-id')
  })

  it('checksum 形态非法（非 8 位 hex）', () => {
    expectRejected('type=pkg&pkgId=p1&checksum=zzzzzzzz', 'bad-checksum-format')
    expectRejected('type=pkg&pkgId=p1&checksum=123', 'bad-checksum-format')
    expectRejected('type=pkg&pkgId=p1&checksum=123456789', 'bad-checksum-format')
  })

  it('query 内裸 # / 空白拒绝', () => {
    const base = checksumOf('pkg', 'p1')
    expectRejected(`type=pkg&pkgId=p1&checksum=${base}#frag`, 'bad-protocol')
    expectRejected(`type=pkg&pkgId=p1 &checksum=${base}`, 'bad-protocol')
  })

  it('非法 % 序列（%ZZ）不抛裸异常', () => {
    expectRejected('type=pkg&pkgId=a%ZZ&checksum=00000000')
  })
})

// =====================================================================
// D · QR 矩阵基本性质
// =====================================================================

describe('QR 矩阵基本性质（vendor QrCode）', () => {
  it('尺寸符合 version*4+17', () => {
    const qr = QrCode.encodeText('test', QrCode.Ecc.MEDIUM)
    expect(qr.size).toBe(qr.version * 4 + 17)
    expect(qr.size).toBeGreaterThanOrEqual(21)
    expect(qr.size).toBeLessThanOrEqual(177)
  })

  it('分享串编码成功且矩阵确定性（同输入同矩阵）', () => {
    const text = buildShareString({ packageId: 'math-4a-unit1', url: 'http://192.168.1.20:8080/x' })
    const qr1 = QrCode.encodeText(text, QrCode.Ecc.MEDIUM)
    const qr2 = QrCode.encodeText(text, QrCode.Ecc.MEDIUM)
    expect(qr1.size).toBe(qr2.size)
    for (let y = 0; y < qr1.size; y++) {
      for (let x = 0; x < qr1.size; x++) {
        expect(qr1.getModule(x, y)).toBe(qr2.getModule(x, y))
      }
    }
  })

  it('finder pattern：三个角上存在 3x3 暗色核心', () => {
    const qr = QrCode.encodeText('test', QrCode.Ecc.MEDIUM)
    // finder 中心在 (3,3)、(size-4,3)、(3,size-4)，其 3x3 核心全暗
    const centers: Array<[number, number]> = [
      [3, 3],
      [qr.size - 4, 3],
      [3, qr.size - 4],
    ]
    for (const [cx, cy] of centers) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(qr.getModule(cx + dx, cy + dy)).toBe(true)
        }
      }
    }
    // 左上 finder：中心 (3,3)，dist==2 的白环在 (3,1)/(1,3)，7x7 外圈 (3,0)/(0,3) 是暗色
    expect(qr.getModule(3, 0)).toBe(true)
    expect(qr.getModule(0, 3)).toBe(true)
    expect(qr.getModule(3, 1)).toBe(false)
    expect(qr.getModule(1, 3)).toBe(false)
  })

  it('黑白模块大致均衡（暗模块占比 25%~75%）', () => {
    const text = buildShareString({ packageId: 'chinese-g3-daily' })
    const qr = QrCode.encodeText(text, QrCode.Ecc.MEDIUM)
    let dark = 0
    for (let y = 0; y < qr.size; y++)
      for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) dark++
    const ratio = dark / (qr.size * qr.size)
    expect(ratio).toBeGreaterThan(0.25)
    expect(ratio).toBeLessThan(0.75)
  })
})

// =====================================================================
// E · Canvas 渲染（stub 2d context，不依赖真实 canvas 后端）
// =====================================================================

describe('drawQrToCanvas（stub 上下文）', () => {
  function makeStubCanvas() {
    const calls: Array<{ op: string; args: unknown[] }> = []
    const ctx = {
      fillStyle: '',
      fillRect(x: number, y: number, w: number, h: number) {
        calls.push({ op: 'fillRect', args: [x, y, w, h] })
      },
    }
    const canvas = {
      width: 0,
      height: 0,
      style: {} as Record<string, string>,
      getContext(type: string) {
        return type === '2d' ? ctx : null
      },
    }
    return { canvas: canvas as unknown as HTMLCanvasElement, calls }
  }

  it('绘制出白底 + 暗模块，尺寸按请求设置', () => {
    const { canvas, calls } = makeStubCanvas()
    const text = buildShareString({ packageId: 'math-4a-unit1' })
    drawQrToCanvas(canvas, text, 240)
    // 至少一次白底 + 数百次暗块
    expect(calls.length).toBeGreaterThan(100)
    // canvas 尺寸非 0
    expect(canvas.width).toBeGreaterThan(0)
    expect(canvas.height).toBeGreaterThan(0)
    expect(canvas.style.width).toBe('240px')
  })

  it('getContext 不可用时抛 Error（不静默）', () => {
    const badCanvas = {
      width: 0,
      height: 0,
      style: {},
      getContext: () => null,
    } as unknown as HTMLCanvasElement
    expect(() => drawQrToCanvas(badCanvas, 'x', 100)).toThrow()
  })
})
