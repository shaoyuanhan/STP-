<script setup lang="ts">
/**
 * 运输监控（在途 / 历史双视角，原「全国态势」「在途监控」「历史轨迹」合并为一页）
 *
 * - 全国地图总览：轨迹线为各运单轨迹（点击定位运单），同城多单聚合成数字气泡（点击按城市筛选），
 *   同城单票为小圆点（点击打开详情）；历史视角叠加到达省份热力。
 * - 右侧运单列表与地图双向联动；选中运单后地图自动放大到该运单起终点并展示全部回传点，
 *   右侧抽屉展示运单信息、上报点与位置记录。
 * - 顶部 KPI：运单量、覆盖省份、运输车辆、运输线路；在途视角 30s 自动刷新。
 * - 视角与 URL 的 ?scope= 同步，旧「历史轨迹」入口重定向到本页并自动切到历史视角。
 */
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getTrackingOverview, getTrackingTask } from '@/services/tracking'
import type { TrackingOverviewTask, TrackingTaskDetail, TransportTrack } from '@/types/api'
import { matchCityGeo, matchProvince } from '@/lib/china-map'
import { dateOnly, dateShort, datetime, datetimeFull, formatPhone, money } from '@/utils/format'
import ChinaMap from '@/components/ChinaMap.vue'
import StatusTag from '@/components/StatusTag.vue'

type Scope = 'transit' | 'history'

/** 运单进度条：状态 → 完成百分比（与在途监控保持一致） */
const STAGE_PCT: Record<string, number> = {
  WAIT_DISPATCH: 0,
  DISPATCHED: 8,
  CARRIER_ACCEPTED: 15,
  PICKED: 25,
  OUTBOUND: 40,
  IN_TRANSIT: 60,
  ARRIVED: 88,
  FINISHED: 100,
  CANCELLED: 0,
}

interface TaskMeta {
  task: TrackingOverviewTask
  origin: { city: string; lng: number; lat: number } | null
  dest: { city: string; lng: number; lat: number } | null
  province: string | null
}

// ---- 数据加载 ----
const route = useRoute()
const router = useRouter()
const scope = ref<Scope>(route.query.scope === 'history' ? 'history' : 'transit')
const loading = ref(false)
const error = ref<string | null>(null)
const tasks = ref<TrackingOverviewTask[]>([])

const isHistory = computed(() => scope.value === 'history')

async function loadOverview(silent = false) {
  if (!silent) loading.value = true
  error.value = null
  try {
    const result = await getTrackingOverview(scope.value)
    tasks.value = result?.tasks ?? []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    tasks.value = []
  } finally {
    loading.value = false
  }
}

function switchScope(next: Scope) {
  if (scope.value === next) return
  scope.value = next
  router.replace({ query: { ...route.query, scope: next } })
  keyword.value = ''
  provinceFilter.value = null
  cityFilter.value = null
  closeDrawer()
  stopAutoRefresh()
  loadOverview()
  if (next === 'transit') startAutoRefresh()
}

// 直接改地址栏 ?scope= 时同步视角（旧 /tracking/history 重定向即走这里）
watch(
  () => route.query.scope,
  (value) => switchScope(value === 'history' ? 'history' : 'transit'),
)

// ---- 地址解析（城市坐标 / 省份） ----
function geoOf(text?: string | null) {
  const hit = matchCityGeo(String(text ?? ''))
  if (!hit) return null
  return { city: hit.city, lng: hit.geo[0], lat: hit.geo[1] }
}

function cityLabel(text?: string | null): string {
  const s = String(text ?? '').trim()
  if (!s) return '-'
  const hit = matchCityGeo(s)
  return hit ? hit.city : s.slice(0, 12)
}

const metaList = computed<TaskMeta[]>(() =>
  tasks.value.map((task) => ({
    task,
    origin: geoOf(task.ship_location),
    dest: geoOf(task.delivery_address),
    province: matchProvince(task.delivery_address) ?? null,
  }))
)

// ---- 筛选（省份 / 同城 / 关键字） ----
const keyword = ref('')
const provinceFilter = ref<string | null>(null)
const cityFilter = ref<string | null>(null)

const visibleMeta = computed<TaskMeta[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  return metaList.value.filter((meta) => {
    if (provinceFilter.value && meta.province !== provinceFilter.value) return false
    if (cityFilter.value && meta.dest?.city !== cityFilter.value) return false
    if (!kw) return true
    const hay = `${meta.task.task_no} ${meta.task.latest_track?.transport_no ?? ''} ${
      meta.task.vins ?? ''
    } ${meta.task.customer_name ?? ''} ${meta.task.delivery_address ?? ''}`.toLowerCase()
    return hay.includes(kw)
  })
})

const filterLabel = computed(() => {
  if (cityFilter.value) return `目的地：${cityFilter.value}`
  if (provinceFilter.value) return `到达省份：${provinceFilter.value}`
  return ''
})

function clearFilters() {
  provinceFilter.value = null
  cityFilter.value = null
}

function onProvince(name: string) {
  provinceFilter.value = provinceFilter.value === name ? null : name
  cityFilter.value = null
}

function onBubble(key: string) {
  const cluster = clusters.value.find((item) => item.city === key)
  // 单票城市直接打开运单详情；多票城市切换筛选
  if (cluster && cluster.tasks.length === 1) {
    openTask(cluster.tasks[0].id)
    return
  }
  cityFilter.value = cityFilter.value === key ? null : key
  provinceFilter.value = null
}

// ---- KPI ----
const provinceCount = computed(() => {
  const set = new Set<string>()
  metaList.value.forEach((meta) => meta.province && set.add(meta.province))
  return set.size
})

const cityCount = computed(() => {
  const set = new Set<string>()
  metaList.value.forEach((meta) => meta.dest && set.add(meta.dest.city))
  return set.size
})

const vehicleCount = computed(() => {
  const set = new Set<string>()
  metaList.value.forEach((meta) => {
    String(meta.task.vins ?? '')
      .split('、')
      .map((vin) => vin.trim())
      .filter(Boolean)
      .forEach((vin) => set.add(vin))
  })
  return set.size
})

const routeCount = computed(() => {
  const set = new Set<string>()
  metaList.value.forEach((meta) => {
    set.add(`${meta.origin?.city ?? cityLabel(meta.task.ship_location)}→${meta.dest?.city ?? cityLabel(meta.task.delivery_address)}`)
  })
  return set.size
})

const topProvince = computed(() => {
  const acc = provinceCounts(metaList.value)
  const sorted = Object.entries(acc).sort((a, b) => b[1] - a[1])
  return sorted.length ? { name: sorted[0][0], count: sorted[0][1] } : null
})

function provinceCounts(list: TaskMeta[]) {
  const acc: Record<string, number> = {}
  list.forEach((meta) => {
    if (!meta.province) return
    acc[meta.province] = (acc[meta.province] ?? 0) + 1
  })
  return acc
}

/**
 * 到达省份热力（始终按全量统计，筛选时不失真）。
 * 在途视角传空对象：不绘制热度色，但保留省份点击筛选能力。
 */
const heat = computed<Record<string, number> | null>(() =>
  isHistory.value ? provinceCounts(metaList.value) : {}
)

// ---- 地图：线路 / 聚合气泡 / 运单号标签 ----
function routePoints(meta: TaskMeta): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  const push = (lng: number, lat: number) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
    const last = pts[pts.length - 1]
    if (last && Math.abs(last[0] - lng) < 0.01 && Math.abs(last[1] - lat) < 0.01) return
    pts.push([lng, lat])
  }

  if (meta.origin) push(meta.origin.lng, meta.origin.lat)
  ;(meta.task.points ?? []).forEach(([lng, lat]) => push(Number(lng), Number(lat)))
  if (['ARRIVED', 'FINISHED'].includes(meta.task.status) && meta.dest) {
    push(meta.dest.lng, meta.dest.lat)
  }
  if (pts.length < 2 && meta.dest) push(meta.dest.lng, meta.dest.lat)
  return pts
}

const mapLinks = computed(() => {
  if (selectedId.value !== null) return []
  return visibleMeta.value
    .map((meta) => ({
      id: meta.task.id,
      points: routePoints(meta),
      active: false,
      label: `${meta.task.task_no} · ${meta.origin?.city ?? '-'} → ${meta.dest?.city ?? '-'}`,
    }))
    .filter((link) => link.points.length >= 2)
})

interface CityCluster {
  city: string
  lng: number
  lat: number
  tasks: TrackingOverviewTask[]
}

const clusters = computed<CityCluster[]>(() => {
  const map = new Map<string, CityCluster>()
  visibleMeta.value.forEach((meta) => {
    if (!meta.dest) return
    const key = meta.dest.city
    const hit = map.get(key)
    if (hit) hit.tasks.push(meta.task)
    else map.set(key, { city: key, lng: meta.dest.lng, lat: meta.dest.lat, tasks: [meta.task] })
  })
  return [...map.values()]
})

/**
 * 同城单量：多单显示数字气泡，单票只显示小圆点（不带运单号，避免压住线路）。
 * 点击后单票直接打开详情，多单按城市筛选。
 */
const mapBubbles = computed(() => {
  if (selectedId.value !== null) return []
  return clusters.value.map((cluster) => ({
    key: cluster.city,
    name: cluster.tasks.length > 1 ? cluster.city : '',
    lng: cluster.lng,
    lat: cluster.lat,
    count: cluster.tasks.length,
    hideCount: cluster.tasks.length === 1,
    active: cityFilter.value === cluster.city,
    tip: `${cluster.city} · ${cluster.tasks.length} 单\n${cluster.tasks.map((t) => t.task_no).join('\n')}`,
  }))
})

const provincesHL = computed(() => (provinceFilter.value ? [provinceFilter.value] : []))

const mapLegend = computed(() => {
  if (selectedId.value !== null) {
    return [
      { color: '#52c41a', text: `起始地：${cityLabel(focusTask.value?.ship_location)}` },
      { color: '#f5222d', text: `目的地：${cityLabel(focusTask.value?.delivery_address)}` },
      { color: '#1677ff', text: '位置回传点（点击查看）' },
    ]
  }
  if (isHistory.value) {
    return [
      { color: '#f56a00', text: '到达热度（越深单量越多）' },
      { color: 'rgba(19,168,168,.8)', text: '历史轨迹（点击定位运单）' },
      { color: '#13a8a8', text: '圆点=单票，气泡数字=同城单量' },
    ]
  }
  return [
    { color: 'rgba(22,119,255,.7)', text: '在途轨迹（点击定位运单）' },
    { color: '#1677ff', text: '圆点=单票，气泡数字=同城单量' },
  ]
})

// ---- 选中运单（右侧抽屉） ----
const selectedId = ref<number | null>(null)
const detail = ref<TrackingTaskDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)
const selectedTrackIndex = ref<number | null>(null)

const focusTask = computed(() => detail.value?.task ?? null)
const focusTracks = computed<TransportTrack[]>(() => detail.value?.tracks ?? [])

async function openTask(id: number) {
  selectedId.value = id
  selectedTrackIndex.value = null
  detail.value = null
  detailError.value = null
  detailLoading.value = true
  try {
    const data = await getTrackingTask(id)
    if (selectedId.value !== id) return
    detail.value = data
    selectedTrackIndex.value = data.tracks.length ? data.tracks.length - 1 : null
  } catch (e) {
    if (selectedId.value !== id) return
    detailError.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (selectedId.value === id) detailLoading.value = false
  }
}

function retryDetail() {
  if (selectedId.value !== null) openTask(selectedId.value)
}

function closeDrawer() {
  selectedId.value = null
  detail.value = null
  detailError.value = null
  selectedTrackIndex.value = null
}

function keepTrackSelection() {
  const len = detail.value?.tracks?.length ?? 0
  const index = selectedTrackIndex.value
  if (index === null || index >= len) selectedTrackIndex.value = len ? len - 1 : null
}

// ---- 抽屉里的运单详情 ----
const focusRoutePct = computed(() => STAGE_PCT[focusTask.value?.status ?? ''] ?? 0)
const focusArrived = computed(() => ['ARRIVED', 'FINISHED'].includes(focusTask.value?.status ?? ''))

const focusOriginPoint = computed(() => {
  const task = focusTask.value
  if (!task) return null
  return { text: task.ship_location ?? '', label: cityLabel(task.ship_location) }
})

const focusDestPoint = computed(() => {
  const task = focusTask.value
  if (!task) return null
  return { text: task.delivery_address ?? '', label: cityLabel(task.delivery_address) }
})

function trackTip(track: TransportTrack): string {
  return `${dateShort(track.report_time)} ${track.location_desc ?? ''}${
    track.speed ? ` · ${track.speed}km/h` : ''
  }`
}

const focusStops = computed(() =>
  focusTracks.value.map((track, index) => ({
    lng: track.longitude,
    lat: track.latitude,
    index,
    tip: trackTip(track),
  }))
)

const activeTrack = computed<TransportTrack | null>(() => {
  const index = selectedTrackIndex.value
  return index === null ? null : focusTracks.value[index] ?? null
})

const activePoint = computed(() => {
  const track = activeTrack.value
  return track ? { lng: track.longitude, lat: track.latitude } : null
})

function selectTrack(index: number) {
  if (selectedId.value === null) return
  selectedTrackIndex.value = index
}

const originShort = computed(() => (focusTask.value?.ship_location || '起点').slice(0, 8))
const destShort = computed(() => (focusTask.value?.delivery_address || '终点').slice(0, 8))
const curPosShort = computed(() => {
  const last = focusTracks.value[focusTracks.value.length - 1]
  return (last?.location_desc || '-').slice(0, 10)
})

// ---- 刷新与自动轮询 ----
let timer: ReturnType<typeof setInterval> | null = null

function startAutoRefresh() {
  if (timer || isHistory.value) return
  timer = setInterval(() => refreshAll(true), 30000)
}

function stopAutoRefresh() {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

async function refreshAll(silent = false) {
  await loadOverview(silent)
  const id = selectedId.value
  if (id === null || !tasks.value.some((task) => task.id === id)) return
  try {
    detail.value = await getTrackingTask(id)
    keepTrackSelection()
  } catch {
    /* 静默刷新失败时保留当前详情，等待下次轮询 */
  }
}

onMounted(() => {
  loadOverview()
  startAutoRefresh()
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  stopAutoRefresh()
  window.removeEventListener('keydown', handleKeydown)
})

onDeactivated(stopAutoRefresh)

let activatedOnce = false
onActivated(() => {
  startAutoRefresh()
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  refreshAll(true)
})

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && selectedId.value !== null) closeDrawer()
}
</script>

<template>
  <div class="stp-page overview">
    <!-- 视图切换 + 关键字 + 刷新 -->
    <section class="card ov-toolbar">
      <div class="ov-tabs">
        <button
          type="button"
          class="ov-tab"
          :class="{ 'is-active': !isHistory }"
          @click="switchScope('transit')"
        >
          在途态势
        </button>
        <button
          type="button"
          class="ov-tab"
          :class="{ 'is-active': isHistory }"
          @click="switchScope('history')"
        >
          历史态势
        </button>
      </div>

      <n-input
        v-model:value="keyword"
        class="ov-search"
        size="small"
        clearable
        placeholder="任务单号 / 运输单号 / VIN / 客户 / 目的地"
      />

      <div class="ov-toolbar__actions">
        <span v-if="!isHistory" class="ov-toolbar__live">每 30 秒自动刷新</span>
        <n-button size="small" :loading="loading" @click="refreshAll()">刷新</n-button>
      </div>
    </section>

    <!-- KPI -->
    <section class="ov-kpis">
      <div class="card kpi kpi--blue">
        <div class="kpi__label">{{ isHistory ? '已完结运单' : '在途运单' }}</div>
        <div class="kpi__value">{{ tasks.length }}<span>单</span></div>
        <div class="kpi__sub">覆盖 {{ cityCount }} 个目的城市</div>
      </div>
      <div class="card kpi kpi--cyan">
        <div class="kpi__label">覆盖省份</div>
        <div class="kpi__value">{{ provinceCount }}<span>个</span></div>
        <div class="kpi__sub">
          {{ topProvince ? `TOP：${topProvince.name} · ${topProvince.count} 单` : '暂无省份数据' }}
        </div>
      </div>
      <div class="card kpi kpi--green">
        <div class="kpi__label">运输车辆</div>
        <div class="kpi__value">{{ vehicleCount }}<span>台</span></div>
        <div class="kpi__sub">按 VIN 去重</div>
      </div>
      <div class="card kpi kpi--orange">
        <div class="kpi__label">运输线路</div>
        <div class="kpi__value">{{ routeCount }}<span>条</span></div>
        <div class="kpi__sub">{{ isHistory ? '历史轨迹回看' : '起点至目的地去重' }}</div>
      </div>
    </section>

    <div class="ov-grid">
      <!-- 全国地图 -->
      <section class="card ov-map">
        <div class="panel-head">
          <span>{{ isHistory ? '全国历史轨迹' : '全国在途态势' }}</span>
          <div class="ov-map__right">
            <span v-if="filterLabel" class="ov-chip">
              {{ filterLabel }}
              <b class="ov-chip__close" @click="clearFilters">✕</b>
            </span>
            <span class="ov-map__hint">滚轮缩放 · 拖拽平移 · 点击线路或圆点定位运单</span>
          </div>
        </div>

        <n-spin :show="loading">
          <div v-if="error" class="ov-empty">
            <span class="ov-empty__error">{{ error }}</span>
            <n-button size="small" type="primary" quaternary @click="loadOverview()">重试</n-button>
          </div>
          <ChinaMap
            v-else
            :mode="scope"
            :fit="selectedId !== null"
            :origin="selectedId !== null ? focusOriginPoint : null"
            :dest="selectedId !== null ? focusDestPoint : null"
            :stops="selectedId !== null ? focusStops : []"
            :active="activePoint"
            :provincesHL="provincesHL"
            :heat="heat"
            :bubbles="mapBubbles"
            :links="mapLinks"
            :legend="mapLegend"
            height="clamp(340px, calc(100vh - 330px), 560px)"
            @select="selectTrack"
            @task="openTask"
            @province="onProvince"
            @bubble="onBubble"
          />
        </n-spin>
      </section>

      <!-- 运单列表 -->
      <section class="card ov-list">
        <div class="panel-head ov-list__head">
          <span>{{ isHistory ? '已完结运单' : '在途运单' }}（{{ visibleMeta.length }}）</span>
          <span v-if="filterLabel" class="ov-list__clear" @click="clearFilters">清除筛选</span>
        </div>
        <n-spin :show="loading">
          <div v-if="!visibleMeta.length" class="ov-empty">
            {{ error ? '数据加载失败' : '暂无符合条件的运单' }}
          </div>
          <div v-else class="ov-list__body">
            <div
              v-for="meta in visibleMeta"
              :key="meta.task.id"
              class="ov-row"
              :class="{ selected: meta.task.id === selectedId }"
              @click="openTask(meta.task.id)"
            >
              <div class="ov-row__l1">
                <b>{{ meta.task.task_no }}</b>
                <StatusTag type="task" :value="meta.task.status" />
              </div>
              <div class="ov-row__route">
                {{ meta.origin?.city ?? cityLabel(meta.task.ship_location) }}
                <span class="ov-row__arrow">→</span>
                {{ meta.dest?.city ?? cityLabel(meta.task.delivery_address) }}
              </div>
              <div class="ov-row__l2">
                <span class="ov-row__loc" :title="meta.task.latest_track?.location_desc ?? ''">
                  {{ meta.task.latest_track?.location_desc || '暂无位置回传' }}
                </span>
                <span class="ov-row__time">
                  {{
                    isHistory && meta.task.finish_time
                      ? dateShort(meta.task.finish_time)
                      : meta.task.latest_track?.report_time
                        ? dateShort(meta.task.latest_track.report_time)
                        : ''
                  }}
                </span>
              </div>
            </div>
          </div>
        </n-spin>
      </section>
    </div>

    <!-- 运单详情抽屉 -->
    <Transition name="ov-drawer">
      <aside v-if="selectedId !== null" class="ov-drawer">
        <header class="ov-drawer__head">
          <div class="ov-drawer__title">
            <span>运单详情</span>
            <b>{{ focusTask?.task_no || '加载中…' }}</b>
            <StatusTag v-if="focusTask" type="task" :value="focusTask.status" />
          </div>
          <button type="button" class="ov-drawer__close" title="关闭（Esc）" @click="closeDrawer">
            ✕
          </button>
        </header>

        <n-spin :show="detailLoading">
          <div class="ov-drawer__body">
            <div v-if="detailError" class="ov-empty">
              <span class="ov-empty__error">{{ detailError }}</span>
              <n-button size="small" type="primary" @click="retryDetail">重试</n-button>
            </div>

            <template v-else-if="focusTask">
              <!-- 进度 -->
              <div class="ov-progress">
                <div class="ov-progress__line">
                  <div class="ov-progress__fill" :style="{ width: `${focusRoutePct}%` }"></div>
                  <div class="ov-progress__node done" style="left: 0">
                    <i></i>
                    <span class="ov-progress__txt start">{{ originShort }}</span>
                  </div>
                  <div
                    v-if="focusTracks.length"
                    class="ov-progress__node done"
                    :style="{ left: `${focusRoutePct}%` }"
                  >
                    <i></i>
                    <span class="ov-progress__txt bottom">{{ curPosShort }}</span>
                  </div>
                  <div
                    class="ov-progress__node"
                    :class="{ done: focusRoutePct >= 100 }"
                    style="left: 100%"
                  >
                    <i></i>
                    <span class="ov-progress__txt end">{{ destShort }}</span>
                  </div>
                </div>
              </div>

              <!-- 基本信息 -->
              <div class="ov-desc">
                <div><label>运输单号</label><span>{{ focusTracks[0]?.transport_no || '-' }}</span></div>
                <div><label>VIN</label><span>{{ focusTask.vins || '-' }}</span></div>
                <div><label>车型</label><span>{{ focusTask.vehicle_models || '-' }}</span></div>
                <div><label>客户</label><span>{{ focusTask.customer_name || '-' }}</span></div>
                <div><label>承运商</label><span>{{ focusTask.carrier_name || '-' }}</span></div>
                <div><label>司机</label><span>{{ focusTask.driver_name || '-' }}</span></div>
                <div><label>司机电话</label><span>{{ formatPhone(focusTask.driver_phone) }}</span></div>
                <div v-if="!isHistory">
                  <label>预计提车</label><span>{{ dateOnly(focusTask.plan_pickup_date) }}</span>
                </div>
                <div><label>发运时间</label><span>{{ datetime(focusTask.ship_time) }}</span></div>
                <div><label>到达时间</label><span>{{ datetime(focusTask.arrive_time) }}</span></div>
                <div v-if="isHistory">
                  <label>完成时间</label><span>{{ datetime(focusTask.finish_time) }}</span>
                </div>
                <div><label>计划运费</label><span>¥{{ money(focusTask.plan_freight) }}</span></div>
                <div class="wide">
                  <label>交付地址</label><span>{{ focusTask.delivery_address || '-' }}</span>
                </div>
              </div>

              <!-- 上报点 -->
              <div class="ov-block">
                <div class="ov-block__head">
                  <span>上报点</span>
                  <em>{{ focusTracks.length }} 个</em>
                </div>
                <div v-if="focusTracks.length" class="ov-rail">
                  <button
                    v-for="(track, index) in focusTracks"
                    :key="track.id ?? index"
                    type="button"
                    class="ov-rail__node"
                    :class="{ active: index === selectedTrackIndex }"
                    :title="trackTip(track)"
                    @click="selectTrack(index)"
                  >
                    <i></i>
                    <span class="ov-rail__name">{{ cityLabel(track.location_desc) }}</span>
                    <span class="ov-rail__time">{{ dateShort(track.report_time) }}</span>
                  </button>
                </div>
                <div v-else class="ov-block__empty">暂无位置回传记录</div>
                <div v-if="activeTrack" class="ov-rail__info">
                  <span><label>上报时间</label>{{ datetimeFull(activeTrack.report_time) }}</span>
                  <span><label>位置</label>{{ activeTrack.location_desc || '-' }}</span>
                  <span><label>时速</label>{{ activeTrack.speed ? `${activeTrack.speed} km/h` : '-' }}</span>
                </div>
              </div>

              <!-- 位置记录 -->
              <div class="ov-block">
                <div class="ov-block__head">
                  <span>位置记录</span>
                  <em>{{ focusTracks.length }} 条</em>
                </div>
                <div class="ov-table-scroll">
                  <table class="ov-table">
                    <thead>
                      <tr><th>上报时间</th><th>位置</th><th>时速</th></tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(track, index) in focusTracks"
                        :key="track.id ?? index"
                        :class="{ active: index === selectedTrackIndex }"
                        @click="selectTrack(index)"
                      >
                        <td>{{ datetime(track.report_time) }}</td>
                        <td class="ov-table__loc" :title="track.location_desc ?? ''">
                          {{ track.location_desc || '-' }}
                        </td>
                        <td>{{ track.speed ? `${track.speed} km/h` : '-' }}</td>
                      </tr>
                      <tr v-if="!focusTracks.length">
                        <td colspan="3" class="ov-block__empty">暂无位置记录</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </template>
          </div>
        </n-spin>
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
/* ---- 工具栏 ---- */
.ov-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 14px;
  padding: 10px 14px;
  margin-bottom: 12px;
}

.ov-tabs {
  display: inline-flex;
  flex: none;
  padding: 2px;
  background: #f0f2f5;
  border-radius: 4px;
}

.ov-tab {
  height: 26px;
  padding: 0 18px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: #595959;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.ov-search {
  width: 260px;
  flex: 0 1 260px;
  min-width: 150px;
}

.ov-tab.is-active {
  background: #ffffff;
  color: #1677ff;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.12);
}

.ov-toolbar__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.ov-toolbar__live {
  font-size: 12px;
  color: #8c8c8c;
}

/* ---- KPI ---- */
.ov-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.kpi {
  position: relative;
  padding: 14px 16px 13px;
  overflow: hidden;
}

.kpi::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #1677ff;
}

.kpi--blue::before {
  background: #1677ff;
}

.kpi--cyan::before {
  background: #08979c;
}

.kpi--green::before {
  background: #389e0d;
}

.kpi--orange::before {
  background: #fa8c16;
}

.kpi__label {
  font-size: 12px;
  color: #8c8c8c;
}

.kpi__value {
  margin-top: 4px;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.15;
  color: #262626;
}

.kpi__value > span {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 400;
  color: #8c8c8c;
}

.kpi__sub {
  margin-top: 5px;
  font-size: 12px;
  color: #8c8c8c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 地图 + 列表 ---- */
.ov-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 12px;
  align-items: start;
}

.card {
  background: #ffffff;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04);
}

.ov-map {
  overflow: hidden;
}

.ov-map__right {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 6px 10px;
  font-weight: 400;
}

.ov-map__hint {
  font-size: 12px;
  color: #8c8c8c;
}

.ov-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  background: #e6f4ff;
  color: #1677ff;
  font-size: 12px;
}

.ov-chip__close {
  cursor: pointer;
  font-weight: 400;
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

.ov-list {
  max-height: 560px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ov-list__head {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #ffffff;
}

.ov-list__clear {
  font-weight: 400;
  font-size: 12px;
  color: #1677ff;
  cursor: pointer;
}

.ov-list__body {
  overflow-y: auto;
  max-height: 500px;
}

.ov-row {
  padding: 10px 14px;
  border-bottom: 1px solid #f5f5f5;
  cursor: pointer;
  transition: background 0.12s;
}

.ov-row:hover {
  background: #f7fafd;
}

.ov-row.selected {
  background: #f0f7ff;
  border-left: 3px solid #1677ff;
  padding-left: 11px;
}

.ov-row__l1 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ov-row__l1 b {
  font-size: 13px;
  color: #262626;
}

.ov-row__route {
  margin-top: 3px;
  font-size: 12px;
  color: #595959;
}

.ov-row__arrow {
  margin: 0 4px;
  color: #bfbfbf;
}

.ov-row__l2 {
  margin-top: 3px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #8c8c8c;
}

.ov-row__loc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ov-row__time {
  flex: none;
}

/* ---- 事件状态 ---- */
.ov-empty {
  padding: 46px 0;
  text-align: center;
  color: #8c8c8c;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.ov-empty__error {
  color: #f5222d;
}

/* ---- 抽屉 ---- */
.ov-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 480px;
  max-width: 100vw;
  background: #ffffff;
  box-shadow: -6px 0 24px rgba(31, 45, 61, 0.16);
  z-index: 80;
  display: flex;
  flex-direction: column;
}

.ov-drawer__head {
  flex: none;
  height: 50px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #f0f0f0;
}

.ov-drawer__title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ov-drawer__title > span {
  font-size: 13px;
  color: #8c8c8c;
}

.ov-drawer__title > b {
  font-size: 14px;
  color: #262626;
  white-space: nowrap;
}

.ov-drawer__close {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #8c8c8c;
  cursor: pointer;
  font-size: 13px;
}

.ov-drawer__close:hover {
  background: #f0f2f5;
  color: #262626;
}

.ov-drawer__body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ov-drawer-enter-active,
.ov-drawer-leave-active {
  transition: transform 0.24s ease, opacity 0.24s ease;
}

.ov-drawer-enter-from,
.ov-drawer-leave-to {
  transform: translateX(24px);
  opacity: 0;
}

/* ---- 进度条 ---- */
.ov-progress {
  padding: 14px 10px 4px;
}

.ov-progress__line {
  position: relative;
  height: 6px;
  margin: 24px 6px 30px;
  background: #e5e6eb;
  border-radius: 3px;
}

.ov-progress__fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: #1677ff;
  border-radius: 3px;
  transition: width 0.4s;
}

.ov-progress__node {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}

.ov-progress__node i {
  display: block;
  width: 12px;
  height: 12px;
  margin: 0 auto;
  border-radius: 50%;
  border: 3px solid #d9d9d9;
  background: #ffffff;
}

.ov-progress__node.done i {
  border-color: #1677ff;
  background: #1677ff;
}

.ov-progress__txt {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 18px;
  white-space: nowrap;
  font-size: 12px;
  color: #595959;
}

.ov-progress__txt.bottom {
  top: 18px;
  bottom: auto;
}

.ov-progress__txt.start {
  left: 0;
  transform: none;
}

.ov-progress__txt.end {
  left: auto;
  right: -40px;
  transform: none;
}

/* ---- 基本信息 ---- */
.ov-desc {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  overflow: hidden;
}

.ov-desc > div {
  display: flex;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
  border-right: 1px solid #f0f0f0;
  font-size: 12px;
}

.ov-desc > div:nth-child(2n) {
  border-right: none;
}

.ov-desc > div.wide {
  grid-column: 1 / -1;
  border-right: none;
}

.ov-desc label {
  width: 72px;
  flex: none;
  color: #8c8c8c;
}

.ov-desc span {
  color: #262626;
  word-break: break-all;
}

/* ---- 上报点 / 记录 ---- */
.ov-block {
  border: 1px solid #e8edf5;
  border-radius: 6px;
  padding: 10px 12px;
  background: #f9fbfe;
}

.ov-block__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #262626;
}

.ov-block__head em {
  font-style: normal;
  font-size: 12px;
  font-weight: 400;
  color: #8c8c8c;
}

.ov-block__empty {
  padding: 14px 0;
  text-align: center;
  color: #8c8c8c;
  font-size: 12px;
}

.ov-rail {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.ov-rail__node {
  flex: none;
  width: 92px;
  padding: 7px 8px;
  border: 1px solid #e5e9f2;
  border-radius: 5px;
  background: #ffffff;
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ov-rail__node i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1677ff;
}

.ov-rail__node.active {
  border-color: #1677ff;
  background: #f0f7ff;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.12);
}

.ov-rail__name {
  font-size: 12px;
  color: #262626;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ov-rail__time {
  font-size: 11px;
  color: #8c8c8c;
}

.ov-rail__info {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: #262626;
}

.ov-rail__info label {
  display: inline-block;
  width: 60px;
  color: #8c8c8c;
}

.ov-table-scroll {
  max-height: 200px;
  overflow: auto;
  border: 1px solid #f0f0f0;
  border-radius: 4px;
  background: #ffffff;
}

.ov-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.ov-table th {
  position: sticky;
  top: 0;
  background: #fafafa;
  color: #595959;
  font-weight: 500;
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid #f0f0f0;
}

.ov-table td {
  padding: 7px 10px;
  border-bottom: 1px solid #f5f5f5;
  color: #262626;
}

.ov-table tbody tr {
  cursor: pointer;
}

.ov-table tbody tr:hover {
  background: #f7fafd;
}

.ov-table tbody tr.active {
  background: #f0f7ff;
}

.ov-table__loc {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 窄屏 ---- */
@media (max-width: 1280px) {
  .ov-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .ov-list {
    max-height: 380px;
  }

  .ov-list__body {
    max-height: 320px;
  }
}

@media (max-width: 1100px) {
  .ov-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ov-toolbar__actions {
    margin-left: 0;
  }
}
</style>
