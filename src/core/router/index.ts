import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/home' },
  { path: '/home', name: 'Home', component: () => import('@/views/Home.vue') },
  // 今日任务（V3.0 · M1）：首页的唯一主入口。单独一条路由而不是首页的一个区块，
  // 是因为答题完成后要有个地方"回来"——回首页会让人顺手点别的东西，回今日页才能结算。
  { path: '/today', name: 'TodayPlan', component: () => import('@/views/TodayPlan.vue') },
  // 技能树（V1.12 · G1）。echarts tree 渲染学科 → 单元 → 知识点，lazy import 同其余条目
  { path: '/graph', name: 'KnowledgeGraph', component: () => import('@/views/KnowledgeGraph.vue') },
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
  // P3 · 笔顺描红（降级版：纯 canvas 描红，离线可用，无外部依赖）
  { path: '/stroke', name: 'StrokePractice', component: () => import('@/views/StrokePractice.vue') },
  { path: '/search', name: 'Search', component: () => import('@/views/Search.vue') },
  { path: '/settings', name: 'Settings', component: () => import('@/views/Settings.vue') },
  { path: '/report', name: 'Report', component: () => import('@/views/Report.vue') },
  { path: '/achievements', name: 'Achievements', component: () => import('@/views/Achievements.vue') },
  // 打印件（V1.4 · B5）。独立路由：成就页有筛选/折叠/发现卡，
  // 盖在上面打印等于把一堆交互控件印到纸上。
  {
    path: '/achievements/print',
    name: 'AchievementsPrint',
    component: () => import('@/views/AchievementsPrint.vue')
  },
  { path: '/parent', name: 'Parent', component: () => import('@/views/Parent.vue') },
  // 创作者中心（V2.2 · 轨道 I）。家长端页面：复用 /parent 约定（桌面侧栏入口，
  // 不进孩子底部 tab），无独立角色守卫（项目无 isParent 概念，详见 settingsScope）。
  { path: '/creator', name: 'Creator', component: () => import('@/views/creator/CreatorCenter.vue') },
  // 家庭成就墙（V1.4 · B4）。家长端页面：并排看几个孩子是家长的需求，
  // 孩子端只该看到自己那一墙（孩子之间不比较）。
  { path: '/family-wall', name: 'FamilyWall', component: () => import('@/views/FamilyWall.vue') }
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