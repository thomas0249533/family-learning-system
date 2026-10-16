<template>
  <div class="ds-page">
    <PageHeader
      icon="🎨"
      title="设计系统基元预览"
      subtitle="开发专用页（仅 DEV 注册）。8 个 UI 基元 × 浅/深 × 各状态。"
    />

    <p class="ds-note">
      本页仅用于人工预览与 Playwright 基元截图（<code>tests/e2e/primitives.spec.ts</code>）。
      生产构建不包含本路由。
    </p>

    <!-- ============ AppButton ============ -->
    <section class="ds-block" data-ds="app-button">
      <SectionTitle title="AppButton" count="包 n-button" accent />
      <div class="ds-row">
        <AppButton>默认</AppButton>
        <AppButton type="primary">主按钮</AppButton>
        <AppButton type="success">成功</AppButton>
        <AppButton type="warning">警告</AppButton>
        <AppButton type="error">危险</AppButton>
        <AppButton type="info">信息</AppButton>
      </div>
      <div class="ds-row">
        <AppButton size="tiny">tiny</AppButton>
        <AppButton size="small">small</AppButton>
        <AppButton size="medium" type="primary">medium</AppButton>
        <AppButton size="large" type="primary">large</AppButton>
      </div>
      <div class="ds-row">
        <AppButton ghost type="primary">ghost</AppButton>
        <AppButton dashed>dashed</AppButton>
        <AppButton quaternary type="primary">quaternary</AppButton>
        <AppButton type="primary" loading>loading</AppButton>
        <AppButton type="primary" disabled>disabled</AppButton>
        <AppButton type="primary" icon="🔍">带图标</AppButton>
      </div>
    </section>

    <!-- ============ AppCard ============ -->
    <section class="ds-block" data-ds="app-card">
      <SectionTitle title="AppCard" count="包 n-card" accent />
      <div class="ds-grid">
        <AppCard title="默认卡片" icon="📘">卡片内容区。标题栏带底色。</AppCard>
        <AppCard title="危险卡片" icon="⚠️" variant="danger">危险变体边框取 danger-light。</AppCard>
        <AppCard title="可交互" icon="👆" hoverable>
          hover 抬升 + 阴影加深
        </AppCard>
        <AppCard paddingless>
          <div class="ds-pad">无内边距内容（表格/列表用）</div>
        </AppCard>
      </div>
    </section>

    <!-- ============ AppBadge ============ -->
    <section class="ds-block" data-ds="app-badge">
      <SectionTitle title="AppBadge" count="自建 pill" accent />
      <div class="ds-row">
        <AppBadge>中性</AppBadge>
        <AppBadge tone="primary">主色</AppBadge>
        <AppBadge tone="success" icon="✓">已掌握</AppBadge>
        <AppBadge tone="warning" icon="!">待复习</AppBadge>
        <AppBadge tone="danger" icon="✕">易错</AppBadge>
        <AppBadge tone="info">信息</AppBadge>
      </div>
      <div class="ds-row">
        <AppBadge size="sm">sm</AppBadge>
        <AppBadge size="md">md</AppBadge>
        <AppBadge tone="success" :soft="false">实心</AppBadge>
        <AppBadge tone="danger" closable>可关闭</AppBadge>
      </div>
    </section>

    <!-- ============ StatCard ============ -->
    <section class="ds-block" data-ds="stat-card">
      <SectionTitle title="StatCard" count="自建" accent />
      <div class="ds-grid">
        <StatCard icon="📚" :value="12" label="已完成单元" />
        <StatCard icon="🎯" :value="86" label="正确率" tone="success" />
        <StatCard icon="🔥" :value="7" label="连续打卡" tone="warning" />
        <StatCard icon="⚠️" :value="3" label="待复习错题" tone="danger" />
        <StatCard icon="📈" value="92%" label="掌握度" tone="primary" layout="horizontal" interactive />
        <StatCard icon="🧮" :value="45" label="今日题量" tone="neutral">
          <template #footer>较昨日 +8</template>
        </StatCard>
      </div>
    </section>

    <!-- ============ SectionTitle ============ -->
    <section class="ds-block" data-ds="section-title">
      <SectionTitle title="SectionTitle（h2，accent）" count="6" accent />
      <SectionTitle level="h3" title="SectionTitle（h3，无 accent）" icon="📗" count="3" />
      <SectionTitle title="带右侧扩展" icon="⭐">
        <AppBadge tone="primary" size="sm">新</AppBadge>
      </SectionTitle>
    </section>

    <!-- ============ ProgressBar ============ -->
    <section class="ds-block" data-ds="progress-bar">
      <SectionTitle title="ProgressBar" count="自建" accent />
      <div class="ds-stack">
        <ProgressBar :value="72" show-label />
        <ProgressBar :value="45" tone="success" size="sm" show-label />
        <ProgressBar :value="30" tone="warning" show-label />
        <ProgressBar :value="18" tone="danger" show-label />
        <ProgressBar :value="88" gradient show-label />
        <ProgressBar :value="0" />
      </div>
    </section>

    <!-- ============ EmptyState ============ -->
    <section class="ds-block" data-ds="empty-state">
      <SectionTitle title="EmptyState" count="包 n-empty" accent />
      <div class="ds-grid ds-grid--2">
        <EmptyState description="暂无数据" icon="📭" />
        <EmptyState
          description="还没有错题，继续保持！"
          icon="✅"
          action-text="去练习"
        />
      </div>
    </section>

    <!-- ============ PageHeader ============ -->
    <section class="ds-block" data-ds="page-header">
      <SectionTitle title="PageHeader" count="自建" accent />
      <PageHeader title="学习报告" subtitle="统计你的练习进度与掌握情况" icon="📊">
        <template #breadcrumb>首页 / 报告</template>
        <template #actions>
          <AppButton size="small">导出</AppButton>
          <AppButton size="small" type="primary">刷新</AppButton>
        </template>
      </PageHeader>
    </section>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// DesignSystem.vue · 8 基元开发预览页（**仅 DEV 注册**，§7）
// ---------------------------------------------------------------------
// 不参与生产路由（router 用 `import.meta.env.DEV` 条件注册 → 生产 DCE）。
// 页面零硬编码色；纯 layout。截图目标为 `.ds-block[data-ds=...]`。
// =====================================================================
import PageHeader from '@/components/ui/PageHeader.vue'
import SectionTitle from '@/components/ui/SectionTitle.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import StatCard from '@/components/ui/StatCard.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
</script>

<style scoped lang="scss">
.ds-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-6);
}

.ds-note {
  margin: 0;
  font-size: var(--font-sm);
  color: var(--text-sub);
}

.ds-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: var(--card-bg);
}

.ds-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.ds-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-4);
}

.ds-grid--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.ds-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.ds-pad {
  padding: var(--space-4);
  font-size: var(--font-sm);
  color: var(--text-sub);
}
</style>
