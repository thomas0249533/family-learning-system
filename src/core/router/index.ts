import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/home' },
  { path: '/home', name: 'Home', component: () => import('@/views/Home.vue') },
  {
    path: '/learn',
    component: () => import('@/views/Learn.vue'),
    children: [
      { path: '', name: 'PackageList', component: () => import('@/views/learn/PackageList.vue') },
      { path: ':packageId', name: 'UnitList', component: () => import('@/views/learn/UnitList.vue') },
      { path: ':packageId/unit/:unitId', name: 'TopicList', component: () => import('@/views/learn/TopicList.vue') },
      { path: ':packageId/unit/:unitId/topic/:topicId', name: 'TopicDetail', component: () => import('@/views/learn/TopicDetail.vue') }
    ]
  },
  { path: '/review', name: 'Review', component: () => import('@/views/Review.vue') },
  { path: '/settings/import', name: 'ImportWizard', component: () => import('@/views/settings/ImportWizard.vue') },
  { path: '/mistakes', name: 'Mistakes', component: () => import('@/views/Mistakes.vue') },
  { path: '/search', name: 'Search', component: () => import('@/views/Search.vue') },
  { path: '/settings', name: 'Settings', component: () => import('@/views/Settings.vue') },
  { path: '/report', name: 'Report', component: () => import('@/views/Report.vue') },
  { path: '/parent', name: 'Parent', component: () => import('@/views/Parent.vue') }
]

// 开发专用：设计系统基元预览页（§7）。
// 仅在 DEV 注册；`import.meta.env.DEV` 在生产构建被替换为 false，
// 三元恒取 else → 分支内动态 import 被 DCE，生产路由与产物均不含本页。
const devRoutes: RouteRecordRaw[] = import.meta.env.DEV
  ? [
      {
        path: '/design-system',
        name: 'DesignSystem',
        component: () => import('@/views/DesignSystem.vue')
      }
    ]
  : []

routes.push(...devRoutes)

export const router = createRouter({
  history: createWebHistory(),
  routes
})