<template>
  <AppCard title="🧠 本地离线 AI" class="card">
    <n-space vertical size="large">
      <!-- 现实提醒：先把"为什么它值得装"和"它不是什么"讲清楚，再给按钮 -->
      <div class="local-note">
        <strong>完全离线的讲评引擎。</strong>
        模型装在本机（不进安装包），联网与否都能用。第一次生成首字会等几秒，之后逐字出现。
      </div>

      <!-- ① 状态区：未安装 / 已就绪 / 校验失败 -->
      <div class="status-row">
        <AppBadge :tone="statusTone" size="sm" :icon="statusIcon">{{ statusLabel }}</AppBadge>
        <span v-if="statusDetail" class="status-detail">{{ statusDetail }}</span>
      </div>

      <div v-if="!tauriEnv" class="web-hint">
        网页版没有本地模型能力，讲评会自动走 Ollama / 云端 / 题库解析。桌面版（.exe）才有这一档。
      </div>

      <template v-else>
        <!-- ② 下载区 -->
        <div>
          <h4 class="setting-label">从网址下载 .gguf 模型</h4>
          <n-input
            v-model:value="downloadUrl"
            :disabled="downloading"
            placeholder="模型文件的直链，例如 ModelScope 上的 GGUF 直链"
          />
          <div class="hint">
            只填「文件直链」（以 .gguf 结尾），不是模型介绍页。下载会存到本机 App 数据目录。
          </div>
        </div>

        <div>
          <h4 class="setting-label">期望的 SHA-256（可留空）</h4>
          <n-input
            v-model:value="expectedSha"
            :disabled="downloading"
            placeholder="填了就校验，对不上会自动删掉下载的文件"
          />
          <div class="hint">留空也能装，只是没法证明文件没被替换；填了更安全。</div>
        </div>

        <n-space>
          <AppButton
            type="primary"
            :loading="downloading"
            :disabled="downloading || !downloadUrl.trim()"
            @click="startDownload"
          >
            下载并校验
          </AppButton>
          <AppButton :disabled="downloading" @click="pickLocal">选择本地 .gguf 文件</AppButton>
          <AppButton :disabled="downloading || !installed" @click="removeModel">移除模型</AppButton>
        </n-space>

        <!-- 进度：total 未知时显示为"处理中"，不假装知道百分比 -->
        <div v-if="downloading" class="progress-box">
          <n-progress
            type="line"
            :percentage="percent"
            :processing="progressTotal === 0"
            indicator-placement="inside"
          />
          <div class="hint">{{ progressText }}</div>
        </div>

        <div v-if="actionError" class="local-err">{{ actionError }}</div>
        <div v-if="actionOk" class="local-ok">{{ actionOk }}</div>
      </template>

      <!-- ③ 推荐：只说量级，不下"一定行"的结论 -->
      <div class="advice">
        <div class="advice-title">装哪个？</div>
        <div class="advice-text">
          可以找 <strong>Qwen2.5-0.5B-Instruct-GGUF（Q4_K_M 量化）</strong>这个量级：文件约 400MB，
          16G 内存的普通笔记本纯 CPU 跑，首字通常在几秒内。模型越大答得越细，但也越慢；
          具体哪一档在你这台机器上够用，需要装了试一次才知道。
        </div>
        <div class="advice-text">
          装好后可以到「错题本」点一次「💡 启发一下」，看讲评上方是否标着「本地离线 AI」。
        </div>
      </div>
    </n-space>
  </AppCard>
</template>

<script setup lang="ts">
// =====================================================================
// LocalAiCard · 本地离线 AI（V2.0 · A2）
// ---------------------------------------------------------------------
// 自包含卡片：状态 / 下载 / 选文件 / 移除 全在这一个文件里，Settings.vue 只加一行。
//
// 三条纪律：
//   ① **不硬编码任何下载地址** —— 模型来源会变，写死的链接半年后就是 404；
//      家长/维护者自己贴直链，卡片只负责传输与校验。
//   ② **前端不碰文件系统** —— 选文件走 Rust（rfd），路径不进 JS；capability 无 fs 权限。
//   ③ **Web 端不报错** —— 浏览器里没有 Tauri，`ipc.ts` 短路返回 null，
//      这里显示"未安装 + 桌面版才有"的说明，而不是一条红色异常。
// =====================================================================
import { computed, onMounted, ref } from 'vue'
import { NInput, NProgress, NSpace, useDialog, useMessage } from 'naive-ui'
import AppCard from '@/components/ui/AppCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import {
  CandleError,
  aiModelDownload,
  aiModelPick,
  aiModelRemove,
  aiModelStatus,
  isCandleAvailable,
  type CandleModelStatus,
} from '@core/ai/candle/ipc'

const message = useMessage()
const dialog = useDialog()

/** 渲染期就确定：浏览器里永远不会变成 true，按钮直接置灰并解释原因 */
const tauriEnv = isCandleAvailable()

const status = ref<CandleModelStatus | null>(null)
const checking = ref(false)
const downloading = ref(false)
const downloadUrl = ref('')
const expectedSha = ref('')
const progressReceived = ref(0)
const progressTotal = ref(0)
const actionError = ref('')
const actionOk = ref('')

const installed = computed<boolean>(() => !!status.value?.installed)

const statusTone = computed<'neutral' | 'success' | 'danger'>(() => {
  if (!tauriEnv) return 'neutral'
  if (!status.value?.installed) return 'neutral'
  return status.value.available ? 'success' : 'danger'
})

const statusIcon = computed<string>(() => {
  if (!status.value?.installed) return '○'
  return status.value.available ? '✓' : '!'
})

const statusLabel = computed<string>(() => {
  if (checking.value && !status.value) return '正在检查…'
  if (!status.value?.installed) return '未安装'
  return status.value.available ? '已就绪' : '校验失败'
})

function formatBytes(n: number): string {
  if (n <= 0) return '0 B'
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const statusDetail = computed<string>(() => {
  const s = status.value
  if (!s) return ''
  if (s.installed && s.available && s.fileName) {
    const sha = s.sha256 ? `SHA-256 ${s.sha256.slice(0, 12)}…` : '未计算哈希'
    return `${s.fileName} · ${formatBytes(s.sizeBytes)} · ${sha}`
  }
  if (s.installed && !s.available) {
    return '文件在，但读不出哈希（可能没下完整）。建议移除后重下。'
  }
  return ''
})

const percent = computed<number>(() => {
  if (progressTotal.value <= 0) return 0
  return Math.min(100, Math.round((progressReceived.value / progressTotal.value) * 100))
})

const progressText = computed<string>(() => {
  const got = formatBytes(progressReceived.value)
  if (progressTotal.value <= 0) return `已接收 ${got}（服务器没给文件大小）`
  return `${got} / ${formatBytes(progressTotal.value)}`
})

async function refresh(): Promise<void> {
  if (!tauriEnv) return
  checking.value = true
  try {
    status.value = await aiModelStatus()
  } finally {
    checking.value = false
  }
}

/** Rust 侧的错误码 → 家长能照着做的一句话 */
function humanize(err: unknown): string {
  if (!(err instanceof CandleError)) {
    return err instanceof Error ? err.message : String(err)
  }
  switch (err.code) {
    case 'http':
      return '下载地址打不开（服务器返回了错误）。确认链接是文件直链，且不需要登录。'
    case 'network':
      return '连不上下载地址。检查网络，或者把链接复制到浏览器里试一次。'
    case 'model-corrupt':
      return '下载完成但文件不对（校验不通过或内容不是模型），已经删掉了。请核对 SHA-256。'
    case 'bad-request':
      return '这个文件不是 .gguf 模型，或者下载地址没填。'
    default:
      return `下载没有完成（${err.code}）。可以再试一次。`
  }
}

async function startDownload(): Promise<void> {
  if (downloading.value) return
  const url = downloadUrl.value.trim()
  if (!url) return
  downloading.value = true
  actionError.value = ''
  actionOk.value = ''
  progressReceived.value = 0
  progressTotal.value = 0
  try {
    const next = await aiModelDownload(url, expectedSha.value.trim(), (p) => {
      progressReceived.value = p.received
      progressTotal.value = p.total
    })
    if (!next) {
      actionError.value = '当前环境不支持下载（桌面版才有这个能力）。'
      return
    }
    status.value = next
    actionOk.value = `模型已就绪：${next.fileName ?? ''}（${formatBytes(next.sizeBytes)}）`
    message.success('模型已就绪')
  } catch (err) {
    actionError.value = humanize(err)
  } finally {
    downloading.value = false
  }
}

async function pickLocal(): Promise<void> {
  if (downloading.value) return
  actionError.value = ''
  actionOk.value = ''
  try {
    const next = await aiModelPick()
    if (!next) {
      actionError.value = '当前环境不支持选择文件（桌面版才有这个能力）。'
      return
    }
    // 取消对话框时状态不变（Rust 返回当前状态）—— 不该提示"成功"
    if (next.installed && next.path !== status.value?.path) {
      actionOk.value = `已复制进模型目录：${next.fileName ?? ''}`
      message.success('模型已就绪')
    }
    status.value = next
  } catch (err) {
    actionError.value = humanize(err)
  }
}

function removeModel(): void {
  dialog.warning({
    title: '移除本地模型？',
    content: '会删除本机模型文件（几百 MB）。以后可以重新下载或选择。',
    positiveText: '移除',
    negativeText: '取消',
    onPositiveClick: async () => {
      actionError.value = ''
      actionOk.value = ''
      const next = await aiModelRemove()
      status.value = next
      actionOk.value = next?.installed ? '' : '已移除。'
    },
  })
}

onMounted(() => {
  void refresh()
})
</script>

<style scoped lang="scss">
.local-note {
  font-size: var(--font-xs);
  line-height: 1.7;
  color: var(--text-sub);
  padding: var(--space-3);
  background: var(--info-soft);
  border-left: 3px solid var(--info-color);
  border-radius: var(--radius-sm);
}

.status-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.status-detail {
  font-size: var(--font-xs);
  color: var(--text-sub);
  font-variant-numeric: tabular-nums;
}

.hint {
  margin-top: var(--space-1);
  font-size: var(--font-xs);
  color: var(--text-sub);
}

.web-hint {
  font-size: var(--font-xs);
  line-height: 1.7;
  color: var(--text-sub);
  padding: var(--space-3);
  background: var(--warning-soft);
  border-left: 3px solid var(--warning-color);
  border-radius: var(--radius-sm);
}

.progress-box {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.local-err {
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--font-sm);
  line-height: 1.6;
  background: var(--danger-soft);
  border-left: 3px solid var(--danger-color);
  color: var(--danger-text);
}

.local-ok {
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--font-sm);
  line-height: 1.6;
  background: var(--success-soft);
  border-left: 3px solid var(--success-color);
  color: var(--success-text);
}

.advice {
  padding: var(--space-3);
  background: var(--surface-2);
  border-radius: var(--radius-sm);
}

.advice-title {
  font-size: var(--font-sm);
  font-weight: 700;
  color: var(--text-main);
  margin-bottom: var(--space-1);
}

.advice-text {
  font-size: var(--font-xs);
  line-height: 1.7;
  color: var(--text-sub);
}
</style>
