/**
 * 题干渲染 · 最小 Markdown 子集（V1.3 · E-02）
 *
 * ## 为什么需要
 * 题干是内容资产，不是文档。但有一小部分题（判断题的"课程表/时刻表"材料）天生需要
 * **换行**和**表格**，否则孩子看到的是一行竖线，题直接做不了。
 * 现状 1954 道题里有 166 道带真实换行或表格（8.5%），全部挤成一行。
 *
 * ## 上一版的根因
 * ```ts
 * escaped.replace(/\\n/g, '<br>')   // ← 匹配的是"字面反斜杠 + n"
 * ```
 * JSON 里的 `"\n"` 解析后是**真实换行符**，不是两个字符 `\` `n`。
 * 所以真实换行一个都没被替换，表格更是完全没解析。
 *
 * ## 支持范围（刻意小）
 *   ✅ 真实换行 → `<br>`
 *   ✅ GFM 表格（`| a | b |` + `|---|---|`）→ `<table>`，外面包一层可横向滚动的 div
 *   ✅ 其余一律纯文本 + HTML 转义
 *   ❌ 图片 / 链接 / HTML 标签 / 代码块 / 列表 / 加粗斜体 —— **不做**
 * 子集越小，注入面与样式风险越小。题干里出现 `<img onerror=...>` 时它只是文字。
 *
 * ## 为什么是纯函数
 * 表格解析最容易出错的地方是"行内竖线 / 缺分隔行 / 列数不齐 / 空单元格"，
 * 这些都能在 node 里穷举，不需要挂载组件。
 * 组件侧只负责把结果塞进 `v-html` 并给 `.q-table` 一组样式。
 */

/** HTML 转义（题干里的一切都是文本） */
export function escapeHtml(input: string): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 兼容历史脏数据：有些包把换行写成了**字面** `\n`（两个字符），
 * 那是早期 JSON 转义写错留下的。两种都要认，否则修好真实换行反而让那批题变差。
 */
function breaksToBr(escaped: string): string {
  return escaped.replace(/\\n/g, '<br>')
}

/** 是否表格分隔行：只由 `|` `-` `:` 和空白组成，且至少有一个 `-` */
export function isTableSeparator(line: string): boolean {
  const s = String(line ?? '').trim()
  if (!s.includes('-')) return false
  return /^[\s|:-]+$/.test(s)
}

/**
 * 拆一行表格为单元格。
 * - 首尾的边框竖线不算空单元格；
 * - `\|` 是转义竖线，算内容（转义在拆分阶段就还原，之后再统一 HTML 转义）；
 * - 空单元格保留为 `''`（渲染成空 `<td>`）。
 */
export function splitTableRow(line: string): string[] {
  const s = String(line ?? '').trim()
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
      continue
    }
    if (ch === '|') {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur)

  // 首尾空串来自边框竖线；只有一列时（`| a |` → ['', ' a ', '']）保留中间那个
  if (cells.length > 1 && cells[0].trim() === '') cells.shift()
  if (cells.length > 1 && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.map((c) => c.trim())
}

export interface TableBlock {
  header: string[]
  rows: string[][]
}

/**
 * 尝试从 `start` 行开始解析一个表格。不是表格返回 `null`。
 * 判定条件：当前行含 `|`，且**下一行**是分隔行（`|---|---|`）。
 */
export function parseTable(
  lines: string[],
  start: number,
): { table: TableBlock; next: number } | null {
  const head = lines[start]
  const sep = lines[start + 1]
  if (head === undefined || sep === undefined) return null
  if (!head.includes('|') || !isTableSeparator(sep)) return null

  const header = splitTableRow(head)
  if (header.length === 0) return null

  const rows: string[][] = []
  let i = start + 2
  while (i < lines.length) {
    const line = lines[i]
    // 空行结束表格；不含竖线的行也结束（普通段落不该被吞进表格）
    if (line.trim() === '' || !line.includes('|')) break
    const cells = splitTableRow(line)
    // 列数对齐表头：少了补空单元格，多了截断（GFM 的实际行为）
    const normalized = header.map((_, idx) => cells[idx] ?? '')
    rows.push(normalized)
    i++
  }

  return { table: { header, rows }, next: i }
}

const cellHtml = (tag: 'th' | 'td', text: string) =>
  `<${tag}>${breaksToBr(escapeHtml(text))}</${tag}>`

/** 表格 → HTML（外层 div 负责窄屏横向滚动） */
export function renderTable(table: TableBlock): string {
  const head = `<thead><tr>${table.header.map((c) => cellHtml('th', c)).join('')}</tr></thead>`
  const body =
    table.rows.length > 0
      ? `<tbody>${table.rows
          .map((r) => `<tr>${r.map((c) => cellHtml('td', c)).join('')}</tr>`)
          .join('')}</tbody>`
      : ''
  return `<div class="q-table-wrap"><table class="q-table">${head}${body}</table></div>`
}

/**
 * 题干 → 安全 HTML。
 *
 * 三段式：逐行扫描 → 命中表格就整块交给 `renderTable`，否则攒进文本缓冲；
 * 文本缓冲用 `<br>` 连接（真实换行与历史字面 `\n` 都算换行）。
 */
export function renderQuestionText(text: string): string {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const out: string[] = []
  let buffer: string[] = []

  const flush = () => {
    if (buffer.length === 0) return
    out.push(buffer.map((l) => breaksToBr(escapeHtml(l))).join('<br>'))
    buffer = []
  }

  let i = 0
  while (i < lines.length) {
    const parsed = parseTable(lines, i)
    if (parsed) {
      flush()
      out.push(renderTable(parsed.table))
      i = parsed.next
      continue
    }
    buffer.push(lines[i])
    i++
  }
  flush()

  return out.join('')
}
