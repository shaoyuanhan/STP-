<script setup lang="ts">
/**
 * 工作台（契约 5.1 GET /api/stats，结构自定前端适配）
 *
 * - 顶部 6 张统计卡：待派单 / 在途 / 已到达 / 已完结 / 待对账 / 合作承运商
 * - 下方两栏：最新任务（只读表格）+ 任务状态分布（9 态等比条形）
 * - 页面结构沿用列表页：白卡片 + 分块标题（4px 主色竖条），不使用独立高亮视觉
 */
import { computed, h, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { DataTableColumns } from 'naive-ui'
import StatusTag from '@/components/StatusTag.vue'
import { getDashboardStats } from '@/services/stats'
import type { NormalizedStats } from '@/services/stats'
import { sumMonthActualFreight } from '@/services/freight'
import { listShippingTasks } from '@/services/tasks'
import type { ShippingTaskListItem, TaskStatus } from '@/types/api'
import { datetime, money } from '@/utils/format'

const router = useRouter()

const loading = ref(false)
const loadError = ref<string | null>(null)
const stats = ref<NormalizedStats | null>(null)
const monthFreight = ref<number | null>(null)
const latestTasks = ref<ShippingTaskListItem[]>([])

async function loadAll() {
  loading.value = true
  loadError.value = null
  try {
    const [statsResult, monthFreightResult, latest] = await Promise.all([
      getDashboardStats(),
      sumMonthActualFreight().catch(() => null),
      listShippingTasks({ page: 1, size: 6 }),
    ])
    stats.value = statsResult
    monthFreight.value = monthFreightResult
    latestTasks.value = latest?.list ?? []
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
    stats.value = null
    latestTasks.value = []
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)

let activatedOnce = false
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  loadAll()
})

// ---- 统计卡片 ----
interface SubPart {
  text: string
  strong?: boolean
}
interface StatCard {
  label: string
  num: string
  sub: SubPart[]
  warn?: boolean
}

/** 首屏加载占位卡片（结构固定，避免布局跳动） */
const placeholderCards: StatCard[] = [
  { label: '待派单任务', num: '-', sub: [{ text: '加载中' }] },
  { label: '在途运单', num: '-', sub: [{ text: '加载中' }] },
  { label: '已到达', num: '-', sub: [{ text: '加载中' }] },
  { label: '已完结', num: '-', sub: [{ text: '加载中' }] },
  { label: '待对账运费', num: '-', sub: [{ text: '加载中' }] },
  { label: '合作承运商', num: '-', sub: [{ text: '加载中' }] },
]

const statCards = computed<StatCard[]>(() => {
  const s = stats.value
  if (!s) return []
  const count = (status: TaskStatus) => s.taskStatusCount[status] ?? 0
  return [
    {
      label: '待派单任务',
      num: String(count('WAIT_DISPATCH')),
      sub: [{ text: '已派单 ' }, { text: String(count('DISPATCHED')), strong: true }, { text: ' 待接单' }],
      warn: true,
    },
    {
      label: '在途运单',
      num: String(s.inTransitCount),
      sub: [
        { text: '已提车 ' },
        { text: String(count('PICKED')), strong: true },
        { text: ' 已出库 ' },
        { text: String(count('OUTBOUND')), strong: true },
      ],
    },
    {
      label: '已到达',
      num: String(count('ARRIVED')),
      sub: [{ text: '待客户交接' }],
      warn: true,
    },
    {
      label: '已完结',
      num: String(count('FINISHED')),
      sub: [{ text: '本月运费 ' }, { text: monthFreight.value === null ? '-' : `¥${money(monthFreight.value)}`, strong: true }],
    },
    {
      label: '待对账运费',
      num: String(s.pendingReconcileCount),
      sub: [{ text: '¥' }, { text: money(s.pendingReconcileAmount), strong: true }],
    },
    {
      label: '合作承运商',
      num: String(s.cooperatingCarriers),
      sub: [{ text: '启用司机 ' }, { text: String(s.enabledDrivers), strong: true }, { text: ' 人' }],
    },
  ]
})

// ---- 任务状态分布 ----
const STATUS_BARS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'WAIT_DISPATCH', label: '待派单' },
  { status: 'DISPATCHED', label: '已派单' },
  { status: 'CARRIER_ACCEPTED', label: '已接单' },
  { status: 'PICKED', label: '已提车' },
  { status: 'OUTBOUND', label: '已出库' },
  { status: 'IN_TRANSIT', label: '在途' },
  { status: 'ARRIVED', label: '已到达' },
  { status: 'FINISHED', label: '已完结' },
  { status: 'CANCELLED', label: '已取消' },
]

const statusBars = computed(() => {
  const s = stats.value
  if (!s) return []
  const items = STATUS_BARS.map((item) => ({
    label: item.label,
    count: s.taskStatusCount[item.status] ?? 0,
  }))
  const max = Math.max(...items.map((item) => item.count), 1)
  return items.map((item) => ({ ...item, width: `${(item.count / max) * 100}%` }))
})

// ---- 最新任务 ----
function goTasks() {
  router.push('/tasks')
}

const taskColumns: DataTableColumns<ShippingTaskListItem> = [
  {
    title: '任务单号',
    key: 'task_no',
    width: 150,
    render: (row) => h('a', { class: 'dash-link', onClick: goTasks }, row.task_no),
  },
  { title: '客户名称', key: 'customer_name', width: 160, ellipsis: { tooltip: true } },
  {
    title: 'VIN',
    key: 'vins',
    width: 180,
    ellipsis: { tooltip: true },
    render: (row) => row.vins || '-',
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: (row) => h(StatusTag, { type: 'task', value: row.status }),
  },
  {
    title: '创建时间',
    key: 'create_time',
    width: 180,
    render: (row) => datetime(row.create_time),
  },
]
</script>

<template>
  <div class="stp-page dashboard">
    <div v-if="loadError" class="dash-error">
      <span>{{ loadError }}</span>
      <n-button size="small" type="primary" quaternary @click="loadAll">重试</n-button>
    </div>

    <template v-else>
      <!-- 统计卡片 -->
      <div class="stat-grid">
        <div v-for="card in (statCards.length ? statCards : placeholderCards)" :key="card.label" class="stat">
          <div class="stat__label">{{ card.label }}</div>
          <div class="stat__num" :class="{ 'stat__num--warn': card.warn }">{{ card.num }}</div>
          <div class="stat__sub">
            <span v-for="(part, index) in card.sub" :key="index" :class="{ 'is-strong': part.strong }">{{ part.text }}</span>
          </div>
        </div>
      </div>

      <div class="dash-grid">
        <!-- 最新任务 -->
        <n-card class="page-card" :bordered="false">
          <div class="panel-head">
            <span class="stp-section-title">最新任务</span>
            <n-button text type="primary" @click="goTasks">查看全部 →</n-button>
          </div>
          <n-data-table
            size="small"
            :columns="taskColumns"
            :data="latestTasks"
            :loading="loading"
            :pagination="false"
            :bordered="false"
            :row-key="(row: ShippingTaskListItem) => row.id"
            :scroll-x="770"
          />
        </n-card>

        <!-- 任务状态分布 -->
        <n-card class="page-card" :bordered="false">
          <div class="panel-head">
            <span class="stp-section-title">任务状态分布</span>
          </div>
          <div v-if="statusBars.length" class="bar-list">
            <div v-for="item in statusBars" :key="item.label" class="bar-item">
              <span class="bar-item__name">{{ item.label }}</span>
              <div class="bar-item__track">
                <div class="bar-item__fill" :style="{ width: item.width }"></div>
              </div>
              <span class="bar-item__val">{{ item.count }}</span>
            </div>
          </div>
          <div v-else class="dash-empty">暂无统计数据</div>
        </n-card>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.stat {
  background: #ffffff;
  border-radius: 4px;
  padding: 15px;
}

.stat__label {
  color: #666666;
  font-size: 12px;
}

.stat__num {
  margin: 6px 0 4px;
  color: #2d3033;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
}

.stat__num--warn {
  color: #f0a020;
}

.stat__sub {
  color: #999999;
  font-size: 12px;
  line-height: 1.5;
}

.stat__sub .is-strong {
  color: #1890ff;
  font-weight: 600;
}

.dash-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 10px;
  align-items: start;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.panel-head .stp-section-title {
  margin-bottom: 0;
}

.bar-list {
  padding: 2px 0;
}

.bar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
}

.bar-item__name {
  width: 70px;
  flex: none;
  color: #666666;
  font-size: 14px;
}

.bar-item__track {
  flex: 1;
  min-width: 0;
  height: 8px;
  background: #f5f6fb;
  border-radius: 4px;
  overflow: hidden;
}

.bar-item__fill {
  height: 100%;
  border-radius: 4px;
  background: #1890ff;
  transition: width 0.3s;
}

.bar-item__val {
  width: 36px;
  flex: none;
  text-align: right;
  color: #666666;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.dash-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 15px;
  background: #ffffff;
  border-radius: 4px;
  color: #d03050;
  font-size: 14px;
}

.dash-empty {
  padding: 32px 0;
  text-align: center;
  color: #999999;
  font-size: 14px;
}

:deep(.dash-link) {
  color: #1890ff;
  cursor: pointer;
}

@media (max-width: 1280px) {
  .stat-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .dash-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
