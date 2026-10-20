<script setup lang="ts">
/**
 * 任务详情抽屉（契约 5.4 / PRD 3.③⑦）
 *
 * 分区：基础信息（含 CRM 备注）/ 车辆信息（多车明细表 + 仓库库位 + 运费合计）/
 *       发运信息（未回传节点显示「待回传」灰字）/ 承运信息（派单备注 + 取消记录）/
 *       运输时间轴（status_log）/ 轨迹记录（若有）/ 电子签记录（若有）
 *
 * 说明：基础信息/发运信息/承运信息用公共 DetailSection；
 *       车辆信息/时间轴/轨迹/电子签含表格或时间轴组件，
 *       采用与 DetailSection 一致的分区头样式承载（NDescriptions 插槽仅接受 NDescriptionsItem）。
 */
import { computed, h, ref, watch } from 'vue'
import type { DataTableColumns } from 'naive-ui'
import { useMessage } from 'naive-ui'
import DetailSection from '@/components/DetailSection.vue'
import MoneyText from '@/components/MoneyText.vue'
import StatusTag from '@/components/StatusTag.vue'
import { getShippingTask } from '@/services/tasks'
import { dateOnly, datetime, datetimeFull, formatPhone } from '@/utils/format'
import type {
  EsignRecord,
  ShippingTask,
  ShippingTaskDetail,
  ShippingTaskVehicle,
  TaskStatusLog,
  TransportTrack,
} from '@/types/api'
import { describeApiError, splitVins, TASK_STATUS_LABELS } from './shared'

/**
 * 详情 head 扩展：后端详情 SQL 返回 c.carrier_code，
 * types/api.ts 的 ShippingTask 未声明，本地扩展承接（不修改公共类型）。
 */
interface TaskHeadExt extends ShippingTask {
  carrier_code?: string | null
}

const props = defineProps<{
  show: boolean
  taskId: number | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
}>()

const message = useMessage()

// ---------------- 加载 ----------------
const loading = ref(false)
const loadError = ref('')
const detail = ref<ShippingTaskDetail | null>(null)
let reqId = 0

async function loadDetail() {
  const id = props.taskId
  if (!id) return
  const current = ++reqId
  loading.value = true
  loadError.value = ''
  try {
    const data = await getShippingTask(id)
    if (current !== reqId) return
    detail.value = data
  } catch (error) {
    if (current !== reqId) return
    detail.value = null
    loadError.value = describeApiError(error).message
  } finally {
    if (current === reqId) loading.value = false
  }
}

watch(
  () => [props.show, props.taskId],
  ([visible]) => {
    if (visible) loadDetail()
  },
)

function close() {
  emit('update:show', false)
}

// ---------------- 展示数据 ----------------
const task = computed<TaskHeadExt | null>(() => (detail.value?.task ?? null) as TaskHeadExt | null)
const vehicles = computed<ShippingTaskVehicle[]>(() => detail.value?.vehicles ?? [])
const statusLogs = computed<TaskStatusLog[]>(() => detail.value?.statusLogs ?? [])
const tracks = computed<TransportTrack[]>(() => detail.value?.tracks ?? [])
const esigns = computed<EsignRecord[]>(() => detail.value?.esigns ?? [])

/** 派单备注：取最近一次派单/改派记录的 remark（契约：派单备注存 dispatch_record.remark） */
const dispatchRemark = computed(() => {
  const records = detail.value?.dispatchRecords ?? []
  const hit = [...records].reverse().find((r) => r.action === 'DISPATCH' || r.action === 'REASSIGN')
  return hit?.remark || ''
})

/** 取消记录：CRM 取消 + STP 取消派单记录 */
const cancelRecords = computed<string[]>(() => {
  const list: string[] = []
  const t = task.value
  if (t?.cancel_reason) {
    list.push(`${t.cancel_time ? `${datetime(t.cancel_time)} ` : ''}CRM 取消：${t.cancel_reason}`)
  }
  for (const record of detail.value?.dispatchRecords ?? []) {
    if (record.action !== 'CANCEL_DISPATCH') continue
    const time = record.dispatch_time ? `${datetime(record.dispatch_time)} ` : ''
    const text = [record.cancel_reason, record.remark].filter(Boolean).join('——')
    list.push(`${time}取消派单：${text}`)
  }
  return list
})

const vinText = computed(() => {
  const list = splitVins(task.value?.vins)
  return list.length > 1 ? `${list[0]} 等 ${list.length} 台` : list[0] ?? '-'
})

// ---------------- 车辆明细表 ----------------
const vehicleColumns: DataTableColumns<ShippingTaskVehicle> = [
  {
    title: 'VIN',
    key: 'vin',
    width: 190,
    ellipsis: { tooltip: true },
    render: (row) => row.vin || '-',
  },
  { title: '车型', key: 'vehicle_model', width: 110, render: (row) => row.vehicle_model || '-' },
  {
    title: '发动机配置',
    key: 'engine_config',
    width: 110,
    render: (row) => row.engine_config || '-',
  },
  {
    title: '驾驶室类型',
    key: 'cabin_type',
    width: 110,
    render: (row) => row.cabin_type || '-',
  },
  { title: '订单号', key: 'order_no', width: 130, render: (row) => row.order_no || '-' },
  { title: '报单号', key: 'report_no', width: 130, render: (row) => row.report_no || '-' },
  {
    title: '发运地点',
    key: 'ship_location',
    width: 130,
    render: (row) => row.ship_location || '-',
  },
  {
    title: '计划运费',
    key: 'plan_freight',
    width: 100,
    align: 'right',
    render: (row) => h(MoneyText, { value: row.plan_freight, prefix: '¥' }),
  },
  {
    title: '实际运费',
    key: 'actual_freight',
    width: 110,
    align: 'right',
    render: (row) =>
      row.actual_freight !== null && row.actual_freight !== undefined && row.actual_freight !== ''
        ? h(MoneyText, { value: row.actual_freight, prefix: '¥' })
        : h('span', { style: 'color:#bfbfbf' }, '到达后回填'),
  },
]

// ---------------- 运输时间轴（status_log 数据驱动，节点名对齐 PRD） ----------------
function timelineNodeName(log: TaskStatusLog): string {
  if (log.to_status === 'WAIT_DISPATCH') {
    return log.from_status ? '取消派单，回退待派单' : 'CRM 下发发运申请'
  }
  if (log.to_status === 'DISPATCHED') return '调度派单'
  if (log.to_status === 'CARRIER_ACCEPTED') return '承运商接单 / 分配司机'
  if (log.to_status === 'PICKED') return '司机提车发运'
  if (log.to_status === 'OUTBOUND') return 'WMS 出库'
  if (log.to_status === 'IN_TRANSIT') return '在途运输'
  if (log.to_status === 'ARRIVED') return '司机到达'
  if (log.to_status === 'FINISHED') return '任务完成'
  if (log.to_status === 'CANCELLED') return 'CRM 取消'
  return TASK_STATUS_LABELS[log.to_status] ?? log.to_status
}

function timelineContent(log: TaskStatusLog): string {
  const parts: string[] = []
  if (log.remark) parts.push(log.remark)
  const meta: string[] = []
  if (log.operator) meta.push(`操作人：${log.operator}`)
  if (log.source) meta.push(`来源：${log.source}`)
  if (meta.length) parts.push(meta.join(' · '))
  return parts.join('\n')
}

function timelineType(log: TaskStatusLog): 'success' | 'error' {
  return log.to_status === 'CANCELLED' ? 'error' : 'success'
}

// ---------------- 轨迹记录 ----------------
const trackColumns: DataTableColumns<TransportTrack> = [
  {
    title: '回传时间',
    key: 'report_time',
    width: 150,
    render: (row) => (row.report_time ? datetimeFull(row.report_time) : '-'),
  },
  {
    title: '位置描述',
    key: 'location_desc',
    minWidth: 180,
    ellipsis: { tooltip: true },
    render: (row) => row.location_desc || '-',
  },
  {
    title: '经纬度',
    key: 'lng_lat',
    width: 170,
    render: (row) => `${row.longitude}, ${row.latitude}`,
  },
  {
    title: '时速（km/h）',
    key: 'speed',
    width: 110,
    render: (row) => (row.speed != null && row.speed !== '' ? String(row.speed) : '-'),
  },
]

// ---------------- 电子签记录 ----------------
const esignColumns: DataTableColumns<EsignRecord> = [
  { title: '电子签 ID', key: 'esign_id', width: 150, render: (row) => row.esign_id || '-' },
  {
    title: 'VIN',
    key: 'vin',
    width: 190,
    ellipsis: { tooltip: true },
    render: (row) => row.vin || '-',
  },
  {
    title: '状态',
    key: 'sign_status',
    width: 100,
    render: (row) => h(StatusTag, { type: 'esign', value: row.sign_status }),
  },
  {
    title: '发起时间',
    key: 'initiate_time',
    width: 150,
    render: (row) => (row.initiate_time ? datetime(row.initiate_time) : '-'),
  },
  {
    title: '签署时间',
    key: 'sign_time',
    width: 150,
    render: (row) => (row.sign_time ? datetime(row.sign_time) : '-'),
  },
]
</script>

<template>
  <n-drawer
    :show="show"
    :width="'min(860px, 94vw)'"
    placement="right"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <n-drawer-content
      :title="`任务详情 · ${task?.task_no ?? ''}`"
      closable
      :native-scrollbar="false"
    >
      <!-- 加载失败 -->
      <div v-if="!loading && loadError" class="drawer-error">
        <n-empty description="详情加载失败">
          <template #extra>
            <div class="drawer-error__text">{{ loadError }}</div>
            <n-button size="small" type="primary" @click="loadDetail">重试</n-button>
          </template>
        </n-empty>
      </div>

      <n-spin v-else :show="loading">
        <div v-if="task" class="drawer-body">
          <!-- 基础信息 -->
          <DetailSection title="基础信息">
            <n-descriptions-item label="任务单号">{{ task.task_no }}</n-descriptions-item>
            <n-descriptions-item label="任务状态">
              <StatusTag type="task" :value="task.status" />
            </n-descriptions-item>
            <n-descriptions-item label="发运申请号">{{ task.apply_no }}</n-descriptions-item>
            <n-descriptions-item label="客户名称">{{ task.customer_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="大区">{{ task.region || '-' }}</n-descriptions-item>
            <n-descriptions-item label="销售人员">{{ task.sales_person || '-' }}</n-descriptions-item>
            <n-descriptions-item label="销售电话">
              {{ task.sales_phone ? formatPhone(task.sales_phone) : '-' }}
            </n-descriptions-item>
            <n-descriptions-item label="创建人">{{ task.create_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="创建时间">
              {{ task.create_time ? datetime(task.create_time) : '-' }}
            </n-descriptions-item>
            <n-descriptions-item label="备注（CRM）" :span="3">
              <span class="pre-wrap">{{ task.remark || '-' }}</span>
            </n-descriptions-item>
          </DetailSection>

          <!-- 车辆信息：仓库/库位 + 运费合计 + 多车明细表 -->
          <DetailSection title="车辆信息">
            <n-descriptions-item label="仓库">{{ task.factory || '-' }}</n-descriptions-item>
            <n-descriptions-item label="库位">{{ task.storage_location || '-' }}</n-descriptions-item>
            <n-descriptions-item label="VIN">{{ vinText }}</n-descriptions-item>
            <n-descriptions-item label="计划运费合计">
              <MoneyText :value="task.plan_freight" prefix="¥" bold />
            </n-descriptions-item>
            <n-descriptions-item label="实际运费合计">
              <span v-if="task.actual_freight !== null && task.actual_freight !== undefined && task.actual_freight !== ''">
                <MoneyText :value="task.actual_freight" prefix="¥" bold />
              </span>
              <span v-else class="muted">司机到达后回填</span>
            </n-descriptions-item>
          </DetailSection>
          <div class="drawer-section__table">
            <div class="drawer-section__caption">车辆明细（{{ vehicles.length }} 台）</div>
            <n-data-table
              :columns="vehicleColumns"
              :data="vehicles"
              :row-key="(row: ShippingTaskVehicle) => row.id ?? row.vin"
              size="small"
              :bordered="true"
              :scroll-x="1120"
            />
          </div>

          <!-- 发运信息：未回传节点显示「待回传」灰字 -->
          <DetailSection title="发运信息">
            <n-descriptions-item label="运输方式">{{ task.ship_method || '-' }}</n-descriptions-item>
            <n-descriptions-item label="发运地点">{{ task.ship_location || '-' }}</n-descriptions-item>
            <n-descriptions-item label="收车人电话">
              {{ task.receiver_phone ? formatPhone(task.receiver_phone) : '-' }}
            </n-descriptions-item>
            <n-descriptions-item label="交付地址" :span="3">
              {{ task.delivery_address || '-' }}
            </n-descriptions-item>
            <n-descriptions-item label="计划提车日期">
              <span v-if="task.plan_pickup_date">{{ dateOnly(task.plan_pickup_date) }}</span>
              <span v-else class="muted">待回传</span>
            </n-descriptions-item>
            <n-descriptions-item label="出库日期">
              <span v-if="task.outbound_date">{{ datetime(task.outbound_date) }}</span>
              <span v-else class="muted">待回传</span>
            </n-descriptions-item>
            <n-descriptions-item label="发运时间">
              <span v-if="task.ship_time">{{ datetime(task.ship_time) }}</span>
              <span v-else class="muted">待回传</span>
            </n-descriptions-item>
            <n-descriptions-item label="到达时间">
              <span v-if="task.arrive_time">{{ datetime(task.arrive_time) }}</span>
              <span v-else class="muted">待回传</span>
            </n-descriptions-item>
          </DetailSection>

          <!-- 承运信息 -->
          <DetailSection title="承运信息">
            <n-descriptions-item label="承运商">
              <span v-if="task.carrier_name">
                {{ task.carrier_name }}<template v-if="task.carrier_code">（{{ task.carrier_code }}）</template>
              </span>
              <span v-else class="muted">待派单</span>
            </n-descriptions-item>
            <n-descriptions-item label="司机">
              <span v-if="task.driver_name">{{ task.driver_name }}</span>
              <span v-else class="muted">承运商接单后分配</span>
            </n-descriptions-item>
            <n-descriptions-item label="司机电话">
              {{ task.driver_phone ? formatPhone(task.driver_phone) : '-' }}
            </n-descriptions-item>
            <n-descriptions-item label="派单备注" :span="3">
              <span class="pre-wrap">{{ dispatchRemark || '-' }}</span>
            </n-descriptions-item>
            <n-descriptions-item label="取消记录" :span="3">
              <template v-if="cancelRecords.length">
                <div class="cancel-records">
                  <div v-for="(item, index) in cancelRecords" :key="index" class="cancel-records__item">
                    {{ item }}
                  </div>
                </div>
              </template>
              <span v-else>-</span>
            </n-descriptions-item>
          </DetailSection>

          <!-- 运输时间轴 -->
          <section class="drawer-section">
            <div class="drawer-section__header">
              <span class="drawer-section__bar"></span>
              <h3 class="drawer-section__title">运输时间轴</h3>
            </div>
            <n-timeline v-if="statusLogs.length" class="drawer-section__timeline">
              <n-timeline-item
                v-for="(log, index) in statusLogs"
                :key="log.id ?? index"
                :type="timelineType(log)"
                :title="timelineNodeName(log)"
                :content="timelineContent(log)"
                :time="log.create_time ? datetimeFull(log.create_time) : undefined"
              />
            </n-timeline>
            <div v-else class="drawer-section__empty">暂无执行节点</div>
          </section>

          <!-- 轨迹记录（若有） -->
          <section v-if="tracks.length" class="drawer-section">
            <div class="drawer-section__header">
              <span class="drawer-section__bar"></span>
              <h3 class="drawer-section__title">轨迹记录（{{ tracks.length }} 条）</h3>
            </div>
            <n-data-table
              :columns="trackColumns"
              :data="tracks"
              :row-key="(row: TransportTrack) => row.id ?? row.report_time ?? row.longitude"
              size="small"
              :bordered="true"
              :scroll-x="610"
            />
          </section>

          <!-- 电子签记录（若有） -->
          <section v-if="esigns.length" class="drawer-section">
            <div class="drawer-section__header">
              <span class="drawer-section__bar"></span>
              <h3 class="drawer-section__title">电子签记录（{{ esigns.length }} 条）</h3>
            </div>
            <n-data-table
              :columns="esignColumns"
              :data="esigns"
              :row-key="(row: EsignRecord) => row.id ?? row.esign_id"
              size="small"
              :bordered="true"
              :scroll-x="740"
            />
          </section>
        </div>
      </n-spin>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.drawer-body {
  padding-right: 4px;
}

.drawer-error {
  padding: 80px 0;
}

.drawer-error__text {
  margin-bottom: 12px;
  font-size: 13px;
  color: #8c8c8c;
}

.muted {
  color: #bfbfbf;
}

.pre-wrap {
  white-space: pre-wrap;
  word-break: break-all;
}

/* 与 DetailSection 分区头一致的样式（承载表格/时间轴类分区），对齐旧版 sec-title */
.drawer-section {
  margin-bottom: 20px;
}

.drawer-section__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.drawer-section__bar {
  flex: none;
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: #1677ff;
}

.drawer-section__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #262626;
  line-height: 1.4;
}

/* DetailSection 分区头对齐旧版 sec-title（主色竖条 + 主文本色；公共组件不在此修改） */
:deep(.detail-section__header .detail-section__bar) {
  background: #1677ff;
}

:deep(.detail-section__header .detail-section__title) {
  color: #262626;
}

.drawer-section__table {
  margin: -8px 0 20px;
}

.drawer-section__caption {
  margin-bottom: 8px;
  font-size: 13px;
  color: #595959;
}

.drawer-section__timeline {
  padding: 4px 2px 0;
}

.drawer-section__empty {
  padding: 12px 0;
  font-size: 13px;
  color: #bfbfbf;
}

.cancel-records {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cancel-records__item {
  line-height: 1.6;
}
</style>
