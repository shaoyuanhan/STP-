<script setup lang="ts">
/**
 * 运输调度 - 发运任务（契约 5.4 / 既有需求 2/3/5/6）
 *
 * - 筛选：任务单号/订单号/发运申请号/VIN/客户名称/状态（9 态）/承运商/创建日期区间
 * - 列表：交付地址完整展示、承运商司机合并列、计划提车/出库/发运/到达四列、操作竖排
 * - 行多选：仅「待派单」可勾选，选中后顶部「批量派单（N）」
 * - 派单/改派/取消派单携带列表行 version，D0001 冲突时提示并刷新列表
 */
import { computed, h, onActivated, onMounted, reactive, ref } from 'vue'
import type { DataTableColumns, SelectOption } from 'naive-ui'
import { NButton, NCheckbox } from 'naive-ui'
import { useMessage } from 'naive-ui'
import PageTable from '@/components/PageTable.vue'
import QueryBar from '@/components/QueryBar.vue'
import QueryField from '@/components/QueryField.vue'
import StatusTag from '@/components/StatusTag.vue'
import TaskDispatchModal from './TaskDispatchModal.vue'
import BatchDispatchModal from './BatchDispatchModal.vue'
import CancelDispatchModal from './CancelDispatchModal.vue'
import TaskDetailDrawer from './TaskDetailDrawer.vue'
import { splitVins } from './shared'
import { can } from '@/services/portal'
import { listCarriers } from '@/services/carriers'
import { exportShippingTasks, listShippingTasks } from '@/services/tasks'
import { useDictionaryStore } from '@/stores/dictionary'
import { dateOnly, dateShort, datetime } from '@/utils/format'
import type { ShippingTaskListItem, ShippingTaskQuery, TaskStatus } from '@/types/api'

/** PageTable 实例句柄 */
interface PageTableHandle {
  reload: () => Promise<void>
  refresh: () => Promise<void>
}

const message = useMessage()
const dictStore = useDictionaryStore()

onMounted(() => {
  // 字典预加载（状态下拉/StatusTag 兜底共用，失败不阻塞页面）
  dictStore.ensureLoaded().catch(() => {})
  loadCarrierOptions()
})

// keep-alive 页签切回时重新拉取承运商下拉（承运商页新增后回来自动可见）
onActivated(() => {
  loadCarrierOptions()
})

// ---------------- 承运商筛选下拉 ----------------
const carrierOptions = ref<SelectOption[]>([])

async function loadCarrierOptions() {
  try {
    const page = await listCarriers({ page: 1, size: 200 })
    carrierOptions.value = (page.list ?? []).map((c) => ({ label: c.carrier_name, value: c.id }))
  } catch {
    carrierOptions.value = []
  }
}

// ---------------- 筛选 ----------------
const filter = reactive({
  task_no: '',
  apply_no: '',
  order_no: '',
  vin: '',
  customer_name: '',
  status: null as TaskStatus | null,
  carrier_id: null as number | null,
  range: null as [string, string] | null, // 创建日期区间
})

// 筛选区收起/展开：收起时仅显示首行高频字段，已填值不丢失
const filterExpanded = ref(false)

const statusOptions = computed<SelectOption[]>(() =>
  dictStore.taskStatusOptions.map((o) => ({ label: o.label, value: o.value })),
)

/** 已应用的查询（_t 变化强制 PageTable 重新请求） */
type AppliedQuery = {
  task_no?: string
  apply_no?: string
  order_no?: string
  vin?: string
  customer_name?: string
  status?: TaskStatus
  carrier_id?: number
  start_date?: string
  end_date?: string
  _t: number
}
const applied = ref<AppliedQuery>({ _t: 0 })

function buildAppliedQuery(): AppliedQuery {
  return {
    task_no: filter.task_no.trim() || undefined,
    apply_no: filter.apply_no.trim() || undefined,
    order_no: filter.order_no.trim() || undefined,
    vin: filter.vin.trim() || undefined,
    customer_name: filter.customer_name.trim() || undefined,
    status: filter.status ?? undefined,
    carrier_id: filter.carrier_id ?? undefined,
    start_date: filter.range?.[0],
    end_date: filter.range?.[1],
    _t: Date.now(),
  }
}

function handleSearch() {
  applied.value = buildAppliedQuery()
}

function handleReset() {
  filter.task_no = ''
  filter.apply_no = ''
  filter.order_no = ''
  filter.vin = ''
  filter.customer_name = ''
  filter.status = null
  filter.carrier_id = null
  filter.range = null
  applied.value = buildAppliedQuery()
}

// ---------------- 导出（当前筛选条件下的全量数据） ----------------
const exporting = ref(false)

async function handleExport() {
  if (exporting.value) return
  exporting.value = true
  try {
    const query = { ...applied.value } as Record<string, unknown>
    delete query._t
    const filename = await exportShippingTasks(query as ShippingTaskQuery)
    message.success(`已导出：${filename}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出失败，请稍后重试')
  } finally {
    exporting.value = false
  }
}

// ---------------- 列表 ----------------
const tableRef = ref<PageTableHandle | null>(null)
const currentRows = ref<ShippingTaskListItem[]>([])
const checkedKeys = ref<number[]>([])

async function fetchTasks({ page, pageSize }: { page: number; pageSize: number }) {
  const q = applied.value
  const result = await listShippingTasks({
    page,
    size: pageSize,
    task_no: q.task_no,
    apply_no: q.apply_no,
    vin: q.vin,
    customer_name: q.customer_name,
    status: q.status,
    carrier_id: q.carrier_id,
    start_date: q.start_date,
    end_date: q.end_date,
  })
  currentRows.value = result.list ?? []
  // 翻页/筛选后清空勾选（批量派单只作用于当前页快照）
  checkedKeys.value = []
  return { list: currentRows.value, total: result.total ?? 0 }
}

// ---------------- 行多选（仅待派单可勾选） ----------------
const selectableRows = computed(() => currentRows.value.filter((r) => r.status === 'WAIT_DISPATCH'))
const checkedSelectable = computed(() =>
  selectableRows.value.filter((r) => checkedKeys.value.includes(r.id)),
)
const allSelected = computed(
  () => selectableRows.value.length > 0 && selectableRows.value.every((r) => checkedKeys.value.includes(r.id)),
)
const someSelected = computed(() => checkedKeys.value.length > 0 && !allSelected.value)

function toggleRow(id: number, checked: boolean) {
  if (checked) {
    if (!checkedKeys.value.includes(id)) checkedKeys.value = [...checkedKeys.value, id]
  } else {
    checkedKeys.value = checkedKeys.value.filter((k) => k !== id)
  }
}

function toggleAll(checked: boolean) {
  checkedKeys.value = checked ? selectableRows.value.map((r) => r.id) : []
}

// ---------------- 单元格渲染 ----------------
function renderVins(row: ShippingTaskListItem) {
  const list = splitVins(row.vins)
  if (!list.length) return h('span', { class: 'muted' }, '-')
  if (list.length === 1) return h('span', { title: list[0] }, list[0])
  return h('span', { title: list.join('、') }, [
    list[0],
    h('span', { class: 'muted' }, ` 等 ${list.length} 台`),
  ])
}

function renderCarrier(row: ShippingTaskListItem) {
  if (!row.carrier_name) return h('span', { class: 'muted' }, '-')
  return h('span', { title: row.carrier_name }, row.carrier_name)
}

function renderDriver(row: ShippingTaskListItem) {
  if (!row.carrier_name) return h('span', { class: 'muted' }, '-')
  if (!row.driver_name) return h('span', { class: 'muted' }, '司机待分配')
  return h('span', { title: row.driver_name }, row.driver_name)
}

function renderActions(row: ShippingTaskListItem) {
  const buttons = []
  if (row.status === 'WAIT_DISPATCH' && can('tasks:dispatch')) {
    buttons.push(
      h(NButton, { text: true, type: 'primary', onClick: () => openDispatch(row) }, { default: () => '派单' }),
    )
  }
  if (row.status === 'DISPATCHED' && can('tasks:reassign')) {
    buttons.push(
      h(NButton, { text: true, type: 'primary', onClick: () => openReassign(row) }, { default: () => '改派' }),
    )
  }
  if (row.status === 'DISPATCHED' && can('tasks:cancel')) {
    buttons.push(
      h(
        NButton,
        { text: true, type: 'error', onClick: () => openCancel(row) },
        { default: () => '取消派单' },
      ),
    )
  }
  buttons.push(
    h(NButton, { text: true, type: 'primary', onClick: () => openDetail(row) }, { default: () => '详情' }),
  )
  return h('div', { class: 'row-actions' }, buttons)
}

const columns = computed<DataTableColumns<ShippingTaskListItem>>(() => [
  {
    key: '__selection',
    width: 42,
    align: 'center',
    fixed: 'left',
    title: () =>
      h(
        'span',
        { title: '仅「待派单」状态的任务可勾选批量派单' },
        [
          h(NCheckbox, {
            checked: allSelected.value,
            indeterminate: someSelected.value,
            disabled: selectableRows.value.length === 0,
            'onUpdate:checked': (v: boolean) => toggleAll(v),
          }),
        ],
      ),
    render: (row) =>
      h(NCheckbox, {
        checked: checkedKeys.value.includes(row.id),
        disabled: row.status !== 'WAIT_DISPATCH',
        'onUpdate:checked': (v: boolean) => toggleRow(row.id, v),
      }),
  },
  {
    title: '任务单号',
    key: 'task_no',
    width: 150,
    fixed: 'left',
    render: (row) =>
      h(
        NButton,
        { text: true, type: 'primary', onClick: () => openDetail(row) },
        { default: () => row.task_no },
      ),
  },
  { title: '订单号', key: 'order_no', width: 150, render: (row) => row.order_no || '-' },
  { title: '发运申请号', key: 'apply_no', width: 150 },
  {
    title: '客户名称',
    key: 'customer_name',
    width: 150,
    ellipsis: { tooltip: true },
  },
  { title: 'VIN', key: 'vins', width: 160, render: (row) => renderVins(row) },
  {
    title: '发运地点',
    key: 'ship_location',
    width: 140,
    ellipsis: { tooltip: true },
    render: (row) => row.ship_location || '-',
  },
  {
    title: '交付地址',
    key: 'delivery_address',
    width: 200,
    render: (row) => h('span', { class: 'cell-wrap' }, row.delivery_address || '-'),
  },
  {
    title: '计划提车日期',
    key: 'plan_pickup_date',
    width: 108,
    render: (row) => (row.plan_pickup_date ? dateOnly(row.plan_pickup_date) : '-'),
  },
  {
    title: '发运时间',
    key: 'ship_time',
    width: 130,
    render: (row) => (row.ship_time ? datetime(row.ship_time) : '-'),
  },
  {
    title: '出库日期',
    key: 'outbound_date',
    width: 130,
    render: (row) => (row.outbound_date ? datetime(row.outbound_date) : '-'),
  },
  {
    title: '到达日期',
    key: 'arrive_time',
    width: 130,
    render: (row) => (row.arrive_time ? datetime(row.arrive_time) : '-'),
  },
  {
    title: '里程',
    key: 'mileage',
    width: 96,
    render: (row) =>
      row.mileage !== null && row.mileage !== undefined && row.mileage !== ''
        ? `${row.mileage} km`
        : '-',
  },
  {
    title: '承运商',
    key: 'carrier_name',
    width: 150,
    minWidth: 130,
    ellipsis: { tooltip: true },
    render: (row) => renderCarrier(row),
  },
  {
    title: '司机',
    key: 'driver_name',
    width: 100,
    render: (row) => renderDriver(row),
  },
  {
    title: '状态',
    key: 'status',
    width: 104,
    render: (row) => h(StatusTag, { type: 'task', value: row.status }),
  },
  {
    title: '创建时间',
    key: 'create_time',
    width: 92,
    render: (row) => dateShort(row.create_time),
  },
  {
    title: '操作',
    key: 'actions',
    width: 84,
    fixed: 'right',
    render: (row) => renderActions(row),
  },
])

// ---------------- 派单 / 改派 / 取消派单 / 详情 ----------------
const showDispatchModal = ref(false)
const dispatchMode = ref<'dispatch' | 'reassign'>('dispatch')
const dispatchTaskRow = ref<ShippingTaskListItem | null>(null)

function openDispatch(row: ShippingTaskListItem) {
  dispatchMode.value = 'dispatch'
  dispatchTaskRow.value = row
  showDispatchModal.value = true
}

function openReassign(row: ShippingTaskListItem) {
  dispatchMode.value = 'reassign'
  dispatchTaskRow.value = row
  showDispatchModal.value = true
}

const showCancelModal = ref(false)
const cancelTaskRow = ref<ShippingTaskListItem | null>(null)

function openCancel(row: ShippingTaskListItem) {
  cancelTaskRow.value = row
  showCancelModal.value = true
}

const showBatchModal = ref(false)

function openBatchDispatch() {
  if (!checkedSelectable.value.length) {
    message.warning('请先勾选「待派单」状态的任务')
    return
  }
  showBatchModal.value = true
}

const showDetailDrawer = ref(false)
const detailTaskId = ref<number | null>(null)

function openDetail(row: ShippingTaskListItem) {
  detailTaskId.value = row.id
  showDetailDrawer.value = true
}

/** 派单/取消/改派/批量派单完成或 D0001 冲突后：清空勾选并刷新列表 */
function refreshList() {
  checkedKeys.value = []
  tableRef.value?.refresh()
}
</script>

<template>
  <div class="stp-page">
    <!-- 筛选栏 -->
    <n-card class="page-card" :bordered="false">
      <QueryBar>
        <QueryField label="任务单号">
          <n-input v-model:value="filter.task_no" clearable placeholder="请输入" @keydown.enter="handleSearch" />
        </QueryField>
        <QueryField label="订单号">
          <n-input v-model:value="filter.order_no" clearable placeholder="请输入" @keydown.enter="handleSearch" />
        </QueryField>
        <QueryField label="发运申请号">
          <n-input v-model:value="filter.apply_no" clearable placeholder="请输入" @keydown.enter="handleSearch" />
        </QueryField>
        <QueryField label="VIN">
          <n-input v-model:value="filter.vin" clearable placeholder="请输入" @keydown.enter="handleSearch" />
        </QueryField>
        <QueryField label="客户名称">
          <n-input v-model:value="filter.customer_name" clearable placeholder="请输入" @keydown.enter="handleSearch" />
        </QueryField>
        <QueryField v-show="filterExpanded" label="状态">
          <n-select
            v-model:value="filter.status"
            clearable
            :options="statusOptions"
            placeholder="全部状态"
          />
        </QueryField>
        <QueryField v-show="filterExpanded" label="承运商">
          <n-select
            v-model:value="filter.carrier_id"
            clearable
            filterable
            :options="carrierOptions"
            placeholder="全部承运商"
          />
        </QueryField>
        <QueryField v-show="filterExpanded" label="创建日期" wide>
          <n-date-picker
            v-model:formatted-value="filter.range"
            type="daterange"
            value-format="yyyy-MM-dd"
            clearable
          />
        </QueryField>
        <template #actions>
          <n-button v-if="can('tasks:export')" :loading="exporting" @click="handleExport">导出</n-button>
          <n-button @click="handleReset">重置</n-button>
          <n-button type="primary" @click="handleSearch">查询</n-button>
          <n-button quaternary class="page-card__toggle" @click="filterExpanded = !filterExpanded">
            {{ filterExpanded ? '收起' : '展开' }}
            <span class="page-card__caret" :class="{ 'is-open': filterExpanded }">▾</span>
          </n-button>
        </template>
      </QueryBar>
    </n-card>

    <!-- 工具栏 -->
    <div class="page-toolbar">
      <span class="page-toolbar__hint">
        仅「待派单」状态可勾选批量派单；「已派单」可改派或取消派单（需司机未接单）
      </span>
      <n-button
        v-if="can('tasks:dispatch')"
        type="primary"
        :disabled="checkedSelectable.length === 0"
        @click="openBatchDispatch"
      >
        {{ checkedSelectable.length ? `批量派单（${checkedSelectable.length}）` : '批量派单' }}
      </n-button>
    </div>

    <!-- 列表 -->
    <n-card class="page-card" :bordered="false">
      <PageTable
        ref="tableRef"
        :columns="columns"
        :remote="fetchTasks"
        :query="applied"
        :scroll-x="2020"
        :init-page-size="20"
      />
    </n-card>

    <!-- 派单 / 改派弹窗 -->
    <TaskDispatchModal
      v-model:show="showDispatchModal"
      :mode="dispatchMode"
      :task="dispatchTaskRow"
      @success="refreshList"
      @conflict="refreshList"
    />

    <!-- 批量派单弹窗 -->
    <BatchDispatchModal
      v-model:show="showBatchModal"
      :tasks="checkedSelectable"
      @success="refreshList"
    />

    <!-- 取消派单弹窗 -->
    <CancelDispatchModal
      v-model:show="showCancelModal"
      :task="cancelTaskRow"
      @success="refreshList"
      @conflict="refreshList"
    />

    <!-- 任务详情抽屉 -->
    <TaskDetailDrawer v-model:show="showDetailDrawer" :task-id="detailTaskId" />
  </div>
</template>

<style scoped>
.page-card {
  margin-bottom: 12px;
}

.page-card__caret {
  display: inline-block;
  margin-left: 2px;
  font-size: 12px;
  transition: transform 0.2s ease;
}

.page-card__caret.is-open {
  transform: rotate(180deg);
}

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.page-toolbar__hint {
  font-size: 12px;
  color: #8c8c8c;
}

/* 列表单元格内元素（render 函数内无本组件 scopeId，需 :deep） */
:deep(.row-actions) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

:deep(.muted) {
  color: #bfbfbf;
}

/* 交付地址完整展示（换行） */
:deep(.cell-wrap) {
  display: block;
  white-space: normal;
  word-break: break-all;
  line-height: 1.5;
}
</style>
