/**
 * CSV / 表格 → `.lpkgset` 转包工具（V1.11 Stage F · F3）
 *
 * ## 给谁用
 *
 * 家长 / 老师：在 Excel / WPS 里按表头填满一张表，运行一次就出一个可导入的学习包。
 * 所以**所有失败都必须是人话**（第几行第几列缺什么），绝不抛裸栈。
 *
 * ## 用法
 *
 * ```bash
 * npx vite-node scripts/build-from-csv.ts -- 题库.csv -o csv-build/demo \
 *   --type unit --title "四上数学第一单元" --subject math --grade 4
 * ```
 *
 * 选项：
 *   -o, --out <dir>          输出目录（默认 ./csv-build/<packageId>）
 *   --package-id <id>        包 ID（默认取 CSV 文件名）
 *   --type <unit|special|sprint>
 *   --title <标题>            （默认取 CSV 文件名）
 *   --subject <学科>          （也可在表格里加「学科」列）
 *   --grade <数字>            （也可在表格里加「年级」列）
 *   --term <up|down>          默认 up
 *   --edition <版本>          默认 自编
 *   --exam-mode               考试模式（sprint 默认开）
 *   --source-unit-ids <a,b>   special / sprint 必填的来源单元 ID
 *   --dependencies <a,b>
 *   --internal                内部包（不在书架上直接显示）
 *   --allow-missing-source    special/sprint 缺 sourceUnitIds 时不报错
 *   --delimiter <字符>        强制指定分隔符（默认自动识别 , / Tab / ; ）
 *   --no-zip                  只产出 JSON，不生成 .lpkgset.zip
 *   --strict                  有质量警告也算失败
 *
 * ## 产物
 *
 * - `<out>/<packageId>.json`  —— 可直接用 `npm run validate --` 校验的包
 * - `<out>/_set.json`         —— 集合配置，可直接用 `npm run build:lpkgset --`
 * - `<out>/<setId>.lpkgset.zip`（`--no-zip` 时不产出）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, join, basename, dirname } from 'path'
import { normalizePackage, type NormalizeIssue } from '../src/core/importer/normalizePackage'
import { qualityChecks } from './lib/qualityChecks'
import { rewriteIdsInPackage } from './lib/idRewrite'
import { buildLpkgsetZip } from './lib/packSet'
import {
  parseCsv,
  mapHeaders,
  describeMissingColumns,
  normalizeRows,
  buildPackageFromRows,
  buildSetConfig,
  splitIdList,
  COLUMN_SPECS,
  VALID_EXERCISE_TYPES,
  type BuildPackageOptions,
} from './lib/csvImport'

const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
}

const VALID_PACKAGE_TYPES = ['unit', 'special', 'sprint']

/** 人话错误：带 hint，统一收集后打印，不抛栈 */
interface ToolError {
  message: string
  hint?: string
}

// ============================================================================
// 参数
// ============================================================================

interface Args {
  input: string
  out?: string
  packageId?: string
  packageType: string
  title?: string
  subject?: string
  grade?: number
  term: string
  edition: string
  examMode?: boolean
  sourceUnitIds: string[]
  dependencies: string[]
  visible: boolean
  allowMissingSource: boolean
  delimiter?: string
  noZip: boolean
  strict: boolean
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  const args: Args = {
    input: '',
    packageType: 'unit',
    term: 'up',
    edition: '自编',
    sourceUnitIds: [],
    dependencies: [],
    visible: true,
    allowMissingSource: false,
    noZip: false,
    strict: false,
  }

  const takeValue = (i: number, flag: string): string => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) {
      throw new Error(`选项 ${flag} 后面要跟一个值，例如 ${flag} math`)
    }
    return v
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '-o':
      case '--out':
        args.out = takeValue(i, a); i++; break
      case '--package-id':
        args.packageId = takeValue(i, a); i++; break
      case '--type':
        args.packageType = takeValue(i, a); i++; break
      case '--title':
        args.title = takeValue(i, a); i++; break
      case '--subject':
        args.subject = takeValue(i, a); i++; break
      case '--grade': {
        const raw = takeValue(i, a); i++
        const n = Number(raw)
        if (!Number.isFinite(n)) throw new Error(`--grade 后面要跟数字，收到「${raw}」`)
        args.grade = n
        break
      }
      case '--term':
        args.term = takeValue(i, a); i++; break
      case '--edition':
        args.edition = takeValue(i, a); i++; break
      case '--source-unit-ids':
        args.sourceUnitIds = splitIdList(takeValue(i, a)); i++; break
      case '--dependencies':
        args.dependencies = splitIdList(takeValue(i, a)); i++; break
      case '--delimiter':
        args.delimiter = takeValue(i, a); i++; break
      case '--exam-mode':
        args.examMode = true; break
      case '--internal':
        args.visible = false; break
      case '--allow-missing-source':
        args.allowMissingSource = true; break
      case '--no-zip':
        args.noZip = true; break
      case '--strict':
        args.strict = true; break
      default:
        if (a.startsWith('-')) throw new Error(`不认识的参数：${a}`)
        positional.push(a)
        break
    }
  }

  args.input = positional[0] ?? ''
  return args
}

function printUsage(): void {
  console.log(`${C.bold}CSV / 表格 → 学习包${C.reset}`)
  console.log('')
  console.log('用法:')
  console.log('  npx vite-node scripts/build-from-csv.ts -- <input.csv> [选项]')
  console.log('')
  console.log('最简示例:')
  console.log('  npx vite-node scripts/build-from-csv.ts -- 题库.csv --subject math --grade 4')
  console.log('')
  console.log(`${C.bold}表头（中英文都认，大小写不敏感，必填 3 列已标 *）${C.reset}`)
  for (const spec of COLUMN_SPECS) {
    const star = spec.required ? '*' : ' '
    console.log(`  ${star} ${spec.label.padEnd(6, '　')} 可写：${spec.aliases.slice(0, 4).join(' / ')}`)
  }
  console.log('')
  console.log(`题型只能是：${VALID_EXERCISE_TYPES.join(' / ')}（matching 连线题请用 JSON 手写）`)
  console.log('多空题：题干用 ______ 标出每个空，答案用逗号分隔（甲,乙），工具自动转成数组')
  console.log('')
}

// ============================================================================
// 打印
// ============================================================================

function fmtIssue(issue: NormalizeIssue, indent = '  '): string {
  const color = issue.level === 'error' ? C.red : C.yellow
  const tag = issue.level === 'error' ? '❌' : '⚠️ '
  const lines = [
    `${indent}${tag} [${C.bold}${issue.code}${C.reset}] ${C.gray}${issue.path}${C.reset}`,
    `${indent}   ${color}${issue.message}${C.reset}`,
  ]
  if (issue.hint) lines.push(`${indent}   ${C.cyan}💡 ${issue.hint}${C.reset}`)
  return lines.join('\n')
}

function fail(errors: ToolError[]): never {
  console.log(`${C.red}${C.bold}❌ 没能生成学习包${C.reset}`)
  for (const e of errors) {
    console.log(`  ${C.red}• ${e.message}${C.reset}`)
    if (e.hint) console.log(`    ${C.cyan}💡 ${e.hint}${C.reset}`)
  }
  console.log('')
  process.exit(1)
}

// ============================================================================
// 主流程
// ============================================================================

export function main(): void {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e: any) {
    console.log(`${C.red}❌ ${e.message}${C.reset}`)
    console.log('')
    printUsage()
    process.exit(1)
    return
  }

  if (args.input === '') {
    printUsage()
    process.exit(1)
    return
  }

  // ---------- 1. 读文件 ----------
  const absInput = resolve(process.cwd(), args.input)
  if (!existsSync(absInput)) {
    fail([{ message: `找不到文件：${absInput}`, hint: '检查路径有没有写错；CSV 请用 UTF-8 另存，否则中文会乱码' }])
    return
  }
  let text: string
  try {
    text = readFileSync(absInput, 'utf-8')
  } catch (e: any) {
    fail([{ message: `读不出文件：${e.message}`, hint: '文件可能被 Excel 占用着，先关掉再试' }])
    return
  }

  console.log(`${C.bold}📄 输入:${C.reset} ${absInput}`)

  // ---------- 2. 解析表格 ----------
  const table = parseCsv(text, args.delimiter)
  if (table.headers.length === 0 || table.rows.length === 0) {
    fail([{
      message: '这张表是空的（没有表头或没有数据行）',
      hint: '第 1 行要是表头，第 2 行起是题目；至少要有「题型」「题目」「答案」三列',
    }])
    return
  }
  const delimiterName = table.delimiter === '\t' ? 'Tab' : `「${table.delimiter}」`
  console.log(`${C.gray}   分隔符 ${delimiterName}，表头 ${table.headers.length} 列，数据 ${table.rows.length} 行${C.reset}`)

  // ---------- 3. 表头校验 ----------
  const map = mapHeaders(table.headers)
  if (map.missing.length > 0) {
    fail([{
      message: `表头缺少必填列：${describeMissingColumns(map.missing)}`,
      hint: `当前表头是：${table.headers.join(' | ')}`,
    }])
    return
  }
  if (map.unknown.length > 0) {
    console.log(`${C.yellow}   ⚠️  这些列没认出来，已忽略：${map.unknown.join('、')}${C.reset}`)
  }

  // ---------- 4. 学科 / 年级 ----------
  const errors: ToolError[] = []
  const stem = basename(absInput).replace(/\.(csv|tsv|txt)$/i, '')
  const packageId = args.packageId || stem
  const title = args.title || stem

  let subject = args.subject ?? ''
  let grade: number | null = args.grade ?? null
  if (subject === '' || grade === null) {
    const { rows } = normalizeRows(table, map, {})
    const fromTable = rows.find((r) => r.subject !== '')
    if (subject === '' && fromTable) subject = fromTable.subject
    if (grade === null) {
      const withGrade = rows.find((r) => r.grade !== null)
      if (withGrade) grade = withGrade.grade
    }
  }
  if (subject === '') {
    errors.push({ message: '不知道学科', hint: '加 --subject math（或 chinese / english），也可以在表格里加一列「学科」' })
  }
  if (grade === null) {
    errors.push({ message: '不知道年级', hint: '加 --grade 4，也可以在表格里加一列「年级」' })
  }
  if (!VALID_PACKAGE_TYPES.includes(args.packageType)) {
    errors.push({
      message: `--type 写了「${args.packageType}」，只支持 ${VALID_PACKAGE_TYPES.join(' / ')}`,
      hint: 'unit = 同步单元包；special = 专项包；sprint = 冲刺卷',
    })
  }
  if (errors.length > 0) {
    fail(errors)
    return
  }

  // ---------- 5. 逐行校验 ----------
  const { rows, errors: rowErrors } = normalizeRows(table, map, {
    subject,
    grade: grade ?? 0,
  })
  if (rowErrors.length > 0) {
    console.log(`${C.red}${C.bold}❌ 表格有 ${rowErrors.length} 处问题：${C.reset}`)
    for (const e of rowErrors.slice(0, 50)) {
      const col = e.columnIndex >= 0 ? `第 ${e.columnIndex + 1} 列「${e.column}」` : `「${e.column}」`
      console.log(`  ${C.red}• 第 ${e.line} 行 ${col}：${e.message}${C.reset}`)
      if (e.hint) console.log(`    ${C.cyan}💡 ${e.hint}${C.reset}`)
    }
    if (rowErrors.length > 50) {
      console.log(`  ${C.gray}… 还有 ${rowErrors.length - 50} 处，先改完这些再看${C.reset}`)
    }
    console.log(`${C.gray}（行号按 Excel 习惯：表头是第 1 行）${C.reset}`)
    console.log('')
    process.exit(1)
    return
  }
  if (rows.length === 0) {
    fail([{ message: '表里一行有效数据都没有', hint: '第 2 行起开始填题目' }])
    return
  }

  // ---------- 6. 内容铁律：special / sprint 必写 sourceUnitIds ----------
  if ((args.packageType === 'special' || args.packageType === 'sprint') &&
      args.sourceUnitIds.length === 0 &&
      !args.allowMissingSource) {
    fail([{
      message: `${args.packageType} 包必须写 sourceUnitIds（来源单元 ID）`,
      hint: '用 --source-unit-ids u1,u3 传入；确实没有来源单元时加 --allow-missing-source',
    }])
    return
  }

  // ---------- 7. 组装 ----------
  const buildOpts: BuildPackageOptions = {
    packageId,
    packageType: args.packageType,
    title,
    subject,
    grade: grade ?? 0,
    term: args.term,
    edition: args.edition,
    examMode: args.examMode,
    sourceUnitIds: args.sourceUnitIds,
    dependencies: args.dependencies,
    visible: args.visible,
  }
  const pkg = buildPackageFromRows(rows, buildOpts)
  const fileName = `${packageId}.json`
  const setConfig = buildSetConfig(buildOpts, fileName)

  const unitCount = pkg.units?.length ?? 0
  const kpCount = pkg.knowledgePoints?.length ?? 0
  const exCount = (pkg.units ?? []).reduce(
    (n: number, u: any) => n + (u.topics ?? []).reduce((m: number, t: any) => m + (t.exercises?.length ?? 0), 0),
    0,
  )
  console.log(`${C.bold}📦 组装:${C.reset} ${packageId}（${unitCount} 单元 / ${kpCount} 知识点 / ${exCount} 题）`)

  // ---------- 8. 自检（复用既有校验内核，不合规就报错说明） ----------
  const { errors: normErrors, warnings: normWarnings } = normalizePackage(pkg)
  const quality = qualityChecks(pkg)

  if (normErrors.length > 0) {
    console.log(`${C.red}${C.bold}❌ 生成的包没通过校验（${normErrors.length} 个错误）:${C.reset}`)
    normErrors.forEach((e) => console.log(fmtIssue(e)))
    console.log(`${C.gray}  这是工具自身的输出，请带上上面的原文反馈${C.reset}`)
    console.log('')
    process.exit(1)
    return
  }
  if (normWarnings.length > 0) {
    console.log(`${C.yellow}  ⚠️  规范化警告 ${normWarnings.length} 条${C.reset}`)
    normWarnings.forEach((w) => console.log(fmtIssue(w)))
  }
  if (quality.length > 0) {
    console.log(`${C.yellow}  ⚠️  内容质量提示 ${quality.length} 条（不阻塞，建议改）${C.reset}`)
    quality.forEach((w) => console.log(fmtIssue(w)))
  }

  if (args.strict && quality.length + normWarnings.length > 0) {
    console.log(`${C.red}❌ --strict 模式：有 ${quality.length + normWarnings.length} 条警告，按失败处理${C.reset}`)
    console.log('')
    process.exit(1)
    return
  }

  // ---------- 9. 落盘 ----------
  const outDir = resolve(process.cwd(), args.out || join('csv-build', packageId))
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  writeFileSync(join(outDir, fileName), JSON.stringify(pkg, null, 2), 'utf-8')
  writeFileSync(join(outDir, '_set.json'), JSON.stringify(setConfig, null, 2), 'utf-8')
  console.log(`  ✅ ${join(outDir, fileName)}`)
  console.log(`  ✅ ${join(outDir, '_set.json')}`)

  if (!args.noZip) {
    const rewritten = rewriteIdsInPackage(pkg, packageId)
    const zipBytes = buildLpkgsetZip({
      manifest: {
        schemaVersion: '1.0',
        setId: setConfig.setId,
        title: setConfig.title,
        subject: setConfig.subject,
        grade: setConfig.grade,
        term: setConfig.term,
        edition: setConfig.edition,
        importOrder: setConfig.importOrder,
      },
      packages: [rewritten],
    })
    const zipPath = join(outDir, `${setConfig.setId}.lpkgset.zip`)
    if (!existsSync(dirname(zipPath))) mkdirSync(dirname(zipPath), { recursive: true })
    writeFileSync(zipPath, Buffer.from(zipBytes))
    console.log(`  ✅ ${zipPath}（${(zipBytes.length / 1024).toFixed(1)} KB）`)
  }

  console.log('')
  console.log(`${C.green}${C.bold}✅ 生成完成${C.reset}`)
  console.log(`   ${C.gray}下一步：npm run validate -- ${join(outDir, fileName)}${C.reset}`)
  console.log('')
}

/**
 * 与 `scripts/build-lpkgset.ts` / `validate.ts` 同款：脚本底部直接执行。
 *
 * ⚠️ 别改成 `if (import.meta.url === ...)` 那套自运行判断 —— 本项目脚本是
 * `vite-node` 跑的，此时 `process.argv[1]` 是 `vite-node.mjs` 而不是脚本路径，
 * 判断必然为假，脚本会「运行成功但什么都不做」（踩过）。可单测的纯逻辑一律放
 * 在 `scripts/lib/csvImport.ts`，由 `tests/csv-build.test.ts` 覆盖。
 */
main()
