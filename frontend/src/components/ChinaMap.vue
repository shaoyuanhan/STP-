<script setup lang="ts">
/**
 * 中国地图 + 运输路径组件（src/lib/china-map.js 渲染器包装）
 *
 * 两种模式：
 *  - mode="map"（默认）：中国地图 + 起讫地 marker + 位置回传点 + 平滑路径 + 当前位置脉冲
 *  - mode="route"：整体路径放大视图（起 → 位置回传点(时间序) → 终）
 *
 * 用法（在途监控页）：
 *   <ChinaMap
 *     mode="map"
 *     :origin="{ text: task.ship_location }"
 *     :dest="{ text: task.delivery_address }"
 *     :cur="{ lng: track.longitude, lat: track.latitude, tip: track.location_desc }"
 *     :stops="tracks.map(t => ({ lng: t.longitude, lat: t.latitude, tip: t.location_desc }))"
 *   />
 *
 * 坐标约定：优先传 lng/lat（WGS84 近似，与数据投影一致）；
 * 缺省时可用 text/label 描述地址（内置城市/省会坐标库自动匹配）。
 * 注意：渲染器通过 innerHTML 注入 DOM，样式定义在组件的非 scoped style 块。
 */

import { onMounted, ref, watch } from 'vue'
import { matchCityGeo, renderChinaMap, renderRouteZoom, toXY } from '@/lib/china-map'

interface GeoPoint {
  label?: string
  /** 地址描述（无 lng/lat 时自动匹配城市坐标） */
  text?: string
  lng?: number | string
  lat?: number | string
  tip?: string
}

const props = withDefaults(
  defineProps<{
    mode?: 'map' | 'route'
    /** 起始地（发运地点） */
    origin?: GeoPoint | null
    /** 目的地（交付地址） */
    dest?: GeoPoint | null
    /** 位置回传点列表（时间序） */
    stops?: Array<GeoPoint>
    /** 最新当前位置（脉冲 marker） */
    cur?: GeoPoint | null
    /** 起始地图例文字 */
    originLabel?: string
    /** 目的地图例文字 */
    destLabel?: string
    /** 当前位置图例文字 */
    curLabel?: string
    /** 高亮省份名列表 */
    provincesHL?: string[]
    /** route 模式的中间节点：[{ name, meta, cur, tip }] */
    routeStops?: Array<{ name?: string; meta?: string; cur?: boolean; tip?: string }>
    /** route 模式：是否已到达 */
    done?: boolean
    /** 容器高度（px） */
    height?: number | string
  }>(),
  {
    mode: 'map',
    origin: null,
    dest: null,
    stops: () => [],
    cur: null,
    originLabel: '',
    destLabel: '',
    curLabel: '',
    provincesHL: () => [],
    routeStops: () => [],
    done: false,
    height: 520,
  },
)

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
    geo2: toXY(lng, lat),
  }
}

function render() {
  if (!el.value) return
  if (props.mode === 'route') {
    renderRouteZoom(el.value, {
      originLabel: props.originLabel,
      destLabel: props.destLabel,
      stops: props.routeStops,
      done: props.done,
    })
    return
  }
  renderChinaMap(el.value, {
    origin: resolvePoint(props.origin, props.originLabel),
    dest: resolvePoint(props.dest, props.destLabel),
    stops: props.stops
      .map((stop) => resolvePoint(stop, stop.label))
      .filter((item): item is NonNullable<typeof item> => item !== null),
    cur: resolvePoint(props.cur, '当前位置'),
    provincesHL: props.provincesHL,
    originLabel: props.originLabel,
    destLabel: props.destLabel,
    curLabel: props.curLabel,
  })
}

onMounted(render)

watch(
  () => [
    props.mode,
    props.origin,
    props.dest,
    props.stops,
    props.cur,
    props.originLabel,
    props.destLabel,
    props.curLabel,
    props.provincesHL,
    props.routeStops,
    props.done,
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
 * 类名约定：mp-* 为中国地图，rz-* 为路径放大视图
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
}

.china-map .mp-land path {
  fill: #e8eefc;
  stroke: #ffffff;
  stroke-width: 0.6;
  transition: fill 0.2s;
}

.china-map .mp-land path:hover {
  fill: #dbe7fb;
}

.china-map .mp-land path.hl {
  fill: #d3e3fd;
}

.china-map .mp-outline {
  fill: none;
  stroke: #b9c8e8;
  stroke-width: 1;
}

.china-map .mp-dash {
  fill: none;
  stroke: #8fa6d4;
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
  stroke-dasharray: 10 16;
  animation: china-map-flow 1.6s linear infinite;
}

@keyframes china-map-flow {
  from {
    stroke-dashoffset: 26;
  }
  to {
    stroke-dashoffset: 0;
  }
}

.china-map .mp-stop {
  fill: rgba(22, 119, 255, 0.75);
  stroke: #fff;
  stroke-width: 1;
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
  font-size: 14px;
  fill: #262626;
  paint-order: stroke;
  stroke: rgba(255, 255, 255, 0.85);
  stroke-width: 3px;
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

.china-map .mp-inset .mp-prov {
  fill: #e8eefc;
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

/* ---- 路径放大视图（rz-*） ---- */
.china-map .rz-wrap {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 4px;
  height: 100%;
  padding: 40px 24px 16px;
  overflow-x: auto;
}

.china-map .rz-track {
  position: absolute;
  left: 40px;
  right: 40px;
  top: 52px;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, #52c41a, #1677ff);
  opacity: 0.35;
}

.china-map .rz-wrap.done .rz-track {
  background: linear-gradient(90deg, #52c41a, #52c41a);
  opacity: 1;
}

.china-map .rz-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 88px;
  z-index: 1;
}

.china-map .rz-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #fff;
  background: #1677ff;
  border: 3px solid #fff;
  box-shadow: 0 2px 6px rgba(31, 35, 41, 0.15);
}

.china-map .rz-item.start .rz-dot {
  background: #52c41a;
}

.china-map .rz-item.end .rz-dot {
  background: #f5222d;
}

.china-map .rz-item.cur .rz-dot {
  background: #1677ff;
  box-shadow: 0 0 0 6px rgba(22, 119, 255, 0.18);
}

.china-map .rz-item.stop .rz-dot {
  background: #7d89a4;
  width: 18px;
  height: 18px;
}

.china-map .rz-name {
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
  text-align: center;
}

.china-map .rz-meta {
  font-size: 12px;
  color: #8f959e;
  text-align: center;
  white-space: nowrap;
}
</style>
