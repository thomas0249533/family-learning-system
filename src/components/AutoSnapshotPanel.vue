<template>
  <AppCard title="🛟 自动快照" class="card">
    <div v-if="loading" class="snap-hint">正在读取快照…</div>

    <template v-else>
      <!--
        V3.1.3：清空前保护快照单独置顶且用警示色。
        事故复盘 —— 3.1.1 的「清空所有数据」把每日快照一起删了，事后无恢复入口。
        保护快照是误清空后唯一的救命稻草，必须比每日快照更显眼、且不能被
        「清空每日快照」误删。
      -->
      <div v-if="protectedItems.length > 0" class="snap-group">
        <div class="snap-group-title is-protected">🛡️ 清空前恢复点（{{ protectedItems.length }}）</div>
        <div class="snap-list">
          <div v-for="it in protectedItems" :key="it.id" class="snap-row is-protected">
            <div class="snap-main">
              <span class="snap-reason">{{ it.reason ?? '清空前自动保存' }}</span>
              <span class="snap-date">{{ it.date }}</span>
              <span class="snap-meta">{{ timeOf(it.createdAt) }} · 应用 {{ it.appVersion }}</span>
            </div>
            <div class="snap-actions">
              <button
                type="button"
                class="snap-btn"
                :class="{ danger: pendingId === it.id }"
                :disabled="restoring"
                @click="onRestore(it.id)"
              >
                {{ pendingId === it.id ? '再点一次确认恢复' : '恢复' }}
              </button>
              <button
                type="button"
                class="snap-btn is-quiet"
                :class="{ danger: pendingDeleteId === it.id }"
                :disabled="restoring"
                @click="onDelete(it.id)"
              >
                {{ pendingDeleteId === it.id ? '再点一次确认删除' : '删除' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="dailyItems.length > 0" class="snap-group">
        <div class="snap-group-title">每日自动快照（{{ dailyItems.length }}）</div>
        <div class="snap-list">
          <div v-for="it in dailyItems" :key="it.id" class="snap-row">
            <div class="snap-main">
              <span class="snap-date">{{ it.date }}</span>
              <span v-if="isToday(it.date)" class="snap-today">今天</span>
              <span class="snap-meta">{{ timeOf(it.createdAt) }} · 应用 {{ it.appVersion }}</span>
            </div>
            <button
              type="button"
              class="snap-btn"
              :class="{ danger: pendingId === it.id }"
              :disabled="restoring"
              @click="onRestore(it.id)"
            >
              {{ pendingId === it.id ? '再点一次确认恢复' : '恢复' }}
            </button>
          </div>
        </div>
      </div>

      <EmptyState
        v-if="items.length === 0"
        size="small"
        description="还没有快照。明天首次打开时会自动保存一份。"
      />

      <div class="snap-foot">
        <span class="snap-hint">
          每天首次打开自动保存一份，保留最近 {{ KEEP_SNAPSHOTS }} 天；执行清空操作前会额外强制保存一份恢复点，单独保留 {{ KEEP_PRE_CLEAR }} 份。恢复是<strong>合并</strong>：补回丢失的记录，不会覆盖本机更新的数据。
        </span>
        <AppButton v-if="dailyItems.length > 0" size="small" @click="onClear">清空每日快照</AppButton>
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
import { computed, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { localDayKey } from '@core/motivation/streak'
import {
  KEEP_SNAPSHOTS,
  KEEP_PRE_CLEAR,
  clearSnapshots,
  deleteSnapshot,
  listSnapshots,
  restoreSnapshotById,
  type SnapshotEntry,
} from '@core/backup/autoSnapshot'

const message = useMessage()
const items = ref<SnapshotEntry[]>([])
const loading = ref(true)
const restoring = ref(false)
const pendingId = ref('')
const pendingDeleteId = ref('')

const protectedItems = computed(() => items.value.filter((it) => it.kind === 'preClear'))
const dailyItems = computed(() => items.value.filter((it) => it.kind !== 'preClear'))

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

async function onRestore(id: string): Promise<void> {
  if (pendingId.value !== id) {
    pendingId.value = id
    pendingDeleteId.value = ''
    return
  }
  pendingId.value = ''
  restoring.value = true
  try {
    const r = await restoreSnapshotById(id)
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

/** 删除单个保护快照也要两次点击：它是误清空后最后的回滚点 */
async function onDelete(id: string): Promise<void> {
  if (pendingDeleteId.value !== id) {
    pendingDeleteId.value = id
    pendingId.value = ''
    return
  }
  pendingDeleteId.value = ''
  await deleteSnapshot(id)
  await reload()
  message.success('已删除该恢复点')
}

async function onClear(): Promise<void> {
  // 只清每日快照，保护快照不受影响（见 core 里 clearSnapshots 的注释）
  await clearSnapshots()
  await reload()
  message.success('已清空每日快照（清空前恢复点已保留）')
}

onMounted(reload)
</script>

<style scoped lang="scss">
.snap-group {
  margin-bottom: 14px;
}

.snap-group-title {
  font-size: 12px;
  font-weight: 700;
  color: $text-sub;
  margin-bottom: 6px;

  &.is-protected {
    color: $danger-text;
  }
}

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

  &.is-protected {
    border-color: $danger-color;
    background: var(--danger-light);
  }
}

.snap-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.snap-reason {
  font-size: 13px;
  font-weight: 700;
  color: $danger-text;
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

  &.is-quiet {
    border-color: $border-color;
    color: $text-sub;
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
