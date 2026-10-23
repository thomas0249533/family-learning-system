<template>
  <div class="app-shell" :class="{ 'is-focus': uiStore.isFocusMode }">
    <aside class="app-sidebar">
      <div class="sidebar-logo">
        <span class="logo-icon">📘</span>
        <div class="logo-text">
          <div class="logo-title">家庭学习系统</div>
          <div class="logo-sub">Family Learning</div>
        </div>
      </div>
      <nav class="sidebar-nav">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="sidebar-item"
        >
          <span class="sidebar-icon">{{ item.icon }}</span>
          <span class="sidebar-label">{{ item.label }}</span>
        </router-link>
      </nav>
      <div class="sidebar-footer">
        <div class="version-badge">V1.9</div>
      </div>
    </aside>

    <div class="app-body">
      <header class="app-header">
        <div class="header-left">
          <button v-if="showBack" class="back-btn" @click="goBack">
            <span class="back-icon">←</span>
            <span class="back-label">返回</span>
          </button>
          <div class="page-title-desktop">{{ pageTitle }}</div>
          <div class="mobile-logo">
            <span class="logo-icon">📘</span>
            <span class="logo-title">家庭学习系统</span>
          </div>
        </div>
        <div class="header-right">
          <!--
            档案切换器（V1.4 · B1）。**只在有 2 个以上档案时出现** ——
            单娃家庭看到它只会困惑"档案是什么"。
            孩子端只允许切换，不允许改名/新建/删除（那些在家长端），
            否则孩子可以把自己换个名字绕过家长判断。
          -->
          <n-dropdown
            v-if="profileList.length > 1"
            trigger="click"
            :options="profileOptions"
            @select="onProfileSelect"
          >
            <button
              class="profile-chip"
              type="button"
              :aria-label="`当前档案：${activeProfile.name}，点击切换`"
            >
              <span class="profile-chip__avatar" aria-hidden="true">{{ activeProfile.name.slice(0, 1) }}</span>
              <span class="profile-chip__name">{{ activeProfile.name }}</span>
            </button>
          </n-dropdown>
          <div class="today-text">{{ todayText }}</div>
          <div class="version-badge">V1.9</div>
        </div>
      </header>

      <main class="app-main">
        <div class="app-main-inner">
          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </div>
      </main>

      <nav class="app-nav">
        <router-link
          v-for="item in mobileNavItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </router-link>
      </nav>
    </div>

    <!-- 成就解锁提示：挂在布局层而不是某个页面里，任何页面解锁都能弹（V1.3 · T03） -->
    <AchievementToast ref="toastRef" />

    <!-- V2.1 · 沉浸式专注模式：右上角悬浮退出按钮（盖过一切布局，Esc / 退出全屏也会退出） -->
    <button
      v-if="uiStore.isFocusMode"
      class="focus-exit-btn"
      type="button"
      aria-label="退出专注模式"
      @click="uiStore.exitFocus()"
    >✕ 退出专注</button>
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// AppShell · 布局骨架（侧栏 + 顶栏 + 底部 tab + .app-main + router-view）
// ---------------------------------------------------------------------
// 从 App.vue 原样搬迁（纯搬迁，不改变行为）；App.vue 收敛为组合。
//
// V1.3 · T03/A-03：成就结算的**唯一后台触发器**放这里 ——
//   监听「进度数组 / 错题数组 / 学习包列表」的变化，去抖后调 achievementStore.settle()。
//   为什么不做在 7 个做题点位：
//     · 那些点位分散在 4 个组件里，任何一处漏掉就会出现"徽章要等回首页才亮"；
//     · 三个信号已经覆盖了全部解锁途径（进度变化 = 答题 / 交卷 / 背单词；
//       错题变化 = 复习 / 攻克；包列表变化 = 导入后 distinctPackages 与掌握率分母变了）；
//     · settle 本身是单飞 + 幂等，多触发几次没有副作用。
//   刻意**不监听路由**（PRD §6.1「不触发」）：切页面本身不产生成就证据，
//   加了只会让"从学习页回到首页"白结算一次。首屏由 onMounted 兜底。
// =====================================================================
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AchievementToast from './AchievementToast.vue'
import { NDropdown } from 'naive-ui'
import { onProfileChange, profilesState, type ProfilesState } from '@core/profile/currentProfile'
import { switchProfileAndReload } from '@core/profile/switchProfileService'
import { useAchievementStore } from '@core/stores/achievement'
import { useUserDataStore } from '@core/stores/userData'
import { usePackageStore } from '@core/stores/package'
import { useUiStore } from '@core/stores/ui'

const route = useRoute()
const router = useRouter()
const uiStore = useUiStore()

// ---------- 档案切换（V1.4 · B1）----------
/**
 * 档案状态是模块级单例（不是 ref），所以用一个本地 ref 跟着 `onProfileChange` 走。
 * 不在模板里直接调 `profilesState()`：那样切换后模板不会重算。
 */
const profileState = ref<ProfilesState>(profilesState())
const profileList = computed(() => profileState.value.list)
const activeProfile = computed(
  () =>
    profileState.value.list.find((p) => p.id === profileState.value.activeId) ??
    profileState.value.list[0]
)

const profileOptions = computed(() => [
  ...profileList.value.map((p) => ({
    key: p.id,
    label: p.id === activeProfile.value.id ? `${p.name}（当前）` : p.name,
    disabled: p.id === activeProfile.value.id,
  })),
  { type: 'divider' as const, key: '__divider' },
  { key: '__manage', label: '管理档案…' },
])

let offProfileChange: (() => void) | null = null

async function onProfileSelect(key: string): Promise<void> {
  if (key === '__manage') {
    router.push('/parent')
    return
  }
  if (key === activeProfile.value.id) return
  await switchProfileAndReload(key)
}

// ---------- 成就结算触发器（V1.3 · T03 / A-03）----------
const achievementStore = useAchievementStore()
const userDataStore = useUserDataStore()
const packageStore = usePackageStore()
const toastRef = ref<InstanceType<typeof AchievementToast> | null>(null)

/** 把 store 攒下的解锁提示交给 toast 依次播放 */
function flushToasts(): void {
  const defs = achievementStore.drainPending()
  if (defs.length > 0) toastRef.value?.enqueue(defs)
}

let settleTimer: ReturnType<typeof setTimeout> | null = null
/** 去抖：一节课连着答 10 题会连续触发，攒 800ms 只结算一次 */
function scheduleSettle(delay = 800): void {
  if (settleTimer !== null) clearTimeout(settleTimer)
  settleTimer = setTimeout(async () => {
    settleTimer = null
    await achievementStore.settle()
    flushToasts()
  }, delay)
}

onMounted(() => {
  // 首屏：数据可能还没加载完（各页面自己在 onMounted 里 load），
  // 这里先结算一次，加载完成后由下面的 watch 再补一次。
  scheduleSettle(0)

  offProfileChange = onProfileChange((next) => {
    profileState.value = next
  })

  // V2.1 · 专注模式：Esc 退出 + 浏览器退出全屏时同步退出（避免"侧栏没了但不在全屏"卡死）
  window.addEventListener('keydown', onFocusKey)
  document.addEventListener('fullscreenchange', onFullscreenChange)
})

onUnmounted(() => {
  if (settleTimer !== null) clearTimeout(settleTimer)
  offProfileChange?.()

  window.removeEventListener('keydown', onFocusKey)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
})

/** Esc 退出专注模式（全屏下的 Esc 由浏览器接管退出全屏，由 fullscreenchange 兜底） */
function onFocusKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && uiStore.isFocusMode) uiStore.exitFocus()
}

/** 用户按浏览器原生 Esc 退出全屏后，专注态一并退出 */
function onFullscreenChange(): void {
  if (!document.fullscreenElement && uiStore.isFocusMode) uiStore.exitFocus()
}

watch(
  () => [
    userDataStore.progress,
    userDataStore.mistakes,
    packageStore.packages.length,
  ],
  () => scheduleSettle(),
)

/** 导航项：mobile=true 时同时出现在底部 tab */
const navItems = [
  { path: '/home', icon: '🏠', label: '首页', mobile: true },
  { path: '/learn', icon: '📚', label: '学习', mobile: true },
  { path: '/mistakes', icon: '📕', label: '错题本', mobile: true },
  { path: '/search', icon: '🔍', label: '搜索', mobile: true },
  { path: '/report', icon: '📄', label: '报告', mobile: true },
  { path: '/parent', icon: '👨‍👩‍👧', label: '家长', mobile: false },
  { path: '/settings', icon: '⚙️', label: '设置', mobile: true },
]

const mobileNavItems = computed(() => navItems.filter((i) => i.mobile))

const backTarget = computed<string | null>(() => {
  const path = route.path
  const topicMatch = path.match(/^\/learn\/([^/]+)\/unit\/([^/]+)\/topic\/[^/]+/)
  if (topicMatch) return `/learn/${topicMatch[1]}/unit/${topicMatch[2]}`
  const unitMatch = path.match(/^\/learn\/([^/]+)\/unit\/[^/]+/)
  if (unitMatch) return `/learn/${unitMatch[1]}`
  const pkgMatch = path.match(/^\/learn\/([^/]+)$/)
  if (pkgMatch) return '/learn'
  if (path.startsWith('/settings/')) return '/settings'
  if (path === '/review') return '/home'
  if (path === '/achievements') return '/home'
  return null
})

const showBack = computed(() => backTarget.value !== null)

function goBack() {
  if (backTarget.value) router.push(backTarget.value)
  else router.back()
}

const pageTitle = computed(() => {
  const path = route.path
  if (path === '/home') return '首页'
  if (path === '/learn') return '学习中心'
  if (path === '/mistakes') return '错题本'
  if (path === '/search') return '搜索'
  if (path === '/report') return '学习报告'
  if (path === '/achievements') return '我的成就'
  if (path === '/review') return '今日复习'
  if (path === '/parent') return '家长视图'
  if (path === '/settings' || path.startsWith('/settings/')) return '设置'
  const topicMatch = path.match(/^\/learn\/([^/]+)\/unit\/([^/]+)\/topic\/([^/]+)/)
  if (topicMatch) return '主题学习'
  const unitMatch = path.match(/^\/learn\/([^/]+)\/unit\/([^/]+)/)
  if (unitMatch) return '单元详情'
  const pkgMatch = path.match(/^\/learn\/([^/]+)$/)
  if (pkgMatch) return '单元列表'
  return ''
})

const todayText = computed(() => {
  const d = new Date()
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getMonth() + 1}月${d.getDate()}日 · 星期${weekdays[d.getDay()]}`
})
</script>

<style lang="scss">
.app-shell {
  display: flex;
  min-height: 100vh;
  background: $bg-color;
}

.app-sidebar {
  display: none;
  width: 240px;
  flex-shrink: 0;
  background: $card-bg;
  border-right: 1px solid $border-color;
  flex-direction: column;
  padding: 24px 16px;
  position: sticky;
  top: 0;
  height: 100vh;

  .sidebar-logo {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 8px 20px;
    border-bottom: 1px solid $border-light;
    margin-bottom: 16px;

    .logo-icon { font-size: 28px; }
    .logo-title {
      font-size: 15px;
      font-weight: 800;
      color: $text-main;
      letter-spacing: 0.3px;
    }
    .logo-sub {
      font-size: 10px;
      color: $text-muted;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-top: 2px;
    }
  }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }

  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 12px;
    text-decoration: none;
    color: $text-sub;
    font-size: 14px;
    font-weight: 600;
    transition: all 0.18s ease;
    position: relative;

    .sidebar-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      font-size: 16px;
      transition: all 0.18s ease;
      background: transparent;
    }
    .sidebar-label { flex: 1; }

    &:hover {
      background: $bg-color-hover;
      color: $text-main;
      transform: translateX(2px);

      .sidebar-icon {
        background: $primary-light;
      }
    }

    &.router-link-active {
      background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.15), rgba(var(--primary-rgb), 0.1));
      color: $primary-text;
      font-weight: 700;

      .sidebar-icon {
        background: var(--primary-text);
        color: var(--text-on-primary);
        box-shadow: 0 2px 8px rgba(var(--primary-rgb), 0.3);
      }
    }
  }

  .sidebar-footer {
    padding-top: 16px;
    border-top: 1px solid $border-light;

    .version-badge {
      display: inline-block;
      background: $bg-color-hover;
      color: $text-sub;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 20px;
    }
  }
}

.app-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 100vh;
}

.app-header {
  height: 60px;
  background: $card-bg;
  border-bottom: 1px solid $border-light;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  position: sticky;
  top: 0;
  z-index: 50;
  flex-shrink: 0;

  .header-left {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
    flex: 1;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;

    /* 档案切换器：小圆头像 + 名字，点击开下拉 */
    .profile-chip {
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: 160px;
      padding: 4px 10px 4px 4px;
      border: 1px solid $border-light;
      border-radius: 999px;
      background: $card-bg;
      color: $text-main;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: background-color 0.15s ease;

      &:hover {
        background: $bg-color-hover;
      }

      &:focus-visible {
        outline: 2px solid var(--primary-text);
        outline-offset: 2px;
      }

      &__avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: $primary-light;
        color: $primary-text;
        font-size: 12px;
        flex-shrink: 0;
      }

      &__name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .today-text {
      display: none;
      font-size: 13px;
      color: $text-sub;
      font-weight: 600;
    }

    .version-badge {
      background: $primary-light;
      color: $primary-text;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 20px;
    }
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    background: transparent;
    border: 1px solid $border-color;
    border-radius: 10px;
    color: $text-main;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
    flex-shrink: 0;

    &:hover {
      background: $bg-color-hover;
      border-color: $text-muted;
    }
    &:active { transform: scale(0.97); }
    .back-icon { font-size: 16px; line-height: 1; }
  }

  .page-title-desktop {
    display: none;
    font-size: 16px;
    font-weight: 700;
    color: $text-main;
    letter-spacing: 0.2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mobile-logo {
    display: flex;
    align-items: center;
    gap: 8px;

    .logo-icon { font-size: 22px; }
    .logo-title {
      font-size: 15px;
      font-weight: 800;
      color: $text-main;
      letter-spacing: 0.3px;
    }
  }
}

.app-main {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 80px;
}

.app-main-inner {
  max-width: 1500px;
  margin: 0 auto;
  padding: 20px 16px;
}

.app-nav {
  display: flex;
  justify-content: space-around;
  background: $card-bg;
  padding: 8px 0 12px;
  border-top: 1px solid $border-light;
  position: fixed;
  bottom: 0;
  width: 100%;
  left: 0;
  z-index: 100;
  box-shadow: $shadow-up;

  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    text-decoration: none;
    color: $text-sub;
    font-size: 11px;
    transition: all 0.2s;
    padding: 4px 8px;
    border-radius: 12px;
    flex: 1;
    max-width: 80px;

    .nav-icon { font-size: 20px; transition: transform 0.2s; }
    .nav-label { font-weight: 600; }

    &.router-link-active {
      color: $primary-text;
      .nav-icon { transform: scale(1.15); }
      .nav-label { font-weight: 700; }
    }
  }
}

  /* ========== V2.1 · 沉浸式专注模式 ========== */
  /* 平滑收起的过渡（尊重 prefers-reduced-motion：reduced 时不声明 transition → 瞬时切换） */
  @media (prefers-reduced-motion: no-preference) {
    .app-sidebar {
      transition: width 0.28s var(--motion-ease, ease), opacity 0.28s ease, transform 0.28s ease;
    }
    .app-header {
      transition: height 0.28s var(--motion-ease, ease), opacity 0.28s ease, transform 0.28s ease;
    }
    .app-nav {
      transition: transform 0.28s var(--motion-ease, ease), opacity 0.28s ease, visibility 0s linear 0.28s;
    }
  }

  /* 进入专注：侧栏 / 顶栏 / 底 tab 收起，练习区满宽并居中 */
  .app-shell.is-focus {
    .app-sidebar {
      width: 0;
      min-width: 0;
      padding: 0;
      overflow: hidden;
      opacity: 0;
      transform: translateX(-12px);
      pointer-events: none;
      border: none;
    }
    .app-header {
      height: 0;
      padding: 0;
      overflow: hidden;
      opacity: 0;
      transform: translateY(-12px);
      pointer-events: none;
      border: none;
    }
    .app-nav {
      transform: translateY(100%);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
    .app-main {
      padding-bottom: 24px;
    }
    .app-main-inner {
      max-width: 820px;
    }
  }

  /* 退出专注悬浮按钮：固定右上角，盖过 header(z:50) / nav(z:100) */
  .focus-exit-btn {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 200;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: none;
    border-radius: 999px;
    background: var(--primary-text);
    color: var(--text-on-primary);
    font-size: 13px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    box-shadow: var(--shadow-md, 0 8px 24px rgba(0, 0, 0, 0.12));
    transition: transform 0.15s ease, opacity 0.15s ease;

    &:hover { transform: translateY(-1px); opacity: 0.94; }
    &:active { transform: scale(0.97); }
    &:focus-visible { outline: 2px solid var(--on-strong); outline-offset: 2px; }
  }

  .fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.fade-leave-to { opacity: 0; }

@media (min-width: 1024px) {
  .app-sidebar { display: flex; }
  .app-nav { display: none; }
  .app-main { padding-bottom: 24px; }
  .app-header { padding: 0 32px; }
  .app-main-inner { max-width: 1600px; padding: 28px 48px; }

  .app-header .mobile-logo { display: none; }
  .app-header .page-title-desktop { display: block; }
  .app-header .header-right .today-text { display: block; }
  .app-header .header-right .version-badge { display: none; }
}

@media (min-width: 768px) and (max-width: 1023px) {
  .app-main-inner { max-width: 800px; }
}
</style>
