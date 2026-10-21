<script setup lang="ts">
/**
 * 承运商后台布局
 * 复用运营端设计规范：200px 深色侧栏（#1c2433 / 选中 #0e6e64）+ 44px 白色顶栏
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { clearSession, fetchMe, getProfile, updateProfile } from '@/services/portal'
import type { PortalProfile } from '@/services/portal'

const route = useRoute()
const router = useRouter()
const profile = ref<PortalProfile | null>(getProfile())

const MENU = [
  {
    group: '工作台',
    items: [
      {
        path: '/portal/carrier/dashboard',
        title: '工作台',
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
        icon: '<path d="M7 2.5h7l4 4v15H7z"/><path d="M14 2.5v5h5"/><path d="M10 13h5M10 17h5"/>',
      },
      {
        path: '/portal/carrier/drivers',
        title: '司机管理',
        icon: '<circle cx="12" cy="7.5" r="3.4"/><path d="M5 20c0-3.6 3.1-6.3 7-6.3s7 2.7 7 6.3"/>',
      },
      {
        path: '/portal/carrier/messages',
        title: '消息中心',
        icon: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 10h8M8 13h5"/>',
      },
    ],
  },
]

const flatItems = MENU.flatMap((group) => group.items)
const BACK_ICON =
  '<path d="M10 4H4v16h6"/><path d="M14 8l4 4-4 4"/><path d="M8 12h10"/>'
const activePath = computed(
  () => flatItems.find((item) => route.path.startsWith(item.path))?.path ?? ''
)
const currentTitle = computed(() => {
  return flatItems.find((item) => item.path === activePath.value)?.title ?? ''
})
const unread = computed(() => profile.value?.unread ?? 0)
const avatarText = computed(() => (profile.value?.name || '承').slice(0, 1))

/** 页签：详情页归入「运输任务」页签，避免堆叠 */
interface PageTab {
  path: string
  title: string
}

function tabPathOf(path: string) {
  return /^\/portal\/carrier\/tasks\/\d+$/.test(path) ? '/portal/carrier/tasks' : path
}

const tabs = ref<PageTab[]>([{ path: '/portal/carrier/dashboard', title: '工作台' }])
const activeTab = computed(() => tabPathOf(route.path))

watch(
  () => route.path,
  (path) => {
    const key = tabPathOf(path)
    if (tabs.value.some((tab) => tab.path === key)) return
    const title = flatItems.find((item) => item.path === key)?.title
    if (title) tabs.value.push({ path: key, title })
  },
  { immediate: true }
)

function closeTab(path: string) {
  if (path === '/portal/carrier/dashboard') return
  const index = tabs.value.findIndex((tab) => tab.path === path)
  if (index < 0) return
  tabs.value.splice(index, 1)
  if (activeTab.value === path) {
    router.push(tabs.value[Math.max(0, index - 1)].path)
  }
}

onMounted(async () => {
  try {
    const me = await fetchMe()
    profile.value = me
    updateProfile(me)
  } catch {
    /* 401 已由拦截器跳转登录 */
  }
})

function logout() {
  clearSession()
  router.replace('/portal/login')
}

function iconSvg(svgBody: string) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${svgBody}</svg>`
}
</script>

<template>
  <div class="app-shell">
    <aside class="side">
      <div class="side__logo">
        <img class="side__logo-brand" src="@/assets/brand-deepway.png" alt="DEEP WAY" />
      </div>
      <nav class="side__menu">
        <div v-for="section in MENU" :key="section.group" class="side__group">
          <div class="side__group-title">{{ section.group }}</div>
          <a
            v-for="item in section.items"
            :key="item.path"
            class="side__item"
            :class="{ 'is-active': route.path.startsWith(item.path) }"
            @click="router.push(item.path)"
          >
            <span class="side-menu__icon" v-html="iconSvg(item.icon)" />
            <span>{{ item.title }}</span>
            <i
              v-if="item.path === '/portal/carrier/messages' && unread"
              class="side__badge"
            >{{ unread }}</i>
          </a>
        </div>
        <div class="side__group">
          <div class="side__group-title">其他</div>
          <a class="side__item" @click="router.push('/dashboard')">
            <span class="side-menu__icon" v-html="iconSvg(BACK_ICON)" />
            <span>返回运营端</span>
          </a>
        </div>
      </nav>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="topbar__crumb">
          <span class="topbar__crumb-mod">承运商协同</span>
          <span v-if="currentTitle" class="topbar__crumb-sep">/</span>
          <span class="topbar__crumb-cur">{{ currentTitle }}</span>
        </div>
        <div class="topbar__right">
          <span class="topbar__carrier">{{ profile?.carrier_name || '' }}</span>
          <span class="topbar__user">{{ profile?.name || '承运商' }}</span>
          <span class="topbar__avatar">{{ avatarText }}</span>
          <n-button text size="small" @click="logout">退出</n-button>
        </div>
      </header>

      <!-- 多页签（同运营端） -->
      <div class="tabs">
        <div
          v-for="tab in tabs"
          :key="tab.path"
          class="tabs__item"
          :class="{ 'is-active': activeTab === tab.path }"
          @click="router.push(tab.path)"
        >
          <span>{{ tab.title }}</span>
          <span
            v-if="tab.path !== '/portal/carrier/dashboard'"
            class="tabs__close"
            @click.stop="closeTab(tab.path)"
          >
            ✕
          </span>
        </div>
      </div>

      <main class="content">
        <router-view />
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
.side__badge {
  margin-left: auto;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #f5222d;
  color: #fff;
  font-size: 10px;
  font-style: normal;
  line-height: 16px;
  text-align: center;
}
:deep(.side-menu__icon) {
  width: 15px;
  height: 15px;
  flex: none;
  display: inline-flex;
}
:deep(.side-menu__icon svg) {
  width: 100%;
  height: 100%;
  display: block;
}
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
.topbar__carrier {
  font-size: 12px;
  color: #8c8c8c;
}
.topbar__user {
  font-size: 13px;
  color: #595959;
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

/* ---- 页签栏（同运营端 .tabs） ---- */
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
