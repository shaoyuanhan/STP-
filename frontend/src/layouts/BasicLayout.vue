<script setup lang="ts">
/**
 * 主布局（对齐旧版设计系统）：
 * 200px 深色侧栏（#1c2433，选中 #0e6e64）+ 44px 白色顶栏（面包屑 + 用户）
 * + 多页签栏（可关闭，工作台常驻）+ 内容区（keep-alive 缓存页面状态）。
 */
import { computed, h, onMounted, ref, watch } from 'vue'
import type { Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import { clearSession, fetchMe, updateProfile } from '@/services/portal'

interface PageTab {
  path: string
  title: string
}

const route = useRoute()
const router = useRouter()
const session = useSessionStore()

// ---- 侧栏菜单（分组标题 + 子项，图标为内联 SVG 线性风格） ----
interface MenuLeaf {
  path: string
  title: string
  icon: string
  perm?: string
}
const ADMIN_MENU: Array<{ group: string; items: MenuLeaf[] }> = [
  {
    group: '工作台',
    items: [
      {
        path: '/dashboard',
        title: '工作台',
        perm: 'dashboard:view',
        icon: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
      },
    ],
  },
  {
    group: '基础数据',
    items: [
      {
        path: '/carriers',
        title: '承运商管理',
        perm: 'carriers:view',
        icon: '<path d="M2 6.5h11v9H2z"/><path d="M13 9.5h4.5l3 3v3H13z"/><circle cx="6" cy="18.2" r="1.9"/><circle cx="17" cy="18.2" r="1.9"/>',
      },
      {
        path: '/drivers',
        title: '司机管理',
        perm: 'drivers:view',
        icon: '<circle cx="12" cy="7.5" r="3.4"/><path d="M5 20c0-3.6 3.1-6.3 7-6.3s7 2.7 7 6.3"/>',
      },
    ],
  },
  {
    group: '运输调度',
    items: [
      {
        path: '/tasks',
        title: '发运任务',
        perm: 'tasks:view',
        icon: '<path d="M7 2.5h7l4 4v15H7z"/><path d="M14 2.5v5h5"/><path d="M10 13h5M10 17h5"/>',
      },
      {
        path: '/tracking',
        title: '运输监控',
        perm: 'tracking:view',
        icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.4 3.8 5.5 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.5-3.8-9S9.5 5.4 12 3z"/>',
      },
    ],
  },
  {
    group: '应付运费',
    items: [
      {
        path: '/freight',
        title: '结算管理',
        perm: 'freight:view',
        icon: '<path d="M5 3l4 6.5L13 3"/><path d="M9 9.5V21"/><path d="M6 13.5h6"/><path d="M6 17.5h6"/>',
      },
    ],
  },
  {
    group: '电子签章',
    items: [
      {
        path: '/esigns',
        title: '电子签台账',
        perm: 'esigns:view',
        icon: '<path d="M12.5 20h9"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4.2 1.2L4 16z"/>',
      },
    ],
  },
  {
    group: '系统管理',
    items: [
      {
        path: '/accounts',
        title: '账号管理',
        perm: 'accounts:view',
        icon: '<circle cx="12" cy="8" r="3"/><path d="M5 19c.7-3.2 3.2-5 7-5s6.3 1.8 7 5"/>',
      },
      {
        path: '/roles',
        title: '角色管理',
        perm: 'roles:view',
        icon: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8S14 16 14.5 19"/><path d="M17 8h4M19 6v4"/>',
      },
    ],
  },
]

const CARRIER_MENU: Array<{ group: string; items: MenuLeaf[] }> = [
  {
    group: '工作台',
    items: [
      {
        path: '/portal/carrier/dashboard',
        title: '工作台',
        perm: 'portal.dashboard:view',
        icon: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
      },
    ],
  },
  {
    group: '运输协同',
    items: [
      {
        path: '/portal/carrier/tasks',
        title: '运输任务',
        perm: 'portal.tasks:view',
        icon: '<path d="M7 2.5h7l4 4v15H7z"/><path d="M14 2.5v5h5"/><path d="M10 13h5M10 17h5"/>',
      },
      {
        path: '/portal/carrier/drivers',
        title: '司机管理',
        perm: 'portal.drivers:view',
        icon: '<circle cx="12" cy="7.5" r="3.4"/><path d="M5 20c0-3.6 3.1-6.3 7-6.3s7 2.7 7 6.3"/>',
      },
      {
        path: '/portal/carrier/messages',
        title: '消息中心',
        perm: 'portal.messages:view',
        icon: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 10h8M8 13h5"/>',
      },
    ],
  },
]

const isCarrierAccount = computed(() => String(session.user.role).startsWith('CARRIER'))
const homePath = isCarrierAccount.value ? '/portal/carrier/dashboard' : '/dashboard'

function allowed(item: MenuLeaf, granted?: string[] | null) {
  if (!granted || !item.perm) return true
  return granted.includes(item.perm)
}

const menu = computed(() => {
  const granted = session.permissions
  if (isCarrierAccount.value) {
    return CARRIER_MENU
      .map((section) => ({ ...section, items: section.items.filter((item) => allowed(item, granted)) }))
      .filter((section) => section.items.length)
  }
  const sections = ADMIN_MENU
    .map((section) => ({ ...section, items: section.items.filter((item) => allowed(item, granted)) }))
    .filter((section) => section.items.length)
  const carrierTitles: Record<string, string> = {
    '/portal/carrier/dashboard': '承运商工作台',
    '/portal/carrier/drivers': '承运商司机',
  }
  const carrierItems = CARRIER_MENU
    .flatMap((section) => section.items)
    .filter((item) => granted?.includes(item.perm || ''))
    .map((item) => ({ ...item, title: carrierTitles[item.path] || item.title }))
  if (carrierItems.length) sections.push({ group: '承运商后台', items: carrierItems })
  return sections
})

function renderIcon(svgBody: string) {
  return h('span', {
    class: 'side-menu__icon',
    innerHTML: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${svgBody}</svg>`,
  })
}

const currentTitle = computed(() => (route.meta.title as string) ?? '')
const currentGroup = computed(() => (route.meta.group as string) ?? '')

// ---- 多页签：路由进入即开签，工作台常驻不可关 ----
const tabs = ref<PageTab[]>([{ path: homePath, title: '工作台' }])

watch(
  () => route.path,
  (path) => {
    if (!route.meta.title) return
    if (!tabs.value.some((tab) => tab.path === path)) {
      tabs.value.push({ path, title: route.meta.title as string })
    }
  },
  { immediate: true },
)

function switchTab(path: string) {
  if (path !== route.path) router.push(path)
}

function closeTab(path: string) {
  const index = tabs.value.findIndex((tab) => tab.path === path)
  if (index < 0 || path === homePath) return
  tabs.value.splice(index, 1)
  if (route.path === path) {
    const next = tabs.value[Math.max(0, index - 1)]
    router.push(next.path)
  }
}

const breadcrumb = computed(() => {
  const items: string[] = []
  if (currentGroup.value && currentGroup.value !== currentTitle.value) items.push(currentGroup.value)
  items.push(currentTitle.value)
  return items
})

const avatarText = computed(() => (session.userName || '用').slice(0, 1))

onMounted(async () => {
  try {
    const profile = await fetchMe()
    updateProfile(profile)
    session.applyProfile()
  } catch {
    // 登录态失效时由请求层跳转登录页
  }
})

function logout() {
  clearSession()
  session.clearSession()
  router.replace('/login')
}

function itemActive(path: string) {
  if (path === '/portal/carrier/tasks') return route.path.startsWith(path)
  return route.path === path
}
</script>

<template>
  <div class="app-shell">
    <!-- 侧栏 -->
    <aside class="side">
      <div class="side__logo">
        <img class="side__logo-brand" src="@/assets/brand-deepway.png" alt="DEEP WAY" />
      </div>
      <nav class="side__menu">
        <div v-for="section in menu" :key="section.group" class="side__group">
          <div class="side__group-title">{{ section.group }}</div>
          <a
            v-for="item in section.items"
            :key="item.path"
            class="side__item"
            :class="{ 'is-active': itemActive(item.path) }"
            @click="router.push(item.path)"
          >
            <component :is="() => renderIcon(item.icon)" />
            <span>{{ item.title }}</span>
          </a>
        </div>
      </nav>
    </aside>

    <!-- 主区 -->
    <div class="main">
      <header class="topbar">
        <div class="topbar__crumb">
          <span class="topbar__crumb-mod">{{ currentGroup || '工作台' }}</span>
          <span class="topbar__crumb-sep" v-if="currentGroup && currentGroup !== currentTitle">/</span>
          <span class="topbar__crumb-cur">{{ currentTitle }}</span>
        </div>
        <div class="topbar__right">
          <span class="topbar__user">{{ session.userName }} · {{ session.userRoleLabel }}</span>
          <button type="button" class="topbar__logout" @click="logout">退出</button>
          <span class="topbar__avatar">{{ avatarText }}</span>
        </div>
      </header>

      <!-- 多页签 -->
      <div class="tabs">
        <div
          v-for="tab in tabs"
          :key="tab.path"
          class="tabs__item"
          :class="{ 'is-active': route.path === tab.path }"
          @click="switchTab(tab.path)"
        >
          <span>{{ tab.title }}</span>
          <span
            v-if="tab.path !== homePath"
            class="tabs__close"
            @click.stop="closeTab(tab.path)"
          >
            ✕
          </span>
        </div>
      </div>

      <!-- 内容（keep-alive：切页签保留筛选与分页状态） -->
      <main class="content">
        <router-view v-slot="{ Component }">
          <keep-alive>
            <component :is="Component as Component" />
          </keep-alive>
        </router-view>
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ---- 侧栏（旧版 .sidebar） ---- */
.side {
  flex: none;
  width: 200px;
  background: #1c2433;
  display: flex;
  flex-direction: column;
  user-select: none;
}

.side__logo {
  height: 54px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.side__logo-brand {
  width: 168px;
  max-width: 100%;
  height: auto;
  display: block;
}

.side__menu {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0 14px;
}

.side__menu::-webkit-scrollbar {
  width: 5px;
}

.side__menu::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.14);
  border-radius: 3px;
}

.side__group-title {
  padding: 12px 14px 4px;
  font-size: 11px;
  color: #6b7c93;
  letter-spacing: 1px;
}

.side__item {
  height: 38px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  margin: 1px 6px;
  border-radius: 4px;
  color: #aab4c2;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.side__item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.side__item.is-active {
  background: #0e6e64;
  color: #fff;
}

.side-menu__icon {
  width: 15px;
  height: 15px;
  flex: none;
  display: inline-flex;
}

.side-menu__icon svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* ---- 主区 ---- */
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  height: 44px;
  flex: none;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  align-items: center;
  padding: 0 16px;
  user-select: none;
}

.topbar__crumb {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #8c8c8c;
}

.topbar__crumb-mod {
  color: #8c8c8c;
}

.topbar__crumb-sep {
  color: #d9d9d9;
}

.topbar__crumb-cur {
  color: #595959;
}

.topbar__right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.topbar__user {
  font-size: 13px;
  color: #595959;
}

.topbar__logout {
  border: 0;
  background: none;
  color: #8c8c8c;
  font-size: 12px;
  cursor: pointer;
}

.topbar__logout:hover {
  color: #262626;
}

.topbar__avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #1677ff;
  color: #fff;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ---- 页签栏（旧版 .tabs） ---- */
.tabs {
  flex: none;
  background: #e9edf2;
  padding: 7px 10px;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  user-select: none;
}

.tabs::-webkit-scrollbar {
  display: none;
}

.tabs__item {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px;
  border-radius: 4px;
  border: 1px solid transparent;
  font-size: 13px;
  color: #595959;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s;
}

.tabs__item:hover {
  background: #e0e6ee;
}

.tabs__item.is-active {
  background: #fff;
  border-color: #dfe3e9;
  color: #1677ff;
}

.tabs__close {
  font-size: 11px;
  line-height: 1;
  color: #8c8c8c;
  padding: 2px;
  border-radius: 2px;
  transition: background 0.15s, color 0.15s;
}

.tabs__close:hover {
  background: #d9d9d9;
  color: #595959;
}

.tabs__item.is-active .tabs__close {
  color: #1677ff;
}

.tabs__item.is-active .tabs__close:hover {
  background: rgba(22, 119, 255, 0.12);
}

/* ---- 内容区 ---- */
.content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.content::-webkit-scrollbar {
  width: 8px;
}

.content::-webkit-scrollbar-thumb {
  background: #d9d9d9;
  border-radius: 4px;
}
</style>
