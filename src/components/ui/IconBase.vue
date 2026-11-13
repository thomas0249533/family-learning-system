<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="label ? 'img' : 'presentation'"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <template v-for="(el, i) in nodes" :key="i">
      <path v-if="el.t === 'path'" :d="el.d" />
      <circle v-else-if="el.t === 'circle'" :cx="el.cx" :cy="el.cy" :r="el.r" />
      <line v-else-if="el.t === 'line'" :x1="el.x1" :y1="el.y1" :x2="el.x2" :y2="el.y2" />
      <polyline v-else-if="el.t === 'polyline'" :points="el.points" />
      <rect v-else-if="el.t === 'rect'" :x="el.x" :y="el.y" :width="el.width" :height="el.height" :rx="el.rx ?? 0" />
      <polygon v-else-if="el.t === 'polygon'" :points="el.points" />
    </template>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * 统一图标组件（V4.0 · 取代 emoji 当图标）。
 * ---------------------------------------------------------------------
 * · 所有图标均为 24×24 描边风格（Feather 系），`currentColor` 染色，
 *   随主题/状态自然跟随（激活态、禁用态、深浅色都正确）。
 * · 图标以「元素数组」声明，纯静态内部内容（无外部输入），不引入 v-html。
 * · name 可以是图标名，也可以直接传 emoji —— `EMOJI_ALIAS` 兜底解析，
 *   保证迁移期（数据源仍存 emoji）不会渲染空白。
 * · name 无法解析时渲染空 svg（不会崩，便于缺图标时降级）。
 * · 行内使用请传 size="1em"，图标随父级字号与字色自适应。
 */
type IconNode =
  | { t: 'path'; d: string }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { t: 'polyline'; points: string }
  | { t: 'rect'; x: number; y: number; width: number; height: number; rx?: number }
  | { t: 'polygon'; points: string }

const ICONS: Record<string, IconNode[]> = {
  // —— 导航 ——
  home: [
    { t: 'path', d: 'M3 11l9-8 9 8' },
    { t: 'path', d: 'M5 11v9h4v-5h6v5h4v-9' },
  ],
  target: [
    { t: 'circle', cx: 12, cy: 12, r: 8 },
    { t: 'circle', cx: 12, cy: 12, r: 4 },
    { t: 'circle', cx: 12, cy: 12, r: 1 },
  ],
  book: [
    { t: 'path', d: 'M12 6C9.5 4.5 6 4.5 4 6v12c2-1.5 5-1.5 8 0 3-1.5 6-1.5 8 0V6c-2-1.5-5-1.5-8 0z' },
    { t: 'path', d: 'M12 6v12' },
  ],
  mistake: [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'line', x1: 9, y1: 9, x2: 15, y2: 15 },
    { t: 'line', x1: 15, y1: 9, x2: 9, y2: 15 },
  ],
  pen: [
    { t: 'path', d: 'M16 4l4 4L8 20l-4 1 1-4z' },
    { t: 'line', x1: 14, y1: 6, x2: 18, y2: 10 },
  ],
  search: [
    { t: 'circle', cx: 11, cy: 11, r: 7 },
    { t: 'line', x1: 16, y1: 16, x2: 21, y2: 21 },
  ],
  doc: [
    { t: 'path', d: 'M7 3h7l4 4v14H7z' },
    { t: 'line', x1: 10, y1: 12, x2: 16, y2: 12 },
    { t: 'line', x1: 10, y1: 16, x2: 16, y2: 16 },
  ],
  people: [
    { t: 'circle', cx: 9, cy: 8, r: 3 },
    { t: 'path', d: 'M4 20c0-3 3-5 5-5s5 2 5 5' },
    { t: 'circle', cx: 17, cy: 9, r: 2.2 },
    { t: 'path', d: 'M14.5 20c0-2.5 2-4 3-4s3 1.5 3 4' },
  ],
  wand: [
    { t: 'path', d: 'M15 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1z' },
    { t: 'line', x1: 4, y1: 20, x2: 11, y2: 13 },
  ],
  gear: [
    { t: 'circle', cx: 12, cy: 12, r: 3 },
    { t: 'path', d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M16.9 16.9l2.1 2.1M19.1 4.9l-2.1 2.1M7.1 16.9l-2.1 2.1' },
  ],
  'book-brand': [
    { t: 'path', d: 'M12 5C9.5 3.5 6 3.5 4 5v14c2-1.5 5-1.5 8 0 3-1.5 6-1.5 8 0V5c-2-1.5-5-1.5-8 0z' },
    { t: 'path', d: 'M12 5v14' },
  ],
  // —— 背记模式 ——
  card: [
    { t: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 2 },
    { t: 'path', d: 'M16 4v4h4' },
  ],
  speaker: [
    { t: 'path', d: 'M11 5L6 9H3v6h3l5 4z' },
    { t: 'path', d: 'M15 9a4 4 0 0 1 0 6' },
    { t: 'path', d: 'M17.5 7a7 7 0 0 1 0 10' },
  ],
  list: [
    { t: 'circle', cx: 5, cy: 12, r: 7 },
    { t: 'circle', cx: 5, cy: 12, r: 3 },
    { t: 'line', x1: 14, y1: 8, x2: 21, y2: 8 },
    { t: 'line', x1: 14, y1: 16, x2: 21, y2: 16 },
  ],
  headphones: [
    { t: 'path', d: 'M5 13v-1a7 7 0 0 1 14 0v1' },
    { t: 'rect', x: 3, y: 13, width: 4, height: 7, rx: 2 },
    { t: 'rect', x: 17, y: 13, width: 4, height: 7, rx: 2 },
  ],
  paper: [
    { t: 'path', d: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z' },
    { t: 'path', d: 'M14 3v5h5' },
  ],
  puzzle: [
    { t: 'rect', x: 4, y: 4, width: 7, height: 7, rx: 1 },
    { t: 'rect', x: 13, y: 4, width: 7, height: 7, rx: 1 },
    { t: 'rect', x: 4, y: 13, width: 7, height: 7, rx: 1 },
    { t: 'rect', x: 13, y: 13, width: 7, height: 7, rx: 1 },
  ],
  // —— 语义动作 ——
  close: [
    { t: 'line', x1: 6, y1: 6, x2: 18, y2: 18 },
    { t: 'line', x1: 18, y1: 6, x2: 6, y2: 18 },
  ],
  'x-circle': [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'line', x1: 9, y1: 9, x2: 15, y2: 15 },
    { t: 'line', x1: 15, y1: 9, x2: 9, y2: 15 },
  ],
  check: [{ t: 'path', d: 'M4 13l5 5L20 6' }],
  'check-circle': [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'path', d: 'M8 12.5l3 3 5-6' },
  ],
  warning: [
    { t: 'path', d: 'M12 3.5l9 16H3z' },
    { t: 'line', x1: 12, y1: 9.5, x2: 12, y2: 14 },
    { t: 'circle', cx: 12, cy: 17, r: 0.6 },
  ],
  noentry: [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'line', x1: 5.7, y1: 5.7, x2: 18.3, y2: 18.3 },
  ],
  refresh: [
    { t: 'path', d: 'M20 12a8 8 0 1 1-2.6-5.9' },
    { t: 'path', d: 'M20 4v5h-5' },
  ],
  repeat: [
    { t: 'path', d: 'M4 9h13l-3.5-3.5' },
    { t: 'path', d: 'M20 15H7l3.5 3.5' },
  ],
  undo: [
    { t: 'path', d: 'M4 9h11a5 5 0 0 1 0 10h-4' },
    { t: 'path', d: 'M8 5L4 9l4 4' },
  ],
  play: [{ t: 'polygon', points: '8,5 19,12 8,19' }],
  pause: [
    { t: 'rect', x: 7, y: 5, width: 3.5, height: 14, rx: 1 },
    { t: 'rect', x: 13.5, y: 5, width: 3.5, height: 14, rx: 1 },
  ],
  stop: [{ t: 'rect', x: 6, y: 6, width: 12, height: 12, rx: 2 }],
  expand: [
    { t: 'path', d: 'M9 4H4v5' },
    { t: 'path', d: 'M15 4h5v5' },
    { t: 'path', d: 'M9 20H4v-5' },
    { t: 'path', d: 'M15 20h5v-5' },
  ],
  upload: [
    { t: 'path', d: 'M12 16V4' },
    { t: 'path', d: 'M7 9l5-5 5 5' },
    { t: 'path', d: 'M4 19h16' },
  ],
  download: [
    { t: 'path', d: 'M12 4v12' },
    { t: 'path', d: 'M7 11l5 5 5-5' },
    { t: 'path', d: 'M4 20h16' },
  ],
  trash: [
    { t: 'path', d: 'M4 7h16' },
    { t: 'path', d: 'M9 7V4h6v3' },
    { t: 'path', d: 'M6 7l1 14h10l1-14' },
    { t: 'line', x1: 10, y1: 11, x2: 10, y2: 17 },
    { t: 'line', x1: 14, y1: 11, x2: 14, y2: 17 },
  ],
  // —— 状态 / 激励 ——
  star: [{ t: 'polygon', points: '12,3.5 14.7,9 21,10 16.5,14.5 17.7,21 12,18 6.3,21 7.5,14.5 3,10 9.3,9' }],
  medal: [
    { t: 'circle', cx: 12, cy: 15, r: 5 },
    { t: 'path', d: 'M8 10.5L6 2l6 3 6-3-2 8.5' },
  ],
  trophy: [
    { t: 'path', d: 'M7 4h10v4a5 5 0 0 1-10 0z' },
    { t: 'path', d: 'M7 6H4v2a3 3 0 0 0 3 3' },
    { t: 'path', d: 'M17 6h3v2a3 3 0 0 1-3 3' },
    { t: 'path', d: 'M12 13v4' },
    { t: 'path', d: 'M9 20h6' },
  ],
  celebrate: [
    { t: 'path', d: 'M4 20l5-12 7 7-12 5z' },
    { t: 'line', x1: 16, y1: 3, x2: 16, y2: 5.5 },
    { t: 'line', x1: 20, y1: 7.5, x2: 17.5, y2: 8.5 },
    { t: 'line', x1: 12.5, y1: 6, x2: 11, y2: 4 },
  ],
  sparkle: [{ t: 'path', d: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z' }],
  bolt: [{ t: 'polygon', points: '13,2 3,14 11,14 10,22 21,10 13,10' }],
  fire: [
    { t: 'path', d: 'M12 2c3 4 5 6 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3.5 0-3 1-5.5 1-8z' },
  ],
  gift: [
    { t: 'rect', x: 4, y: 10, width: 16, height: 10, rx: 2 },
    { t: 'path', d: 'M3 7h18v3H3z' },
    { t: 'path', d: 'M12 7v13' },
    { t: 'path', d: 'M12 7c-1-3-5-4-5.5-1.5C6 7.5 9.5 7 12 7z' },
    { t: 'path', d: 'M12 7c1-3 5-4 5.5-1.5C18 7.5 14.5 7 12 7z' },
  ],
  ribbon: [
    { t: 'path', d: 'M12 11C9.5 6.5 4 7 5 10.5c.7 2.5 5 2.5 7 .5z' },
    { t: 'path', d: 'M12 11c2.5-4.5 8-4 7-.5-.7 2.5-5 2.5-7 .5z' },
    { t: 'path', d: 'M12 11v3' },
    { t: 'path', d: 'M10 21l2-4 2 4' },
  ],
  seedling: [
    { t: 'path', d: 'M12 21v-8' },
    { t: 'path', d: 'M12 13C8 13 5.5 11 5.5 8 9 8 12 9.5 12 13z' },
    { t: 'path', d: 'M12 13c0-4 2.5-6.5 6.5-6.5C18.5 10 16 13 12 13z' },
  ],
  leaf: [
    { t: 'path', d: 'M20 4C10 4 4 8 4 14c0 3.5 3 6 6 6 6 0 10-6 10-16z' },
    { t: 'path', d: 'M4 20c2-6 6-9 10-10' },
  ],
  tree: [
    { t: 'path', d: 'M12 3l5 7h-3.2l4.2 5.5H6l4.2-5.5H7z' },
    { t: 'path', d: 'M12 15.5V21' },
  ],
  sun: [
    { t: 'circle', cx: 12, cy: 12, r: 4 },
    { t: 'path', d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M16.9 16.9l2.1 2.1M19.1 4.9l-2.1 2.1M7.1 16.9l-2.1 2.1' },
  ],
  moon: [{ t: 'path', d: 'M20 14a8 8 0 1 1-9-11 7 7 0 0 0 9 11z' }],
  rainbow: [
    { t: 'path', d: 'M3 18a9 9 0 0 1 18 0' },
    { t: 'path', d: 'M6.5 18a5.5 5.5 0 0 1 11 0' },
    { t: 'path', d: 'M10 18a2 2 0 0 1 4 0' },
  ],
  mountain: [{ t: 'path', d: 'M3 19l6-11 4 7 2-3 6 7z' }],
  cloud: [{ t: 'path', d: 'M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.5-1A3.5 3.5 0 0 1 17 18z' }],
  compass: [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'polygon', points: '16,8 13.5,13.5 8,16 10.5,10.5' },
  ],
  // —— 计时 / 进度 ——
  clock: [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'path', d: 'M12 7v5l3.5 2' },
  ],
  calendar: [
    { t: 'rect', x: 4, y: 5, width: 16, height: 16, rx: 2 },
    { t: 'line', x1: 4, y1: 10, x2: 20, y2: 10 },
    { t: 'line', x1: 9, y1: 3, x2: 9, y2: 7 },
    { t: 'line', x1: 15, y1: 3, x2: 15, y2: 7 },
  ],
  chart: [
    { t: 'polyline', points: '4,17 9,12 13,15 20,7' },
    { t: 'path', d: 'M20 7h-4M20 7v4' },
  ],
  'chart-bar': [
    { t: 'line', x1: 5, y1: 20, x2: 5, y2: 12 },
    { t: 'line', x1: 12, y1: 20, x2: 12, y2: 6 },
    { t: 'line', x1: 19, y1: 20, x2: 19, y2: 15 },
  ],
  // —— 学习内容 ——
  'book-open': [
    { t: 'path', d: 'M12 7C9.5 5.5 6 5.5 4 7v11c2-1.5 5-1.5 8 0 3-1.5 6-1.5 8 0V7c-2-1.5-5-1.5-8 0z' },
    { t: 'path', d: 'M12 7v11' },
    { t: 'path', d: 'M4 7l-1 11' },
    { t: 'path', d: 'M20 7l1 11' },
  ],
  books: [
    { t: 'rect', x: 3.5, y: 4, width: 4, height: 16, rx: 1 },
    { t: 'rect', x: 9, y: 4, width: 4, height: 16, rx: 1 },
    { t: 'path', d: 'M15 5.5l4 1-3 14-4-1z' },
  ],
  clipboard: [
    { t: 'rect', x: 5, y: 4, width: 14, height: 17, rx: 2 },
    { t: 'rect', x: 9, y: 2, width: 6, height: 4, rx: 1 },
    { t: 'line', x1: 9, y1: 12, x2: 15, y2: 12 },
    { t: 'line', x1: 9, y1: 16, x2: 15, y2: 16 },
  ],
  ruler: [
    { t: 'path', d: 'M3 14.5l11.5-11.5 6.5 6.5L9.5 21z' },
    { t: 'path', d: 'M8 9.5l2 2M11 6.5l2 2M5 12.5l2 2' },
  ],
  abacus: [
    { t: 'rect', x: 4, y: 3, width: 16, height: 18, rx: 2 },
    { t: 'line', x1: 4, y1: 9, x2: 20, y2: 9 },
    { t: 'line', x1: 4, y1: 15, x2: 20, y2: 15 },
    { t: 'line', x1: 9, y1: 3, x2: 9, y2: 21 },
    { t: 'line', x1: 15, y1: 3, x2: 15, y2: 21 },
  ],
  abc: [
    { t: 'path', d: 'M4 6h16' },
    { t: 'path', d: 'M12 6v14' },
    { t: 'path', d: 'M9 20h6' },
  ],
  music: [
    { t: 'path', d: 'M9 18V6l10-2v12' },
    { t: 'circle', cx: 6.5, cy: 18, r: 2.5 },
    { t: 'circle', cx: 16.5, cy: 16, r: 2.5 },
  ],
  palette: [
    { t: 'path', d: 'M12 3a9 9 0 1 0 0 18c1.6 0 2.2-1.1 1.6-2.2-.6-1.2 0-2.3 1.6-2.3H18c2 0 3-1.4 3-3.4A9 9 0 0 0 12 3z' },
    { t: 'circle', cx: 8.5, cy: 9, r: 1.1 },
    { t: 'circle', cx: 13, cy: 7.5, r: 1.1 },
    { t: 'circle', cx: 16.5, cy: 11, r: 1.1 },
  ],
  bulb: [
    { t: 'path', d: 'M12 3a6 6 0 0 1 3.6 10.8V16h-7.2v-2.2A6 6 0 0 1 12 3z' },
    { t: 'line', x1: 9.5, y1: 18.5, x2: 14.5, y2: 18.5 },
    { t: 'line', x1: 10.5, y1: 21, x2: 13.5, y2: 21 },
  ],
  brain: [
    { t: 'path', d: 'M12 4.5V20' },
    { t: 'path', d: 'M12 4.5a3 3 0 0 0-4.5 2.2A3 3 0 0 0 5 10.5a3 3 0 0 0 .8 4.2A3 3 0 0 0 12 17' },
    { t: 'path', d: 'M12 4.5a3 3 0 0 1 4.5 2.2A3 3 0 0 1 19 10.5a3 3 0 0 1-.8 4.2A3 3 0 0 1 12 17' },
  ],
  // —— 系统 / 工具 ——
  inbox: [
    { t: 'path', d: 'M4 13l2-8h12l2 8v6H4z' },
    { t: 'path', d: 'M4 13h4l1 3h6l1-3h4' },
  ],
  package: [
    { t: 'path', d: 'M12 3l9 4v10l-9 4-9-4V7z' },
    { t: 'path', d: 'M3 7l9 4 9-4' },
    { t: 'path', d: 'M12 11v10' },
  ],
  folder: [{ t: 'path', d: 'M4 7h5l2 2h9v10H4z' }],
  'file-plus': [
    { t: 'path', d: 'M7 3h7l4 4v14H7z' },
    { t: 'path', d: 'M14 3v4h4' },
    { t: 'line', x1: 12, y1: 12, x2: 12, y2: 17 },
    { t: 'line', x1: 9.5, y1: 14.5, x2: 14.5, y2: 14.5 },
  ],
  image: [
    { t: 'rect', x: 3, y: 4, width: 18, height: 16, rx: 2 },
    { t: 'circle', cx: 9, cy: 10, r: 2 },
    { t: 'path', d: 'M3 17l5-4 4 3 3-3 6 5' },
  ],
  camera: [
    { t: 'rect', x: 3, y: 7, width: 18, height: 13, rx: 2 },
    { t: 'circle', cx: 12, cy: 13, r: 4 },
    { t: 'path', d: 'M8 7l1.5-3h5L16 7' },
  ],
  printer: [
    { t: 'path', d: 'M7 8V3h10v5' },
    { t: 'rect', x: 4, y: 8, width: 16, height: 8, rx: 2 },
    { t: 'rect', x: 7, y: 14, width: 10, height: 7, rx: 1 },
  ],
  robot: [
    { t: 'rect', x: 4, y: 8, width: 16, height: 12, rx: 2 },
    { t: 'circle', cx: 9, cy: 14, r: 1.2 },
    { t: 'circle', cx: 15, cy: 14, r: 1.2 },
    { t: 'line', x1: 12, y1: 8, x2: 12, y2: 4 },
    { t: 'circle', cx: 12, cy: 3, r: 1 },
    { t: 'line', x1: 2, y1: 13, x2: 2, y2: 17 },
    { t: 'line', x1: 22, y1: 13, x2: 22, y2: 17 },
  ],
  globe: [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'line', x1: 3, y1: 12, x2: 21, y2: 12 },
    { t: 'path', d: 'M12 3c3 4 3 14 0 18-3-4-3-14 0-18z' },
  ],
  wrench: [
    { t: 'path', d: 'M15 4a4 4 0 0 0-3.6 5.8L4 17.2V20h2.8l7.4-7.4A4 4 0 0 0 20 9l-3 1-2-2z' },
  ],
  eye: [
    { t: 'path', d: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z' },
    { t: 'circle', cx: 12, cy: 12, r: 3 },
  ],
  hand: [
    { t: 'path', d: 'M9 11V4.5a1.8 1.8 0 0 1 3.6 0V11' },
    { t: 'path', d: 'M12.6 11V8.5a1.8 1.8 0 0 1 3.6 0V13' },
    { t: 'path', d: 'M16.2 11.5a1.8 1.8 0 0 1 3.6 0V15a6 6 0 0 1-6 6h-1.2a6 6 0 0 1-6-6v-3.5a1.8 1.8 0 0 1 3.6 0V13' },
  ],
  pin: [
    { t: 'path', d: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z' },
    { t: 'circle', cx: 12, cy: 10, r: 2.5 },
  ],
  flag: [
    { t: 'path', d: 'M5 21V4' },
    { t: 'path', d: 'M5 4h11l-2 4 2 4H5' },
  ],
  mailbox: [
    { t: 'path', d: 'M4 10v10h16V10' },
    { t: 'path', d: 'M4 10a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3' },
    { t: 'path', d: 'M15 7V4h4' },
  ],
  volume: [
    { t: 'path', d: 'M11 5L6 9H3v6h3l5 4z' },
    { t: 'path', d: 'M15.5 9.5a4 4 0 0 1 0 5' },
    { t: 'path', d: 'M18 7a7.5 7.5 0 0 1 0 10' },
  ],
  handshake: [
    { t: 'path', d: 'M4 12l4-4 3 3 2-2 3 3 4-4' },
    { t: 'path', d: 'M4 12v4l4 4 3-3' },
    { t: 'path', d: 'M20 12v4l-4 4-3-3' },
  ],
  rocket: [
    { t: 'path', d: 'M12 3c3 3 4 7 3 11l-3 3-3-3c-1-4 0-8 3-11z' },
    { t: 'path', d: 'M9 17l-2 4 4-1' },
    { t: 'path', d: 'M15 17l2 4-4-1' },
    { t: 'circle', cx: 12, cy: 9, r: 1.5 },
  ],
  family: [
    { t: 'circle', cx: 7, cy: 8, r: 2.5 },
    { t: 'circle', cx: 17, cy: 8, r: 2.5 },
    { t: 'circle', cx: 12, cy: 14, r: 1.8 },
    { t: 'path', d: 'M3 20c0-2.5 2-4.5 4-4.5s4 2 4 4.5' },
    { t: 'path', d: 'M13 20c0-2.5 2-4.5 4-4.5s4 2 4 4.5' },
  ],
  smile: [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'path', d: 'M8.5 14.5a4.5 4.5 0 0 0 7 0' },
    { t: 'circle', cx: 9.5, cy: 10, r: 0.7 },
    { t: 'circle', cx: 14.5, cy: 10, r: 0.7 },
  ],
  lock: [
    { t: 'rect', x: 4, y: 11, width: 16, height: 10, rx: 2 },
    { t: 'path', d: 'M8 11V8a4 4 0 0 1 8 0v3' },
  ],
  shield: [
    { t: 'path', d: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z' },
  ],
  lifesaver: [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'circle', cx: 12, cy: 12, r: 3.5 },
    { t: 'line', x1: 6.6, y1: 6.6, x2: 9.5, y2: 9.5 },
    { t: 'line', x1: 17.4, y1: 6.6, x2: 14.5, y2: 9.5 },
    { t: 'line', x1: 6.6, y1: 17.4, x2: 9.5, y2: 14.5 },
    { t: 'line', x1: 17.4, y1: 17.4, x2: 14.5, y2: 14.5 },
  ],
  backpack: [
    { t: 'rect', x: 5, y: 7, width: 14, height: 14, rx: 2 },
    { t: 'path', d: 'M9 7V6a3 3 0 0 1 6 0v1' },
    { t: 'path', d: 'M9 13h6' },
  ],
  game: [
    { t: 'rect', x: 2.5, y: 8, width: 19, height: 9, rx: 4 },
    { t: 'line', x1: 7, y1: 11, x2: 7, y2: 14 },
    { t: 'line', x1: 5.5, y1: 12.5, x2: 8.5, y2: 12.5 },
    { t: 'circle', cx: 16, cy: 12, r: 0.9 },
    { t: 'circle', cx: 18, cy: 14, r: 0.9 },
  ],
}

/** emoji → 图标名（迁移兜底：数据源或旧调用仍传 emoji 时也能正确渲染） */
const EMOJI_ALIAS: Record<string, string> = {
  '🏠': 'home', '🎯': 'target', '📖': 'book-open', '📘': 'book', '📗': 'book',
  '📕': 'book', '📓': 'book', '📔': 'book', '📙': 'book', '📚': 'books',
  '❌': 'x-circle', '✕': 'close', '✗': 'close', '✖': 'close',
  '✓': 'check', '✔': 'check', '✅': 'check-circle', '☑': 'check-circle',
  '⚠': 'warning', '⚠️': 'warning', '⛔': 'noentry', '🚫': 'noentry',
  '🔄': 'refresh', '↻': 'refresh', '🔁': 'repeat', '↩': 'undo', '↩️': 'undo',
  '🔍': 'search', '🔎': 'search', '❓': 'search',
  '💡': 'bulb', '✨': 'sparkle', '🆕': 'sparkle', '🌟': 'sparkle',
  '⭐': 'star', '★': 'star', '🏅': 'medal', '🏆': 'trophy', '🎓': 'medal',
  '🎉': 'celebrate', '🎊': 'celebrate', '💪': 'bolt', '⚡': 'bolt',
  '🔥': 'fire', '🌱': 'seedling', '🌿': 'leaf', '🌳': 'tree', '🌲': 'tree',
  '🌞': 'sun', '☀': 'sun', '🌛': 'moon', '🌙': 'moon', '🌈': 'rainbow',
  '🏔': 'mountain', '🏔️': 'mountain', '⛰': 'mountain', '🧭': 'compass',
  '🧠': 'brain', '👀': 'eye', '👆': 'hand', '👋': 'hand',
  '👨‍👩‍👧': 'family', '👧': 'people', '👦': 'people', '🧑': 'people',
  '🤝': 'handshake', '🙂': 'smile', '😊': 'smile',
  '📅': 'calendar', '⏱': 'clock', '⏱️': 'clock', '⏰': 'clock', '🕐': 'clock',
  '📈': 'chart', '📉': 'chart', '📊': 'chart-bar', '🟩': 'chart',
  '📝': 'pen', '✏': 'pen', '✏️': 'pen', '✍': 'pen', '✍️': 'pen',
  '📋': 'clipboard', '📇': 'clipboard', '📌': 'pin', '📄': 'doc', '📃': 'doc',
  '📦': 'package', '📥': 'inbox', '📤': 'upload', '⬇': 'download', '⬇️': 'download',
  '🔒': 'lock', '🔓': 'lock', '🛡': 'shield', '🛡️': 'shield',
  '🛟': 'lifesaver', '🩹': 'lifesaver', '🎒': 'backpack',
  '🎁': 'gift', '🎀': 'ribbon', '🎵': 'music', '🎶': 'music', '🎨': 'palette',
  '🎴': 'card', '🃏': 'card', '🧩': 'puzzle', '🎮': 'game',
  '📐': 'ruler', '🧮': 'abacus', '🔤': 'abc', '🏁': 'flag',
  '📭': 'mailbox', '📬': 'mailbox', '✉': 'mailbox', '✉️': 'mailbox',
  '🔊': 'volume', '🔈': 'volume', '📢': 'volume', '🗣': 'volume', '🗣️': 'volume',
  '🖨': 'printer', '🖨️': 'printer', '📷': 'camera', '📸': 'camera',
  '🖼': 'image', '🖼️': 'image', '☁': 'cloud', '☁️': 'cloud', '🌐': 'globe',
  '🔧': 'wrench', '🔨': 'wrench', '🤖': 'robot', '🗑': 'trash', '🗑️': 'trash',
  '🗂': 'folder', '🗂️': 'folder', '📁': 'folder', '📂': 'folder',
  '🚀': 'rocket', '⛶': 'expand', '▶': 'play', '⏸': 'pause', '⏸️': 'pause',
  '⏹': 'stop', '⏹️': 'stop',
}

const props = withDefaults(
  defineProps<{
    name: string
    /** 像素尺寸（默认 22，与导航/模式图标视觉大小匹配）；行内用 "1em" 自适应字号 */
    size?: number | string
    strokeWidth?: number
    /** 有文案时作为无障碍标签；纯装饰留空（自动 aria-hidden） */
    label?: string
  }>(),
  { size: 22, strokeWidth: 2, label: '' },
)

/** 兼容 emoji 直传（迁移兜底） */
const resolved = computed(() => EMOJI_ALIAS[props.name] ?? props.name)
const nodes = computed<IconNode[]>(() => ICONS[resolved.value] ?? [])
</script>

<style scoped>
.icon {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}
</style>
