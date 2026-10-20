<script setup lang="ts">
/**
 * 在途监控（契约 5.5 /api/tracking，snake_case）
 *
 * 布局对齐旧版 pageTracking（track-layout：420px 左列 + 1fr 右列）：
 *  - 顶部筛选卡：任务单号 + 查询/重置
 *  - 左列 420px「在途运单（N）」任务卡列表：任务单号加粗 + 状态标签，
 *    第二行 VIN/客户灰色小字，第三行最新位置与上报时间；
 *    选中行 #f0f7ff + 左 3px 主色边
 *  - 右列：
 *      运单信息卡（panel-head + 状态标签 + 发运地→当前位置→交付地进度条 + 描述栅格）
 *      运输地图卡（上：整体路径放大视图 ChinaMap mode=route；下：中国地图 mode=map，PRD ⑤）
 *      运输节点时间线 + 位置记录表（狮桥每小时回传：上报时间/当前位置/时速）
 */
import { computed, onActivated, onMounted, ref } from 'vue'
import { listTrackingTasks, getTrackingTask } from '@/services/tracking'
import type { TaskStatus, TrackingTask, TrackingTaskDetail, TransportTrack } from '@/types/api'
import { matchCityGeo, PROV_CITY } from '@/lib/china-map'
import { money, datetime, datetimeFull, dateShort, dateOnly, formatPhone } from '@/utils/format'
import ChinaMap from '@/components/ChinaMap.vue'
import StatusTag from '@/components/StatusTag.vue'

/** 任务状态中文（与 StatusTag 内置口径一致，避免字典未加载时空白） */
const STATUS_LABELS: Record<string, string> = {
  WAIT_DISPATCH: '待派单',
  DISPATCHED: '已派单',
  CARRIER_ACCEPTED: '承运商已接单',
  OUTBOUND: '已出库',
  PICKED: '已提车',
  IN_TRANSIT: '在途',
  ARRIVED: '已到达',
  FINISHED: '已完结',
  CANCELLED: '已取消',
}

/** 状态日志来源（task_status_log.source）中文口径 */
const SOURCE_LABELS: Record<string, string> = {
  STP: 'STP 系统',
  CRM: 'CRM 系统',
  SQ: '狮桥物流',
  CARRIER: '承运商',
  WMS: 'WMS 系统',
}

/** 运单进度条：状态 → 完成百分比（对齐旧版 STAGE_PCT，按新状态机顺序） */
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

// ---- 左侧任务列表（后端在途最优先，仅未终态任务） ----
const listLoading = ref(false)
const listError = ref<string | null>(null)
const tasks = ref<TrackingTask[]>([])
const total = ref(0)
const keyword = ref('')

async function loadTasks() {
  listLoading.value = true
  listError.value = null
  try {
    const result = await listTrackingTasks({
      page: 1,
      size: 100,
      task_no: keyword.value.trim() || undefined,
    })
    tasks.value = result?.list ?? []
    total.value = result?.total ?? 0
  } catch (error) {
    listError.value = error instanceof Error ? error.message : String(error)
    tasks.value = []
    total.value = 0
  } finally {
    listLoading.value = false
  }
}

function handleSearch() {
  loadTasks()
}

function handleReset() {
  keyword.value = ''
  loadTasks()
}

// ---- 选中任务与详情 ----
const selectedId = ref<number | null>(null)
const detail = ref<TrackingTaskDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)

async function selectTask(id: number) {
  selectedId.value = id
  detail.value = null
  detailError.value = null
  detailLoading.value = true
  try {
    detail.value = await getTrackingTask(id)
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : String(error)
  } finally {
    detailLoading.value = false
  }
}

/** 重试加载当前选中运单详情 */
async function retryDetail() {
  const id = selectedId.value
  if (id !== null) await selectTask(id)
}

/** 刷新列表与详情；选中任务仍存在则保持选中（位置回传后调用） */
async function refreshAll() {
  await loadTasks()
  const id = selectedId.value
  if (id !== null && tasks.value.some((task) => task.id === id)) {
    detailLoading.value = true
    try {
      detail.value = await getTrackingTask(id)
    } catch (error) {
      detailError.value = error instanceof Error ? error.message : String(error)
    } finally {
      detailLoading.value = false
    }
    return
  }
  // 无选中或选中已出列表：默认选中第一条（后端在途最优先）
  const first = tasks.value[0]
  if (first) {
    await selectTask(first.id)
  } else {
    selectedId.value = null
    detail.value = null
  }
}

onMounted(async () => {
  await loadTasks()
  const first = tasks.value[0]
  if (first) await selectTask(first.id)
})

// keep-alive 首次激活与 onMounted 相邻触发，跳过一次避免重复拉取
let activatedOnce = false
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  refreshAll()
})

// ---- 详情渲染数据 ----
const detailTask = computed(() => detail.value?.task ?? null)
const tracks = computed<TransportTrack[]>(() => detail.value?.tracks ?? [])
const statusLogs = computed(() => detail.value?.statusLogs ?? [])
const isArrived = computed(() => ['ARRIVED', 'FINISHED'].includes(detailTask.value?.status ?? ''))
const latestTrack = computed<TransportTrack | null>(() => tracks.value[tracks.value.length - 1] ?? null)

/** 进度条完成百分比 */
const routePct = computed(() => STAGE_PCT[detailTask.value?.status ?? ''] ?? 0)

/** 最新位置描述（无回传时占位） */
const curPosition = computed(() => latestTrack.value?.location_desc ?? '')

/** 从地址/位置描述提取城市名做 marker 标签（匹配失败取前 12 字） */
function cityLabel(text?: string | null): string {
  const s = String(text ?? '').trim()
  if (!s) return '-'
  const hit = matchCityGeo(s)
  return hit ? hit.city : s.slice(0, 12)
}

/** 进度条节点短标签（对齐旧版截断：起点 6 字 / 当前 10 字 / 终点 5 字） */
const originShort = computed(() => (detailTask.value?.ship_location || '起点').slice(0, 6))
const destShort = computed(() => (detailTask.value?.delivery_address || '终点').slice(0, 5))
const curPosShort = computed(() => (curPosition.value || '-').slice(0, 10))

/** 运输节点标题：from → to */
function logStatusTitle(fromStatus?: string | null, toStatus?: string | null): string {
  const from = fromStatus ? `${STATUS_LABELS[fromStatus] ?? fromStatus} → ` : ''
  return `${from}${STATUS_LABELS[toStatus ?? ''] ?? toStatus ?? ''}`
}

function logSourceType(source?: string | null): string {
  return source ? SOURCE_LABELS[source] ?? source : '系统'
}

// ---- ChinaMap 渲染数据 ----
/** 提取省份名（先按文本匹配省名，再按城市反查省会表）用于地图高亮 */
function provinceOf(text?: string | null): string | null {
  const s = String(text ?? '').trim()
  if (!s) return null
  const entries = Object.entries(PROV_CITY) as Array<[string, string]>
  for (const [prov] of entries) {
    if (s.includes(prov)) return prov
  }
  const hit = matchCityGeo(s)
  if (hit) {
    for (const [prov, capital] of entries) {
      if (capital === hit.city) return prov
    }
  }
  return null
}

const originPoint = computed(() => {
  const t = detailTask.value
  if (!t) return null
  return { text: t.ship_location ?? '', label: cityLabel(t.ship_location) }
})
const destPoint = computed(() => {
  const t = detailTask.value
  if (!t) return null
  return { text: t.delivery_address ?? '', label: cityLabel(t.delivery_address) }
})

/** 位置回传点：未到达时最新一点交给 cur 脉冲，其余为途经点 */
const mapStops = computed(() => {
  const list = isArrived.value ? tracks.value : tracks.value.slice(0, -1)
  return list.map((track) => ({
    lng: track.longitude,
    lat: track.latitude,
    tip: `${dateShort(track.report_time)} ${track.location_desc ?? ''}${track.speed ? ` · ${track.speed}km/h` : ''}`,
  }))
})

const mapCur = computed(() => {
  const track = latestTrack.value
  if (!track || isArrived.value) return null
  return {
    lng: track.longitude,
    lat: track.latitude,
    tip: `${dateShort(track.report_time)} ${track.location_desc ?? ''}${track.speed ? ` · ${track.speed}km/h` : ''}`,
  }
})

const provincesHL = computed<string[]>(() => {
  const t = detailTask.value
  if (!t) return []
  const list = [provinceOf(t.ship_location), provinceOf(t.delivery_address)]
  return list.filter((item): item is string => Boolean(item))
})

/** 路径放大视图：起 → 轨迹点(时间序) → 终；最新点标记 cur */
const routeStops = computed(() =>
  tracks.value.map((track, index) => ({
    name: cityLabel(track.location_desc),
    meta: `${dateShort(track.report_time)}${track.speed ? ` · ${track.speed}km/h` : ''}`,
    tip: String(track.location_desc ?? ''),
    cur: !isArrived.value && index === tracks.value.length - 1,
  })),
)
</script>

<template>
  <div class="stp-page tracking">
    <!-- 筛选卡（旧版 .filter：任务单号 + 查询/重置） -->
    <section class="card filter">
      <div class="field">
        <label>任务单号</label>
        <n-input
          v-model:value="keyword"
          size="small"
          clearable
          placeholder="请输入任务单号"
          style="width: 200px"
          @keyup.enter="handleSearch"
        />
      </div>
      <div class="filter-actions">
        <n-button size="small" @click="handleReset">重置</n-button>
        <n-button size="small" type="primary" :loading="listLoading" @click="handleSearch">
          查询
        </n-button>
      </div>
    </section>

    <div class="track-layout">
      <!-- 左列：在途运单列表（旧版 420px track-list） -->
      <section class="card track-list">
        <div class="panel-head track-list__head">在途运单（{{ total }}）</div>
        <n-spin :show="listLoading">
          <div v-if="listError" class="track-side__empty">
            <span class="track-side__error">{{ listError }}</span>
            <n-button size="tiny" type="primary" quaternary @click="refreshAll()">重试</n-button>
          </div>
          <div v-else-if="!tasks.length" class="empty-row">暂无运单</div>
          <template v-else>
            <div
              v-for="task in tasks"
              :key="task.id"
              class="row"
              :class="{ selected: task.id === selectedId }"
              @click="selectTask(task.id)"
            >
              <div class="l1">
                <span><b>{{ task.task_no }}</b></span>
                <StatusTag type="task" :value="task.status" />
              </div>
              <div class="l2">
                <span class="l2__vin" :title="task.vins">{{ task.vins || '-' }}</span>
                <span class="l2__customer">{{ task.customer_name || '-' }}</span>
              </div>
              <div class="l2">
                <span class="l2__loc" :title="task.latest_track?.location_desc ?? ''">
                  📍{{ task.latest_track?.location_desc || '暂无位置' }}
                </span>
                <span>{{ task.latest_track?.report_time ? dateShort(task.latest_track.report_time) : '' }}</span>
              </div>
            </div>
          </template>
        </n-spin>
      </section>

      <!-- 右列：运单详情（旧版 tr-detail） -->
      <section class="track-detail">
        <div v-if="!selectedId" class="card empty-row">选择左侧运单查看在途详情</div>

        <n-spin v-else :show="detailLoading">
          <!-- 详情加载失败 -->
          <div v-if="detailError" class="card empty-row">
            {{ detailError }}
            <div style="margin-top: 10px">
              <n-button size="small" type="primary" @click="retryDetail">重试</n-button>
            </div>
          </div>

          <template v-else-if="detailTask">
            <!-- 运单信息（旧版：panel-head + 状态标签 + 进度条 + desc-grid） -->
            <div class="card">
              <div class="panel-head">
                <span>运单信息</span>
                <StatusTag type="task" :value="detailTask.status" />
              </div>
              <div class="route-viz">
                <div class="route-line">
                  <div class="route-fill" :style="{ width: `${routePct}%` }"></div>
                  <div class="route-node done" style="left: 0">
                    <div class="pt"></div>
                    <div class="txt txt--origin">{{ originShort }}</div>
                  </div>
                  <div v-if="tracks.length" class="route-node done" :style="{ left: `${routePct}%` }">
                    <div class="pt"></div>
                    <div class="txt bottom">{{ curPosShort }}</div>
                  </div>
                  <div class="route-node" :class="{ done: routePct >= 100 }" style="left: 100%">
                    <div class="pt"></div>
                    <div class="txt txt--dest">{{ destShort }}</div>
                  </div>
                </div>
              </div>
              <div class="desc-grid">
                <div class="desc"><label>任务单号</label><span>{{ detailTask.task_no }}</span></div>
                <div class="desc"><label>运输单号</label><span>{{ tracks[0]?.transport_no || '-' }}</span></div>
                <div class="desc"><label>VIN</label><span>{{ detailTask.vins || '-' }}</span></div>
                <div class="desc"><label>车型</label><span>{{ detailTask.vehicle_models || '-' }}</span></div>
                <div class="desc"><label>客户名称</label><span>{{ detailTask.customer_name || '-' }}</span></div>
                <div class="desc"><label>承运商</label><span>{{ detailTask.carrier_name || '-' }}</span></div>
                <div class="desc"><label>司机</label><span>{{ detailTask.driver_name || '-' }}</span></div>
                <div class="desc"><label>司机电话</label><span>{{ formatPhone(detailTask.driver_phone) }}</span></div>
                <div class="desc"><label>预计提车</label><span>{{ dateOnly(detailTask.plan_pickup_date) }}</span></div>
                <div class="desc"><label>发运时间</label><span>{{ datetime(detailTask.ship_time) }}</span></div>
                <div class="desc"><label>到达时间</label><span>{{ datetime(detailTask.arrive_time) }}</span></div>
                <div class="desc"><label>计划运费</label><span>¥{{ money(detailTask.plan_freight) }}</span></div>
                <div class="desc wide"><label>交付地址</label><span>{{ detailTask.delivery_address || '-' }}</span></div>
              </div>
            </div>

            <!-- 运输地图（PRD ⑤：上为整体路径放大界面，底部为中国地图） -->
            <div class="card track-map-card">
              <div class="panel-head">
                <span>运输地图</span>
                <span class="track-map__route">
                  {{ cityLabel(detailTask.ship_location) }} → {{ cityLabel(detailTask.delivery_address) }}
                </span>
              </div>
              <ChinaMap
                mode="route"
                :origin-label="cityLabel(detailTask.ship_location)"
                :dest-label="cityLabel(detailTask.delivery_address)"
                :route-stops="routeStops"
                :done="isArrived"
                :height="170"
              />
              <ChinaMap
                mode="map"
                :origin="originPoint"
                :dest="destPoint"
                :stops="mapStops"
                :cur="mapCur"
                :origin-label="cityLabel(detailTask.ship_location)"
                :dest-label="cityLabel(detailTask.delivery_address)"
                :cur-label="latestTrack?.location_desc ?? ''"
                :provincesHL="provincesHL"
                :height="420"
              />
              <div v-if="!tracks.length" class="track-map__tip">
                暂无位置回传：点击上方「模拟位置回传」，或在外部系统模拟页调用狮桥位置回传接口
              </div>
            </div>

            <!-- 运输节点 + 位置记录（旧版底部两栏） -->
            <div class="track-bottom">
              <div class="card">
                <div class="panel-head"><span>运输节点</span></div>
                <div v-if="statusLogs.length" class="timeline">
                  <div
                    v-for="(log, index) in statusLogs"
                    :key="log.id ?? index"
                    class="tl-item"
                    :class="index === statusLogs.length - 1 ? 'cur' : 'done'"
                  >
                    <span class="tl-dot"></span>
                    <div class="tl-head">
                      <span class="tl-name">{{ logStatusTitle(log.from_status, log.to_status) }}</span>
                      <span class="tl-time">{{ datetimeFull(log.create_time) }}</span>
                    </div>
                    <div class="tl-detail">
                      <div v-if="log.remark">{{ log.remark }}</div>
                      <div class="tl-meta">
                        来源：{{ logSourceType(log.source) }}<template v-if="log.operator"> · {{ log.operator }}</template>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="empty-row">暂无节点</div>
              </div>
              <div class="card">
                <div class="panel-head"><span>位置记录（狮桥每小时回传）</span></div>
                <div class="table-scroll track-track-scroll">
                  <table>
                    <thead>
                      <tr><th>上报时间</th><th>当前位置</th><th>时速</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="(track, index) in tracks" :key="track.id ?? index">
                        <td>{{ datetime(track.report_time) }}</td>
                        <td>
                          <span class="track-loc" :title="track.location_desc ?? ''">
                            {{ track.location_desc || '-' }}
                          </span>
                        </td>
                        <td>{{ track.speed ? `${track.speed} km/h` : '-' }}</td>
                      </tr>
                      <tr v-if="!tracks.length">
                        <td colspan="3" class="empty-row">暂无位置记录</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </template>

          <!-- 详情加载中骨架 -->
          <div v-else class="track-main__loading">
            <n-skeleton text width="30%" />
            <n-skeleton text :repeat="3" />
            <n-skeleton height="240px" style="margin-top: 12px" />
          </div>
        </n-spin>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* ---- 卡片 / 筛选（旧版 .card / .filter） ---- */
.card {
  background: #ffffff;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04);
}

.filter {
  padding: 14px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 14px 18px;
  align-items: center;
  margin-bottom: 12px;
}

.field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field > label {
  color: #595959;
  white-space: nowrap;
}

.filter-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
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

.empty-row {
  padding: 48px 0;
  text-align: center;
  color: #8c8c8c;
}

/* ---- 双栏布局（旧版 .track-layout：420px + 1fr） ---- */
.track-layout {
  display: grid;
  grid-template-columns: 420px 1fr;
  gap: 12px;
  align-items: start;
}

/* 左列任务列表（旧版 .track-list） */
.track-list {
  overflow: hidden;
  max-height: calc(100vh - 220px);
  overflow-y: auto;
}

.track-list__head {
  position: sticky;
  top: 0;
  background: #ffffff;
  z-index: 1;
}

.track-list .row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 11px 14px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background 0.12s;
}

.track-list .row:hover {
  background: #f7fafd;
}

.track-list .row.selected {
  background: #f0f7ff;
  border-left: 3px solid #1677ff;
  padding-left: 11px;
}

.track-list .l1 {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.track-list .l1 b {
  color: #262626;
  font-size: 13px;
}

.track-list .l2 {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: #8c8c8c;
  font-size: 12px;
  min-width: 0;
}

.l2__vin,
.l2__loc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.l2__customer {
  flex: none;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-side__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 0;
}

.track-side__error {
  color: #f5222d;
  font-size: 13px;
}

/* ---- 右列详情 ---- */
.track-detail {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.track-main__loading {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #ffffff;
  border-radius: 6px;
  padding: 16px;
}

/* 进度条（旧版 .route-viz / .route-line） */
.route-viz {
  padding: 18px 22px 8px;
}

.route-line {
  position: relative;
  height: 6px;
  background: #e5e6eb;
  border-radius: 3px;
  margin: 26px 4px 30px;
}

.route-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: #1677ff;
  border-radius: 3px;
  transition: width 0.5s;
}

.route-node {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}

.route-node .pt {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ffffff;
  border: 3px solid #d9d9d9;
  margin: 0 auto;
}

.route-node.done .pt {
  border-color: #1677ff;
  background: #1677ff;
}

.route-node .txt {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 12px;
  color: #595959;
  bottom: 18px;
}

.route-node .txt.bottom {
  top: 18px;
  bottom: auto;
}

.route-node .txt.txt--origin {
  left: 0;
  transform: none;
}

.route-node .txt.txt--dest {
  left: auto;
  right: -30px;
  transform: none;
}

/* 描述栅格（旧版 .desc-grid） */
.desc-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 1px solid #f0f0f0;
  border-bottom: 1px solid #f0f0f0;
  background: #ffffff;
  overflow: hidden;
}

.desc {
  display: flex;
  padding: 10px 14px;
  border-bottom: 1px solid #f0f0f0;
  border-right: 1px solid #f0f0f0;
}

.desc:nth-child(3n) {
  border-right: none;
}

.desc.wide {
  grid-column: 1 / -1;
  border-right: none;
}

.desc > label {
  width: 92px;
  flex-shrink: 0;
  color: #8c8c8c;
}

.desc > span {
  color: #262626;
  word-break: break-all;
}

/* 运输地图卡 */
.track-map-card {
  overflow: hidden;
}

.track-map__route {
  font-weight: 400;
  color: #8c8c8c;
  font-size: 12px;
}

.track-map__tip {
  padding: 10px 16px 12px;
  font-size: 12px;
  color: #fa8c16;
  text-align: center;
}

/* 底部两栏：运输节点 + 位置记录 */
.track-bottom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: start;
}

/* 时间轴（旧版 .timeline：done 实心主色 / cur 空心主色光圈） */
.timeline {
  padding: 12px 16px;
}

.tl-item {
  position: relative;
  padding: 0 0 18px 26px;
}

.tl-item:last-child {
  padding-bottom: 4px;
}

.tl-item::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 16px;
  bottom: -2px;
  width: 2px;
  background: #e5e6eb;
}

.tl-item:last-child::before {
  display: none;
}

.tl-dot {
  position: absolute;
  left: 0;
  top: 4px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ffffff;
  border: 3px solid #d9d9d9;
}

.tl-item.done .tl-dot {
  border-color: #1677ff;
  background: #1677ff;
}

.tl-item.cur .tl-dot {
  border-color: #1677ff;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.15);
}

.tl-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.tl-name {
  font-weight: 600;
  color: #262626;
}

.tl-item.cur .tl-name {
  color: #1677ff;
}

.tl-time {
  color: #8c8c8c;
  font-size: 12px;
}

.tl-detail {
  color: #595959;
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.7;
}

.tl-meta {
  color: #8c8c8c;
}

/* 位置记录表（旧版 table-scroll） */
.track-track-scroll {
  max-height: 340px;
  overflow-y: auto;
}

.track-bottom table {
  width: 100%;
  min-width: 0;
  border-collapse: collapse;
}

.track-bottom th {
  background: #fafafa;
  color: #595959;
  font-weight: 500;
  text-align: left;
  padding: 11px 12px;
  border-bottom: 1px solid #f0f0f0;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
}

.track-bottom td {
  padding: 10px 12px;
  color: #262626;
  border-bottom: 1px solid #f0f0f0;
  white-space: nowrap;
}

.track-loc {
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}

@media (max-width: 1100px) {
  .track-layout {
    grid-template-columns: 1fr;
  }

  .track-list {
    max-height: 360px;
  }

  .track-bottom {
    grid-template-columns: 1fr;
  }

  .desc-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .desc:nth-child(3n) {
    border-right: 1px solid #f0f0f0;
  }

  .desc:nth-child(2n) {
    border-right: none;
  }
}
</style>
