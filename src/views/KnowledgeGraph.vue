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

        <div ref="chartRef" class="graph-chart"></div>
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
    // 容器节点：附子树知识点数（重新从 graphData 找回，echarts data 里没存）
    const node = findNode(graphData.value, name)
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
  chart.setOption(
    {
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
          data: graphData.value.map((root) => toEchartsData(root, t)),
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
    },
    true,
  )
  chart.resize()
}

function onResize() {
  chart?.resize()
}

// 主题 / 学段切换 → 等一帧（body 上的 state 已应用）后重绘
watchEffect(async () => {
  void chartTheme.value
  await nextTick()
  if (chart) renderChart()
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

.graph-chart {
  width: 100%;
  height: 480px;

  @media (max-width: 768px) {
    height: 360px;
  }
}
</style>
