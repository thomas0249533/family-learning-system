<template>
  <!-- V2.7 · 轨道 A1：左菜单 + 右内容
       ------------------------------------------------------------------
       刻意用「滚动定位 + 滚动高亮」而不是「Tab 切换只渲染一个面板」：
         · 设置页有 8 个分区、且部分卡片是自治组件（LocalAiCard / SyncSettings /
           ImportPreview），Tab 切换会把它们反复卸载重建（同步状态、预检结果全丢）；
         · `#family-backup` 这类深链锚点是既有契约（B4「导出并删除旧档案」靠它），
           只渲染一个面板时锚点经常指向 display:none 的元素，滚动必然失败；
         · 所有内容始终在 DOM 里 → e2e 的可见性定位与浏览器 Ctrl+F 都照旧。
       窄屏把左栏降级为顶部横向可滑的分区条（见样式层 @media）。 -->
  <div class="page-container">
    <nav class="settings-nav" aria-label="设置分区">
      <button
        v-for="s in SECTIONS"
        :key="s.key"
        type="button"
        class="nav-item"
        :class="{ active: activeSection === s.key }"
        :aria-current="activeSection === s.key ? 'true' : undefined"
        @click="goSection(s.key)"
      >
        <span class="nav-icon" aria-hidden="true">{{ s.icon }}</span>
        <span class="nav-label">{{ s.label }}</span>
      </button>
    </nav>

    <div ref="contentRef" class="settings-content">
    <section id="settings-appearance" class="settings-panel" data-section="appearance">
    <!-- 外观设置 -->
    <AppCard title="🎨 外观设置" class="card">
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

          <!-- 推荐提示条（文本统一为 AppBadge 软色 pill，§5.1） -->
          <div class="preset-advice">
            <template v-if="themeStore.presetManual">
              <AppBadge tone="neutral" size="sm" icon="🔒">已手动选择，不再自动推荐</AppBadge>
              <AppButton size="tiny" quaternary type="primary" @click="handleRestoreAuto">恢复自动</AppButton>
            </template>
            <template v-else-if="recommended.grade !== null">
              <AppBadge tone="warning" size="sm" icon="💡">
                检测到孩子 {{ recommended.grade }} 年级，推荐「{{ presetName(recommended.preset) }}」主题
              </AppBadge>
              <AppButton size="tiny" quaternary type="primary" @click="applyRecommended">一键切换</AppButton>
            </template>
            <template v-else>
              <AppBadge tone="info" size="sm" icon="📥">导入学习包后，将按孩子年级自动推荐主题</AppBadge>
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

        <!-- 自定义主题色（V2.1 附加）：取代写死的"淡紫"预设，让用户自选强调色 -->
        <div>
          <h4 class="setting-label">自定义主题色</h4>
          <div class="accent-row">
            <button
              v-for="a in ACCENT_PRESETS"
              :key="a.hex"
              type="button"
              class="accent-swatch"
              :class="{ selected: themeStore.customAccent?.toLowerCase() === a.hex.toLowerCase() }"
              :style="{ background: a.hex }"
              :aria-label="a.name"
              :title="a.name"
              @click="themeStore.setCustomAccent(a.hex)"
            ></button>
            <label class="accent-picker" title="自定义颜色">
              <input type="color" :value="themeStore.customAccent ?? accentFallback" @input="onAccentPick" />
              <span>自定义</span>
            </label>
          </div>
          <div class="accent-actions">
            <AppButton
              v-if="themeStore.accentActive"
              size="tiny"
              quaternary
              type="primary"
              @click="themeStore.setCustomAccent(null)"
            >恢复默认（关闭自定义色）</AppButton>
            <span v-else class="hint">未启用自定义色，使用当前学段主题色</span>
          </div>
        </div>
      </n-space>
    </AppCard>
    </section>

    <section id="settings-feedback" class="settings-panel" data-section="feedback">
    <!-- V2.11 · 声音与反馈：答题即时反馈的总开关。
         「音效」是仓库内 Web Audio 实时合成（零音频文件），关掉即整个静音；
         「震动」在桌面端（Windows WebView2）没有 Vibration API，恒为静默——
         文案必须如实说明，不能让家长以为开了却没生效。 -->
    <AppCard title="🔊 声音与反馈" class="card">
      <n-space vertical size="large">
        <div class="feedback-row">
          <div class="feedback-text">
            <h4 class="setting-label">答题音效</h4>
            <p class="feedback-desc">答对「叮」、答错「嗡」、按钮「哒」。现场合成，不占安装包。</p>
          </div>
          <n-switch :value="feedbackPrefs.sound" @update:value="onSoundChange" />
        </div>
        <div class="feedback-row">
          <div class="feedback-text">
            <h4 class="setting-label">震动反馈</h4>
            <p class="feedback-desc">{{ hapticsDesc }}</p>
          </div>
          <n-switch :value="feedbackPrefs.haptics" @update:value="onHapticsChange" />
        </div>
      </n-space>
    </AppCard>
    </section>

    <section id="settings-ai" class="settings-panel" data-section="ai">
    <!-- AI 助手设置（V1.11 · F1）
         Key 的存储策略（详见 src/core/ai/aiConfig.ts 顶部）：
         **默认只在本次使用中有效、不落盘**；勾了「记住」才用家长口令
         （PBKDF2 → AES-GCM）加密后落本机，**口令本身绝不保存**。
         不是系统 Keychain 的原因：本仓 Tauri 侧没有 keychain 插件，需要新增
         Rust 插件 + 重新打包，已单开任务。这里不做"假加密"。 -->
    <AppCard title="🤖 AI 助手设置" class="card">
      <n-space vertical size="large">
        <div>
          <h4 class="setting-label">API Key</h4>
          <n-input
            v-model:value="aiApiKey"
            type="password"
            show-password-on="click"
            placeholder="粘贴 DeepSeek 的 API Key（sk-…）"
            @blur="applyApiKey"
          />
          <div class="hint">
            默认只在本次使用中有效，关闭页面后自动失效，不会明文保存在本机。
          </div>
        </div>

        <div>
          <h4 class="setting-label">模型名</h4>
          <n-input v-model:value="aiModel" placeholder="deepseek-chat" @blur="saveAiModel" />
        </div>

        <div>
          <h4 class="setting-label">本地模型（Ollama）</h4>
          <n-input v-model:value="aiOllamaModel" placeholder="qwen2.5:7b-instruct" @blur="saveAiModel" />
          <div class="hint">
            云端不可用时会自动改用本机的 Ollama（需要它已在本机 11434 端口启动）。
          </div>
        </div>

        <div>
          <n-checkbox v-model:checked="aiRemember">
            记住我的 Key（用家长口令加密后保存在本机）
          </n-checkbox>
          <template v-if="aiRemember">
            <div class="ai-pass-row">
              <n-input
                v-model:value="aiPassphrase"
                type="password"
                show-password-on="click"
                placeholder="家长口令（只用来加密，不会被保存）"
              />
              <AppButton size="small" type="primary" :disabled="!aiApiKey || !aiPassphrase" @click="doRemember">
                加密保存
              </AppButton>
            </div>
            <div class="hint">换设备、清缓存或忘了口令，就只能重新填一次 Key。</div>
          </template>
        </div>

        <div v-if="aiHasSaved" class="ai-pass-row">
          <span class="hint">本机已保存过一个加密的 Key。</span>
          <AppButton size="small" :disabled="!aiPassphrase" @click="doUnlock">用口令解锁</AppButton>
          <AppButton size="small" type="error" ghost @click="doForget">忘记它</AppButton>
        </div>
      </n-space>
    </AppCard>

    <!-- 本地离线 AI（V2.0 · A2）：自包含卡片，Settings 只负责摆位置 -->
    <LocalAiCard />
    </section>

    <section id="settings-packages" class="settings-panel" data-section="packages">
    <!-- 学习包管理 -->
    <AppCard title="📦 学习包管理" class="card">
      <n-space vertical>
        <AppButton type="primary" block size="large" @click="$router.push('/settings/import')">
          📥 导入新的学习包
        </AppButton>
      </n-space>
    </AppCard>

    </section>

    <section id="settings-export" class="settings-panel" data-section="export">
    <!-- 导出 -->
    <!-- id="family-backup" 是 B4 的落地锚点：「导出并删除旧档案」按钮会带着它跳过来，
         指向的正是家长唯一能"把数据先存下来"的那一行（见下方 scrollToHash） -->
    <AppCard id="family-backup" title="📤 导出" class="card">
      <n-space vertical>
        <div class="export-row">
          <div class="export-info">
            <div class="export-title">导出错题本</div>
            <div class="export-desc">所有错题，含题目、解析、错误次数</div>
          </div>
          <AppButton @click="doExportMistakes">导出</AppButton>
        </div>

        <div class="export-row">
          <div class="export-info">
            <div class="export-title">导出全部包</div>
            <div class="export-desc">所有学习包 JSON</div>
          </div>
          <AppButton @click="doExportPackages">导出</AppButton>
        </div>

        <div class="export-row">
          <div class="export-info">
            <div class="export-title">家庭备份</div>
            <div class="export-desc">全部档案的进度、错题、模考、成就与设置</div>
          </div>
          <AppButton type="primary" @click="doExportFamilyBackup">导出</AppButton>
        </div>
      </n-space>
    </AppCard>

    </section>

    <section id="settings-backup" class="settings-panel" data-section="backup">
    <!-- 从备份导入（两步向导：先预览，确认后才写入） -->
    <AppCard title="📥 从备份导入" class="card">
      <ImportPreview />
      <div class="hint">来自另一台设备的备份可以合并进来；本机已有的较新记录不会被覆盖</div>
    </AppCard>

    </section>

    <section id="settings-sync" class="settings-panel" data-section="sync">
    <!-- 同步（WebDAV · V1.11 · F2-UI）：独立组件，避免与上面的 AI 卡片改动纠缠 -->
    <SyncSettings />
    </section>

    <section id="settings-search" class="settings-panel" data-section="search">
    <!-- 搜索历史 -->
    <AppCard title="🔍 搜索历史" class="card">
      <EmptyState v-if="searchHistory.length === 0" size="small" description="暂无搜索历史" />
      <template v-else>
        <div class="history-list">
          <n-tag v-for="(kw, i) in searchHistory" :key="i" closable size="medium" @close="removeHistory(i)">
            {{ kw }}
          </n-tag>
        </div>
        <AppButton size="small" style="margin-top: 12px;" @click="clearHistory">清空搜索历史</AppButton>
      </template>
    </AppCard>

    </section>

    <section id="settings-danger" class="settings-panel" data-section="danger">
    <!-- 危险操作 -->
    <AppCard title="🗑️ 危险操作" class="card" variant="danger">
      <n-space vertical>
        <AppButton type="error" ghost @click="doClearMistakes">清空所有错题</AppButton>
        <AppButton type="error" ghost @click="doClearProgress">清空学习进度</AppButton>
        <AppButton type="error" ghost @click="clearAllData">清空所有数据（含包）</AppButton>
      </n-space>
    </AppCard>
    </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import {
  NSpace, NRadioGroup, NRadioButton, NTag, NInput, NCheckbox,
  useMessage, useDialog
} from 'naive-ui'
import AppCard from '@/components/ui/AppCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ImportPreview from '@/views/settings/ImportPreview.vue'
import SyncSettings from '@/views/settings/SyncSettings.vue'
import LocalAiCard from '@/views/settings/LocalAiCard.vue'
import { useThemeStore } from '@core/stores/theme'
// V2.11 · 音效/震动开关：内存镜像 + 落库，答题反馈走同步路径读镜像
import {
  isHapticsSupported,
  loadFeedbackPreferences,
  saveFeedbackPreferences,
  syncFeedbackEngine,
  type FeedbackPreferences,
} from '@core/feedback'
import { palette } from '@core/styles/palette'
import { currentProfileId } from '@core/profile/currentProfile'
import { usePackageStore } from '@core/stores/package'
import { db } from '@/db'
import {
  exportMistakes, exportBackupV2, exportAllPackages,
} from '@/core/export/exportService'
import type { ThemePreset } from '@core/styles/palette'
import type { GradeSource } from '@core/theme/presetInference'
import { inferPreset } from '@core/theme/presetInference'
import { PRESET_META, presetPreview } from '@core/theme/presetPreview'
import { ACCENT_PRESETS } from '@core/theme/accent'
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_OLLAMA_MODEL,
  forgetRememberedKey,
  hasRememberedKey,
  loadAiConfig,
  rememberApiKey,
  saveAiConfig,
  setSessionApiKey,
  unlockRememberedKey,
} from '@core/ai/aiConfig'

const themeStore = useThemeStore()
const packageStore = usePackageStore()
const message = useMessage()
const dialog = useDialog()
const route = useRoute()

/* ===========================================================================
 * V2.7 · 轨道 A1 · 左侧分区菜单
 * ---------------------------------------------------------------------------
 * 只有"定位"与"高亮"两件事，**不做面板切换**：
 * 每个 `<section class="settings-panel" data-section="…">` 始终在 DOM 里，
 * 点菜单 = scrollIntoView，滚动 = 反算当前分区。理由写在模板顶部注释里。
 * ======================================================================== */
interface SettingsSection {
  key: string
  icon: string
  label: string
}

/** 分区表：顺序必须与模板里的 section 顺序一致（滚动高亮依赖这个顺序） */
const SECTIONS: SettingsSection[] = [
  { key: 'appearance', icon: '🎨', label: '外观设置' },
  { key: 'feedback', icon: '🔊', label: '声音与反馈' },
  { key: 'ai', icon: '🤖', label: 'AI 助手' },
  { key: 'packages', icon: '📦', label: '学习包' },
  { key: 'export', icon: '📤', label: '导出' },
  { key: 'backup', icon: '📥', label: '备份导入' },
  { key: 'sync', icon: '🔄', label: '同步' },
  { key: 'search', icon: '🔍', label: '搜索历史' },
  { key: 'danger', icon: '🗑️', label: '危险操作' },
]

const activeSection = ref<string>(SECTIONS[0].key)
const contentRef = ref<HTMLElement | null>(null)

/* ---------- V2.11 · 声音与反馈 ---------- */

const feedbackPrefs = ref<FeedbackPreferences>({ sound: true, haptics: true })

/** 桌面端没有 Vibration API。文案必须如实说明，否则家长会以为「开了却没生效」。 */
const hapticsSupported = isHapticsSupported()
const hapticsDesc = computed(() =>
  hapticsSupported
    ? '答对轻震一下，答错长短交替三下。手机、平板上更明显。'
    : '当前设备（电脑）不支持震动，此开关只在手机、平板上生效。',
)

async function onSoundChange(v: boolean): Promise<void> {
  feedbackPrefs.value = { ...feedbackPrefs.value, sound: v }
  await saveFeedbackPreferences({ sound: v })
  syncFeedbackEngine()
}

async function onHapticsChange(v: boolean): Promise<void> {
  feedbackPrefs.value = { ...feedbackPrefs.value, haptics: v }
  await saveFeedbackPreferences({ haptics: v })
}

/** 当前页面的全部分区面板（DOM 即真相，避免再维护一份 ref 数组） */
function panelEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.settings-panel[data-section]'))
}

function goSection(key: string): void {
  const el = panelEls().find((p) => p.dataset.section === key)
  if (!el) return
  activeSection.value = key
  lockSpy()
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * 找最近的"可纵向滚动的祖先"。
 *
 * 本项目的页面滚动容器是 `AppShell` 里的 `.app-main`（不是 window），
 * 所以既不能用 window 的 scroll 事件，也不能用 `window.scrollY`。
 * 找不到时退化为 window（例如未来改成整页滚动）。
 */
function nearestScrollParent(el: HTMLElement | null): HTMLElement | Window {
  let node = el?.parentElement ?? null
  while (node) {
    const cs = getComputedStyle(node)
    if (/(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 8) return node
    node = node.parentElement
  }
  return window
}

let scrollHost: HTMLElement | Window | null = null

/** 阈值 = 粘性菜单的高度再多一点：标题刚好被菜单压住时就算"进入该分区" */
const SECTION_PROBE_OFFSET = 96

/**
 * 程序化滚动的静默期。
 *
 * `scrollIntoView({behavior:'smooth'})` 会连续触发几十次 scroll 事件，
 * 而滚动中"顶部那个分区"是**路径上经过的分区**——于是点「危险操作」会先高亮
 * 「同步」「搜索历史」，最后停在半路。这里在点击后短暂停用反算，
 * 让"点了哪个就亮哪个"，动画结束（700ms 足够覆盖 smooth 滚动）再交还给滚动高亮。
 */
let spyLockUntil = 0

function lockSpy(): void {
  spyLockUntil = Date.now() + 700
}

function onScroll(): void {
  if (Date.now() < spyLockUntil) return
  const panels = panelEls()
  if (panels.length === 0) return

  // 触底：最后一个分区可能永远到不了顶部（它下面没有内容了），
  // 此时"顶部是谁"这个口径会长期停在倒数第二个，直接判定为最后一个。
  const hostEl = scrollHost instanceof HTMLElement ? scrollHost : null
  const atBottom = hostEl
    ? hostEl.scrollTop + hostEl.clientHeight >= hostEl.scrollHeight - 2
    : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2

  if (atBottom) {
    const last = panels[panels.length - 1].dataset.section
    if (last && last !== activeSection.value) activeSection.value = last
    return
  }

  let current = panels[0].dataset.section ?? SECTIONS[0].key
  for (const p of panels) {
    if (p.getBoundingClientRect().top <= SECTION_PROBE_OFFSET) {
      current = p.dataset.section ?? current
    } else {
      break
    }
  }
  if (current !== activeSection.value) activeSection.value = current
}

/** 取色器在「未启用自定义色」时的初始值：取当前学段预设的真实品牌色（避免硬编码 hex 被 check:hex 抓住） */
const accentFallback = computed(() => palette.presets[themeStore.preset][themeStore.actualTheme].primary)

/**
 * 把 `/settings#family-backup` 落到「家庭备份」那一行上（B4）。
 *
 * 本项目的 router **没有配 `scrollBehavior`**，所以 hash 只是地址栏好看、页面纹丝不动。
 * 而「导出并删除旧档案」这个按钮的全部价值就是"把人送到能导出的地方"——
 * 跳过去却停在页面顶部，家长还得自己滚着找，等于没做。
 *
 * 用 `scrollIntoView` 而不是 `window.scrollTo`：页面滚动容器可能是 `AppShell`
 * 里那个可滚动的 div 而不是 `window`，`scrollIntoView` 会自己找最近的可滚动祖先。
 */
async function scrollToHash(): Promise<void> {
  const hash = route.hash
  if (!hash) return
  await nextTick()
  const el = document.getElementById(hash.slice(1))
  if (!el) return
  // 落点所在分区同步高亮，否则左侧菜单会停在「外观设置」上，看着像没跳成功
  const panel = el.closest<HTMLElement>('.settings-panel[data-section]')
  if (panel?.dataset.section) activeSection.value = panel.dataset.section
  lockSpy()
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const searchHistory = ref<string[]>([])

/* ===========================================================================
 * F1 · AI 助手设置
 * ---------------------------------------------------------------------------
 * 三个按钮各自的语义必须清楚，混在一起会让家长不知道自己按了什么：
 *   - 填 Key（失焦即生效）→ **只进内存**，本次会话可用，关页即失效；
 *   - 加密保存          → 家长口令派生密钥，只落密文 + salt + iv；
 *   - 用口令解锁        → 解出来后**同样只进内存**（不因为"存过"就常驻明文）。
 *
 * 为什么口令框只在这张卡里出现、且从不写库：`secretCipher.ts` 顶部写得很清楚——
 * 密文和钥匙放在同一个抽屉里就是假加密，宁可不落盘，也不做假加密。
 * ======================================================================== */

const aiApiKey = ref('')
const aiModel = ref(DEFAULT_DEEPSEEK_MODEL)
const aiOllamaModel = ref(DEFAULT_OLLAMA_MODEL)
const aiRemember = ref(false)
const aiPassphrase = ref('')
const aiHasSaved = ref(false)

async function refreshAiState(): Promise<void> {
  const cfg = await loadAiConfig()
  aiModel.value = cfg.model
  aiOllamaModel.value = cfg.ollamaModel
  aiRemember.value = cfg.remember
  aiHasSaved.value = hasRememberedKey(cfg)
}

/** 填了 Key 就立刻在本次会话生效（**不落盘**） */
function applyApiKey(): void {
  const key = aiApiKey.value.trim()
  if (!key) return
  setSessionApiKey(key)
  message.success('Key 已在本机本次使用中生效（关闭页面后失效）')
}

async function saveAiModel(): Promise<void> {
  const cfg = await saveAiConfig({
    model: aiModel.value.trim() || DEFAULT_DEEPSEEK_MODEL,
    ollamaModel: aiOllamaModel.value.trim() || DEFAULT_OLLAMA_MODEL,
  })
  aiModel.value = cfg.model
  aiOllamaModel.value = cfg.ollamaModel
}

async function doRemember(): Promise<void> {
  try {
    await rememberApiKey(aiApiKey.value.trim(), aiPassphrase.value)
    aiPassphrase.value = ''
    await refreshAiState()
    message.success('已用家长口令加密保存，本次也已生效')
  } catch (e) {
    message.error('保存失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function doUnlock(): Promise<void> {
  try {
    await unlockRememberedKey(aiPassphrase.value)
    aiPassphrase.value = ''
    message.success('已解锁，AI 讲评可以在本次使用中运行了')
  } catch {
    // 口令错 / 密文损坏在 WebCrypto 层是同一个表现（认证标签校验失败），
    // 不细分——细分等于告诉攻击者"口令对了但密文坏了"。
    message.error('口令不对，或者保存的 Key 已损坏')
  }
}

async function doForget(): Promise<void> {
  await forgetRememberedKey()
  await refreshAiState()
  message.success('已忘记保存的 Key')
}

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

/** V2.1 · 取色器实时套用自定义强调色（仅作品牌主色相覆盖，不碰学段/明暗/字号） */
function onAccentPick(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  themeStore.setCustomAccent(v)
}

onMounted(async () => {
  const raw = localStorage.getItem('searchHistory')
  if (raw) { try { searchHistory.value = JSON.parse(raw) } catch {} }

  // 载入学习包后按年级自动推断（仅当未手动选择时生效）
  await packageStore.loadPackages()
  themeStore.reconcilePreset(gradeSources())

  // 带 anchor 进来时（「导出并删除旧档案」）滚到对应区块
  await scrollToHash()

  await refreshAiState()

  // V2.11：载入音效/震动偏好并同步给音频引擎（此后答题反馈走内存镜像，同步读）
  feedbackPrefs.value = await loadFeedbackPreferences()
  syncFeedbackEngine()

  // 左栏滚动高亮：监听见 AppShell 的滚动容器（找不到时退化为 window）
  scrollHost = nearestScrollParent(contentRef.value)
  scrollHost.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onUnmounted(() => {
  scrollHost?.removeEventListener('scroll', onScroll)
  scrollHost = null
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

async function doExportPackages() {
  const n = await exportAllPackages()
  n > 0 ? message.success(`已导出 ${n} 个包`) : message.warning('没有可导出的包')
}

/**
 * 家庭备份（v2）：一次导出**全部档案**的进度、错题、模考、成就与设置。
 *
 * 调 `exportBackupV2()`（唯一导出入口）：v2 备份不含学习包
 * （包是设备级资产，要另外用「导出全部包」搬）。
 */
async function doExportFamilyBackup() {
  try {
    const r = await exportBackupV2()
    if (r.profiles === 0) {
      message.warning('没有可导出的档案数据')
      return
    }
    message.success(`已导出家庭备份：${r.profiles} 个档案、${r.progress} 条进度`)
  } catch (e) {
    // 不吞异常：下载失败时用户必须知道"没有文件生成"
    message.error('导出失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function doClearMistakes() {
  dialog.warning({
    title: '确认清空错题？', content: '此操作不可恢复',
    positiveText: '清空', negativeText: '取消',
    onPositiveClick: async () => {
      // V1.4 · B1：只清**当前档案**的错题。`clear()` 会把另一个孩子的错题一起删掉，
      // 而且没有任何提示能让人发现这件事。
      await db.mistakes.where('profileId').equals(currentProfileId()).delete()
      message.success('已清空错题')
    },
  })
}

function doClearProgress() {
  dialog.warning({
    title: '确认清空进度？', content: '此操作不可恢复',
    positiveText: '清空', negativeText: '取消',
    onPositiveClick: async () => {
      // 同上：只清当前档案
      await db.progress.where('profileId').equals(currentProfileId()).delete()
      message.success('已清空进度')
    },
  })
}

function clearAllData() {
  dialog.error({
    title: '⚠️ 清空所有数据',
    content: '将删除所有学习包、进度、错题、设置。此操作不可恢复！',
    positiveText: '我确定', negativeText: '取消',
    onPositiveClick: async () => {
      // profile-scope-ok: 「清空所有数据」的语义就是整库重置（含学习包与档案列表本身），跨档案删除是需求
      await Promise.all([db.packages.clear(), db.progress.clear(), db.mistakes.clear(), db.settings.clear()])
      message.success('已清空所有数据')
    },
  })
}
</script>

<style scoped lang="scss">
/* V2.7 · 轨道 A1：左菜单（粘性）+ 右内容。
   窄屏（≤900px）降级为顶部横向分区条，滚动容器不换 —— 只换排列方向。 */
.page-container {
  padding: 16px;
  display: flex;
  align-items: flex-start;
  gap: 20px;

  @media (max-width: 900px) {
    flex-direction: column;
    gap: 12px;
    padding: 12px;
  }
}

.settings-nav {
  position: sticky;
  /* 顶到滚动容器上沿留 8px 呼吸（AppShell 的 main 自带 padding，这里只做兜底） */
  top: 8px;
  flex: 0 0 170px;
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px;
  background: $card-bg;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  box-shadow: $shadow-sm;

  @media (max-width: 900px) {
    flex: none;
    width: 100%;
    flex-direction: row;
    overflow-x: auto;
    gap: 6px;
    padding: 6px;
    z-index: 5;
    scrollbar-width: none;

    &::-webkit-scrollbar { display: none; }
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    border: 0;
    border-radius: $radius-md;
    background: transparent;
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    color: $text-sub;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    transition: background $duration-fast $ease-standard, color $duration-fast $ease-standard;

    &:hover {
      background: $bg-color-hover;
      color: $text-main;
    }

    &.active {
      background: $primary-light;
      color: $primary-text;
    }

    &:focus-visible {
      outline: 2px solid $primary-color;
      outline-offset: 2px;
    }

    .nav-icon {
      font-size: 15px;
      line-height: 1;
      flex-shrink: 0;
    }

    @media (max-width: 900px) {
      padding: 7px 12px;
      font-size: 12.5px;
    }
  }
}

.settings-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 每个分区：内部卡片仍是竖排 + 16px 间距（与改造前完全一致） */
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* 点菜单定位时给粘性条留出空间，避免标题被压住 */
  scroll-margin-top: 76px;
}

/* `.card` 的圆角/阴影已由 AppCard 基元统一提供（radius-lg + shadow-sm）；危险卡走 variant="danger"。 */
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
    background: var(--primary-text);
    color: var(--text-on-primary);
    font-size: 12px;
    font-weight: 800;
  }
}

/* 提示条：文本已交由 AppBadge 承载（§5.1），本容器只保留排布。 */
.preset-advice {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
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

/* V2.11 · 声音与反馈行：左文右开关 */
.feedback-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.feedback-text { min-width: 0; }
.feedback-row .setting-label { margin-bottom: 4px; }
.feedback-desc {
  font-size: 12px;
  color: $text-sub;
  line-height: 1.5;
  margin: 0;
}
.history-list { display: flex; flex-wrap: wrap; gap: 8px; }

/* F1 · AI 助手设置：口令输入 + 动作按钮一行（窄屏自动换行） */
.ai-pass-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

/* ========== V2.1 · 自定义主题色 ========== */
.accent-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.accent-swatch {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid $border-color;
  padding: 0;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;

  &:hover { transform: scale(1.08); }
  &.selected {
    border-color: var(--primary-text);
    box-shadow: 0 0 0 2px var(--primary-light);
  }
}

.accent-picker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: $text-sub;
  cursor: pointer;

  input[type='color'] {
    width: 32px;
    height: 32px;
    padding: 0;
    border: 2px solid $border-color;
    border-radius: 50%;
    background: none;
    cursor: pointer;
  }
}

.accent-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
</style>
