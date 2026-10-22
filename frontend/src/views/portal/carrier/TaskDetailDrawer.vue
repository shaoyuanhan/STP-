<script setup lang="ts">
/**
 * 承运商 - 任务详情抽屉（与发运任务详情保持一致的交互：右侧抽屉查看，不跳页）
 * 分区：基本信息 / 车辆明细 / 状态流转 / 节点照片；待接单任务可直接接单并指派司机
 */
import { computed, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import StatusBadge from '@/components/portal/StatusBadge.vue'
import AssignDriverModal from '@/components/portal/AssignDriverModal.vue'
import DetailSection from '@/components/DetailSection.vue'
import { fetchCarrierTask, statusLabel } from '@/services/portal'
import type { PortalTaskDetail } from '@/services/portal'
import { datetime, datetimeFull } from '@/utils/format'

const props = defineProps<{
  show: boolean
  taskId: number | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'changed'): void
}>()

const message = useMessage()

const loading = ref(false)
const detail = ref<PortalTaskDetail | null>(null)
const showAssign = ref(false)

/** 节点照片：status_log.photos 存 JSON 数组（/static 相对路径或完整 URL） */
function logPhotos(log: { photos?: string | null }) {
  if (!log.photos) return []
  try {
    const parsed = JSON.parse(log.photos)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed
      .map((url) => String(url))
      .filter((url) => url.startsWith('/static/') || /^https?:\/\//i.test(url)))]
  } catch {
    return []
  }
}

const timeline = computed(() =>
  (detail.value?.status_logs ?? []).map((log) => ({
    key: log.id,
    time: log.create_time,
    title: statusLabel(log.to_status),
    source: log.source,
    operator: log.operator,
    remark: log.remark,
    photos: logPhotos(log),
  }))
)

async function load() {
  if (!props.taskId) return
  loading.value = true
  try {
    detail.value = await fetchCarrierTask(props.taskId)
  } catch (e) {
    detail.value = null
    message.error(e instanceof Error ? e.message : '任务加载失败')
  } finally {
    loading.value = false
  }
}

function onAssigned() {
  load()
  emit('changed')
}

watch(
  () => [props.show, props.taskId],
  ([visible]) => {
    if (visible) load()
  },
)

function money(value: string | number | null | undefined, fallback: string) {
  return value == null ? fallback : `¥ ${Number(value).toFixed(2)}`
}
</script>

<template>
  <n-drawer
    :show="show"
    :width="'min(900px, 94vw)'"
    placement="right"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <n-drawer-content closable :native-scrollbar="false">
      <template #header>
        <div class="drawer-head">
          <span class="drawer-head__title">
            {{ detail ? `任务详情 · ${detail.task.task_no}` : '任务详情' }}
          </span>
          <n-button
            v-if="detail?.task.status === 'DISPATCHED'"
            size="small"
            type="primary"
            @click="showAssign = true"
          >
            接单并指派司机
          </n-button>
        </div>
      </template>

      <n-spin :show="loading">
        <template v-if="detail">
          <DetailSection title="基本信息">
            <n-descriptions-item label="任务单号">{{ detail.task.task_no }}</n-descriptions-item>
            <n-descriptions-item label="任务状态">
              <StatusBadge :status="detail.task.status" />
            </n-descriptions-item>
            <n-descriptions-item label="发运申请单号">{{ detail.task.apply_no || '-' }}</n-descriptions-item>
            <n-descriptions-item label="客户名称">{{ detail.task.customer_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="承运商">{{ detail.task.carrier_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="司机">
              <span v-if="detail.task.driver_name">{{ detail.task.driver_name }}</span>
              <span v-else class="muted">待指派</span>
            </n-descriptions-item>
            <n-descriptions-item label="司机电话">{{ detail.task.driver_phone || '-' }}</n-descriptions-item>
            <n-descriptions-item label="计划提车日期">{{ detail.task.plan_pickup_date || '-' }}</n-descriptions-item>
            <n-descriptions-item label="创建时间">
              {{ detail.task.create_time ? datetimeFull(detail.task.create_time) : '-' }}
            </n-descriptions-item>
            <n-descriptions-item label="发运时间">
              <span v-if="detail.task.ship_time">{{ datetime(detail.task.ship_time) }}</span>
              <span v-else class="muted">待回传</span>
            </n-descriptions-item>
            <n-descriptions-item label="出库时间">
              <span v-if="detail.task.outbound_date">{{ datetime(detail.task.outbound_date) }}</span>
              <span v-else class="muted">待回传</span>
            </n-descriptions-item>
            <n-descriptions-item label="到达时间">
              <span v-if="detail.task.arrive_time">{{ datetime(detail.task.arrive_time) }}</span>
              <span v-else class="muted">待回传</span>
            </n-descriptions-item>
            <n-descriptions-item label="里程">
              <span v-if="detail.task.mileage != null">{{ detail.task.mileage }} km</span>
              <span v-else class="muted">-</span>
            </n-descriptions-item>
            <n-descriptions-item label="计划运费">{{ money(detail.task.plan_freight, '-') }}</n-descriptions-item>
            <n-descriptions-item label="实际运费">
              <span v-if="detail.task.actual_freight != null">{{ money(detail.task.actual_freight, '-') }}</span>
              <span v-else class="muted">司机到达后回填</span>
            </n-descriptions-item>
            <n-descriptions-item label="交付地址" :span="3">
              {{ detail.task.delivery_address || detail.task.delivery_area || '-' }}
            </n-descriptions-item>
          </DetailSection>

          <section class="drawer-section">
            <div class="drawer-section__header">
              <span class="drawer-section__bar"></span>
              <h3 class="drawer-section__title">车辆明细</h3>
              <span class="drawer-section__extra">共 {{ detail.vehicles.length }} 台</span>
            </div>
            <div class="table-scroll-x">
              <n-table :single-line="false" size="small">
                <thead>
                  <tr>
                    <th>VIN</th>
                    <th>订单号</th>
                    <th>报单号</th>
                    <th>车型</th>
                    <th>发动机配置</th>
                    <th>驾驶室</th>
                    <th>发运地点</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="v in detail.vehicles" :key="v.id">
                    <td>{{ v.vin }}</td>
                    <td>{{ v.order_no || '-' }}</td>
                    <td>{{ v.report_no || '-' }}</td>
                    <td>{{ v.vehicle_model || '-' }}</td>
                    <td>{{ v.engine_config || '-' }}</td>
                    <td>{{ v.cabin_type || '-' }}</td>
                    <td>{{ v.ship_location || '-' }}</td>
                  </tr>
                  <tr v-if="!detail.vehicles.length">
                    <td colspan="7" class="empty-row">暂无车辆明细</td>
                  </tr>
                </tbody>
              </n-table>
            </div>
          </section>

          <section class="drawer-section">
            <div class="drawer-section__header">
              <span class="drawer-section__bar"></span>
              <h3 class="drawer-section__title">状态流转</h3>
            </div>
            <n-timeline v-if="timeline.length">
              <n-timeline-item
                v-for="item in timeline"
                :key="item.key"
                :title="item.title"
                :time="item.time ? datetimeFull(item.time) : undefined"
                type="success"
              >
                <div class="log-line">
                  <span class="log-tag">{{ item.source }}</span>
                  <span>{{ item.operator || '-' }}</span>
                </div>
                <div v-if="item.remark" class="log-remark">{{ item.remark }}</div>
                <n-image-group v-if="item.photos.length">
                  <div class="log-photos">
                    <n-image
                      v-for="(url, index) in item.photos"
                      :key="index"
                      :src="url"
                      :width="76"
                      :height="76"
                      object-fit="cover"
                      class="log-photo"
                    />
                  </div>
                </n-image-group>
              </n-timeline-item>
            </n-timeline>
            <div v-else class="empty-row">暂无流转记录</div>
          </section>
        </template>

        <div v-else-if="!loading" class="empty-row">任务不存在或无权查看</div>
      </n-spin>

      <AssignDriverModal
        v-if="detail"
        v-model:show="showAssign"
        :task-id="detail.task.id"
        :task-no="detail.task.task_no"
        :version="detail.task.version"
        :carrier-id="detail.task.carrier_id"
        @assigned="onAssigned"
      />
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.muted {
  color: #bfbfbf;
}
.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.drawer-head__title {
  color: #262626;
  font-size: 15px;
  font-weight: 600;
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
.drawer-section__extra {
  color: #8c8c8c;
  font-size: 12px;
}
.table-scroll-x {
  overflow-x: auto;
}
.table-scroll-x :deep(table) {
  min-width: 940px;
}
.table-scroll-x :deep(th),
.table-scroll-x :deep(td) {
  white-space: nowrap;
}
.empty-row {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: #bfbfbf;
}
.log-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #595959;
}
.log-tag {
  padding: 1px 6px;
  border-radius: 3px;
  background: #f0f7ff;
  color: #1677ff;
  font-size: 11px;
}
.log-remark {
  margin-top: 2px;
  font-size: 12px;
  color: #8c8c8c;
  line-height: 1.6;
}
.log-photos {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.log-photo {
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid #f0f0f0;
  background: #fafafa;
}
</style>
