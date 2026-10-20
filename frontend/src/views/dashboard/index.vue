<script setup lang="ts">
/**
 * 工作台（契约 5.1 GET /api/stats，结构自定前端适配）
 *
 * 布局对齐旧版 pageDashboard：
 *  - 顶部 6 张统计卡（白卡、label 12px 灰、num 24px 600，子行数字主色加粗）：
 *      待派单任务（警告色）/ 在途运单 / 已到达（警告色）/ 已完结 / 待对账运费 / 合作承运商
 *  - 下方两栏（左 1fr 右 320px）：
 *      左「最新任务」表（任务单号链接/客户/VIN/状态标签/创建日期，6 条，表头"查看全部 →"）
 *      右「任务状态分布」横向条形（9 态，主色等比）
 *  - /api/stats 实际结构：task.{9 态+total} / todayNew / inTransit /
 *    freightPending{count,amount} / esignWaitSign / cooperatingCarriers / enabledDrivers；
 *    本月运费 /stats 未提供，由 services/freight.sumMonthActualFreight 按台账聚合（失败降级 '--'）
 *  - onMounted + onActivated：keep-alive 页签切回时刷新
 */
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getDashboardStats } from '@/services/stats'
import type { NormalizedStats } from '@/services/stats'
import { sumMonthActualFreight } from '@/services/freight'
import { listShippingTasks } from '@/services/tasks'
import type { ShippingTaskListItem, TaskStatus } from '@/types/api'
import { money, datetime } from '@/utils/format'
import StatusTag from '@/components/StatusTag.vue'

const router = useRouter()

// ---- 状态 ----
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
      // /stats 无本月运费口径，失败时子行降级 '--'，不阻塞整页
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

// keep-alive 首次激活与 onMounted 相邻触发，跳过一次避免重复拉取
let activatedOnce = false
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  loadAll()
})

// ---- 统计卡片（对齐旧版 .stat） ----
interface StatCard {
  label: string
  num: string
  /** 子行（数字用 <b> 主色加粗，纯数字/静态文案，可安全 v-html） */
  sub: string
  /** num 颜色：待派单/已到达用警告色，其余默认文本色 */
  numColor?: string
}

const WARNING_COLOR = '#fa8c16'

const statCards = computed<StatCard[]>(() => {
  const s = stats.value
  if (!s) return []
  const count = (status: TaskStatus) => s.taskStatusCount[status] ?? 0
  return [
    {
      label: '待派单任务',
      num: String(count('WAIT_DISPATCH')),
      sub: `已派单 <b>${count('DISPATCHED')}</b> 待接单`,
      numColor: WARNING_COLOR,
    },
    {
      label: '在途运单',
      num: String(s.inTransitCount),
      sub: `已提车 <b>${count('PICKED')}</b> 已出库 <b>${count('OUTBOUND')}</b>`,
    },
    {
      label: '已到达',
      num: String(count('ARRIVED')),
      sub: '待客户交接',
      numColor: WARNING_COLOR,
    },
    {
      label: '已完结',
      num: String(count('FINISHED')),
      sub: `本月运费 <b>¥${monthFreight.value === null ? '--' : money(monthFreight.value)}</b>`,
    },
    {
      label: '待对账运费',
      num: String(s.pendingReconcileCount),
      sub: `<b>¥${money(s.pendingReconcileAmount)}</b>`,
    },
    {
      label: '合作承运商',
      num: String(s.cooperatingCarriers),
      sub: `启用司机 <b>${s.enabledDrivers}</b> 人`,
    },
  ]
})

// ---- 任务状态分布（9 态横向条形，按最大值等比） ----
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

function goTasks() {
  router.push('/tasks')
}
</script>

<template>
  <div class="stp-page dashboard">
    <!-- 加载失败兜底（对齐旧版错误卡片） -->
    <div v-if="loadError" class="card empty-row dashboard-error">
      {{ loadError }}<br />
      <span class="dashboard-error__tip">请确认后端服务已启动（默认 http://localhost:3000）</span>
      <n-button size="small" type="primary" class="dashboard-error__btn" @click="loadAll">
        重试
      </n-button>
    </div>

    <template v-else>
      <!-- 统计卡片行（旧版 stat-grid：6 列白卡） -->
      <div class="stat-grid">
        <template v-if="statCards.length">
          <div v-for="card in statCards" :key="card.label" class="stat">
            <div class="stat__label">{{ card.label }}</div>
            <div class="stat__num" :style="card.numColor ? { color: card.numColor } : undefined">
              {{ card.num }}
            </div>
            <!-- eslint-disable-next-line vue/no-v-html —— 子行仅含静态文案与统计数字 -->
            <div class="stat__sub" v-html="card.sub"></div>
          </div>
        </template>
        <template v-else>
          <div v-for="i in 6" :key="`skeleton-${i}`" class="stat">
            <div class="stat__label">加载中</div>
            <div class="stat__num">--</div>
          </div>
        </template>
      </div>

      <!-- 最新任务 + 任务状态分布（旧版 dash-grid：1fr + 320px） -->
      <div class="dash-grid">
        <div class="card">
          <div class="panel-head">
            <span>最新任务</span>
            <a class="link" @click="goTasks">查看全部 →</a>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>任务单号</th>
                  <th>客户名称</th>
                  <th>VIN</th>
                  <th>状态</th>
                  <th>创建日期</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="task in latestTasks" :key="task.id">
                  <td><a class="link" @click="goTasks">{{ task.task_no }}</a></td>
                  <td>
                    <span class="ellipsis" :title="task.customer_name">{{ task.customer_name }}</span>
                  </td>
                  <td>{{ task.vins || '-' }}</td>
                  <td><StatusTag type="task" :value="task.status" /></td>
                  <td>{{ datetime(task.create_time) }}</td>
                </tr>
                <tr v-if="!latestTasks.length && !loading">
                  <td colspan="5" class="empty-row">暂无数据</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="panel-head"><span>任务状态分布</span></div>
          <div v-if="statusBars.length" class="bar-list">
            <div v-for="item in statusBars" :key="item.label" class="bar-item">
              <span class="bar-item__name">{{ item.label }}</span>
              <div class="bar-item__track">
                <div class="bar-item__fill" :style="{ width: item.width }"></div>
              </div>
              <span class="bar-item__val">{{ item.count }}</span>
            </div>
          </div>
          <div v-else class="empty-row">加载中…</div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ---- 卡片（旧版 .card：白底 6px 圆角浅投影） ---- */
.card {
  background: #ffffff;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04);
}

/* ---- 统计卡片（旧版 .stat-grid / .stat） ---- */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}

.stat {
  background: #ffffff;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04);
  padding: 14px 16px;
}

.stat__label {
  color: #8c8c8c;
  font-size: 12px;
}

.stat__num {
  font-size: 24px;
  font-weight: 600;
  color: #262626;
  line-height: 1.25;
  margin: 5px 0 2px;
  font-variant-numeric: tabular-nums;
}

.stat__sub {
  font-size: 12px;
  color: #8c8c8c;
}

.stat__sub :deep(b) {
  color: #1677ff;
  font-weight: 600;
}

/* ---- 两栏（旧版 .dash-grid：1fr + 320px） ---- */
.dash-grid {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 12px;
  align-items: start;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 13px 16px;
  border-bottom: 1px solid #f0f0f0;
  font-weight: 600;
  color: #262626;
}

.link {
  color: #1677ff;
  cursor: pointer;
}

.link:hover {
  color: #4096ff;
}

/* ---- 最新任务表（旧版 table 观感：表头 #fafafa） ---- */
.table-scroll {
  overflow-x: auto;
}

table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
}

th {
  background: #fafafa;
  color: #595959;
  font-weight: 500;
  text-align: left;
  padding: 11px 12px;
  border-bottom: 1px solid #f0f0f0;
  white-space: nowrap;
}

td {
  padding: 10px 12px;
  color: #262626;
  border-bottom: 1px solid #f0f0f0;
  white-space: nowrap;
}

tbody tr {
  transition: background 0.12s;
}

tbody tr:hover td {
  background: #f7fafd;
}

.ellipsis {
  display: inline-block;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}

.empty-row {
  padding: 48px 0;
  text-align: center;
  color: #8c8c8c;
}

/* ---- 任务状态分布（旧版 .bar-list：主色等比条形） ---- */
.bar-list {
  padding: 6px 16px 12px;
}

.bar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.bar-item__name {
  width: 80px;
  color: #595959;
}

.bar-item__track {
  flex: 1;
  height: 8px;
  background: #f0f2f5;
  border-radius: 4px;
  overflow: hidden;
}

.bar-item__fill {
  height: 100%;
  border-radius: 4px;
  background: #1677ff;
  transition: width 0.3s;
}

.bar-item__val {
  width: 40px;
  text-align: right;
  color: #8c8c8c;
  font-variant-numeric: tabular-nums;
}

/* ---- 加载失败兜底 ---- */
.dashboard-error__tip {
  font-size: 12px;
  color: #8c8c8c;
}

.dashboard-error__btn {
  margin-top: 10px;
}

@media (max-width: 1100px) {
  .stat-grid {
    grid-template-columns: repeat(3, 1fr);
  }

  .dash-grid {
    grid-template-columns: 1fr;
  }
}
</style>
