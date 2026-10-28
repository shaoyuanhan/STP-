<script setup lang="ts">
/**
 * 在途监控
 * 左侧运单列表，地图上查看起终点和运单卡片。在途 / 历史用页签切换。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { SelectOption } from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import { listCarriers } from '@/services/carriers'
import { getTrackingTask, listTrackingTasks } from '@/services/tracking'
import type { TrackingTask, TrackingTaskDetail, TransportTrack } from '@/types/api'
import { matchCityGeo } from '@/lib/china-map'
import { datetime } from '@/utils/format'
import { TASK_STATUS_LABELS } from '@/views/dispatch/tasks/shared'
import ChinaMap from '@/components/ChinaMap.vue'
import StatusTag from '@/components/StatusTag.vue'

type Scope = 'transit' | 'history'

const PAGE_SIZE = 20
const STAGE_PCT: Record<string, number> = {
  WAIT_DISPATCH: 0,
  DISPATCHED: 8,
  CARRIER_ACCEPTED: 15,
  PICKED: 25,
  OUTBOUND: 40,
  IN_TRANSIT: 58,
  ARRIVED: 88,
  FINISHED: 100,
  CANCELLED: 0,
}

const route = useRoute()
const router = useRouter()

const scope = ref<Scope>(route.query.scope === 'history' ? 'history' : 'transit')
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const error = ref('')
const rows = ref<TrackingTask[]>([])
const selectedId = ref<number | null>(null)
const cardOpen = ref(true)
const detail = ref<TrackingTaskDetail | null>(null)

const draft = reactive({
  task_no: '',
  apply_no: '',
  customer_name: '',
  vin: '',
  carrier_id: null as number | null,
})
const applied = reactive({
  task_no: '',
  apply_no: '',
  customer_name: '',
  vin: '',
  carrier_id: null as number | null,
})
const carrierOptions = ref<SelectOption[]>([])

async function loadCarrierOptions() {
  try {
    const first = await listCarriers({ page: 1, size: 100 })
    const carriers = [...(first.list ?? [])]
    const pageCount = Math.ceil(Number(first.total ?? 0) / 100)
    if (pageCount > 1) {
      const pages = await Promise.all(
        Array.from({ length: pageCount - 1 }, (_, index) =>
          listCarriers({ page: index + 2, size: 100 }),
        ),
      )
      pages.forEach((result) => carriers.push(...(result.list ?? [])))
    }
    carrierOptions.value = carriers.map((carrier) => ({
      label: carrier.carrier_name,
      value: carrier.id,
    }))
  } catch {
    carrierOptions.value = []
  }
}

const isHistory = computed(() => scope.value === 'history')
const selected = computed(() => rows.value.find((row) => row.id === selectedId.value) ?? null)

function placeOf(text?: string | null) {
  const hit = matchCityGeo(String(text ?? ''))
  if (!hit) return null
  return {
    lng: hit.geo[0],
    lat: hit.geo[1],
    text: hit.city,
    label: hit.city,
    tip: String(text ?? hit.city),
  }
}

function shortPlace(text?: string | null): string {
  const hit = matchCityGeo(String(text ?? ''))
  if (hit) return hit.city
  const raw = String(text ?? '').trim()
  return raw ? raw.slice(0, 10) : '—'
}

const origin = computed(() => placeOf(selected.value?.ship_location))
const dest = computed(() => placeOf(selected.value?.delivery_address))
const stops = computed(() =>
  (detail.value?.tracks ?? [])
    .map((track: TransportTrack) => ({
      lng: Number(track.longitude),
      lat: Number(track.latitude),
      tip: track.location_desc || track.report_time || '',
    }))
    .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat)),
)
const arrived = computed(() => {
  const status = selected.value?.status
  return isHistory.value || status === 'ARRIVED' || status === 'FINISHED'
})
const hasRoute = computed(() => Boolean(origin.value || dest.value || stops.value.length))
const fitAvoid = computed(() => (cardOpen.value && selected.value ? [72, 88, 620, 140] : [48, 72, 300, 80]))
const legend = computed(() =>
  arrived.value
    ? [{ color: '#1890ff', text: '已行驶轨迹', kind: 'line' as const }]
    : [
        { color: '#1890ff', text: '已行驶轨迹', kind: 'line' as const },
        { color: '#999999', text: '待行驶路段', kind: 'line' as const, dashed: true },
      ],
)
const progress = computed(() => STAGE_PCT[selected.value?.status ?? ''] ?? 0)
const latest = computed(() => detail.value?.tracks?.slice(-1)[0] ?? selected.value?.latest_track ?? null)
const latestText = computed(() => {
  const track = latest.value
  if (!track?.report_time) return '暂无上报'
  const place = track.location_desc ? `${track.location_desc} · ` : ''
  return `${place}${datetime(track.report_time)}`
})

let listToken = 0
let detailToken = 0

async function loadList() {
  const token = ++listToken
  loading.value = true
  error.value = ''
  try {
    const result = await listTrackingTasks({
      scope: scope.value,
      page: page.value,
      size: PAGE_SIZE,
      task_no: applied.task_no || undefined,
      apply_no: applied.apply_no || undefined,
      customer_name: applied.customer_name || undefined,
      vin: applied.vin || undefined,
      carrier_id: applied.carrier_id ?? undefined,
    })
    if (token !== listToken) return
    rows.value = result?.list ?? []
    total.value = Number(result?.total ?? 0)
    const still = rows.value.some((row) => row.id === selectedId.value)
    if (!still) {
      selectedId.value = rows.value[0]?.id ?? null
      cardOpen.value = selectedId.value != null
    }
    if (selectedId.value != null) await loadDetail(selectedId.value)
    else detail.value = null
  } catch (e) {
    if (token !== listToken) return
    rows.value = []
    total.value = 0
    selectedId.value = null
    detail.value = null
    error.value = e instanceof Error ? e.message : '运单加载失败'
  } finally {
    if (token === listToken) loading.value = false
  }
}

async function loadDetail(id: number) {
  const token = ++detailToken
  try {
    const result = await getTrackingTask(id)
    if (token !== detailToken) return
    detail.value = result
  } catch {
    if (token !== detailToken) return
    detail.value = null
  }
}

function search() {
  applied.task_no = draft.task_no.trim()
  applied.apply_no = draft.apply_no.trim()
  applied.customer_name = draft.customer_name.trim()
  applied.vin = draft.vin.trim()
  applied.carrier_id = draft.carrier_id
  if (page.value !== 1) page.value = 1
  else void loadList()
}

function reset() {
  draft.task_no = ''
  draft.apply_no = ''
  draft.customer_name = ''
  draft.vin = ''
  draft.carrier_id = null
  search()
}

function switchScope(next: Scope) {
  if (scope.value === next) return
  scope.value = next
  selectedId.value = null
  detail.value = null
  void router.replace({ query: next === 'history' ? { scope: 'history' } : {} })
  if (page.value !== 1) page.value = 1
  else void loadList()
}

function pick(row: TrackingTask) {
  selectedId.value = row.id
  cardOpen.value = true
  void loadDetail(row.id)
}

watch(
  () => route.query.scope,
  (value) => {
    const next: Scope = value === 'history' ? 'history' : 'transit'
    if (next === scope.value) return
    scope.value = next
    selectedId.value = null
    if (page.value !== 1) page.value = 1
    else void loadList()
  },
)

watch(page, () => {
  void loadList()
})

onMounted(() => {
  void loadCarrierOptions()
  void loadList()
})
</script>

<template>
  <div class="stp-page track">
    <header class="stp-page__header">
      <h1 class="stp-page__title">在途监控</h1>
      <n-button :loading="loading" @click="loadList">刷新列表</n-button>
    </header>

    <n-card class="query-card" :bordered="false">
      <div class="query-bar">
        <div class="query-fields">
          <div class="query-item">
            <span>任务单号</span>
            <n-input
              v-model:value="draft.task_no"
              clearable
              placeholder="请输入任务单号"
              @keydown.enter="search"
            />
          </div>
          <div class="query-item">
            <span>发运申请单号</span>
            <n-input
              v-model:value="draft.apply_no"
              clearable
              placeholder="请输入发运申请单号"
              @keydown.enter="search"
            />
          </div>
          <div class="query-item">
            <span>客户名称</span>
            <n-input
              v-model:value="draft.customer_name"
              clearable
              placeholder="请输入客户名称"
              @keydown.enter="search"
            />
          </div>
          <div class="query-item">
            <span>VIN</span>
            <n-input
              v-model:value="draft.vin"
              clearable
              placeholder="请输入VIN"
              @keydown.enter="search"
            />
          </div>
          <div class="query-item">
            <span>承运商</span>
            <n-select
              v-model:value="draft.carrier_id"
              clearable
              filterable
              :options="carrierOptions"
              placeholder="请选择承运商"
            />
          </div>
        </div>
        <div class="query-buttons">
          <n-button type="primary" quaternary @click="reset">重置</n-button>
          <n-button type="primary" @click="search">查询</n-button>
        </div>
      </div>
    </n-card>

    <section class="stage">
      <ChinaMap
        class="stage__map"
        :fit="hasRoute"
        :origin="origin"
        :dest="dest"
        :stops="stops"
        :arrived="arrived"
        :legend="legend"
        :fit-avoid="fitAvoid"
        height="100%"
      />

      <aside class="dock">
        <div class="dock__tabs">
          <button
            type="button"
            :class="{ 'is-on': !isHistory }"
            @click="switchScope('transit')"
          >
            在途运单
            <em v-if="!isHistory">{{ total }}</em>
          </button>
          <button
            type="button"
            :class="{ 'is-on': isHistory }"
            @click="switchScope('history')"
          >
            历史运单
            <em v-if="isHistory">{{ total }}</em>
          </button>
        </div>

        <div class="dock__list">
          <p v-if="error" class="dock__empty">{{ error }}</p>
          <p v-else-if="!loading && !rows.length" class="dock__empty">暂无运单</p>
          <button
            v-for="row in rows"
            :key="row.id"
            type="button"
            class="row"
            :class="{ 'is-on': row.id === selectedId }"
            @click="pick(row)"
          >
            <div class="row__top">
              <b>{{ row.task_no }}</b>
              <StatusTag type="task" :value="row.status" />
            </div>
            <div class="row__route">
              <span>{{ shortPlace(row.ship_location) }}</span>
              <i></i>
              <span>{{ shortPlace(row.delivery_address) }}</span>
            </div>
            <p>{{ row.carrier_name || '未分配承运商' }}</p>
            <p>{{ row.vehicle_models || '—' }}</p>
          </button>
        </div>

        <div class="dock__pager">
          <n-pagination
            v-model:page="page"
            :page-size="PAGE_SIZE"
            :item-count="total"
            :page-slot="5"
            size="small"
          />
          <span>20 条/页</span>
        </div>
      </aside>

      <section v-if="cardOpen && selected" class="info">
        <header class="info__head">
          <b>{{ selected.task_no }}</b>
          <StatusTag type="task" :value="selected.status" />
          <span class="info__spacer"></span>
          <button type="button" class="info__x" @click="cardOpen = false">×</button>
        </header>
        <dl class="info__grid">
          <div>
            <dt>运输状态</dt>
            <dd>{{ TASK_STATUS_LABELS[selected.status] || selected.status }}</dd>
          </div>
          <div>
            <dt>司机</dt>
            <dd>{{ selected.driver_name || '—' }}</dd>
          </div>
          <div>
            <dt>车型</dt>
            <dd>{{ selected.vehicle_models || '—' }}</dd>
          </div>
          <div>
            <dt>VIN</dt>
            <dd>{{ selected.vins || '—' }}</dd>
          </div>
        </dl>
        <div class="info__route">
          <p><i class="pin pin--start"></i>{{ selected.ship_location || '—' }}</p>
          <p><i class="pin pin--end"></i>{{ selected.delivery_address || '—' }}</p>
        </div>
        <div class="info__progress">
          <span>当前进度</span>
          <div class="bar"><i :style="{ width: `${progress}%` }"></i></div>
          <span>最新上报</span>
        </div>
        <p class="info__latest">{{ latestText }}</p>
      </section>
    </section>
  </div>
</template>

<style scoped>
.track {
  height: calc(100vh - 110px);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding-bottom: 20px;
  overflow: hidden;
}

.track > .stp-page__header,
.track > .query-card {
  flex: none;
}

.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid #eeeeee;
  border-radius: 4px;
  overflow: hidden;
  background: #f5f6fb;
}

.stage__map {
  position: absolute;
  inset: 0;
}

.stage :deep(.mp-legend) {
  left: 292px;
  bottom: 14px;
}

.dock {
  position: absolute;
  z-index: 4;
  left: 12px;
  top: 12px;
  bottom: 12px;
  width: 268px;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border: 1px solid #eeeeee;
  border-radius: 4px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.08);
}

.dock__tabs {
  flex: none;
  display: flex;
  gap: 18px;
  padding: 12px 14px 0;
  border-bottom: 1px solid #eeeeee;
}

.dock__tabs button {
  position: relative;
  padding: 0 0 10px;
  border: none;
  background: none;
  color: #666666;
  font-size: 14px;
  cursor: pointer;
}

.dock__tabs button.is-on {
  color: #1890ff;
  font-weight: 600;
}

.dock__tabs button.is-on::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: #1890ff;
}

.dock__tabs em {
  display: inline-block;
  min-width: 16px;
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 8px;
  background: #f5f6fb;
  color: #1890ff;
  font-style: normal;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
}

.dock__list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.dock__empty {
  margin: 24px 8px;
  color: #999999;
  font-size: 14px;
  text-align: center;
}

.row {
  display: block;
  width: 100%;
  scroll-margin: 12px 0;
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid #eeeeee;
  border-radius: 4px;
  background: #ffffff;
  color: #2d3033;
  text-align: left;
  cursor: pointer;
}

.row.is-on {
  border-color: #1890ff;
  box-shadow: inset 3px 0 0 #1890ff;
}

.row__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.row__top b {
  color: #2d3033;
  font-size: 14px;
  font-weight: 600;
}

.row__route {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: #2d3033;
  font-size: 14px;
}

.row__route i {
  width: 18px;
  height: 1px;
  background: #999999;
  position: relative;
}

.row__route i::after {
  content: '';
  position: absolute;
  right: 0;
  top: -3px;
  border: 3px solid transparent;
  border-left: 5px solid #999999;
}

.row p {
  margin: 4px 0 0;
  color: #666666;
  font-size: 12px;
  line-height: 1.4;
}

.dock__pager {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 10px;
  border-top: 1px solid #eeeeee;
  color: #666666;
  font-size: 12px;
}

.info {
  position: absolute;
  z-index: 5;
  left: 292px;
  top: 12px;
  width: 360px;
  padding: 14px 16px 12px;
  background: #ffffff;
  border: 1px solid #eeeeee;
  border-radius: 4px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
}

.info__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.info__head b {
  font-size: 14px;
  color: #2d3033;
}

.info__spacer {
  flex: 1;
}

.info__x {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: none;
  color: #999999;
  font-size: 16px;
  cursor: pointer;
}

.info__x:hover {
  color: #1890ff;
}

.info__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
  margin: 14px 0 0;
}

.info__grid div {
  min-width: 0;
}

.info__grid dt {
  color: #666666;
  font-size: 12px;
}

.info__grid dd {
  margin: 2px 0 0;
  color: #2d3033;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info__route {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 4px;
  background: #f5f6fb;
}

.info__route p {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  color: #2d3033;
  font-size: 14px;
  line-height: 1.5;
}

.info__route p + p {
  margin-top: 8px;
}

.pin {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
}

.pin--start {
  background: #18a058;
}

.pin--end {
  background: #1890ff;
}

.info__progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  color: #666666;
  font-size: 12px;
}

.bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: #eeeeee;
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: #1890ff;
}

.info__latest {
  margin: 6px 0 0;
  color: #666666;
  font-size: 12px;
}

@media (max-width: 900px) {
  .track {
    height: auto;
    min-height: calc(100vh - 110px);
    overflow: visible;
  }

  .stage {
    flex: none;
    height: 560px;
  }

  .dock {
    bottom: auto;
    height: 250px;
  }

  .info {
    top: auto;
    right: 12px;
    bottom: 12px;
    left: 12px;
    width: auto;
    max-height: calc(100% - 286px);
    overflow-y: auto;
  }
}
</style>
