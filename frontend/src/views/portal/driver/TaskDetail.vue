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

const activeTab = ref<'log' | 'vehicle'>('log')

const pickupForm = reactive({ photos: [] as string[], pickup_date: null as string | null })
const arriveForm = reactive({ photos: [] as string[], actual_freight: null as number | null, mileage: null as number | null })
const finishForm = reactive({ photos: [] as string[], receiver: '', remark: '' })

const minPhotos = computed(() => detail.value?.pickup_photo_min ?? 4)

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

const timelineExpanded = ref(false)
const TIMELINE_COLLAPSED_COUNT = 4
const visibleTimeline = computed(() =>
  timelineExpanded.value ? timeline.value : timeline.value.slice(0, TIMELINE_COLLAPSED_COUNT)
)

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
      if (pickupForm.pickup_date) {
        const picked = new Date(pickupForm.pickup_date.replace(' ', 'T')).getTime()
        if (picked > Date.now()) {
          message.warning('实际提车时间不能晚于当前时间')
          return
        }
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

const SOURCE_LABELS: Record<string, string> = {
  CRM: 'CRM 系统', STP: 'STP 系统', CARRIER: '承运商', DRIVER: '司机', WMS: 'WMS 系统', SQ: '狮桥物流',
}

function sourceKey(source?: string | null) {
  return source && SOURCE_LABELS[source] ? source : 'STP'
}

function sourceLabel(source?: string | null) {
  return (source && SOURCE_LABELS[source]) || '系统'
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
            <div class="ddetail__no-wrap">
              <span class="ddetail__no-label">任务单号</span>
              <span class="ddetail__no">{{ task.task_no }}</span>
            </div>
            <div v-if="task.order_no" class="ddetail__no-wrap">
              <span class="ddetail__no-label">订单号</span>
              <span class="ddetail__no">{{ task.order_no }}</span>
            </div>
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
          <div class="ddetail__tabs">
            <button
              type="button"
              class="ddetail__tab"
              :class="{ 'ddetail__tab--active': activeTab === 'log' }"
              @click="activeTab = 'log'"
            >节点记录</button>
            <button
              type="button"
              class="ddetail__tab"
              :class="{ 'ddetail__tab--active': activeTab === 'vehicle' }"
              @click="activeTab = 'vehicle'"
            >车辆信息</button>
          </div>

          <div v-if="activeTab === 'log'">
            <div v-if="!timeline.length" class="ddetail__empty">暂无记录</div>
            <div v-for="item in visibleTimeline" :key="item.id" class="dlog">
              <i class="dlog__dot" :class="`dlog__dot--${sourceKey(item.source)}`" />
              <div class="dlog__body">
                <div class="dlog__head">
                  <span class="dlog__title">{{ item.title }}</span>
                  <span class="dlog__time">{{ item.time }}</span>
                </div>
                <div class="dlog__meta">
                  <span class="dlog__chip" :class="`dlog__chip--${sourceKey(item.source)}`">{{ sourceLabel(item.source) }}</span>
                  <span class="dlog__operator">{{ item.operator || '-' }}</span>
                </div>
                <div v-if="item.remark" class="dlog__remark">{{ item.remark }}</div>
                <div v-if="item.photos.length" class="dlog__photos">
                  <a v-for="(url, idx) in item.photos" :key="idx" :href="url" target="_blank" class="dlog__photo">
                    <img :src="url" :alt="item.title" />
                  </a>
                </div>
              </div>
            </div>
            <button
              v-if="timeline.length > TIMELINE_COLLAPSED_COUNT"
              type="button"
              class="ddetail__toggle"
              @click="timelineExpanded = !timelineExpanded"
            >
              {{ timelineExpanded ? '收起记录' : `展开全部 ${timeline.length} 条记录` }}
              <span class="ddetail__toggle-arrow" :class="{ 'ddetail__toggle-arrow--up': timelineExpanded }" />
            </button>
          </div>

          <div v-else class="dvehicle">
            <template v-if="detail.vehicles?.length">
              <div v-for="v in detail.vehicles" :key="v.id" class="dvehicle__block">
                <div class="dvehicle__row"><span>VIN</span><b>{{ v.vin }}</b></div>
                <div class="dvehicle__row"><span>车型</span><b>{{ v.vehicle_model || '-' }}</b></div>
                <div class="dvehicle__row"><span>发动机配置</span><b>{{ v.engine_config || '-' }}</b></div>
                <div class="dvehicle__row"><span>驾驶室类型</span><b>{{ v.cabin_type || '-' }}</b></div>
                <div class="dvehicle__row"><span>订单号</span><b>{{ v.order_no || '-' }}</b></div>
                <div class="dvehicle__row"><span>计划运费</span><b class="ddetail__money">{{ money(v.plan_freight) }}</b></div>
              </div>
            </template>
            <div v-else class="ddetail__empty">暂无车辆信息</div>
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
            <div class="sheet__label">提车照片 <em>必传，固定 {{ minPhotos }} 张</em></div>
            <PhotoUploader v-model="pickupForm.photos" :min="minPhotos" :max="minPhotos" />
            <div class="sheet__label">实际提车时间（选填）</div>
            <n-date-picker
              v-model:formatted-value="pickupForm.pickup_date"
              type="datetime"
              value-format="yyyy-MM-dd HH:mm:ss"
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
  background: linear-gradient(135deg, #1677ff 0%, #0b5ed7 100%);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(22, 119, 255, 0.16);
  padding: 16px;
  color: #fff;
}
.ddetail__hero-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.ddetail__no-wrap {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.ddetail__no-label {
  font-size: 11px;
  opacity: 0.85;
}
.ddetail__no {
  display: inline-block;
  margin-top: 6px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.18);
  border-radius: 8px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.5px;
  font-family: 'DIN Alternate', 'Roboto Mono', Menlo, monospace;
  color: #fff;
  word-break: break-all;
}
.ddetail__hero :deep(.status-badge) {
  background: rgba(255, 255, 255, 0.18) !important;
  color: #fff !important;
  border: none;
  backdrop-filter: blur(2px);
}
.ddetail__route {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.18);
}
.ddetail__route-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.92);
  font-weight: 500;
}
.ddetail__pin {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  font-size: 11px;
  font-style: normal;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #1677ff;
  background: #fff;
  margin-top: 1px;
  font-weight: 600;
}
.ddetail__pin--to {
  color: #389e0d;
}
.ddetail__route-line {
  width: 2px;
  height: 10px;
  margin-left: 9px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.35);
}
.ddetail__card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(31, 45, 61, 0.06);
  padding: 14px 16px;
  margin-top: 12px;
}
.ddetail__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
  font-size: 13px;
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
  font-weight: 600 !important;
}
.ddetail__action {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(31, 45, 61, 0.06);
  padding: 14px 16px;
  margin-top: 12px;
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
.ddetail__tabs {
  display: flex;
  gap: 24px;
  border-bottom: 1px solid #f0f0f0;
  margin-bottom: 14px;
}
.ddetail__tab {
  position: relative;
  padding: 0 2px 10px;
  border: none;
  background: none;
  font-size: 14px;
  font-weight: 500;
  color: #8c8c8c;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ddetail__tab--active {
  color: #262626;
  font-weight: 600;
}
.ddetail__tab--active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -1px;
  transform: translateX(-50%);
  width: 20px;
  height: 3px;
  border-radius: 2px;
  background: #1677ff;
}
.ddetail__toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  margin-top: 12px;
  padding: 8px 0;
  border: none;
  border-top: 1px solid #f5f5f5;
  background: none;
  font-size: 12px;
  color: #1677ff;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ddetail__toggle-arrow {
  width: 7px;
  height: 7px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg) translateY(-1px);
  transition: transform 0.2s;
}
.ddetail__toggle-arrow--up {
  transform: rotate(225deg) translateY(-1px);
}
.dvehicle__block + .dvehicle__block {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f5f5f5;
}
.dvehicle__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 5px 0;
  font-size: 13px;
}
.dvehicle__row span {
  color: #8c8c8c;
  flex: none;
}
.dvehicle__row b {
  font-weight: 500;
  color: #262626;
  text-align: right;
  word-break: break-all;
}
.dlog__photos {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 8px;
}
.dlog__photo {
  display: block;
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  background: #fafafa;
  border: 1px solid #f0f0f0;
}
.dlog__photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ddetail__title {
  font-size: 14px;
  font-weight: 600;
  color: #262626;
  margin-bottom: 12px;
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
  top: 14px;
  bottom: 0;
  width: 2px;
  border-radius: 1px;
  background: #f0f0f0;
}
.dlog:last-child::before {
  display: none;
}
.dlog__dot {
  flex: none;
  width: 10px;
  height: 10px;
  margin-top: 4px;
  border-radius: 50%;
  position: relative;
  z-index: 1;
  background: #1677ff;
  box-shadow: 0 0 0 3px #e6f4ff;
}
.dlog__dot--CRM {
  background: #722ed1;
  box-shadow: 0 0 0 3px #f9f0ff;
}
.dlog__dot--STP {
  background: #1677ff;
  box-shadow: 0 0 0 3px #e6f4ff;
}
.dlog__dot--CARRIER {
  background: #fa8c16;
  box-shadow: 0 0 0 3px #fff7e6;
}
.dlog__dot--DRIVER {
  background: #389e0d;
  box-shadow: 0 0 0 3px #f6ffed;
}
.dlog__dot--WMS {
  background: #08979c;
  box-shadow: 0 0 0 3px #e6fffb;
}
.dlog__dot--SQ {
  background: #fa541c;
  box-shadow: 0 0 0 3px #fff2e8;
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
  font-size: 13px;
  font-weight: 600;
  color: #262626;
}
.dlog__time {
  font-size: 11px;
  color: #8c8c8c;
}
.dlog__meta {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #8c8c8c;
}
.dlog__chip {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.5;
  background: #e6f4ff;
  color: #1677ff;
}
.dlog__chip--CRM {
  background: #f9f0ff;
  color: #722ed1;
}
.dlog__chip--STP {
  background: #e6f4ff;
  color: #1677ff;
}
.dlog__chip--CARRIER {
  background: #fff7e6;
  color: #fa8c16;
}
.dlog__chip--DRIVER {
  background: #f6ffed;
  color: #389e0d;
}
.dlog__chip--WMS {
  background: #e6fffb;
  color: #08979c;
}
.dlog__chip--SQ {
  background: #fff2e8;
  color: #fa541c;
}
.dlog__operator {
  color: #595959;
}
.dlog__remark {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: #595959;
}
.sheet {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
}
.sheet__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}
.sheet__panel {
  position: relative;
  width: 100%;
  max-width: 440px;
  max-height: calc(100vh - 48px);
  max-height: calc(100dvh - 48px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
  overflow: hidden;
  animation: sheet-pop 0.18s ease-out;
}
@keyframes sheet-pop {
  from {
    transform: scale(0.96) translateY(8px);
    opacity: 0;
  }
  to {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}
.sheet__head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  font-size: 15px;
  font-weight: 600;
  color: #262626;
  border-bottom: 1px solid #f5f5f5;
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
