<template>
  <AppCard title="🛟 自动快照" class="card">
    <div v-if="loading" class="snap-hint">正在读取快照…</div>

    <template v-else>
      <EmptyState
        v-if="items.length === 0"
        size="small"
        description="还没有快照。明天首次打开时会自动保存一份。"
      />

      <div v-else class="snap-list">
        <div v-for="it in items" :key="it.date" class="snap-row">
          <div class="snap-main">
            <span class="snap-date">{{ it.date }}</span>
            <span v-if="isToday(it.date)" class="snap-today">今天</span>
            <span class="snap-meta">{{ timeOf(it.createdAt) }} · 应用 {{ it.appVersion }}</span>
          </div>
          <button
            type="button"
            class="snap-btn"
            :class="{ danger: pendingDate === it.date }"
            :disabled="restoring"
            @click="onRestore(it.date)"
          >
            {{ pendingDate === it.date ? '再点一次确认恢复' : '恢复' }}
          </button>
        </div>
      </div>

      <div class="snap-foot">
        <span class="snap-hint">
          每天首次打开自动保存一份，保留最近 {{ KEEP_SNAPSHOTS }} 天。
          恢复是**合并**：补回丢失的记录，不会覆盖本机更新的数据。
        </span>
        <AppButton v-if="items.length > 0" size="small" @click="onClear">清空快照</AppButton>
      </div>
    </template>
  </AppCard>
</template>

<script setup lang="ts">
// =====================================================================
// 自动快照面板（V3.0 · M4）
// ---------------------------------------------------------------------
// 为什么独立成一个组件而不是写进 Settings.vue：
// Settings.vue 已经是 600+ 行的"什么都有"页面，快照的读写/确认/恢复有一套
// 自己的状态（loading / pendingDate / restoring），塞进去只会让两边都更难改。
//
// 恢复为什么是"两次点击"而不是弹窗：
// 本仓的弹窗都要 `useDialog` 的 provider 上下文，而这块逻辑足够简单 ——
// 第一次点变成"再点一次确认"，比引一层 provider 更轻，也照样防误触。
// =====================================================================
import { onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { localDayKey } from '@core/motivation/streak'
import {
  KEEP_SNAPSHOTS,
  clearSnapshots,
  listSnapshots,
  restoreSnapshot,
  type SnapshotEntry,
} from '@core/backup/autoSnapshot'

const message = useMessage()
const items = ref<SnapshotEntry[]>([])
const loading = ref(true)
const restoring = ref(false)
const pendingDate = ref('')

function isToday(date: string): boolean {
  return date === localDayKey()
}

function timeOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

async function reload(): Promise<void> {
  loading.value = true
  try {
    items.value = await listSnapshots()
  } finally {
    loading.value = false
  }
}

async function onRestore(date: string): Promise<void> {
  if (pendingDate.value !== date) {
    pendingDate.value = date
    return
  }
  pendingDate.value = ''
  restoring.value = true
  try {
    const r = await restoreSnapshot(date)
    if (!r.ok) {
      message.error(`恢复失败：${r.error ?? '未知原因'}`)
      return
    }
    const added = (r.progressAdded ?? 0) + (r.mistakesAdded ?? 0)
    message.success(
      added > 0 ? `已恢复，补回 ${added} 条记录` : '恢复完成，本机数据已是最新，无需补回',
    )
    await reload()
  } finally {
    restoring.value = false
  }
}

async function onClear(): Promise<void> {
  await clearSnapshots()
  await reload()
  message.success('已清空快照')
}

onMounted(reload)
</script>

<style scoped lang="scss">
.snap-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.snap-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $surface-2;
}

.snap-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.snap-date {
  font-size: 14px;
  font-weight: 700;
  color: $text-main;
}

.snap-today {
  font-size: 11px;
  font-weight: 700;
  color: $primary-text;
  background: $primary-light;
  border-radius: 999px;
  padding: 1px 8px;
}

.snap-meta {
  font-size: 12px;
  color: $text-sub;
}

.snap-btn {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 700;
  padding: 5px 12px;
  border-radius: $radius-sm;
  border: 1px solid $primary-color;
  background: transparent;
  color: $primary-text;
  cursor: pointer;

  &.danger {
    border-color: $danger-color;
    color: $danger-text;
    background: var(--danger-light);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
}

.snap-foot {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.snap-hint {
  font-size: 12px;
  color: $text-sub;
  line-height: $leading-normal;
}
</style>
