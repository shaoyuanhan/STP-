import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

/**
 * 路由表（契约第 8 节：全部路由 + 懒加载，页面阶段不改路由）
 *
 * 8 个页面全部注册为懒加载占位；meta.title 供面包屑与 document.title，
 * meta.group 为菜单分组名（工作台/基础数据/运输调度/应付运费/电子签章/演示）。
 */

const APP_TITLE = 'STP 智能运输管理平台'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/BasicLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/dashboard/index.vue'),
        meta: { title: '工作台', group: '工作台' },
      },
      {
        path: 'carriers',
        name: 'carriers',
        component: () => import('@/views/base/carriers/index.vue'),
        meta: { title: '承运商管理', group: '基础数据' },
      },
      {
        path: 'drivers',
        name: 'drivers',
        component: () => import('@/views/base/drivers/index.vue'),
        meta: { title: '司机管理', group: '基础数据' },
      },
      {
        path: 'tasks',
        name: 'tasks',
        component: () => import('@/views/dispatch/tasks/index.vue'),
        meta: { title: '发运任务', group: '运输调度' },
      },
      // 旧「全国态势 / 历史轨迹」入口统一并入运输监控，保留链接兼容
      { path: 'tracking/overview', redirect: '/tracking' },
      { path: 'tracking/history', redirect: '/tracking?scope=history' },
      {
        path: 'tracking',
        name: 'tracking',
        component: () => import('@/views/dispatch/tracking/index.vue'),
        meta: { title: '运输监控', group: '运输调度' },
      },
      {
        path: 'freight',
        name: 'freight',
        component: () => import('@/views/settlement/freight/index.vue'),
        meta: { title: '结算管理', group: '应付运费' },
      },
      {
        path: 'esigns',
        name: 'esigns',
        component: () => import('@/views/signatures/esigns/index.vue'),
        meta: { title: '电子签台账', group: '电子签章' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${APP_TITLE}` : APP_TITLE
})

export default router
