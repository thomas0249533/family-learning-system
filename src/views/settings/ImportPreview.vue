<template>
  <div class="import-preview" :data-step="step">
    <!-- 常驻的 live region：两步的内容都在里面切换，读屏器才会播报
         （如果只挂在第二步的容器上，节点是"新插入"的，未必会被朗读） -->
    <div class="import-live" aria-live="polite" aria-atomic="true">
      <!-- ==================== 第 1 步 · 选文件 ==================== -->
      <div v-if="step === 'pick'" class="import-pick">
        <div class="import-step-title">第 1 步 · 选择备份文件</div>

        <n-upload :custom-request="handleSelect" :show-file-list="false" accept=".json">
          <AppButton type="primary" dashed :loading="previewing" :disabled="previewing">
            选择备份文件（.json）
          </AppButton>
        </n-upload>

        <div class="import-hint">选中后会先告诉你「将会导入什么」，这一步不会改动任何数据。</div>

        <!-- 读文件 / 解析 / 预览失败：就地显示，不吞异常 -->
        <div v-if="readError" class="import-error" role="alert">
          <div class="import-error-title">无法读取这份文件</div>
          <div class="import-error-hint">本机数据未做任何改动，可以换一个文件再试。</div>
          <details class="import-detail">
            <summary>详情</summary>
            <pre class="import-error-text">{{ readError }}</pre>
          </details>
        </div>
      </div>

      <!-- ==================== 第 2 步 · 预览（只读，绝不落库） ==================== -->
      <div v-else class="import-review">
        <div class="import-step-title">第 2 步 · 确认要导入的内容</div>

        <!-- ① 拒绝：版本太新 / 结构损坏 / 行归属不符 / 档案超限 -->
        <div v-if="outcome === 'reject'" class="import-reject">
          <AppBadge tone="danger" size="sm" icon="⛔">无法导入</AppBadge>
          <div class="import-reject-text">{{ rejectMessage }}</div>
          <div class="import-reject-note">未做任何改动。</div>
          <details v-if="rejectDetail" class="import-detail">
            <summary>详情</summary>
            <pre class="import-error-text">{{ rejectDetail }}</pre>
          </details>
        </div>

        <!-- ② 无变化：本机已包含这份备份的全部数据 -->
        <div v-else-if="outcome === 'noop'" class="import-noop">
          <AppBadge tone="info" size="sm" icon="✅">无需导入</AppBadge>
          <div class="import-noop-text">没有需要导入的新内容</div>
          <div class="import-noop-note">
            这份备份里的数据本机都已经有了，导入不会产生任何改动。
          </div>
        </div>

        <!-- ③ 可以导入 / 已导入 -->
        <div v-else class="import-ready">
          <AppBadge tone="success" size="sm" :icon="applied ? '✅' : '📋'">
            {{ applied ? '已导入' : '可以导入' }}
          </AppBadge>

          <ul class="import-stats">
            <li v-for="row in statRows" :key="row.key" class="import-stat">
              <span class="import-stat-label">{{ row.label }}</span>
              <span class="import-stat-value">{{ row.value }}</span>
            </li>
          </ul>
          <div v-if="statRows.length === 0" class="import-stat">本次没有需要写入的内容</div>

          <div v-if="applied" class="import-done-note">已导入，数据已刷新。</div>

          <!-- 执行失败：必须说清"一行都没写进去"（AC-P2-15） -->
          <div v-if="applyError" class="import-error" role="alert">
            <div class="import-error-title">未导入任何数据</div>
            <div class="import-error-hint">
              {{ applyErrorCode === 'stale-local-data' ? STALE_LOCAL_COPY : '这次导入没有写入任何一行数据，本机数据保持原样。' }}
            </div>
            <details class="import-detail">
              <summary>详情</summary>
              <pre class="import-error-text">{{ applyError }}</pre>
            </details>
          </div>

          <!-- A6-L1：导入期拦截提示。放在 .import-ready 最后（最贴近操作区），
               预览态与失败重试态常驻；成功导入后 `applied` 非空即消失。 -->
          <div v-if="!applied" class="import-warning">
            ⚠️ 导入期间请不要在学习页答题。若刚答过题，请返回首页同步后再导入。
          </div>
        </div>

        <!-- 操作区：拒绝 / 无变化时**不出现**执行按钮 -->
        <div class="import-actions">
          <AppButton
            v-if="canConfirm"
            class="import-confirm"
            type="primary"
            :loading="isImporting"
            :disabled="isImporting"
            @click="confirmImport"
          >
            {{ applyError ? '重试导入' : '确认导入' }}
          </AppButton>
          <AppButton @click="reset">{{ applied ? '再导入一份' : '重新选择' }}</AppButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// ImportPreview · 备份导入的两步向导（V1.4 · B2 / §8.3）
// ---------------------------------------------------------------------
// 关系：本组件只做"看"和"点"，所有判断与写入都在 core 层：
//   预览 = `previewImport()`（只算不写）  →  `ImportPreview.plan.stats`
//   执行 = `executeImport(plan)`（写入全在单事务内）
// 为什么两步：统计数字只能来自"先算一遍"。做成一步（边算边写）时，
// 用户看到统计的瞬间数据已经进库，"重新选择"就成了摆设。
//
// 三分支（reject / noop / ready）**只读 `preview.outcome`**：判序收在编排层的一个
// 私有函数里（`@core/backup/importOrchestrator`），UI 不自己看 `route` / `plan.stats`
// 再排一遍。两套判定并存必然分叉 —— 而这套判序出错的方向恰好是"把拒绝说成没有新数据"，
// 两句话对家长的含义完全相反（一个要换文件，一个不用管）。
// =====================================================================
import { computed, ref, shallowRef } from 'vue'
import { NUpload, useMessage, type UploadCustomRequestOptions } from 'naive-ui'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import {
  executeImport,
  previewImport,
  type ImportApplied,
  type ImportOutcome,
  type ImportPreview as ImportPreviewResult,
} from '@core/backup/importOrchestrator'
import type { BackupRejectReason } from '@core/backup/types'

const message = useMessage()

/** 向导当前在第几步（同一个卡片内切换，不走路由） */
type Step = 'pick' | 'review'

const step = ref<Step>('pick')
/** 正在读文件 + 预览 */
const previewing = ref(false)
/**
 * 正在执行写入（A6-L1 起改名自 `applying`，与规格用词对齐）。
 *
 * 只管 **in-flight**：按钮 `:loading` + `:disabled` 保证一次请求未回来前不再发起。
 * 它**挡不住**"快速失败后连续点击"——写库抛错只要几毫秒，`finally` 一放开按钮，
 * 家长连点两下就又是两次 `executeImport`。那件事由下面的冷却窗口负责。
 */
const isImporting = ref(false)
// ⚠️ 必须是 `shallowRef`：`ImportPreview` 里挂着 `plan`（含上千行记录），
// 深层 `ref` 会把它们逐个代理化，而 Proxy **不能被 structured clone** ——
// `executeImport` 写库时 Dexie 会抛 `DataCloneError`，页面显示"未导入任何数据"。
// 这里不深响应式也完全够用：模板只读 `preview.value.outcome` 与 `plan.stats`，
// 而 `stats` 是整体替换（不会原地改字段），不需要深层追踪。
const preview = shallowRef<ImportPreviewResult | null>(null)
/** `null` = 还没预览过（此时停留在第 1 步） */
const outcome = ref<ImportOutcome | null>(null)
/** 执行结果（非空 = 已成功导入，统计改为显示"实际写入"的数字） */
const applied = ref<ImportApplied | null>(null)
/** 读文件 / JSON 解析 / 预览的失败原文（停在第一步） */
const readError = ref('')
/** 执行失败的原文（停在第二步，正文说明"一行都没写进去"） */
const applyError = ref('')
/**
 * `executeImport` 抛出的 `Error.code`（A6-L1）。
 *
 * 只有 `'stale-local-data'` 需要专属文案：它的含义是"预览之后本机又产生了新记录，
 * 刚才那份计划过期了"。普通失败共用"一行都没写进去"的兜底文案。
 */
const applyErrorCode = ref('')

/**
 * 导入冷却窗口（毫秒）。**普通变量，不用 ref** —— 它只在事件回调里被读和写，
 * 不参与渲染；放进 ref 会让每次点击都触发一次无意义的组件重渲染。
 *
 * 为什么不能只靠 `isImporting`：见上面的注释——失败路径放开按钮的速度远快于人
 * 把手指移开的速度，连点会变成多次导入尝试（每次都是真实的事务尝试）。
 */
const IMPORT_COOLDOWN_MS = 2000
let importCooldownUntil = 0

// ---------------------------------------------------------------------
// 文案
// ---------------------------------------------------------------------

/** 版本路由层的拒绝文案（照 PRD 定稿，不自创） */
const REJECT_COPY: Record<BackupRejectReason, string> = {
  'too-new': '这份备份来自更新的版本，请先升级本设备',
  mismatch: '备份内容与它声称的档案对不上，为避免写错档案，已拒绝导入',
  malformed: '这不是本应用生成的备份文件',
  unknown: '这不是本应用生成的备份文件',
}

/** 档案超限（`plan.reject.reason === 'profile-limit'`）的文案 */
const PROFILE_LIMIT_COPY = '导入后会超过 4 个档案，请先导出并删除一个再试'

/**
 * 陈旧数据（`code === 'stale-local-data'`）的专属文案（A6-L1）。
 *
 * 与 `PROFILE_LIMIT_COPY` 同模式：错误码 → 人话的映射集中在这里，模板只做选择。
 * 这句必须明确告诉家长**怎么做**（回首页同步、再预览一次）——AC-P2-15 的教训是
 * 只写"导入失败"等于没说：他不知道该重试还是该换文件。
 */
const STALE_LOCAL_COPY = '检测到新的学习记录，为了数据安全，请重新预览后再导入。'

const rejectMessage = computed<string>(() => {
  const plan = preview.value?.plan
  if (plan?.reject?.reason === 'profile-limit') return PROFILE_LIMIT_COPY
  const route = preview.value?.route
  if (route && route.kind === 'reject') return REJECT_COPY[route.reason]
  return '这份备份无法导入'
})

/** 拒绝的技术原因（折叠在"详情"里，供排障；正文文案仍是人话） */
const rejectDetail = computed<string>(() => {
  const plan = preview.value?.plan
  if (plan?.reject) return plan.reject.detail
  const route = preview.value?.route
  return route && route.kind === 'reject' ? route.detail : ''
})

// ---------------------------------------------------------------------
// 统计行
// ---------------------------------------------------------------------

interface StatRow {
  key: string
  label: string
  value: string
}

/** 计数 > 0 才推一行（统计行只显示非零项） */
function pushRow(
  rows: StatRow[],
  key: string,
  label: string,
  count: number,
  unit: string,
  prefix: string = ''
): void {
  if (count <= 0) return
  rows.push({ key, label, value: `${prefix}${count}${unit ? ' ' + unit : ''}` })
}

const statRows = computed<StatRow[]>(() => {
  const rows: StatRow[] = []

  // 已导入 → 显示**实际写入**的数字（`applyMergePlan` 的返回值）
  const done = applied.value
  if (done) {
    pushRow(rows, 'profiles', '新增档案', done.profiles, '个')
    pushRow(rows, 'progress', '新增进度', done.progress, '条')
    pushRow(rows, 'mistakes', '新增错题', done.mistakes, '条')
    pushRow(rows, 'sessions', '新增模考场次', done.sessions, '场')
    pushRow(rows, 'settings', '更新设置', done.settings, '项')
    return rows
  }

  // 预览 → 显示计划里的数字（`plan.stats`，此时库里一行都没写）
  const stats = preview.value?.plan?.stats
  if (!stats) return rows

  pushRow(rows, 'profiles', '新增档案', stats.profilesAdded, '个')
  pushRow(rows, 'progress', '新增进度', stats.progressAdded, '条')
  // 刻意不写"跳过"：家长看到"跳过"会以为漏导了。实际语义是"本机这条更新，保留本机"
  pushRow(rows, 'progress-kept', '本机较新，已保留', stats.progressKeptLocal, '条进度')
  pushRow(rows, 'mistakes', '新增错题', stats.mistakesAdded, '条')
  pushRow(rows, 'mistakes-kept', '本机较新，已保留', stats.mistakesKeptLocal, '条错题')
  pushRow(rows, 'sessions', '新增模考场次', stats.sessionsAdded, '场')
  pushRow(rows, 'sessions-kept', '本机较新，已保留', stats.sessionsKeptLocal, '场模考')
  // 徽章单独一行：它不是"条数"，混在进度里会被当成错题数
  pushRow(rows, 'achievements', '徽章', stats.achievementsAdded, '', '+')
  pushRow(rows, 'settings', '更新设置', stats.settingsChanged, '项')
  pushRow(rows, 'settings-kept', '设置保持本机', stats.settingsKeptLocal, '项')
  return rows
})

/** 只有"可导入且尚未执行"时才出现执行按钮（拒绝 / 无变化都没有） */
const canConfirm = computed<boolean>(() => outcome.value === 'ready' && applied.value === null)

// ---------------------------------------------------------------------
// 流程
// ---------------------------------------------------------------------

/** 把异常变成一句可展示的原文（不吞异常） */
function describeError(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/** `JSON.parse` 的报错是英文技术文案，包一层让家长也能看懂发生了什么 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (e) {
    throw new Error(`文件内容不是合法的 JSON：${describeError(e)}`)
  }
}

/**
 * 第 1 步：读文件 → 解析 → 预览（**只算不写**）。
 *
 * 结论直接取 `result.outcome`（编排层的唯一判序）。这里不重排 reject / noop：
 * 重排一次就等于第二套口径，下次 core 改了判序 UI 会静默按旧逻辑渲染。
 */
async function handleSelect(options: UploadCustomRequestOptions): Promise<void> {
  readError.value = ''
  previewing.value = true
  try {
    const file = options.file.file
    if (!file) throw new Error('没有读到文件内容，请重新选择一次')
    const text = await file.text()
    const json = parseJson(text)
    const result = await previewImport(json)

    preview.value = result
    outcome.value = result.outcome
    applied.value = null
    applyError.value = ''
    applyErrorCode.value = ''
    step.value = 'review'
  } catch (e) {
    // 停在第一步，并就地展示原因：静默回到"请选择文件"会让用户反复试同一个坏文件
    preview.value = null
    outcome.value = null
    applied.value = null
    applyError.value = ''
    applyErrorCode.value = ''
    step.value = 'pick'
    readError.value = describeError(e)
    message.error('读取备份失败，未导入任何数据')
  } finally {
    previewing.value = false
    // 通知 n-upload 本次请求结束（列表已隐藏，但内部状态要收尾，
    // 否则再次选**同一个文件**不会触发 custom-request）
    options.onFinish()
  }
}

/**
 * 第 2 步：执行写入（唯一会改库的一步，写入全在 core 的单事务里）。
 *
 * 两层防连点，分工明确、**互不替代**：
 *   1. `isImporting`（按钮 `:loading` + `:disabled`）：挡 **in-flight** 的重复发起，
 *      即"请求还没回来时慢网络/手抖下的连点"；
 *   2. `importCooldownUntil`：挡 **快速失败后**的连续点击。写库失败只需几毫秒，
 *      `finally` 立刻放开按钮，手指还没移开就点下了第二次 —— 每次点击都是真实的
 *      事务尝试，这正是需要"时间窗"而不是"状态位"的原因。
 *
 * 刻意不做的事：不用 `setTimeout` 回写某个标志（那会把"冷却中"渲染成假 loading），
 * 也不显示"冷却中"提示 —— 冷却是防误触，不该变成用户必须理解的状态。
 */
async function confirmImport(): Promise<void> {
  // 冷却窗口内的点击**直接忽略**：连 isImporting 都不进，按钮不会闪一下 loading
  if (Date.now() < importCooldownUntil) return

  const plan = preview.value?.plan
  if (!plan || isImporting.value || applied.value) return

  // 点击即起算（不是"导入结束才开始算"）：成功/失败都挡满 2 秒。
  // 失败路径尤其需要它——否则错误提示刚出现，家长顺手再点一次就又跑一遍。
  importCooldownUntil = Date.now() + IMPORT_COOLDOWN_MS

  isImporting.value = true
  applyError.value = ''
  applyErrorCode.value = ''
  try {
    applied.value = await executeImport(plan)
    message.success('已导入，数据已刷新')
  } catch (e) {
    // AC-P2-15：失败时必须明确告诉用户"一行都没写进去"
    applyError.value = describeError(e)
    // `stale-local-data` 走专属文案；其它（含没有 code）留给兜底
    applyErrorCode.value = e instanceof Error ? ((e as { code?: string }).code ?? '') : ''
    message.error('导入失败，未导入任何数据')
  } finally {
    isImporting.value = false
  }
}

/**
 * 回到第 1 步，清掉上一份文件的全部状态（避免旧预览的统计串到新文件上）。
 *
 * 一并把冷却窗口清零：重新选文件是一次**新的**导入尝试，不该被上一次的 2 秒
 * 冷却挡住——那会让家长以为按钮坏了。
 */
function reset(): void {
  step.value = 'pick'
  previewing.value = false
  isImporting.value = false
  importCooldownUntil = 0
  preview.value = null
  outcome.value = null
  applied.value = null
  readError.value = ''
  applyError.value = ''
  applyErrorCode.value = ''
}
</script>

<style scoped lang="scss">
.import-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.import-live {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.import-pick,
.import-review {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.import-step-title {
  font-size: var(--font-xs);
  font-weight: 700;
  color: var(--text-muted);
}

.import-hint {
  font-size: var(--font-xs);
  color: var(--text-sub);
}

/* ---- 拒绝态 ---- */
.import-reject {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--danger-soft);
  border-left: 3px solid var(--danger-color);
  border-radius: var(--radius-sm);
}

.import-reject-text {
  font-size: var(--font-sm);
  font-weight: 700;
  color: var(--danger-text);
}

.import-reject-note {
  font-size: var(--font-xs);
  color: var(--text-sub);
}

/* ---- 无变化 ---- */
.import-noop {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--info-soft);
  border-left: 3px solid var(--info-color);
  border-radius: var(--radius-sm);
}

.import-noop-text {
  font-size: var(--font-sm);
  font-weight: 700;
  color: var(--info-text);
}

.import-noop-note {
  font-size: var(--font-xs);
  color: var(--text-sub);
}

/* ---- 可导入 / 已导入 ---- */
.import-ready {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.import-stats {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.import-stat {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px dashed var(--border-light);
  font-size: var(--font-sm);

  &:last-child {
    border-bottom: none;
  }
}

.import-stat-label {
  color: var(--text-sub);
}

.import-stat-value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-main);
}

.import-done-note {
  font-size: var(--font-xs);
  font-weight: 600;
  color: var(--success-text);
}

/* ---- 导入期警告（A6-L1）---- */
.import-warning {
  padding: var(--space-3);
  background: var(--warning-soft);
  border-left: 3px solid var(--warning-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-xs);
  color: var(--warning-text);
}

/* ---- 错误块（读文件失败 / 执行失败共用）---- */
.import-error {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--danger-soft);
  border-left: 3px solid var(--danger-color);
  border-radius: var(--radius-sm);
}

.import-error-title {
  font-size: var(--font-sm);
  font-weight: 700;
  color: var(--danger-text);
}

.import-error-hint {
  font-size: var(--font-xs);
  color: var(--text-sub);
}

.import-error-text {
  margin: var(--space-1) 0 0;
  font-size: var(--font-2xs);
  color: var(--text-sub);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 详情折叠：默认收起，需要排障时再展开（原生 details，无额外依赖、键盘可达） */
.import-detail {
  font-size: var(--font-xs);
  color: var(--text-sub);

  summary {
    cursor: pointer;
    font-weight: 600;
  }
}

/* ---- 操作区 ---- */
.import-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-top: var(--space-2);
}
</style>
