<template>
  <div class="page-container">
    <!-- 外观设置 -->
    <n-card title="🎨 外观设置" class="card">
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

          <!-- 推荐提示条 -->
          <div class="preset-advice">
            <template v-if="themeStore.presetManual">
              <span class="advice-text">已手动选择，不再自动推荐</span>
              <n-button size="tiny" quaternary type="primary" @click="handleRestoreAuto">恢复自动</n-button>
            </template>
            <template v-else-if="recommended.grade !== null">
              <span class="advice-text">
                检测到孩子 {{ recommended.grade }} 年级，推荐「{{ presetName(recommended.preset) }}」主题
              </span>
              <n-button size="tiny" quaternary type="primary" @click="applyRecommended">一键切换</n-button>
            </template>
            <template v-else>
              <span class="advice-text">导入学习包后，将按孩子年级自动推荐主题</span>
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
    </n-card>

    <!-- 学习包管理 -->
    <n-card title="📦 学习包管理" class="card">
      <n-space vertical>
        <n-button type="primary" block size="large" @click="$router.push('/settings/import')">
          📥 导入新的学习包
        </n-button>
      </n-space>
    </n-card>

    <!-- 导出 -->
    <n-card title="📤 导出" class="card">
      <n-space vertical>
        <div class="export-row">
          <div class="export-info">
            <div class="export-title">导出错题本</div>
            <div class="export-desc">所有错题，含题目、解析、错误次数</div>
          </div>
          <n-button @click="doExportMistakes">导出</n-button>
        </div>

        <div class="export-row">
          <div class="export-info">
            <div class="export-title">导出学习进度</div>
            <div class="export-desc">知识点掌握度、答题统计</div>
          </div>
          <n-button @click="doExportProgress">导出</n-button>
        </div>

        <div class="export-row">
          <div class="export-info">
            <div class="export-title">导出全部包</div>
            <div class="export-desc">所有学习包 JSON</div>
          </div>
          <n-button @click="doExportPackages">导出</n-button>
        </div>

        <div class="export-row">
          <div class="export-info">
            <div class="export-title">全量备份</div>
            <div class="export-desc">包 + 进度 + 错题 + 设置</div>
          </div>
          <n-button type="primary" @click="doExportAll">导出</n-button>
        </div>
      </n-space>
    </n-card>

    <!-- 导入用户数据 -->
    <n-card title="📥 导入用户数据" class="card">
      <n-upload :custom-request="handleImportUserData" :show-file-list="false" accept=".json">
        <n-button dashed>选择用户数据 JSON</n-button>
      </n-upload>
      <div class="hint">导入进度、错题、设置。已存在的记录会合并更新。</div>
    </n-card>

    <!-- 搜索历史 -->
    <n-card title="🔍 搜索历史" class="card">
      <div v-if="searchHistory.length === 0" class="empty-hint">暂无搜索历史</div>
      <template v-else>
        <div class="history-list">
          <n-tag v-for="(kw, i) in searchHistory" :key="i" closable size="medium" @close="removeHistory(i)">
            {{ kw }}
          </n-tag>
        </div>
        <n-button size="small" style="margin-top: 12px;" @click="clearHistory">清空搜索历史</n-button>
      </template>
    </n-card>

    <!-- 危险操作 -->
    <n-card title="🗑️ 危险操作" class="card danger-card">
      <n-space vertical>
        <n-button type="error" ghost @click="doClearMistakes">清空所有错题</n-button>
        <n-button type="error" ghost @click="doClearProgress">清空学习进度</n-button>
        <n-button type="error" ghost @click="clearAllData">清空所有数据（含包）</n-button>
      </n-space>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  NCard, NSpace, NRadioGroup, NRadioButton, NButton, NUpload, NTag,
  useMessage, useDialog
} from 'naive-ui'
import { useThemeStore } from '@core/stores/theme'
import { usePackageStore } from '@core/stores/package'
import { db } from '@/db'
import {
  exportMistakes, exportUserData, exportAllPackages, exportAll, importUserData,
} from '@/core/export/exportService'
import type { ThemePreset } from '@core/styles/palette'
import type { GradeSource } from '@core/theme/presetInference'
import { inferPreset } from '@core/theme/presetInference'
import { PRESET_META, presetPreview } from '@core/theme/presetPreview'

const themeStore = useThemeStore()
const packageStore = usePackageStore()
const message = useMessage()
const dialog = useDialog()

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

async function doExportProgress() {
  const r = await exportUserData({ includeProgress: true })
  r.progress > 0
    ? message.success(`已导出 ${r.progress} 条进度`)
    : message.warning('没有可导出的进度')
}

async function doExportPackages() {
  const n = await exportAllPackages()
  n > 0 ? message.success(`已导出 ${n} 个包`) : message.warning('没有可导出的包')
}

async function doExportAll() {
  await exportAll()
  message.success('已导出完整备份')
}

async function handleImportUserData({ file, onFinish }: any) {
  try {
    const text = await (file.file as File).text()
    const json = JSON.parse(text)
    const result = await importUserData(json, 'merge')
    if (result.errors.length > 0) {
      message.error('导入失败：' + result.errors.join('; '))
    } else {
      message.success(`导入完成：进度 ${result.progress}，错题 ${result.mistakes}，设置 ${result.settings}`)
    }
    onFinish()
  } catch (e: any) {
    message.error('导入失败：' + e.message)
    onFinish()
  }
}

function doClearMistakes() {
  dialog.warning({
    title: '确认清空错题？', content: '此操作不可恢复',
    positiveText: '清空', negativeText: '取消',
    onPositiveClick: async () => { await db.mistakes.clear(); message.success('已清空错题') },
  })
}

function doClearProgress() {
  dialog.warning({
    title: '确认清空进度？', content: '此操作不可恢复',
    positiveText: '清空', negativeText: '取消',
    onPositiveClick: async () => { await db.progress.clear(); message.success('已清空进度') },
  })
}

function clearAllData() {
  dialog.error({
    title: '⚠️ 清空所有数据',
    content: '将删除所有学习包、进度、错题、设置。此操作不可恢复！',
    positiveText: '我确定', negativeText: '取消',
    onPositiveClick: async () => {
      await Promise.all([db.packages.clear(), db.progress.clear(), db.mistakes.clear(), db.settings.clear()])
      message.success('已清空所有数据')
    },
  })
}
</script>

<style scoped lang="scss">
.page-container { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
.card { border-radius: $radius-lg; box-shadow: $shadow-sm; margin-bottom: 0; }
.danger-card { border: 1px solid $danger-light; }
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
    background: $primary-color;
    color: $on-strong;
    font-size: 12px;
    font-weight: 800;
  }
}

.preset-advice {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding: 8px 12px;
  background: $bg-color-hover;
  border-radius: $radius-sm;

  .advice-text { font-size: 12px; color: $text-sub; }
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
.empty-hint { font-size: 13px; color: $text-sub; }
.history-list { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
