<script setup lang="ts">
/**
 * 司机端 - 任务详情与节点操作（H5）
 * 提车（照片强制）→ 等待 WMS 出库 → 到达（在途才可操作，回填实际运费）→ 结单
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import StatusBadge from '@/components/portal/StatusBadge.vue'
import PhotoUploader from '@/components/portal/PhotoUploader.vue'
import {
  devWmsOutbound, driverArrive, driverFinish, driverPickup,
  fetchDriverTask, statusLabel,
} from '@/services/portal'
import type { PortalTaskDetail } from '@/services/portal'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const loading = ref(false)
const submitting = ref(false)
const detail = ref<PortalTaskDetail | null>(null)
const taskId = computed(() => Number(route.params.id))

const action = computed(() => detail.value?.allowed_actions?.[0] ?? '')
const task = computed(() => detail.value?.task)

const sheet = reactive<{ show: boolean; type: 'PICKUP' | 'ARRIVE' | 'FINISH' | '' }>({
  show: false,
  type: '',
})

const pickupForm = reactive({ photos: [] as string[], pickup_date: null as string | null })
const arriveForm = reactive({ photos: [] as string[], actual_freight: null as number | null, mileage: null as number | null })
const finishForm = reactive({ photos: [] as string[], receiver: '', remark: '' })

const minPhotos = computed(() => detail.value?.pickup_photo_min ?? 1)

const timeline = computed(() =>
  (detail.value?.status_logs ?? []).map((log) => ({
    id: log.id,
    time: log.create_time,
    title: statusLabel(log.to_status),
    source: log.source,
    operator: log.operator,
    remark: log.remark,
    photos: log.photos ? (JSON.parse(log.photos) as string[]) : [],
  }))
)

const photoGroups = computed(() => {
  const labels: Record<string, string> = { PICKUP: '提车照片', ARRIVE: '到达照片', FINISH: '结单照片' }
  const map = new Map<string, NonNullable<PortalTaskDetail['files']>>()
  ;(detail.value?.files ?? []).forEach((f) => {
    if (!map.has(f.biz_type)) map.set(f.biz_type, [])
    map.get(f.biz_type)!.push(f)
  })
  return [...map.entries()].map(([type, items]) => ({ type, label: labels[type] || type, items }))
})

const sheetTitle = computed(() => {
  if (sheet.type === 'PICKUP') return '确认提车'
  if (sheet.type === 'ARRIVE') return '确认到达'
  return '完成交接并结单'
})

async function load() {
  loading.value = true
  try {
    detail.value = await fetchDriverTask(taskId.value)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '任务加载失败')
  } finally {
    loading.value = false
  }
}

function openSheet(type: 'PICKUP' | 'ARRIVE' | 'FINISH') {
  sheet.type = type
  sheet.show = true
  if (type === 'PICKUP') {
    pickupForm.photos = []
    pickupForm.pickup_date = null
  } else if (type === 'ARRIVE') {
    arriveForm.photos = []
    arriveForm.actual_freight = task.value?.plan_freight == null ? null : Number(task.value.plan_freight)
    arriveForm.mileage = task.value?.mileage == null ? null : Number(task.value.mileage)
  } else {
    finishForm.photos = []
    finishForm.receiver = ''
    finishForm.remark = ''
  }
}

function closeSheet() {
  if (submitting.value) return
  sheet.show = false
}

async function submit() {
  if (!detail.value) return
  const version = detail.value.task.version
  submitting.value = true
  try {
    if (sheet.type === 'PICKUP') {
      if (pickupForm.photos.length < minPhotos.value) {
        message.warning(`请至少上传 ${minPhotos.value} 张提车照片`)
        return
      }
      await driverPickup(taskId.value, {
        version,
        photos: pickupForm.photos,
        pickup_date: pickupForm.pickup_date || undefined,
      })
      message.success('提车确认成功，等待仓库出库')
    } else if (sheet.type === 'ARRIVE') {
      if (!arriveForm.actual_freight || arriveForm.actual_freight <= 0) {
        message.warning('请填写实际运费')
        return
      }
      const res = await driverArrive(taskId.value, {
        version,
        photos: arriveForm.photos,
        actual_freight: arriveForm.actual_freight,
        mileage: arriveForm.mileage,
      })
      message.success(`到达确认成功，运费单 ${res.freight_no}`)
    } else {
      await driverFinish(taskId.value, {
        version,
        photos: finishForm.photos,
        receiver: finishForm.receiver || undefined,
        remark: finishForm.remark || undefined,
      })
      message.success('任务已结单')
    }
    sheet.show = false
    await load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
    await load()
  } finally {
    submitting.value = false
  }
}

async function simulateOutbound() {
  submitting.value = true
  try {
    await devWmsOutbound(taskId.value)
    message.success('已模拟 WMS 出库，任务进入在途')
    await load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
    await load()
  } finally {
    submitting.value = false
  }
}

function money(v: string | number | null | undefined) {
  return v == null ? '-' : `¥${Number(v).toFixed(2)}`
}

onMounted(load)
</script>

<template>
  <div class="ddetail">
    <div class="ddetail__bar">
      <button type="button" class="ddetail__back" @click="router.push('/m/tasks')">←</button>
      <span>任务详情</span>
      <span class="ddetail__bar-right" />
    </div>

    <n-spin :show="loading">
      <template v-if="detail && task">
        <section class="ddetail__hero">
          <div class="ddetail__hero-top">
            <span class="ddetail__no">{{ task.task_no }}</span>
            <StatusBadge :status="task.status" size="small" />
          </div>
          <div class="ddetail__route">
            <div class="ddetail__route-row">
              <i class="ddetail__pin ddetail__pin--from">提</i>
              <span>{{ task.ship_location || '-' }}</span>
            </div>
            <div class="ddetail__route-line" />
            <div class="ddetail__route-row">
              <i class="ddetail__pin ddetail__pin--to">送</i>
              <span>{{ task.delivery_address || task.delivery_area || '-' }}</span>
            </div>
          </div>
        </section>

        <section class="ddetail__card">
          <div class="ddetail__row"><span>客户</span><b>{{ task.customer_name }}</b></div>
          <div class="ddetail__row"><span>VIN</span><b>{{ task.vins || '-' }}</b></div>
          <div class="ddetail__row"><span>计划提车日期</span><b>{{ task.plan_pickup_date || '-' }}</b></div>
          <div class="ddetail__row">
            <span>计划运费</span>
            <b class="ddetail__money">{{ money(task.plan_freight) }}</b>
          </div>
          <div v-if="task.actual_freight != null" class="ddetail__row">
            <span>实际运费（已回填）</span>
            <b class="ddetail__money">{{ money(task.actual_freight) }}</b>
          </div>
          <div v-if="task.ship_time" class="ddetail__row"><span>提车时间</span><b>{{ task.ship_time }}</b></div>
          <div v-if="task.arrive_time" class="ddetail__row"><span>到达时间</span><b>{{ task.arrive_time }}</b></div>
          <div v-if="task.finish_time" class="ddetail__row"><span>结单时间</span><b>{{ task.finish_time }}</b></div>
        </section>

        <section v-if="action" class="ddetail__action">
          <template v-if="action === 'PICKUP'">
            <div class="ddetail__hint">请核对车辆后拍摄提车照片并确认提车</div>
            <n-button type="primary" size="large" block @click="openSheet('PICKUP')">确认提车</n-button>
          </template>
          <template v-else-if="action === 'WAIT_OUTBOUND'">
            <div class="ddetail__hint">已提车，等待仓库出库。出库后任务进入在途，即可确认到达。</div>
            <div v-if="detail.dev_tools" class="ddetail__dev">
              <span>本地演示工具</span>
              <n-button size="small" :loading="submitting" @click="simulateOutbound">模拟 WMS 出库</n-button>
            </div>
          </template>
          <template v-else-if="action === 'ARRIVE'">
            <div class="ddetail__hint">车辆在途，到达后请回填实际运费并确认到达</div>
            <n-button type="primary" size="large" block @click="openSheet('ARRIVE')">确认到达</n-button>
          </template>
          <template v-else-if="action === 'FINISH'">
            <div class="ddetail__hint">已到达，请与客户完成车辆交接后结单</div>
            <n-button type="primary" size="large" block @click="openSheet('FINISH')">完成交接并结单</n-button>
          </template>
        </section>

        <section class="ddetail__card">
          <div class="ddetail__title">节点记录</div>
          <div v-if="!timeline.length" class="ddetail__empty">暂无记录</div>
          <div v-for="item in timeline" :key="item.id" class="dlog">
            <i class="dlog__dot" />
            <div class="dlog__body">
              <div class="dlog__head">
                <span class="dlog__title">{{ item.title }}</span>
                <span class="dlog__time">{{ item.time }}</span>
              </div>
              <div class="dlog__meta">{{ item.source }} · {{ item.operator || '-' }}</div>
              <div v-if="item.remark" class="dlog__remark">{{ item.remark }}</div>
            </div>
          </div>
        </section>

        <section v-if="photoGroups.length" class="ddetail__card">
          <div class="ddetail__title">节点照片</div>
          <div v-for="group in photoGroups" :key="group.type" class="ddetail__photos">
            <div class="ddetail__photos-label">{{ group.label }}</div>
            <div class="ddetail__photos-grid">
              <a v-for="file in group.items" :key="file.id" :href="file.file_url" target="_blank" class="ddetail__photo">
                <img :src="file.file_url" :alt="group.label" />
              </a>
            </div>
          </div>
        </section>
      </template>

      <div v-else-if="!loading" class="ddetail__card ddetail__empty">任务不存在或未指派给您</div>
    </n-spin>

    <!-- 操作面板 -->
    <div v-if="sheet.show" class="sheet">
      <div class="sheet__mask" @click="closeSheet" />
      <div class="sheet__panel">
        <div class="sheet__head">
          <span>{{ sheetTitle }}</span>
          <button type="button" class="sheet__close" @click="closeSheet">×</button>
        </div>

        <div class="sheet__body">
          <template v-if="sheet.type === 'PICKUP'">
            <div class="sheet__label">提车照片 <em>必传，至少 {{ minPhotos }} 张</em></div>
            <PhotoUploader v-model="pickupForm.photos" :min="minPhotos" :max="6" />
            <div class="sheet__label">实际提车日期（选填）</div>
            <n-date-picker
              v-model:formatted-value="pickupForm.pickup_date"
              type="date"
              value-format="yyyy-MM-dd"
              :is-date-disabled="(ts: number) => ts > Date.now()"
              clearable
              style="width: 100%"
            />
          </template>

          <template v-else-if="sheet.type === 'ARRIVE'">
            <div class="sheet__plan">
              计划运费 <b>{{ money(task?.plan_freight) }}</b>，请填写本次实际运费
            </div>
            <div class="sheet__label">实际运费（元）<em>必填</em></div>
            <n-input-number
              v-model:value="arriveForm.actual_freight"
              :min="0"
              :precision="2"
              placeholder="请输入实际运费"
              style="width: 100%"
            />
            <div class="sheet__label">实际里程（km，选填）</div>
            <n-input-number
              v-model:value="arriveForm.mileage"
              :min="0"
              :precision="1"
              placeholder="请输入实际里程"
              style="width: 100%"
            />
            <div class="sheet__label">到达照片（选填）</div>
            <PhotoUploader v-model="arriveForm.photos" :max="6" />
          </template>

          <template v-else>
            <div class="sheet__label">交接照片（选填）</div>
            <PhotoUploader v-model="finishForm.photos" :max="6" />
            <div class="sheet__label">接车人（选填）</div>
            <n-input v-model:value="finishForm.receiver" placeholder="客户接车人姓名" />
            <div class="sheet__label">备注（选填）</div>
            <n-input v-model:value="finishForm.remark" type="textarea" :rows="2" placeholder="车辆状态、异常说明等" />
          </template>
        </div>

        <div class="sheet__footer">
          <n-button size="large" class="sheet__btn" @click="closeSheet">取消</n-button>
          <n-button type="primary" size="large" class="sheet__btn" :loading="submitting" @click="submit">
            确认提交
          </n-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ddetail {
  padding-bottom: 12px;
}
.ddetail__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: -12px -12px 12px;
  padding: 8px 12px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  font-size: 14px;
  font-weight: 600;
  color: #262626;
  position: sticky;
  top: -12px;
  z-index: 3;
}
.ddetail__back {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  font-size: 17px;
  color: #595959;
  cursor: pointer;
}
.ddetail__bar-right {
  width: 30px;
}
.ddetail__hero {
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04);
  padding: 14px 16px;
}
.ddetail__hero-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ddetail__no {
  font-size: 15px;
  font-weight: 600;
  color: #262626;
}
.ddetail__route {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #f0f0f0;
}
.ddetail__route-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: #595959;
}
.ddetail__pin {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 10px;
  font-style: normal;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  margin-top: 1px;
}
.ddetail__pin--from {
  background: #1677ff;
}
.ddetail__pin--to {
  background: #389e0d;
}
.ddetail__route-line {
  width: 1px;
  height: 8px;
  margin-left: 8px;
  background: #e8e8e8;
}
.ddetail__card {
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04);
  padding: 13px 14px;
  margin-top: 10px;
}
.ddetail__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 5px 0;
  font-size: 12px;
}
.ddetail__row span {
  color: #8c8c8c;
  flex: none;
}
.ddetail__row b {
  font-weight: 500;
  color: #262626;
  text-align: right;
  word-break: break-all;
}
.ddetail__money {
  color: #fa8c16 !important;
}
.ddetail__action {
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04);
  padding: 14px;
  margin-top: 10px;
}
.ddetail__hint {
  font-size: 12px;
  color: #595959;
  line-height: 1.6;
  margin-bottom: 12px;
}
.ddetail__dev {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  padding: 9px 10px;
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 4px;
  font-size: 12px;
  color: #8c8c8c;
}
.ddetail__title {
  font-size: 13px;
  font-weight: 600;
  color: #262626;
  margin-bottom: 10px;
}
.ddetail__empty {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: #8c8c8c;
}
.dlog {
  display: flex;
  gap: 10px;
  padding-bottom: 14px;
  position: relative;
}
.dlog:last-child {
  padding-bottom: 0;
}
.dlog::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 12px;
  bottom: 0;
  width: 1px;
  background: #f0f0f0;
}
.dlog:last-child::before {
  display: none;
}
.dlog__dot {
  flex: none;
  width: 9px;
  height: 9px;
  margin-top: 4px;
  border-radius: 50%;
  background: #1677ff;
  box-shadow: 0 0 0 3px #e6f4ff;
  position: relative;
  z-index: 1;
}
.dlog__body {
  flex: 1;
  min-width: 0;
}
.dlog__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.dlog__title {
  font-size: 12px;
  font-weight: 600;
  color: #262626;
}
.dlog__time {
  font-size: 11px;
  color: #8c8c8c;
}
.dlog__meta {
  margin-top: 2px;
  font-size: 11px;
  color: #8c8c8c;
}
.dlog__remark {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.6;
  color: #595959;
}
.ddetail__photos + .ddetail__photos {
  margin-top: 10px;
}
.ddetail__photos-label {
  font-size: 12px;
  color: #8c8c8c;
  margin-bottom: 6px;
}
.ddetail__photos-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.ddetail__photo {
  display: block;
  aspect-ratio: 1;
  border-radius: 4px;
  overflow: hidden;
  background: #fafafa;
  border: 1px solid #f0f0f0;
}
.ddetail__photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sheet {
  position: fixed;
  inset: 0;
  z-index: 100;
}
.sheet__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}
.sheet__panel {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 100%;
  max-width: 480px;
  transform: translateX(-50%);
  max-height: 86%;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 8px 8px 0 0;
  padding-bottom: env(safe-area-inset-bottom);
  animation: sheet-up 0.2s ease-out;
}
@keyframes sheet-up {
  from {
    transform: translateX(-50%) translateY(14px);
    opacity: 0.6;
  }
  to {
    transform: translateX(-50%) translateY(0);
    opacity: 1;
  }
}
.sheet__head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 16px;
  font-size: 14px;
  font-weight: 600;
  color: #262626;
  border-bottom: 1px solid #f0f0f0;
}
.sheet__close {
  border: none;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  color: #8c8c8c;
  cursor: pointer;
}
.sheet__body {
  flex: 1;
  overflow: auto;
  padding: 14px 16px;
}
.sheet__label {
  font-size: 12px;
  color: #595959;
  margin: 14px 0 8px;
}
.sheet__label:first-child {
  margin-top: 0;
}
.sheet__label em {
  font-style: normal;
  color: #f5222d;
  font-size: 11px;
}
.sheet__plan {
  font-size: 12px;
  color: #595959;
  background: #fafafa;
  border-radius: 4px;
  padding: 9px 11px;
  margin-bottom: 4px;
}
.sheet__plan b {
  color: #fa8c16;
}
.sheet__footer {
  flex: none;
  display: flex;
  gap: 10px;
  padding: 10px 16px 14px;
  border-top: 1px solid #f0f0f0;
}
.sheet__btn {
  flex: 1;
  min-width: 0;
}
</style>
