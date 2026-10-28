/**
 * 学习包图片资产（V2.12）· 规则与链路单测
 *
 * 分三层：
 *   1. 纯规则（`@core/package-manager/assetPath`）—— 路径、扩展名、限额、SVG 清洗；
 *   2. 计划（`planPackageAssets`）—— 导入前的去重/拒绝/构造 Blob 记录；
 *   3. 校验（`normalizePackage`）—— 题目引用图片时能不能通过、报什么错。
 *
 * 第 3 层最重要：**图片引用错误必须在导入时炸，而不是在孩子的答题页上变成留白**。
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeAssetPath,
  extOfPath,
  isSupportedAssetPath,
  mimeOfPath,
  sanitizeSvg,
  validateAsset,
  parseAssetPath,
  MAX_ASSET_BYTES,
} from '@core/package-manager/assetPath'
import { planPackageAssets } from '@core/package-manager/packageAssetStore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizePackage } from '@core/importer/normalizePackage'
import { buildLpkgsetZip } from '../scripts/lib/packSet'

// ---------------------------------------------------------------------------
// 1. 纯规则
// ---------------------------------------------------------------------------

describe('normalizeAssetPath · 同一张图不能有多种写法', () => {
  it('把常见写法统一成 assets/x.png', () => {
    for (const raw of [
      'assets/shape-01.png',
      './assets/shape-01.png',
      '/assets/shape-01.png',
      'assets\\shape-01.png',
      'assets//shape-01.png',
      '  assets/shape-01.png  ',
    ]) {
      expect(normalizeAssetPath(raw), raw).toBe('assets/shape-01.png')
    }
  })

  it('保留子目录', () => {
    expect(normalizeAssetPath('assets/g4/unit1/a.png')).toBe('assets/g4/unit1/a.png')
  })

  it('拒绝越界与目录形态', () => {
    for (const raw of ['../a.png', 'assets/../../a.png', 'assets/', '', '   ', 'a/./b.png']) {
      expect(normalizeAssetPath(raw), raw).toBeNull()
    }
  })

  it('非字符串一律拒绝（包 JSON 是外部输入）', () => {
    expect(normalizeAssetPath(null)).toBeNull()
    expect(normalizeAssetPath(undefined)).toBeNull()
    expect(normalizeAssetPath(123)).toBeNull()
    expect(normalizeAssetPath({ path: 'a.png' })).toBeNull()
  })
})

describe('扩展名与 mime', () => {
  it('识别扩展名（大小写不敏感）', () => {
    expect(extOfPath('assets/A.PNG')).toBe('.png')
    expect(extOfPath('assets/a.b.webp')).toBe('.webp')
    expect(extOfPath('assets/noext')).toBe('')
    // 点开头的隐藏文件名不算扩展名
    expect(extOfPath('assets/.gitignore')).toBe('')
  })

  it('白名单只放行位图与 svg', () => {
    for (const p of ['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'a.gif', 'a.svg']) {
      expect(isSupportedAssetPath(`assets/${p}`), p).toBe(true)
    }
    for (const p of ['a.bmp', 'a.tiff', 'a.exe', 'a.json', 'a']) {
      expect(isSupportedAssetPath(`assets/${p}`), p).toBe(false)
    }
  })

  it('mime 按扩展名推断', () => {
    expect(mimeOfPath('assets/a.png')).toBe('image/png')
    expect(mimeOfPath('assets/a.JPG')).toBe('image/jpeg')
    expect(mimeOfPath('assets/a.svg')).toBe('image/svg+xml')
  })
})

describe('sanitizeSvg · <img> 里不该留可交互元素', () => {
  it('剥掉 script / foreignObject / on* 事件', () => {
    const dirty = [
      '<svg>',
      '<script>alert(1)</script>',
      '<foreignObject><iframe src="x"></iframe></foreignObject>',
      '<rect onload="alert(2)" width="10"/>',
      '<circle cx="5" cy="5" r="4"/>',
      '</svg>',
    ].join('')
    const clean = sanitizeSvg(dirty)
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('foreignObject')
    expect(clean).not.toContain('onload')
    // 图形本体必须留下，否则清洗等于把图删了
    expect(clean).toContain('<circle')
  })
})

describe('validateAsset · 限额', () => {
  const ok = { path: 'assets/a.png', size: 1024 }

  it('正常文件通过', () => {
    expect(validateAsset(ok)).toBeNull()
  })

  it('各拒绝原因', () => {
    expect(validateAsset({ ...ok, path: '../a.png' })).toBe('bad-path')
    expect(validateAsset({ ...ok, path: 'assets/a.bmp' })).toBe('unsupported-ext')
    expect(validateAsset({ ...ok, size: 0 })).toBe('empty')
    expect(validateAsset({ ...ok, size: MAX_ASSET_BYTES + 1 })).toBe('too-large')
  })
})

describe('parseAssetPath · zip 条目 → 包归属', () => {
  it('标准结构指向对应包', () => {
    expect(parseAssetPath('packages/pkg-a/assets/shape-01.png')).toEqual({
      packageId: 'pkg-a',
      path: 'assets/shape-01.png',
    })
  })

  it('根级 assets/ 的归属留给调用方判断', () => {
    expect(parseAssetPath('assets/shape-01.png')).toEqual({
      packageId: '',
      path: 'assets/shape-01.png',
    })
  })

  it('子目录与反斜杠都能解析', () => {
    expect(parseAssetPath('packages/pkg-a/assets/u1/a.png')?.path).toBe('assets/u1/a.png')
    expect(parseAssetPath('packages\\pkg-a\\assets\\a.png')?.packageId).toBe('pkg-a')
  })

  it('非资产条目返回 null（包 JSON 不能被当图片）', () => {
    expect(parseAssetPath('packages/pkg-a.json')).toBeNull()
    expect(parseAssetPath('manifest.json')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. 计划（不落库）
// ---------------------------------------------------------------------------

function bytes(n: number): Uint8Array {
  return new Uint8Array(n).fill(7)
}

describe('planPackageAssets · 导入前算清楚要写什么', () => {
  it('规范化路径、按扩展名定 mime、累加体积', () => {
    const plan = planPackageAssets('pkg-a', [
      { path: './assets/a.png', bytes: bytes(100) },
      { path: 'assets/b.svg', bytes: bytes(50) },
    ])
    expect(plan.rejected).toEqual([])
    expect(plan.rows.map((r) => r.path)).toEqual(['assets/a.png', 'assets/b.svg'])
    expect(plan.rows.map((r) => r.mime)).toEqual(['image/png', 'image/svg+xml'])
    expect(plan.totalBytes).toBe(150)
    expect(plan.rows.every((r) => r.packageId === 'pkg-a')).toBe(true)
  })

  it('坏路径 / 不支持格式 / 超限 / 空文件各自被拒，其余照常入库', () => {
    const plan = planPackageAssets('pkg-a', [
      { path: '../evil.png', bytes: bytes(10) },
      { path: 'assets/a.bmp', bytes: bytes(10) },
      { path: 'assets/huge.png', bytes: bytes(MAX_ASSET_BYTES + 1) },
      { path: 'assets/empty.png', bytes: bytes(0) },
      { path: 'assets/good.png', bytes: bytes(10) },
    ])
    expect(plan.rows.map((r) => r.path)).toEqual(['assets/good.png'])
    expect(plan.rejected.map((r) => r.reason).sort()).toEqual(
      ['bad-path', 'empty', 'too-large', 'unsupported-ext'].sort(),
    )
  })

  it('同一路径重复出现时保留后一份（大小写不敏感文件系统可能造出重复）', () => {
    const a = new Uint8Array([1, 1, 1])
    const b = new Uint8Array([2, 2])
    const plan = planPackageAssets('pkg-a', [
      { path: 'assets/x.png', bytes: a },
      { path: './assets/x.png', bytes: b },
    ])
    expect(plan.rows).toHaveLength(1)
    expect(plan.rows[0].size).toBe(2)
  })

  it('SVG 入库前被清洗', async () => {
    const svg = new TextEncoder().encode('<svg><script>alert(1)</script><circle r="1"/></svg>')
    const plan = planPackageAssets('pkg-a', [{ path: 'assets/a.svg', bytes: svg }])
    const text = await plan.rows[0].blob.text()
    expect(text).not.toContain('<script')
    expect(text).toContain('<circle')
  })
})

// ---------------------------------------------------------------------------
// 3. 校验：题目引用图片
// ---------------------------------------------------------------------------

/** 最小可用包；`ex` 覆盖某道题的字段 */
function makePkg(ex: Record<string, unknown>) {
  return {
    manifest: {
      packageId: 'pkg-shape',
      subject: 'math',
      grade: 4,
      term: 'up',
      title: '图形题',
      dependencies: [],
    },
    knowledgePoints: [{ id: 'kp1', title: '数图形', content: '按大小分类数', type: 'concept' }],
    units: [
      {
        id: 'u1',
        name: '第一单元',
        topics: [
          {
            id: 't1',
            title: '数三角形',
            knowledgePointIds: ['kp1'],
            exercises: [
              {
                id: 'q1',
                type: 'single',
                question: '图中一共有多少个三角形？',
                options: ['A. 3', 'B. 4', 'C. 5', 'D. 6'],
                answer: 'B',
                explanation: '按大小分别数',
                ...ex,
              },
            ],
          },
        ],
      },
    ],
  }
}

function codes(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code)
}

describe('normalizePackage · 配图校验', () => {
  it('图片存在 → 通过，且路径被规范化写回题目', () => {
    const { errors, warnings, package: pkg } = normalizePackage(makePkg({ image: './assets/t1.png' }), {
      assetPaths: new Set(['assets/t1.png']),
    })
    expect(errors).toEqual([])
    // 这道题没写 imageAlt，所以**只**应有 W034 这一条提示（不阻塞导入）
    expect(codes(warnings)).toEqual(['W034'])
    // 渲染层直接拿 exercise.image 查库，必须已经是规范形态
    expect(pkg!.exercises[0].image).toBe('assets/t1.png')
  })

  it('图片不在包里 → E023（存档一份空白题比报错更难查）', () => {
    const { errors } = normalizePackage(makePkg({ image: 'assets/missing.png' }), {
      assetPaths: new Set(['assets/t1.png']),
    })
    expect(codes(errors)).toContain('E023')
  })

  it('路径越界 / 格式不支持 → E022', () => {
    const traversal = normalizePackage(makePkg({ image: '../../etc/passwd.png' }), {
      assetPaths: new Set(),
    })
    expect(codes(traversal.errors)).toContain('E022')

    const exe = normalizePackage(makePkg({ image: 'assets/x.exe' }), {
      assetPaths: new Set(['assets/x.exe']),
    })
    expect(codes(exe.errors)).toContain('E022')
  })

  it('有图但缺 imageAlt → W034（不阻塞导入）', () => {
    const { errors, warnings } = normalizePackage(makePkg({ image: 'assets/t1.png' }), {
      assetPaths: new Set(['assets/t1.png']),
    })
    expect(errors).toEqual([])
    expect(codes(warnings)).toContain('W034')
  })

  it('给了 imageAlt 就不再提示', () => {
    const { warnings } = normalizePackage(
      makePkg({ image: 'assets/t1.png', imageAlt: '一个大三角形里画了两条线' }),
      { assetPaths: new Set(['assets/t1.png']) },
    )
    expect(codes(warnings)).not.toContain('W034')
  })

  it('没有资产清单时（单包 JSON 导入）只校路径格式，不判存在性', () => {
    const { errors } = normalizePackage(makePkg({ image: 'assets/whatever.png' }))
    expect(codes(errors)).not.toContain('E023')
    expect(errors).toEqual([])
  })

  it('空字符串 / null 的 image 被清掉，不留空串给渲染层', () => {
    for (const empty of ['', null]) {
      const { errors, package: pkg } = normalizePackage(makePkg({ image: empty }))
      expect(errors).toEqual([])
      expect(pkg!.exercises[0].image).toBeUndefined()
    }
  })

  it('每道题都带上来源包（配图按 [packageId, path] 取，跨包时不能靠路由猜）', () => {
    const { package: pkg } = normalizePackage(makePkg({ image: 'assets/t1.png' }), {
      assetPaths: new Set(['assets/t1.png']),
    })
    expect(pkg!.exercises[0].packageId).toBe('pkg-shape')
  })
})

// ---------------------------------------------------------------------------
// 4. 打包
// ---------------------------------------------------------------------------

describe('buildLpkgsetZip · 图片进 zip 的位置', () => {
  const pkg = { manifest: { packageId: 'pkg-a' }, units: [], knowledgePoints: [], exercises: [] }

  function entries(bytesArr: Uint8Array): string[] {
    // fflate 的 zip 本地文件头里搜文件名即可（够用于"打没打进去"的断言）
    const text = Buffer.from(bytesArr).toString('latin1')
    return text.match(/packages\/[^\s\u0000-\u001f]+?\.(png|svg|json)/g) ?? []
  }

  it('资产落到 packages/<packageId>/assets/ 下', () => {
    const zip = buildLpkgsetZip({
      manifest: {
        schemaVersion: '1.0',
        setId: 's',
        title: 't',
        subject: 'math',
        grade: 4,
        term: 'up',
        edition: '人教版',
        importOrder: ['pkg-a'],
      },
      packages: [pkg],
      assets: [{ packageId: 'pkg-a', path: 'assets/t1.png', bytes: bytes(10) }],
    })
    const names = entries(zip)
    expect(names).toContain('packages/pkg-a/assets/t1.png')
  })

  it('没有资产时与原行为一致（只产出 manifest + 包 JSON）', () => {
    const zip = buildLpkgsetZip({
      manifest: {
        schemaVersion: '1.0',
        setId: 's',
        title: 't',
        subject: 'math',
        grade: 4,
        term: 'up',
        edition: '人教版',
        importOrder: ['pkg-a'],
      },
      packages: [pkg],
    })
    const names = entries(zip)
    expect(names).toContain('packages/pkg-a.json')
    expect(names.some((n) => n.endsWith('.png'))).toBe(false)
  })
})

/**
 * 导入结果的「配图数量」反馈（V2.12.3）
 *
 * 这条链路唯一的静默失败形态是「题在、图没了」：ZIP 里的图没进 IndexedDB 时，
 * 包照样导入成功、题照样能答，只有答题页多出一行「配图缺失」淡字。而这个数字
 * 恰好把两种情况区分开了 —— 显示 13 张 = 图确实入库了；不显示 = 这个 ZIP 本来就无图。
 * 没有它，家里那台机器报「图不出来」时只能靠猜（V2.12 的四上看图写话/巧数图形就踩过）。
 */
describe('导入结果 · 配图数量反馈', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/views/settings/ImportWizard.vue'), 'utf-8')

  it('结果弹窗渲染了资产数量，且数字来自真实返回值', () => {
    expect(src).toContain('setAssetsImported')
    expect(src).toContain('result.assetsImported')
    // 0 张时要有一句中性说明，不能什么都不显示（否则分不清"无图"和"没入库"）
    expect(src).toMatch(/setAssetsImported === 0/)
  })

  it('importService 仍然把 assetsImported 计入返回值（变量改名会让 UI 恒显示 0）', () => {
    const svc = readFileSync(resolve(process.cwd(), 'src/core/importer/importService.ts'), 'utf-8')
    expect(svc).toMatch(/assetsImported\s*\+=/)
    expect(svc).toMatch(/return\s*\{[\s\S]*assetsImported/)
  })
})

/**
 * 单包 JSON 导入的「无图」警告（V2.12.3）
 *
 * `assetPath` 只负责"引用的路径合不合法"，`normalizePackage` 靠 `assetPaths` 判断
 * "图在不在 ZIP 里" —— 但**单包 JSON 这条路根本没有 assetPaths**（.json 不携带字节），
 * 于是校验直接跳过，含图的包会静默导入成一堆「配图缺失」。
 * 数清题数、给出 W037，是这条路上唯一的提示机会。
 */
describe('单包 JSON 导入 · 含图必须提示', () => {
  it('countImageExercises 只数 image 非空的题，形状不对返回 0', async () => {
    const { countImageExercises } = await import('@core/importer/imageRefs')
    expect(countImageExercises({ exercises: [{ image: 'assets/a.svg' }, {}, { image: '  ' }] })).toBe(1)
    expect(countImageExercises({ exercises: [] })).toBe(0)
    expect(countImageExercises({})).toBe(0)
    expect(countImageExercises(null)).toBe(0)
    expect(countImageExercises(undefined)).toBe(0)
    expect(countImageExercises({ exercises: 'oops' as any })).toBe(0)
  })

  it('importService 在单包导入路径上产出 W037，并指向 .lpkgset.zip', () => {
    const svc = readFileSync(resolve(process.cwd(), 'src/core/importer/importService.ts'), 'utf-8')
    expect(svc).toContain("code: 'W037'")
    expect(svc).toMatch(/countImageExercises\(normalized\)/)
    expect(svc).toContain('.lpkgset.zip')
  })
})
