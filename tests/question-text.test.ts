import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  isTableSeparator,
  parseTable,
  renderQuestionText,
  splitTableRow,
} from '@core/quiz/questionText'
import { splitJudgeStatements } from '@core/quiz/judge'

/**
 * 题干最小 Markdown 子集测试（V1.3 · E-02，对应 PRD §7.2 AC-E2-2/3/4/7/8）
 *
 * 上一版的 bug 是 `replace(/\\n/g,'<br>')` 匹配了**字面反斜杠+n**，
 * 而 JSON 里的 `\n` 解析后是真实换行 —— 所以 315 道带换行的题（16%）全挤成一行，
 * 8 道带表格的题（判断题课程表）直接没法做。
 * 这里把"真实换行"和"表格"两件事都钉死。
 */

const br = '<br>'

describe('escapeHtml：题干里的一切都是文本（AC-E2-3）', () => {
  it('转义 & < >', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
  })

  it('`<img src=x onerror=alert(1)>` 渲染成纯文本，不产生元素', () => {
    const html = renderQuestionText('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('`<script>` 同样只是文字', () => {
    const html = renderQuestionText('<script>alert(1)</script>')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('真实换行（AC-E2-2）', () => {
  it('两行文本之间出现 <br>，不再挤成一行', () => {
    expect(renderQuestionText('第一行\n第二行')).toBe(`第一行${br}第二行`)
  })

  it('连续换行保留为空行（两个 <br>）', () => {
    expect(renderQuestionText('A\n\nB')).toBe(`A${br}${br}B`)
  })

  it('兼容历史脏数据：字面 `\\n`（两个字符）也当换行', () => {
    expect(renderQuestionText('A\\nB')).toBe(`A${br}B`)
  })

  it('\\r\\n 归一化为单个换行（Windows 换行不会变成双倍行距）', () => {
    expect(renderQuestionText('A\r\nB')).toBe(`A${br}B`)
  })

  it('单行文本零变化（旧行为完全保留）', () => {
    expect(renderQuestionText('5 + 3 = ?')).toBe('5 + 3 = ?')
  })
})

describe('表格解析纯函数（AC-E2-8）', () => {
  it('splitTableRow：去掉首尾边框竖线', () => {
    expect(splitTableRow('| a | b |')).toEqual(['a', 'b'])
  })

  it('splitTableRow：保留空单元格（渲染成空 <td>）', () => {
    expect(splitTableRow('| a |  | c |')).toEqual(['a', '', 'c'])
  })

  it('splitTableRow：`\\|` 是内容不是分列（AC-E2-4）', () => {
    expect(splitTableRow('| a \\| b | c |')).toEqual(['a | b', 'c'])
  })

  it('分隔行只由 | - : 和空白组成', () => {
    expect(isTableSeparator('|---|---|')).toBe(true)
    expect(isTableSeparator('| :-- | --: |')).toBe(true)
    expect(isTableSeparator('| Day | Subject |')).toBe(false)
    expect(isTableSeparator('---')).toBe(true)
  })

  it('缺分隔行 → 不是表格（纯文本里的竖线不该被吃掉）', () => {
    expect(parseTable(['| a | b |', '| 1 | 2 |'], 0)).toBeNull()
    expect(renderQuestionText('| a | b |\n| 1 | 2 |')).toBe(`| a | b |${br}| 1 | 2 |`)
  })

  it('单列表格也能解析', () => {
    const out = parseTable(['| 时间 |', '|---|', '| 8:00 |'], 0)!
    expect(out.table.header).toEqual(['时间'])
    expect(out.table.rows).toEqual([['8:00']])
  })

  it('列数不齐：少了补空、多了截断（与 GFM 一致）', () => {
    const out = parseTable(['| a | b |', '|---|---|', '| 1 |', '| 1 | 2 | 3 |'], 0)!
    expect(out.table.rows).toEqual([['1', ''], ['1', '2']])
  })

  it('空行结束表格', () => {
    const out = parseTable(['| a |', '|---|', '| 1 |', '', '后面的段落'], 0)!
    expect(out.table.rows).toEqual([['1']])
    expect(out.next).toBe(3)
  })

  it('不含竖线的行结束表格（普通段落不被吞进表里）', () => {
    const out = parseTable(['| a |', '|---|', '| 1 |', '这是段落'], 0)!
    expect(out.table.rows).toEqual([['1']])
    expect(out.next).toBe(3)
  })
})

describe('表格渲染', () => {
  const md = ['阅读以下课程表：', '', '| Day | Subject |', '|---|---|', '| Monday | English |', '| Tuesday | Chinese |'].join('\n')

  it('渲染成带 thead/tbody 的表格，外层有横向滚动容器（AC-E2-5）', () => {
    const html = renderQuestionText(md)
    expect(html).toContain('<div class="q-table-wrap"><table class="q-table">')
    expect(html).toContain('<thead><tr><th>Day</th><th>Subject</th></tr></thead>')
    expect(html).toContain('<tbody><tr><td>Monday</td><td>English</td></tr>')
    expect(html).toContain('<tr><td>Tuesday</td><td>Chinese</td></tr></tbody>')
  })

  it('表格前后的普通文本仍按换行渲染', () => {
    const html = renderQuestionText(md)
    expect(html).toContain('阅读以下课程表：')
    expect(html.indexOf('阅读以下课程表：')).toBeLessThan(html.indexOf('<table'))
  })

  it('单元格内容也会转义', () => {
    const html = renderQuestionText('| a |\n|---|\n| <b> |')
    expect(html).toContain('<td>&lt;b&gt;</td>')
  })

  it('单元格里的 `\\|` 不误切列（AC-E2-4）', () => {
    const html = renderQuestionText('| 符号 | 含义 |\n|---|---|\n| a \\| b | 或 |')
    expect(html).toContain('<td>a | b</td>')
    expect(html).toContain('<td>或</td>')
  })
})

// ==================== 真实内容回归（AC-E2-1 / AC-E2-7）====================

const CONTENT_DIR = join(process.cwd(), 'content')

/** 递归收集所有题干（只读 units[].topics[].exercises[]，忽略 manifest/_set） */
function collectQuestions(limitFiles = 40): { id: string; question: string }[] {
  const out: { id: string; question: string }[] = []
  if (!existsSync(CONTENT_DIR)) return out

  const walk = (dir: string, depth = 0): void => {
    if (depth > 3) return
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!name.endsWith('.json') || name === '_set.json' || name === 'manifest.json') continue
      if (out.length > limitFiles * 60) return
      try {
        const pkg = JSON.parse(readFileSync(full, 'utf-8')) as {
          units?: { topics?: { exercises?: { id?: string; question?: string }[] }[] }[]
        }
        for (const u of pkg.units ?? []) {
          for (const t of u.topics ?? []) {
            for (const q of t.exercises ?? []) {
              if (typeof q.question === 'string') out.push({ id: String(q.id ?? ''), question: q.question })
            }
          }
        }
      } catch {
        /* 不是合法的包 JSON，跳过 */
      }
    }
  }

  walk(CONTENT_DIR)
  return out
}

/** 白名单标签之外不允许出现任何 `<` —— 用来证明"其余内容保持纯文本" */
const ALLOWED_TAGS =
  /<\/?(?:br|div|table|thead|tbody|tr|th|td)(?:\s+class="(?:q-table-wrap|q-table)")?\s*\/?>/g

describe('真实内容回归（AC-E2-7：不含表格的题文本与改动前一致）', () => {
  const questions = collectQuestions()

  it('能读到真实题库（内容目录存在时至少 100 道）', () => {
    if (!existsSync(CONTENT_DIR)) return
    expect(questions.length).toBeGreaterThan(100)
  })

  it('每道题渲染后都只含白名单标签，没有裸 < 或 >（注入面为零）', () => {
    for (const q of questions) {
      const stripped = renderQuestionText(q.question).replace(ALLOWED_TAGS, '')
      expect(stripped, `题目 ${q.id} 渲染出了白名单外的标签`).not.toMatch(/[<>]/)
    }
  })

  it('不含竖线的题：输出 === 转义 + 换行（与改动前逐字一致）', () => {
    const plain = questions.filter((q) => !q.question.includes('|'))
    // 抽查其中 20 道（不足 20 就用全部）
    for (const q of plain.slice(0, 20)) {
      const expected = q.question
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => escapeHtml(line).replace(/\\n/g, br))
        .join(br)
      expect(renderQuestionText(q.question), `题目 ${q.id}`).toBe(expected)
    }
  })

  it('带竖线的题都会渲染出真正的 <table>（不再是"一行竖线"）', () => {
    const tables = questions.filter((q) => q.question.includes('|') && q.question.includes('---'))
    if (tables.length === 0) return
    for (const q of tables) {
      expect(renderQuestionText(q.question), `题目 ${q.id}`).toContain('<table class="q-table">')
    }
  })

  it('★ sprint-ex-023（课程表判断题）在练习页渲染为 2 列 5 行（AC-E2-1）', () => {
    const target = questions.find((q) => q.id === 'sprint-ex-023')
    if (!target) return // 内容目录不含该包时跳过

    // 练习页走的是 splitJudgeStatements 后的 material
    const parts = splitJudgeStatements(target.question, 4)!
    expect(parts).not.toBeNull()
    const html = renderQuestionText(parts.material)

    expect(html).toContain('<th>Day</th><th>Subject</th>')
    expect(html).toContain('<td>Monday</td><td>English, math, PE</td>')
    expect(html).toContain('<td>Friday</td><td>Chinese, English, music</td>')
    // 5 行数据
    expect((html.match(/<tr><td>/g) ?? []).length).toBe(5)
    // 切分后的 4 个陈述句里不残留表格
    expect(parts.statements.every((s) => !s.includes('|'))).toBe(true)
  })
})
