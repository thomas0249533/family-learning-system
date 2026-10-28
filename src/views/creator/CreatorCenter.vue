<template>
  <div class="creator">
    <PageHeader title="创作者中心" subtitle="家长端 · 可视化建包与联网库同步" />

    <n-tabs type="line" animated class="creator-tabs" v-model:value="activeTab">
      <n-tab-pane name="build" tab="📦 建包">
        <div class="build-layout">
          <!-- 左：表单 -->
          <section class="form-col">
            <n-card title="① 包信息" :bordered="false" class="block">
              <n-space vertical size="medium">
                <div class="field">
                  <label>科目标题 *</label>
                  <n-input v-model:value="form.title" placeholder="例如：四年级上册数学·加法模型" />
                </div>
                <div class="field">
                  <label>包 ID（可选，留空按标题生成）</label>
                  <n-input v-model:value="form.packageId" placeholder="自动 slug 生成" />
                </div>
                <div class="row2">
                  <div class="field">
                    <label>学科</label>
                    <n-select v-model:value="form.subject" :options="subjectOptions" />
                  </div>
                  <div class="field">
                    <label>年级</label>
                    <n-input-number v-model:value="form.grade" :min="1" :max="12" />
                  </div>
                  <div class="field">
                    <label>学期</label>
                    <n-select v-model:value="form.term" :options="termOptions" />
                  </div>
                  <div class="field">
                    <label>版本</label>
                    <n-input v-model:value="form.edition" placeholder="人教版" />
                  </div>
                </div>
              </n-space>
            </n-card>

            <n-card title="② 单元 / 知识点 / 题目" :bordered="false" class="block">
              <n-space vertical size="medium">
                <div v-for="(unit, ui) in form.units" :key="ui" class="unit">
                  <div class="unit-head">
                    <n-input v-model:value="unit.title" placeholder="单元标题" size="small" />
                    <n-button size="tiny" quaternary type="error" @click="removeUnit(ui)">删除单元</n-button>
                  </div>

                  <div v-for="(kp, ki) in unit.knowledgePoints" :key="ki" class="kp">
                    <div class="kp-head">
                      <span class="kp-badge">知识点 {{ ki + 1 }}</span>
                      <n-button size="tiny" quaternary type="error" @click="removeKp(ui, ki)">删除</n-button>
                    </div>
                    <div class="row2">
                      <div class="field">
                        <label>知识点 ID</label>
                        <n-input v-model:value="kp.id" placeholder="add-model" size="small" />
                      </div>
                      <div class="field">
                        <label>标题</label>
                        <n-input v-model:value="kp.title" placeholder="加法模型" size="small" />
                      </div>
                    </div>
                    <div class="field">
                      <label>前置知识点（逗号/换行分隔，可空）</label>
                      <n-input v-model:value="kp.prerequisites" placeholder="sub-model" size="small" />
                    </div>

                    <div v-for="(q, qi) in kp.questions" :key="qi" class="q">
                      <div class="q-head">
                        <span class="q-badge">题 {{ qi + 1 }}</span>
                        <n-button size="tiny" quaternary type="error" @click="removeQuestion(ui, ki, qi)">删除</n-button>
                      </div>
                      <div class="row2">
                        <div class="field">
                          <label>题 ID</label>
                          <n-input v-model:value="q.id" placeholder="q1" size="small" />
                        </div>
                        <div class="field">
                          <label>题型</label>
                          <n-select v-model:value="q.type" :options="typeOptions" size="small" />
                        </div>
                      </div>
                      <div class="field">
                        <label>题干</label>
                        <n-input v-model:value="q.question" type="textarea" :rows="2" size="small" />
                      </div>
                      <div class="field" v-if="q.type !== 'matching'">
                        <label>答案</label>
                        <n-input v-model:value="q.answer" size="small" placeholder="填空/选择/判断" />
                      </div>
                      <div class="field" v-else>
                        <label>连线答案（索引，逗号分隔，如 0,1,2）</label>
                        <n-input v-model:value="q.answer" size="small" />
                      </div>
                      <div class="field" v-if="q.type === 'single' || q.type === 'multiple'">
                        <label>选项（每行一个）</label>
                        <n-input v-model:value="q.optionsText" type="textarea" :rows="3" size="small" />
                      </div>
                      <div class="row2" v-if="q.type === 'matching'">
                        <div class="field">
                          <label>左列（每行一个）</label>
                          <n-input v-model:value="q.leftText" type="textarea" :rows="3" size="small" />
                        </div>
                        <div class="field">
                          <label>右列（每行一个）</label>
                          <n-input v-model:value="q.rightText" type="textarea" :rows="3" size="small" />
                        </div>
                      </div>
                      <div class="field">
                        <label>解析（可空）</label>
                        <n-input v-model:value="q.explanation" size="small" />
                      </div>
                      <div class="field" v-if="q.type === 'blank' || q.type === 'spelling'">
                        <label>主观题判分（按得分点覆盖）</label>
                        <n-switch v-model:value="q.subjective">
                          <template #checked>按得分点判分</template>
                          <template #unchecked>精确匹配</template>
                        </n-switch>
                        <p class="hint-sub">开启后语文阅读短答题按关键词/得分点覆盖度判分，换说法也能判对（essay 已默认按此判分）。</p>
                      </div>
                      <div class="field" v-if="(q.type === 'blank' || q.type === 'spelling') && q.subjective" v-show="q.subjective">
                        <label>得分点（可选，逗号分隔；留空则自动从参考答案抽取）</label>
                        <n-input v-model:value="q.keyPoints" size="small" placeholder="比喻,拟人,排比" />
                      </div>
                    </div>

                    <n-button size="small" dashed block class="add-btn" @click="addQuestion(ui, ki)">+ 添加题目</n-button>
                  </div>

                  <n-button size="small" dashed block class="add-btn" @click="addKp(ui)">+ 添加知识点</n-button>
                </div>

                <n-button type="primary" dashed block @click="addUnit">+ 添加单元</n-button>
              </n-space>
            </n-card>

            <n-space class="actions">
              <n-button type="primary" @click="runValidation">🔍 预览 / 校验</n-button>
              <n-button type="success" @click="exportSet" :disabled="!canExport">⬇️ 导出 .lpkgset</n-button>
            </n-space>
          </section>

          <!-- 右：实时预览 -->
          <section class="preview-col">
            <n-card title="③ 实时预览与校验" :bordered="false" class="block preview-card">
              <div class="summary">
                <n-tag v-if="results.errors.length" type="error">
                  错误 {{ results.errors.length }}
                </n-tag>
                <n-tag v-else type="success">结构无误</n-tag>
                <n-tag v-if="results.warnings.length" type="warning">
                  警告 {{ results.warnings.length }}
                </n-tag>
                <n-tag v-if="stats" :bordered="true">
                  {{ stats.units }} 单元 / {{ stats.knowledgePoints }} 知识点 / {{ stats.exercises }} 题
                </n-tag>
              </div>

              <div v-if="results.errors.length" class="issues">
                <div v-for="(e, i) in results.errors" :key="'e' + i" class="issue err">
                  <span class="code">{{ e.code }}</span>
                  <span class="msg">{{ e.message }}</span>
                  <span class="path">{{ e.path }}</span>
                </div>
              </div>
              <div v-if="results.warnings.length" class="issues">
                <div v-for="(w, i) in results.warnings" :key="'w' + i" class="issue warn">
                  <span class="code">{{ w.code }}</span>
                  <span class="msg">{{ w.message }}</span>
                  <span class="path">{{ w.path }}</span>
                </div>
              </div>
              <div v-if="!results.errors.length && !results.warnings.length" class="empty">
                点「预览 / 校验」生成包结构并展示校验结果。
              </div>

              <div class="json-wrap">
                <div class="json-title">包 JSON 结构预览</div>
                <pre class="json">{{ previewJson }}</pre>
              </div>
            </n-card>
          </section>
        </div>
      </n-tab-pane>

      <n-tab-pane name="sync" tab="🌐 库同步">
        <CatalogSync />
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import { NCard, NSpace, NInput, NSelect, NInputNumber, NButton, NTag, NTabs, NTabPane } from 'naive-ui'
import PageHeader from '@/components/ui/PageHeader.vue'
import CatalogSync from './CatalogSync.vue'
import { buildPackageModel, buildSetFromForm, buildLpkgset, type CreatorForm } from '@core/importer/packSet'
import { normalizePackage, type NormalizeIssue } from '@core/importer/normalizePackage'
import { runContentChecks } from '@core/importer/contentChecks'
import { downloadBlob } from '@core/report/canvasKit'

const activeTab = ref('build')

const subjectOptions = [
  { label: '数学', value: 'math' },
  { label: '语文', value: 'chinese' },
  { label: '英语', value: 'english' },
]
const termOptions = [
  { label: '上学期', value: 'up' },
  { label: '下学期', value: 'down' },
]
const typeOptions = [
  { label: '单选', value: 'single' },
  { label: '填空', value: 'blank' },
  { label: '多选', value: 'multiple' },
  { label: '判断', value: 'judge' },
  { label: '连线', value: 'matching' },
  { label: '拼写', value: 'spelling' },
  { label: '问答', value: 'essay' },
]

function makeQuestion(id: string, type: any = 'single') {
  return {
    id,
    type,
    question: '',
    answer: '',
    optionsText: type === 'single' ? 'A. \nB. \nC. \nD. ' : '',
    leftText: '',
    rightText: '',
    explanation: '',
    subjective: false,
    keyPoints: '',
  }
}

const form = reactive<CreatorForm>({
  title: '示例包·两道题',
  packageId: '',
  subject: 'math',
  grade: 4,
  term: 'up',
  edition: '人教版',
  units: [
    {
      title: '单元一',
      knowledgePoints: [
        {
          id: 'kp1',
          title: '示例知识点',
          prerequisites: '',
          questions: [
            {
              id: 'q1',
              type: 'single',
              question: '1 + 1 = ?',
              answer: 'A',
              optionsText: 'A. 2\nB. 3\nC. 4\nD. 5',
              leftText: '',
              rightText: '',
              explanation: '',
            },
            {
              id: 'q2',
              type: 'blank',
              question: '3 + ___ = 5',
              answer: '2',
              optionsText: '',
              leftText: '',
              rightText: '',
              explanation: '',
            },
          ],
        },
      ],
    },
  ],
})

// 校验结果
const results = reactive<{ errors: NormalizeIssue[]; warnings: NormalizeIssue[] }>({
  errors: [],
  warnings: [],
})
const stats = ref<any>(null)
const previewJson = ref('（点击「预览 / 校验」生成）')

const canExport = computed(() => results.errors.length === 0)

function addUnit() {
  form.units.push({ title: `单元${form.units.length + 1}`, knowledgePoints: [] })
}
function removeUnit(i: number) {
  form.units.splice(i, 1)
}
function addKp(ui: number) {
  form.units[ui].knowledgePoints.push({
    id: '',
    title: '',
    prerequisites: '',
    questions: [makeQuestion('q1')],
  })
}
function removeKp(ui: number, ki: number) {
  form.units[ui].knowledgePoints.splice(ki, 1)
}
function addQuestion(ui: number, ki: number) {
  const n = form.units[ui].knowledgePoints[ki].questions.length + 1
  form.units[ui].knowledgePoints[ki].questions.push(makeQuestion(`q${n}`))
}
function removeQuestion(ui: number, ki: number, qi: number) {
  form.units[ui].knowledgePoints[ki].questions.splice(qi, 1)
}

function runValidation() {
  const model = buildPackageModel(form)
  const norm = normalizePackage(model)
  const content = runContentChecks(model)
  results.errors = [...norm.errors]
  results.warnings = [...norm.warnings, ...content]
  stats.value = norm.stats ?? null
  previewJson.value = JSON.stringify(model, null, 2)
}

function exportSet() {
  runValidation()
  if (results.errors.length > 0) return
  const set = buildSetFromForm(form)
  const bytes = buildLpkgset(set)
  const name = (form.title || 'package').trim().replace(/[\\/:*?"<>|]/g, '_')
  downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), `${name}.lpkgset`)
}

// 初次挂载即预览一次
runValidation()
</script>

<style lang="scss" scoped>
.creator {
  padding: 16px;
}
.build-layout {
  display: grid;
  grid-template-columns: minmax(420px, 1fr) minmax(380px, 1fr);
  gap: 16px;
  align-items: start;
}
.block {
  margin-bottom: 16px;
  background: $card-bg;
  border: 1px solid $border-color;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  label {
    font-size: 12px;
    color: $text-sub;
  }
  .hint-sub {
    font-size: 11px;
    color: $text-sub;
    margin: 2px 0 0;
    line-height: 1.4;
  }
}
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.unit,
.kp,
.q {
  border: 1px solid $border-light;
  border-radius: 8px;
  padding: 10px;
  margin-top: 8px;
  background: $bg-color;
}
.unit-head,
.kp-head,
.q-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.kp-badge,
.q-badge {
  font-size: 12px;
  color: $primary-text;
  background: $primary-light;
  border-radius: 6px;
  padding: 2px 8px;
}
.add-btn {
  margin-top: 8px;
}
.actions {
  margin-top: 16px;
}
.preview-card {
  position: sticky;
  top: 16px;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.issues {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}
.issue {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: start;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid $border-light;
  .code {
    font-weight: 600;
    font-family: monospace;
  }
  .path {
    color: $text-muted;
    font-family: monospace;
  }
}
.issue.err {
  color: $danger-text;
  border-color: $danger-text;
  background: $danger-light;
}
.issue.warn {
  color: $warning-text;
  border-color: $warning-text;
  background: $warning-light;
}
.empty {
  color: $text-muted;
  font-size: 13px;
  padding: 8px 0;
}
.json-wrap {
  margin-top: 12px;
}
.json-title {
  font-size: 12px;
  color: $text-sub;
  margin-bottom: 4px;
}
.json {
  max-height: 360px;
  overflow: auto;
  background: $bg-color;
  border: 1px solid $border-color;
  border-radius: 8px;
  padding: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: $text-main;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
