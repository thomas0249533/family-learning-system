import { describe, it, expect } from 'vitest'
import { unzipSync } from 'fflate'
import {
  buildPackageModel,
  buildLpkgset,
  buildSetFromForm,
  type CreatorForm,
} from '@core/importer/packSet'
import { normalizePackage } from '@core/importer/normalizePackage'

const form: CreatorForm = {
  title: '测试包·两道题',
  packageId: 'pkg1',
  subject: 'math',
  grade: 4,
  term: 'up',
  edition: '人教版',
  units: [
    {
      title: '单元一',
      knowledgePoints: [
        {
          id: 'kp1',
          title: '示例知识点',
          prerequisites: '',
          questions: [
            {
              id: 'q1',
              type: 'single',
              question: '1 + 1 = ?',
              answer: 'A',
              optionsText: 'A. 2\nB. 3\nC. 4\nD. 5',
              explanation: '',
            },
            {
              id: 'q2',
              type: 'blank',
              question: '3 + ___ = 5',
              answer: '2',
              optionsText: '',
              explanation: '',
            },
          ],
        },
      ],
    },
  ],
}

function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf-8')
}

describe('creator-build · 表单 → 合法包', () => {
  it('buildPackageModel + normalizePackage 通过（errors 为空）', () => {
    const model = buildPackageModel(form)
    const norm = normalizePackage(model)

    expect(norm.errors).toEqual([])
    expect(norm.package).not.toBeNull()
  })

  it('结构正确：2 道题、single 选项已解析为数组', () => {
    const model = buildPackageModel(form)
    const norm = normalizePackage(model)
    const pkg = norm.package!

    expect(pkg.manifest.packageId).toBe('pkg1') // 标题 slug
    expect(pkg.manifest.title).toBe('测试包·两道题')
    expect(pkg.knowledgePoints.length).toBe(1)
    expect(pkg.units[0].topics[0].exercises.length).toBe(2)

    const single = pkg.units[0].topics[0].exercises.find((e: any) => e.id === 'q1')
    expect(single.options).toEqual(['A. 2', 'B. 3', 'C. 4', 'D. 5'])
    expect(single.knowledgePointIds).toEqual(['kp1'])
  })

  it('显式 packageId 优先于标题 slug', () => {
    const m = buildPackageModel({ ...form, packageId: 'my-custom-id' })
    expect(m.manifest.packageId).toBe('my-custom-id')
  })

  it('未提供 packageId 时按标题生成 slug（中文保留，仅去噪）', () => {
    const m = buildPackageModel({ ...form, packageId: '', title: 'My  Package!@#' })
    expect(m.manifest.packageId).toBe('my-package')
  })
})

describe('creator-build · 打包往返（可被 importPackageSet 解包）', () => {
  it('buildLpkgset 产出含 manifest.json 与 packages/<id>.json 的 zip', () => {
    const set = buildSetFromForm(form)
    const bytes = buildLpkgset(set)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)

    const files = unzipSync(bytes)
    const keys = Object.keys(files)

    expect(keys).toContain('manifest.json')
    const pkgKey = keys.find((k) => k.startsWith('packages/') && k.endsWith('.json'))
    expect(pkgKey).toBeDefined()

    const manifest = JSON.parse(decode(files['manifest.json']))
    expect(manifest.importOrder).toEqual(['pkg1'])
    expect(manifest.title).toBe('测试包·两道题')

    const pkg = JSON.parse(decode(files[pkgKey!]))
    expect(pkg.manifest.packageId).toBe('pkg1')
    expect(pkg.units[0].topics[0].exercises.length).toBe(2)
  })
})
