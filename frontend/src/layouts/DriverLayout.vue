<script setup lang="ts">
/**
 * 司机端布局（H5，移动优先）
 * 480px 居中；底部「任务 / 消息」两个 Tab
 * 顶部显示当前承运商，多承运商司机可在此切换（换 token 后整页重载）
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import CarrierSheet from '@/components/CarrierSheet.vue'
import {
  clearSession,
  fetchMyCarriers,
  getProfile,
  setSession,
  switchCarrier,
  type DriverCarrierOption,
} from '@/services/portal'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const profile = ref(getProfile())

const tabs = [
  { path: '/m/tasks', label: '我的任务', icon: '▤' },
  { path: '/m/messages', label: '消息', icon: '✉' },
]

const activePath = computed(() => tabs.find((t) => route.path.startsWith(t.path))?.path ?? '')
const hideTabbar = computed(() => /\/tasks\/\d+/.test(route.path))

const carriers = ref<DriverCarrierOption[]>([])
const showSheet = ref(false)
const switching = ref(false)
const canSwitch = computed(() => carriers.value.length > 1)

onMounted(async () => {
  if (profile.value?.type !== 'DRIVER') return
  try {
    carriers.value = await fetchMyCarriers()
  } catch {
    // 拉取失败不影响主流程，切换入口保持隐藏
  }
})

function logout() {
  clearSession()
  router.replace('/m/login')
}

async function onPickCarrier(carrierId: number) {
  if (carrierId === profile.value?.carrier_id) {
    showSheet.value = false
    return
  }
  switching.value = true
  try {
    const res = await switchCarrier(carrierId)
    setSession(res.token, res.profile)
    profile.value = res.profile
    showSheet.value = false
    message.success(`已切换到 ${res.profile.carrier_name || '目标承运商'}`)
    // 任务/消息均按新的司机档案取数，整页重载最稳妥
    window.location.href = '/m/tasks'
  } catch (e) {
    message.error(e instanceof Error ? e.message : '切换失败')
  } finally {
    switching.value = false
  }
}
</script>

<template>
  <div class="driver">
    <header class="driver__header">
      <div class="driver__who">
        <div class="driver__brand">深向</div>
        <div class="driver__hello">{{ profile?.driver_name || profile?.name || '司机' }}，您好</div>
        <div v-if="profile?.carrier_name" class="driver__carrier">{{ profile.carrier_name }}</div>
      </div>
      <div class="driver__actions">
        <button v-if="canSwitch" type="button" class="driver__logout" @click="showSheet = true">切换承运商</button>
        <button type="button" class="driver__logout" @click="logout">退出</button>
      </div>
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

    <CarrierSheet
      :show="showSheet"
      :carriers="carriers"
      :current="profile?.carrier_id ?? null"
      :loading="switching"
      title="切换承运商"
      @select="onPickCarrier"
      @close="showSheet = false"
    />
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
.driver__carrier {
  margin-top: 2px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.68);
}
.driver__actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
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
