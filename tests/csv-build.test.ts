/**
 * CSV / 表格转包工具的纯逻辑测试（V1.11 Stage F · F3）
 *
 * ## 这个文件为什么存在
 *
 * `scripts/build-from-csv.ts` 的目标用户是**家长 / 老师**：在 Excel 里填表一键出包。
 * 所以对他们的报错必须是人话（第几行第几列缺什么），绝不能抛裸栈。可断言的部分
 * 全部抽在 `scripts/lib/csvImport.ts` 里（无 IO），这里逐条钉死。
 *
 * 覆盖：CSV 解析（引号 / 换行 / CRLF / BOM / Tab 自动识别）、表头中英别名与缺列
 * 报错、逐行校验的人话错误、以及生成的包是否满足既有内容铁律。
 */

import { describe, it, expect } from 'vitest'
import {
  parseCsv,
  mapHeaders,
  normalizeHeaderCell,
  describeMissingColumns,
  normalizeRows,
  buildPackageFromRows,
  buildSetConfig,
  splitOptions,
  splitIdList,
  optionLetters,
  inferModuleType,
  COLUMN_SPECS,
} from '../scripts/lib/csvImport'

const CN_HEADERS = ['学科', '年级', '单元ID', '单元名称', '知识点ID', '知识点名称', '题型', '题目', '选项', '答案', '解析', '难度']
const EN_HEADERS = ['subject', 'grade', 'unitId', 'unitTitle', 'knowledgePointId', 'knowledgePointTitle', 'type', 'question', 'options', 'answer', 'explanation', 'difficulty']

describe('parseCsv · 表格解析（自写，零依赖）', () => {
  it('基础：表头 + 数据行', () => {
    const t = parseCsv('a,b\n1,2\n3,4')
    expect(t.headers).toEqual(['a', 'b'])
    expect(t.rows).toEqual([
      { line: 2, cells: ['1', '2'] },
      { line: 3, cells: ['3', '4'] },
    ])
    expect(t.delimiter).toBe(',')
  })

  it('引号里的逗号与换行不切分', () => {
    const t = parseCsv('a,b\n"x,y","line1\nline2"\n')
    expect(t.rows[0].cells).toEqual(['x,y', 'line1\nline2'])
  })

  it('"" 转义成一个引号', () => {
    const t = parseCsv('a\n"他说""你好"""\n')
    expect(t.rows[0].cells).toEqual(['他说"你好"'])
  })

  it('CRLF 与 BOM 都吃得住（Excel 导出的常态）', () => {
    const t = parseCsv('\uFEFFa,b\r\n1,2\r\n')
    expect(t.headers).toEqual(['a', 'b'])
    expect(t.rows[0].cells).toEqual(['1', '2'])
  })

  it('Tab 分隔自动识别（WPS 直接复制出来的表）', () => {
    const t = parseCsv('a\tb\n1\t2')
    expect(t.delimiter).toBe('\t')
    expect(t.rows[0].cells).toEqual(['1', '2'])
  })

  it('末尾空行丢掉，中间空行保留为可跳过行', () => {
    const t = parseCsv('a,b\n1,2\n\n\n')
    expect(t.rows).toHaveLength(2)
  })

  it('最后一列缺值时补空串，不让列数错位', () => {
    const t = parseCsv('a,b,c\n1,2\n')
    expect(t.rows[0].cells).toEqual(['1', '2', ''])
  })
})

describe('mapHeaders · 表头映射与缺列报错', () => {
  it('中文表头全部认出来', () => {
    const m = mapHeaders(CN_HEADERS)
    expect(m.missing).toEqual([])
    expect(m.unknown).toEqual([])
    expect(m.index['question']).toBe(7)
    expect(m.index['answer']).toBe(9)
  })

  it('英文表头同样认出来', () => {
    const m = mapHeaders(EN_HEADERS)
    expect(m.missing).toEqual([])
    expect(m.index['type']).toBe(6)
  })

  it('模板里的 `题目*` 这种必填星号不影响识别', () => {
    const m = mapHeaders(['题型*', '题目*', '答案*'])
    expect(m.missing).toEqual([])
    expect(m.index['answer']).toBe(2)
  })

  it('缺必填列 → 给出人话清单（含可接受的表头名）', () => {
    const m = mapHeaders(['题目', '答案'])
    expect(m.missing.map((s) => s.key)).toEqual(['type'])
    const desc = describeMissingColumns(m.missing)
    expect(desc).toContain('题型')
    expect(desc).toContain('题目类型')
  })

  it('认不出的列单独列出（只提示不报错）', () => {
    const m = mapHeaders(['题型', '题目', '答案', '备注'])
    expect(m.unknown).toEqual(['备注'])
  })

  it('normalizeHeaderCell：去 BOM / 空格 / 星号 / 转小写', () => {
    expect(normalizeHeaderCell(' 知识点ID ')).toBe('知识点id')
    expect(normalizeHeaderCell('题目*')).toBe('题目')
    expect(normalizeHeaderCell('\uFEFFAnswer')).toBe('answer')
  })

  it('每一列都有中文名可给人看', () => {
    for (const spec of COLUMN_SPECS) {
      expect(spec.label.length).toBeGreaterThan(0)
      expect(spec.aliases.length).toBeGreaterThan(0)
    }
  })
})

describe('normalizeRows · 逐行校验（人话报错）', () => {
  const tableFor = (headers: string[], rows: string[][]): ReturnType<typeof parseCsv> => ({
    headers,
    rows: rows.map((cells, i) => ({ line: i + 2, cells })),
    delimiter: ',',
  })

  const baseRow = (over: Record<number, string> = {}): string[] => {
    const cells = ['math', '4', 'u1', '第一单元', 'kp-1', '大数的认识', 'blank', '1+1=______', '', '2', '略', '基础']
    for (const [k, v] of Object.entries(over)) cells[Number(k)] = v
    return cells
  }

  it('正常行 → 归一化成功，多空答案自动转数组', () => {
    const t = tableFor(CN_HEADERS, [baseRow({ 9: '甲,乙' })])
    const { rows, errors } = normalizeRows(t, mapHeaders(CN_HEADERS), {})
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0].answer).toEqual(['甲', '乙'])
    expect(rows[0].unitId).toBe('u1')
    expect(rows[0].kpId).toBe('kp-1')
    expect(rows[0].grade).toBe(4)
  })

  it('单段答案保持标量（不无谓地转成数组）', () => {
    const t = tableFor(CN_HEADERS, [baseRow()])
    const { rows } = normalizeRows(t, mapHeaders(CN_HEADERS), {})
    expect(rows[0].answer).toBe('2')
  })

  it('只填知识点名称时自动生成 ID（kp-1 / kp-2…）', () => {
    const t = tableFor(CN_HEADERS, [
      baseRow({ 4: '', 5: '大数的认识' }),
      baseRow({ 4: '', 5: '大数的比较' }),
      baseRow({ 4: '', 5: '大数的认识' }),
    ])
    const { rows, errors } = normalizeRows(t, mapHeaders(CN_HEADERS), {})
    expect(errors).toEqual([])
    expect(rows.map((r) => r.kpId)).toEqual(['kp-1', 'kp-2', 'kp-1'])
  })

  it('没填单元时默认归到一个单元', () => {
    const t = tableFor(CN_HEADERS, [baseRow({ 2: '', 3: '' })])
    const { rows } = normalizeRows(t, mapHeaders(CN_HEADERS), {})
    expect(rows[0].unitId).toBe('u1')
  })

  it('没填题目ID时自动编号 ex-001…', () => {
    const headers = [...CN_HEADERS, '题目ID']
    const t = tableFor(headers, [baseRow(), baseRow()])
    const { rows } = normalizeRows(t, mapHeaders(headers), {})
    expect(rows.map((r) => r.id)).toEqual(['ex-001', 'ex-002'])
  })

  it('报错：题型为空 / 题型不支持', () => {
    const t = tableFor(CN_HEADERS, [baseRow({ 6: '' }), baseRow({ 6: '连线题' })])
    const { errors } = normalizeRows(t, mapHeaders(CN_HEADERS), {})
    expect(errors).toHaveLength(2)
    expect(errors[0].line).toBe(2)
    expect(errors[0].column).toBe('题型')
    expect(errors[0].columnIndex).toBe(6)
    expect(errors[0].message).toContain('第 2 行')
    expect(errors[0].message).toContain('不能为空')
    expect(errors[1].message).toContain('不是支持的题型')
    expect(errors[1].hint).toContain('single')
  })

  it('报错：题干 / 答案为空', () => {
    const t = tableFor(CN_HEADERS, [baseRow({ 7: '' }), baseRow({ 9: '' })])
    const { errors } = normalizeRows(t, mapHeaders(CN_HEADERS), {})
    expect(errors.map((e) => e.column)).toEqual(['题目', '答案'])
    expect(errors[0].hint).toContain('______')
  })

  it('报错：单选题没填选项', () => {
    const t = tableFor(CN_HEADERS, [baseRow({ 6: 'single', 8: '', 9: 'A' })])
    const { errors } = normalizeRows(t, mapHeaders(CN_HEADERS), {})
    expect(errors).toHaveLength(1)
    expect(errors[0].column).toBe('选项')
    expect(errors[0].hint).toContain('|')
  })

  it('报错：答案字母不在选项里', () => {
    const t = tableFor(CN_HEADERS, [baseRow({ 6: 'single', 8: 'A. 甲 | B. 乙', 9: 'C' })])
    const { errors } = normalizeRows(t, mapHeaders(CN_HEADERS), {})
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('C')
    expect(errors[0].message).toContain('A/B')
  })

  it('报错：matching 连线题劝退（表格表达不了左右两栏）', () => {
    const t = tableFor(CN_HEADERS, [baseRow({ 6: 'matching' })])
    const { errors } = normalizeRows(t, mapHeaders(CN_HEADERS), {})
    expect(errors.some((e) => e.message.includes('连线题'))).toBe(true)
  })

  it('报错：年级不是数字', () => {
    const t = tableFor(CN_HEADERS, [baseRow({ 1: '四年级' })])
    const { errors } = normalizeRows(t, mapHeaders(CN_HEADERS), {})
    expect(errors[0].column).toBe('年级')
    expect(errors[0].message).toContain('不是数字')
  })

  it('报错：题目ID 重复', () => {
    const headers = [...CN_HEADERS, '题目ID']
    const t = tableFor(headers, [baseRow({ 12: 'x1' }), baseRow({ 12: 'x1' })])
    const { errors } = normalizeRows(t, mapHeaders(headers), {})
    expect(errors.some((e) => e.message.includes('重复'))).toBe(true)
  })

  it('报错：知识点两个列都空', () => {
    const t = tableFor(CN_HEADERS, [baseRow({ 4: '', 5: '' })])
    const { errors } = normalizeRows(t, mapHeaders(CN_HEADERS), {})
    expect(errors[0].message).toContain('知识点')
  })

  it('全空行直接跳过，不算错误', () => {
    const t = tableFor(CN_HEADERS, [baseRow(), ['', '', '', '', '', '', '', '', '', '', '', '']])
    const { rows, errors } = normalizeRows(t, mapHeaders(CN_HEADERS), {})
    expect(rows).toHaveLength(1)
    expect(errors).toEqual([])
  })

  it('**不做 early return**：一次把所有行的错都报出来', () => {
    const t = tableFor(CN_HEADERS, [baseRow({ 6: '' }), baseRow({ 7: '' }), baseRow({ 9: '' })])
    const { errors } = normalizeRows(t, mapHeaders(CN_HEADERS), {})
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4])
  })
})

describe('小工具函数', () => {
  it('splitOptions：竖线 / 全角竖线 / 换行都能切', () => {
    expect(splitOptions('A. 甲 | B. 乙')).toEqual(['A. 甲', 'B. 乙'])
    expect(splitOptions('A｜B')).toEqual(['A', 'B'])
    expect(splitOptions('A\nB')).toEqual(['A', 'B'])
    expect(splitOptions('')).toEqual([])
  })

  it('splitIdList：逗号 / 顿号 / 空格都能切', () => {
    expect(splitIdList('u1, u2；u3')).toEqual(['u1', 'u2', 'u3'])
    expect(splitIdList('')).toEqual([])
  })

  it('optionLetters：抽选项字母', () => {
    expect(optionLetters(['A. 甲', 'B、乙', 'C: 丙'])).toEqual(['A', 'B', 'C'])
    expect(optionLetters(['甲', '乙'])).toEqual([])
  })

  it('inferModuleType：与 TopicDetail.vue 的推断表一致', () => {
    expect(inferModuleType('math', 'concept')).toBe('math.concept')
    expect(inferModuleType('math', 'formula')).toBe('math.formula')
    expect(inferModuleType('chinese', 'poem')).toBe('chinese.poem')
    expect(inferModuleType('english', 'word')).toBe('english.vocab')
    expect(inferModuleType('english', 'unknown')).toBe(null)
    expect(inferModuleType('physics', 'concept')).toBe(null)
  })
})

describe('buildPackageFromRows · 生成的包满足内容铁律', () => {
  const rows = normalizeRows(
    parseCsv(
      [
        CN_HEADERS.join(','),
        ['math', '4', 'u1', '第一单元', 'kp-1', '大数的认识', 'blank', '1+1=______', '', '2', '略', '基础'].join(','),
        ['math', '4', 'u1', '第一单元', 'kp-1', '大数的认识', 'single', '1+1=?', 'A. 1 | B. 2', 'B', '略', '基础'].join(','),
        ['math', '4', 'u2', '第二单元', 'kp-2', '角的度量', 'blank', '直角是______度', '', '90', '略', '基础'].join(','),
      ].join('\n'),
    ),
    mapHeaders(CN_HEADERS),
    {},
  ).rows

  const opts = {
    packageId: 'unit-demo-u1',
    packageType: 'unit',
    title: '四上数学第一单元',
    subject: 'math',
    grade: 4,
    term: 'up',
    edition: '人教版',
    dependencies: [] as string[],
    visible: true,
  }

  const pkg = buildPackageFromRows(rows, opts)

  it('题目挂在 units[].topics[].exercises，不写顶层 exercises 池（避免 W030）', () => {
    expect(pkg.exercises).toBeUndefined()
    expect(pkg.units).toHaveLength(2)
    expect(pkg.units[0].topics[0].exercises).toHaveLength(2)
  })

  it('每个 topic 都有 knowledgePointIds 与至少一个 module（避免 W031）', () => {
    for (const u of pkg.units) {
      for (const t of u.topics) {
        expect(t.knowledgePointIds.length).toBeGreaterThan(0)
        expect(t.modules.length).toBeGreaterThan(0)
        expect(t.modules[0].type).toBe('math.concept')
      }
    }
  })

  it('ID 一律写裸 ID，`::` 前缀交给打包脚本（避免 W032 / W033）', () => {
    expect(pkg.knowledgePoints.every((kp: any) => !kp.id.includes('::'))).toBe(true)
    expect(JSON.stringify(pkg.units).includes('::')).toBe(false)
  })

  it('manifest 字段齐全', () => {
    expect(pkg.manifest.packageId).toBe('unit-demo-u1')
    expect(pkg.manifest.type).toBe('unit')
    expect(pkg.manifest.subject).toBe('math')
    expect(pkg.manifest.grade).toBe(4)
    expect(pkg.manifest.term).toBe('up')
    expect(pkg.manifest.edition).toBe('人教版')
    expect(pkg.manifest.dependencies).toEqual([])
  })

  it('知识点去重 + prerequisites 空数组 + content 有兜底', () => {
    expect(pkg.knowledgePoints).toHaveLength(2)
    expect(pkg.knowledgePoints[0].prerequisites).toEqual([])
    expect(pkg.knowledgePoints[0].content).toBe('大数的认识')
  })

  it('unit 包不写 examMode / sourceUnitIds', () => {
    expect(pkg.manifest.examMode).toBeUndefined()
    expect(pkg.manifest.sourceUnitIds).toBeUndefined()
  })

  it('special / sprint 必写 examMode 与 sourceUnitIds', () => {
    const sprint = buildPackageFromRows(rows, {
      ...opts,
      packageId: 'sprint-demo',
      packageType: 'sprint',
      sourceUnitIds: ['u1', 'u2'],
    })
    expect(sprint.manifest.examMode).toBe(true)
    expect(sprint.manifest.sourceUnitIds).toEqual(['u1', 'u2'])

    const special = buildPackageFromRows(rows, {
      ...opts,
      packageId: 'special-demo',
      packageType: 'special',
      examMode: false,
      sourceUnitIds: ['u1'],
    })
    expect(special.manifest.examMode).toBe(false)
    expect(special.manifest.sourceUnitIds).toEqual(['u1'])
  })

  it('_set.json 与 content/**/_set.json 同形（可直接喂给 build:lpkgset）', () => {
    const set = buildSetConfig({ ...opts, packageType: 'sprint', sourceUnitIds: ['u1'] }, 'unit-demo-u1.json')
    expect(set.setId).toBe('unit-demo-u1-set')
    expect(set.importOrder).toEqual(['unit-demo-u1'])
    expect(set.packages[0]).toMatchObject({
      file: 'unit-demo-u1.json',
      packageId: 'unit-demo-u1',
      type: 'sprint',
      sourceUnitIds: ['u1'],
    })
  })
})
