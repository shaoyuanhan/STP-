<script setup lang="ts">
/**
 * 承运商 - 任务详情
 * 展示任务信息、车辆明细、状态时间轴、节点照片；待接单任务在此指派司机
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import StatusBadge from '@/components/portal/StatusBadge.vue'
import AssignDriverModal from '@/components/portal/AssignDriverModal.vue'
import { fetchCarrierTask, statusLabel } from '@/services/portal'
import type { PortalTaskDetail } from '@/services/portal'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const loading = ref(false)
const detail = ref<PortalTaskDetail | null>(null)
const showAssign = ref(false)

const taskId = computed(() => Number(route.params.id))

const FILE_LABELS: Record<string, string> = {
  PICKUP: '提车照片',
  ARRIVE: '到达照片',
  FINISH: '结单照片',
}

const photoGroups = computed(() => {
  const files = detail.value?.files ?? []
  const map = new Map<string, typeof files>()
  files.forEach((f) => {
    const key = f.biz_type || 'OTHER'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(f)
  })
  return [...map.entries()].map(([type, items]) => ({
    type,
    label: FILE_LABELS[type] || type,
    items,
  }))
})

const timeline = computed(() =>
  (detail.value?.status_logs ?? []).map((log) => ({
    key: log.id,
    time: log.create_time,
    title: statusLabel(log.to_status),
    from: log.from_status ? statusLabel(log.from_status) : '',
    source: log.source,
    operator: log.operator,
    remark: log.remark,
  }))
)

async function load() {
  loading.value = true
  try {
    detail.value = await fetchCarrierTask(taskId.value)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '任务加载失败')
  } finally {
    loading.value = false
  }
}

function onAssigned() {
  load()
}

onMounted(load)
</script>

<template>
  <div class="stp-page">
    <n-spin :show="loading">
      <div class="page-toolbar">
        <span class="page-toolbar__hint">任务详情</span>
        <a class="link" @click="router.push('/portal/carrier/tasks')">← 返回任务列表</a>
      </div>

      <template v-if="detail">
        <section class="card detail-top">
          <div class="panel-head">
            <span>任务信息</span>
            <div class="panel-actions">
              <StatusBadge :status="detail.task.status" />
              <n-button
                v-if="detail.task.status === 'DISPATCHED'"
                size="small"
                type="primary"
                @click="showAssign = true"
              >
                接单并指派司机
              </n-button>
            </div>
          </div>
          <div class="detail-top__body">
            <div class="detail-no">{{ detail.task.task_no }}</div>
            <div class="detail-meta">
              {{ detail.task.customer_name }} · {{ detail.task.ship_location || '-' }} →
              {{ detail.task.delivery_area || '-' }}
            </div>
            <div class="detail-grid">
              <div class="detail-item">
                <span>计划运费</span>
                <b>{{ detail.task.plan_freight == null ? '-' : `¥ ${Number(detail.task.plan_freight).toFixed(2)}` }}</b>
              </div>
              <div class="detail-item">
                <span>实际运费</span>
                <b>{{ detail.task.actual_freight == null ? '待司机回填' : `¥ ${Number(detail.task.actual_freight).toFixed(2)}` }}</b>
              </div>
              <div class="detail-item">
                <span>计划提车日期</span>
                <b>{{ detail.task.plan_pickup_date || '-' }}</b>
              </div>
              <div class="detail-item">
                <span>实际提车时间</span>
                <b>{{ detail.task.ship_time || '-' }}</b>
              </div>
              <div class="detail-item">
                <span>出库时间</span>
                <b>{{ detail.task.outbound_date || '-' }}</b>
              </div>
              <div class="detail-item">
                <span>到达时间</span>
                <b>{{ detail.task.arrive_time || '-' }}</b>
              </div>
              <div class="detail-item">
                <span>完结时间</span>
                <b>{{ detail.task.finish_time || '-' }}</b>
              </div>
              <div class="detail-item">
                <span>里程</span>
                <b>{{ detail.task.mileage == null ? '-' : `${detail.task.mileage} km` }}</b>
              </div>
              <div class="detail-item">
                <span>司机</span>
                <b>{{ detail.task.driver_name ? `${detail.task.driver_name} · ${detail.task.driver_phone || ''}` : '待指派' }}</b>
              </div>
              <div class="detail-item">
                <span>交付地址</span>
                <b>{{ detail.task.delivery_address || detail.task.delivery_area || '-' }}</b>
              </div>
              <div class="detail-item">
                <span>发运申请号</span>
                <b>{{ detail.task.apply_no || '-' }}</b>
              </div>
              <div class="detail-item">
                <span>任务创建时间</span>
                <b>{{ detail.task.create_time || '-' }}</b>
              </div>
            </div>
          </div>
        </section>

        <div class="detail-cols">
          <section class="card">
            <div class="panel-head"><span>车辆明细</span></div>
            <div class="card-body card-body--table">
              <n-table :single-line="false" size="small">
                <thead>
                  <tr>
                    <th>VIN</th>
                    <th>车型</th>
                    <th>发动机配置</th>
                    <th>驾驶室</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="v in detail.vehicles" :key="v.id">
                    <td>{{ v.vin }}</td>
                    <td>{{ v.vehicle_model || '-' }}</td>
                    <td>{{ v.engine_config || '-' }}</td>
                    <td>{{ v.cabin_type || '-' }}</td>
                  </tr>
                  <tr v-if="!detail.vehicles.length">
                    <td colspan="4" class="empty-row">暂无车辆明细</td>
                  </tr>
                </tbody>
              </n-table>
            </div>
          </section>

          <section class="card">
            <div class="panel-head"><span>状态流转</span></div>
            <div class="card-body">
              <n-timeline v-if="timeline.length">
                <n-timeline-item
                  v-for="item in timeline"
                  :key="item.key"
                  :title="item.title"
                  :time="item.time"
                  type="success"
                >
                  <div class="log-line">
                    <span class="log-tag">{{ item.source }}</span>
                    <span>{{ item.operator || '-' }}</span>
                  </div>
                  <div v-if="item.remark" class="log-remark">{{ item.remark }}</div>
                </n-timeline-item>
              </n-timeline>
              <div v-else class="empty-row">暂无流转记录</div>
            </div>
          </section>
        </div>

        <section class="card">
          <div class="panel-head"><span>节点照片</span></div>
          <div class="card-body">
            <div v-if="!photoGroups.length" class="empty-row">暂无照片</div>
            <div v-for="group in photoGroups" :key="group.type" class="photo-group">
              <div class="photo-label">{{ group.label }}（{{ group.items.length }} 张）</div>
              <div class="photo-grid">
                <a
                  v-for="file in group.items"
                  :key="file.id"
                  :href="file.file_url"
                  target="_blank"
                  class="photo"
                >
                  <img :src="file.file_url" :alt="group.label" />
                  <span class="photo-time">{{ file.create_time }}</span>
                </a>
              </div>
            </div>
          </div>
        </section>
      </template>

      <div v-else-if="!loading" class="card empty-row">任务不存在或无权查看</div>
    </n-spin>

    <AssignDriverModal
      v-if="detail"
      v-model:show="showAssign"
      :task-id="detail.task.id"
      :task-no="detail.task.task_no"
      :version="detail.task.version"
      @assigned="onAssigned"
    />
  </div>
</template>

<style scoped>
.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.page-toolbar__hint {
  font-size: 12px;
  color: #8c8c8c;
}
.link {
  color: #1677ff;
  cursor: pointer;
  font-size: 12px;
}
.link:hover {
  color: #4096ff;
}
.card {
  background: #ffffff;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04);
  margin-bottom: 12px;
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
.panel-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.card-body {
  padding: 14px 16px;
}
.card-body--table {
  padding: 12px 16px 16px;
}
.detail-top__body {
  padding: 14px 16px 16px;
}
.detail-no {
  font-size: 16px;
  font-weight: 600;
  color: #262626;
}
.detail-meta {
  margin-top: 4px;
  font-size: 12px;
  color: #8c8c8c;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px 20px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #f0f0f0;
}
.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.detail-item span {
  font-size: 12px;
  color: #8c8c8c;
}
.detail-item b {
  font-size: 13px;
  font-weight: 500;
  color: #262626;
  word-break: break-all;
}
.detail-cols {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
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
.photo-group + .photo-group {
  margin-top: 14px;
}
.photo-label {
  font-size: 12px;
  color: #8c8c8c;
  margin-bottom: 8px;
}
.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 10px;
}
.photo {
  position: relative;
  display: block;
  aspect-ratio: 4 / 3;
  border-radius: 4px;
  overflow: hidden;
  background: #fafafa;
  border: 1px solid #f0f0f0;
}
.photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.photo-time {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 2px 6px;
  font-size: 10px;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
}
@media (max-width: 1000px) {
  .detail-cols {
    grid-template-columns: 1fr;
  }
}
</style>
