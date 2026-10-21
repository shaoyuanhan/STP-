<script setup lang="ts">
/**
 * 承运商工作台
 * 布局完全对齐运营端工作台：6 张统计卡 + 1fr/320px 两栏白卡
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { fetchCarrierCounts, fetchCarrierTasks } from '@/services/portal'
import type { PortalTask } from '@/services/portal'
import StatusBadge from '@/components/portal/StatusBadge.vue'
import { datetime } from '@/utils/format'

const router = useRouter()
const message = useMessage()
const loading = ref(false)
const counts = ref<Record<string, number>>({})
const recent = ref<PortalTask[]>([])

const CARDS = [
  { key: 'DISPATCHED', label: '待接单', hint: '需尽快指派司机', warn: true },
  { key: 'CARRIER_ACCEPTED', label: '待提车', hint: '司机未确认提车' },
  { key: 'PICKED', label: '已提车', hint: '等待仓库出库' },
  { key: 'IN_TRANSIT', label: '在途', hint: '运输中' },
  { key: 'ARRIVED', label: '待结单', hint: '已到达待交接', warn: true },
  { key: 'FINISHED', label: '已完结', hint: '累计完成' },
]

onMounted(async () => {
  loading.value = true
  try {
    const [countData, taskData] = await Promise.all([
      fetchCarrierCounts(),
      fetchCarrierTasks({ page: 1, size: 6 }),
    ])
    counts.value = countData.counts
    recent.value = taskData.list
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
})

function goTasks(status?: string) {
  router.push({ path: '/portal/carrier/tasks', query: status ? { status } : {} })
}
</script>

<template>
  <div class="stp-page">
    <n-spin :show="loading">
      <!-- 统计卡片 -->
      <div class="stat-grid">
        <div v-for="card in CARDS" :key="card.key" class="stat" @click="goTasks(card.key)">
          <div class="stat__label">{{ card.label }}</div>
          <div class="stat__num" :style="card.warn ? { color: '#fa8c16' } : undefined">
            {{ counts[card.key] ?? 0 }}
          </div>
          <div class="stat__sub">{{ card.hint }}</div>
        </div>
      </div>

      <!-- 最新任务 + 作业流程 -->
      <div class="dash-grid">
        <div class="card">
          <div class="panel-head">
            <span>最新任务</span>
            <a class="link" @click="goTasks()">查看全部 →</a>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>任务单号</th>
                  <th>客户名称</th>
                  <th>运输路线</th>
                  <th>状态</th>
                  <th>创建日期</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="task in recent"
                  :key="task.id"
                  class="is-link"
                  @click="router.push(`/portal/carrier/tasks/${task.id}`)"
                >
                  <td><a class="link">{{ task.task_no }}</a></td>
                  <td>
                    <span class="ellipsis" :title="task.customer_name">{{ task.customer_name }}</span>
                  </td>
                  <td>
                    <span class="ellipsis" :title="`${task.ship_location || '-'} → ${task.delivery_area || '-'}`">
                      {{ task.ship_location || '-' }} → {{ task.delivery_area || '-' }}
                    </span>
                  </td>
                  <td><StatusBadge :status="task.status" /></td>
                  <td>{{ datetime(task.create_time) }}</td>
                </tr>
                <tr v-if="!recent.length && !loading">
                  <td colspan="5" class="empty-row">暂无数据</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="panel-head"><span>作业流程</span></div>
          <ol class="steps">
            <li>
              <b>接单指派</b>
              <span>收到派单后选择司机确认接单，接单后不可取消</span>
            </li>
            <li>
              <b>司机提车</b>
              <span>司机在手机端上传提车照片并确认，照片为必传项</span>
            </li>
            <li>
              <b>仓库出库</b>
              <span>WMS 出库后任务自动进入在途，司机才能确认到达</span>
            </li>
            <li>
              <b>到达与结单</b>
              <span>司机回填实际运费并确认到达，完成交接后结单</span>
            </li>
          </ol>
          <div class="tip">
            本地演示：司机在任务详情点击「模拟 WMS 出库」即可推进到在途。
          </div>
        </div>
      </div>
    </n-spin>
  </div>
</template>

<style scoped>
/* ---- 统计卡片（同运营端 .stat） ---- */
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
  cursor: pointer;
  transition: box-shadow 0.15s;
}

.stat:hover {
  box-shadow: 0 4px 12px rgba(31, 45, 61, 0.08);
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

/* ---- 卡片 ---- */
.card {
  background: #ffffff;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04);
}

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
  font-weight: 400;
}

.link:hover {
  color: #4096ff;
}

/* ---- 最新任务表（同运营端） ---- */
.table-scroll {
  overflow-x: auto;
}

table {
  width: 100%;
  min-width: 600px;
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

tbody tr.is-link {
  cursor: pointer;
  transition: background 0.12s;
}

tbody tr.is-link:hover {
  background: #f7fafd;
}

tbody tr:last-child td {
  border-bottom: none;
}

.ellipsis {
  display: inline-block;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}

.empty-row {
  text-align: center;
  color: #bfbfbf;
  padding: 26px 0;
}

/* ---- 作业流程 ---- */
.steps {
  list-style: none;
  counter-reset: step;
  margin: 0;
  padding: 14px 16px 4px;
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.steps li {
  counter-increment: step;
  position: relative;
  padding-left: 28px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.steps li::before {
  content: counter(step);
  position: absolute;
  left: 0;
  top: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #e6f4ff;
  color: #1677ff;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.steps b {
  font-size: 12px;
  color: #262626;
}

.steps span {
  font-size: 12px;
  line-height: 1.6;
  color: #8c8c8c;
}

.tip {
  margin: 10px 16px 14px;
  font-size: 12px;
  color: #1677ff;
  background: #f0f7ff;
  border-radius: 4px;
  padding: 8px 10px;
  line-height: 1.6;
}

@media (max-width: 1200px) {
  .stat-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 1000px) {
  .dash-grid {
    grid-template-columns: 1fr;
  }
}
</style>
