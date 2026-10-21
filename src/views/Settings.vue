<template>
  <div class="page-container">
    <!-- 外观设置 -->
    <AppCard title="🎨 外观设置" class="card">
      <n-space vertical size="large">
        <!-- 学习阶段主题（preset 卡片单选） -->
        <div>
          <h4 class="setting-label">学习阶段主题</h4>
          <div class="preset-grid">
            <button
              v-for="p in PRESET_META"
              :key="p.value"
              type="button"
              class="preset-card"
              :class="{ selected: themeStore.preset === p.value }"
              @click="selectPreset(p.value)"
            >
              <span class="preset-band">
                <span class="band-swatch" :style="{ background: presetPreview(p.value).primary }"></span>
                <span class="band-swatch" :style="{ background: presetPreview(p.value).bg }"></span>
                <span class="band-swatch" :style="{ background: presetPreview(p.value).card }"></span>
              </span>
              <span class="preset-body">
                <span class="preset-name">{{ p.icon }} {{ p.name }}</span>
                <span class="preset-tagline">{{ p.tagline }}</span>
              </span>
              <span v-if="themeStore.preset === p.value" class="preset-check">✓</span>
            </button>
          </div>

          <!-- 推荐提示条（文本统一为 AppBadge 软色 pill，§5.1） -->
          <div class="preset-advice">
            <template v-if="themeStore.presetManual">
              <AppBadge tone="neutral" size="sm" icon="🔒">已手动选择，不再自动推荐</AppBadge>
              <AppButton size="tiny" quaternary type="primary" @click="handleRestoreAuto">恢复自动</AppButton>
            </template>
            <template v-else-if="recommended.grade !== null">
              <AppBadge tone="warning" size="sm" icon="💡">
                检测到孩子 {{ recommended.grade }} 年级，推荐「{{ presetName(recommended.preset) }}」主题
              </AppBadge>
              <AppButton size="tiny" quaternary type="primary" @click="applyRecommended">一键切换</AppButton>
            </template>
            <template v-else>
              <AppBadge tone="info" size="sm" icon="📥">导入学习包后，将按孩子年级自动推荐主题</AppBadge>
            </template>
          </div>
        </div>

        <!-- 主题模式（与学段、字号互相独立） -->
        <div>
          <h4 class="setting-label">主题模式</h4>
          <n-radio-group v-model:value="themeStore.themeMode" @update:value="themeStore.setTheme">
            <n-radio-button value="light">浅色</n-radio-button>
            <n-radio-button value="dark">深色</n-radio-button>
            <n-radio-button value="system">跟随系统</n-radio-button>
          </n-radio-group>
        </div>

        <!-- 字号（独立控件） -->
        <div>
          <h4 class="setting-label">字号</h4>
          <n-radio-group v-model:value="themeStore.fontSize" @update:value="themeStore.setFontSize">
            <n-radio-button value="small">小</n-radio-button>
            <n-radio-button value="medium">中</n-radio-button>
            <n-radio-button value="large">大</n-radio-button>
          </n-radio-group>
        </div>
      </n-space>
    </AppCard>

    <!-- 学习包管理 -->
    <AppCard title="📦 学习包管理" class="card">
      <n-space vertical>
        <AppButton type="primary" block size="large" @click="$router.push('/settings/import')">
          📥 导入新的学习包
        </AppButton>
      </n-space>
    </AppCard>

    <!-- 导出 -->
    <!-- id="family-backup" 是 B4 的落地锚点：「导出并删除旧档案」按钮会带着它跳过来，
         指向的正是家长唯一能"把数据先存下来"的那一行（见下方 scrollToHash） -->
    <AppCard id="family-backup" title="📤 导出" class="card">
      <n-space vertical>
        <div class="export-row">
          <div class="export-info">
            <div class="export-title">导出错题本</div>
            <div class="export-desc">所有错题，含题目、解析、错误次数</div>
          </div>
          <AppButton @click="doExportMistakes">导出</AppButton>
        </div>

        <div class="export-row">
          <div class="export-info">
            <div class="export-title">导出全部包</div>
            <div class="export-desc">所有学习包 JSON</div>
          </div>
          <AppButton @click="doExportPackages">导出</AppButton>
        </div>

        <div class="export-row">
          <div class="export-info">
            <div class="export-title">家庭备份</div>
            <div class="export-desc">全部档案的进度、错题、模考、成就与设置</div>
          </div>
          <AppButton type="primary" @click="doExportFamilyBackup">导出</AppButton>
        </div>
      </n-space>
    </AppCard>

    <!-- 从备份导入（两步向导：先预览，确认后才写入） -->
    <AppCard title="📥 从备份导入" class="card">
      <ImportPreview />
      <div class="hint">来自另一台设备的备份可以合并进来；本机已有的较新记录不会被覆盖</div>
    </AppCard>

    <!-- 搜索历史 -->
    <AppCard title="🔍 搜索历史" class="card">
      <EmptyState v-if="searchHistory.length === 0" size="small" description="暂无搜索历史" />
      <template v-else>
        <div class="history-list">
          <n-tag v-for="(kw, i) in searchHistory" :key="i" closable size="medium" @close="removeHistory(i)">
            {{ kw }}
          </n-tag>
        </div>
        <AppButton size="small" style="margin-top: 12px;" @click="clearHistory">清空搜索历史</AppButton>
      </template>
    </AppCard>

    <!-- 危险操作 -->
    <AppCard title="🗑️ 危险操作" class="card" variant="danger">
      <n-space vertical>
        <AppButton type="error" ghost @click="doClearMistakes">清空所有错题</AppButton>
        <AppButton type="error" ghost @click="doClearProgress">清空学习进度</AppButton>
        <AppButton type="error" ghost @click="clearAllData">清空所有数据（含包）</AppButton>
      </n-space>
    </AppCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import {
  NSpace, NRadioGroup, NRadioButton, NTag,
  useMessage, useDialog
} from 'naive-ui'
import AppCard from '@/components/ui/AppCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ImportPreview from '@/views/settings/ImportPreview.vue'
import { useThemeStore } from '@core/stores/theme'
import { currentProfileId } from '@core/profile/currentProfile'
import { usePackageStore } from '@core/stores/package'
import { db } from '@/db'
import {
  exportMistakes, exportBackupV2, exportAllPackages,
} from '@/core/export/exportService'
import type { ThemePreset } from '@core/styles/palette'
import type { GradeSource } from '@core/theme/presetInference'
import { inferPreset } from '@core/theme/presetInference'
import { PRESET_META, presetPreview } from '@core/theme/presetPreview'

const themeStore = useThemeStore()
const packageStore = usePackageStore()
const message = useMessage()
const dialog = useDialog()
const route = useRoute()

/**
 * 把 `/settings#family-backup` 落到「家庭备份」那一行上（B4）。
 *
 * 本项目的 router **没有配 `scrollBehavior`**，所以 hash 只是地址栏好看、页面纹丝不动。
 * 而「导出并删除旧档案」这个按钮的全部价值就是"把人送到能导出的地方"——
 * 跳过去却停在页面顶部，家长还得自己滚着找，等于没做。
 *
 * 用 `scrollIntoView` 而不是 `window.scrollTo`：页面滚动容器可能是 `AppShell`
 * 里那个可滚动的 div 而不是 `window`，`scrollIntoView` 会自己找最近的可滚动祖先。
 */
async function scrollToHash(): Promise<void> {
  const hash = route.hash
  if (!hash) return
  await nextTick()
  const el = document.getElementById(hash.slice(1))
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const searchHistory = ref<string[]>([])

/** 学习包 → 年级来源（供自动推荐） */
function gradeSources(): GradeSource[] {
  return packageStore.packages.map((pkg) => ({
    grade: pkg.manifest.grade,
    updatedAt: pkg.manifest.updatedAt,
    createdAt: pkg.manifest.createdAt,
  }))
}

/** 当前数据下的「推荐」预设（不施加，仅用于展示与一键切换） */
const recommended = computed(() => inferPreset(gradeSources()))

function presetName(p: ThemePreset): string {
  return PRESET_META.find((m) => m.value === p)?.name ?? p
}

function selectPreset(p: ThemePreset) {
  // 家长手动切换 → 标记 manual，永久停止自动推荐
  themeStore.setPreset(p, true)
}

function applyRecommended() {
  themeStore.setPreset(recommended.value.preset, true)
}

function handleRestoreAuto() {
  themeStore.restoreAuto(gradeSources())
  message.success('已恢复自动推荐')
}

onMounted(async () => {
  const raw = localStorage.getItem('searchHistory')
  if (raw) { try { searchHistory.value = JSON.parse(raw) } catch {} }

  // 载入学习包后按年级自动推断（仅当未手动选择时生效）
  await packageStore.loadPackages()
  themeStore.reconcilePreset(gradeSources())

  // 带 anchor 进来时（「导出并删除旧档案」）滚到对应区块
  await scrollToHash()
})

function removeHistory(i: number) {
  searchHistory.value.splice(i, 1)
  localStorage.setItem('searchHistory', JSON.stringify(searchHistory.value))
}

function clearHistory() {
  searchHistory.value = []
  localStorage.removeItem('searchHistory')
  message.success('已清空搜索历史')
}

async function doExportMistakes() {
  const n = await exportMistakes()
  n > 0 ? message.success(`已导出 ${n} 条错题`) : message.warning('没有可导出的错题')
}

async function doExportPackages() {
  const n = await exportAllPackages()
  n > 0 ? message.success(`已导出 ${n} 个包`) : message.warning('没有可导出的包')
}

/**
 * 家庭备份（v2）：一次导出**全部档案**的进度、错题、模考、成就与设置。
 *
 * 调 `exportBackupV2()`（唯一导出入口）：v2 备份不含学习包
 * （包是设备级资产，要另外用「导出全部包」搬）。
 */
async function doExportFamilyBackup() {
  try {
    const r = await exportBackupV2()
    if (r.profiles === 0) {
      message.warning('没有可导出的档案数据')
      return
    }
    message.success(`已导出家庭备份：${r.profiles} 个档案、${r.progress} 条进度`)
  } catch (e) {
    // 不吞异常：下载失败时用户必须知道"没有文件生成"
    message.error('导出失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function doClearMistakes() {
  dialog.warning({
    title: '确认清空错题？', content: '此操作不可恢复',
    positiveText: '清空', negativeText: '取消',
    onPositiveClick: async () => {
      // V1.4 · B1：只清**当前档案**的错题。`clear()` 会把另一个孩子的错题一起删掉，
      // 而且没有任何提示能让人发现这件事。
      await db.mistakes.where('profileId').equals(currentProfileId()).delete()
      message.success('已清空错题')
    },
  })
}

function doClearProgress() {
  dialog.warning({
    title: '确认清空进度？', content: '此操作不可恢复',
    positiveText: '清空', negativeText: '取消',
    onPositiveClick: async () => {
      // 同上：只清当前档案
      await db.progress.where('profileId').equals(currentProfileId()).delete()
      message.success('已清空进度')
    },
  })
}

function clearAllData() {
  dialog.error({
    title: '⚠️ 清空所有数据',
    content: '将删除所有学习包、进度、错题、设置。此操作不可恢复！',
    positiveText: '我确定', negativeText: '取消',
    onPositiveClick: async () => {
      // profile-scope-ok: 「清空所有数据」的语义就是整库重置（含学习包与档案列表本身），跨档案删除是需求
      await Promise.all([db.packages.clear(), db.progress.clear(), db.mistakes.clear(), db.settings.clear()])
      message.success('已清空所有数据')
    },
  })
}
</script>

<style scoped lang="scss">
.page-container { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
/* `.card` 的圆角/阴影已由 AppCard 基元统一提供（radius-lg + shadow-sm）；危险卡走 variant="danger"。 */
.setting-label { font-size: 14px; font-weight: 700; color: $text-main; margin-bottom: 10px; }

/* ========== 学段预设卡片 ========== */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
}

.preset-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: $surface-2;
  border: 2px solid $border-color;
  border-radius: $radius-md;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: all 0.15s ease;

  &:hover {
    border-color: $primary-color;
    transform: translateY(-2px);
  }

  &.selected {
    border-color: $primary-color;
    background: $primary-light;
    box-shadow: $shadow;
  }

  .preset-band {
    display: flex;
    height: 26px;
    border-radius: $radius-sm;
    overflow: hidden;
    border: 1px solid $border-light;

    .band-swatch {
      flex: 1;
    }
  }

  .preset-body {
    display: flex;
    flex-direction: column;
    gap: 2px;

    .preset-name {
      font-size: 14px;
      font-weight: 800;
      color: $text-main;
    }
    .preset-tagline {
      font-size: 11px;
      color: $text-muted;
    }
  }

  .preset-check {
    position: absolute;
    top: 8px;
    right: 10px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: $radius-full;
    background: var(--primary-text);
    color: var(--text-on-primary);
    font-size: 12px;
    font-weight: 800;
  }
}

/* 提示条：文本已交由 AppBadge 承载（§5.1），本容器只保留排布。 */
.preset-advice {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.export-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 0; border-bottom: 1px dashed $border-color;
  &:last-child { border-bottom: none; }
  .export-info { flex: 1; }
  .export-title { font-size: 14px; font-weight: 700; color: $text-main; }
  .export-desc { font-size: 12px; color: $text-sub; margin-top: 2px; }
}

.hint { font-size: 12px; color: $text-sub; margin-top: 8px; }
.history-list { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
