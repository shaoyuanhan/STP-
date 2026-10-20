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
  background: #e6f4ff;
  color: #1677ff;
}

.china-map .mp-zoom button + button {
  border-top: 1px solid #f0f0f0;
}

/* 底图：中性浅灰，避免整屏偏蓝 */
.china-map .mp-land path {
  fill: #f3f6fa;
  stroke: #e6ecf5;
  stroke-width: 0.6;
  transition: fill 0.2s;
}

.china-map .mp-land path:hover {
  fill: #e9eff8;
}

.china-map .mp-land path.hl {
  fill: #fff4e6;
  stroke: #fa8c16;
  stroke-width: 1.2;
}

/* 省份热力层：填充由渲染器内联（暖色，单量越多越深） */
.china-map .mp-land path.mp-heat {
  stroke: rgba(255, 255, 255, 0.85);
}

.china-map .mp-land path.mp-heat.hl {
  stroke: #d4380d;
  stroke-width: 1.6;
}

/* 多运单线路层 */
.china-map .mp-link {
  fill: none;
  stroke: rgba(22, 119, 255, 0.7);
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: stroke 0.15s, stroke-width 0.15s;
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
  stroke: #0958d9;
  stroke-width: 2.8;
}

.china-map .mp-link.active {
  stroke: #fa8c16;
  stroke-width: 3;
}

/* 聚合气泡层：白底 + 彩色描边，数量用描边色，避免整图一坨蓝 */
.china-map .mp-bubble circle {
  fill: rgba(255, 255, 255, 0.96);
  stroke: #1677ff;
  stroke-width: 2;
  transition: fill 0.15s, stroke 0.15s;
}

.china-map .mp-bubble text {
  fill: #1677ff;
  font-weight: 600;
  text-anchor: middle;
  pointer-events: none;
}

.china-map .mp-bubble .mp-bubble-name {
  fill: #262626;
  font-weight: 500;
  paint-order: stroke;
  stroke: rgba(255, 255, 255, 0.9);
  stroke-width: 3px;
}

.china-map .mp-bubble.is-dot circle {
  fill: #1677ff;
  stroke: #ffffff;
  stroke-width: 2;
}

.china-map .mp-bubble:hover circle {
  fill: #e6f4ff;
}

.china-map .mp-bubble.active circle {
  fill: #fa8c16;
  stroke: #ffffff;
}

.china-map .mp-bubble.active text {
  fill: #ffffff;
}

/* 历史视角：线路与气泡改用青绿色，与暖色热力区分 */
.china-map .mp-mode-history .mp-link {
  stroke: rgba(19, 168, 168, 0.78);
}

.china-map .mp-mode-history .mp-link:hover,
.china-map .mp-mode-history .mp-link-hit:hover + .mp-link {
  stroke: #08979c;
}

.china-map .mp-mode-history .mp-bubble circle {
  stroke: #13a8a8;
}

.china-map .mp-mode-history .mp-bubble text {
  fill: #0b7c7c;
}

.china-map .mp-mode-history .mp-bubble.is-dot circle {
  fill: #13a8a8;
}

.china-map .mp-mode-history .mp-bubble:hover circle {
  fill: #e6fffb;
}

.china-map .mp-mode-history .mp-bubble.active circle {
  fill: #fa8c16;
}

/* 单票运单号标签层 */
.china-map .mp-tag rect {
  fill: rgba(255, 255, 255, 0.95);
  stroke: #1677ff;
  stroke-width: 1;
  transition: fill 0.15s;
}

.china-map .mp-tag text {
  fill: #1677ff;
  font-weight: 600;
  pointer-events: none;
}

.china-map .mp-tag-line {
  stroke: #1677ff;
  stroke-width: 1;
}

.china-map .mp-tag-dot {
  fill: #1677ff;
  stroke: #ffffff;
  stroke-width: 1;
}

.china-map .mp-tag:hover rect {
  fill: #e8f2ff;
}

.china-map .mp-tag.active rect {
  fill: #1677ff;
}

.china-map .mp-tag.active text {
  fill: #ffffff;
}

.china-map .mp-outline {
  fill: none;
  stroke: #c9d4e3;
  stroke-width: 1;
}

.china-map .mp-dash {
  fill: none;
  stroke: #a9b8cb;
  stroke-width: 1;
  stroke-dasharray: 6 4;
  opacity: 0.8;
}

.china-map .mp-route {
  fill: none;
  stroke: rgba(22, 119, 255, 0.4);
  stroke-width: 2.5;
  stroke-linecap: round;
}

.china-map .mp-route-flow {
  fill: none;
  stroke: #1677ff;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-dasharray: 8 14;
  animation: china-map-flow 1.6s linear infinite;
}

@keyframes china-map-flow {
  from {
    stroke-dashoffset: 22;
  }
  to {
    stroke-dashoffset: 0;
  }
}

.china-map .mp-stop {
  fill: rgba(22, 119, 255, 0.75);
  stroke: #fff;
  stroke-width: 1;
  transition: fill 0.15s;
}

.china-map .mp-clickable,
.china-map .mp-clickable * {
  cursor: pointer;
}

.china-map .mp-stop.mp-clickable:hover {
  fill: #0958d9;
}

.china-map .mp-marker .mp-core {
  fill: #1677ff;
  stroke: #ffffff;
  stroke-width: 1.6;
}

.china-map .mp-marker.start .mp-core {
  fill: #52c41a;
}

.china-map .mp-marker.end .mp-core {
  fill: #f5222d;
}

.china-map .mp-marker text {
  fill: #262626;
  paint-order: stroke;
  stroke: rgba(255, 255, 255, 0.85);
  font-weight: 600;
}

.china-map .mp-marker .mp-pulse {
  fill: rgba(22, 119, 255, 0.25);
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
  fill: rgba(22, 119, 255, 0.08);
  stroke: #1677ff;
  stroke-width: 2;
  stroke-dasharray: 4 3;
  pointer-events: none;
}

/* 单运单详情（历史视角）同样用青绿，保持与总览一致 */
.china-map .mp-mode-history .mp-route {
  stroke: rgba(19, 168, 168, 0.45);
}

.china-map .mp-mode-history .mp-route-flow {
  stroke: #13a8a8;
}

.china-map .mp-mode-history .mp-stop {
  fill: rgba(19, 168, 168, 0.8);
}

.china-map .mp-mode-history .mp-stop.mp-clickable:hover {
  fill: #08979c;
}

.china-map .mp-mode-history .mp-marker .mp-core {
  fill: #13a8a8;
}

.china-map .mp-mode-history .mp-marker .mp-pulse {
  fill: rgba(19, 168, 168, 0.25);
}

.china-map .mp-mode-history .mp-ring {
  fill: rgba(19, 168, 168, 0.08);
  stroke: #13a8a8;
}

.china-map .mp-inset .mp-prov {
  fill: #f3f6fa;
  stroke: #ffffff;
  stroke-width: 0.8;
}

.china-map .mp-inset .mp-inset-tt {
  font-size: 16px;
  fill: #6a7a94;
}

.china-map .mp-inset .mp-inset-bd {
  fill: none;
  stroke: #b9c8e8;
  stroke-width: 1;
}

.china-map .mp-legend {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 8px 12px;
  font-size: 12px;
  color: #262626;
  background: rgba(255, 255, 255, 0.85);
  border-top: 1px solid #e5e9f2;
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

.china-map .mp-legend .lg-start {
  background: #52c41a;
}

.china-map .mp-legend .lg-end {
  background: #f5222d;
}

.china-map .mp-legend .lg-cur {
  background: #1677ff;
  box-shadow: 0 0 0 4px rgba(22, 119, 255, 0.2);
}

.china-map .mp-legend .lg-stop {
  background: rgba(22, 119, 255, 0.75);
  border-radius: 2px;
}
</style>
