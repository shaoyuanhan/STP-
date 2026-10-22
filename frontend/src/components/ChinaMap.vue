<script setup lang="ts">
/**
 * 运输地图（高德 JS API 2.0）
 *
 * 全国总览：浅色底图 + 高德 Loca 脉冲飞线（按距离抬升的平滑弧线）。
 * 运单详情：按回传点连线并放大到该线路。
 * 城市坐标库与高德同为 GCJ-02，可直接落点。
 * 未配置 VITE_AMAP_KEY 时只显示配置说明，不回退到手绘简图。
 */
import { nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { matchCityGeo } from '@/lib/china-map'
import { amapKey, loadAmap, type AMapDistrict, type AMapInstance, type AMapOverlay } from '@/lib/amap'

interface MapBubble {
  key: string
  name?: string
  lng: number | string
  lat: number | string
  count: number
  hideCount?: boolean
  tip?: string
  active?: boolean
  alert?: boolean
  alertCount?: number
}

interface MapTag {
  id: number
  name: string
  lng: number | string
  lat: number | string
  active?: boolean
}

interface MapLink {
  id: number
  points: Array<[number, number]>
  active?: boolean
  label?: string
  alert?: boolean
}

interface MapHub {
  key: string
  name: string
  lng: number | string
  lat: number | string
  tip?: string
}

interface LegendItem {
  color: string
  text: string
  kind?: 'line' | 'dot'
  dashed?: boolean
}

interface GeoPoint {
  label?: string
  text?: string
  lng?: number | string
  lat?: number | string
  tip?: string
  index?: number
}

interface LngLat {
  lng: number
  lat: number
  label: string
  tip: string
  index?: number
}

const props = withDefaults(
  defineProps<{
    origin?: GeoPoint | null
    dest?: GeoPoint | null
    stops?: Array<GeoPoint>
    cur?: GeoPoint | null
    active?: GeoPoint | null
    originLabel?: string
    destLabel?: string
    curLabel?: string
    provincesHL?: string[]
    mode?: 'transit' | 'history'
    fit?: boolean
    heat?: Record<string, number> | null
    bubbles?: MapBubble[]
    tags?: MapTag[]
    links?: MapLink[]
    hubs?: MapHub[]
    legend?: LegendItem[] | null
    routeAlert?: boolean
    /** 已到达或已完结：终点并入已行驶实线，不再画未行驶虚线 */
    arrived?: boolean
    height?: number | string
  }>(),
  {
    origin: null,
    dest: null,
    stops: () => [],
    cur: null,
    active: null,
    originLabel: '',
    destLabel: '',
    curLabel: '',
    provincesHL: () => [],
    mode: 'transit',
    fit: true,
    heat: null,
    bubbles: () => [],
    tags: () => [],
    links: () => [],
    hubs: () => [],
    legend: null,
    routeAlert: false,
    arrived: false,
    height: 520,
  },
)

const emit = defineEmits<{
  select: [index: number]
  task: [id: number]
  province: [name: string]
  bubble: [key: string]
  hover: [id: number | null]
}>()

const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLElement | null>(null)
const missingKey = ref(false)
const loadError = ref('')
const ready = ref(false)
const hotId = ref<number | null>(null)

interface PulseFeature {
  distance?: number
  link?: { properties?: { id?: number; alert?: boolean } }
  properties?: { id?: number; alert?: boolean }
}

interface PulseLayer {
  setSource: (source: unknown) => void
  setStyle: (style: Record<string, unknown>) => void
  queryFeature: (pixel: number[]) => PulseFeature | null
}

interface LocaContainer {
  add: (layer: unknown) => void
  remove: (layer: unknown) => void
  destroy?: () => void
  animate: { start: () => void; stop?: () => void }
}

interface LocaNamespace {
  Container: new (opts: { map: AMapInstance }) => LocaContainer
  GeoJSONSource: new (opts: { data: unknown }) => unknown
  PulseLinkLayer: new (opts: Record<string, unknown>) => PulseLayer
}

let map: AMapInstance | null = null
let district: AMapDistrict | null = null
let districtKey = ''
let loca: LocaContainer | null = null
let pulseLayer: PulseLayer | null = null
let lines = new Map<number, AMapOverlay>()
let overlayClicked = false
let viewKey = ''
let viewChanged = false
let lastActiveKey = ''
let resizeObserver: ResizeObserver | null = null
let drawFrame = 0
let moveFrame = 0
let hidden = false
let dirty = false

function boxSize() {
  const el = root.value
  if (!el) return { width: 0, height: 0 }
  const box = el.getBoundingClientRect()
  return { width: box.width, height: box.height }
}

function locaNs(): LocaNamespace | null {
  return (window as Window & { Loca?: LocaNamespace }).Loca ?? null
}

function resolvePoint(point: GeoPoint | null | undefined, fallbackLabel?: string): LngLat | null {
  if (!point) return null
  let lng = point.lng === undefined || point.lng === null ? undefined : Number(point.lng)
  let lat = point.lat === undefined || point.lat === null ? undefined : Number(point.lat)
  if (lng === undefined || lat === undefined || !Number.isFinite(lng) || !Number.isFinite(lat)) {
    const matched = matchCityGeo(point.text || point.label || fallbackLabel || '')
    if (matched) {
      lng = matched.geo[0]
      lat = matched.geo[1]
    }
  }
  if (lng === undefined || lat === undefined || !Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return {
    lng,
    lat,
    label: point.label ?? fallbackLabel ?? '',
    tip: point.tip ?? '',
    index: point.index,
  }
}

function shortProvince(name: string): string {
  return name.replace(/维吾尔自治区|壮族自治区|回族自治区|特别行政区|自治区|省|市/g, '')
}

function arcPath(start: [number, number], end: [number, number]): Array<[number, number]> {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const dist = Math.hypot(dx, dy)
  if (dist < 0.2) return [start, end]
  const lift = Math.min(2.4, dist * 0.16)
  const cx = (start[0] + end[0]) / 2 + (-dy / dist) * lift
  const cy = (start[1] + end[1]) / 2 + (dx / dist) * lift
  const pts: Array<[number, number]> = []
  const steps = 32
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    pts.push([u * u * start[0] + 2 * u * t * cx + t * t * end[0], u * u * start[1] + 2 * u * t * cy + t * t * end[1]])
  }
  return pts
}

function markerBox(html: string): string {
  return `<div style="position:relative;width:0;height:0">${html}</div>`
}

function circle(color: string, size: number): string {
  return `<div style="position:absolute;left:0;top:0;width:${size}px;height:${size}px;margin-left:-${size / 2}px;margin-top:-${size / 2}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(15,23,42,.28)"></div>`
}

function bubbleHtml(bubble: MapBubble): string {
  const count = Math.max(1, Number(bubble.count) || 1)
  const alertCount = Math.max(0, Number(bubble.alertCount) || 0)
  const allAlert = alertCount > 0 && (bubble.hideCount || alertCount >= count)
  const dotColor = allAlert ? '#f5222d' : bubble.active ? '#fa8c16' : '#1677ff'
  const dot = `<span style="position:absolute;left:0;top:0;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:${dotColor};box-shadow:0 0 0 2px #fff"></span>`
  if (bubble.hideCount) return markerBox(dot)
  const numColor = alertCount > 0 ? '#cf1322' : '#1677ff'
  const nameColor = bubble.active ? '#d46b08' : '#334155'
  const label = bubble.name
    ? `<span style="position:absolute;left:8px;top:0;transform:translateY(-50%);white-space:nowrap;font:500 12px/1.2 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;color:${nameColor};text-shadow:0 0 2px #fff,0 0 3px #fff,1px 0 #fff,-1px 0 #fff,0 1px #fff,0 -1px #fff">${bubble.name}<span style="margin-left:4px;font-weight:600;color:${numColor}">${count}</span></span>`
    : ''
  return markerBox(`${dot}${label}`)
}

function featureProps(feat: PulseFeature | null | undefined) {
  return feat?.properties ?? feat?.link?.properties
}

function applyPulseStyle() {
  if (!pulseLayer) return
  const hot = hotId.value
  const blue = props.mode === 'history' ? '64,150,255' : '22,119,255'
  pulseLayer.setStyle({
    unit: 'px',
    dash: [16, 0, 16, 0],
    lineWidth: (_index: number, feat: PulseFeature) => {
      const id = featureProps(feat)?.id
      if (hot != null && id !== hot) return [0.8, 1.2]
      return [1.5, 3]
    },
    height: (_index: number, feat: PulseFeature) => Math.max(50000, (feat.distance || 0) / 2.8),
    smoothSteps: 50,
    speed: 18,
    flowLength: 90,
    lineColors: (_index: number, feat: PulseFeature) => {
      const meta = featureProps(feat)
      const dim = hot != null && meta?.id !== hot
      if (meta?.alert) {
        return dim
          ? ['rgba(245,34,45,0.04)', 'rgba(245,34,45,0.22)']
          : ['rgba(245,34,45,0.12)', 'rgba(245,34,45,0.95)']
      }
      return dim
        ? [`rgba(${blue},0.04)`, `rgba(${blue},0.18)`]
        : [`rgba(${blue},0.05)`, `rgba(${blue},0.92)`]
    },
    maxHeightScale: 0.42,
    headColor: 'rgba(255,255,255,0.95)',
    trailColor: 'rgba(255,255,255,0)',
  })
}

function applyHot() {
  applyPulseStyle()
  lines.forEach((line, id) => {
    const hot = hotId.value != null && id === hotId.value
    const alert = Boolean(line.getExtData()?.alert)
    const dim = hotId.value != null && !hot
    line.setOptions({
      strokeOpacity: dim ? 0.12 : alert ? 0.95 : 0.88,
      strokeWeight: hot ? 6 : alert ? 4 : 3,
      zIndex: hot ? 80 : alert ? 62 : 50,
    })
  })
}

function pixelOf(pixel: unknown): number[] | null {
  if (!pixel || typeof pixel !== 'object') return null
  const point = pixel as { x?: number; y?: number; toArray?: () => number[] }
  if (point.toArray) return point.toArray()
  if (point.x == null || point.y == null) return null
  return [point.x, point.y]
}

function linkAt(pixel: unknown): number | null {
  const arr = pixelOf(pixel)
  if (!arr || !pulseLayer) return null
  try {
    const id = Number(featureProps(pulseLayer.queryFeature(arr))?.id)
    return Number.isFinite(id) ? id : null
  } catch {
    return null
  }
}

function highlight(id: number | null) {
  hotId.value = id
  applyHot()
}

function districtStyles() {
  const heat = props.heat
  const showHeat = Boolean(heat && Object.keys(heat).length)
  const highlighted = new Set(props.provincesHL ?? [])
  const max = showHeat && heat ? Math.max(0, ...Object.values(heat)) : 0
  return {
    'nation-stroke': '#94a3b8',
    'coastline-stroke': '#94a3b8',
    'province-stroke': 'rgba(148,163,184,.85)',
    fill: (feature: { NAME_CHN?: string }) => {
      const name = shortProvince(String(feature?.NAME_CHN ?? ''))
      if (highlighted.has(name)) return 'rgba(250,140,22,.28)'
      if (!showHeat || !heat || !max) return 'rgba(255,255,255,0)'
      const count = heat[name] || 0
      if (!count) return 'rgba(255,255,255,0)'
      return `rgba(250,140,22,${(0.14 + (count / max) * 0.36).toFixed(2)})`
    },
  }
}

/** 省界图层代价很高（全国边界解析），仅在热度或高亮省份变化时更新 */
function paintDistrict(AMap: Awaited<ReturnType<typeof loadAmap>>) {
  if (!map || !AMap.DistrictLayer) return
  const key = `${JSON.stringify(props.heat ?? {})}|${(props.provincesHL ?? []).join(',')}`
  if (district) {
    if (key === districtKey) return
    if (district.setStyles) {
      district.setStyles(districtStyles())
      districtKey = key
      return
    }
    district.setMap(null)
    district = null
  }
  district = new AMap.DistrictLayer.Country({
    zIndex: 4,
    SOC: 'CHN',
    depth: 1,
    styles: districtStyles(),
  })
  district.setMap(map)
  districtKey = key
}

function addLine(
  AMap: Awaited<ReturnType<typeof loadAmap>>,
  path: Array<[number, number]>,
  opts: { id?: number; alert?: boolean; weight?: number; color?: string; halo?: string; dashed?: boolean },
) {
  if (!map || path.length < 2) return null
  const alert = Boolean(opts.alert)
  const weight = opts.weight ?? (alert ? 4 : 3)
  const color = opts.color ?? (alert ? '#f5222d' : props.mode === 'history' ? '#4096ff' : '#1677ff')
  const halo = opts.halo ?? (alert ? '#ffccc7' : '#91caff')
  const dash = opts.dashed ? { strokeStyle: 'dashed' as const, strokeDasharray: [10, 8] } : {}
  if (halo !== 'transparent') {
    map.add(
      new AMap.Polyline({
        path,
        strokeColor: halo,
        strokeWeight: weight + 6,
        strokeOpacity: 0.85,
        lineJoin: 'round',
        lineCap: 'round',
        zIndex: 40,
        bubble: true,
        ...dash,
      }),
    )
  }
  const line = new AMap.Polyline({
    path,
    strokeColor: color,
    strokeWeight: weight,
    strokeOpacity: 0.95,
    lineJoin: 'round',
    lineCap: 'round',
    cursor: opts.id == null ? 'default' : 'pointer',
    zIndex: alert ? 62 : 50,
    extData: { id: opts.id, alert },
    ...dash,
  })
  if (opts.id != null) {
    const id = opts.id
    line.on('click', () => {
      overlayClicked = true
      emit('task', id)
    })
    line.on('mouseover', () => {
      hotId.value = id
      applyHot()
      emit('hover', id)
    })
    line.on('mouseout', () => {
      if (hotId.value === id) {
        hotId.value = null
        applyHot()
        emit('hover', null)
      }
    })
    lines.set(id, line)
  }
  map.add(line)
  return line
}

function addMarker(
  AMap: Awaited<ReturnType<typeof loadAmap>>,
  position: [number, number],
  content: string,
  opts: { title?: string; zIndex?: number; clickable?: boolean; onClick?: () => void },
) {
  if (!map) return
  const marker = new AMap.Marker({
    position,
    content,
    anchor: 'center',
    offset: new AMap.Pixel(0, 0),
    zIndex: opts.zIndex ?? 70,
    title: opts.title ?? '',
    cursor: opts.onClick ? 'pointer' : 'default',
    clickable: opts.clickable !== false,
  })
  if (opts.onClick) {
    marker.on('click', () => {
      overlayClicked = true
      opts.onClick?.()
    })
  }
  map.add(marker)
}

function clearPulse() {
  if (pulseLayer && loca) loca.remove(pulseLayer)
  pulseLayer = null
}

function paintPulse(links: MapLink[]) {
  const Loca = locaNs()
  if (!Loca || !map) return false
  if (!loca) loca = new Loca.Container({ map })
  const features = links
    .map((link) => {
      const pts = (link.points || [])
        .map(([lng, lat]) => [Number(lng), Number(lat)] as [number, number])
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
      if (pts.length < 2) return null
      return {
        type: 'Feature',
        properties: { id: link.id, alert: Boolean(link.alert) },
        geometry: { type: 'LineString', coordinates: [pts[0], pts[pts.length - 1]] },
      }
    })
    .filter((item) => item !== null)
  if (!features.length) {
    clearPulse()
    return true
  }
  // 复用图层：只换数据源，避免每次刷新重建 Loca 渲染对象
  if (!pulseLayer) {
    pulseLayer = new Loca.PulseLinkLayer({
      zIndex: 120,
      opacity: 1,
      visible: true,
      zooms: [2, 22],
      depth: true,
    })
    pulseLayer.setSource(new Loca.GeoJSONSource({ data: { type: 'FeatureCollection', features } }))
    applyPulseStyle()
    loca.add(pulseLayer)
    loca.animate.start()
    return true
  }
  pulseLayer.setSource(new Loca.GeoJSONSource({ data: { type: 'FeatureCollection', features } }))
  applyPulseStyle()
  return true
}

function paintOverview(AMap: Awaited<ReturnType<typeof loadAmap>>) {
  const linked = paintPulse(props.links)
  if (!linked) {
    for (const link of props.links) {
      const pts = (link.points || [])
        .map(([lng, lat]) => [Number(lng), Number(lat)] as [number, number])
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
      if (pts.length < 2) continue
      addLine(AMap, arcPath(pts[0], pts[pts.length - 1]), { id: link.id, alert: link.alert })
    }
  }
  for (const hub of props.hubs) {
    const lng = Number(hub.lng)
    const lat = Number(hub.lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    addMarker(
      AMap,
      [lng, lat],
      markerBox(
        `${circle('#1677ff', 10)}<div style="position:absolute;left:50%;top:-18px;transform:translateX(-50%);white-space:nowrap;font:600 12px/1 sans-serif;color:#0958d9;text-shadow:0 0 3px #fff,0 0 3px #fff">${hub.name}</div>`,
      ),
      { title: hub.tip, zIndex: 40, clickable: false },
    )
  }
  for (const bubble of props.bubbles) {
    const lng = Number(bubble.lng)
    const lat = Number(bubble.lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    addMarker(AMap, [lng, lat], bubbleHtml(bubble), {
      title: bubble.tip,
      zIndex: 90,
      onClick: () => emit('bubble', bubble.key),
    })
  }
  for (const tag of props.tags) {
    const lng = Number(tag.lng)
    const lat = Number(tag.lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    addMarker(
      AMap,
      [lng, lat],
      markerBox(
        `<div style="position:absolute;left:50%;bottom:8px;transform:translateX(-50%);padding:2px 6px;border-radius:4px;background:#fff;border:1px solid #1677ff;color:#0958d9;font:600 11px/16px sans-serif;white-space:nowrap">${tag.name}</div>`,
      ),
      { zIndex: 88, onClick: () => emit('task', tag.id) },
    )
  }
}

function paintDetail(AMap: Awaited<ReturnType<typeof loadAmap>>) {
  const origin = resolvePoint(props.origin, props.originLabel)
  const dest = resolvePoint(props.dest, props.destLabel)
  const stops = (props.stops ?? [])
    .map((stop) => resolvePoint(stop, stop.label))
    .filter((item): item is LngLat => item !== null)
  const cur = resolvePoint(props.cur, props.curLabel)
  const traveled: Array<[number, number]> = []
  if (origin) traveled.push([origin.lng, origin.lat])
  stops.forEach((stop) => traveled.push([stop.lng, stop.lat]))
  if (cur) traveled.push([cur.lng, cur.lat])
  const tail = traveled[traveled.length - 1]
  if (props.arrived && dest) traveled.push([dest.lng, dest.lat])
  addLine(AMap, traveled, { color: '#1677ff', halo: '#91caff', weight: 4 })
  if (!props.arrived && dest && tail) {
    const remain: Array<[number, number]> = [tail, [dest.lng, dest.lat]]
    const dist = Math.hypot(dest.lng - tail[0], dest.lat - tail[1])
    if (dist > 0.02) addLine(AMap, remain, { color: '#94a3b8', halo: 'transparent', dashed: true, weight: 3 })
  }

  if (origin) {
    addMarker(AMap, [origin.lng, origin.lat], labeledDot('#52c41a', origin.label, 'top'), { title: origin.tip || origin.label, zIndex: 100 })
  }
  stops.forEach((stop, index) => {
    const isLast = index === stops.length - 1
    const latest = isLast && props.routeAlert && !props.arrived
    const size = latest ? 20 : isLast ? 16 : 10
    const color = latest ? '#f5222d' : '#1677ff'
    const html = latest
      ? `${circle(color, size)}<div class="cmap-latest__ring"></div>`
      : circle(color, size)
    addMarker(AMap, [stop.lng, stop.lat], markerBox(html), {
      title: stop.tip,
      zIndex: latest ? 110 : 96,
      onClick: stop.index === undefined ? undefined : () => emit('select', stop.index as number),
    })
  })
  const active = resolvePoint(props.active, '')
  if (active) {
    addMarker(
      AMap,
      [active.lng, active.lat],
      markerBox(
        `<div class="cmap-active"><div class="cmap-active__ring"></div></div>`,
      ),
      { zIndex: 120, clickable: false },
    )
  }
  if (dest) {
    addMarker(AMap, [dest.lng, dest.lat], labeledDot('#fa8c16', dest.label, 'bottom'), { title: dest.tip || dest.label, zIndex: 100 })
  }
}

function labeledDot(color: string, label: string, place: 'top' | 'bottom'): string {
  const textTop = place === 'top' ? '-22px' : '12px'
  return markerBox(
    `${circle(color, 14)}<div style="position:absolute;left:50%;top:${textTop};transform:translateX(-50%);white-space:nowrap;font:600 12px/1 sans-serif;color:#334155;text-shadow:0 0 3px #fff,0 0 3px #fff">${label}</div>`,
  )
}

function syncView() {
  if (!map) return
  const key = props.fit
    ? `d:${props.routeAlert}:${props.stops?.length ?? 0}:${props.origin?.text ?? ''}:${props.dest?.text ?? ''}`
    : `o:${props.links.map((link) => `${link.id}:${link.alert ? 1 : 0}`).join(',')}:${props.bubbles.map((item) => item.key).join(',')}`
  if (key === viewKey) return
  viewKey = key
  viewChanged = true
  map.setPitch?.(props.fit ? 0 : 42, true)
  map.setRotation?.(0, true)
  if (props.fit || props.links.length || props.bubbles.length) {
    map.setFitView(null, false, [36, 36, 36, 48], props.fit ? 11 : 6.5)
  } else {
    map.setZoomAndCenter(4.4, [104.2, 36.2], true)
  }
}

/** 点击位置记录后，把地图定位到该上报点（首次打开仍自适应全局线路） */
function focusActive(force = false) {
  if (!map || !props.fit) return
  const point = resolvePoint(props.active, '')
  if (!point) {
    lastActiveKey = ''
    return
  }
  const key = `${point.lng},${point.lat}`
  if (!force && key === lastActiveKey) return
  lastActiveKey = key
  const zoom = Math.max(Number(map.getZoom?.() ?? 6), 10)
  map.setZoomAndCenter(zoom, [point.lng, point.lat], false)
}

function draw() {
  if (!map) return
  const { width, height } = boxSize()
  if (hidden || width < 2 || height < 2) {
    dirty = true
    return
  }
  const AMap = (window as Window & { AMap?: Awaited<ReturnType<typeof loadAmap>> }).AMap
  if (!AMap) return
  dirty = false
  lines = new Map()
  const existing = (map.getAllOverlays?.() ?? []).filter((overlay) => overlay !== district)
  if (existing.length) map.remove(existing)
  paintDistrict(AMap)
  if (props.fit) {
    clearPulse()
    paintDetail(AMap)
  } else {
    paintOverview(AMap)
  }
  applyHot()
  viewChanged = false
  syncView()
  if (!viewChanged) focusActive()
}

function onMapClick(event: { pixel?: unknown }) {
  if (overlayClicked) {
    overlayClicked = false
    return
  }
  const id = linkAt(event.pixel)
  if (id != null) {
    emit('task', id)
    return
  }
  if (props.fit || !district?.getDistrictByContainerPos || !event.pixel) return
  const hit = district.getDistrictByContainerPos(event.pixel)
  const raw = hit?.NAME_CHN || hit?.NAME || ''
  if (!raw) return
  emit('province', shortProvince(raw))
}

function onMapMove(event: { pixel?: unknown }) {
  if (hidden || props.fit || !pulseLayer) return
  const pixel = event.pixel
  if (moveFrame) return
  moveFrame = requestAnimationFrame(() => {
    moveFrame = 0
    if (hidden) return
    const id = linkAt(pixel)
    if (id === hotId.value) return
    hotId.value = id
    applyHot()
    emit('hover', id)
  })
}

function pauseMap() {
  hidden = true
  loca?.animate.stop?.()
}

function resumeMap(left = 8) {
  hidden = false
  nextTick(() => {
    requestAnimationFrame(() => {
      const { width, height } = boxSize()
      if (width < 2 || height < 2) {
        if (left > 0) resumeMap(left - 1)
        return
      }
      map?.resize()
      if (dirty) draw()
      loca?.animate.start()
    })
  })
}

async function boot() {
  if (!amapKey()) {
    missingKey.value = true
    return
  }
  try {
    const AMap = await loadAmap()
    if (!canvas.value) return
    map = new AMap.Map(canvas.value, {
      zoom: 4.4,
      center: [104.2, 36.2],
      mapStyle: 'amap://styles/whitesmoke',
      viewMode: '3D',
      pitch: 42,
      showBuildingBlock: false,
      zooms: [3.4, 18],
    })
    if (AMap.ToolBar) map.addControl(new AMap.ToolBar({ position: 'RT' }))
    if (AMap.Scale) map.addControl(new AMap.Scale({ position: 'RB' }))
    map.on('click', onMapClick)
    map.on('mousemove', onMapMove)
    ready.value = true
    draw()
    resizeObserver = new ResizeObserver(() => {
      if (hidden) return
      const { width, height } = boxSize()
      if (width < 2 || height < 2) return
      map?.resize()
    })
    if (root.value) resizeObserver.observe(root.value)
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '高德地图加载失败'
  }
}

function render() {
  draw()
}

/** 同一帧内的多次数据变化合并成一次重绘 */
function scheduleDraw() {
  if (drawFrame) return
  drawFrame = requestAnimationFrame(() => {
    drawFrame = 0
    if (ready.value) draw()
  })
}

onMounted(boot)
onActivated(resumeMap)
onDeactivated(pauseMap)
onUnmounted(() => {
  if (drawFrame) cancelAnimationFrame(drawFrame)
  if (moveFrame) cancelAnimationFrame(moveFrame)
  drawFrame = 0
  moveFrame = 0
  resizeObserver?.disconnect()
  clearPulse()
  loca?.destroy?.()
  loca = null
  map?.destroy()
  map = null
})

watch(
  () => [
    props.origin,
    props.dest,
    props.stops,
    props.cur,
    props.active,
    props.provincesHL,
    props.mode,
    props.fit,
    props.heat,
    props.bubbles,
    props.tags,
    props.links,
    props.hubs,
    props.routeAlert,
    props.arrived,
  ],
  () => {
    scheduleDraw()
  },
  { deep: true },
)

defineExpose({ render, highlight, locate: () => focusActive(true) })
</script>

<template>
  <div
    ref="root"
    class="china-map"
    :style="{ height: typeof height === 'number' ? `${height}px` : height }"
  >
    <div ref="canvas" class="china-map__canvas"></div>

    <div v-if="missingKey || loadError" class="china-map__mask">
      <b>{{ missingKey ? '还没接上高德地图' : '高德地图没有加载成功' }}</b>
      <p v-if="missingKey">
        在 <code>frontend/.env</code> 填写 <code>VITE_AMAP_KEY</code> 和
        <code>VITE_AMAP_SECURITY_JS_CODE</code>，保存后重启前端。Key 在高德开放平台创建「Web端(JS API)」应用时获取。
      </p>
      <p v-else>{{ loadError }}</p>
    </div>

    <div v-if="ready && legend?.length" class="mp-legend">
      <span v-for="item in legend" :key="item.text">
        <i
          class="lg"
          :class="{ 'lg-bar': item.kind === 'line', 'lg-dash': item.dashed }"
          :style="
            item.dashed
              ? { background: `repeating-linear-gradient(90deg, ${item.color} 0 6px, transparent 6px 10px)` }
              : { background: item.color }
          "
        ></i>
        {{ item.text }}
      </span>
    </div>
  </div>
</template>

<style>
.china-map {
  position: relative;
  width: 100%;
  min-height: 320px;
  background: #f4f7fb;
  border-radius: 6px;
  overflow: hidden;
}

.china-map__canvas {
  width: 100%;
  height: 100%;
}

/* 最新上报点：呼吸光圈 */
.cmap-latest__ring {
  position: absolute;
  left: 0;
  top: 0;
  width: 42px;
  height: 42px;
  margin: -21px 0 0 -21px;
  border-radius: 50%;
  background: rgba(245, 34, 45, 0.16);
  animation: cmap-latest-pulse 1.8s ease-out infinite;
  pointer-events: none;
}

@keyframes cmap-latest-pulse {
  0% {
    transform: scale(0.55);
    opacity: 0.95;
  }
  70% {
    transform: scale(1.2);
    opacity: 0;
  }
  100% {
    transform: scale(1.2);
    opacity: 0;
  }
}

/* 选中的上报点：放大光圈 + 中心点 */
.cmap-active {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}

.cmap-active__ring {
  position: absolute;
  left: 0;
  top: 0;
  width: 46px;
  height: 46px;
  margin: -23px 0 0 -23px;
  border-radius: 50%;
  border: 2px solid #1677ff;
  background: rgba(22, 119, 255, 0.14);
  box-shadow: 0 0 0 4px rgba(22, 119, 255, 0.12);
  animation: cmap-active-pulse 1.6s ease-out infinite;
}

@keyframes cmap-active-pulse {
  0% {
    transform: scale(0.9);
    opacity: 1;
  }
  70% {
    transform: scale(1.25);
    opacity: 0.35;
  }
  100% {
    transform: scale(1.25);
    opacity: 0.35;
  }
}

.china-map__mask {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  background: rgba(244, 247, 251, 0.94);
  color: #334155;
}

.china-map__mask b {
  font-size: 15px;
  color: #0f172a;
}

.china-map__mask p {
  max-width: 460px;
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}

.china-map__mask code {
  padding: 0 4px;
  border-radius: 3px;
  background: #e6eef8;
  font-size: 12px;
}

.china-map .mp-legend {
  position: absolute;
  left: 14px;
  bottom: 12px;
  z-index: 3;
  max-width: calc(100% - 28px);
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px 8px 10px;
  font-size: 12px;
  color: #334155;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid #e6eef5;
  border-left: 3px solid #1677ff;
  border-radius: 10px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
  flex-wrap: wrap;
}

.china-map .mp-legend .lg {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: -1px;
}

.china-map .mp-legend .lg-bar {
  width: 26px;
  height: 4px;
  border-radius: 2px;
  vertical-align: 2px;
}

.china-map .mp-legend .lg-dash {
  width: 28px;
  border-radius: 0;
  background-color: transparent;
}

</style>
