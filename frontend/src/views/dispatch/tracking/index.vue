<script setup lang="ts">
/**
 * 运输监控（在途 / 历史双视角，原「全国态势」「在途监控」「历史轨迹」合并为一页）
 *
 * - 全国地图总览：轨迹线为各运单轨迹（点击定位运单），同城多单聚合成数字气泡（点击按城市筛选），
 *   同城单票为小圆点（点击打开详情）；历史视角叠加到达省份热力。
 * - 右侧运单列表与地图双向联动；选中运单后地图自动放大到该运单起终点并展示全部回传点，
 *   右侧抽屉展示运单信息、异常记录与位置记录。
 * - 顶部 KPI：运单量、覆盖省份、运输车辆、运输线路；在途视角 30s 自动刷新。
 * - 视角与 URL 的 ?scope= 同步，旧「历史轨迹」入口重定向到本页并自动切到历史视角。
 */
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getTrackingOverview, getTrackingTask } from '@/services/tracking'
import type { TrackingOverviewTask, TrackingTask, TrackingTaskDetail, TransportTrack } from '@/types/api'
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
  /** 超时未上报位置：线路标红，独立统计 */
  abnormal: boolean
}

/** 司机按规定每小时上报一次位置，超过 1 小时未回传即视为异常线路；再次上报后自动恢复 */
const REPORT_TIMEOUT_MS = 60 * 60 * 1000

function reportAgeMs(raw?: string | null): number | null {
  if (!raw) return null
  const time = new Date(String(raw).replace(' ', 'T')).getTime()
  if (!Number.isFinite(time)) return null
  return Date.now() - time
}

/** 超时起算点：有回传按最近回传时间；无回传按进入在途时间，避免刚进入在途就被判超时 */
function reportBaseline(task?: Partial<TrackingTask> | null): string | null {
  if (!task) return null
  return task.latest_track?.report_time ?? task.outbound_date ?? task.ship_time ?? task.create_time ?? null
}

function isOverdue(status?: string | null, raw?: string | null): boolean {
  if (status !== 'IN_TRANSIT') return false
  const age = reportAgeMs(raw)
  return age !== null && age > REPORT_TIMEOUT_MS
}

function durationText(ms: number): string {
  const total = Math.max(1, Math.floor(ms / 60000))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours <= 0) return `${minutes} 分钟`
  if (minutes === 0) return `${hours} 小时`
  return `${hours} 小时 ${minutes} 分`
}

function reportHint(task: TrackingOverviewTask): string {
  const age = reportAgeMs(reportBaseline(task))
  if (age === null) return '暂无上报'
  if (isOverdue(task.status, reportBaseline(task))) return `超时 ${durationText(age)}`
  return task.latest_track ? `${durationText(age)}前上报` : `在途 ${durationText(age)}，待首次回传`
}

function isReportOverdue(task: TrackingOverviewTask): boolean {
  return isOverdue(task.status, reportBaseline(task))
}

// ---- 数据加载 ----
const route = useRoute()
const router = useRouter()
const scope = ref<Scope>(route.query.scope === 'history' ? 'history' : 'transit')
const loading = ref(false)
const error = ref<string | null>(null)
const tasks = ref<TrackingOverviewTask[]>([])

const isHistory = computed(() => scope.value === 'history')

let lastLoadAt = 0

async function loadOverview(silent = false) {
  if (!silent) loading.value = true
  error.value = null
  try {
    const result = await getTrackingOverview(scope.value)
    tasks.value = result?.tasks ?? []
    lastLoadAt = Date.now()
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
  taskNoFilter.value = ''
  transportNoFilter.value = ''
  vinFilter.value = ''
  customerFilter.value = ''
  destinationFilter.value = ''
  finishRange.value = null
  provinceFilter.value = null
  cityFilter.value = null
  onlyAbnormal.value = false
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

function mileageLabel(value?: number | string | null): string {
  return value === null || value === undefined || value === '' ? '-' : `${value} km`
}

const metaList = computed<TaskMeta[]>(() =>
  tasks.value.map((task) => ({
    task,
    origin: geoOf(task.ship_location),
    dest: geoOf(task.delivery_address),
    province: matchProvince(task.delivery_address) ?? null,
    abnormal: isReportOverdue(task),
  }))
)

// ---- 筛选（按字段分项 + 省份 / 同城 / 异常） ----
const taskNoFilter = ref('')
const transportNoFilter = ref('')
const vinFilter = ref('')
const customerFilter = ref('')
const destinationFilter = ref('')
/** 历史态势：完成时间范围（开始~结束，yyyy-MM-dd） */
const finishRange = ref<[string, string] | null>(null)
const provinceFilter = ref<string | null>(null)
const cityFilter = ref<string | null>(null)
const onlyAbnormal = ref(false)

const activeFilterCount = computed(
  () =>
    [
      taskNoFilter.value,
      transportNoFilter.value,
      vinFilter.value,
      customerFilter.value,
      destinationFilter.value,
    ].filter((v) => v.trim()).length +
    (provinceFilter.value ? 1 : 0) +
    (cityFilter.value ? 1 : 0) +
    (onlyAbnormal.value ? 1 : 0) +
    (isHistory.value && finishRange.value ? 1 : 0)
)

const visibleMeta = computed<TaskMeta[]>(() => {
  const taskNo = taskNoFilter.value.trim().toLowerCase()
  const transportNo = transportNoFilter.value.trim().toLowerCase()
  const vin = vinFilter.value.trim().toLowerCase()
  const customer = customerFilter.value.trim().toLowerCase()
  const destination = destinationFilter.value.trim().toLowerCase()
  const list = metaList.value.filter((meta) => {
    if (onlyAbnormal.value && !meta.abnormal) return false
    if (provinceFilter.value && meta.province !== provinceFilter.value) return false
    if (cityFilter.value && meta.dest?.city !== cityFilter.value) return false
    if (taskNo && !String(meta.task.task_no ?? '').toLowerCase().includes(taskNo)) return false
    if (transportNo && !String(meta.task.latest_track?.transport_no ?? '').toLowerCase().includes(transportNo)) {
      return false
    }
    if (vin && !String(meta.task.vins ?? '').toLowerCase().includes(vin)) return false
    if (customer && !String(meta.task.customer_name ?? '').toLowerCase().includes(customer)) return false
    if (destination && !String(meta.task.delivery_address ?? '').toLowerCase().includes(destination)) return false
    if (isHistory.value && finishRange.value) {
      const finish = String(meta.task.finish_time ?? '').slice(0, 10)
      const [start, end] = finishRange.value
      if (!finish || finish < start || finish > end) return false
    }
    return true
  })
  if (!isHistory.value) {
    list.sort((a, b) => {
      if (a.abnormal !== b.abnormal) return a.abnormal ? -1 : 1
      const ageA = reportAgeMs(a.task.latest_track?.report_time) ?? Number.POSITIVE_INFINITY
      const ageB = reportAgeMs(b.task.latest_track?.report_time) ?? Number.POSITIVE_INFINITY
      return a.abnormal ? ageB - ageA : ageA - ageB
    })
  }
  return list
})

const filterLabel = computed(() => {
  const parts: string[] = []
  if (onlyAbnormal.value) parts.push('只看异常')
  if (isHistory.value && finishRange.value) {
    parts.push(`完成时间：${finishRange.value[0]} ~ ${finishRange.value[1]}`)
  }
  if (cityFilter.value) parts.push(`目的地：${cityFilter.value}`)
  else if (provinceFilter.value) parts.push(`到达省份：${provinceFilter.value}`)
  return parts.join(' · ')
})

function clearFilters() {
  taskNoFilter.value = ''
  transportNoFilter.value = ''
  vinFilter.value = ''
  customerFilter.value = ''
  destinationFilter.value = ''
  finishRange.value = null
  provinceFilter.value = null
  cityFilter.value = null
  onlyAbnormal.value = false
}

function toggleAbnormal() {
  if (isHistory.value) return
  onlyAbnormal.value = !onlyAbnormal.value
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

// ---- KPI（跟随当前筛选结果统计） ----
const provinceCount = computed(() => {
  const set = new Set<string>()
  visibleMeta.value.forEach((meta) => meta.province && set.add(meta.province))
  return set.size
})

const cityCount = computed(() => {
  const set = new Set<string>()
  visibleMeta.value.forEach((meta) => meta.dest && set.add(meta.dest.city))
  return set.size
})

const vehicleCount = computed(() => {
  const set = new Set<string>()
  visibleMeta.value.forEach((meta) => {
    String(meta.task.vins ?? '')
      .split('、')
      .map((vin) => vin.trim())
      .filter(Boolean)
      .forEach((vin) => set.add(vin))
  })
  return set.size
})

/** 异常单数：跟随筛选结果统计 */
const abnormalCount = computed(() => visibleMeta.value.filter((meta) => meta.abnormal).length)

const routeCount = computed(() => {
  const set = new Set<string>()
  visibleMeta.value.forEach((meta) => {
    set.add(`${meta.origin?.city ?? cityLabel(meta.task.ship_location)}→${meta.dest?.city ?? cityLabel(meta.task.delivery_address)}`)
  })
  return set.size
})

const topProvince = computed(() => {
  const acc = provinceCounts(visibleMeta.value)
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
/**
 * 总览飞线固定连接「发运地 → 交付地」两端城市点：
 * 上报名只是途中位置，若按上报点收尾，弧线会断在半路、和目的地圆点对不上。
 */
function routePoints(meta: TaskMeta): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  if (meta.origin) pts.push([meta.origin.lng, meta.origin.lat])
  if (meta.dest) pts.push([meta.dest.lng, meta.dest.lat])
  return pts
}

const mapLinks = computed(() => {
  if (selectedId.value !== null) return []
  return visibleMeta.value
    .map((meta) => ({
      id: meta.task.id,
      points: routePoints(meta),
      active: false,
      alert: meta.abnormal,
      label: `${meta.task.task_no} · ${meta.origin?.city ?? '-'} → ${meta.dest?.city ?? '-'}${meta.abnormal ? '（超时未上报）' : ''}`,
    }))
    .filter((link) => link.points.length >= 2)
    .sort((a, b) => Number(a.alert) - Number(b.alert))
})

interface CityCluster {
  city: string
  lng: number
  lat: number
  tasks: TrackingOverviewTask[]
  abnormal: number
}

const clusters = computed<CityCluster[]>(() => {
  const map = new Map<string, CityCluster>()
  visibleMeta.value.forEach((meta) => {
    if (!meta.dest) return
    const key = meta.dest.city
    const hit = map.get(key)
    if (hit) {
      hit.tasks.push(meta.task)
      if (meta.abnormal) hit.abnormal += 1
    } else {
      map.set(key, {
        city: key,
        lng: meta.dest.lng,
        lat: meta.dest.lat,
        tasks: [meta.task],
        abnormal: meta.abnormal ? 1 : 0,
      })
    }
  })
  return [...map.values()]
})

/**
 * 同城多单：圆点旁写城市名和单量；单票只留小圆点。
 * 点击后单票直接打开详情，多单按城市筛选。
 */
const mapBubbles = computed(() => {
  if (selectedId.value !== null) return []
  return clusters.value.map((cluster) => ({
    key: cluster.city,
    name: cluster.city,
    lng: cluster.lng,
    lat: cluster.lat,
    count: cluster.tasks.length,
    hideCount: cluster.tasks.length === 1,
    active: cityFilter.value === cluster.city,
    alert: cluster.abnormal > 0,
    alertCount: cluster.abnormal,
    tip: `${cluster.city} · ${cluster.tasks.length} 单${cluster.abnormal ? `（异常 ${cluster.abnormal} 单）` : ''}\n${cluster.tasks.map((t) => t.task_no).join('\n')}`,
  }))
})

const provincesHL = computed(() => (provinceFilter.value ? [provinceFilter.value] : []))

/** 发运枢纽：同城发运聚成一个汇聚点，飞线从这里放射出去 */
const mapHubs = computed(() => {
  if (selectedId.value !== null) return []
  const acc = new Map<string, { key: string; name: string; lng: number; lat: number; count: number }>()
  visibleMeta.value.forEach((meta) => {
    if (!meta.origin) return
    const hit = acc.get(meta.origin.city)
    if (hit) hit.count += 1
    else
      acc.set(meta.origin.city, {
        key: meta.origin.city,
        name: meta.origin.city,
        lng: meta.origin.lng,
        lat: meta.origin.lat,
        count: 1,
      })
  })
  return [...acc.values()].map((hub) => ({ ...hub, tip: `${hub.name} · 发运 ${hub.count} 单` }))
})

// ---- 选中运单（右侧抽屉） ----
const selectedId = ref<number | null>(null)
const detail = ref<TrackingTaskDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)
const selectedTrackIndex = ref<number | null>(null)

const focusTask = computed(() => detail.value?.task ?? null)
const focusTracks = computed<TransportTrack[]>(() => detail.value?.tracks ?? [])

/** 当前选中运单是否异常：详情已加载时用最新轨迹，否则用总览里的最近上报 */
const selectedAbnormal = computed(() => {
  if (selectedId.value === null || isHistory.value) return false
  if (focusTask.value && Number(focusTask.value.id) === selectedId.value) {
    const last = focusTracks.value[focusTracks.value.length - 1]
    return isOverdue(focusTask.value.status, last?.report_time ?? reportBaseline(focusTask.value))
  }
  return metaList.value.find((meta) => meta.task.id === selectedId.value)?.abnormal ?? false
})

/** 物料明细：VIN 与车型按顿号聚合且顺序一一对应，拆成每台车一行 */
const vehicleRows = computed(() => {
  const vins = String(focusTask.value?.vins ?? '').split('、').filter(Boolean)
  const models = String(focusTask.value?.vehicle_models ?? '').split('、').filter(Boolean)
  return vins.map((vin, index) => ({ vin, model: models[index] || '-' }))
})

/** 异常记录：相邻上报间隔超 1 小时各记一条（起点=上次上报+1h），仍在超时则追加未恢复记录，按时间先后排列 */
interface AnomalyRecord {
  key: string
  start: number | null
  end: number | null
  duration: string
  ongoing: boolean
}

const anomalyRecords = computed<AnomalyRecord[]>(() => {
  const toMs = (raw?: string | null): number | null => {
    if (!raw) return null
    const time = new Date(String(raw).replace(' ', 'T')).getTime()
    return Number.isFinite(time) ? time : null
  }
  const tracks = focusTracks.value
  const records: AnomalyRecord[] = []
  for (let i = 1; i < tracks.length; i++) {
    const prev = toMs(tracks[i - 1].report_time)
    const cur = toMs(tracks[i].report_time)
    if (prev === null || cur === null || cur - prev <= REPORT_TIMEOUT_MS) continue
    const start = prev + REPORT_TIMEOUT_MS
    records.push({
      key: `gap-${tracks[i].id ?? i}`,
      start,
      end: cur,
      duration: durationText(cur - start),
      ongoing: false,
    })
  }
  const baseRaw = reportBaseline(focusTask.value)
  if (isOverdue(focusTask.value?.status, baseRaw)) {
    const base = toMs(baseRaw)
    const start = base === null ? null : base + REPORT_TIMEOUT_MS
    records.push({
      key: 'ongoing',
      start,
      end: null,
      duration: start === null ? '在途后尚未上报' : durationText(Date.now() - start),
      ongoing: true,
    })
  }
  return records.sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
})

const mapLegend = computed(() => {
  if (selectedId.value !== null) {
    const items: Array<{ color: string; text: string; kind: 'line' | 'dot'; dashed?: boolean }> = [
      { color: '#18a058', text: `起始地：${cityLabel(focusTask.value?.ship_location)}`, kind: 'dot' },
      { color: '#f0a020', text: `目的地：${cityLabel(focusTask.value?.delivery_address)}`, kind: 'dot' },
      { color: '#1890ff', text: '已行驶', kind: 'line' },
    ]
    if (!focusArrived.value) {
      items.push({ color: '#94a3b8', text: '未行驶', kind: 'line' as const, dashed: true })
    }
    items.push({ color: '#1890ff', text: '位置回传点（点击查看）', kind: 'dot' as const })
    if (selectedAbnormal.value) {
      items.push({ color: '#d03050', text: '最新位置超时未上报', kind: 'dot' as const })
    }
    return items
  }
  if (isHistory.value) {
    return [
      { color: 'linear-gradient(90deg,#FFF7E6,#FFD591,#F0A020)', text: '到达热度（越深单量越多）', kind: 'line' as const },
      { color: '#1890ff', text: '历史轨迹（点击定位运单）', kind: 'line' as const },
      { color: '#1890ff', text: '圆点为目的地，城市名后的数字为同城单量', kind: 'dot' as const },
    ]
  }
  return [
    { color: '#1890ff', text: '正常线路', kind: 'line' as const },
    { color: '#d03050', text: '异常线路 · 超 1 小时未上报，再次上报后恢复', kind: 'line' as const },
    { color: '#1890ff', text: '圆点为目的地，城市名后的数字为同城单量', kind: 'dot' as const },
  ]
})

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
  highlightTask(null)
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
  nextTick(() => {
    trackListRef.value?.querySelector('tr.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    mapRef.value?.locate?.()
  })
}

const trackListRef = ref<HTMLElement | null>(null)

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

/** 窄屏下筛选区默认收起，避免换行多行把地图挤出首屏 */
const isNarrow = ref(false)
const filtersOpen = ref(false)
let narrowMql: MediaQueryList | null = null

function onNarrowChange(event: MediaQueryListEvent) {
  isNarrow.value = event.matches
  if (!event.matches) filtersOpen.value = false
}

onMounted(() => {
  loadOverview()
  startAutoRefresh()
  window.addEventListener('keydown', handleKeydown)
  if (window.matchMedia) {
    narrowMql = window.matchMedia('(max-width: 1280px)')
    isNarrow.value = narrowMql.matches
    narrowMql.addEventListener('change', onNarrowChange)
  }
})

onUnmounted(() => {
  stopAutoRefresh()
  window.removeEventListener('keydown', handleKeydown)
  narrowMql?.removeEventListener('change', onNarrowChange)
  narrowMql = null
})

onDeactivated(stopAutoRefresh)

let activatedOnce = false
onActivated(() => {
  startAutoRefresh()
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  // 数据仍然新鲜时不重复拉取，避免切回页签触发整图重绘
  if (Date.now() - lastLoadAt < 20000) return
  refreshAll(true)
})

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && selectedId.value !== null) closeDrawer()
}

const mapRef = ref<{ highlight: (id: number | null) => void; locate?: () => void } | null>(null)
const listBody = ref<HTMLElement | null>(null)
const hoverId = ref<number | null>(null)

function highlightTask(id: number | null) {
  hoverId.value = id
  mapRef.value?.highlight(id)
}

function onMapHover(id: number | null) {
  highlightTask(id)
  if (id == null || !listBody.value) return
  const row = listBody.value.querySelector<HTMLElement>(`[data-task-row="${id}"]`)
  if (!row) return
  const box = listBody.value.getBoundingClientRect()
  const rowBox = row.getBoundingClientRect()
  if (rowBox.top < box.top || rowBox.bottom > box.bottom) {
    row.scrollIntoView({ block: 'nearest' })
  }
}
</script>

<template>
  <div class="stp-page overview" :class="{ 'has-drawer': selectedId !== null }">
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

      <div v-show="!isNarrow || filtersOpen" class="ov-filters">
        <n-input
          v-model:value="taskNoFilter"
          class="ov-filter"
          size="small"
          clearable
          placeholder="任务单号"
        />
        <n-input
          v-model:value="transportNoFilter"
          class="ov-filter"
          size="small"
          clearable
          placeholder="运输单号"
        />
        <n-input v-model:value="vinFilter" class="ov-filter" size="small" clearable placeholder="VIN" />
        <n-input
          v-model:value="customerFilter"
          class="ov-filter"
          size="small"
          clearable
          placeholder="客户名称"
        />
        <n-input
          v-model:value="destinationFilter"
          class="ov-filter"
          size="small"
          clearable
          placeholder="目的地"
        />
        <n-date-picker
          v-if="isHistory"
          v-model:formatted-value="finishRange"
          class="ov-filter ov-filter--range"
          type="daterange"
          size="small"
          value-format="yyyy-MM-dd"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          clearable
        />
      </div>

      <div class="ov-toolbar__actions">
        <n-button v-if="isNarrow" size="small" quaternary @click="filtersOpen = !filtersOpen">
          {{ filtersOpen ? '收起筛选' : '筛选' }}{{ activeFilterCount ? `（${activeFilterCount}）` : '' }}
        </n-button>
        <n-button v-if="activeFilterCount" size="small" quaternary @click="clearFilters">
          清除筛选（{{ activeFilterCount }}）
        </n-button>
        <span v-if="!isHistory && !isNarrow" class="ov-toolbar__live">每 30 秒自动刷新</span>
        <n-button size="small" :loading="loading" @click="refreshAll()">刷新</n-button>
      </div>
    </section>

    <!-- KPI -->
    <section class="ov-kpis">
      <div class="card kpi kpi--blue">
        <div class="kpi__label">{{ isHistory ? '已完结运单' : '在途运单' }}</div>
        <div class="kpi__value">{{ visibleMeta.length }}<span>单</span></div>
        <div class="kpi__sub">覆盖 {{ cityCount }} 个目的城市</div>
      </div>
      <div class="card kpi kpi--cyan">
        <div class="kpi__label">覆盖省份</div>
        <div class="kpi__value">{{ provinceCount }}<span>个</span></div>
        <div class="kpi__sub">
          {{ topProvince ? `TOP：${topProvince.name} · ${topProvince.count} 单` : '暂无省份数据' }}
        </div>
      </div>
      <div class="card kpi kpi--indigo">
        <div class="kpi__label">{{ isHistory ? '运输车辆' : '在途整车' }}</div>
        <div class="kpi__value">{{ vehicleCount }}<span>台</span></div>
        <div class="kpi__sub">按 VIN 去重 · 一车一单</div>
      </div>
      <button
        v-if="!isHistory"
        type="button"
        class="card kpi kpi--danger"
        :class="{ 'is-on': onlyAbnormal }"
        @click="toggleAbnormal"
      >
        <div class="kpi__label">异常运单</div>
        <div class="kpi__value kpi__value--danger">{{ abnormalCount }}<span>单</span></div>
        <div class="kpi__sub">{{ onlyAbnormal ? '正在只看异常，点击恢复全部' : '超过 1 小时未上报，点击筛选' }}</div>
      </button>
      <div class="card kpi kpi--amber">
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
            <span class="ov-map__hint">悬停高亮线路 · 点击查看运单 · 滚轮缩放</span>
          </div>
        </div>

        <n-spin :show="loading">
          <div v-if="error" class="ov-empty">
            <span class="ov-empty__error">{{ error }}</span>
            <n-button size="small" type="primary" quaternary @click="loadOverview()">重试</n-button>
          </div>
          <ChinaMap
            v-else
            ref="mapRef"
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
            :hubs="mapHubs"
            :legend="mapLegend"
            :route-alert="selectedAbnormal"
            :arrived="focusArrived"
            height="clamp(340px, calc(100vh - 330px), 560px)"
            @select="selectTrack"
            @task="openTask"
            @province="onProvince"
            @bubble="onBubble"
            @hover="onMapHover"
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
          <div v-else ref="listBody" class="ov-list__body">
            <div
              v-for="meta in visibleMeta"
              :key="meta.task.id"
              class="ov-row"
              :data-task-row="meta.task.id"
              :class="{
                selected: meta.task.id === selectedId,
                'is-alert': meta.abnormal,
                'is-hot': meta.task.id === hoverId,
              }"
              @click="openTask(meta.task.id)"
              @mouseenter="highlightTask(meta.task.id)"
              @mouseleave="highlightTask(null)"
            >
              <div class="ov-row__l1">
                <b>{{ meta.task.task_no }}</b>
                <span v-if="meta.abnormal" class="ov-row__badge">超时未上报</span>
                <StatusTag type="task" :value="meta.task.status" />
              </div>
              <div class="ov-row__route">
                {{ meta.origin?.city ?? cityLabel(meta.task.ship_location) }}
                <span class="ov-row__arrow">→</span>
                {{ meta.dest?.city ?? cityLabel(meta.task.delivery_address) }}
                <em class="ov-row__mile">{{ mileageLabel(meta.task.mileage) }}</em>
              </div>
              <div class="ov-row__l2">
                <span class="ov-row__loc" :title="meta.task.latest_track?.location_desc ?? ''">
                  {{ meta.task.latest_track?.location_desc || '暂无位置回传' }}
                </span>
                <span class="ov-row__time" :class="{ 'is-late': meta.abnormal }">
                  {{
                    isHistory && meta.task.finish_time
                      ? dateShort(meta.task.finish_time)
                      : reportHint(meta.task)
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

              <!-- 运单 -->
              <div class="ov-block">
                <div class="ov-block__head">
                  <span>运单</span>
                  <em>{{ focusTask.customer_name || '—' }}</em>
                </div>
                <div class="ov-fields">
                  <div class="wide">
                    <label>任务单号</label><span>{{ focusTask.task_no || '-' }}</span>
                  </div>
                  <div class="wide">
                    <label>运输单号</label><span>{{ focusTracks[0]?.transport_no || '-' }}</span>
                  </div>
                  <div><label>订单号</label><span>{{ focusTask.order_no || '-' }}</span></div>
                  <div><label>客户</label><span>{{ focusTask.customer_name || '-' }}</span></div>
                  <div><label>计划运费</label><span>¥{{ money(focusTask.plan_freight) }}</span></div>
                  <div><label>里程</label><span>{{ mileageLabel(focusTask.mileage) }}</span></div>
                  <div v-if="!isHistory">
                    <label>预计提车</label><span>{{ dateOnly(focusTask.plan_pickup_date) }}</span>
                  </div>
                  <div v-if="isHistory">
                    <label>完成时间</label><span>{{ datetime(focusTask.finish_time) }}</span>
                  </div>
                  <div><label>发运时间</label><span>{{ datetime(focusTask.ship_time) }}</span></div>
                  <div><label>到达时间</label><span>{{ datetime(focusTask.arrive_time) }}</span></div>
                  <div class="wide">
                    <label>交付地址</label><span>{{ focusTask.delivery_address || '-' }}</span>
                  </div>
                </div>
              </div>

              <!-- 物料 -->
              <div class="ov-block">
                <div class="ov-block__head">
                  <span>物料</span>
                  <em>{{ vehicleRows.length }} 台</em>
                </div>
                <div class="ov-table-scroll">
                  <table class="ov-table ov-table--static">
                    <thead>
                      <tr><th>序号</th><th>VIN</th><th>车型</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="(item, index) in vehicleRows" :key="item.vin">
                        <td>{{ index + 1 }}</td>
                        <td class="ov-table__vin">{{ item.vin }}</td>
                        <td>{{ item.model }}</td>
                      </tr>
                      <tr v-if="!vehicleRows.length">
                        <td colspan="3" class="ov-block__empty">暂无物料信息</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- 承运商信息 -->
              <div class="ov-block">
                <div class="ov-block__head">
                  <span>承运商信息</span>
                  <em>{{ focusTask.carrier_name || '未指派' }}</em>
                </div>
                <div class="ov-fields">
                  <div class="wide"><label>承运商</label><span>{{ focusTask.carrier_name || '-' }}</span></div>
                  <div><label>司机</label><span>{{ focusTask.driver_name || '-' }}</span></div>
                  <div><label>司机电话</label><span>{{ formatPhone(focusTask.driver_phone) }}</span></div>
                </div>
              </div>

              <!-- 异常记录：该运单全部异常按时间先后展示 -->
              <div v-if="anomalyRecords.length" class="ov-block ov-block--alert">
                <div class="ov-block__head">
                  <span>异常记录</span>
                  <em>{{ anomalyRecords.length }} 条 · 超时未上报</em>
                </div>
                <div class="ov-table-scroll ov-anomaly-list">
                  <table class="ov-table ov-table--static">
                    <thead>
                      <tr><th>异常时间</th><th>持续</th><th>状态</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="item in anomalyRecords" :key="item.key">
                        <td>
                          <template v-if="item.start">
                            {{ dateShort(item.start) }}
                            <span class="ov-anomaly__sep">~</span>
                            {{ item.end ? dateShort(item.end) : '至今' }}
                          </template>
                          <span v-else class="ov-anomaly__muted">在途后尚未上报</span>
                        </td>
                        <td class="ov-fields__alert">{{ item.duration }}</td>
                        <td>{{ item.ongoing ? '未恢复' : '已恢复' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div class="ov-anomaly__tip">司机按规定每小时上报一次，超 1 小时未上报记为异常；补报后自动恢复。</div>
              </div>

              <!-- 位置记录 -->
              <div class="ov-block">
                <div class="ov-block__head">
                  <span>位置记录</span>
                  <em>{{ focusTracks.length }} 条</em>
                </div>
                <div ref="trackListRef" class="ov-table-scroll">
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
  background: #f5f6fb;
  border-radius: 4px;
}

.ov-tab {
  height: 28px;
  padding: 0 18px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: #666666;
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.ov-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1 1 420px;
}

.ov-filter {
  width: 152px;
  flex: 0 1 152px;
  min-width: 120px;
}

.ov-filter--range {
  width: 240px;
  flex: 0 1 240px;
  min-width: 200px;
}

.ov-tab.is-active {
  background: #ffffff;
  color: #1890ff;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.12);
}

.ov-toolbar__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.ov-toolbar__live {
  font-size: 12px;
  color: #999999;
}

/* ---- KPI ---- */
.ov-kpis {
  display: grid;
  /* 窄屏自动换行，列数随宽度平滑变化（5/4/3/2） */
  grid-template-columns: repeat(auto-fit, minmax(156px, 1fr));
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
  background: #94a3b8;
}

.kpi--blue::before,
.kpi--cyan::before,
.kpi--indigo::before,
.kpi--amber::before {
  background: #1890ff;
}

.kpi--danger {
  width: 100%;
  padding: 14px 16px 13px;
  border: none;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.kpi--danger::before {
  background: #d03050;
}

.kpi--danger.is-on {
  background: #fff1f0;
  box-shadow: inset 0 0 0 1px #ffccc7;
}

.kpi__value--danger {
  color: #d03050;
}

.kpi__label {
  font-size: 12px;
  color: #64748b;
}

.kpi__value {
  margin-top: 4px;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.15;
  color: #0f172a;
}

.kpi__value > span {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 400;
  color: #64748b;
}

.kpi__sub {
  margin-top: 5px;
  font-size: 12px;
  color: #64748b;
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
  border: 1px solid #eeeeee;
  border-radius: 4px;
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
  color: #999999;
}

.ov-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  background: #e6f4ff;
  color: #1890ff;
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
  border-bottom: 1px solid #eeeeee;
  font-weight: 600;
  color: #2d3033;
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
  color: #1890ff;
  cursor: pointer;
}

.ov-list__body {
  min-height: 0;
  overflow-y: auto;
  max-height: 500px;
}

.ov-row {
  padding: 10px 14px;
  border-bottom: 1px solid #eeeeee;
  cursor: pointer;
  transition: background 0.12s;
}

.ov-row:hover {
  background: #f7fafd;
}

.ov-row.selected {
  background: #f0f7ff;
  border-left: 3px solid #1890ff;
  padding-left: 11px;
}

/* 异常线路：左侧红色提示条；悬停与地图线路联动 */
.ov-row.is-alert:not(.selected) {
  box-shadow: inset 3px 0 0 #d03050;
}

.ov-row.is-hot:not(.selected) {
  background: #f5f9ff;
}

.ov-row.is-alert.is-hot:not(.selected) {
  background: #fff7f6;
}

.ov-row.is-alert.selected {
  background: #fff1f0;
  border-left-color: #d03050;
}

.ov-row__time.is-late {
  color: #d03050;
  font-weight: 600;
}

.ov-row__badge {
  display: inline-flex;
  align-items: center;
  margin-right: auto;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: #fff1f0;
  color: #d03050;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.ov-row__l1 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ov-row__l1 b {
  font-size: 14px;
  color: #2d3033;
}

.ov-row__route {
  margin-top: 3px;
  font-size: 12px;
  color: #666666;
}

.ov-row__arrow {
  margin: 0 4px;
  color: #999999;
}

.ov-row__mile {
  margin-left: 8px;
  font-style: normal;
  color: #999999;
}

.ov-row__l2 {
  margin-top: 3px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #999999;
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
  color: #999999;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.ov-empty__error {
  color: #d03050;
}

/* ---- 抽屉 ---- */
.overview {
  --ov-drawer-w: clamp(360px, 38vw, 480px);
}

/* 抽屉展开时主内容让位，避免被面板整块遮住 */
.overview.has-drawer {
  padding-right: calc(var(--ov-drawer-w) + 16px);
}

.overview.has-drawer .ov-grid {
  grid-template-columns: minmax(0, 1fr);
}

.overview.has-drawer .ov-list {
  max-height: 380px;
}

@media (max-width: 1100px) {
  .overview.has-drawer {
    padding-right: 20px;
  }
}

.ov-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--ov-drawer-w);
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
  border-bottom: 1px solid #eeeeee;
}

.ov-drawer__title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ov-drawer__title > span {
  font-size: 14px;
  color: #666666;
}

.ov-drawer__title > b {
  font-size: 14px;
  color: #2d3033;
  white-space: nowrap;
}

.ov-drawer__close {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #999999;
  cursor: pointer;
  font-size: 13px;
}

.ov-drawer__close:hover {
  background: #f5f6fb;
  color: #2d3033;
}

.ov-drawer__body {
  flex: 1;
  min-height: 0;
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

/* ---- 抽屉信息列表 ---- */
.ov-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 16px;
}

.ov-fields > div {
  display: flex;
  padding: 5px 0;
  border-bottom: 1px dashed #eeeeee;
  font-size: 14px;
}

.ov-fields > div.wide {
  grid-column: 1 / -1;
}

.ov-fields label {
  width: 64px;
  flex: none;
  color: #999999;
}

.ov-fields span {
  color: #2d3033;
  word-break: break-all;
}

.ov-fields__alert {
  color: #d03050;
  font-weight: 600;
}

.ov-block--alert {
  border-color: #ffccc7;
  background: #fff8f7;
}

.ov-block--alert .ov-block__head em {
  color: #d03050;
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
  background: #1890ff;
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
  border: 3px solid #eeeeee;
  background: #ffffff;
}

.ov-progress__node.done i {
  border-color: #1890ff;
  background: #1890ff;
}

.ov-progress__txt {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 18px;
  white-space: nowrap;
  font-size: 12px;
  color: #666666;
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

/* ---- 区块 / 记录 ---- */
.ov-block {
  border: 1px solid #eeeeee;
  border-radius: 4px;
  padding: 10px 12px;
  background: #ffffff;
}

.ov-block__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 900;
  color: #2d3033;
}

.ov-block__head::before {
  content: '';
  width: 4px;
  height: 16px;
  flex: none;
  border-radius: 2px;
  background: #1890ff;
}

.ov-block__head em {
  font-style: normal;
  font-size: 12px;
  font-weight: 400;
  color: #999999;
}

.ov-block__empty {
  padding: 14px 0;
  text-align: center;
  color: #999999;
  font-size: 12px;
}

/* ---- 异常记录 ---- */
/* 异常记录：条数多时在框内下拉滚动，避免撑高抽屉 */
.ov-table-scroll.ov-anomaly-list {
  max-height: 150px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.ov-anomaly-list::-webkit-scrollbar {
  width: 6px;
}

.ov-anomaly-list::-webkit-scrollbar-thumb {
  background: #999999;
  border-radius: 3px;
}

.ov-anomaly-list::-webkit-scrollbar-track {
  background: transparent;
}

.ov-anomaly__sep {
  margin: 0 3px;
  color: #999999;
}

.ov-anomaly__muted {
  color: #999999;
}

.ov-anomaly__tip {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: #999999;
}

.ov-table-scroll {
  max-height: 200px;
  overflow: auto;
  border: 1px solid #eeeeee;
  border-radius: 4px;
  background: #ffffff;
}

.ov-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.ov-table th {
  position: sticky;
  top: 0;
  background: #fafafa;
  color: #666666;
  font-weight: 500;
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid #eeeeee;
}

.ov-table td {
  padding: 7px 10px;
  border-bottom: 1px solid #eeeeee;
  color: #2d3033;
}

.ov-table tbody tr {
  cursor: pointer;
}

.ov-table tbody tr:hover {
  background: #f7fafd;
}

.ov-table tbody tr.active {
  background: #e8f3ff;
  box-shadow: inset 3px 0 0 #1890ff;
}

.ov-table tbody tr.active td {
  color: #087ae3;
  font-weight: 600;
}

.ov-table__loc {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 只读表格（物料明细）：不显示可点击手型与悬停高亮 */
.ov-table--static tbody tr {
  cursor: default;
}

.ov-table--static tbody tr:hover {
  background: transparent;
}

.ov-table__vin {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* ---- 窄屏 ---- */
@media (max-width: 1280px) {
  .ov-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  /* 筛选区展开时两列网格，避免 152px 定宽换行成多行 */
  .ov-filters {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    flex-basis: 100%;
  }

  .ov-filter,
  .ov-filter--range {
    width: auto;
    min-width: 0;
  }

  .ov-filter--range {
    grid-column: span 2;
  }

  .ov-list {
    max-height: 380px;
  }

  .ov-list__body {
    max-height: 320px;
  }
}

@media (max-width: 1100px) {
  .ov-toolbar__actions {
    margin-left: 0;
  }
}

@media (max-width: 900px) {
  .ov-kpis {
    grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  }

  .ov-filters {
    grid-template-columns: minmax(0, 1fr);
  }

  .ov-filter--range {
    grid-column: span 1;
  }

  .ov-toolbar__actions {
    width: 100%;
  }

  .ov-list__body {
    max-height: 260px;
  }
}
</style>
