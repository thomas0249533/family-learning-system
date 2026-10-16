<template>
  <div class="app-shell">
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
  </div>
</template>

<script setup lang="ts">
// =====================================================================
// AppShell · 布局骨架（侧栏 + 顶栏 + 底部 tab + .app-main + router-view）
// ---------------------------------------------------------------------
// 从 App.vue 原样搬迁（纯搬迁，不改变行为）；App.vue 收敛为组合。
// =====================================================================
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

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
      color: $primary-color;
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

    .today-text {
      display: none;
      font-size: 13px;
      color: $text-sub;
      font-weight: 600;
    }

    .version-badge {
      background: $primary-light;
      color: $primary-color;
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
      color: $primary-color;
      .nav-icon { transform: scale(1.15); }
      .nav-label { font-weight: 700; }
    }
  }
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
