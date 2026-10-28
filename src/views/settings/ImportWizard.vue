<template>
  <AppCard title="📥 导入学习包" class="wizard-card">
    <n-space vertical>
      <n-upload :custom-request="handleUploadJson" :show-file-list="false" accept=".json">
        <AppButton type="primary" dashed>选择单个 JSON 学习包</AppButton>
      </n-upload>

      <n-upload :custom-request="handleUploadZip" :show-file-list="false" accept=".zip,.lpkgset">
        <AppButton type="success" dashed>选择包集合 ZIP（批量导入）</AppButton>
      </n-upload>

      <!-- G3 · 跨设备扫码导入入口 -->
      <AppButton type="info" dashed @click="openScanModal">📷 扫码导入</AppButton>
    </n-space>

    <!-- G3 · 扫码导入弹窗：摄像头扫码 / 后缀码手输（同一 parser） -->
    <n-modal v-model:show="showScanModal" preset="card" title="📷 扫码导入" style="max-width: 480px;" @after-leave="stopCamera">
      <div class="scan-body">
        <template v-if="scanSupported">
          <div class="scan-video-wrap">
            <video ref="scanVideoRef" class="scan-video" muted playsinline aria-label="摄像头扫码画面"></video>
            <div v-if="cameraError" class="scan-camera-error" role="alert">{{ cameraError }}</div>
          </div>
          <div class="scan-divider">或手动输入分享码</div>
        </template>
        <template v-else>
          <p class="scan-hint">
            本设备的浏览器不支持摄像头扫码，请把另一台设备二维码里的分享码
            （以 FamilyLearning:// 开头，或 type=pkg 开头的后缀码）手动输入到下面。
          </p>
        </template>

        <div class="scan-manual">
          <n-input
            v-model:value="manualCode"
            type="textarea"
            placeholder="粘贴或输入分享码，例如：FamilyLearning://import?type=pkg&pkgId=..."
            :rows="3"
          />
          <AppButton type="primary" class="scan-submit" :disabled="manualCode.trim() === ''" @click="handleManualCode">
            解析分享码
          </AppButton>
        </div>

        <!-- 解析结果：只走文本插值，绝不 v-html -->
        <div v-if="parseError" class="scan-result scan-result-error" role="alert">
          <div class="scan-result-title">❌ 分享码无效</div>
          <div class="scan-result-msg">{{ parseError.message }}</div>
          <div class="scan-result-code">错误码：{{ parseError.code }}</div>
        </div>
        <div v-else-if="parsedPayload" class="scan-result scan-result-ok">
          <div class="scan-result-title">✅ 分享码有效</div>
          <div class="scan-result-msg">学习包：<code>{{ parsedPayload.packageId }}</code></div>
          <div class="scan-result-msg">校验和已通过（{{ parsedPayload.checksum }}）</div>
          <div v-if="parsedPayload.url" class="scan-result-msg">包文件地址：{{ parsedPayload.url }}</div>
          <div class="scan-result-note">请确保该学习包的包文件（.lpkgset / .json）已通过上方按钮或 ZIP 方式导入本机。</div>
        </div>
      </div>
      <template #footer>
        <n-space justify="end">
          <AppButton @click="showScanModal = false">关闭</AppButton>
        </n-space>
      </template>
    </n-modal>

    <!-- 单包确认弹窗 -->
    <n-modal v-model:show="showConfirmModal" title="确认学习包信息" preset="card" style="max-width: 500px;">
      <n-form :model="confirmForm" label-placement="left" label-width="80">
        <n-form-item label="学科">
          <n-select v-model:value="confirmForm.subject" :options="subjectOptions" />
        </n-form-item>
        <n-form-item label="年级">
          <n-input-number v-model:value="confirmForm.grade" :min="1" :max="9" />
        </n-form-item>
        <n-form-item label="学期">
          <n-select v-model:value="confirmForm.term" :options="termOptions" />
        </n-form-item>
        <n-form-item label="教材版本">
          <n-input v-model:value="confirmForm.edition" placeholder="如：人教版" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <AppButton @click="showConfirmModal = false">取消</AppButton>
          <AppButton type="primary" @click="submitJsonImport">确认导入</AppButton>
        </n-space>
      </template>
    </n-modal>

    <!-- 批量结果弹窗 -->
    <n-modal v-model:show="showSetResultModal" preset="card" :title="setResultTitle" style="max-width: 680px;">
      <div v-if="setResultSuccess" class="set-result">
        <div class="result-summary">✅ 已成功导入 <b>{{ setImported }}</b> 个学习包</div>
        <!--
          配图入库数量（V2.12.3）。为什么必须显示：
          「题在、图没了」是这条链路唯一的静默失败形态 —— ZIP 里的图没进
          IndexedDB 时，题照样导入成功、练习照样能答，只有画面上多出一行
          「配图缺失」淡字。没有这个数字，谁也判断不了到底是「包本来就无图」
          还是「图没入库」，只能靠猜。
        -->
        <div class="result-assets" :class="{ 'result-assets--zero': setAssetsImported === 0 }">
          <template v-if="setAssetsImported > 0">🖼️ 其中配图 <b>{{ setAssetsImported }}</b> 张已入库</template>
          <template v-else>本批 ZIP 内没有配图文件（有插图的包这里会显示张数）</template>
        </div>
        <div class="pkg-list">
          <n-tag v-for="id in setPackageIds" :key="id" size="small" type="success" style="margin: 4px 4px 0 0;">
            {{ id }}
          </n-tag>
        </div>
        <div v-if="setWarnings.length > 0" class="warn-list">
          <div class="warn-title">⚠️ {{ setWarnings.length }} 条警告：</div>
          <div v-for="(w, i) in setWarnings" :key="i" class="warn-item">
            [{{ w.code }}] {{ w.message }}
          </div>
        </div>
      </div>
      <div v-else>
        <div class="result-summary error">❌ 导入失败</div>
        <div v-if="setFailedPackageId" class="failed-pkg">
          失败于：<code>{{ setFailedPackageId }}</code>
        </div>
        <div class="error-list">
          <div v-for="(e, i) in setErrors" :key="i" class="error-item">
            <div class="error-head">
              <n-tag type="error" size="small">{{ e.code }}</n-tag>
              <span class="error-path">{{ e.path }}</span>
            </div>
            <div class="error-msg">{{ e.message }}</div>
            <div v-if="e.hint" class="error-hint">💡 {{ e.hint }}</div>
          </div>
        </div>
      </div>
      <template #footer>
        <n-space justify="end">
          <AppButton @click="showSetResultModal = false">关闭</AppButton>
        </n-space>
      </template>
    </n-modal>
  </AppCard>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import {
  NUpload, NModal, NForm, NFormItem,
  NSelect, NInputNumber, NInput, NSpace, NTag, useMessage
} from 'naive-ui'
import { PackageImporter, type ImportIssue } from '@core/importer/importService'
import { parseShareString, type ParseError, type SharePayload } from '@core/share/parser'
import AppCard from '@/components/ui/AppCard.vue'
import AppButton from '@/components/ui/AppButton.vue'

const message = useMessage()

const showConfirmModal = ref(false)
const showSetResultModal = ref(false)
const rawPackageData = ref<any>(null)

const confirmForm = ref({
  subject: 'math',
  grade: 4,
  term: 'up',
  edition: '人教版',
})

const subjectOptions = [
  { label: '数学', value: 'math' },
  { label: '语文', value: 'chinese' },
  { label: '英语', value: 'english' },
]
const termOptions = [
  { label: '上册', value: 'up' },
  { label: '下册', value: 'down' },
]

// 批量结果状态
const setResultSuccess = ref(false)
const setResultTitle = ref('导入结果')
const setImported = ref(0)
const setAssetsImported = ref(0)
const setPackageIds = ref<string[]>([])
const setWarnings = ref<ImportIssue[]>([])
const setErrors = ref<ImportIssue[]>([])
const setFailedPackageId = ref<string>('')

// ==================== G3 · 扫码导入 ====================
// 'BarcodeDetector' 特性检测：可用则调起摄像头，不可用降级为后缀码手输。
// 两条路都收敛到同一个 parseShareString（防御口径唯一）。
const showScanModal = ref(false)
const scanSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window
const scanVideoRef = ref<HTMLVideoElement | null>(null)
const cameraError = ref('')
const manualCode = ref('')
const parseError = ref<ParseError | null>(null)
const parsedPayload = ref<SharePayload | null>(null)

let cameraStream: MediaStream | null = null
let scanTimer: ReturnType<typeof setInterval> | null = null

async function openScanModal(): Promise<void> {
  parseError.value = null
  parsedPayload.value = null
  manualCode.value = ''
  cameraError.value = ''
  showScanModal.value = true
  if (scanSupported) await startCamera()
}

async function startCamera(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    })
    cameraStream = stream
    // 等弹窗内容（video 元素）真正挂载后再喂流
    requestAnimationFrame(() => {
      if (scanVideoRef.value) {
        scanVideoRef.value.srcObject = stream
        void scanVideoRef.value.play()
      }
    })
    await scanLoop()
  } catch {
    // 拒权 / 无摄像头：不阻断弹窗，手输仍然可用
    cameraError.value = '摄像头不可用（未授权或无摄像头），请改用手动输入分享码。'
  }
}

async function scanLoop(): Promise<void> {
  try {
    const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
    scanTimer = setInterval(async () => {
      if (!showScanModal.value || !scanVideoRef.value) return
      try {
        const codes = await detector.detect(scanVideoRef.value)
        if (codes.length > 0) {
          const text = codes[0].rawValue as string
          stopCamera()
          handleScannedCode(text)
        }
      } catch {
        // 单帧识别失败（画面模糊等）静默重试；连续失败由用户手动放弃
      }
    }, 400)
  } catch {
    cameraError.value = '扫码组件初始化失败，请改用手动输入分享码。'
  }
}

function stopCamera(): void {
  if (scanTimer !== null) {
    clearInterval(scanTimer)
    scanTimer = null
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop())
    cameraStream = null
  }
}

function handleScannedCode(text: string): void {
  const result = parseShareString(text)
  if (result.ok) {
    parsedPayload.value = result.payload
    parseError.value = null
    message.success('二维码解析成功，校验和通过')
  } else {
    parsedPayload.value = null
    parseError.value = result.error
  }
}

function handleManualCode(): void {
  handleScannedCode(manualCode.value)
}

onUnmounted(stopCamera)

// ==================== 单包导入 ====================
async function handleUploadJson({ file, onFinish }: any) {
  try {
    const preview = await PackageImporter.parseFileAndPreview(file.file as File)
    rawPackageData.value = preview.rawPackage
    confirmForm.value.subject = preview.manifest.subject || 'math'
    confirmForm.value.grade = preview.manifest.grade || 4
    confirmForm.value.term = preview.manifest.term || 'up'
    confirmForm.value.edition = preview.manifest.edition || '人教版'
    showConfirmModal.value = true
    onFinish()
  } catch (err: any) {
    message.error(err.message || '文件解析失败')
    onFinish()
  }
}

async function submitJsonImport() {
  if (!rawPackageData.value) return
  const result = await PackageImporter.confirmAndImport(rawPackageData.value, {
    subject: confirmForm.value.subject,
    grade: confirmForm.value.grade,
    term: confirmForm.value.term,
  })
  showConfirmModal.value = false
  if (result.success) {
    message.success('🎉 学习包导入成功！')
    if (result.warnings?.length) {
      result.warnings.forEach(w => message.warning(w.message, { duration: 6000 }))
    }
  } else {
    message.error('导入失败，详见 Console')
    console.error('[导入失败]', result)
  }
}

// ==================== ZIP 批量导入 ====================
async function handleUploadZip({ file, onFinish }: any) {
  const f = file.file as File
  message.loading(`正在导入 ${f.name}...`, { duration: 1500 })

  const result = await PackageImporter.importPackageSet(f)

  setResultSuccess.value = result.success
  setResultTitle.value = result.success ? '✅ 批量导入成功' : '❌ 批量导入失败'
  setImported.value = result.imported ?? 0
  setAssetsImported.value = result.assetsImported ?? 0
  setPackageIds.value = result.packageIds ?? []
  setWarnings.value = result.warnings ?? []
  setErrors.value = result.errors ?? []
  setFailedPackageId.value = result.failedPackageId ?? ''

  showSetResultModal.value = true
  onFinish()
}
</script>

<style scoped lang="scss">
/* radius-lg + shadow-sm 已由 AppCard 承载；此处仅保留卡片间距 */
.wizard-card { margin-bottom: 16px; }

/* ===== G3 · 扫码导入弹窗（样式全部走语义 token）===== */
.scan-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.scan-video-wrap {
  position: relative;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--bg-color);
}

.scan-video {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
}

.scan-camera-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-3);
  font-size: var(--font-xs);
  color: var(--danger-text);
  background: var(--bg-color);
}

.scan-divider {
  font-size: var(--font-xs);
  color: var(--text-muted);
  text-align: center;
}

.scan-hint {
  margin: 0;
  font-size: var(--font-xs);
  color: var(--text-sub);
  line-height: 1.7;
}

.scan-manual {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.scan-submit {
  align-self: flex-end;
}

.scan-result {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--border-color);
}

.scan-result-error {
  background: var(--danger-soft);
  border-left-color: var(--danger-color);
  .scan-result-title { color: var(--danger-text); }
}

.scan-result-ok {
  background: var(--success-soft);
  border-left-color: var(--success-color);
  .scan-result-title { color: var(--success-text); }
}

.scan-result-title {
  font-size: var(--font-sm);
  font-weight: 700;
  margin-bottom: var(--space-1);
}

.scan-result-msg {
  font-size: var(--font-xs);
  color: var(--text-main);
  line-height: 1.7;
  code {
    background: var(--bg-color-hover);
    padding: 0 4px;
    border-radius: var(--radius-xs);
  }
}

.scan-result-code {
  margin-top: var(--space-1);
  font-size: var(--font-2xs);
  color: var(--text-muted);
}

.scan-result-note {
  margin-top: var(--space-1);
  font-size: var(--font-2xs);
  color: var(--text-sub);
}

.set-result .result-summary {
  font-size: 15px;
  margin-bottom: 12px;
  b { color: $primary-text; font-size: 20px; }
  &.error { color: $danger-text; }
}
/* 配图数量：有数字时是"确认图进来了"，0 时降成淡字说明，不制造焦虑 */
.set-result .result-assets {
  font-size: $font-xs;
  color: $text-sub;
  margin: -6px 0 12px;
  b { color: $primary-text; }
  &--zero { color: $text-muted; }
}
.pkg-list { margin-bottom: 12px; }
.warn-list {
  background: $warning-light;
  padding: 10px 12px;
  border-radius: 6px;
  .warn-title { font-size: 13px; font-weight: 700; color: $warning-text; margin-bottom: 6px; }
  .warn-item { font-size: 12px; color: $text-sub; line-height: 1.6; }
}
.failed-pkg {
  font-size: 13px;
  margin-bottom: 10px;
  code { background: $danger-light; color: $danger-text; padding: 2px 6px; border-radius: 4px; }
}
.error-list {
  max-height: 50vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.error-item {
  border-left: 3px solid $danger-color;
  background: $danger-light;
  padding: 10px 14px;
  border-radius: 6px;
  .error-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    .error-path { font-family: monospace; font-size: 12px; color: $text-sub; }
  }
  .error-msg { font-size: 13px; font-weight: 600; }
  .error-hint { margin-top: 6px; font-size: 12px; color: $text-sub; }
}
</style>