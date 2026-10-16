<template>
  <n-card title="📥 导入学习包" class="wizard-card">
    <n-space vertical>
      <n-upload :custom-request="handleUploadJson" :show-file-list="false" accept=".json">
        <n-button type="primary" dashed>选择单个 JSON 学习包</n-button>
      </n-upload>

      <n-upload :custom-request="handleUploadZip" :show-file-list="false" accept=".zip,.lpkgset">
        <n-button type="success" dashed>选择包集合 ZIP（批量导入）</n-button>
      </n-upload>
    </n-space>

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
          <n-button @click="showConfirmModal = false">取消</n-button>
          <n-button type="primary" @click="submitJsonImport">确认导入</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 批量结果弹窗 -->
    <n-modal v-model:show="showSetResultModal" preset="card" :title="setResultTitle" style="max-width: 680px;">
      <div v-if="setResultSuccess" class="set-result">
        <div class="result-summary">✅ 已成功导入 <b>{{ setImported }}</b> 个学习包</div>
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
          <n-button @click="showSetResultModal = false">关闭</n-button>
        </n-space>
      </template>
    </n-modal>
  </n-card>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  NCard, NUpload, NButton, NModal, NForm, NFormItem,
  NSelect, NInputNumber, NInput, NSpace, NTag, useMessage
} from 'naive-ui'
import { PackageImporter, type ImportIssue } from '@core/importer/importService'

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
const setPackageIds = ref<string[]>([])
const setWarnings = ref<ImportIssue[]>([])
const setErrors = ref<ImportIssue[]>([])
const setFailedPackageId = ref<string>('')

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
  setPackageIds.value = result.packageIds ?? []
  setWarnings.value = result.warnings ?? []
  setErrors.value = result.errors ?? []
  setFailedPackageId.value = result.failedPackageId ?? ''

  showSetResultModal.value = true
  onFinish()
}
</script>

<style scoped lang="scss">
.wizard-card { margin-bottom: 16px; border-radius: $radius-lg; box-shadow: $shadow; }

.set-result .result-summary {
  font-size: 15px;
  margin-bottom: 12px;
  b { color: $primary-color; font-size: 20px; }
  &.error { color: $danger-color; }
}
.pkg-list { margin-bottom: 12px; }
.warn-list {
  background: $warning-light;
  padding: 10px 12px;
  border-radius: 6px;
  .warn-title { font-size: 13px; font-weight: 700; color: $warning-color; margin-bottom: 6px; }
  .warn-item { font-size: 12px; color: $text-sub; line-height: 1.6; }
}
.failed-pkg {
  font-size: 13px;
  margin-bottom: 10px;
  code { background: $danger-light; color: $danger-color; padding: 2px 6px; border-radius: 4px; }
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