<template>
  <div class="custom-pack-panel">
    <!-- ==================== A · 导入（两步：选文件 → 导入前确认）==================== -->
    <!--
      为什么分两步：家长写的（或从别处拷来的）一份 JSON 里可能有 10 处错误。
      一步到底的"选文件即入库"会让家长在完全不知道会发生什么的情况下改到孩子的成就页。
      第一步只读文件、只算不写；第二步把"会新增什么 / 会和谁撞"摊开，才允许落地。
    -->
    <div class="cp-import">
      <p class="cp-hint">
        选一份成就包文件（.json），先看看它会带来什么 —— 这一步不会改动任何数据。
      </p>
      <n-upload :custom-request="handleSelect" :show-file-list="false" accept=".json">
        <AppButton type="primary" dashed :loading="reading" :disabled="reading">
          {{ parsedPack === null ? '选择成就包文件（.json）' : '换一份文件' }}
        </AppButton>
      </n-upload>
    </div>

    <!--
      常驻的 live region：错误区与导入前确认区**都在它内部切换**。
      若把 aria-live 挂在"有结果时才插入"的容器上，节点本身是新插入的，
      读屏器未必播报（更常见的是整段静默）。
    -->
    <div class="cp-live" aria-live="polite" aria-atomic="true">
      <!-- ---------- 三态之一：不能导入（JSON 语法错 / 结构校验失败 / 确认导入失败）---------- -->
      <div v-if="problem !== null" class="cp-errors" role="alert">
        <div class="cp-errors-title">{{ errorTitle }}</div>
        <ul class="cp-errors-list">
          <li v-for="(row, i) in issueRows" :key="i" class="cp-error">
            <span v-if="row.where !== ''" class="cp-error-where">{{ row.where }}</span>
            <span class="cp-error-msg">{{ row.message }}</span>
            <!-- 原始报错折叠起来：家长不需要看，排障时不能没有 -->
            <details v-if="row.detail !== ''" class="cp-detail">
              <summary>详情</summary>
              <pre class="cp-error-raw">{{ row.detail }}</pre>
            </details>
          </li>
        </ul>
        <div class="cp-errors-note">
          本机数据没有做任何改动。改好文件后重新选择一次即可。
        </div>
      </div>

      <!-- ---------- 三态之二 / 之三：可以导入（含"有冲突"这一分支）---------- -->
      <div v-else-if="preview !== null" class="cp-preview">
        <div class="cp-preview-head">
          <AppBadge
            :tone="hasConflicts ? 'warning' : 'success'"
            size="sm"
            :icon="hasConflicts ? '⚠️' : '📋'"
          >
            {{ hasConflicts ? '有冲突，先改文件' : '导入前确认' }}
          </AppBadge>
          <!--
            计数用 `provided`（= 净新增 + 保留）：升版时只讲"净新增"会显示「将新增 0 枚」，
            读起来像"这次什么都没做"；只讲"新增"又会把保留的卡说成新卡。
            两个数分开，家长才知道"有几枚是这次真的新加的"。
          -->
          <span class="cp-preview-count">
            <template v-if="preview.replaces !== null">这一版共 {{ preview.provided }} 枚</template>
            <template v-else>将新增 {{ preview.provided }} 枚</template>
          </span>
        </div>

        <p v-if="preview.replaces !== null && preview.retained > 0" class="cp-retained-note">
          其中 {{ preview.retained }} 枚这个包里已经有了，另外 {{ preview.added.length }} 枚是新加的
        </p>

        <ul v-if="preview.added.length > 0" class="cp-added-list">
          <li v-for="added in preview.added" :key="added.id" class="cp-added">
            <span class="cp-added-icon" aria-hidden="true">{{ iconFor(added.id, added.category) }}</span>
            <span class="cp-added-title">{{ added.title }}</span>
            <!-- 可重复（V1.5）：这是家长唯一能在导入**之前**看到它的地方。
                 导入后再发现，图鉴上已经多了枚会一直计次数的卡。 -->
            <AppBadge v-if="added.repeat === 'weekly'" tone="info" size="sm" icon="🔁">
              每周可重复
            </AppBadge>
            <span class="cp-added-category">{{ categoryLabel(added.category) }}</span>
          </li>
        </ul>
        <!-- 没有净新增时的三种情形，说清各是哪一种（别一律说"都已经有了"：
             升版场景下卡片会被更新，只是没有新的） -->
        <div v-else class="cp-added-empty">
          <template v-if="preview.retained > 0">
            这个包的成就本机都已装过，导入会把它们更新到新版本。
          </template>
          <template v-else-if="hasConflicts">
            这份包没有可以新增的成就，先解决下面的冲突。
          </template>
          <template v-else>
            这份包里的成就本机都已经有了，导入后不会多出新卡片。
          </template>
        </div>

        <!-- 同名包 → 升版替换（旧版本留在标记里，可以回滚回来） -->
        <p v-if="preview.replaces !== null" class="cp-replaces">
          这个包已存在（v{{ preview.replaces.fromVersion }}），导入会升版，可回滚到当前版本
        </p>

        <!-- 冲突：逐条说清和谁撞了。冲突未解时「确认导入」置灰（按钮留着，
             而不是消失 —— 消失会让人以为面板坏了或没读到文件） -->
        <div v-if="hasConflicts" class="cp-conflicts">
          <div class="cp-conflicts-title">
            这 {{ preview.conflicts.length }} 枚的编号和别处撞了，改好再导入
          </div>
          <ul class="cp-conflicts-list">
            <li
              v-for="(conflict, i) in preview.conflicts"
              :key="`${conflict.kind}-${conflict.id}-${i}`"
              class="cp-conflict"
            >
              <span class="cp-conflict-title">
                <span aria-hidden="true">{{ iconFor(conflict.id, null) }}</span>
                {{ conflict.title }}
              </span>
              <span class="cp-conflict-text">{{ conflictText(conflict) }}</span>
            </li>
          </ul>
        </div>

        <!-- parseCustomPack 的 warnings：不阻断导入，但要让孩子家长知道 -->
        <ul v-if="warnings.length > 0" class="cp-warn-list">
          <li v-for="(w, i) in warnings" :key="i" class="cp-warn">{{ w.message }}</li>
        </ul>

        <div class="cp-preview-actions">
          <AppButton
            class="cp-confirm"
            type="primary"
            :loading="importing"
            :disabled="importing || hasConflicts"
            @click="confirmImport"
          >
            {{ importing ? '正在导入' : '确认导入' }}
          </AppButton>
          <AppButton :disabled="importing" @click="resetImport">取消</AppButton>
        </div>
        <p v-if="hasConflicts" class="cp-confirm-blocked">
          有冲突时不能导入 —— 同一个编号出现两次，孩子的成就页会不知道该显示哪一枚。
        </p>
      </div>
    </div>

    <!-- ==================== B · 已导入的包 ==================== -->
    <div class="cp-packs">
      <div class="cp-section-title">已导入的包</div>

      <!-- 空态引导：这里就是家长第一次进来的落地页，不要只留一片空白 -->
      <EmptyState
        v-if="loaded && state.packs.length === 0"
        icon="🧩"
        description="导入一份 achievements.json，就能给孩子加上你们自己定的成就。"
      />

      <ul v-else-if="state.packs.length > 0" class="cp-list">
        <li v-for="pack in state.packs" :key="pack.packId" class="cp-row">
          <!-- 第一行：包信息 + 操作（原来 `.cp-row` 是横向 flex，现在让出下方给打勾区） -->
          <div class="cp-row-head">
            <div class="cp-row-main">
              <span class="cp-row-name">{{ displayName(pack) }}</span>
              <span class="cp-row-version">v{{ pack.version }}</span>
              <AppBadge
                :tone="pack.enabled ? 'success' : 'neutral'"
                size="sm"
                :icon="pack.enabled ? '✅' : '⏸️'"
              >
                {{ pack.enabled ? '已启用' : '已停用' }}
              </AppBadge>
              <span class="cp-row-count">{{ pack.pack.achievements.length }} 枚</span>
              <!-- 已经装上的包里有多少枚会重复计数：停用/启用的判断依据之一 -->
              <span v-if="repeatableCount(pack) > 0" class="cp-row-repeat">
                {{ repeatableCount(pack) }} 枚每周可重复
              </span>
            </div>
            <div class="cp-row-actions">
              <AppButton
                size="small"
                :loading="isPending(pack.packId, 'toggle')"
                :disabled="anyPending"
                @click="togglePack(pack)"
              >
                {{ pack.enabled ? '停用' : '启用' }}
              </AppButton>
              <!-- 没有上一版时按钮置灰并给出原因（用 span 承载 title：
                   原生 disabled 的按钮在很多浏览器里不派发悬停事件，title 常常看不到） -->
              <span
                class="cp-rollback-wrap"
                :title="pack.previous === null ? '没有可回滚的版本' : ''"
              >
                <AppButton
                  size="small"
                  :loading="isPending(pack.packId, 'rollback')"
                  :disabled="anyPending || pack.previous === null"
                  :title="pack.previous === null ? '没有可回滚的版本' : ''"
                  @click="rollbackPackTo(pack)"
                >
                  回滚
                </AppButton>
              </span>
            </div>
          </div>

          <!--
            第二块：手工成就的"打勾"区（AC-P2-1 的唯一入口）。
            只列 `manual-check`：`counter` 是靠数据算出来的，给它画复选框等于告诉家长
            "你可以自己判定进度"，那是另一种（错误的）语义。
            停用的包**照样可以打勾**（勾选记录保留，见 AC-P2-3），只是不影响图鉴，所以旁边标一句。
          -->
          <ul v-if="manualItems(pack).length > 0" class="cp-checks">
            <li v-for="a in manualItems(pack)" :key="a.id" class="cp-check-item">
              <label class="cp-check-label">
                <input
                  class="cp-check-toggle"
                  type="checkbox"
                  :checked="isChecked(pack.packId, a.id)"
                  :disabled="anyPending"
                  @change="onToggleCheck(pack, a, ($event.target as HTMLInputElement).checked)"
                />
                <span class="cp-check-title">{{ a.title }}</span>
              </label>
              <!-- 验收提示就是家长判断"勾不勾"的依据，必须在旁边（不然打勾全凭印象） -->
              <span class="cp-check-prompt">{{ a.rule.prompt }}</span>
              <span v-if="isChecked(pack.packId, a.id)" class="cp-check-hint cp-check-hint--on">
                已勾选
              </span>
              <span v-if="!pack.enabled" class="cp-check-hint">包已停用，勾选不影响图鉴</span>
            </li>
          </ul>
          <p v-else class="cp-check-empty">这个包里的成就是按数据自动算的，不用手打勾。</p>

          <!-- 勾选写库失败：就地贴在**这一行**下面。
               不放顶部 `.cp-errors`：那块是"导入这条链路"的状态，而且它一出现会把
               正在看的导入前确认顶掉，一个复选框的失败不值得毁掉整块预览。 -->
          <div
            v-if="checkError !== null && checkError.packId === pack.packId"
            class="cp-check-error"
            role="alert"
          >
            <div class="cp-check-error-title">{{ checkError.message }}</div>
            <p class="cp-check-error-note">孩子的图鉴没有变化，可以再点一次试试。</p>
            <details class="cp-detail">
              <summary>详情</summary>
              <pre class="cp-error-raw">{{ checkError.detail }}</pre>
            </details>
          </div>
        </li>
      </ul>
    </div>

    <!-- ==================== C · 操作记录（只读，不可清空）==================== -->
    <!--
      为什么没有"清空"按钮：审计的价值全在"事后能查"。一键清空之后它就只是个装饰。
      折叠在 <details> 里：家长平时不看，但出事时能找到。
    -->
    <details class="cp-audit">
      <summary class="cp-audit-summary">操作记录（最近 {{ auditRows.length }} 条）</summary>
      <div v-if="auditRows.length === 0" class="cp-audit-empty">还没有操作记录</div>
      <ul v-else class="cp-audit-list">
        <li v-for="(entry, i) in auditRows" :key="`${entry.at}-${i}`" class="cp-audit-row">
          <span class="cp-audit-time">{{ formatAt(entry.at) }}</span>
          <span class="cp-audit-sep" aria-hidden="true">·</span>
          <span class="cp-audit-action">{{ actionLabel(entry.action) }}</span>
          <span class="cp-audit-sep" aria-hidden="true">·</span>
          <span class="cp-audit-pack">{{ entry.packId }}</span>
          <span class="cp-audit-sep" aria-hidden="true">·</span>
          <span class="cp-audit-affected">影响 {{ entry.affected }} 枚</span>
          <span v-if="entry.detail" class="cp-audit-detail">{{ entry.detail }}</span>
        </li>
      </ul>
    </details>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// CustomPackPanel · 自定义成就包的家长端管理面板（V1.4 · B3 / PRD P0-1、§8.4）
// ---------------------------------------------------------------------
// ## 为什么这个面板必须"预览先行"
// 导入一份包会直接改变孩子成就页上出现什么。家长几乎没有试错成本意识：
// 一旦点下去就写库，撞了 id 的包会被静默覆盖，孩子攒的解锁记录也说不清哪来的。
// 所以流程刻意做成与备份导入同构的两步：**选文件只读、确认才写**。
//
// ## 为什么每个操作之后都重新 loadPackState()
// core 层落库时会补 `version` / `importedAt` / `enabledAt` / `previous` 快照，
// 这些都是 UI 猜不出来的。若在本地"就地改对象"，界面显示的版本号和库里真实状态
// 会在第二次操作后分叉 —— 而回滚的正确性完全依赖版本号。宁可多读一次库。
//
// ## 三态渲染（只在模板的一个 if 链里判）
//   ① problem 非空  → `.cp-errors`：JSON 语法错 / 结构校验失败 / 确认导入失败
//   ② preview 非空且 conflicts 为空 → `.cp-preview`：可导入（"确认导入"可用）
//   ③ preview 非空且 conflicts 非空 → 同一块 `.cp-preview`，但确认按钮禁用并列出冲突
// 判序只写一遍：分开写两处 if 必然分叉，而这套判序错的方向恰好是"把不能导入说成能导入"。
//
// ## 文案约定
// 面向家长，不出现 schema / diff / payload 这类词；`PackIssue.code` 只给测试和排障用，
// **绝不进正文**（家长看不懂 E_ID_PREFIX，只会觉得是自己弄坏了什么）。
// =====================================================================
import { computed, onMounted, ref, shallowRef } from 'vue'
import { NUpload, useMessage, type UploadCustomRequestOptions } from 'naive-ui'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { ACHIEVEMENTS } from '@core/motivation/achievements'
import { CATEGORY_META } from '@core/motivation/achievementMeta'
import { parseCustomPack, previewCustomPack } from '@core/motivation/customPack'
import {
  disablePack,
  enablePack,
  importPack,
  loadChecks,
  loadPackState,
  readAudit,
  rollbackPack,
  setCheck,
} from '@core/motivation/customPackStore'
import { useAchievementStore } from '@core/stores/achievement'
import { checkKey } from '@core/motivation/customPackTypes'
import type {
  AuditAction,
  AuditEntry,
  CustomAchievement,
  CustomCategory,
  CustomCheckState,
  CustomPack,
  CustomPackState,
  PackConflict,
  PackIssue,
  PackPreview,
  StoredPack,
} from '@core/motivation/customPackTypes'

const message = useMessage()
const achievementStore = useAchievementStore()

/** 内置 28 枚的 id：判"与内置撞 id"的唯一依据（模块级算一次，不在渲染期反复 map） */
const BUILTIN_IDS: readonly string[] = ACHIEVEMENTS.map((a) => a.id)

/** 审计日志只展示最近多少条（多了没人看，还会把页面撑长） */
const AUDIT_LIMIT = 20

// ---------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------

/**
 * 出错的三条路径，**分开记**是因为给家长的标题不同：
 * 文件读不出来（换文件）/ 结构有错（改文件）/ 写库失败（重试）。
 * 三种情况说同一句"导入失败"会让家长做错下一步。
 */
type Problem =
  | { kind: 'json'; message: string; detail: string }
  | { kind: 'validate'; issues: PackIssue[] }
  | { kind: 'apply'; message: string; detail: string }

const state = ref<CustomPackState>({ packs: [] })
const audit = ref<AuditEntry[]>([])
/** 首次 loadPackState 完成（区分"空"与"还没读完"，避免空态闪一下） */
const loaded = ref(false)

/** 正在读文件 + 校验 + 预览 */
const reading = ref(false)
/** 正在写库（确认导入） */
const importing = ref(false)
/** 正在跑某个包的行内操作：`${packId}:${action}`。空串 = 没有操作在跑 */
const pendingKey = ref('')

const problem = shallowRef<Problem | null>(null)
const preview = shallowRef<PackPreview | null>(null)
/**
 * 通过校验的包体（`parseCustomPack` 的归一化产物）。
 * 只用于两件事：① 预览行里取每枚的图标；② 判断按钮文案"选文件 / 换一份"。
 * 真正写库那份是 `rawPayload`（原始 parse 结果）—— 二者不要混用。
 */
const parsedPack = shallowRef<CustomPack | null>(null)
/** 原始 `JSON.parse` 结果；确认导入时原样交给 `importPack`（落库口自己再校验一遍） */
let rawPayload: unknown = null

/**
 * `parseCustomPack` 的 warnings：**不阻断**导入，但要让家长看到。
 * 与 `problem` 分开存：错误区一旦出现就说明"这次不能导"，混进去会把两件事说成一件。
 */
const warnings = ref<PackIssue[]>([])

/** 有冲突 → 禁用「确认导入」 */
const hasConflicts = computed<boolean>(
  () => (preview.value?.conflicts.length ?? 0) > 0,
)

const anyPending = computed<boolean>(() => pendingKey.value !== '')

/**
 * 当前档案的手工勾选态（键为 `packId::achievementId`）。
 *
 * 包清单是**全局**的（家里的资产），勾选是**按档案**的 —— 这正是两者分开存的原因，
 * 面板这里也必须分两次读，不能因为"都是包相关的数据"就当成一个东西。
 */
const checks = ref<CustomCheckState>({})
/**
 * 最近一次"打勾没保存上"。
 * 就地挂在对应包行下面，而不是塞进顶部 `.cp-errors`：那块是导入链路的状态，
 * 一出现就会把正在看的导入前确认顶掉 —— 一个复选框写失败不值得毁掉整块预览。
 */
const checkError = shallowRef<{ packId: string; message: string; detail: string } | null>(null)

// ---------------------------------------------------------------------
// 文案 / 格式化
// ---------------------------------------------------------------------

/** 每条问题的展示行：位置说人话，正文只给 message（code 不外露） */
interface IssueRow {
  where: string
  message: string
  detail: string
}

/** 字段名 → 家长看得懂的位置说法 */
const FIELD_LABELS: Record<string, string> = {
  packId: '包标识',
  name: '包名',
  schemaVersion: '版本号',
  achievements: '成就列表',
  id: '编号',
  icon: '图标',
  title: '标题',
  desc: '描述',
  category: '类别',
  source: '来源',
  tier: '稀有度',
  metered: '进度',
  target: '目标',
  unit: '量词',
  noun: '名词',
  rule: '规则',
  kind: '规则类型',
  prompt: '验收提示',
  metric: '统计指标',
}

/**
 * 把 `achievements[1].rule.kind` 变成「第 2 枚 · 规则类型」。
 *
 * 不直接印英文路径：家长看不懂 `achievements[1].rule.kind`，只会在反复尝试中放弃。
 * 认不出的字段原样保留（宁可露出一个英文词，也不要显示错误的位置把人带偏）。
 */
function humanizeIssuePath(path: string): string {
  if (path === '' || path === '$') return ''
  const rest = path.startsWith('$') ? path.slice(1) : path
  const parts: string[] = []
  const re = /\.([A-Za-z_$][\w$]*)|\[(\d+)\]/g
  let match: RegExpExecArray | null = re.exec(rest)
  let prevKey = ''
  while (match !== null) {
    if (match[1] !== undefined) {
      prevKey = match[1]
      // `achievements` 后面紧跟下标时省掉它：「第 2 枚」比「成就列表 · 第 2 枚」利落
      const nextIsIndex = /^\[\d+\]/.test(rest.slice(match.index + match[0].length))
      if (!(prevKey === 'achievements' && nextIsIndex)) {
        parts.push(FIELD_LABELS[prevKey] ?? prevKey)
      }
    } else if (match[2] !== undefined) {
      parts.push(`第 ${Number(match[2]) + 1} 枚`)
    }
    match = re.exec(rest)
  }
  return parts.join(' · ')
}

const issueRows = computed<IssueRow[]>(() => {
  const p = problem.value
  if (p === null) return []
  if (p.kind === 'validate') {
    return p.issues.map((issue) => ({
      where: humanizeIssuePath(issue.path),
      message: issue.message,
      detail: '',
    }))
  }
  return [{ where: '', message: p.message, detail: p.detail }]
})

const errorTitle = computed<string>(() => {
  const p = problem.value
  if (p === null) return ''
  if (p.kind === 'json') return '这份文件读不出来'
  if (p.kind === 'apply') return '没能导入，本机数据未改动'
  return `这份文件有 ${p.issues.length} 处需要改`
})

/** 预览行里的图标：优先取包内自己写的 emoji，其次退回类别图标 */
function iconFor(id: string, category: CustomCategory | null): string {
  const own = parsedPack.value?.achievements.find((a) => a.id === id)
  if (own !== undefined) return own.icon
  if (category !== null) return CATEGORY_META[category].icon
  return '🧩'
}

function categoryLabel(category: CustomCategory): string {
  return CATEGORY_META[category].label
}

/** 冲突说人话：和谁撞了，比他撞了什么类型更重要 */
function conflictText(conflict: PackConflict): string {
  if (conflict.kind === 'custom') return `id 与已装包「${conflict.with}」重复`
  if (conflict.kind === 'builtin') return '与内置成就 id 冲突'
  return '包内 id 重复'
}

const ACTION_LABELS: Record<AuditAction, string> = {
  import: '导入',
  enable: '启用',
  disable: '停用',
  rollback: '回滚',
}

function actionLabel(action: AuditAction): string {
  return ACTION_LABELS[action] ?? action
}

/** `2026-02-03T09:05:00.000Z` → `02-03 09:05`（本地时区，家长看的是本地时间） */
function formatAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 最近 20 条（按时间倒序，与 core 的返回顺序无关地稳定） */
const auditRows = computed<AuditEntry[]>(() => {
  const rows = [...audit.value]
  rows.sort((a, b) => b.at.localeCompare(a.at))
  return rows.slice(0, AUDIT_LIMIT)
})

function displayName(pack: StoredPack): string {
  const name = pack.pack.name
  return name !== undefined && name.trim() !== '' ? name : pack.packId
}

function isPending(packId: string, action: 'toggle' | 'rollback'): boolean {
  return pendingKey.value === `${packId}:${action}`
}

// ---------------------------------------------------------------------
// 打勾（manual-check 成就的唯一入口 · AC-P2-1）
// ---------------------------------------------------------------------

/**
 * `manual-check` 的成就（类型上把 `rule` 收窄到带 `prompt` 的那一支，
 * 模板里就能直接读 `a.rule.prompt`，不用再判一次 kind）。
 */
type ManualAchievement = CustomAchievement & { rule: { kind: 'manual-check'; prompt: string } }

/**
 * 只挑出需要家长手工打勾的成就。
 *
 * **`counter` 一律不出现**：它是按数据算出来的，给它画复选框等于告诉家长
 * "你可以自己判定进度"，那是另一种（且错误的）语义 —— 孩子做题没到位也不该能勾上。
 */
function manualItems(pack: StoredPack): ManualAchievement[] {
  return pack.pack.achievements.filter(
    (a): a is ManualAchievement => a.rule.kind === 'manual-check',
  )
}

/** 勾选键统一走 `checkKey`，不在这里手拼字符串（拼错了就是"勾了但不算"） */
function isChecked(packId: string, achievementId: string): boolean {
  return checks.value[checkKey(packId, achievementId)] !== undefined
}

/**
 * 这个包里有多少枚会**每周重复计数**（V1.5）。
 *
 * 面板上只说"共 N 枚"会漏掉这个属性：家长看到图鉴上「第 3 次」时，
 * 最需要能回头确认是哪张卡在重复，以及是不是自己写的。
 */
function repeatableCount(pack: StoredPack): number {
  return pack.pack.achievements.filter((a) => a.repeat !== undefined).length
}

// ---------------------------------------------------------------------
// 数据刷新
// ---------------------------------------------------------------------

/**
 * 重读包清单、审计日志、本档案的勾选态。
 *
 * 所有会改库的操作**结束后都必须调它**：版本号 / 启用态 / 回滚快照 / 勾选都是 core 算的，
 * UI 自己"猜"出来的值迟早会跟库里不一致。
 */
async function refresh(): Promise<void> {
  try {
    const [nextState, nextAudit, nextChecks] = await Promise.all([
      loadPackState(),
      readAudit(),
      loadChecks(),
    ])
    state.value = nextState
    audit.value = nextAudit
    checks.value = nextChecks
  } catch (e) {
    message.error('读取成就包失败：' + describeError(e))
  } finally {
    loaded.value = true
  }
  // 包清单 / 勾选变了 → "孩子现在该看到哪些卡"也变了（停用要消失、勾上要亮起）。
  // 不 await：重算不影响本面板的任何数字，失败也不该挡住家长继续操作。
  settleInBackground()
}

/**
 * 后台重算一次成就（`settle` 自带单飞，重复调用共享同一个 promise）。
 * 失败只提示，不抛：`settle` 出错时图鉴停在上一轮的状态，下次进页面会自动纠正。
 */
function settleInBackground(): void {
  achievementStore.settle().catch((e: unknown) => {
    message.warning('成就重算失败，稍后重新进入页面会自动恢复：' + describeError(e))
  })
}

// ---------------------------------------------------------------------
// A · 导入
// ---------------------------------------------------------------------

/** 异常 → 一句可展示的原文（不吞异常） */
function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** `JSON.parse` 的报错是英文技术文案，包一层让家长知道"是文件内容的问题" */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (e) {
    throw new Error(describeError(e))
  }
}

/** 清掉上一份文件的全部结果（避免旧预览串到新文件上） */
function resetImport(): void {
  problem.value = null
  preview.value = null
  parsedPack.value = null
  warnings.value = []
  rawPayload = null
}

/**
 * 第一步：读文件 → 校验 → 算出"会新增什么"（**只算不写**）。
 *
 * `parseCustomPack` 的 `ok:false` 与"文件根本不是 JSON"走的是两条展示路径，
 * 但对家长都是"这份文件现在不能导入"，所以都落进同一个 `.cp-errors` 区块。
 */
async function handleSelect(options: UploadCustomRequestOptions): Promise<void> {
  resetImport()
  reading.value = true
  try {
    const file = options.file.file
    if (!file) throw new Error('没有读到文件内容，请重新选择一次')
    const text = await file.text()

    let raw: unknown
    try {
      raw = parseJson(text)
    } catch (e) {
      problem.value = {
        kind: 'json',
        message: '文件内容不是合法的 JSON',
        detail: describeError(e),
      }
      message.error('文件内容不是合法的 JSON')
      return
    }

    const result = parseCustomPack(raw, {
      builtinIds: BUILTIN_IDS,
      existingPacks: state.value.packs,
    })
    if (!result.ok) {
      problem.value = { kind: 'validate', issues: result.errors }
      return
    }

    // 校验过了才算"这份文件是可用的"—— 后面预览与确认都以它为准
    rawPayload = raw
    parsedPack.value = result.pack
    warnings.value = result.warnings
    preview.value = previewCustomPack(result.pack, {
      builtinIds: BUILTIN_IDS,
      existingPacks: state.value.packs,
    })
  } catch (e) {
    problem.value = {
      kind: 'json',
      message: '这份文件读不出来',
      detail: describeError(e),
    }
    message.error('读取文件失败')
  } finally {
    reading.value = false
    // 通知 n-upload 本次请求已结束：否则再次选**同一个文件**不会触发 custom-request
    options.onFinish()
  }
}

/** 第二步：唯一会写库的一步（写入全在 core 的单次调用里） */
async function confirmImport(): Promise<void> {
  if (importing.value || hasConflicts.value || rawPayload === null) return
  importing.value = true
  try {
    const result = await importPack(rawPayload)
    if (!result.ok) {
      problem.value = { kind: 'validate', issues: result.errors }
      parsedPack.value = null
      preview.value = null
      warnings.value = []
      rawPayload = null
      message.error('没能导入，本机数据未改动')
      return
    }
    // 成功提示按总量讲：`added` 是净新增，纯升版时它是 0 ——
    // 弹「已导入 0 枚」会让人以为白点了，而实际整包已被替换成新版本。
    if (result.preview.replaces !== null) {
      message.success(`已更新本包，共 ${result.preview.provided} 枚`)
    } else {
      message.success(`已导入 ${result.preview.provided} 枚，去成就页看看`)
    }
    resetImport()
    await refresh()
  } catch (e) {
    problem.value = {
      kind: 'apply',
      message: '导入时出错了，本机数据未改动',
      detail: describeError(e),
    }
    message.error('导入失败，未改动任何数据')
  } finally {
    importing.value = false
  }
}

// ---------------------------------------------------------------------
// B · 启用 / 停用 / 回滚
// ---------------------------------------------------------------------

async function togglePack(pack: StoredPack): Promise<void> {
  if (anyPending.value) return
  pendingKey.value = `${pack.packId}:toggle`
  const name = displayName(pack)
  try {
    if (pack.enabled) {
      await disablePack(pack.packId)
      message.success(`已停用「${name}」，解锁记录保留`)
    } else {
      await enablePack(pack.packId)
      message.success(`已启用「${name}」，孩子现在能看到这几枚成就`)
    }
  } catch (e) {
    message.error('操作失败：' + describeError(e))
  } finally {
    pendingKey.value = ''
    await refresh()
  }
}

/**
 * 回滚到上一版。
 *
 * 文案必须自己说清"解锁记录还在"：家长最担心的就是回滚把孩子已经拿到的徽章一起抹掉。
 * 实际行为（设计裁决 D3）是只回退包内容与版本号，`customChecks` 与解锁记录一条不动。
 */
async function rollbackPackTo(pack: StoredPack): Promise<void> {
  if (anyPending.value || pack.previous === null) return
  pendingKey.value = `${pack.packId}:rollback`
  try {
    const { fromVersion, toVersion } = await rollbackPack(pack.packId)
    message.success(`已回滚：v${fromVersion} → v${toVersion}，解锁记录未受影响`)
  } catch (e) {
    message.error('回滚失败：' + describeError(e))
  } finally {
    pendingKey.value = ''
    await refresh()
  }
}

// ---------------------------------------------------------------------
// 打勾：写入 + 立刻重算（勾了就该马上亮）
// ---------------------------------------------------------------------

/**
 * 勾选 / 取消勾选一枚手工成就。
 *
 * 这是**写路径**：`setCheck` 读失败会抛（它要在原对象上增删键，读不到就写等于清空全部勾选）。
 * 所以这里绝不吞异常 —— 吞掉的结果是"界面勾上了、库里没有"，而家长完全不会知道。
 * 失败时还要重读一次：让复选框回到库里的真实位置，而不是停在用户点过的那一格。
 */
async function onToggleCheck(
  pack: StoredPack,
  achievement: ManualAchievement,
  checked: boolean,
): Promise<void> {
  if (anyPending.value) return
  pendingKey.value = `${pack.packId}:check`
  checkError.value = null
  try {
    await setCheck(pack.packId, achievement.id, checked)
    await reloadChecks()
    // 勾了就该立刻亮：settle 会重跑判定，把新解锁的塞进提示队列（由 AppShell 播放）
    settleInBackground()
  } catch (e) {
    checkError.value = {
      packId: pack.packId,
      message: '这次勾选没保存上',
      detail: describeError(e),
    }
    message.error('勾选没保存上，孩子的图鉴没有变化')
    await reloadChecks()
  } finally {
    pendingKey.value = ''
  }
}

/** 只重读勾选态（勾选不改变包清单与审计，别顺带把整块面板刷一遍） */
async function reloadChecks(): Promise<void> {
  try {
    checks.value = await loadChecks() // 不传参 = 当前档案
  } catch (e) {
    message.error('读取勾选状态失败：' + describeError(e))
  }
}

onMounted(async () => {
  await refresh()
})
</script>

<style scoped lang="scss">
.custom-pack-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* ==================== A · 导入 ==================== */
.cp-import {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.cp-hint {
  margin: 0;
  font-size: var(--font-xs);
  line-height: var(--leading-normal);
  color: var(--text-sub);
}

.cp-live {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* ---- 错误块（JSON 语法错 / 结构校验失败 / 写库失败共用）---- */
.cp-errors {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--danger-soft);
  border-left: 3px solid var(--danger-color);
  border-radius: var(--radius-sm);
}

.cp-errors-title {
  font-size: var(--font-sm);
  font-weight: 700;
  color: var(--danger-text);
}

.cp-errors-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.cp-error {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--font-xs);
  line-height: var(--leading-normal);
  color: var(--text-sub);
}

.cp-error-where {
  font-weight: 700;
  color: var(--text-main);
}

.cp-error-msg {
  word-break: break-word;
}

.cp-errors-note {
  font-size: var(--font-xs);
  color: var(--text-sub);
}

/* 详情折叠：默认收起，排障时再展开（原生 details，键盘可达、零依赖） */
.cp-detail {
  font-size: var(--font-2xs);
  color: var(--text-sub);

  summary {
    cursor: pointer;
    font-weight: 600;
  }
}

.cp-error-raw {
  margin: var(--space-1) 0 0;
  font-size: var(--font-2xs);
  color: var(--text-sub);
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---- 导入前确认 ---- */
.cp-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.cp-preview-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.cp-preview-count {
  font-size: var(--font-sm);
  font-weight: 800;
  color: var(--text-main);
  font-variant-numeric: tabular-nums;
}

.cp-added-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.cp-added {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-2);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  font-size: var(--font-sm);
}

.cp-added-icon {
  flex-shrink: 0;
  line-height: 1;
}

.cp-added-title {
  flex: 1;
  min-width: 0;
  font-weight: 700;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cp-added-category {
  flex-shrink: 0;
  font-size: var(--font-2xs);
  font-weight: 600;
  color: var(--text-muted);
}

.cp-added-empty {
  font-size: var(--font-xs);
  color: var(--text-sub);
}

/* 升版补充说明：告诉家长"这几枚不是新加的，是本来就有的" */
.cp-retained-note {
  margin: 0;
  font-size: var(--font-2xs);
  line-height: var(--leading-normal);
  color: var(--text-sub);
}

.cp-replaces {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  font-size: var(--font-xs);
  line-height: var(--leading-normal);
  color: var(--text-sub);
  background: var(--warning-soft);
  border-left: 3px solid var(--warning-color);
  border-radius: var(--radius-sm);
}

/* ---- 冲突 ---- */
.cp-conflicts {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  background: var(--warning-soft);
  border-left: 3px solid var(--warning-color);
  border-radius: var(--radius-sm);
}

.cp-conflicts-title {
  font-size: var(--font-sm);
  font-weight: 700;
  color: var(--warning-text);
}

.cp-conflicts-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.cp-conflict {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--font-xs);
  line-height: var(--leading-normal);
  color: var(--text-sub);
  flex-wrap: wrap;
}

.cp-conflict-title {
  font-weight: 700;
  color: var(--text-main);
}

.cp-conflict-text {
  word-break: break-word;
}

.cp-confirm-blocked {
  margin: 0;
  font-size: var(--font-2xs);
  line-height: var(--leading-normal);
  color: var(--text-sub);
}

/* ---- warnings（不阻断，只是提醒）---- */
.cp-warn-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.cp-warn {
  font-size: var(--font-2xs);
  line-height: var(--leading-normal);
  color: var(--info-text);
}

.cp-preview-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-top: var(--space-1);
}

/* ==================== B · 已导入的包 ==================== */
.cp-packs {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.cp-section-title {
  font-size: var(--font-sm);
  font-weight: 800;
  color: var(--text-main);
}

.cp-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.cp-row {
  display: flex;
  /* 纵向：第一行是包信息 + 操作，第二块是打勾区（占满整行，不挤在按钮边上） */
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-2);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}

.cp-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.cp-row-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  min-width: 0;
}

.cp-row-name {
  font-size: var(--font-base);
  font-weight: 700;
  color: var(--text-main);
  word-break: break-word;
}

.cp-row-version {
  font-size: var(--font-2xs);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.cp-row-count {
  font-size: var(--font-2xs);
  font-weight: 600;
  color: var(--text-muted);
}

/* 可重复徽标的纯文字版（行内紧凑，不抢 AppBadge 的视觉重量） */
.cp-row-repeat {
  font-size: var(--font-2xs);
  font-weight: 600;
  color: var(--info-text);
  white-space: nowrap;
}

.cp-row-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

/* 承载"没有可回滚的版本"的 title：原生 disabled 按钮不派发悬停事件，套一层才有提示 */
.cp-rollback-wrap {
  display: inline-flex;
}

/* ==================== B · 打勾区（manual-check） ==================== */
.cp-checks {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-2) 0 0;
  list-style: none;
  border-top: 1px dashed var(--border-light);
}

.cp-check-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  flex-wrap: wrap;
  font-size: var(--font-sm);
  line-height: var(--leading-normal);
}

.cp-check-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
  font-weight: 700;
  color: var(--text-main);
}

/* 原生复选框：键盘可操作、焦点环由浏览器给，不自己画方框（§6.4） */
.cp-check-toggle {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin: 0;
  cursor: pointer;
  accent-color: var(--primary-color);

  &:disabled {
    cursor: not-allowed;
  }
}

.cp-check-prompt {
  flex: 1;
  min-width: 0;
  font-size: var(--font-2xs);
  color: var(--text-muted);
  word-break: break-word;
}

.cp-check-hint {
  flex-shrink: 0;
  font-size: var(--font-2xs);
  font-weight: 600;
  color: var(--text-muted);
}

.cp-check-hint--on {
  font-weight: 700;
  color: var(--success-text);
}

.cp-check-empty {
  margin: 0;
  padding-top: var(--space-1);
  font-size: var(--font-2xs);
  line-height: var(--leading-normal);
  color: var(--text-muted);
  border-top: 1px dashed var(--border-light);
}

/* 勾选写库失败：就地贴在这一行下面（不用顶部错误区，理由见模板注释） */
.cp-check-error {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  background: var(--danger-soft);
  border-left: 3px solid var(--danger-color);
  border-radius: var(--radius-sm);
}

.cp-check-error-title {
  font-size: var(--font-xs);
  font-weight: 700;
  color: var(--danger-text);
}

.cp-check-error-note {
  margin: 0;
  font-size: var(--font-2xs);
  line-height: var(--leading-normal);
  color: var(--text-sub);
}

/* ==================== C · 操作记录 ==================== */
.cp-audit {
  font-size: var(--font-xs);
  color: var(--text-sub);
  border-top: 1px dashed var(--border-light);
  padding-top: var(--space-2);
}

.cp-audit-summary {
  cursor: pointer;
  font-weight: 700;
  color: var(--text-sub);
}

.cp-audit-empty {
  margin-top: var(--space-2);
  color: var(--text-muted);
}

.cp-audit-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
}

.cp-audit-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  flex-wrap: wrap;
  font-size: var(--font-2xs);
  line-height: var(--leading-normal);
  color: var(--text-sub);
}

.cp-audit-time {
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.cp-audit-sep {
  color: var(--text-muted);
}

.cp-audit-action {
  font-weight: 700;
  color: var(--text-main);
}

.cp-audit-pack {
  word-break: break-word;
}

.cp-audit-detail {
  color: var(--text-muted);
}
</style>
