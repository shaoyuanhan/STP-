<script setup lang="ts">
/**
 * 主布局：
 * 220px 深色侧栏 + 60px 白色顶栏（面包屑 + 用户）
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
interface MenuGroup {
  group: string
  items: MenuLeaf[]
}
type MenuNode =
  | { kind: 'link'; key: string; title: string; icon: string; path: string }
  | { kind: 'branch'; key: string; title: string; icon: string; children: MenuNode[] }
  | { kind: 'note'; key: string; title: string }

const DASH_ICON = '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'
const TRUCK_ICON = '<path d="M2 6.5h11v9H2z"/><path d="M13 9.5h4.5l3 3v3H13z"/><circle cx="6" cy="18.2" r="1.9"/><circle cx="17" cy="18.2" r="1.9"/>'
const BOX_ICON = '<path d="M3 8l9-4 9 4-9 4-9-4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/>'
const USER_ICON = '<circle cx="12" cy="8" r="3"/><path d="M5 19c.7-3.2 3.2-5 7-5s6.3 1.8 7 5"/>'
const DB_ICON = '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>'

const HOME_ITEM: MenuLeaf = { path: '/dashboard', title: '工作台', perm: 'dashboard:view', icon: DASH_ICON }
const BASE_GROUPS: MenuGroup[] = [
  {
    group: '基础数据',
    items: [
      {
        path: '/carriers',
        title: '承运商管理',
        perm: 'carriers:view',
        icon: TRUCK_ICON,
      },
      {
        path: '/drivers',
        title: '司机管理',
        perm: 'drivers:view',
        icon: '<circle cx="12" cy="7.5" r="3.4"/><path d="M5 20c0-3.6 3.1-6.3 7-6.3s7 2.7 7 6.3"/>',
      },
    ],
  },
]
const VEHICLE_GROUPS: MenuGroup[] = [
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
]

const SYSTEM_GROUPS: MenuGroup[] = [
  {
    group: '系统管理',
    items: [
      {
        path: '/accounts',
        title: '账号管理',
        perm: 'accounts:view',
        icon: USER_ICON,
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

const CARRIER_MENU: MenuGroup[] = [
  {
    group: '运输协同',
    items: [
      {
        path: '/portal/carrier/tasks',
        title: '运输任务',
        perm: 'portal.tasks:view',
        icon: '<path d="M7 2.5h7l4 4v15H7z"/><path d="M14 2.5v5h5"/><path d="M10 13h5M10 17h5"/>',
      },
    ],
  },
  {
    group: '运力管理',
    items: [
      {
        path: '/portal/carrier/drivers',
        title: '司机管理',
        perm: 'portal.drivers:view',
        icon: '<circle cx="12" cy="7.5" r="3.4"/><path d="M5 20c0-3.6 3.1-6.3 7-6.3s7 2.7 7 6.3"/>',
      },
    ],
  },
  {
    group: '消息中心',
    items: [
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
const homePath = isCarrierAccount.value ? '/portal/carrier/tasks' : '/dashboard'

function allowed(item: MenuLeaf, granted?: string[] | null) {
  if (!granted || !item.perm) return true
  return granted.includes(item.perm)
}

function groupNodes(groups: MenuGroup[], granted?: string[] | null, prefix = ''): MenuNode[] {
  return groups.flatMap((section): MenuNode[] => {
    const items = section.items.filter((item) => allowed(item, granted))
    if (!items.length) return []
    if (items.length === 1 && items[0].title === section.group) {
      return [{ kind: 'link' as const, key: items[0].path, title: items[0].title, icon: items[0].icon, path: items[0].path }]
    }
    return [{
      kind: 'branch' as const,
      key: `${prefix}/${section.group}`,
      title: section.group,
      icon: items[0].icon,
      children: items.map((item) => ({ kind: 'link' as const, key: item.path, title: item.title, icon: item.icon, path: item.path })),
    }]
  })
}

function moduleNode(key: string, title: string, icon: string, children: MenuNode[]): MenuNode | null {
  if (!children.length) return null
  return { kind: 'branch', key, title, icon, children }
}

const menu = computed(() => {
  const granted = session.permissions
  if (isCarrierAccount.value) return groupNodes(CARRIER_MENU, granted)
  const nodes: MenuNode[] = []
  if (allowed(HOME_ITEM, granted)) {
    nodes.push({ kind: 'link', key: HOME_ITEM.path, title: HOME_ITEM.title, icon: HOME_ITEM.icon, path: HOME_ITEM.path })
  }
  const vehicle = moduleNode('vehicle', '整车运输', TRUCK_ICON, groupNodes(VEHICLE_GROUPS, granted, 'vehicle'))
  if (vehicle) nodes.push(vehicle)
  nodes.push({
    kind: 'branch',
    key: 'parts',
    title: '零部件运输',
    icon: BOX_ICON,
    children: [{ kind: 'note', key: 'parts-empty', title: '后续接入' }],
  })
  const carrier = moduleNode('carrier', '承运商', USER_ICON, groupNodes(CARRIER_MENU, granted, 'carrier'))
  if (carrier) nodes.push(carrier)
  const base = moduleNode('base', '基础数据', DB_ICON, groupNodes(BASE_GROUPS, granted).flatMap((node) => (
    node.kind === 'branch' ? node.children : [node]
  )))
  if (base) nodes.push(base)
  const system = moduleNode('system', '系统管理', USER_ICON, groupNodes(SYSTEM_GROUPS, granted).flatMap((node) => (
    node.kind === 'branch' ? node.children : [node]
  )))
  if (system) nodes.push(system)
  return nodes
})

function renderIcon(svgBody: string) {
  return h('span', {
    class: 'side-menu__icon',
    innerHTML: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${svgBody}</svg>`,
  })
}

const currentTitle = computed(() => (route.meta.title as string) ?? '')

// ---- 多页签：路由进入即开签，工作台常驻不可关 ----
const tabs = ref<PageTab[]>([{ path: homePath, title: isCarrierAccount.value ? '运输任务' : '工作台' }])

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

function trailOf(nodes: MenuNode[], trail: string[]): string[] | null {
  for (const node of nodes) {
    if (node.kind === 'link' && itemActive(node.path)) return [...trail, node.title]
    if (node.kind === 'branch') {
      const hit = trailOf(node.children, [...trail, node.title])
      if (hit) return hit
    }
  }
  return null
}

const breadcrumb = computed(() => {
  const trail = trailOf(menu.value, []) || []
  if (currentTitle.value && trail[trail.length - 1] !== currentTitle.value) trail.push(currentTitle.value)
  if (!trail.length && currentTitle.value) trail.push(currentTitle.value)
  return trail
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

/** 只保留一条展开路径，保证同一时间仅展开一个分组 */
const openGroups = ref<string[]>([])

function isOpen(key: string) {
  return openGroups.value.includes(key)
}

function pathToKey(nodes: MenuNode[], target: string, trail: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.key === target) return trail
    if (node.kind === 'branch') {
      const hit = pathToKey(node.children, target, [...trail, node.key])
      if (hit) return hit
    }
  }
  return null
}

function toggleGroup(key: string) {
  if (isOpen(key)) {
    const index = openGroups.value.indexOf(key)
    openGroups.value = openGroups.value.slice(0, index)
    return
  }
  openGroups.value = [...(pathToKey(menu.value, key) ?? []), key]
}

function openKeysOf(nodes: MenuNode[], keys: string[]): string[] | null {
  for (const node of nodes) {
    if (node.kind === 'link' && itemActive(node.path)) return keys
    if (node.kind === 'branch') {
      const hit = openKeysOf(node.children, [...keys, node.key])
      if (hit) return hit
    }
  }
  return null
}

watch(
  [() => route.path, menu],
  () => {
    openGroups.value = openKeysOf(menu.value, []) || []
  },
  { immediate: true },
)

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
        <template v-for="node in menu" :key="node.key">
          <RouterLink
            v-if="node.kind === 'link'"
            class="side__item"
            :class="{ 'is-active': itemActive(node.path) }"
            :to="node.path"
          >
            <component :is="() => renderIcon(node.icon)" />
            <span>{{ node.title }}</span>
          </RouterLink>
          <div v-else-if="node.kind === 'branch'" class="side__branch">
            <button
              type="button"
              class="side__parent"
              :class="{ 'is-open': isOpen(node.key) }"
              @click="toggleGroup(node.key)"
            >
              <component :is="() => renderIcon(node.icon)" />
              <span class="side__label">{{ node.title }}</span>
              <i class="side__caret"></i>
            </button>
            <div v-show="isOpen(node.key)" class="side__sub">
              <template v-for="child in node.children" :key="child.key">
                <RouterLink
                  v-if="child.kind === 'link'"
                  class="side__subitem"
                  :class="{ 'is-active': itemActive(child.path) }"
                  :to="child.path"
                >
                  {{ child.title }}
                </RouterLink>
                <div v-else-if="child.kind === 'note'" class="side__note">{{ child.title }}</div>
                <div v-else class="side__nest">
                  <button
                    type="button"
                    class="side__mid"
                    :class="{ 'is-open': isOpen(child.key) }"
                    @click="toggleGroup(child.key)"
                  >
                    <span class="side__label">{{ child.title }}</span>
                    <i class="side__caret"></i>
                  </button>
                  <div v-show="isOpen(child.key)">
                    <template v-for="leaf in child.children" :key="leaf.key">
                      <RouterLink
                        v-if="leaf.kind === 'link'"
                        class="side__leaf"
                        :class="{ 'is-active': itemActive(leaf.path) }"
                        :to="leaf.path"
                      >
                        {{ leaf.title }}
                      </RouterLink>
                      <div v-else class="side__note">{{ leaf.title }}</div>
                    </template>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </template>
      </nav>
    </aside>

    <!-- 主区 -->
    <div class="main">
      <header class="topbar">
        <div class="topbar__crumb">
          <template v-for="(crumb, index) in breadcrumb" :key="crumb">
            <span v-if="index" class="topbar__crumb-sep">/</span>
            <span :class="index === breadcrumb.length - 1 ? 'topbar__crumb-cur' : 'topbar__crumb-mod'">{{ crumb }}</span>
          </template>
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
  width: 220px;
  background: #001529;
  display: flex;
  flex-direction: column;
  user-select: none;
}

.side__logo {
  height: 60px;
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

.side__branch { margin-top: 2px; }

.side__parent {
  width: calc(100% - 12px);
  height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px 6px;
  padding: 0 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #d7dee8;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
}

.side__parent:hover { color: #fff; }

.side__parent.is-open { color: #fff; }

.side__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.side__caret {
  width: 0;
  height: 0;
  flex: none;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
}

.side__parent.is-open .side__caret { transform: rotate(180deg); }

.side__subitem {
  display: block;
  margin: 1px 6px;
  padding: 9px 12px 9px 36px;
  border-radius: 4px;
  color: #b7c2d0;
  font-size: 14px;
  cursor: pointer;
}

.side__subitem:hover,
.side__leaf:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #fff;
}

.side__subitem.is-active,
.side__leaf.is-active {
  background: rgb(12 71 77 / 60%);
  color: #fff;
}

.side__mid {
  width: calc(100% - 12px);
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 1px 6px;
  padding: 0 10px 0 18px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #c5d0dc;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
}

.side__mid:hover,
.side__mid.is-open { color: #fff; }

.side__leaf {
  display: block;
  margin: 1px 6px;
  padding: 8px 10px 8px 34px;
  border-radius: 4px;
  color: #9aa8ba;
  font-size: 14px;
  cursor: pointer;
}

.side__note {
  padding: 4px 12px 8px 22px;
  color: #6b7c93;
  font-size: 12px;
}

.side__item,
.side__subitem,
.side__leaf {
  text-decoration: none;
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
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.side__item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.side__item.is-active {
  background: rgb(12 71 77 / 60%);
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
  height: 60px;
  flex: none;
  background: #fff;
  border-bottom: 1px solid #eeeeee;
  display: flex;
  align-items: center;
  padding: 0 24px;
  user-select: none;
}

.topbar__crumb {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #999999;
  min-width: 0;
  overflow: hidden;
}

.topbar__crumb-sep {
  color: #eeeeee;
  flex: none;
}

/* 前段面包屑允许收缩省略，末级（当前页）保持完整 */
.topbar__crumb-mod {
  color: #999999;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar__crumb-cur {
  color: #2d3033;
  white-space: nowrap;
  flex: none;
}

.topbar__right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.topbar__user {
  font-size: 14px;
  color: #666666;
  white-space: nowrap;
}

.topbar__logout {
  border: 0;
  background: none;
  color: #999999;
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
}

.topbar__logout:hover {
  color: #2d3033;
}

.topbar__avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #1890ff;
  color: #fff;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

/* 窄屏（含高缩放）下收起用户名，只留头像与退出 */
@media (max-width: 900px) {
  .topbar__user {
    display: none;
  }
}

/* ---- 页签栏（旧版 .tabs） ---- */
.tabs {
  flex: none;
  height: 50px;
  background: #ffffff;
  border-bottom: 1px solid #eeeeee;
  padding: 10px 20px;
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
  font-size: 14px;
  color: #666666;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s;
}

.tabs__item:hover {
  background: #f5f6fb;
}

.tabs__item.is-active {
  background: #ffffff;
  border-color: #eeeeee;
  color: #1890ff;
}

.tabs__close {
  font-size: 11px;
  line-height: 1;
  color: #999999;
  padding: 2px;
  border-radius: 2px;
  transition: background 0.15s, color 0.15s;
}

.tabs__close:hover {
  background: #eeeeee;
  color: #666666;
}

.tabs__item.is-active .tabs__close {
  color: #1890ff;
}

.tabs__item.is-active .tabs__close:hover {
  background: rgb(24 144 255 / 12%);
}

/* ---- 内容区 ---- */
.content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: #f5f6fb;
}

.content::-webkit-scrollbar {
  width: 8px;
}

.content::-webkit-scrollbar-thumb {
  background: #999999;
  border-radius: 4px;
}
</style>
