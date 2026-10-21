<script setup lang="ts">
/**
 * 司机端布局（H5，移动优先）
 * 480px 居中；底部「任务 / 消息」两个 Tab
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { clearSession, getProfile } from '@/services/portal'

const route = useRoute()
const router = useRouter()
const profile = getProfile()

const tabs = [
  { path: '/m/tasks', label: '我的任务', icon: '▤' },
  { path: '/m/messages', label: '消息', icon: '✉' },
]

const activePath = computed(() => tabs.find((t) => route.path.startsWith(t.path))?.path ?? '')
const hideTabbar = computed(() => /\/tasks\/\d+/.test(route.path))

function logout() {
  clearSession()
  router.replace('/m/login')
}
</script>

<template>
  <div class="driver">
    <header class="driver__header">
      <div>
        <div class="driver__brand">深向</div>
        <div class="driver__hello">{{ profile?.driver_name || profile?.name || '司机' }}，您好</div>
      </div>
      <button type="button" class="driver__logout" @click="logout">退出</button>
    </header>

    <main class="driver__main">
      <router-view />
    </main>

    <nav v-if="!hideTabbar" class="driver__tabbar">
      <router-link
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        class="driver__tab"
        :class="{ 'driver__tab--active': activePath === tab.path }"
      >
        <span class="driver__tab-icon">{{ tab.icon }}</span>
        <span>{{ tab.label }}</span>
      </router-link>
    </nav>
  </div>
</template>

<style scoped>
.driver {
  min-height: 100%;
  height: 100%;
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  background: #f5f6f8;
  box-shadow: 0 0 0 1px #eceff3;
}
.driver__header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: #1a1a1a;
  color: #fff;
}
.driver__brand {
  font-size: 13px;
  letter-spacing: 2px;
  opacity: 0.72;
}
.driver__hello {
  margin-top: 2px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}
.driver__logout {
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: transparent;
  color: #fff;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.driver__main {
  flex: 1;
  overflow: auto;
  padding: 12px 12px 20px;
}
.driver__tabbar {
  flex: none;
  display: flex;
  background: #fff;
  border-top: 1px solid #f0f0f0;
  padding-bottom: env(safe-area-inset-bottom);
}
.driver__tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 0 7px;
  font-size: 11px;
  color: #8c8c8c;
  text-decoration: none;
}
.driver__tab--active {
  color: #1a1a1a;
  font-weight: 600;
}
.driver__tab-icon {
  font-size: 16px;
  line-height: 1;
}
</style>
