import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { getProfile, getToken } from '@/services/portal'

/**
 * 路由表（契约第 8 节：全部路由 + 懒加载，页面阶段不改路由）
 *
 * 8 个页面全部注册为懒加载占位；meta.title 供面包屑与 document.title，
 * meta.group 为菜单分组名（工作台/基础数据/运输调度/应付运费/电子签章/演示）。
 */

const APP_TITLE = 'DEEP WAY 智能运输管理平台'

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
      {
        path: 'accounts',
        name: 'accounts',
        component: () => import('@/views/system/accounts/index.vue'),
        meta: { title: '账号管理', group: '系统管理' },
      },
      {
        path: 'roles',
        name: 'roles',
        component: () => import('@/views/system/roles/index.vue'),
        meta: { title: '角色管理', group: '系统管理' },
      },
    ],
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/portal/Login.vue'),
    meta: { title: '登录' },
  },
  { path: '/portal/login', redirect: '/login' },
  {
    path: '/portal/carrier',
    component: () => import('@/layouts/BasicLayout.vue'),
    redirect: '/portal/carrier/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'portal-carrier-dashboard',
        component: () => import('@/views/portal/carrier/Dashboard.vue'),
        meta: { title: '工作台', group: '工作台' },
      },
      {
        path: 'tasks',
        name: 'portal-carrier-tasks',
        component: () => import('@/views/portal/carrier/Tasks.vue'),
        meta: { title: '运输任务', group: '运输协同' },
      },
      {
        path: 'tasks/:id',
        name: 'portal-carrier-task-detail',
        component: () => import('@/views/portal/carrier/TaskDetail.vue'),
        meta: { title: '任务详情', group: '运输协同' },
      },
      {
        path: 'drivers',
        name: 'portal-carrier-drivers',
        component: () => import('@/views/portal/carrier/Drivers.vue'),
        meta: { title: '司机管理', group: '运输协同' },
      },
      {
        path: 'messages',
        name: 'portal-carrier-messages',
        component: () => import('@/views/portal/carrier/Messages.vue'),
        meta: { title: '消息中心', group: '运输协同' },
      },
    ],
  },
  { path: '/portal/driver', redirect: '/m/tasks' },
  {
    path: '/portal/driver/:pathMatch(.*)*',
    redirect: (to) => {
      const raw = to.params.pathMatch
      const rest = Array.isArray(raw) ? raw.join('/') : raw || 'tasks'
      return `/m/${rest}`
    },
  },
  {
    path: '/m/login',
    name: 'mini-login',
    component: () => import('@/views/portal/MiniLogin.vue'),
    meta: { title: '司机登录' },
  },
  {
    path: '/m',
    component: () => import('@/layouts/DriverLayout.vue'),
    redirect: '/m/tasks',
    children: [
      {
        path: 'tasks',
        name: 'portal-driver-tasks',
        component: () => import('@/views/portal/driver/Tasks.vue'),
        meta: { title: '我的任务' },
      },
      {
        path: 'tasks/:id',
        name: 'portal-driver-task-detail',
        component: () => import('@/views/portal/driver/TaskDetail.vue'),
        meta: { title: '任务详情' },
      },
      {
        path: 'messages',
        name: 'portal-driver-messages',
        component: () => import('@/views/portal/driver/Messages.vue'),
        meta: { title: '消息' },
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

function homeOf(type: string) {
  if (type === 'DRIVER') return '/m/tasks'
  if (type === 'CARRIER') return '/portal/carrier/dashboard'
  return '/dashboard'
}

/** 未登录去登录页。平台管理员看运营菜单，承运商看协同菜单，司机只能进小程序。 */
router.beforeEach((to) => {
  const token = getToken()
  const profile = getProfile()
  const loggedIn = Boolean(token && profile)

  if (to.path === '/login') {
    if (loggedIn && profile && profile.type !== 'DRIVER') return homeOf(profile.type)
    return true
  }
  if (to.path === '/m/login') {
    if (loggedIn && profile?.type === 'DRIVER') return '/m/tasks'
    return true
  }
  if (to.path.startsWith('/m')) {
    if (!loggedIn || profile?.type !== 'DRIVER') return '/m/login'
    return true
  }
  if (!loggedIn || !profile) return '/login'
  if (profile.type === 'DRIVER') return '/m/tasks'
  if (profile.type === 'CARRIER' && !to.path.startsWith('/portal/carrier')) {
    return '/portal/carrier/dashboard'
  }
  if (profile.type === 'ADMIN' && to.path.startsWith('/portal')) return '/dashboard'
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${APP_TITLE}` : APP_TITLE
})

export default router
