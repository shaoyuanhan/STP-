<script setup lang="ts">
/**
 * 中国地图 + 运输路径组件（src/lib/china-map.js 渲染器包装）
 *
 * 地图视野按起点/终点/回传点外接框自适应放大，不再固定展示全国；
 * 回传点可点击，点击后通过 select 事件回传轨迹下标。
 *
 * 坐标约定：优先传 lng/lat（WGS84 近似，与数据投影一致）；
 * 缺省时可用 text/label 描述地址（内置城市/省会坐标库自动匹配）。
 * 注意：渲染器通过 innerHTML 注入 DOM，地图样式定义在组件的非 scoped style 块。
 */

import { onMounted, ref, watch } from 'vue'
import { matchCityGeo, renderChinaMap, toXY } from '@/lib/china-map'

interface MapBubble {
  key: string
  name?: string
  lng: number | string
  lat: number | string
  count: number
  /** 单票点位：只画小圆点，不显示数字与城市名 */
  hideCount?: boolean
  /** 悬停提示（缺省为「城市 · N 单」） */
  tip?: string
  active?: boolean
  /** 异常（超时未上报）：红色标识 */
  alert?: boolean
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
  /** 异常（超时未上报）：玫红虚线 + 红色光点 */
  alert?: boolean
}

/** 发运枢纽：多条飞线的共同起点 */
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
}

interface GeoPoint {
  label?: string
  /** 地址描述（无 lng/lat 时自动匹配城市坐标） */
  text?: string
  lng?: number | string
  lat?: number | string
  tip?: string
  /** 轨迹下标（存在时可点击） */
  index?: number
}

const props = withDefaults(
  defineProps<{
    /** 起始地（发运地点） */
    origin?: GeoPoint | null
    /** 目的地（交付地址） */
    dest?: GeoPoint | null
    /** 位置回传点列表（时间序） */
    stops?: Array<GeoPoint>
    /** 最新当前位置（脉冲 marker） */
    cur?: GeoPoint | null
    /** 当前选中的回传点（高亮光圈） */
    active?: GeoPoint | null
    /** 起始地图例文字 */
    originLabel?: string
    /** 目的地图例文字 */
    destLabel?: string
    /** 当前位置图例文字 */
    curLabel?: string
    /** 高亮省份名列表 */
    provincesHL?: string[]
    /** 视角主题：transit 蓝（在途）/ history 青绿（历史），影响线路与气泡配色 */
    mode?: 'transit' | 'history'
    /** 是否按起终点自适应放大（false = 全国总览视图） */
    fit?: boolean
    /** 省份热力：{省名: 单量} */
    heat?: Record<string, number> | null
    /** 聚合气泡：{key, name, lng, lat, count, active} */
    bubbles?: MapBubble[]
    /** 单票运单号标签：{id, name, lng, lat, active} */
    tags?: MapTag[]
    /** 多运单线路：{id, points, active, label} */
    links?: MapLink[]
    /** 发运枢纽（飞线汇聚点）：{key, name, lng, lat, tip} */
    hubs?: MapHub[]
    /** 自定义图例（缺省展示起终点图例） */
    legend?: LegendItem[] | null
    /** 容器高度（px） */
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
    height: 520,
  },
)

const emit = defineEmits<{
  select: [index: number]
  task: [id: number]
  province: [name: string]
  bubble: [key: string]
}>()

const el = ref<HTMLElement | null>(null)

/** 解析坐标点：优先经纬度，其次地址文本匹配（缺失返回 null，渲染器自动跳过） */
function resolvePoint(point: GeoPoint | null | undefined, fallbackLabel?: string) {
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
  if (lng === undefined || lat === undefined || !Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null
  }
  return {
    label: point.label ?? fallbackLabel ?? '',
    tip: point.tip ?? '',
    index: point.index,
    geo2: toXY(lng, lat),
  }
}

function render() {
  if (!el.value) return
  renderChinaMap(el.value, {
    origin: resolvePoint(props.origin, props.originLabel),
    dest: resolvePoint(props.dest, props.destLabel),
    stops: props.stops
      .map((stop) => resolvePoint(stop, stop.label))
      .filter((item): item is NonNullable<typeof item> => item !== null),
    cur: resolvePoint(props.cur, '当前位置'),
    active: resolvePoint(props.active, ''),
    provincesHL: props.provincesHL,
    mode: props.mode,
    fit: props.fit,
    heat: props.heat,
    bubbles: props.bubbles,
    tags: props.tags,
    links: props.links,
    hubs: props.hubs,
    legend: props.legend,
    originLabel: props.originLabel,
    destLabel: props.destLabel,
    curLabel: props.curLabel,
    onSelect: (index: number) => emit('select', index),
    onSelectTask: (id: number) => emit('task', id),
    onSelectProvince: (name: string) => emit('province', name),
    onSelectBubble: (key: string) => emit('bubble', key),
  })
}

onMounted(render)

watch(
  () => [
    props.origin,
    props.dest,
    props.stops,
    props.cur,
    props.active,
    props.originLabel,
    props.destLabel,
    props.curLabel,
    props.provincesHL,
    props.mode,
    props.fit,
    props.heat,
    props.bubbles,
    props.tags,
    props.links,
    props.hubs,
    props.legend,
  ],
  render,
  { deep: true },
)

defineExpose({ render })
</script>

<template>
  <div
    ref="el"
    class="china-map"
    :style="{ height: typeof height === 'number' ? `${height}px` : height }"
  ></div>
</template>

<style>
/*
 * 地图样式（全局，渲染器以 innerHTML 注入 DOM，scoped 不生效）
 * 类名约定：mp-* 为中国地图
 */
.china-map {
  width: 100%;
  min-height: 320px;
  background: #ffffff;
  border-radius: 6px;
  overflow: hidden;
}

.china-map .mp-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.china-map .mp-svg {
  flex: 1;
  width: 100%;
  min-height: 0;
  background: #f7fafc;
  cursor: grab;
  touch-action: none;
}

.china-map .mp-svg.is-dragging {
  cursor: grabbing;
}

/* 覆盖层不参与点击命中，避免挡住省份/线路/点位 */
.china-map .mp-outline,
.china-map .mp-dash,
.china-map .mp-inset,
.china-map .mp-route,
.china-map .mp-route-flow {
  pointer-events: none;
}

.china-map .mp-land path[data-province] {
  cursor: pointer;
}

/* 缩放控件 */
.china-map .mp-zoom {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(31, 45, 61, 0.18);
  z-index: 2;
}

.china-map .mp-zoom button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: rgba(255, 255, 255, 0.96);
  color: #262626;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.china-map .mp-zoom button:hover {
  background: #ecfeff;
  color: #0891b2;
}

.china-map .mp-zoom button + button {
  border-top: 1px solid #f0f0f0;
}

/* 底图：浅蓝灰，干净通透 */
.china-map .mp-land path {
  fill: #edf3f9;
  stroke: #c9d8e6;
  stroke-width: 0.6;
  transition: fill 0.2s;
}

.china-map .mp-land path:hover {
  fill: #e4eef7;
}

.china-map .mp-land path.hl {
  fill: #fff1e0;
  stroke: #f97316;
  stroke-width: 1.2;
}

/* 省份热力层：填充由渲染器内联（浅杏 → 亮橙，单量越多越深） */
.china-map .mp-land path.mp-heat {
  stroke: rgba(255, 255, 255, 0.9);
}

.china-map .mp-land path.mp-heat.hl {
  stroke: #f97316;
  stroke-width: 1.6;
}

/* 省名标注：浅灰蓝、带白色衬底，弱于线路与城市名 */
.china-map .mp-prov-labels {
  pointer-events: none;
}

.china-map .mp-prov-label {
  fill: #93a5b7;
  font-weight: 500;
  letter-spacing: 0.5px;
  text-anchor: middle;
  dominant-baseline: middle;
  paint-order: stroke;
  stroke: rgba(247, 250, 252, 0.85);
  stroke-width: 2px;
  stroke-linejoin: round;
}

/* 发运枢纽：多条飞线的汇聚点 */
.china-map .mp-hub {
  pointer-events: none;
}

.china-map .mp-hub-ring {
  fill: rgba(8, 145, 178, 0.1);
  stroke: rgba(8, 145, 178, 0.42);
  stroke-width: 1;
}

.china-map .mp-hub-core {
  fill: #0891b2;
  stroke: #ffffff;
  stroke-width: 1.6;
}

.china-map .mp-hub text {
  fill: #0e7490;
  font-weight: 600;
  paint-order: stroke;
  stroke: rgba(255, 255, 255, 0.92);
  stroke-width: 3px;
  stroke-linejoin: round;
}

/* 飞线层：起淡终实的青蓝渐变 + 轻微同色投影 */
.china-map .mp-link {
  fill: none;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 5px rgba(8, 145, 178, 0.28));
  transition: stroke 0.15s, stroke-width 0.15s, filter 0.15s;
}

.china-map .mp-link-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 16;
  stroke-linecap: round;
  pointer-events: stroke;
  cursor: pointer;
}

.china-map .mp-link:hover,
.china-map .mp-link-hit:hover + .mp-link {
  stroke: #0891b2;
  stroke-width: 2.6;
  filter: drop-shadow(0 0 7px rgba(8, 145, 178, 0.42));
}

.china-map .mp-link.active {
  stroke: #f97316;
  stroke-width: 3;
  filter: drop-shadow(0 0 7px rgba(249, 115, 22, 0.35));
}

/* 异常线路：玫红虚线 + 红色光晕，和正常线路一眼区分 */
.china-map .mp-link.is-alert {
  stroke-dasharray: 7 5;
  filter: drop-shadow(0 0 6px rgba(244, 63, 94, 0.35));
}

.china-map .mp-link.is-alert:hover,
.china-map .mp-link-hit:hover + .mp-link.is-alert {
  filter: drop-shadow(0 0 8px rgba(244, 63, 94, 0.5));
}

/* 沿线流动光点（对应 ECharts effect 的巡航光点） */
.china-map .mp-flow-dot {
  fill: #0891b2;
  opacity: 0.85;
  pointer-events: none;
  filter: drop-shadow(0 0 2px rgba(8, 145, 178, 0.45));
}

.china-map .mp-flow-dot.is-alert {
  fill: #f43f5e;
  filter: drop-shadow(0 0 2px rgba(244, 63, 94, 0.55));
}

/* 飞线方向箭头 */
.china-map .mp-arrow path {
  fill: #0891b2;
  opacity: 0.78;
}

.china-map .mp-arrow.is-alert path {
  fill: #f43f5e;
}

/* 聚合气泡层：白底青边 + 柔和投影，数字用深青蓝 */
.china-map .mp-bubble .mp-count {
  fill: #0e7490;
  font-weight: 600;
  pointer-events: none;
}

.china-map .mp-bubble .mp-core {
  fill: rgba(255, 255, 255, 0.92);
  stroke: #0891b2;
  stroke-width: 1.8;
  filter: drop-shadow(0 1px 3px rgba(8, 145, 178, 0.25));
  transition: fill 0.15s, stroke 0.15s;
}

.china-map .mp-bubble .mp-halo {
  fill: rgba(8, 145, 178, 0.14);
  pointer-events: none;
}

/* 异常城市：红色描边 + 红色光晕与数字 */
.china-map .mp-bubble.is-alert .mp-core {
  stroke: #f43f5e;
  filter: drop-shadow(0 1px 3px rgba(244, 63, 94, 0.3));
}

.china-map .mp-bubble.is-alert .mp-halo {
  fill: rgba(244, 63, 94, 0.15);
}

.china-map .mp-bubble.is-alert .mp-count {
  fill: #be123c;
}

.china-map .mp-bubble.is-dot.is-alert .mp-core {
  fill: #f43f5e;
}

/* 城市名标注：深灰蓝 + 白色文字衬底，避免与线路/气泡重叠时看不清 */
.china-map .mp-city-label {
  fill: #334155;
  font-weight: 500;
  paint-order: stroke;
  stroke: rgba(255, 255, 255, 0.92);
  stroke-width: 3px;
  stroke-linejoin: round;
  pointer-events: none;
}

.china-map .mp-bubble.is-dot .mp-core {
  fill: #0891b2;
  stroke: #ffffff;
  stroke-width: 2;
}

.china-map .mp-bubble:hover .mp-core {
  fill: #ecfeff;
  stroke: #0891b2;
}

.china-map .mp-bubble.active .mp-core {
  fill: #f97316;
  stroke: #ffffff;
}

.china-map .mp-bubble.active .mp-halo {
  fill: rgba(249, 115, 22, 0.16);
}

.china-map .mp-bubble.active .mp-count {
  fill: #ffffff;
}

/* 单票运单号标签层 */
.china-map .mp-tag rect {
  fill: rgba(255, 255, 255, 0.95);
  stroke: #0891b2;
  stroke-width: 1;
  transition: fill 0.15s;
}

.china-map .mp-tag text {
  fill: #0e7490;
  font-weight: 600;
  pointer-events: none;
}

.china-map .mp-tag-line {
  stroke: #0891b2;
  stroke-width: 1;
}

.china-map .mp-tag-dot {
  fill: #0891b2;
  stroke: #ffffff;
  stroke-width: 1;
}

.china-map .mp-tag:hover rect {
  fill: #ecfeff;
}

.china-map .mp-tag.active rect {
  fill: #0891b2;
}

.china-map .mp-tag.active text {
  fill: #ffffff;
}

.china-map .mp-outline {
  fill: none;
  stroke: #c9d8e6;
  stroke-width: 1;
}

.china-map .mp-dash {
  fill: none;
  stroke: #b9ccde;
  stroke-width: 1;
  stroke-dasharray: 6 4;
  opacity: 0.8;
}

.china-map .mp-route {
  fill: none;
  stroke: rgba(8, 145, 178, 0.42);
  stroke-width: 2.2;
  stroke-linecap: round;
}

.china-map .mp-route-flow {
  fill: none;
  stroke: #0891b2;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-dasharray: 6 15;
  opacity: 0.85;
  animation: china-map-flow 2s linear infinite;
}

@keyframes china-map-flow {
  from {
    stroke-dashoffset: 21;
  }
  to {
    stroke-dashoffset: 0;
  }
}

.china-map .mp-stop {
  fill: rgba(8, 145, 178, 0.85);
  stroke: #fff;
  stroke-width: 1;
  transition: fill 0.15s;
}

.china-map .mp-clickable,
.china-map .mp-clickable * {
  cursor: pointer;
}

.china-map .mp-stop.mp-clickable:hover {
  fill: #0e7490;
}

.china-map .mp-marker .mp-core {
  fill: #0891b2;
  stroke: #ffffff;
  stroke-width: 1.6;
}

.china-map .mp-marker.start .mp-core {
  fill: #10b981;
}

.china-map .mp-marker.end .mp-core {
  fill: #f97316;
}

.china-map .mp-marker text {
  fill: #334155;
  paint-order: stroke;
  stroke: rgba(255, 255, 255, 0.9);
  font-weight: 600;
}

.china-map .mp-marker .mp-pulse {
  fill: rgba(8, 145, 178, 0.22);
  animation: china-map-pulse 2s ease-out infinite;
  transform-box: fill-box;
  transform-origin: center;
}

@keyframes china-map-pulse {
  0% {
    transform: scale(0.55);
    opacity: 0.9;
  }
  100% {
    transform: scale(1.6);
    opacity: 0;
  }
}

.china-map .mp-ring {
  fill: rgba(8, 145, 178, 0.08);
  stroke: #0891b2;
  stroke-width: 2;
  stroke-dasharray: 4 3;
  pointer-events: none;
}

.china-map .mp-inset .mp-prov {
  fill: #edf3f9;
  stroke: #ffffff;
  stroke-width: 0.8;
}

.china-map .mp-inset .mp-inset-tt {
  font-size: 16px;
  fill: #6a7a94;
}

.china-map .mp-inset .mp-inset-bd {
  fill: none;
  stroke: #c9d8e6;
  stroke-width: 1;
}

/* 图例：白底 + 浅阴影 + 圆角，左侧青色点缀条 */
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
  border-left: 3px solid #0891b2;
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
  height: 8px;
  border-radius: 4px;
  vertical-align: 0;
}

.china-map .mp-legend .lg-start {
  background: #10b981;
}

.china-map .mp-legend .lg-end {
  background: #f97316;
}

.china-map .mp-legend .lg-cur {
  background: #0891b2;
  box-shadow: 0 0 0 4px rgba(8, 145, 178, 0.16);
}

.china-map .mp-legend .lg-stop {
  background: rgba(8, 145, 178, 0.85);
  border-radius: 2px;
}
</style>
