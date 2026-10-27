<template>
  <div class="page-container graph-page">
    <PageHeader
      title="技能树"
      icon="🌳"
      subtitle="学科 → 单元 → 知识点，颜色代表掌握状态；滚轮缩放、拖拽平移"
    >
      <template #actions>
        <AppButton size="small" @click="goHome">← 返回首页</AppButton>
      </template>
    </PageHeader>

    <AppCard class="graph-card">
      <EmptyState
        v-if="!hasData"
        class="graph-empty"
        icon="🌳"
        description="还没有学习包，先去导入一个，再回来看你的技能树吧！"
      />

      <template v-else>
        <!-- 图例：四态，颜色全部来自 useChartTheme() -->
        <div class="graph-legend" aria-hidden="true">
          <span v-for="item in legend" :key="item.status" class="legend-item">
            <span class="legend-dot" :style="{ background: item.color }"></span>
            {{ item.label }}
          </span>
        </div>

        <!-- 学科切换（V2.9：多学科包各自成树，塞进一棵 480px 树里互相挤压看不清。
             chips 单选后一次只渲染一棵学科树；仅 1 个学科时无选择意义，隐藏。 -->
        <div v-if="subjectOptions.length > 1" class="graph-subjects" role="group" aria-label="学科切换">
          <button
            class="subject-chip"
            :class="{ active: effectiveSubject === 'all' }"
            type="button"
            @click="activeSubject = 'all'"
          >
            全部<span class="chip-count">{{ totalLeaves }}</span>
          </button>
          <button
            v-for="s in subjectOptions"
            :key="s.id"
            class="subject-chip"
            :class="{ active: effectiveSubject === s.id }"
            type="button"
            :title="`切到 ${s.name}（${s.leaves} 个知识点）`"
            @click="activeSubject = s.id"
          >
            <span class="chip-dot" :style="{ background: colorOf(s.status, chartTheme) }"></span>
            {{ s.name }}<span class="chip-count">{{ s.leaves }}</span>
          </button>
        </div>

        <div ref="chartRef" class="graph-chart" :style="{ height: chartHeightPx }"></div>
      </template>
    </AppCard>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// G1 · 技能树（echarts tree）
// ---------------------------------------------------------------------
// 数据层：src/core/graph/buildGraphData.ts（纯函数，状态判定复用 mastery 口径）；
// 主题层：useChartTheme() —— 本组件**零硬编码色**（check:hex 门禁）。
// 确定性：animation 关闭（视觉基线双跑一致）；随主题即时重绘（B2/B3）。
// =====================================================================
import { ref, computed, onMounted, onUnmounted, watchEffect, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import PageHeader from '@/components/ui/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { usePackageStore } from '@core/stores/package'
import { useUserDataStore } from '@core/stores/userData'
import { buildGraphData, type GraphNode, type GraphNodeStatus } from '@core/graph/buildGraphData'
import { useChartTheme, type ChartTheme } from '@core/theme/useChartTheme'

const router = useRouter()
const packageStore = usePackageStore()
const userDataStore = useUserDataStore()

/** 图谱四态 → 展示名（与 masterySummary 的桶口径一致） */
const STATUS_LABELS: Record<GraphNodeStatus, string> = {
  unlearned: '未学',
  learning: '学习中',
  review: '需复习',
  mastered: '已掌握',
}

/** 四态 → ChartTheme 语义色（首页饼图同源：success=已掌握 / border=未学） */
function colorOf(status: GraphNodeStatus, t: ChartTheme): string {
  switch (status) {
    case 'mastered': return t.success
    case 'learning': return t.primary
    case 'review': return t.warning
    case 'unlearned': return t.border
  }
}

const chartTheme = useChartTheme()
const graphData = computed<GraphNode[]>(() =>
  buildGraphData(packageStore.packages, userDataStore.progress),
)
const hasData = computed(() => graphData.value.length > 0)

// ---------- 学科切换（V2.9） ----------
// buildGraphData 每学科一棵根。原实现把所有根塞进同一棵 echarts tree，
// 多学科时互相挤压、单科树大时超出 480px 视区 —— 视觉上像「只显示了一个学科」。
const activeSubject = ref<string>('all')

/** 学科 chips（含各树知识点数与聚合状态色点） */
const subjectOptions = computed(() =>
  graphData.value
    .filter((r) => r.children && r.children.length > 0)
    .map((r) => ({ id: r.id, name: r.name, status: r.status, leaves: countLeaves(r) })),
)

/** 选中学科可能随包删除而失效 → 兜底回「全部」 */
const effectiveSubject = computed(() =>
  activeSubject.value === 'all' || subjectOptions.value.some((s) => s.id === activeSubject.value)
    ? activeSubject.value
    : 'all',
)

/** 容器状态聚合（展示口径，与 buildGraphData 的 aggregateChildren 同规则） */
function aggregateStatus(nodes: GraphNode[]): GraphNodeStatus {
  if (nodes.length > 0 && nodes.every((n) => n.status === 'mastered')) return 'mastered'
  if (nodes.some((n) => n.status === 'review')) return 'review'
  if (nodes.some((n) => n.status === 'learning')) return 'learning'
  return 'unlearned'
}

/**
 * 当前渲染的数据。
 * 单学科 → 该学科一棵树；「全部」→ **虚拟根**挂各学科根。
 * 关键（V2.9 修复用户报告的「只显示一个学科」）：echarts tree 对多根 data
 * 只布局第一棵树，其余根静默丢弃 —— 必须收敛成单根才能完整渲染。
 */
const displayedData = computed<GraphNode[]>(() => {
  if (effectiveSubject.value !== 'all') {
    return graphData.value.filter((r) => r.id === effectiveSubject.value)
  }
  const roots = graphData.value
  if (roots.length <= 1) return roots
  return [
    {
      id: 'subject-all',
      name: '全部',
      status: aggregateStatus(roots),
      wrongCount: roots.reduce((sum, r) => sum + r.wrongCount, 0),
      children: roots,
    },
  ]
})

const totalLeaves = computed(() => graphData.value.reduce((sum, r) => sum + countLeaves(r), 0))

/** 树的最大层宽（LR 布局垂直堆叠的是同层节点 → 高度按最宽层算，比叶子数准） */
function maxLayerWidth(nodes: GraphNode[]): number {
  let layer = nodes
  let max = layer.length
  while (layer.length > 0) {
    const next: GraphNode[] = []
    for (const n of layer) {
      if (n.children && n.children.length > 0) next.push(...n.children)
    }
    if (next.length > max) max = next.length
    layer = next
  }
  return max
}

/** 高度按最宽层自适应：每节点约 40px 行高 + 容器开销，420 起步、1600 封顶。
 *  多学科「全部」视图树多叶多，自然比单科更高。 */
const chartHeightPx = computed(() => {
  const width = maxLayerWidth(displayedData.value)
  const h = Math.max(420, Math.min(1600, width * 40 + 120))
  return `${h}px`
})

const legend = computed(() => {
  const t = chartTheme.value
  return (['unlearned', 'learning', 'review', 'mastered'] as const).map((status) => ({
    status,
    label: STATUS_LABELS[status],
    color: colorOf(status, t),
  }))
})

/** 子树知识点数（容器节点的 tooltip 用） */
function countLeaves(node: GraphNode): number {
  if (!node.children || node.children.length === 0) return 1
  return node.children.reduce((sum, c) => sum + countLeaves(c), 0)
}

/** GraphNode → echarts tree data（颜色只在此处从 chartTheme 取） */
function toEchartsData(node: GraphNode, t: ChartTheme): Record<string, unknown> {
  const color = colorOf(node.status, t)
  const data: Record<string, unknown> = {
    name: node.name,
    itemStyle: { color, borderColor: t.cardBg, borderWidth: 1 },
    // tooltip 载荷（GraphNode 原始信息，echarts 会原样带回 params.data）
    nodeStatus: node.status,
    wrongCount: node.wrongCount,
    isLeaf: !node.children || node.children.length === 0,
  }
  if (node.children && node.children.length > 0) {
    data.children = node.children.map((c) => toEchartsData(c, t))
  }
  return data
}

function tooltipFormatter(params: { data?: Record<string, unknown> }): string {
  const d = (params.data ?? {}) as {
    name?: string
    nodeStatus?: GraphNodeStatus
    wrongCount?: number
    isLeaf?: boolean
  }
  const t = chartTheme.value
  const name = typeof d.name === 'string' ? d.name : ''
  const status = d.nodeStatus ? STATUS_LABELS[d.nodeStatus] : ''
  const wrong = typeof d.wrongCount === 'number' ? d.wrongCount : 0
  const lines = [
    `<b>${name}</b>`,
    `<span style="color:${t.textSub}">状态 ${status} · 错 ${wrong} 次</span>`,
  ]
  if (d.isLeaf === false) {
    // 容器节点：附子树知识点数（从 displayedData 找回——含「全部」虚拟根，echarts data 里没存）
    const node = findNode(displayedData.value, name)
    if (node) lines.push(`<span style="color:${t.textSub}">知识点 ${countLeaves(node)} 个</span>`)
  }
  return lines.join('<br/>')
}

/** 在多棵根里按名找容器节点（tooltip 用，规模小，线性即可） */
function findNode(nodes: GraphNode[], name: string): GraphNode | undefined {
  for (const n of nodes) {
    if (n.name === name && n.children && n.children.length > 0) return n
    const hit = n.children ? findNode(n.children, name) : undefined
    if (hit) return hit
  }
  return undefined
}

// ---------- 图表（随主题即时重绘，B2/B3；动画关闭保证截图确定） ----------
const chartRef = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null

function renderChart() {
  if (!chart || !hasData.value) return
  const t = chartTheme.value
  const option = {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'item',
      backgroundColor: t.tooltipBg,
      textStyle: { color: t.tooltipText },
      borderColor: t.border,
      formatter: tooltipFormatter,
    },
    series: [
      {
        type: 'tree',
        data: displayedData.value.map((root) => toEchartsData(root, t)),
        roam: true,
        left: '6%',
        right: '24%',
        top: '2%',
        bottom: '2%',
        symbol: 'circle',
        symbolSize: 14,
        initialTreeDepth: -1,
        expandAndCollapse: true,
        lineStyle: { color: t.border, width: 1.5 },
        label: { color: t.textSub, fontSize: 12, position: 'left', verticalAlign: 'middle', align: 'right' },
        leaves: { label: { color: t.textSub, fontSize: 12, position: 'right', verticalAlign: 'middle', align: 'left' } },
        emphasis: { focus: 'descendant' },
      },
    ],
  }
  // 必须先 clear：tree series 在 notMerge 替换 data 时，旧树内部边（__edge）
  // 引用已失效，会抛 "Cannot read properties of null (reading '__edge')" 且整次
  // 重绘静默失败 —— V2.9 学科切换踩坑。clear 后重设，顺带重置缩放/平移视角（切学科正合适）。
  chart.clear()
  chart.setOption(option)
  chart.resize()
}

function onResize() {
  chart?.resize()
}

// 主题 / 学段切换 / 学科切换 / 高度变化 → 等一帧（body 上的 state 已应用）后重绘。
// 读 displayedData + chartHeightPx 使其成为依赖：切学科时 notMerge 重画 + resize。
watchEffect(async () => {
  void chartTheme.value
  void displayedData.value
  void chartHeightPx.value
  await nextTick()
  if (chart) {
    renderChart()
    chart.resize()
  }
})

function goHome() {
  router.push('/home')
}

onMounted(async () => {
  await userDataStore.loadUserData()
  await packageStore.loadPackages()

  if (chartRef.value) {
    chart = echarts.init(chartRef.value)
    renderChart()
    window.addEventListener('resize', onResize)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
  chart = null
})
</script>

<style scoped lang="scss">
.graph-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 8px;
}

.graph-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.graph-empty {
  padding: 60px 0;
}

.graph-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: $font-xs;
  color: $text-sub;

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
}

.graph-subjects {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  .subject-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 14px;
    border-radius: 999px;
    border: 1px solid $border-color;
    background: $card-bg;
    color: $text-sub;
    font-size: $font-xs;
    font-weight: 600;
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease-standard),
      box-shadow var(--duration-fast) var(--ease-standard),
      transform var(--duration-fast) var(--ease-standard);

    &:hover {
      border-color: $primary-color;
      color: $primary-text;
      transform: translateY(-1px);
    }

    &.active {
      background: $gradient-primary;
      border-color: transparent;
      color: $on-strong;
      box-shadow: 0 2px 8px rgba(var(--primary-rgb), 0.3);
    }

    .chip-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .chip-count {
      opacity: 0.72;
      font-weight: 500;
    }
  }
}

.graph-chart {
  width: 100%;
  /* 高度由 chartHeightPx 按叶子数动态计算（:style 绑定），480–1600px。 */
}
</style>
