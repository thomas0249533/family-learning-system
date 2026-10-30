<template>
  <AppCard title="☁️ 同步（WebDAV）" class="card">
    <n-space vertical size="large">
      <!-- 现实提醒：桌面端已可由本机进程直连网盘；网页版仍受 CORS 限制。 -->
      <div class="sync-note">
        <strong>这是实验性功能。</strong>{{ envHint }}若连不上，请用本页已有的「导出 / 导入备份文件」通道搬运数据。
      </div>

      <div>
        <h4 class="setting-label">WebDAV 地址</h4>
        <n-input
          v-model:value="baseUrl"
          placeholder="https://dav.jianguoyun.com/dav/"
          @blur="persistConfig"
        />
        <div class="hint">目录地址，结尾有没有斜杠都可以（坚果云 / Nextcloud 的 dav 目录）。</div>
      </div>

      <div>
        <h4 class="setting-label">账号</h4>
        <n-input v-model:value="username" placeholder="网盘登录名" @blur="persistConfig" />
      </div>

      <div>
        <h4 class="setting-label">口令</h4>
        <n-input
          v-model:value="password"
          type="password"
          show-password-on="click"
          placeholder="应用专用密码（仅本次有效，关闭页面后清除，不明文保存）"
        />
        <div class="hint">
          坚果云 / Nextcloud 要用「应用专用密码」，不是你的登录密码。口令只在这一次使用中有效。
        </div>
      </div>

      <n-space>
        <AppButton :loading="testing" :disabled="testing || pushing || pulling" @click="testConnection">
          测试连接
        </AppButton>
        <AppButton
          type="primary"
          :loading="pushing"
          :disabled="testing || pushing || pulling"
          @click="doPush"
        >
          上传备份（推到网盘）
        </AppButton>
        <AppButton
          :loading="pulling"
          :disabled="testing || pushing || pulling"
          @click="doPull"
        >
          下载并同步
        </AppButton>
      </n-space>

      <!-- 连接测试结果 -->
      <div v-if="testState !== 'idle'" class="sync-result" :class="testTone">
        <div class="sync-result-text">{{ testMsg }}</div>
      </div>

      <!-- 上传结果 -->
      <div v-if="pushState !== 'idle'" class="sync-result" :class="pushTone">
        <div class="sync-result-text">{{ pushMsg }}</div>
      </div>

      <!-- 下载：拒绝（含跨档案拦截） -->
      <div v-if="preview && preview.outcome === 'reject'" class="sync-reject">
        <AppBadge
          v-if="isIntercept"
          tone="danger"
          size="sm"
          icon="⛔"
        >发现另一个孩子的数据，已为您拦截</AppBadge>
        <AppBadge v-else tone="danger" size="sm" icon="⛔">无法同步</AppBadge>
        <div class="sync-reject-text">{{ rejectText }}</div>
        <div class="sync-reject-note">本机数据一个字节都没有改动。</div>
      </div>

      <!-- 下载：无变化 -->
      <div v-else-if="preview && preview.outcome === 'noop'" class="sync-noop">
        <AppBadge tone="info" size="sm" icon="✅">无需同步</AppBadge>
        <div class="sync-noop-text">网盘上的备份和本机已经一致，没有需要写入的变化。</div>
      </div>

      <!-- 下载：可以同步 -->
      <div v-else-if="preview && preview.outcome === 'ready'" class="sync-ready">
        <AppBadge tone="success" size="sm" icon="📋">可以同步</AppBadge>

        <div v-if="conflict" class="sync-conflict">
          <div class="sync-conflict-title">{{ conflictLabel }}</div>
          <ul class="sync-stats">
            <li v-for="row in conflictRows" :key="row.key" class="sync-stat">
              <span class="sync-stat-label">{{ row.label }}</span>
              <span class="sync-stat-value">{{ row.value }}</span>
            </li>
          </ul>
        </div>

        <div v-if="preview.remoteExportedAt" class="sync-meta">
          远端备份导出时间：{{ preview.remoteExportedAt }}
        </div>
        <div v-if="preview.remoteAppVersion" class="sync-meta">
          远端来自版本：{{ preview.remoteAppVersion }}
        </div>

        <AppButton
          type="primary"
          :loading="applying"
          :disabled="applying"
          @click="confirmSync"
        >
          {{ applied ? '已同步' : '确认同步' }}
        </AppButton>
        <div v-if="applyMsg" class="sync-result sync-success" :class="{ 'sync-err': applyFailed }">
          <div class="sync-result-text">{{ applyMsg }}</div>
        </div>
      </div>

      <!-- 下载：传输层失败 -->
      <div v-if="pullError" class="sync-result sync-err">
        <div class="sync-result-text">{{ pullError }}</div>
      </div>
    </n-space>
  </AppCard>
</template>

<script setup lang="ts">
// =====================================================================
// SyncSettings · WebDAV 同步卡片（V1.11 · Stage F · F2-UI）
// ---------------------------------------------------------------------
// 铁律：本组件**不写任何合并逻辑**——预览 / 执行 / 跨档案拦截全在 core 层
// （`syncManager` / `webdavClient`）。这里只做三件事：收集配置、按按钮、
// 把 core 返回的 `SyncPreview` 照实渲染出来。
//
// 安全口径（与主程裁定一致）：
//   ① 口令**只在本会话有效**，关闭页面即清除，绝不写进 localStorage / IndexedDB；
//   ② baseUrl / username 才落 localStorage，且**不进** family 备份
//      （WebDAV 凭据是设备级的，不该被同步到另一台设备）；
//   ③ CORS 失败是"实情"不是 bug —— 文案直接把家长指回导出 / 导入通道。
// =====================================================================
import { computed, ref } from 'vue'
import { NSpace, NInput, useMessage } from 'naive-ui'
import AppCard from '@/components/ui/AppCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import {
  environmentHint,
  executePull,
  previewPull,
  pushBackup,
  remoteExists,
  type SyncConflictState,
  type SyncPreview,
} from '@core/sync/syncManager'
import { isWebDavError, type WebDavConfig } from '@core/sync/webdavClient'

const message = useMessage()

// ---------------------------------------------------------------------
// 配置（口令只留内存）
// ---------------------------------------------------------------------
const baseUrl = ref('')
const username = ref('')
const password = ref('')

const LS_BASE = 'fls.webdav.baseUrl'
const LS_USER = 'fls.webdav.username'

function loadConfig(): void {
  try {
    baseUrl.value = localStorage.getItem(LS_BASE) ?? ''
    username.value = localStorage.getItem(LS_USER) ?? ''
  } catch {
    /* localStorage 不可用时静默回落到内存态 */
  }
}

function persistConfig(): void {
  try {
    if (baseUrl.value.trim()) localStorage.setItem(LS_BASE, baseUrl.value.trim())
    else localStorage.removeItem(LS_BASE)
    if (username.value.trim()) localStorage.setItem(LS_USER, username.value.trim())
    else localStorage.removeItem(LS_USER)
  } catch {
    /* 忽略写入失败（隐私无关，丢了也只是下次重填） */
  }
}

const config = computed<WebDavConfig>(() => ({
  baseUrl: baseUrl.value.trim(),
  username: username.value.trim(),
  password: password.value,
}))

const envHint = environmentHint()

// ---------------------------------------------------------------------
// 连接测试
// ---------------------------------------------------------------------
const testing = ref(false)
const testState = ref<'idle' | 'ok' | 'ok-empty' | 'err'>('idle')
const testMsg = ref('')

async function testConnection(): Promise<void> {
  if (testing.value || !config.value.baseUrl) {
    if (!config.value.baseUrl) {
      testState.value = 'err'
      testMsg.value = '请先填 WebDAV 地址。'
    }
    return
  }
  testing.value = true
  testState.value = 'idle'
  testMsg.value = ''
  try {
    const exists = await remoteExists(config.value)
    testState.value = exists ? 'ok' : 'ok-empty'
    testMsg.value = exists
      ? '已连上网盘，且网盘上已存在这份备份文件。'
      : '已连上网盘，但还没有这份备份文件——首次请先「上传备份」一次。'
  } catch (e) {
    testState.value = 'err'
    testMsg.value = isWebDavError(e) ? e.message : e instanceof Error ? e.message : String(e)
  } finally {
    testing.value = false
  }
}

// ---------------------------------------------------------------------
// 上传
// ---------------------------------------------------------------------
const pushing = ref(false)
const pushState = ref<'idle' | 'ok' | 'err'>('idle')
const pushMsg = ref('')

async function doPush(): Promise<void> {
  if (pushing.value || !config.value.baseUrl) {
    if (!config.value.baseUrl) {
      pushState.value = 'err'
      pushMsg.value = '请先填 WebDAV 地址。'
    }
    return
  }
  pushing.value = true
  pushState.value = 'idle'
  pushMsg.value = ''
  try {
    const r = await pushBackup(config.value)
    pushState.value = 'ok'
    pushMsg.value = `已上传家庭备份（${r.profileCount} 份档案，${Math.round(r.bytes / 1024)} KB）到网盘。`
    message.success('已上传到网盘')
  } catch (e) {
    pushState.value = 'err'
    pushMsg.value = isWebDavError(e) ? e.message : e instanceof Error ? e.message : String(e)
  } finally {
    pushing.value = false
  }
}

// ---------------------------------------------------------------------
// 下载预览 / 执行
// ---------------------------------------------------------------------
const pulling = ref(false)
const applying = ref(false)
const preview = ref<SyncPreview | null>(null)
const pullError = ref('')
const applyMsg = ref('')
const applied = ref(false)
const applyFailed = ref(false)

async function doPull(): Promise<void> {
  if (pulling.value || !config.value.baseUrl) {
    if (!config.value.baseUrl) pullError.value = '请先填 WebDAV 地址。'
    return
  }
  pulling.value = true
  pullError.value = ''
  applyMsg.value = ''
  applied.value = false
  applyFailed.value = false
  preview.value = null
  try {
    preview.value = await previewPull(config.value)
    if (!preview.value || preview.value.outcome === 'reject') pullError.value = ''
  } catch (e) {
    pullError.value = isWebDavError(e) ? e.message : e instanceof Error ? e.message : String(e)
  } finally {
    pulling.value = false
  }
}

async function confirmSync(): Promise<void> {
  if (applying.value || !preview.value) return
  if (preview.value.outcome !== 'ready' || !preview.value.plan) return
  applying.value = true
  applyMsg.value = ''
  applyFailed.value = false
  try {
    await executePull(preview.value)
    applied.value = true
    applyFailed.value = false
    applyMsg.value = '已同步：网盘上更新的记录已合并进本机，本机较新的记录不会被覆盖。'
    message.success('同步完成')
  } catch (e) {
    applied.value = false
    applyFailed.value = true
    applyMsg.value = isWebDavError(e) ? e.message : e instanceof Error ? e.message : String(e)
  } finally {
    applying.value = false
  }
}

// ---------------------------------------------------------------------
// 渲染辅助
// ---------------------------------------------------------------------
const testTone = computed<string>(() =>
  testState.value === 'err' ? 'sync-err' : 'sync-success',
)
const pushTone = computed<string>(() =>
  pushState.value === 'err' ? 'sync-err' : 'sync-success',
)

/** 拒绝原因里**唯一**需要专属大标题的就是跨档案拦截 */
const isIntercept = computed<boolean>(
  () =>
    !!preview.value?.guard &&
    !preview.value.guard.ok &&
    (preview.value.guard.code === 'cross-profile' ||
      preview.value.guard.code === 'row-profile-mismatch'),
)

const rejectText = computed<string>(() => {
  const p = preview.value
  if (!p || p.outcome !== 'reject') return ''
  return p.reject?.detail ?? '这份备份无法用来同步。'
})

const conflict = computed(() => preview.value?.conflict ?? null)

const conflictLabel = computed<string>(() => {
  const s: SyncConflictState | undefined = preview.value?.state
  switch (s) {
    case 'local-newer':
      return '本机有更新的记录，下载不会覆盖它们。'
    case 'remote-newer':
      return '网盘上有更新的记录，下载后会合并进来。'
    case 'conflict':
      return '两边各有对方没有的内容，已为您列出差异，确认后才会写入。'
    default:
      return ''
  }
})

interface StatRow {
  key: string
  label: string
  value: string
}

function pushStat(rows: StatRow[], key: string, label: string, count: number, unit: string): void {
  if (count <= 0) return
  rows.push({ key, label, value: `${count} ${unit}` })
}

const conflictRows = computed<StatRow[]>(() => {
  const c = conflict.value
  if (!c) return []
  const rows: StatRow[] = []
  pushStat(rows, 'compared', '可比对行', c.comparedRows, '行')
  pushStat(rows, 'local-newer', '本机较新', c.localNewerRows, '行')
  pushStat(rows, 'remote-newer', '网盘较新', c.remoteNewerRows, '行')
  pushStat(rows, 'conflict', '两边都改了', c.conflictRows, '行')
  pushStat(rows, 'local-only', '仅本机有', c.localOnlyRows, '行')
  pushStat(rows, 'remote-only', '仅网盘有', c.remoteOnlyRows, '行')
  return rows
})

loadConfig()
</script>

<style scoped lang="scss">
.sync-note {
  font-size: var(--font-xs);
  line-height: 1.7;
  color: var(--text-sub);
  padding: var(--space-3);
  background: var(--info-soft);
  border-left: 3px solid var(--info-color);
  border-radius: var(--radius-sm);
}

.hint {
  margin-top: var(--space-1);
  font-size: var(--font-xs);
  color: var(--text-sub);
}

.sync-result {
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--font-sm);
  line-height: 1.6;
}

.sync-success {
  background: var(--success-soft);
  border-left: 3px solid var(--success-color);
  color: var(--success-text);
}

.sync-err {
  background: var(--danger-soft);
  border-left: 3px solid var(--danger-color);
  color: var(--danger-text);
}

.sync-reject {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--danger-soft);
  border-left: 3px solid var(--danger-color);
  border-radius: var(--radius-sm);
}

.sync-reject-text {
  font-size: var(--font-sm);
  font-weight: 700;
  color: var(--danger-text);
}

.sync-reject-note {
  font-size: var(--font-xs);
  color: var(--text-muted);
}

.sync-noop {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--info-soft);
  border-left: 3px solid var(--info-color);
  border-radius: var(--radius-sm);
}

.sync-noop-text {
  font-size: var(--font-sm);
  font-weight: 700;
  color: var(--info-text);
}

.sync-ready {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sync-conflict {
  padding: var(--space-3);
  background: var(--warning-soft);
  border-left: 3px solid var(--warning-color);
  border-radius: var(--radius-sm);
}

.sync-conflict-title {
  font-size: var(--font-sm);
  font-weight: 700;
  color: var(--warning-text);
  margin-bottom: var(--space-2);
}

.sync-stats {
  margin: 0;
  padding: 0;
  list-style: none;
}

.sync-stat {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-1) 0;
  border-bottom: 1px dashed var(--border-light);
  font-size: var(--font-xs);
}

.sync-stat-label {
  color: var(--text-sub);
}

.sync-stat-value {
  font-weight: 700;
  color: var(--text-main);
  font-variant-numeric: tabular-nums;
}

.sync-meta {
  font-size: var(--font-xs);
  color: var(--text-muted);
}
</style>
