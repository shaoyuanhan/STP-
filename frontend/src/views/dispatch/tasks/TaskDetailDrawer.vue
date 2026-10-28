<script setup lang="ts">
/**
 * 任务详情抽屉（契约 5.4 / PRD 3.③⑦）
 *
 * 分区：基础信息（含 CRM 备注）/ 物料明细（一车一单单车明细 + 仓库库位 + 运费）/
 *       发运信息（未回传节点显示「待回传」灰字）/ 承运信息（派单备注 + 取消记录）/
 *       运输时间轴（status_log）/ 轨迹记录（若有）
 *
 * 说明：基础信息/发运信息/承运信息用公共 DetailSection；
 *       车辆信息/时间轴/轨迹含表格或时间轴组件，
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
  ShippingTask,
  ShippingTaskDetail,
  ShippingTaskVehicle,
  TaskStatusLog,
} from '@/types/api'
import { describeApiError, TASK_STATUS_LABELS } from './shared'

/**
 * 详情 head 扩展：后端详情 SQL 返回 c.carrier_code，
 * types/api.ts 的 ShippingTask 未声明，本地扩展承接（不修改公共类型）。
 */
interface TaskHeadExt extends ShippingTask {
  carrier_code?: string | null
  transport_no?: string | null
  estimated_arrive_time?: string | null
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

// ---------------- 物料明细表 ----------------
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
        : h('span', { style: 'color:#999999' }, '到达后回填'),
  },
]

// ---------------- 运输时间轴（status_log 数据驱动，节点名对齐 PRD） ----------------
/** 时间轴折叠（默认展开） */
const timelineCollapsed = ref(false)

const PHOTO_URL_RE = /https?:\/\/[^\s；;，,]+/g
const IMG_EXT_RE = /\.(?:jpe?g|png|webp|gif|bmp)(?:\?\S*)?$/i

/** 提车照片：优先取结构化 photos 字段，历史数据兜底从 remark 提取完整图片链接 */
function logPhotos(log: TaskStatusLog): string[] {
  if (log.photos) {
    try {
      const parsed = JSON.parse(log.photos)
      if (Array.isArray(parsed)) {
        return parsed.map((url) => String(url)).filter((url) => /^https?:\/\//i.test(url))
      }
    } catch {
      // 非 JSON 时走 remark 兜底
    }
  }
  if (!log.remark) return []
  return (log.remark.match(PHOTO_URL_RE) ?? []).filter((url) => IMG_EXT_RE.test(url))
}

function timelineNodeName(log: TaskStatusLog): string {
  if (log.to_status === 'WAIT_DISPATCH') {
    return log.from_status ? '取消派单，回退待派单' : 'CRM 下发发运申请'
  }
  if (log.to_status === 'DISPATCHED') return log.from_status === 'CARRIER_ACCEPTED' ? '承运商取消接单' : '调度派单'
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
  // 照片单独以缩略图呈现，正文剥离 remark 中的照片 URL 串，避免撑开节点
  const remark = logPhotos(log).length
    ? (log.remark ?? '').replace(/[；;]\s*提车照片[:：][\s\S]*$/, '')
    : log.remark
  if (remark) parts.push(remark)
  const sourceLabels: Record<string, string> = {
    STP: 'STP 系统', CRM: 'CRM 系统', SQ: '狮桥物流', CARRIER: '承运商', WMS: 'WMS 系统',
  }
  const meta: string[] = []
  if (log.operator) meta.push(`操作人：${log.operator}`)
  if (log.source) meta.push(`来源：${sourceLabels[log.source] ?? log.source}`)
  if (meta.length) parts.push(meta.join(' · '))
  return parts.join('\n')
}

function timelineType(log: TaskStatusLog): 'success' | 'error' {
  return log.to_status === 'CANCELLED' ? 'error' : 'success'
}

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
            <n-descriptions-item label="订单号">{{ task.order_no || '-' }}</n-descriptions-item>
            <n-descriptions-item label="发运申请单号">{{ task.apply_no || '-' }}</n-descriptions-item>
            <n-descriptions-item label="客户名称（合同主体）">{{ task.customer_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="大区">{{ task.region || '-' }}</n-descriptions-item>
            <n-descriptions-item label="销售人员姓名">{{ task.sales_person || '-' }}</n-descriptions-item>
            <n-descriptions-item label="销售人员联系方式">
              {{ task.sales_phone ? formatPhone(task.sales_phone) : '-' }}
            </n-descriptions-item>
            <n-descriptions-item label="创建人">{{ task.create_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="创建日期">
              {{ task.create_time ? dateOnly(task.create_time) : '-' }}
            </n-descriptions-item>
            <n-descriptions-item label="备注" :span="3">
              <span class="pre-wrap">{{ task.remark || '-' }}</span>
            </n-descriptions-item>
          </DetailSection>

          <!-- 物料明细：仓库/库位与运费已并入发运信息，此处只保留多物料清单 -->
          <div class="drawer-section__table">
            <div class="stp-section-title">物料明细</div>
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
            <n-descriptions-item label="出库仓库">{{ task.factory || '-' }}</n-descriptions-item>
            <n-descriptions-item label="出库储位">{{ task.storage_location || '-' }}</n-descriptions-item>
            <n-descriptions-item label="发运方式">{{ task.ship_method || '-' }}</n-descriptions-item>
            <n-descriptions-item label="交付地区">{{ task.delivery_area || '-' }}</n-descriptions-item>
            <n-descriptions-item label="接车联系人">{{ task.receiver_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="接车联系人电话">
              {{ task.receiver_phone ? formatPhone(task.receiver_phone) : '-' }}
            </n-descriptions-item>
            <n-descriptions-item label="交付地址" :span="3">
              {{ task.delivery_address || '-' }}
            </n-descriptions-item>
            <n-descriptions-item label="计划提车日期">
              <span v-if="task.plan_pickup_date">{{ dateOnly(task.plan_pickup_date) }}</span>
              <span v-else class="muted">待回传</span>
            </n-descriptions-item>
            <n-descriptions-item label="发运时间">
              <span v-if="task.ship_time">{{ datetime(task.ship_time) }}</span>
              <span v-else class="muted">待回传</span>
            </n-descriptions-item>
            <n-descriptions-item label="出库时间">
              <span v-if="task.outbound_date">{{ datetime(task.outbound_date) }}</span>
              <span v-else class="muted">待回传</span>
            </n-descriptions-item>
            <n-descriptions-item label="到达时间">
              <span v-if="task.arrive_time">{{ datetime(task.arrive_time) }}</span>
              <span v-else class="muted">待回传</span>
            </n-descriptions-item>
            <n-descriptions-item label="里程">
              <span v-if="task.mileage !== null && task.mileage !== undefined && task.mileage !== ''">
                {{ task.mileage }} km
              </span>
              <span v-else class="muted">CRM 未下发</span>
            </n-descriptions-item>
            <n-descriptions-item label="计划运费">
              <MoneyText :value="task.plan_freight" prefix="¥" bold />
            </n-descriptions-item>
            <n-descriptions-item label="实际运费">
              <span v-if="task.actual_freight !== null && task.actual_freight !== undefined && task.actual_freight !== ''">
                <MoneyText :value="task.actual_freight" prefix="¥" bold />
              </span>
              <span v-else class="muted">司机到达后回填</span>
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
            <n-descriptions-item label="承运单号">{{ task.transport_no || '-' }}</n-descriptions-item>
            <n-descriptions-item label="预计到达时间">
              {{ task.estimated_arrive_time ? datetime(task.estimated_arrive_time) : '-' }}
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
              <h3 class="stp-section-title drawer-section__title">运输时间轴</h3>
              <button
                v-if="statusLogs.length"
                type="button"
                class="drawer-section__toggle"
                @click="timelineCollapsed = !timelineCollapsed"
              >
                {{ timelineCollapsed ? '展开' : '收起' }}
                <span class="drawer-section__arrow" :class="{ 'is-collapsed': timelineCollapsed }">▾</span>
              </button>
            </div>
            <div v-show="!timelineCollapsed">
              <n-timeline v-if="statusLogs.length" class="drawer-section__timeline">
                <n-timeline-item
                  v-for="(log, index) in statusLogs"
                  :key="log.id ?? index"
                  :type="timelineType(log)"
                  :title="timelineNodeName(log)"
                  :time="log.create_time ? datetimeFull(log.create_time) : undefined"
                >
                  <div class="tl-body">
                    <div class="tl-text">{{ timelineContent(log) }}</div>
                    <n-image-group v-if="logPhotos(log).length">
                      <div class="tl-photos" :class="{ 'tl-photos--compact': logPhotos(log).length >= 4 }">
                        <n-image
                          v-for="(url, photoIndex) in logPhotos(log)"
                          :key="photoIndex"
                          :src="url"
                          :width="logPhotos(log).length >= 4 ? 56 : 76"
                          :height="logPhotos(log).length >= 4 ? 56 : 76"
                          object-fit="cover"
                          class="tl-photo"
                        />
                      </div>
                    </n-image-group>
                  </div>
                </n-timeline-item>
              </n-timeline>
              <div v-else class="drawer-section__empty">暂无执行节点</div>
            </div>
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
  font-size: 14px;
  color: #666666;
}

.muted {
  color: #999999;
}

.pre-wrap {
  white-space: pre-wrap;
  word-break: break-all;
}

.drawer-section {
  margin-bottom: 20px;
}

.drawer-section__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.drawer-section__title {
  margin: 0;
}

.drawer-section__table {
  margin: -8px 0 20px;
}

.drawer-section__timeline {
  padding: 4px 2px 0;
}

.drawer-section__toggle {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: none;
  background: none;
  font-size: 14px;
  color: #666666;
  cursor: pointer;
}

.drawer-section__toggle:hover {
  color: #1890ff;
}

.drawer-section__arrow {
  display: inline-block;
  font-size: 12px;
  line-height: 1;
  transition: transform 0.2s;
}

.drawer-section__arrow.is-collapsed {
  transform: rotate(-90deg);
}

.tl-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tl-text {
  white-space: pre-line;
  font-size: 14px;
  line-height: 1.6;
  color: #666666;
}

.tl-photos {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tl-photo {
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid #eeeeee;
  background: #fafafa;
}

.drawer-section__empty {
  padding: 12px 0;
  font-size: 14px;
  color: #999999;
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
