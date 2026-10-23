<script setup lang="ts">
/**
 * 司机端 - 我的任务（H5）
 * 按待提车 / 运输中 / 待结单 / 已完成分组
 */
import { computed, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import StatusBadge from '@/components/portal/StatusBadge.vue'
import { fetchDriverTasks } from '@/services/portal'
import type { PortalTask } from '@/services/portal'

const message = useMessage()

const TABS = [
  { key: 'pending_pickup', label: '待提车' },
  { key: 'transit', label: '运输中' },
  { key: 'pending_finish', label: '待结单' },
  { key: 'finished', label: '已完成' },
]

const tab = ref('pending_pickup')
const list = ref<PortalTask[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const finished = computed(() => list.value.length >= total.value)

async function load(reset = false) {
  if (loading.value) return
  if (reset) {
    page.value = 1
    list.value = []
    total.value = 0
  }
  loading.value = true
  try {
    const res = await fetchDriverTasks({ page: page.value, size: 10, tab: tab.value })
    list.value = reset ? res.list : [...list.value, ...res.list]
    total.value = res.total
  } catch (e) {
    message.error(e instanceof Error ? e.message : '任务加载失败')
  } finally {
    loading.value = false
  }
}

function switchTab(key: string) {
  if (tab.value === key) return
  tab.value = key
  load(true)
}

function loadMore() {
  if (finished.value || loading.value) return
  page.value += 1
  load()
}

onMounted(() => load(true))
</script>

<template>
  <div class="dtasks">
    <div class="dtasks__tabs">
      <button
        v-for="item in TABS"
        :key="item.key"
        type="button"
        class="dtasks__tab"
        :class="{ 'dtasks__tab--active': tab === item.key }"
        @click="switchTab(item.key)"
      >
        {{ item.label }}
      </button>
    </div>

    <n-spin :show="loading && !list.length">
      <div v-if="!list.length && !loading" class="dtasks__empty">
        暂无任务<br />有新任务时承运商会短信通知您
      </div>

      <router-link
        v-for="task in list"
        :key="task.id"
        :to="`/m/tasks/${task.id}`"
        class="tcard"
      >
        <div class="tcard__head">
          <span class="tcard__no">{{ task.task_no }}</span>
          <StatusBadge :status="task.status" size="small" />
        </div>
        <div class="tcard__route">
          <span class="tcard__point tcard__point--from">提</span>
          <span class="tcard__text">{{ task.ship_location || '-' }}</span>
        </div>
        <div class="tcard__route">
          <span class="tcard__point tcard__point--to">送</span>
          <span class="tcard__text">{{ task.delivery_address || task.delivery_area || '-' }}</span>
        </div>
        <div v-if="task.order_no" class="tcard__vin">订单号：{{ task.order_no }}</div>
        <div v-if="task.vins" class="tcard__vin">VIN：{{ task.vins }}</div>
        <div class="tcard__foot">
          <span class="tcard__customer">{{ task.customer_name }}</span>
          <span class="tcard__freight">
            计划运费
            <b>{{ task.plan_freight == null ? '-' : `¥${Number(task.plan_freight).toFixed(2)}` }}</b>
          </span>
        </div>
      </router-link>
      <div v-if="list.length && !finished" class="dtasks__more">
        <n-button size="small" :loading="loading" @click="loadMore">加载更多</n-button>
      </div>
      <div v-if="list.length && finished" class="dtasks__end">已显示全部</div>
    </n-spin>
  </div>
</template>

<style scoped>
.dtasks {
  padding-bottom: 8px;
}
.dtasks__tabs {
  display: flex;
  gap: 4px;
  background: #fff;
  border-radius: 6px;
  padding: 4px;
  margin-bottom: 12px;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04);
  position: sticky;
  top: -12px;
  z-index: 2;
}
.dtasks__tab {
  flex: 1;
  border: none;
  background: transparent;
  border-radius: 4px;
  padding: 8px 0;
  font-size: 12px;
  color: #595959;
  cursor: pointer;
}
.dtasks__tab--active {
  background: #1a1a1a;
  color: #fff;
  font-weight: 600;
}
.dtasks__empty {
  padding: 70px 0;
  text-align: center;
  font-size: 12px;
  line-height: 1.9;
  color: #8c8c8c;
}
.dtasks__more {
  display: flex;
  justify-content: center;
  padding: 10px 0 4px;
}
.dtasks__end {
  padding: 12px 0 4px;
  text-align: center;
  font-size: 12px;
  color: #bfbfbf;
}
.tcard {
  display: block;
  background: #fff;
  border-radius: 6px;
  padding: 13px 14px;
  margin-bottom: 10px;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04);
  cursor: pointer;
  text-decoration: none;
  color: inherit;
}
.tcard__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 9px;
  border-bottom: 1px solid #f0f0f0;
}
.tcard__no {
  font-size: 13px;
  font-weight: 600;
  color: #262626;
}
.tcard__route {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 9px;
}
.tcard__point {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 10px;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}
.tcard__point--from {
  background: #1677ff;
}
.tcard__point--to {
  background: #389e0d;
}
.tcard__text {
  font-size: 12px;
  line-height: 1.5;
  color: #595959;
  word-break: break-all;
}
.tcard__vin {
  margin-top: 8px;
  font-size: 12px;
  color: #8c8c8c;
  word-break: break-all;
}
.tcard__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid #f0f0f0;
  font-size: 12px;
  color: #8c8c8c;
}
.tcard__freight b {
  color: #fa8c16;
  font-size: 13px;
}
</style>
