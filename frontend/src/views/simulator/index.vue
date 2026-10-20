<script setup lang="ts">
/**
 * 外部系统模拟（演示核心页）
 *
 * 覆盖契约第 6 节全部 9 个外部接口 + 第 7 节 2 个 mock 辅助接口，共 11 张表单卡：
 *   CRM 系统：#1 下发发运申请 / #2 发起物流电子签 / #3 取消前查询 / #6 同步取消
 *   狮桥物流：#4 电子签回执确认 / #10 司机同步 / #12 任务状态回传 / #14 电子签状态回传
 *   WMS 仓储：#8 出库状态回传
 *   演示辅助：MOCK-1 模拟位置回传 / MOCK-2 模拟签署
 *
 * 关键设计：
 *  - 走 services/external.ts 的 callExternalRaw（独立 axios 实例，永不 reject），
 *    完整响应信封 { code, message, data } 原样呈现：00000 绿色、业务错误红色，
 *    便于演示 C0001 重复下发 / D0001 状态机拦截等错误分支
 *  - 任务定位统一 applyNo 优先、taskNo 兼容（SimTaskLocator 二选一控件）
 *  - 表单字段与契约字段一一对应，标签同时展示中文名与 payload 键名
 */
import { computed, onActivated, onMounted, reactive, ref } from 'vue'
import { useMessage } from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import { callExternalRaw } from '@/services/external'
import type { RawExternalCall } from '@/services/external'
import { listCarriers } from '@/services/carriers'
import { useDictionaryStore } from '@/stores/dictionary'
import { CANCEL_DISPATCH_REASONS } from '@/types/api'
import type { ExternalTaskAction } from '@/types/api'
import SimCard from './components/SimCard.vue'
import SimResponse from './components/SimResponse.vue'
import SimTaskLocator from './components/SimTaskLocator.vue'
import type { SimResponseState } from './sim-types'

const message = useMessage()
const dictStore = useDictionaryStore()

const activeTab = ref('crm')

// ---------------------------------------------------------------------------
// 响应面板状态（11 个接口各一份，跨 Tab 切换保留）
// ---------------------------------------------------------------------------

type ApiId =
  | 'receive'
  | 'esignSync'
  | 'cancelCheck'
  | 'receiptSync'
  | 'cancel'
  | 'wmsOutbound'
  | 'driverSync'
  | 'statusSync'
  | 'signStatus'
  | 'mockTrack'
  | 'mockSign'

function emptyState(): SimResponseState {
  return { loading: false, request: '', envelope: null, time: '' }
}

const respStates = reactive<Record<ApiId, SimResponseState>>({
  receive: emptyState(),
  esignSync: emptyState(),
  cancelCheck: emptyState(),
  receiptSync: emptyState(),
  cancel: emptyState(),
  wmsOutbound: emptyState(),
  driverSync: emptyState(),
  statusSync: emptyState(),
  signStatus: emptyState(),
  mockTrack: emptyState(),
  mockSign: emptyState(),
})

/** 过滤空值（null / undefined / 空串）后的浅拷贝 */
function clean(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  Object.entries(source).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return
    out[key] = value
  })
  return out
}

/** 任务定位校验：applyNo / taskNo 至少一项 */
function checkLocator(applyNo: string, taskNo: string): string | null {
  if (!applyNo.trim() && !taskNo.trim()) {
    return '请填写发运申请号 applyNo（推荐）或任务单号 taskNo，至少一项'
  }
  return null
}

function buildPreview(call: RawExternalCall): string {
  const head = `${call.method} /api/${call.path}`
  if (call.method === 'GET') {
    if (!call.params) return head
    const qs = Object.entries(call.params)
      .filter(([, value]) => value !== '' && value !== null && value !== undefined)
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
      .join('&')
    return qs ? `${head}?${qs}` : head
  }
  return `${head}\n${JSON.stringify(call.payload ?? null, null, 2)}`
}

function nowTimeText(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

/** 调用接口并写入响应面板（失败信封同样展示，同时给一条轻提示） */
async function runCall(id: ApiId, call: RawExternalCall): Promise<void> {
  const state = respStates[id]
  state.loading = true
  state.request = buildPreview(call)
  try {
    const envelope = await callExternalRaw(call)
    state.envelope = envelope
    state.time = nowTimeText()
    if (envelope.code === '00000') {
      message.success(envelope.message || '调用成功')
    } else {
      message.error(`[${envelope.code}] ${envelope.message}`)
    }
  } finally {
    state.loading = false
  }
}

// ---------------------------------------------------------------------------
// 预填辅助（演示时少敲键盘）
// ---------------------------------------------------------------------------

function todayCompact(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
}

/** 计划提车日期默认值：明天（CRM 随发运申请下发，必填） */
function tomorrowIsoDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function randomSuffix(): string {
  return String(Math.floor(Math.random() * 900) + 100)
}

// ---------------------------------------------------------------------------
// #1 CRM 下发发运申请
// ---------------------------------------------------------------------------

interface SimVehicleForm {
  vin: string
  orderNo: string
  reportNo: string
  planFreight: number | null
  shipLocation: string
  vehicleModel: string
  engineConfig: string
  cabinType: string
}

function emptyVehicle(): SimVehicleForm {
  return {
    vin: '',
    orderNo: '',
    reportNo: '',
    planFreight: null,
    shipLocation: '',
    vehicleModel: '',
    engineConfig: '',
    cabinType: '',
  }
}

const receiveForm = reactive({
  applyNo: `APPLY-${todayCompact()}-${randomSuffix()}`,
  customerName: '',
  deliveryAddress: '',
  region: '',
  salesPerson: '',
  salesPhone: '',
  deliveryArea: '',
  receiverPhone: '',
  factory: '',
  storageLocation: '',
  shipMethod: '送车',
  planPickupDate: tomorrowIsoDate(),
  remark: '',
  vehicles: [emptyVehicle()],
})

function addVehicle(): void {
  receiveForm.vehicles.push(emptyVehicle())
}

function removeVehicle(index: number): void {
  if (receiveForm.vehicles.length <= 1) return
  receiveForm.vehicles.splice(index, 1)
}

function validateReceive(): string | null {
  if (!receiveForm.applyNo.trim()) return '请填写发运申请号 applyNo'
  if (!receiveForm.customerName.trim()) return '请填写客户名称 customerName'
  if (!receiveForm.deliveryAddress.trim()) return '请填写交付地址 deliveryAddress'
  if (!receiveForm.planPickupDate) return '请填写计划提车日期 planPickupDate（CRM 随发运申请下发，必填）'
  for (let i = 0; i < receiveForm.vehicles.length; i += 1) {
    const vin = receiveForm.vehicles[i].vin.trim().toUpperCase()
    if (!vin) return `第 ${i + 1} 台车的 VIN 必填`
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return `第 ${i + 1} 台车的 VIN 须为 17 位（不含 I/O/Q）`
  }
  return null
}

function buildReceivePayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    applyNo: receiveForm.applyNo.trim(),
    customerName: receiveForm.customerName.trim(),
    deliveryAddress: receiveForm.deliveryAddress.trim(),
    vehicles: receiveForm.vehicles.map((vehicle) => {
      const item: Record<string, unknown> = { vin: vehicle.vin.trim().toUpperCase() }
      if (vehicle.orderNo.trim()) item.orderNo = vehicle.orderNo.trim()
      if (vehicle.reportNo.trim()) item.reportNo = vehicle.reportNo.trim()
      if (vehicle.planFreight !== null) item.planFreight = vehicle.planFreight
      if (vehicle.shipLocation.trim()) item.shipLocation = vehicle.shipLocation.trim()
      if (vehicle.vehicleModel.trim()) item.vehicleModel = vehicle.vehicleModel.trim()
      if (vehicle.engineConfig.trim()) item.engineConfig = vehicle.engineConfig.trim()
      if (vehicle.cabinType.trim()) item.cabinType = vehicle.cabinType.trim()
      return item
    }),
  }
  const optionalText: Array<[string, string]> = [
    ['region', receiveForm.region],
    ['salesPerson', receiveForm.salesPerson],
    ['salesPhone', receiveForm.salesPhone],
    ['deliveryArea', receiveForm.deliveryArea],
    ['receiverPhone', receiveForm.receiverPhone],
    ['factory', receiveForm.factory],
    ['storageLocation', receiveForm.storageLocation],
    ['shipMethod', receiveForm.shipMethod],
    ['remark', receiveForm.remark],
  ]
  optionalText.forEach(([key, value]) => {
    if (value.trim()) payload[key] = value.trim()
  })
  if (receiveForm.planPickupDate) payload.planPickupDate = receiveForm.planPickupDate
  return payload
}

async function submitReceive(): Promise<void> {
  const problem = validateReceive()
  if (problem) {
    message.error(problem)
    return
  }
  await runCall('receive', {
    method: 'POST',
    path: 'external/shipping-tasks/receive',
    payload: buildReceivePayload(),
  })
}

// ---------------------------------------------------------------------------
// #2 CRM 发起物流电子签
// ---------------------------------------------------------------------------

const esignSyncForm = reactive({
  esignId: `ES${todayCompact()}${randomSuffix()}`,
  vin: '',
  applyNo: '',
  signType: '物流电子签',
  triggerNode: '',
  signParty: '',
})

async function submitEsignSync(): Promise<void> {
  if (!esignSyncForm.esignId.trim()) {
    message.error('请填写电子签 ID esignId')
    return
  }
  if (!esignSyncForm.vin.trim() || !esignSyncForm.applyNo.trim()) {
    message.error('VIN 与发运申请号 applyNo 必填（用于匹配任务）')
    return
  }
  const payload = clean({
    esignId: esignSyncForm.esignId.trim(),
    vin: esignSyncForm.vin.trim().toUpperCase(),
    applyNo: esignSyncForm.applyNo.trim(),
    signType: esignSyncForm.signType.trim(),
    triggerNode: esignSyncForm.triggerNode.trim(),
    signParty: esignSyncForm.signParty.trim(),
  })
  await runCall('esignSync', { method: 'POST', path: 'external/esign/sync', payload })
}

// ---------------------------------------------------------------------------
// #3 CRM 取消前查询（GET）
// ---------------------------------------------------------------------------

const cancelCheckForm = reactive({ applyNo: '', taskNo: '' })

async function submitCancelCheck(): Promise<void> {
  const problem = checkLocator(cancelCheckForm.applyNo, cancelCheckForm.taskNo)
  if (problem) {
    message.error(problem)
    return
  }
  const params = clean({
    applyNo: cancelCheckForm.applyNo.trim(),
    taskNo: cancelCheckForm.taskNo.trim(),
  })
  await runCall('cancelCheck', {
    method: 'GET',
    path: 'external/shipping-tasks/cancel-check',
    params,
  })
}

// ---------------------------------------------------------------------------
// #4 狮桥电子签回执确认
// ---------------------------------------------------------------------------

const receiptSyncForm = reactive({ esignId: '' })

async function submitReceiptSync(): Promise<void> {
  if (!receiptSyncForm.esignId.trim()) {
    message.error('请填写电子签 ID esignId')
    return
  }
  await runCall('receiptSync', {
    method: 'POST',
    path: 'external/esign/receipt-sync',
    payload: { esignId: receiptSyncForm.esignId.trim() },
  })
}

// ---------------------------------------------------------------------------
// #6 CRM 同步取消
// ---------------------------------------------------------------------------

const cancelForm = reactive({
  applyNo: '',
  taskNo: '',
  cancelReason: null as string | null,
})

const cancelReasonOptions = computed<SelectOption[]>(() => {
  const list = dictStore.cancelReasons.length ? dictStore.cancelReasons : CANCEL_DISPATCH_REASONS
  return list.map((reason) => ({ label: reason, value: reason }))
})

async function submitCancel(): Promise<void> {
  const problem = checkLocator(cancelForm.applyNo, cancelForm.taskNo)
  if (problem) {
    message.error(problem)
    return
  }
  const payload = clean({
    applyNo: cancelForm.applyNo.trim(),
    taskNo: cancelForm.taskNo.trim(),
    cancelReason: cancelForm.cancelReason?.trim() ?? '',
  })
  await runCall('cancel', { method: 'POST', path: 'external/shipping-tasks/cancel', payload })
}

// ---------------------------------------------------------------------------
// #8 WMS 出库状态回传
// ---------------------------------------------------------------------------

const wmsOutboundForm = reactive({
  applyNo: '',
  taskNo: '',
  outboundTime: null as string | null,
})

async function submitWmsOutbound(): Promise<void> {
  const problem = checkLocator(wmsOutboundForm.applyNo, wmsOutboundForm.taskNo)
  if (problem) {
    message.error(problem)
    return
  }
  const payload = clean({
    applyNo: wmsOutboundForm.applyNo.trim(),
    taskNo: wmsOutboundForm.taskNo.trim(),
    outboundTime: wmsOutboundForm.outboundTime ?? '',
  })
  await runCall('wmsOutbound', { method: 'POST', path: 'external/wms/outbound-status', payload })
}

// ---------------------------------------------------------------------------
// #10 狮桥司机同步
// ---------------------------------------------------------------------------

const driverSyncForm = reactive({
  driverName: '',
  phone: '',
  idCard: '',
  licenseNo: '',
  licenseType: '',
  licenseValidFrom: null as string | null,
  licenseValidTo: null as string | null,
  carrierId: null as number | null,
})

const carrierOptions = ref<SelectOption[]>([])

async function loadCarrierOptions(): Promise<void> {
  try {
    const result = await listCarriers({ page: 1, size: 100 })
    carrierOptions.value = (result?.list ?? [])
      .filter((carrier): carrier is typeof carrier & { id: number } => typeof carrier.id === 'number')
      .map((carrier) => ({
        label: `${carrier.carrier_name}（ID ${carrier.id}）`,
        value: carrier.id,
      }))
  } catch {
    carrierOptions.value = []
  }
}

async function submitDriverSync(): Promise<void> {
  if (!driverSyncForm.driverName.trim()) {
    message.error('请填写司机姓名 driverName')
    return
  }
  if (!/^1\d{10}$/.test(driverSyncForm.phone.trim())) {
    message.error('请填写正确的手机号 phone（11 位）')
    return
  }
  if (!/^\d{17}[\dXx]$/.test(driverSyncForm.idCard.trim())) {
    message.error('请填写正确的身份证号 idCard（18 位）')
    return
  }
  const payload = clean({
    driverName: driverSyncForm.driverName.trim(),
    phone: driverSyncForm.phone.trim(),
    idCard: driverSyncForm.idCard.trim().toUpperCase(),
    licenseNo: driverSyncForm.licenseNo.trim(),
    licenseType: driverSyncForm.licenseType.trim(),
    licenseValidFrom: driverSyncForm.licenseValidFrom ?? '',
    licenseValidTo: driverSyncForm.licenseValidTo ?? '',
    carrierId: driverSyncForm.carrierId,
  })
  await runCall('driverSync', { method: 'POST', path: 'external/drivers/sync', payload })
}

// ---------------------------------------------------------------------------
// #12 狮桥任务状态回传
// ---------------------------------------------------------------------------

const ACTION_VALUES: ExternalTaskAction[] = ['ACCEPT', 'PICKUP', 'ARRIVE', 'FINISH']

const actionOptions: SelectOption[] = [
  { label: 'ACCEPT · 承运商接单', value: 'ACCEPT' },
  { label: 'PICKUP · 司机提车', value: 'PICKUP' },
  { label: 'ARRIVE · 司机到达（生成运费单）', value: 'ARRIVE' },
  { label: 'FINISH · 司机完结', value: 'FINISH' },
]

const statusSyncForm = reactive({
  action: 'ACCEPT' as string,
  applyNo: '',
  taskNo: '',
  driverId: null as number | null,
  planPickupDate: null as string | null,
  photosText: '',
  actualFreight: null as number | null,
  mileage: null as number | null,
})

async function submitStatusSync(): Promise<void> {
  const action = ACTION_VALUES.find((item) => item === statusSyncForm.action)
  if (!action) {
    message.error('请选择回传动作 action（ACCEPT/PICKUP/ARRIVE/FINISH）')
    return
  }
  const problem = checkLocator(statusSyncForm.applyNo, statusSyncForm.taskNo)
  if (problem) {
    message.error(problem)
    return
  }
  if (action === 'ACCEPT' && (statusSyncForm.driverId === null || statusSyncForm.driverId <= 0)) {
    message.error('接单必须分配司机 driverId（司机管理页可查 ID）')
    return
  }
  const payload: Record<string, unknown> = clean({
    action,
    applyNo: statusSyncForm.applyNo.trim(),
    taskNo: statusSyncForm.taskNo.trim(),
    driverId: statusSyncForm.driverId,
    planPickupDate: statusSyncForm.planPickupDate ?? '',
    actualFreight: statusSyncForm.actualFreight,
    mileage: statusSyncForm.mileage,
  })
  if (action === 'PICKUP') {
    const photos = statusSyncForm.photosText
      .split(/[\n,，]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    if (photos.length) payload.photos = photos
  }
  await runCall('statusSync', {
    method: 'POST',
    path: 'external/shipping-tasks/status-sync',
    payload,
  })
}

// ---------------------------------------------------------------------------
// #14 狮桥电子签签署状态回传
// ---------------------------------------------------------------------------

const signStatusForm = reactive({
  esignId: '',
  signStatus: 'SIGNED' as string,
})

const signStatusOptions: SelectOption[] = [
  { label: 'SIGNED · 已签署', value: 'SIGNED' },
  { label: 'CANCELLED · 已取消', value: 'CANCELLED' },
]

async function submitSignStatus(): Promise<void> {
  if (!signStatusForm.esignId.trim()) {
    message.error('请填写电子签 ID esignId')
    return
  }
  const signStatus = signStatusForm.signStatus === 'CANCELLED' ? 'CANCELLED' : 'SIGNED'
  await runCall('signStatus', {
    method: 'POST',
    path: 'external/esign/sign-status',
    payload: { esignId: signStatusForm.esignId.trim(), signStatus },
  })
}

// ---------------------------------------------------------------------------
// MOCK-1 模拟位置回传
// ---------------------------------------------------------------------------

const mockTrackForm = reactive({
  applyNo: '',
  taskNo: '',
  locationDesc: '',
  longitude: 116.397128,
  latitude: 39.916527,
  speed: 65,
})

async function submitMockTrack(): Promise<void> {
  const problem = checkLocator(mockTrackForm.applyNo, mockTrackForm.taskNo)
  if (problem) {
    message.error(problem)
    return
  }
  if (!mockTrackForm.locationDesc.trim()) {
    message.error('请填写位置描述 locationDesc')
    return
  }
  const payload = clean({
    applyNo: mockTrackForm.applyNo.trim(),
    taskNo: mockTrackForm.taskNo.trim(),
    locationDesc: mockTrackForm.locationDesc.trim(),
    longitude: mockTrackForm.longitude,
    latitude: mockTrackForm.latitude,
    speed: mockTrackForm.speed,
  })
  await runCall('mockTrack', { method: 'POST', path: 'mock/track', payload })
}

// ---------------------------------------------------------------------------
// MOCK-2 模拟签署（最新待签署电子签）
// ---------------------------------------------------------------------------

const mockSignForm = reactive({ applyNo: '', taskNo: '' })

async function submitMockSign(): Promise<void> {
  const problem = checkLocator(mockSignForm.applyNo, mockSignForm.taskNo)
  if (problem) {
    message.error(problem)
    return
  }
  const payload = clean({
    applyNo: mockSignForm.applyNo.trim(),
    taskNo: mockSignForm.taskNo.trim(),
  })
  await runCall('mockSign', { method: 'POST', path: 'mock/esign/sign-task', payload })
}

// ---------------------------------------------------------------------------

onMounted(() => {
  dictStore.ensureLoaded().catch(() => {
    /* 字典失败不阻塞模拟器，取消原因下拉回退内置选项 */
  })
  loadCarrierOptions()
})

// keep-alive 页签切回时重新拉取承运商下拉（承运商页新增后回来自动可见）
onActivated(() => {
  loadCarrierOptions()
})
</script>

<template>
  <div class="sim">
    <!-- 演示说明 -->
    <n-alert type="info" :show-icon="false" class="sim-intro">
      <div>
        <b>统一定位</b>：applyNo（发运申请号）优先，taskNo（任务单号）兼容，都无 → A0001。
      </div>
      <div>
        <b>幂等设计</b>：接口均幂等（重复回执/回传直接返回当前结果）；applyNo / esignId 重复下发 →
        C0001；状态机拦截 → D0001。失败信封同样完整展示，便于演示错误分支。
      </div>
      <div>
        <b>演示链路</b>：#1 CRM 下发 → STP 派单（发运任务页）→ #12 ACCEPT 接单 → #2 发起电子签 →
        #12 PICKUP 提车 → #8 WMS 出库 → MOCK-1 位置回传 → #12 ARRIVE 到达（生成运费单）→ #12
        FINISH 完结 → 电子签签署（MOCK-2 或 #14）→ 结算对账。
      </div>
    </n-alert>

    <n-tabs v-model:value="activeTab" type="line" animated class="sim-tabs">
      <!-- CRM 系统 -->
      <n-tab-pane name="crm" tab="CRM 系统（4）">
        <div class="sim-grid">
          <!-- #1 下发发运申请（字段多，占整行） -->
          <SimCard
            no="#1"
            title="CRM 下发发运申请"
            method="POST"
            path="/api/external/shipping-tasks/receive"
            summary="模拟 CRM 下发整车发运申请：STP 自动生成任务单号（FY+日期+四位）并进入待派单；applyNo 重复 → C0001"
            :desc="[
              '任务单号由 STP 自动生成（FY+yyyyMMdd+四位序列），CRM 无需也不应传 taskNo。',
              '计划运费 = 各车辆 planFreight 之和；全部未传时兼容顶层 planFreight。',
              'VIN 按 17 位校验（不含 I/O/Q）；备注 ≤ 500 字随申请落任务。',
              'applyNo 为 CRM 业务主键，重复下发返回 C0001 重复错误。',
            ]"
            wide
          >
            <n-form size="small" label-placement="top" class="sim-form">
              <div class="sim-form__grid">
                <n-form-item label="发运申请号 applyNo" show-require-mark>
                  <n-input v-model:value="receiveForm.applyNo" clearable placeholder="如 APPLY-20261020-101" />
                </n-form-item>
                <n-form-item label="客户名称 customerName" show-require-mark>
                  <n-input v-model:value="receiveForm.customerName" clearable placeholder="请输入客户全称" />
                </n-form-item>
                <n-form-item label="交付地址 deliveryAddress" show-require-mark class="sim-form__wide">
                  <n-input v-model:value="receiveForm.deliveryAddress" clearable placeholder="省市区 + 详细地址" />
                </n-form-item>
                <n-form-item label="大区 region">
                  <n-input v-model:value="receiveForm.region" clearable placeholder="如 华东大区" />
                </n-form-item>
                <n-form-item label="销售人员 salesPerson">
                  <n-input v-model:value="receiveForm.salesPerson" clearable placeholder="销售姓名" />
                </n-form-item>
                <n-form-item label="销售电话 salesPhone">
                  <n-input v-model:value="receiveForm.salesPhone" clearable placeholder="11 位手机号，选填" />
                </n-form-item>
                <n-form-item label="接车人电话 receiverPhone">
                  <n-input v-model:value="receiveForm.receiverPhone" clearable placeholder="11 位手机号，选填" />
                </n-form-item>
                <n-form-item label="交付区域 deliveryArea">
                  <n-input v-model:value="receiveForm.deliveryArea" clearable placeholder="如 华东区域" />
                </n-form-item>
                <n-form-item label="工厂 factory">
                  <n-input v-model:value="receiveForm.factory" clearable placeholder="选填" />
                </n-form-item>
                <n-form-item label="库位 storageLocation">
                  <n-input v-model:value="receiveForm.storageLocation" clearable placeholder="选填" />
                </n-form-item>
                <n-form-item label="送车方式 shipMethod">
                  <n-input v-model:value="receiveForm.shipMethod" clearable placeholder="默认「送车」" />
                </n-form-item>
                <n-form-item label="计划提车日期 planPickupDate *必填">
                  <n-date-picker
                    v-model:formatted-value="receiveForm.planPickupDate"
                    type="date"
                    value-format="yyyy-MM-dd"
                    placeholder="YYYY-MM-DD"
                  />
                </n-form-item>
                <n-form-item label="备注 remark（≤500 字）" class="sim-form__wide">
                  <n-input
                    v-model:value="receiveForm.remark"
                    type="textarea"
                    :rows="2"
                    maxlength="500"
                    show-count
                    placeholder="随发运申请同步至任务详情"
                  />
                </n-form-item>
              </div>
            </n-form>

            <!-- 车辆明细（一任务多车） -->
            <div class="sim-vehicles">
              <div class="sim-vehicles__head">车辆明细（{{ receiveForm.vehicles.length }} 台，VIN 必填）</div>
              <div v-for="(vehicle, index) in receiveForm.vehicles" :key="index" class="sim-vehicle">
                <div class="sim-vehicle__head">
                  <span>车辆 {{ index + 1 }}</span>
                  <n-button
                    v-if="receiveForm.vehicles.length > 1"
                    size="tiny"
                    quaternary
                    type="error"
                    @click="removeVehicle(index)"
                  >
                    删除
                  </n-button>
                </div>
                <div class="sim-form__grid">
                  <n-form-item label="VIN" show-require-mark>
                    <n-input v-model:value="vehicle.vin" clearable placeholder="17 位车架号" />
                  </n-form-item>
                  <n-form-item label="车型 vehicleModel">
                    <n-input v-model:value="vehicle.vehicleModel" clearable placeholder="如 星辰重卡 H9" />
                  </n-form-item>
                  <n-form-item label="计划运费 planFreight（元）">
                    <n-input-number v-model:value="vehicle.planFreight" :min="0" :precision="2" placeholder="线路参考价" />
                  </n-form-item>
                  <n-form-item label="发运地点 shipLocation">
                    <n-input v-model:value="vehicle.shipLocation" clearable placeholder="如 安徽合肥" />
                  </n-form-item>
                  <n-form-item label="订单号 orderNo">
                    <n-input v-model:value="vehicle.orderNo" clearable placeholder="选填" />
                  </n-form-item>
                  <n-form-item label="报告号 reportNo">
                    <n-input v-model:value="vehicle.reportNo" clearable placeholder="选填" />
                  </n-form-item>
                  <n-form-item label="动力配置 engineConfig">
                    <n-input v-model:value="vehicle.engineConfig" clearable placeholder="选填" />
                  </n-form-item>
                  <n-form-item label="驾驶室 cabinType">
                    <n-input v-model:value="vehicle.cabinType" clearable placeholder="选填" />
                  </n-form-item>
                </div>
              </div>
              <n-button size="small" dashed block @click="addVehicle">+ 添加车辆</n-button>
            </div>

            <div class="sim-submit">
              <n-button
                size="small"
                type="primary"
                :loading="respStates.receive.loading"
                @click="submitReceive"
              >
                下发发运申请
              </n-button>
            </div>
            <SimResponse :state="respStates.receive" />
          </SimCard>

          <!-- #2 发起物流电子签 -->
          <SimCard
            no="#2"
            title="CRM 发起物流电子签"
            method="POST"
            path="/api/external/esign/sync"
            summary="按 VIN + 发运申请号匹配任务并发起物流电子签；esignId 重复推送 → C0001"
            :desc="[
              '匹配规则：VIN + 发运申请号定位任务（VIN 查车辆明细表，既有需求 8）。',
              '签署类型默认「物流电子签」，可带触发节点与签署方。',
              'esignId 为唯一键，重复推送返回 C0001。',
            ]"
          >
            <n-form size="small" label-placement="top" class="sim-form">
              <div class="sim-form__grid">
                <n-form-item label="电子签 ID esignId" show-require-mark>
                  <n-input v-model:value="esignSyncForm.esignId" clearable placeholder="如 ES20261020001" />
                </n-form-item>
                <n-form-item label="签署类型 signType">
                  <n-input v-model:value="esignSyncForm.signType" clearable placeholder="默认「物流电子签」" />
                </n-form-item>
                <n-form-item label="VIN" show-require-mark>
                  <n-input v-model:value="esignSyncForm.vin" clearable placeholder="17 位车架号" />
                </n-form-item>
                <n-form-item label="发运申请号 applyNo" show-require-mark>
                  <n-input v-model:value="esignSyncForm.applyNo" clearable placeholder="CRM 业务主键" />
                </n-form-item>
                <n-form-item label="触发节点 triggerNode">
                  <n-input v-model:value="esignSyncForm.triggerNode" clearable placeholder="如 提车发运" />
                </n-form-item>
                <n-form-item label="签署方 signParty">
                  <n-input v-model:value="esignSyncForm.signParty" clearable placeholder="如 司机" />
                </n-form-item>
              </div>
            </n-form>
            <div class="sim-submit">
              <n-button
                size="small"
                type="primary"
                :loading="respStates.esignSync.loading"
                @click="submitEsignSync"
              >
                发起电子签
              </n-button>
            </div>
            <SimResponse :state="respStates.esignSync" />
          </SimCard>

          <!-- #3 取消前查询（GET） -->
          <SimCard
            no="#3"
            title="CRM 取消前查询"
            method="GET"
            path="/api/external/shipping-tasks/cancel-check"
            summary="查询任务当前状态与是否可取消（taskNo / status / cancellable / message）"
            :desc="[
              '取消规则：待派单可取消；已派单需先在 STP 取消派单；承运商已接单需承运商取消接单；已出库发运后不可取消。',
              'GET 请求，定位参数 applyNo 优先 / taskNo 兼容。',
            ]"
          >
            <n-form size="small" label-placement="top" class="sim-form">
              <n-form-item label="任务定位（applyNo 优先 / taskNo 兼容，二选一）" show-require-mark>
                <SimTaskLocator
                  v-model:applyNo="cancelCheckForm.applyNo"
                  v-model:taskNo="cancelCheckForm.taskNo"
                />
              </n-form-item>
            </n-form>
            <div class="sim-submit">
              <n-button
                size="small"
                type="primary"
                :loading="respStates.cancelCheck.loading"
                @click="submitCancelCheck"
              >
                查询可否取消
              </n-button>
            </div>
            <SimResponse :state="respStates.cancelCheck" />
          </SimCard>

          <!-- #6 同步取消 -->
          <SimCard
            no="#6"
            title="CRM 同步取消"
            method="POST"
            path="/api/external/shipping-tasks/cancel"
            summary="按取消规则校验后取消任务，关联待签署电子签同步置为已取消"
            :desc="[
              '任务置 CANCELLED 并记录取消原因/时间；关联待签署电子签同步置为已取消。',
              '不可取消状态 → D0001 拦截；已取消任务重复取消 → 幂等直接返回。',
              '取消原因不传时后端默认「CRM 发起取消」。',
            ]"
          >
            <n-form size="small" label-placement="top" class="sim-form">
              <n-form-item label="任务定位（applyNo 优先 / taskNo 兼容，二选一）" show-require-mark>
                <SimTaskLocator v-model:applyNo="cancelForm.applyNo" v-model:taskNo="cancelForm.taskNo" />
              </n-form-item>
              <n-form-item label="取消原因 cancelReason">
                <n-select
                  v-model:value="cancelForm.cancelReason"
                  clearable
                  placeholder="不传默认「CRM 发起取消」"
                  :options="cancelReasonOptions"
                />
              </n-form-item>
            </n-form>
            <div class="sim-submit">
              <n-button
                size="small"
                type="error"
                secondary
                :loading="respStates.cancel.loading"
                @click="submitCancel"
              >
                同步取消
              </n-button>
            </div>
            <SimResponse :state="respStates.cancel" />
          </SimCard>
        </div>
      </n-tab-pane>

      <!-- 狮桥物流 -->
      <n-tab-pane name="sq" tab="狮桥物流（4）">
        <div class="sim-grid">
          <!-- #4 电子签回执确认 -->
          <SimCard
            no="#4"
            title="狮桥电子签回执确认"
            method="POST"
            path="/api/external/esign/receipt-sync"
            summary="回执确认不改变签署状态，幂等；响应返回当前 esignId / signStatus"
            :desc="[
              '狮桥收到电子签发起请求后的回执确认，仅确认已收到。',
              '重复回执幂等：直接返回当前签署状态。',
            ]"
          >
            <n-form size="small" label-placement="top" class="sim-form">
              <n-form-item label="电子签 ID esignId" show-require-mark>
                <n-input v-model:value="receiptSyncForm.esignId" clearable placeholder="如 ES20261020001" />
              </n-form-item>
            </n-form>
            <div class="sim-submit">
              <n-button
                size="small"
                type="primary"
                :loading="respStates.receiptSync.loading"
                @click="submitReceiptSync"
              >
                确认回执
              </n-button>
            </div>
            <SimResponse :state="respStates.receiptSync" />
          </SimCard>

          <!-- #10 司机同步 -->
          <SimCard
            no="#10"
            title="狮桥司机同步"
            method="POST"
            path="/api/external/drivers/sync"
            summary="按身份证号 UPSERT 司机（source=2 狮桥同步），可选维护司机-承运商关联"
            :desc="[
              '按身份证号 UPSERT：已存在则更新（姓名以狮桥为准，未传字段保留原值），不存在则新增。',
              '新增司机时驾驶证有效期起/至必填；停用司机可正常同步（仅拦截新分派）。',
              '传 carrierId 时同步维护 carrier_driver 关联（承运商须存在）。',
            ]"
          >
            <n-form size="small" label-placement="top" class="sim-form">
              <div class="sim-form__grid">
                <n-form-item label="司机姓名 driverName" show-require-mark>
                  <n-input v-model:value="driverSyncForm.driverName" clearable placeholder="如 王强" />
                </n-form-item>
                <n-form-item label="手机号 phone" show-require-mark>
                  <n-input v-model:value="driverSyncForm.phone" clearable placeholder="11 位手机号" />
                </n-form-item>
                <n-form-item label="身份证号 idCard" show-require-mark>
                  <n-input v-model:value="driverSyncForm.idCard" clearable placeholder="18 位身份证号" />
                </n-form-item>
                <n-form-item label="驾驶证号 licenseNo">
                  <n-input v-model:value="driverSyncForm.licenseNo" clearable placeholder="选填" />
                </n-form-item>
                <n-form-item label="准驾车型 licenseType">
                  <n-input v-model:value="driverSyncForm.licenseType" clearable placeholder="如 A2 / B2" />
                </n-form-item>
                <n-form-item label="有效期自 licenseValidFrom">
                  <n-date-picker
                    v-model:formatted-value="driverSyncForm.licenseValidFrom"
                    type="date"
                    value-format="yyyy-MM-dd"
                    clearable
                    placeholder="新增必填"
                  />
                </n-form-item>
                <n-form-item label="有效期至 licenseValidTo">
                  <n-date-picker
                    v-model:formatted-value="driverSyncForm.licenseValidTo"
                    type="date"
                    value-format="yyyy-MM-dd"
                    clearable
                    placeholder="新增必填"
                  />
                </n-form-item>
                <n-form-item label="关联承运商 carrierId">
                  <n-select
                    v-model:value="driverSyncForm.carrierId"
                    clearable
                    filterable
                    placeholder="选填，维护司机-承运商关联"
                    :options="carrierOptions"
                  />
                </n-form-item>
              </div>
            </n-form>
            <div class="sim-submit">
              <n-button
                size="small"
                type="primary"
                :loading="respStates.driverSync.loading"
                @click="submitDriverSync"
              >
                同步司机
              </n-button>
            </div>
            <SimResponse :state="respStates.driverSync" />
          </SimCard>

          <!-- #12 任务状态回传 -->
          <SimCard
            no="#12"
            title="狮桥任务状态回传"
            method="POST"
            path="/api/external/shipping-tasks/status-sync"
            summary="按状态机校验推进任务状态：ACCEPT 接单 / PICKUP 提车 / ARRIVE 到达 / FINISH 完结"
            :desc="[
              'ACCEPT：已派单 → 承运商已接单，必须分配司机 driverId（须启用且属于任务承运商）。',
              'PICKUP：承运商已接单 → 已提车，回填发运时间；提车照片 URL 写状态日志留痕。',
              'ARRIVE：→ 已到达，回填实际运费/里程，并自动生成运费单（YF+日期+四位）。',
              'FINISH：已到达 → 已完结，同步运费单完结时间。',
              '重复回传幂等：仅补记日志，不回退状态。',
            ]"
          >
            <n-form size="small" label-placement="top" class="sim-form">
              <div class="sim-form__grid">
                <n-form-item label="回传动作 action" show-require-mark>
                  <n-select v-model:value="statusSyncForm.action" :options="actionOptions" />
                </n-form-item>
                <n-form-item label="任务定位（applyNo 优先 / taskNo 兼容，二选一）" show-require-mark class="sim-form__wide">
                  <SimTaskLocator
                    v-model:applyNo="statusSyncForm.applyNo"
                    v-model:taskNo="statusSyncForm.taskNo"
                  />
                </n-form-item>
                <template v-if="statusSyncForm.action === 'ACCEPT'">
                  <n-form-item label="接单司机 driverId（司机管理页可查）" show-require-mark>
                    <n-input-number v-model:value="statusSyncForm.driverId" :min="1" :precision="0" placeholder="司机 ID" />
                  </n-form-item>
                  <n-form-item label="计划提车日期 planPickupDate">
                    <n-date-picker
                      v-model:formatted-value="statusSyncForm.planPickupDate"
                      type="date"
                      value-format="yyyy-MM-dd"
                      clearable
                      placeholder="YYYY-MM-DD，选填"
                    />
                  </n-form-item>
                </template>
                <n-form-item v-else-if="statusSyncForm.action === 'PICKUP'" label="提车照片 photos（多个 URL 换行或逗号分隔）" class="sim-form__wide">
                  <n-input
                    v-model:value="statusSyncForm.photosText"
                    type="textarea"
                    :rows="2"
                    placeholder="https://…/pickup-1.jpg，https://…/pickup-2.jpg"
                  />
                </n-form-item>
                <template v-else-if="statusSyncForm.action === 'ARRIVE'">
                  <n-form-item label="实际运费 actualFreight（元）">
                    <n-input-number v-model:value="statusSyncForm.actualFreight" :min="0" :precision="2" placeholder="不传默认计划运费" />
                  </n-form-item>
                  <n-form-item label="里程 mileage（公里）">
                    <n-input-number v-model:value="statusSyncForm.mileage" :min="0" :precision="1" placeholder="选填" />
                  </n-form-item>
                </template>
              </div>
            </n-form>
            <div class="sim-submit">
              <n-button
                size="small"
                type="primary"
                :loading="respStates.statusSync.loading"
                @click="submitStatusSync"
              >
                回传状态
              </n-button>
            </div>
            <SimResponse :state="respStates.statusSync" />
          </SimCard>

          <!-- #14 电子签签署状态回传 -->
          <SimCard
            no="#14"
            title="狮桥电子签签署状态回传"
            method="POST"
            path="/api/external/esign/sign-status"
            summary="待签署 → 已签署（回填签署时间）/ 已取消；仅「待签署」可流转"
            :desc="[
              'signStatus 仅支持 SIGNED / CANCELLED。',
              '目标状态与当前一致时幂等直接返回；非待签署状态流转 → D0001 拦截。',
            ]"
          >
            <n-form size="small" label-placement="top" class="sim-form">
              <div class="sim-form__grid">
                <n-form-item label="电子签 ID esignId" show-require-mark>
                  <n-input v-model:value="signStatusForm.esignId" clearable placeholder="如 ES20261020001" />
                </n-form-item>
                <n-form-item label="签署状态 signStatus" show-require-mark>
                  <n-select v-model:value="signStatusForm.signStatus" :options="signStatusOptions" />
                </n-form-item>
              </div>
            </n-form>
            <div class="sim-submit">
              <n-button
                size="small"
                type="primary"
                :loading="respStates.signStatus.loading"
                @click="submitSignStatus"
              >
                回传签署状态
              </n-button>
            </div>
            <SimResponse :state="respStates.signStatus" />
          </SimCard>
        </div>
      </n-tab-pane>

      <!-- WMS 仓储 -->
      <n-tab-pane name="wms" tab="WMS 仓储（1）">
        <div class="sim-grid">
          <!-- #8 出库状态回传 -->
          <SimCard
            no="#8"
            title="WMS 出库状态回传"
            method="POST"
            path="/api/external/wms/outbound-status"
            summary="已提车 → 已出库（回填出库日期）；出库早于提车时兜底直接置为在途"
            :desc="[
              '正常链：PICKED → OUTBOUND，回填出库日期。',
              '乱序兜底：出库回传先于提车（当前承运商已接单）→ 直接置 IN_TRANSIT 并留痕。',
              '重复回传（已出库/在途/已到达/已完结）→ 幂等仅补记日志，不回退状态。',
              'outboundTime 不传时取服务器当前时间。',
            ]"
          >
            <n-form size="small" label-placement="top" class="sim-form">
              <div class="sim-form__grid">
                <n-form-item label="任务定位（applyNo 优先 / taskNo 兼容，二选一）" show-require-mark class="sim-form__wide">
                  <SimTaskLocator
                    v-model:applyNo="wmsOutboundForm.applyNo"
                    v-model:taskNo="wmsOutboundForm.taskNo"
                  />
                </n-form-item>
                <n-form-item label="出库时间 outboundTime" class="sim-form__wide">
                  <n-date-picker
                    v-model:formatted-value="wmsOutboundForm.outboundTime"
                    type="datetime"
                    value-format="yyyy-MM-dd HH:mm:ss"
                    clearable
                    placeholder="不传取当前时间"
                  />
                </n-form-item>
              </div>
            </n-form>
            <div class="sim-submit">
              <n-button
                size="small"
                type="primary"
                :loading="respStates.wmsOutbound.loading"
                @click="submitWmsOutbound"
              >
                回传出库状态
              </n-button>
            </div>
            <SimResponse :state="respStates.wmsOutbound" />
          </SimCard>
        </div>
      </n-tab-pane>

      <!-- 演示辅助（mock） -->
      <n-tab-pane name="mock" tab="演示辅助（2）">
        <div class="sim-grid">
          <!-- MOCK-1 模拟位置回传 -->
          <SimCard
            no="MOCK-1"
            title="模拟位置回传（司机端）"
            method="POST"
            path="/api/mock/track"
            summary="写运输轨迹 transport_track；已提车/已出库首次回传自动置为「在途」"
            :desc="[
              '运输单号自动生成：SQ + yyyyMMdd + 任务 ID 补零 4 位。',
              '在途监控页可在地图与轨迹时间线中实时查看回传效果（演示亮点）。',
              '坐标系：经纬度小数（如北京 116.397, 39.917）。',
            ]"
          >
            <n-form size="small" label-placement="top" class="sim-form">
              <div class="sim-form__grid">
                <n-form-item label="任务定位（applyNo 优先 / taskNo 兼容，二选一）" show-require-mark class="sim-form__wide">
                  <SimTaskLocator
                    v-model:applyNo="mockTrackForm.applyNo"
                    v-model:taskNo="mockTrackForm.taskNo"
                  />
                </n-form-item>
                <n-form-item label="位置描述 locationDesc" show-require-mark class="sim-form__wide">
                  <n-input v-model:value="mockTrackForm.locationDesc" clearable placeholder="如 合肥市包河区宿松路（途径）" />
                </n-form-item>
                <n-form-item label="经度 longitude" show-require-mark>
                  <n-input-number v-model:value="mockTrackForm.longitude" :precision="6" placeholder="如 116.397128" />
                </n-form-item>
                <n-form-item label="纬度 latitude" show-require-mark>
                  <n-input-number v-model:value="mockTrackForm.latitude" :precision="6" placeholder="如 39.916527" />
                </n-form-item>
                <n-form-item label="时速 speed（km/h）">
                  <n-input-number v-model:value="mockTrackForm.speed" :min="0" :precision="0" placeholder="选填" />
                </n-form-item>
              </div>
            </n-form>
            <div class="sim-submit">
              <n-button
                size="small"
                type="primary"
                :loading="respStates.mockTrack.loading"
                @click="submitMockTrack"
              >
                回传位置
              </n-button>
            </div>
            <SimResponse :state="respStates.mockTrack" />
          </SimCard>

          <!-- MOCK-2 模拟签署 -->
          <SimCard
            no="MOCK-2"
            title="模拟签署（最新待签署电子签）"
            method="POST"
            path="/api/mock/esign/sign-task"
            summary="一键签署该任务最新一条待签署电子签（无需填电子签 ID）"
            :desc="[
              '演示辅助接口：定位任务后签署其最新一条「待签署」电子签，状态置为已签署并回填签署时间。',
              '等价于接口 #14（signStatus=SIGNED），但无需先查电子签 ID。',
              '任务无待签署电子签时返回业务错误提示。',
            ]"
          >
            <n-form size="small" label-placement="top" class="sim-form">
              <n-form-item label="任务定位（applyNo 优先 / taskNo 兼容，二选一）" show-require-mark>
                <SimTaskLocator v-model:applyNo="mockSignForm.applyNo" v-model:taskNo="mockSignForm.taskNo" />
              </n-form-item>
            </n-form>
            <div class="sim-submit">
              <n-button
                size="small"
                type="success"
                :loading="respStates.mockSign.loading"
                @click="submitMockSign"
              >
                模拟签署
              </n-button>
            </div>
            <SimResponse :state="respStates.mockSign" />
          </SimCard>
        </div>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<style scoped>
.sim-intro {
  margin-bottom: 12px;
  border-radius: 6px;
}

.sim-intro div {
  font-size: 12px;
  line-height: 1.9;
  color: #595959;
}

.sim-intro b {
  color: #1677ff;
}

.sim-tabs :deep(.n-tabs-tab) {
  font-size: 13px;
}

/* 卡片两列栅格（窄屏退化为单列） */
.sim-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
  margin-top: 4px;
}

@media (max-width: 1100px) {
  .sim-grid {
    grid-template-columns: 1fr;
  }
}

/* 卡片内表单两列栅格 */
.sim-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 14px;
  width: 100%;
}

.sim-form__wide {
  grid-column: 1 / -1;
}

.sim-form :deep(.n-form-item-feedback-wrapper) {
  min-height: 0;
}

.sim-form :deep(.n-form-item-label) {
  font-size: 12px;
}

.sim-form :deep(.n-date-picker),
.sim-form :deep(.n-input-number) {
  width: 100%;
}

/* 车辆明细 */
.sim-vehicles {
  margin: 10px 0;
}

.sim-vehicles__head {
  font-size: 12px;
  font-weight: 600;
  color: #595959;
  margin-bottom: 6px;
}

.sim-vehicle {
  border: 1px solid #e5e6eb;
  border-radius: 6px;
  padding: 8px 12px 2px;
  margin-bottom: 8px;
  background: #f7f8fa;
}

.sim-vehicle__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: #262626;
}

.sim-submit {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
</style>
