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

export const router = createRouter({
  history: createWebHistory(),
  routes
})