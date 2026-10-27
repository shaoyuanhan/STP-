<script setup lang="ts">
/**
 * 结算管理 · 应付运费对账（契约 5.6 /api/freight-bills，snake_case）
 *
 * - 筛选：运费单号 / 任务单号 / 承运商 / 对账状态；列表含计划运费合计与实际运费合计
 * - 列表：运费单号(YF)/任务单号/客户/承运商/司机/计划运费/实际运费/调整后金额/
 *         对账状态/到达时间(运费单于任务到达时生成，取生成时间)/完结时间/操作
 * - 详情抽屉：基本信息 + 调整记录列表（时间 / 原金额 → 新金额 / 原因 / 操作人）
 * - 修改运费：仅「待对账」可改，新运费 + 调整原因必填，每次修改写调整记录留痕
 * - 确认对账：0→1（reconciler=系统管理员）；已对账二次操作前端拦截提示
 *
 * 说明：调整前原始金额来自运费明细接口（freight_adjust_log 首条 before_freight），
 * 列表分页后按行并行补齐（演示数据量小），接口异常时降级为当前金额。
 */
import { computed, h, onActivated, onMounted, reactive, ref } from 'vue'
import { useMessage, NButton } from 'naive-ui'
import type { DataTableColumns, FormInst, FormItemRule, PaginationProps, SelectOption } from 'naive-ui'
import {
  listFreightBillRows,
  exportFreightBills,
  getFreightBillDetail,
  adjustFreightBill,
  reconcileFreightBill,
} from '@/services/freight'
import type { FreightBillRow, FreightBillRowListResult } from '@/services/freight'
import { listCarriers } from '@/services/carriers'
import type {
  FreightBillDetail,
  FreightBillQuery,
  FreightAdjustLog,
  ReconcileStatus,
} from '@/types/api'
import { money, datetime } from '@/utils/format'
import StatusTag from '@/components/StatusTag.vue'
import DetailSection from '@/components/DetailSection.vue'
import ConfirmAction from '@/components/ConfirmAction.vue'
import MoneyText from '@/components/MoneyText.vue'

const message = useMessage()

// ---- 筛选 ----
const filters = reactive({
  freight_no: '',
  task_no: '',
  order_no: '',
  carrier_id: null as number | null,
  reconcile_status: null as ReconcileStatus | null,
})

const carrierOptions = ref<SelectOption[]>([])
const reconcileOptions = computed<SelectOption[]>(() => [
  { label: '待对账', value: 0 },
  { label: '已对账', value: 1 },
])

async function loadCarrierOptions() {
  try {
    const result = await listCarriers({ page: 1, size: 100 })
    carrierOptions.value = (result?.list ?? []).map((carrier) => ({
      label: carrier.carrier_name,
      value: carrier.id,
    }))
  } catch {
    carrierOptions.value = []
  }
}

// ---- 列表（手动分页 + 每行调整信息补齐） ----
const loading = ref(false)
const loadError = ref<string | null>(null)
const rows = ref<FreightBillRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const summary = ref<Pick<FreightBillRowListResult, 'amount' | 'plan_amount'>>({
  amount: null,
  plan_amount: null,
})

/** 每行调整信息：原始实际运费（首条调整记录 before）与是否调整过 */
const adjustInfo = ref<Record<number, { original: number; adjusted: boolean }>>({})

/** 最近一次查询条件（导出复用，保证与列表口径一致） */
const lastQuery = ref<FreightBillQuery>({})

async function loadPage() {
  loading.value = true
  loadError.value = null
  try {
    const query: FreightBillQuery = {
      page: page.value,
      size: pageSize.value,
      freight_no: filters.freight_no.trim() || undefined,
      task_no: filters.task_no.trim() || undefined,
      order_no: filters.order_no.trim() || undefined,
      carrier_id: filters.carrier_id ?? undefined,
      reconcile_status: filters.reconcile_status ?? undefined,
    }
    lastQuery.value = { ...query }
    const result = await listFreightBillRows(query)
    rows.value = result?.list ?? []
    total.value = result?.total ?? 0
    summary.value = { amount: result?.amount ?? null, plan_amount: result?.plan_amount ?? null }
    adjustInfo.value = {}
    // 按行补齐调整信息（当前页 ≤ pageSize 条，allSettled 保证单行失败不影响整页）
    const list = rows.value
    const details = await Promise.allSettled(list.map((row) => getFreightBillDetail(row.id)))
    const info: Record<number, { original: number; adjusted: boolean }> = {}
    details.forEach((item, index) => {
      const row = list[index]
      if (item.status !== 'fulfilled' || !item.value) {
        info[row.id] = { original: Number(row.actual_freight) || 0, adjusted: false }
        return
      }
      const logs = item.value.adjustLogs ?? []
      if (logs.length) {
        info[row.id] = { original: Number(logs[0].before_freight) || 0, adjusted: true }
      } else {
        info[row.id] = { original: Number(row.actual_freight) || 0, adjusted: false }
      }
    })
    adjustInfo.value = info
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
    rows.value = []
    total.value = 0
    summary.value = { amount: null, plan_amount: null }
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  page.value = 1
  loadPage()
}

function handleReset() {
  filters.freight_no = ''
  filters.task_no = ''
  filters.order_no = ''
  filters.carrier_id = null
  filters.reconcile_status = null
  page.value = 1
  loadPage()
}

function handlePageChange(next: number) {
  page.value = next
  loadPage()
}

function handlePageSizeChange(next: number) {
  pageSize.value = next
  page.value = 1
  loadPage()
}

// ---- 导出（按最近一次查询条件导出全量，不受分页影响） ----
const exporting = ref(false)

async function handleExport() {
  if (exporting.value) return
  exporting.value = true
  try {
    const filename = await exportFreightBills(lastQuery.value)
    message.success(`已导出：${filename}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出失败，请稍后重试')
  } finally {
    exporting.value = false
  }
}

/** 行 key */
function rowKey(row: FreightBillRow): number {
  return row.id
}

const pagination = computed<PaginationProps>(() => ({
  page: page.value,
  pageSize: pageSize.value,
  itemCount: total.value,
  pageSizes: [10, 20, 50],
  showSizePicker: true,
  showQuickJumper: true,
  prefix: () => `共 ${total.value} 笔`,
  onChange: handlePageChange,
  onUpdatePageSize: handlePageSizeChange,
}))

/** 待对账：可改运费 / 可对账 */
function isPending(bill: { reconcile_status: number }): boolean {
  return Number(bill.reconcile_status) === 0
}

// ---- 操作按钮（列表行内） ----
function openDetail(bill: FreightBillRow) {
  drawerId.value = bill.id
  showDrawer.value = true
  loadDetail(bill.id)
}

function openAdjust(bill: FreightBillRow) {
  adjustTarget.value = bill
  adjustForm.amount = Number(bill.actual_freight) || 0
  adjustForm.reason = ''
  showAdjustModal.value = true
  adjustFormRef.value?.restoreValidation()
}

function askReconcile(bill: FreightBillRow) {
  // 已对账拦截（列表数据滞后或并发操作时兜底，正常情况下按钮不展示）
  if (!isPending(bill)) {
    message.warning('该运费单已对账，无需重复操作')
    return
  }
  reconcileTarget.value = bill
  showReconcileConfirm.value = true
}

const columns = computed<DataTableColumns<FreightBillRow>>(() => [
  {
    title: '运费单号',
    key: 'freight_no',
    width: 150,
    resizable: true,
    fixed: 'left',
    ellipsis: { tooltip: true },
  },
  { title: '任务单号', key: 'task_no', width: 150, resizable: true, ellipsis: { tooltip: true } },
  {
    title: '订单号',
    key: 'order_no',
    width: 150,
    resizable: true,
    ellipsis: { tooltip: true },
    render: (row) => row.order_no || '-',
  },
  {
    title: '客户',
    key: 'customer_name',
    width: 140,
    minWidth: 130,
    resizable: true,
    ellipsis: { tooltip: true },
  },
  {
    title: '承运商',
    key: 'carrier_name',
    width: 140,
    resizable: true,
    ellipsis: { tooltip: true },
    render: (row) => row.carrier_name || '-',
  },
  {
    title: '里程',
    key: 'mileage',
    width: 96,
    resizable: true,
    render: (row) =>
      row.mileage !== null && row.mileage !== undefined && row.mileage !== ''
        ? `${row.mileage} km`
        : '-',
  },
  {
    title: '计划运费',
    key: 'plan_freight',
    width: 110,
    resizable: true,
    render: (row) => h(MoneyText, { value: row.plan_freight, prefix: '¥' }),
  },
  {
    title: '实际运费',
    key: 'original_freight',
    width: 110,
    resizable: true,
    render: (row) =>
      h(MoneyText, {
        value: adjustInfo.value[row.id]?.original ?? row.actual_freight ?? null,
        prefix: '¥',
      }),
  },
  {
    title: '调整后金额',
    key: 'actual_freight',
    width: 120,
    resizable: true,
    render: (row) => {
      const adjusted = adjustInfo.value[row.id]?.adjusted ?? false
      return h(
        'span',
        {
          class: adjusted ? 'freight-adjusted' : '',
        },
        `¥${money(row.actual_freight)}`,
      )
    },
  },
  {
    title: '对账状态',
    key: 'reconcile_status',
    width: 92,
    resizable: true,
    render: (row) => h(StatusTag, { type: 'reconcile', value: row.reconcile_status }),
  },
  {
    title: '到达时间',
    key: 'create_time',
    width: 145,
    resizable: true,
    render: (row) => datetime(row.create_time),
  },
  {
    title: '完结时间',
    key: 'finish_time',
    width: 145,
    resizable: true,
    render: (row) => datetime(row.finish_time),
  },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    align: 'center',
    resizable: true,
    fixed: 'right',
    render: (row) => {
      const buttons = [
        h(
          NButton,
          { size: 'small', quaternary: true, type: 'primary', onClick: () => openDetail(row) },
          { default: () => '费用明细' },
        ),
      ]
      if (isPending(row)) {
        buttons.push(
          h(
            NButton,
            { size: 'small', quaternary: true, type: 'primary', onClick: () => openAdjust(row) },
            { default: () => '修改运费' },
          ),
          h(
            NButton,
            { size: 'small', quaternary: true, type: 'primary', onClick: () => askReconcile(row) },
            { default: () => '确认对账' },
          ),
        )
      }
      return h('div', { class: 'action-buttons' }, buttons)
    },
  },
])

// ---- 详情抽屉 ----
const showDrawer = ref(false)
const drawerId = ref<number | null>(null)
const drawerDetail = ref<FreightBillDetail | null>(null)
const drawerLoading = ref(false)
const drawerError = ref<string | null>(null)

async function loadDetail(id: number) {
  drawerLoading.value = true
  drawerError.value = null
  drawerDetail.value = null
  try {
    drawerDetail.value = await getFreightBillDetail(id)
  } catch (error) {
    drawerError.value = error instanceof Error ? error.message : String(error)
  } finally {
    drawerLoading.value = false
  }
}

const drawerBill = computed<FreightBillRow | null>(() => {
  const detail = drawerDetail.value
  return detail ? (detail.bill as FreightBillRow) : null
})

const adjustLogs = computed<FreightAdjustLog[]>(() =>
  [...(drawerDetail.value?.adjustLogs ?? [])].sort(
    (a, b) => new Date(b.create_time ?? 0).getTime() - new Date(a.create_time ?? 0).getTime(),
  ),
)

/** 调整记录列表列定义（按时间倒序展示，最近一次在最上） */
const adjustColumns = computed<DataTableColumns<FreightAdjustLog>>(() => [
  {
    title: '调整时间',
    key: 'create_time',
    width: 180,
    render: (row) => datetime(row.create_time),
  },
  {
    title: '原运费',
    key: 'before_freight',
    width: 96,
    align: 'right',
    render: (row) => `¥${money(row.before_freight)}`,
  },
  {
    title: '调整后',
    key: 'after_freight',
    width: 96,
    align: 'right',
    render: (row) =>
      h('span', { class: 'freight-adjust-cell' }, `¥${money(row.after_freight)}`),
  },
  {
    title: '调整原因',
    key: 'adjust_reason',
    minWidth: 160,
    ellipsis: { tooltip: true },
  },
  {
    title: '操作人',
    key: 'operator',
    width: 88,
    render: (row) => row.operator || '-',
  },
])

function adjustRowKey(row: FreightAdjustLog): number | string {
  return row.id ?? `${row.create_time ?? ''}-${row.after_freight}`
}

/** 抽屉内对已对账单据的拦截提示 */
function drawerAdjust() {
  const bill = drawerBill.value
  if (!bill) return
  if (!isPending(bill)) {
    message.warning('该运费单已对账，运费不可修改')
    return
  }
  openAdjust(bill)
}

function drawerReconcile() {
  const bill = drawerBill.value
  if (!bill) return
  if (!isPending(bill)) {
    message.warning('该运费单已对账，无需重复操作')
    return
  }
  askReconcile(bill)
}

// ---- 修改运费弹窗（仅待对账可改） ----
const showAdjustModal = ref(false)
const adjustSubmitting = ref(false)
const adjustFormRef = ref<FormInst | null>(null)
const adjustTarget = ref<FreightBillRow | null>(null)
const adjustForm = reactive({
  amount: null as number | null,
  reason: '',
})

const adjustRules: Record<string, FormItemRule | FormItemRule[]> = {
  amount: {
    trigger: ['blur', 'change'],
    validator: (_rule, value: number | null) => {
      if (value === null || value === undefined) return new Error('请输入新实际运费')
      if (!Number.isFinite(value) || value <= 0) return new Error('新实际运费须为大于 0 的数字')
      if (adjustTarget.value && value === Number(adjustTarget.value.actual_freight)) {
        return new Error('新运费与当前运费一致，无需修改')
      }
      return true
    },
  },
  reason: {
    trigger: ['input', 'blur'],
    validator: (_rule, value: string) => {
      if (!value || !value.trim()) return new Error('请填写调整原因')
      if (value.trim().length > 255) return new Error('调整原因不能超过 255 字')
      return true
    },
  },
}

async function submitAdjust() {
  const target = adjustTarget.value
  if (!target) return
  try {
    await adjustFormRef.value?.validate()
  } catch {
    return
  }
  adjustSubmitting.value = true
  try {
    const result = (await adjustFreightBill(target.id, {
      actual_freight: adjustForm.amount as number,
      reason: adjustForm.reason.trim(),
    })) as unknown as { message?: string }
    message.success(result?.message || '运费修改成功，已记录调整日志')
    showAdjustModal.value = false
    if (drawerId.value === target.id) await loadDetail(target.id)
    await loadPage()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    adjustSubmitting.value = false
  }
}

// ---- 确认对账 ----
const showReconcileConfirm = ref(false)
const reconcileTarget = ref<FreightBillRow | null>(null)
const reconcileSubmitting = ref(false)

async function submitReconcile() {
  const target = reconcileTarget.value
  if (!target) return
  reconcileSubmitting.value = true
  try {
    // 成功文案以后端 message 为准（"确认对账成功"）
    const env = await reconcileFreightBill(target.id)
    message.success(env.message || '确认对账成功')
    showReconcileConfirm.value = false
    if (drawerId.value === target.id) await loadDetail(target.id)
    await loadPage()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    reconcileSubmitting.value = false
  }
}

onMounted(() => {
  loadCarrierOptions()
  loadPage()
})

// keep-alive 页签切回时刷新承运商下拉与列表
onActivated(() => {
  loadCarrierOptions()
  loadPage()
})
</script>

<template>
  <div class="stp-page freight">
    <!-- 筛选 -->
    <n-card class="query-card" :bordered="false">
      <div class="query-bar">
        <div class="query-fields">
          <div class="query-item">
            <span>运费单号</span>
            <n-input
              v-model:value="filters.freight_no"
              clearable
              placeholder="请输入运费单号（YF 开头）"
              @keyup.enter="handleSearch"
            />
          </div>
          <div class="query-item">
            <span>任务单号</span>
            <n-input
              v-model:value="filters.task_no"
              clearable
              placeholder="请输入任务单号"
              @keyup.enter="handleSearch"
            />
          </div>
          <div class="query-item">
            <span>订单号</span>
            <n-input
              v-model:value="filters.order_no"
              clearable
              placeholder="请输入订单号"
              @keyup.enter="handleSearch"
            />
          </div>
          <div class="query-item">
            <span>承运商</span>
            <n-select
              v-model:value="filters.carrier_id"
              clearable
              filterable
              placeholder="请选择承运商"
              :options="carrierOptions"
            />
          </div>
          <div class="query-item">
            <span>对账状态</span>
            <n-select
              v-model:value="filters.reconcile_status"
              clearable
              placeholder="请选择对账状态"
              :options="reconcileOptions"
            />
          </div>
        </div>
        <div class="query-buttons">
          <n-button type="primary" quaternary @click="handleReset">重置</n-button>
          <n-button type="primary" :loading="loading" @click="handleSearch">查询</n-button>
        </div>
      </div>
    </n-card>

    <!-- 列表 -->
    <n-card class="table-card" :bordered="false">
      <div class="table-toolbar">
        <div class="table-summary">
          <span>共 {{ total }} 笔</span>
          <span>计划运费合计：<b>¥{{ money(summary.plan_amount) }}</b></span>
          <span>实际运费合计：<b class="freight-summary__actual">¥{{ money(summary.amount) }}</b></span>
          <span class="table-toolbar__hint">运费单于任务到达时自动生成；仅「待对账」可修改运费</span>
        </div>
        <div class="table-toolbar__actions">
          <n-button :loading="exporting" @click="handleExport">导出</n-button>
        </div>
      </div>
      <n-data-table
        size="small"
        remote
        :columns="columns"
        :data="rows"
        :loading="loading"
        :pagination="pagination"
        :row-key="rowKey"
        :scroll-x="1846"
        :bordered="false"
      >
        <template #empty>
          <div v-if="loadError" class="freight-error">
            <span>{{ loadError }}</span>
            <n-button size="small" type="primary" quaternary @click="loadPage()">重试</n-button>
          </div>
          <n-empty v-else description="暂无运费单，任务到达后自动生成" />
        </template>
      </n-data-table>
    </n-card>

    <!-- 详情抽屉 -->
    <n-drawer v-model:show="showDrawer" :width="680" placement="right">
      <n-drawer-content :title="`费用明细 · ${drawerBill?.freight_no ?? ''}`" closable>
        <n-spin :show="drawerLoading">
          <div v-if="drawerError" class="freight-error freight-error--drawer">
            <span>{{ drawerError }}</span>
            <n-button size="tiny" type="primary" @click="drawerId !== null && loadDetail(drawerId)">
              重试
            </n-button>
          </div>
          <template v-else-if="drawerBill">
            <DetailSection title="基本信息" :column="2">
              <n-descriptions-item label="运费单号">{{ drawerBill.freight_no }}</n-descriptions-item>
              <n-descriptions-item label="任务单号">{{ drawerBill.task_no }}</n-descriptions-item>
              <n-descriptions-item label="订单号">{{ drawerBill.order_no || '-' }}</n-descriptions-item>
              <n-descriptions-item label="发运申请号">{{ drawerBill.apply_no || '-' }}</n-descriptions-item>
              <n-descriptions-item label="客户名称">{{ drawerBill.customer_name || '-' }}</n-descriptions-item>
              <n-descriptions-item label="承运商">
                {{ drawerBill.carrier_name || '-' }}
                <span v-if="drawerBill.carrier_code" class="freight-muted">（{{ drawerBill.carrier_code }}）</span>
              </n-descriptions-item>
              <n-descriptions-item label="司机">{{ drawerBill.driver_name || '-' }}</n-descriptions-item>
              <n-descriptions-item label="起始地" :span="2">{{ drawerBill.start_location || '-' }}</n-descriptions-item>
              <n-descriptions-item label="讫地" :span="2">{{ drawerBill.end_location || '-' }}</n-descriptions-item>
              <n-descriptions-item label="里程">
                {{ drawerBill.mileage ? `${drawerBill.mileage} km` : '-' }}
              </n-descriptions-item>
              <n-descriptions-item label="计划运费">¥{{ money(drawerBill.plan_freight) }}</n-descriptions-item>
              <n-descriptions-item label="实际运费">¥{{ money(drawerBill.actual_freight) }}</n-descriptions-item>
              <n-descriptions-item label="任务状态">
                <StatusTag type="task" :value="drawerBill.task_status ?? null" />
              </n-descriptions-item>
              <n-descriptions-item label="对账状态">
                <StatusTag type="reconcile" :value="drawerBill.reconcile_status" />
              </n-descriptions-item>
              <n-descriptions-item label="到达时间">
                {{ datetime(drawerBill.create_time) }}
                <span class="freight-muted">（到达时生成）</span>
              </n-descriptions-item>
              <n-descriptions-item label="完结时间">{{ datetime(drawerBill.finish_time) }}</n-descriptions-item>
              <n-descriptions-item label="对账时间">{{ datetime(drawerBill.reconcile_time) }}</n-descriptions-item>
              <n-descriptions-item label="对账人">{{ drawerBill.reconciler || '-' }}</n-descriptions-item>
            </DetailSection>

            <div class="freight-section">
              <div class="freight-section__header">
                <span class="stp-section-title">调整记录</span>
                <span class="freight-muted">共 {{ adjustLogs.length }} 条（每次修改运费留痕）</span>
              </div>
              <n-data-table
                v-if="adjustLogs.length"
                size="small"
                :columns="adjustColumns"
                :data="adjustLogs"
                :row-key="adjustRowKey"
                :bordered="false"
                :single-line="false"
                :scroll-x="620"
              />
              <n-empty v-else description="暂无调整记录（未修改过运费）" style="padding: 16px 0" />
            </div>
          </template>
          <div v-else class="freight-drawer-skeleton">
            <n-skeleton text width="40%" />
            <n-skeleton text :repeat="6" />
          </div>
        </n-spin>
        <template v-if="drawerBill && isPending(drawerBill)" #footer>
          <div class="freight-drawer__footer">
            <n-button @click="drawerAdjust">修改运费</n-button>
            <n-button type="primary" @click="drawerReconcile">确认对账</n-button>
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>

    <!-- 修改运费弹窗（仅待对账可改） -->
    <n-modal
      v-model:show="showAdjustModal"
      preset="card"
      size="huge"
      class="form-modal"
      :title="`修改运费 · ${adjustTarget?.freight_no ?? ''}`"
      :bordered="false"
      :style="{ width: '600px', maxWidth: '94vw' }"
      :mask-closable="false"
    >
      <n-alert type="warning" :show-icon="false" class="freight-adjust__alert">
        当前实际运费：<b>¥{{ money(adjustTarget?.actual_freight) }}</b
        >。确认修改后将写入一条调整记录（原金额 → 新金额），仅「待对账」运费单可修改。
      </n-alert>
      <n-form
        ref="adjustFormRef"
        :model="adjustForm"
        :rules="adjustRules"
        label-placement="left"
        label-width="100"
        require-mark-placement="left"
      >
        <n-form-item label="新实际运费" path="amount">
          <n-input-number
            v-model:value="adjustForm.amount"
            :min="0"
            :precision="2"
            placeholder="请输入新实际运费（元）"
            class="freight-adjust__num"
          >
            <template #prefix>¥</template>
          </n-input-number>
        </n-form-item>
        <n-form-item label="调整原因" path="reason">
          <n-input
            v-model:value="adjustForm.reason"
            type="textarea"
            :rows="3"
            maxlength="255"
            show-count
            placeholder="请填写调整原因（必填，如：里程修正、桥费补收）"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button type="primary" :loading="adjustSubmitting" @click="submitAdjust">确认修改</n-button>
          <n-button :disabled="adjustSubmitting" @click="showAdjustModal = false">取消</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 确认对账 -->
    <ConfirmAction
      v-model:show="showReconcileConfirm"
      title="确认对账"
      :content="`确认与承运商完成运费单 ${reconcileTarget?.freight_no ?? ''} 的对账？对账后该运费单不可再修改运费。`"
      confirm-text="确认对账"
      :loading="reconcileSubmitting"
      :auto-close="false"
      @confirm="submitReconcile"
    />
  </div>
</template>

<style scoped>
.freight .table-summary {
  flex: 1;
  min-width: 0;
}

.table-summary b {
  color: #2d3033;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.table-summary b.freight-summary__actual {
  color: #f0a020;
}

.freight-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 0;
  color: #d03050;
  font-size: 14px;
}

.freight-error--drawer {
  justify-content: flex-start;
  padding: 12px 0;
}

.freight-muted {
  color: #999999;
  font-size: 12px;
}

.freight-section {
  margin-top: 4px;
}

.freight-section__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.freight-section__header .stp-section-title {
  margin-bottom: 0;
}

:deep(.freight-adjust-cell) {
  color: #f0a020;
  font-weight: 600;
}

.freight-drawer-skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.freight-drawer__footer {
  display: flex;
  justify-content: flex-end;
  gap: 20px;
}

.freight-adjust__alert {
  margin-bottom: 14px;
}

.freight-adjust__num {
  width: 100%;
}

:deep(.freight-adjusted) {
  color: #f0a020;
  font-weight: 600;
}
</style>
