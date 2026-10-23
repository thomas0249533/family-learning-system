/**
 * packSet.ts —— 浏览器侧「学习包集合」(.lpkgset) 打包与表单→包模型转换。
 * =====================================================================
 * 两个纯函数：
 *   1. `buildPackageModel(form)`：把 Creator GUI 的表单状态，转成
 *      `normalizePackage` 能吃的学习包原始结构（单包）。
 *   2. `buildLpkgset(set)`：把 `{ manifest, packages }` 用 fflate 打成
 *      `Uint8Array`，zip 内部结构**完全复刻** `scripts/lib/packSet.ts` 的
 *      `buildLpkgsetZip`（`manifest.json` + `packages/<id>.json`），
 *      因此能被 `PackageImporter.importPackageSet` 正确解包。
 *
 * 无 Node 依赖，浏览器 / 测试环境皆可运行。
 */

import { zipSync, strToU8 } from 'fflate'

// ============================================================================
// 表单状态类型（CreatorCenter.vue 直接使用）
// ============================================================================

export type QuestionType =
  | 'single'
  | 'blank'
  | 'multiple'
  | 'judge'
  | 'matching'
  | 'spelling'
  | 'essay'

export interface CreatorQuestion {
  id: string
  type: QuestionType
  question: string
  /** 答案：填空/拼写/问答写为字符串；连线题写为索引数组（逗号分隔） */
  answer: string
  /** 选项：single/multiple 用，每行一个；judge 可留空 */
  optionsText: string
  /** 连线题左列（每行一个） */
  leftText?: string
  /** 连线题右列（每行一个） */
  rightText?: string
  explanation?: string
}

export interface CreatorKnowledgePoint {
  id: string
  title: string
  /** 前置知识点 id，逗号或换行分隔 */
  prerequisites: string
  questions: CreatorQuestion[]
}

export interface CreatorUnit {
  title: string
  knowledgePoints: CreatorKnowledgePoint[]
}

export interface CreatorForm {
  /** 科目标题 */
  title: string
  /** 可选显式 packageId；缺省由标题生成 slug */
  packageId?: string
  subject: 'math' | 'chinese' | 'english'
  grade: number
  term: 'up' | 'down'
  edition: string
  units: CreatorUnit[]
}

export interface BuildSetInput {
  manifest: Record<string, any>
  packages: any[]
}

// ============================================================================
// 工具
// ============================================================================

function slugify(s: string): string {
  const base = s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w一-龥-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base || `pkg-${Date.now().toString(36)}`
}

/** 把多行 / 逗号文本切成非空数组 */
function parseLines(text: string | undefined): string[] {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

function parseIdList(text: string | undefined): string[] {
  if (!text) return []
  return text
    .split(/[\r?\n,，、]/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/** 把答案文本转成 normalizePackage 期望的形状 */
function buildAnswer(q: CreatorQuestion): unknown {
  if (q.type === 'matching') {
    const idx = parseLines(q.answer)
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => !Number.isNaN(n))
    return idx
  }
  return q.answer.trim()
}

function buildOptions(q: CreatorQuestion): string[] | undefined {
  if (q.type === 'single' || q.type === 'multiple') {
    return parseLines(q.optionsText)
  }
  return undefined
}

// ============================================================================
// 表单 → 单包模型
// ============================================================================

/**
 * 把 Creator 表单状态转换成 `normalizePackage` 可校验/导入的包结构。
 * 结构：manifest + 扁平 knowledgePoints + units[].topics[].exercises。
 */
export function buildPackageModel(form: CreatorForm): any {
  const packageId = (form.packageId && form.packageId.trim()) || slugify(form.title)

  const knowledgePoints: any[] = []
  const units: any[] = []

  form.units.forEach((unit, ui) => {
    const unitId = `u${ui + 1}`
    const topics: any[] = []

    unit.knowledgePoints.forEach((kp, ki) => {
      const kpId = kp.id && kp.id.trim() ? kp.id.trim() : `${unitId}-kp${ki + 1}`
      knowledgePoints.push({
        id: kpId,
        title: kp.title,
        prerequisites: parseIdList(kp.prerequisites),
      })

      const exercises = kp.questions.map((q, qi) => {
        const exId = q.id && q.id.trim() ? q.id.trim() : `${kpId}-q${qi + 1}`
        const ex: any = {
          id: exId,
          type: q.type,
          question: q.question,
          answer: buildAnswer(q),
          knowledgePointIds: [kpId],
        }
        const opts = buildOptions(q)
        if (opts) ex.options = opts
        if (q.type === 'matching') {
          ex.left = parseLines(q.leftText)
          ex.right = parseLines(q.rightText)
        }
        if (q.explanation && q.explanation.trim()) ex.explanation = q.explanation.trim()
        return ex
      })

      topics.push({
        id: `${unitId}-t${ki + 1}`,
        title: kp.title,
        knowledgePointIds: [kpId],
        exercises,
      })
    })

    units.push({ id: unitId, title: unit.title, topics })
  })

  return {
    manifest: {
      schemaVersion: '1.0',
      packageId,
      type: 'unit',
      subject: form.subject,
      grade: Number(form.grade) || 0,
      term: form.term,
      edition: form.edition,
      title: form.title,
    },
    knowledgePoints,
    units,
  }
}

// ============================================================================
// 打包 .lpkgset
// ============================================================================

export interface SetManifest {
  schemaVersion: string
  setId: string
  title: string
  subject: string
  grade: number
  term: string
  edition: string
  importOrder: string[]
}

/**
 * 把 `{ manifest, packages }` 打成 `.lpkgset` 的 zip 字节。
 * 内部结构：`manifest.json` + `packages/<packageId>.json`，
 * 与 `scripts/lib/packSet.ts` 完全一致，可被 `importPackageSet` 解包。
 */
export function buildLpkgset(set: BuildSetInput): Uint8Array {
  const files: Record<string, Uint8Array> = {}

  files['manifest.json'] = strToU8(JSON.stringify(set.manifest, null, 2))

  for (const pkg of set.packages) {
    const packageId = pkg?.manifest?.packageId
    if (!packageId) continue
    files[`packages/${packageId}.json`] = strToU8(JSON.stringify(pkg, null, 2))
  }

  return zipSync(files, { level: 6 })
}

/**
 * 从单个表单构建可直接导出的 set（manifest + [pkg]）。
 * 便捷封装：CreatorCenter「导出」按钮直接调它。
 */
export function buildSetFromForm(form: CreatorForm): { manifest: SetManifest; packages: any[] } {
  const pkg = buildPackageModel(form)
  const packageId = pkg.manifest.packageId
  const manifest: SetManifest = {
    schemaVersion: '1.0',
    setId: packageId,
    title: form.title,
    subject: form.subject,
    grade: Number(form.grade) || 0,
    term: form.term,
    edition: form.edition,
    importOrder: [packageId],
  }
  return { manifest, packages: [pkg] }
}
