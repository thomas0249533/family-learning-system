/**
 * CSV / 表格 → 学习包的**纯逻辑层**（无 IO、无副作用，方便单测）。
 *
 * CLI 外壳见 `scripts/build-from-csv.ts`；本文件只负责：
 *   1. `parseCsv` 解析表格文本（自写，零依赖，支持引号 / 转义 / CRLF / BOM / 分隔符自动识别）；
 *   2. `mapHeaders` 表头中英别名映射 + 缺列人话报错；
 *   3. `normalizeRows` 逐行校验（第几行第几列缺什么）；
 *   4. `buildPackageFromRows` 组装出符合既有内容铁律的包 JSON。
 *
 * ## 目标用户是家长 / 老师
 *
 * 所以报错必须是**人话**（「表格第 3 行第 2 列「题目」不能为空」），
 * 绝不能把裸栈抛给非技术用户 —— 所有失败都收敛成 `RowError[]` 由 CLI 打印。
 */

import { splitAnswerSegments } from './qualityChecks'

// ============================================================================
// CSV 解析
// ============================================================================

/** 一行数据（line = 表格里的行号，表头是第 1 行） */
export interface CsvRow {
  line: number
  cells: string[]
}

export interface CsvTable {
  headers: string[]
  rows: CsvRow[]
  delimiter: string
}

/** 参与分隔符自动识别的候选 */
const DELIMITER_CANDIDATES = [',', '\t', ';', '，', '｜', '|']

/** 去掉 BOM 与 BOM 之外的不可见控制符（Excel 导出常带 \uFEFF） */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 在**未考虑引号**的前提下粗略挑分隔符：取首行出现次数最多的候选 */
function detectDelimiter(firstLine: string): string {
  let best = ','
  let bestCount = -1
  for (const d of DELIMITER_CANDIDATES) {
    const count = firstLine.split(d).length - 1
    if (count > bestCount) {
      bestCount = count
      best = d
    }
  }
  return best
}

/**
 * 解析 CSV / TSV 文本（RFC4180 子集，够用且零依赖）。
 *
 * 支持：双引号包裹字段、字段内换行、`""` 转义引号、CRLF / LF、BOM。
 * 分隔符缺省时按首行出现频次自动识别（Excel「另存为 CSV」是逗号，
 * WPS 表格直接复制出来是 Tab）。
 *
 * @param text 表格文本
 * @param delimiter 显式指定分隔符（不传则自动识别）
 */
export function parseCsv(text: string, delimiter?: string): CsvTable {
  const src = stripBom(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const delim = delimiter && delimiter.length > 0 ? delimiter : detectDelimiter(src.split('\n')[0] ?? '')

  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === delim) {
      record.push(field)
      field = ''
      continue
    }
    if (ch === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
      continue
    }
    field += ch
  }
  // 最后一行没有换行收尾时也要收进来
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }

  // 只丢**一个**末尾空记录 —— 它是「文件以换行结尾」产生的假行；
  // 表格中间真有的空行要保留（行号才对得上），由 normalizeRows 跳过。
  if (records.length > 1 && records[records.length - 1].every((c) => c.trim() === '')) {
    records.pop()
  }

  const headers = (records[0] ?? []).map((h) => h.trim())
  // 列数不足时补空串：Excel 常把行尾的空格子全省掉，补齐后列号才不会错位
  const rows: CsvRow[] = records.slice(1).map((cells, i) => {
    const padded = cells.slice()
    while (padded.length < headers.length) padded.push('')
    return { line: i + 2, cells: padded }
  })
  return { headers, rows, delimiter: delim }
}

// ============================================================================
// 表头规格
// ============================================================================

/**
 * 列规格。`aliases` 里**中英文都要给**，因为家长可能用 WPS 的中文模板，
 * 也可能直接用英文表头。匹配前会做「去空格 + 去 `*` + 转小写」的归一。
 */
export interface ColumnSpec {
  key: string
  /** 中文名，报错时给人看 */
  label: string
  aliases: string[]
  /** 是否必填列（缺列直接报错，不进逐行校验） */
  required: boolean
}

export const COLUMN_SPECS: readonly ColumnSpec[] = [
  { key: 'id', label: '题目ID', aliases: ['题目id', '题目ID', '题号', 'id', 'exerciseid'], required: false },
  { key: 'subject', label: '学科', aliases: ['学科', '科目', 'subject'], required: false },
  { key: 'grade', label: '年级', aliases: ['年级', 'grade'], required: false },
  { key: 'unitId', label: '单元ID', aliases: ['单元id', '单元ID', '单元编号', 'unitid', 'unit'], required: false },
  { key: 'unitTitle', label: '单元名称', aliases: ['单元名称', '单元标题', '单元', '单元名', 'unittitle', 'unitname'], required: false },
  { key: 'knowledgePointId', label: '知识点ID', aliases: ['知识点id', '知识点ID', '知识点编号', 'knowledgepointid', 'kpid'], required: false },
  { key: 'knowledgePointTitle', label: '知识点名称', aliases: ['知识点名称', '知识点', '知识点标题', 'knowledgepointtitle', 'kptitle'], required: false },
  { key: 'knowledgePointType', label: '知识点类型', aliases: ['知识点类型', 'kptype', 'knowledgepointtype'], required: false },
  { key: 'knowledgePointContent', label: '知识点内容', aliases: ['知识点内容', '讲解', '讲解内容', 'kpcontent', 'knowledgepointcontent'], required: false },
  { key: 'type', label: '题型', aliases: ['题型', '题目类型', 'type', 'questiontype'], required: true },
  { key: 'question', label: '题目', aliases: ['题目', '题干', 'question', 'stem'], required: true },
  { key: 'options', label: '选项', aliases: ['选项', 'options', 'choices'], required: false },
  { key: 'answer', label: '答案', aliases: ['答案', '标准答案', 'answer'], required: true },
  { key: 'explanation', label: '解析', aliases: ['解析', 'explanation', 'analysis'], required: false },
  { key: 'difficulty', label: '难度', aliases: ['难度', 'difficulty'], required: false },
  { key: 'sourceUnitIds', label: '来源单元', aliases: ['来源单元', '来源单元id', '来源单元ID', 'sourceunitids'], required: false },
]

/** 表头归一：去 BOM / 空格 / `*`（模板里常用 `题目*` 标记必填）/ 转小写 */
export function normalizeHeaderCell(cell: string): string {
  return String(cell ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\*/g, '')
    .trim()
    .toLowerCase()
}

export interface HeaderMap {
  /** key → 列下标（0 基） */
  index: Record<string, number>
  /** 缺失的必填列 */
  missing: ColumnSpec[]
  /** 表头里没认出来的列（只提示，不报错） */
  unknown: string[]
}

/**
 * 表头映射。别名按 `COLUMN_SPECS` 顺序**先到先得** —— 所以
 * `单元ID` 必须排在 `单元` 前面，否则 `单元` 会把 ID 列抢走。
 */
export function mapHeaders(headers: string[]): HeaderMap {
  const index: Record<string, number> = {}
  const unknown: string[] = []
  const used = new Set<number>()

  for (const spec of COLUMN_SPECS) {
    for (const alias of spec.aliases) {
      const target = normalizeHeaderCell(alias)
      const at = headers.findIndex((h, i) => !used.has(i) && normalizeHeaderCell(h) === target)
      if (at >= 0) {
        index[spec.key] = at
        used.add(at)
        break
      }
    }
  }

  for (let i = 0; i < headers.length; i++) {
    if (used.has(i)) continue
    if (normalizeHeaderCell(headers[i]) !== '') unknown.push(headers[i])
  }

  const missing = COLUMN_SPECS.filter((s) => s.required && index[s.key] === undefined)
  return { index, missing, unknown }
}

/** 缺列的报错文案（人话，含可接受的表头名） */
export function describeMissingColumns(missing: ColumnSpec[]): string {
  return missing
    .map((s) => `「${s.label}」（表头可写：${s.aliases.slice(0, 3).join(' / ')}）`)
    .join('、')
}

// ============================================================================
// 逐行校验
// ============================================================================

/** 题型白名单 —— 与 `@core/importer/normalizePackage` 的 VALID_TYPES 一致 */
export const VALID_EXERCISE_TYPES: readonly string[] = [
  'single', 'blank', 'multiple', 'judge', 'matching', 'spelling', 'essay',
]

/** 逐行校验的错误（人话，带行列号） */
export interface RowError {
  line: number
  /** 列名；列不存在时为空串 */
  column: string
  /** 0 基列下标；-1 表示与具体列无关 */
  columnIndex: number
  message: string
  hint?: string
}

export interface RowDefaults {
  subject?: string
  grade?: number
}

export interface NormalizedRow {
  line: number
  id: string
  subject: string
  grade: number | null
  unitId: string
  unitTitle: string
  kpId: string
  kpTitle: string
  kpType: string
  kpContent: string
  type: string
  question: string
  options: string[]
  answer: unknown
  explanation: string
  difficulty: string
  sourceUnitIds: string[]
}

/** 取某列的值（列不存在返回 ''） */
function cell(row: CsvRow, map: HeaderMap, key: string): string {
  const at = map.index[key]
  if (at === undefined) return ''
  return String(row.cells[at] ?? '').trim()
}

/** 选项串 → 数组：`|` / `｜` / 换行 都当分隔符 */
export function splitOptions(raw: string): string[] {
  return String(raw ?? '')
    .split(/[|｜\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/** 来源单元串 → 数组：逗号 / 分号 / 顿号 / 空白 都当分隔符 */
export function splitIdList(raw: string): string[] {
  return String(raw ?? '')
    .split(/[,，、;；\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/** 从选项文本里抽选项字母（`A. xxx` → `A`），抽不到返回空数组 */
export function optionLetters(options: string[]): string[] {
  const letters: string[] = []
  for (const o of options) {
    const m = String(o).trim().match(/^([A-Za-z])\s*[.、:：)）]\s*/)
    if (m) letters.push(m[1].toUpperCase())
  }
  return letters
}

/**
 * 把答案切成数组（多空 / 多选）；标量题型保持标量。
 *
 * 复用 `qualityChecks.splitAnswerSegments` —— 与判分内核同一口径，
 * 保证「工具生成的包」和「App 判分」对多空答案的理解完全一致。
 */
function buildAnswer(type: string, raw: string): unknown {
  const text = String(raw ?? '').trim()
  if (type === 'multiple') {
    const parts = splitAnswerSegments(text)
    return parts.length > 1 ? parts : text
  }
  if (type === 'blank' || type === 'spelling') {
    const parts = splitAnswerSegments(text)
    return parts.length > 1 ? parts : text
  }
  return text
}

/**
 * 逐行校验 + 归一化。
 *
 * **不做 early return**：把所有行的错误都收集完再返回，让家长一次改完所有格子
 * （跑一次只报第一个错会让人把表格来回提交十几次）。
 */
export function normalizeRows(
  table: CsvTable,
  map: HeaderMap,
  defaults: RowDefaults = {},
): { rows: NormalizedRow[]; errors: RowError[] } {
  const errors: RowError[] = []
  const rows: NormalizedRow[] = []

  const seenIds = new Set<string>()
  const unitOrder: string[] = []
  const kpOrder: string[] = []
  let autoUnit = 0
  let autoKp = 0
  let autoEx = 0

  const colIndex = (key: string): number => map.index[key] ?? -1
  const colLabel = (key: string): string =>
    COLUMN_SPECS.find((s) => s.key === key)?.label ?? key

  for (const row of table.rows) {
    // ---- 全空行跳过（Excel 里常有）—— 不算错误
    if (row.cells.every((c) => String(c ?? '').trim() === '')) continue

    const line = row.line
    const push = (key: string, message: string, hint?: string): void => {
      errors.push({ line, column: colLabel(key), columnIndex: colIndex(key), message, hint })
    }

    // ---- 题型
    const type = cell(row, map, 'type').toLowerCase()
    if (type === '') {
      push('type', `第 ${line} 行「题型」不能为空`, '填 single（单选）/ blank（填空）/ multiple（多选）/ judge（判断）/ spelling（拼写）/ essay（简答）之一')
    } else if (!VALID_EXERCISE_TYPES.includes(type)) {
      push('type', `第 ${line} 行「题型」写了「${type}」，不是支持的题型`, `只能是 ${VALID_EXERCISE_TYPES.join(' / ')}`)
    }

    // ---- 题干
    const question = cell(row, map, 'question')
    if (question === '') {
      push('question', `第 ${line} 行「题目」不能为空`, '把完整的题干抄进来；多空题用 ______（6 个下划线）标出每个空')
    }

    // ---- 答案
    const answerRaw = cell(row, map, 'answer')
    if (answerRaw === '') {
      push('answer', `第 ${line} 行「答案」不能为空`, '多空题的答案用逗号分隔（甲,乙），工具会自动转成数组')
    }

    // ---- 选项（单选 / 多选必填）
    const optionsRaw = cell(row, map, 'options')
    const options = splitOptions(optionsRaw)
    if ((type === 'single' || type === 'multiple') && options.length === 0) {
      push('options', `第 ${line} 行是「${type}」题，但没有填选项`, '在「选项」列里用竖线分隔：A. 甲 | B. 乙 | C. 丙')
    }

    // ---- 选项字母与答案对得上（只对单选/多选，且选项确实带字母前缀时）
    if ((type === 'single' || type === 'multiple') && options.length > 0 && answerRaw !== '') {
      const letters = optionLetters(options)
      if (letters.length === options.length) {
        const given = splitAnswerSegments(answerRaw).map((s) => s.toUpperCase())
        const bad = given.filter((g) => !letters.includes(g))
        if (bad.length > 0) {
          push('answer', `第 ${line} 行答案「${answerRaw}」里的 ${bad.join('、')} 不在选项 ${letters.join('/')} 中`, '答案要写选项字母，与「选项」列的字母一致')
        }
      }
    }

    // ---- matching：CSV 表达不了 left/right，直接劝退
    if (type === 'matching') {
      push('type', `第 ${line} 行是「matching」连线题，表格列表达不了左右两栏`, '连线题请手写 JSON，或改用 single / blank 题型')
    }

    // ---- 知识点身份
    const kpIdRaw = cell(row, map, 'knowledgePointId')
    const kpTitleRaw = cell(row, map, 'knowledgePointTitle')
    if (kpIdRaw === '' && kpTitleRaw === '') {
      push('knowledgePointId', `第 ${line} 行没填知识点（「知识点ID」与「知识点名称」都是空的）`, '至少填一个；只填名称时工具会自动生成 ID（kp-1、kp-2…）')
    }
    const kpKey = kpIdRaw !== '' ? kpIdRaw : kpTitleRaw
    let kpId = kpIdRaw
    if (kpId === '') {
      if (!kpOrder.includes(kpKey)) {
        autoKp++
        kpOrder.push(kpKey)
        kpId = `kp-${autoKp}`
      } else {
        kpId = `kp-${kpOrder.indexOf(kpKey) + 1}`
      }
    }

    // ---- 单元身份（允许缺省：整张表只有一个单元时不必每行列）
    const unitIdRaw = cell(row, map, 'unitId')
    const unitTitleRaw = cell(row, map, 'unitTitle')
    const unitKey = unitIdRaw !== '' ? unitIdRaw : unitTitleRaw
    let unitId = unitIdRaw
    if (unitId === '') {
      if (unitKey === '') {
        unitId = 'u1'
        if (!unitOrder.includes('u1')) unitOrder.push('u1')
      } else if (!unitOrder.includes(unitKey)) {
        autoUnit++
        unitOrder.push(unitKey)
        unitId = `u${autoUnit}`
      } else {
        unitId = `u${unitOrder.indexOf(unitKey) + 1}`
      }
    }

    // ---- 学科 / 年级（列优先，缺省用命令行 --subject / --grade）
    const subjectCell = cell(row, map, 'subject')
    const subject = subjectCell !== '' ? subjectCell : (defaults.subject ?? '')
    const gradeCell = cell(row, map, 'grade')
    let grade: number | null = null
    if (gradeCell !== '') {
      const n = Number(gradeCell)
      if (!Number.isFinite(n)) {
        push('grade', `第 ${line} 行「年级」写了「${gradeCell}」，不是数字`, '填 1~12 的数字，如 4')
      } else {
        grade = n
      }
    } else if (typeof defaults.grade === 'number') {
      grade = defaults.grade
    }

    // ---- 题目 ID
    let id = cell(row, map, 'id')
    if (id === '') {
      autoEx++
      id = `ex-${String(autoEx).padStart(3, '0')}`
    }
    if (seenIds.has(id)) {
      push('id', `第 ${line} 行的题目ID「${id}」与前面某一行重复`, '题目ID必须唯一；留空即可，工具会自动编号')
    }
    seenIds.add(id)

    rows.push({
      line,
      id,
      subject,
      grade,
      unitId,
      unitTitle: unitTitleRaw !== '' ? unitTitleRaw : unitId,
      kpId,
      kpTitle: kpTitleRaw !== '' ? kpTitleRaw : kpId,
      kpType: cell(row, map, 'knowledgePointType') || 'concept',
      kpContent: cell(row, map, 'knowledgePointContent'),
      type,
      question,
      options,
      answer: buildAnswer(type, answerRaw),
      explanation: cell(row, map, 'explanation'),
      difficulty: cell(row, map, 'difficulty'),
      sourceUnitIds: splitIdList(cell(row, map, 'sourceUnitIds')),
    })
  }

  return { rows, errors }
}

// ============================================================================
// 组装学习包
// ============================================================================

/**
 * 模块类型推断表 —— 逐字取自 `src/views/learn/TopicDetail.vue` 的 `inferModuleType`
 * （不能直接 import .vue，脚本侧也刻意不碰 src/）。
 */
const MODULE_TYPE_MAP: Record<string, Record<string, string>> = {
  chinese: {
    poem: 'chinese.poem',
    concept: 'chinese.text',
    word: 'chinese.words',
    writing: 'chinese.writing',
  },
  math: {
    formula: 'math.formula',
    concept: 'math.concept',
    life: 'math.life',
  },
  english: {
    word: 'english.vocab',
    grammar: 'english.grammar',
    concept: 'english.reading',
    writing: 'english.writing',
  },
}

/** 按学科 + 知识点类型推断 module.type；推不出来返回 null（topic 就不挂 modules） */
export function inferModuleType(subject: string, kpType: string): string | null {
  return MODULE_TYPE_MAP[subject]?.[kpType] ?? null
}

export interface BuildPackageOptions {
  packageId: string
  /** unit / special / sprint */
  packageType: string
  title: string
  subject: string
  grade: number
  term: string
  edition: string
  examMode?: boolean
  sourceUnitIds?: string[]
  dependencies?: string[]
  visible?: boolean
}

/**
 * 把归一化后的行组装成学习包 JSON。
 *
 * 结构遵循既有铁律：
 * - `manifest.packageId` / `type` / `subject` / `grade` / `term` / `edition` / `dependencies` 齐全；
 * - 题目挂在 `units[].topics[].exercises`（**不**写顶层 `exercises` 池，避免 W030）；
 * - 每个 topic 带 `knowledgePointIds` 与至少一个 `module`（避免 W031）；
 * - ID 一律写**裸 ID**，`::` 前缀交给打包脚本 `rewriteIdsInPackage` 加（避免 W032/W033）。
 */
export function buildPackageFromRows(
  rows: NormalizedRow[],
  opts: BuildPackageOptions,
): any {
  const knowledgePoints: any[] = []
  const units: any[] = []

  const kpSeen = new Set<string>()
  const unitMap = new Map<string, any>()

  for (const row of rows) {
    // ---- 知识点（首次出现时登记）
    if (!kpSeen.has(row.kpId)) {
      kpSeen.add(row.kpId)
      knowledgePoints.push({
        id: row.kpId,
        type: row.kpType,
        title: row.kpTitle,
        content: row.kpContent !== '' ? row.kpContent : row.kpTitle,
        prerequisites: [],
        metadata: row.difficulty !== '' ? { difficulty: row.difficulty } : {},
      })
    }

    // ---- 单元
    let unit = unitMap.get(row.unitId)
    if (!unit) {
      unit = { id: row.unitId, title: row.unitTitle, topics: [] }
      unitMap.set(row.unitId, unit)
      units.push(unit)
    }

    // ---- topic（一个知识点一个 topic）
    let topic = unit.topics.find((t: any) => t.id === `t-${row.kpId}`)
    if (!topic) {
      const moduleType = inferModuleType(opts.subject || row.subject, row.kpType)
      topic = {
        id: `t-${row.kpId}`,
        title: row.kpTitle,
        knowledgePointIds: [row.kpId],
        modules: moduleType
          ? [{ id: `m-${row.kpId}`, type: moduleType, title: row.kpTitle, knowledgePointIds: [row.kpId] }]
          : [{ id: `m-${row.kpId}`, type: `general.concept`, title: row.kpTitle, knowledgePointIds: [row.kpId] }],
        exercises: [],
      }
      unit.topics.push(topic)
    }

    // ---- 题目
    const ex: any = {
      id: row.id,
      type: row.type,
      question: row.question,
      answer: row.answer,
      knowledgePointIds: [row.kpId],
    }
    if (row.options.length > 0) ex.options = row.options
    if (row.explanation !== '') ex.explanation = row.explanation
    if (row.difficulty !== '') ex.metadata = { difficulty: row.difficulty }
    topic.exercises.push(ex)
  }

  const sourceUnitIds = opts.sourceUnitIds ?? []
  const manifest: any = {
    schemaVersion: '1.0',
    packageId: opts.packageId,
    type: opts.packageType,
    title: opts.title,
    subject: opts.subject,
    grade: opts.grade,
    term: opts.term,
    edition: opts.edition,
    isInternal: opts.visible === false,
    dependencies: opts.dependencies ?? [],
  }
  if (opts.packageType === 'special' || opts.packageType === 'sprint') {
    manifest.examMode = opts.examMode ?? opts.packageType === 'sprint'
    manifest.sourceUnitIds = sourceUnitIds
  }

  return { manifest, knowledgePoints, units }
}

/**
 * 生成配套 `_set.json`（与 `content/**\/_set.json` 同形，可直接喂给 build:lpkgset）。
 *
 * 只需要 `BuildPackageOptions` —— 包体已经由 `buildPackageFromRows` 产出了，
 * 这里不再回读包体，避免两份真值互相打架。
 */
export function buildSetConfig(
  opts: BuildPackageOptions,
  fileName: string,
): any {
  const entry: any = {
    file: fileName,
    packageId: opts.packageId,
    type: opts.packageType,
    visible: opts.visible !== false,
    dependencies: opts.dependencies ?? [],
  }
  if (opts.packageType === 'special' || opts.packageType === 'sprint') {
    entry.examMode = opts.examMode ?? opts.packageType === 'sprint'
    entry.sourceUnitIds = opts.sourceUnitIds ?? []
  }
  return {
    schemaVersion: '1.0',
    setId: `${opts.packageId}-set`,
    title: opts.title,
    subject: opts.subject,
    grade: opts.grade,
    term: opts.term,
    edition: opts.edition,
    importOrder: [opts.packageId],
    packages: [entry],
  }
}
