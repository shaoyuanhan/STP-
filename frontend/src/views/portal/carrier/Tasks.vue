<script setup lang="ts">
/**
 * 承运商 - 运输任务列表
 * 服务端分页 + 状态/关键字筛选；待接单任务可直接指派司机
 */
import { computed, h, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { DataTableColumns, SelectOption } from 'naive-ui'
import { NButton } from 'naive-ui'
import { useMessage } from 'naive-ui'
import StatusBadge from '@/components/portal/StatusBadge.vue'
import QueryBar from '@/components/QueryBar.vue'
import QueryField from '@/components/QueryField.vue'
import AssignDriverModal from '@/components/portal/AssignDriverModal.vue'
import TaskDetailDrawer from './TaskDetailDrawer.vue'
import { fetchCarrierTasks } from '@/services/portal'
import type { PortalTask } from '@/services/portal'
import { dateOnly } from '@/utils/format'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const message = useMessage()
const session = useSessionStore()
/** 平台账号能看到所有承运商的任务，需要承运商列 */
const showCarrier = computed(() => !String(session.user.role ?? '').startsWith('CARRIER'))

const loading = ref(false)
const list = ref<PortalTask[]>([])
const total = ref(0)

const query = reactive({
  status: typeof route.query.status === 'string' ? route.query.status : '',
  task_no: '',
  order_no: '',
  apply_no: '',
  vin: '',
  customer_name: '',
  keyword: '',
  page: 1,
  size: 10,
})

// 筛选区收起/展开：收起时仅显示首行高频字段，已填值不丢失
const filterExpanded = ref(false)

const statusOptions: SelectOption[] = [
  { label: '全部状态', value: '' },
  { label: '待接单', value: 'DISPATCHED' },
  { label: '待提车', value: 'CARRIER_ACCEPTED' },
  { label: '已提车', value: 'PICKED' },
  { label: '在途', value: 'IN_TRANSIT' },
  { label: '待结单', value: 'ARRIVED' },
  { label: '已完结', value: 'FINISHED' },
  { label: '已取消', value: 'CANCELLED' },
]

const assign = reactive({
  show: false,
  task: null as PortalTask | null,
})

async function load() {
  loading.value = true
  try {
    const res = await fetchCarrierTasks({
      page: query.page,
      size: query.size,
      status: query.status || undefined,
      task_no: query.task_no.trim() || undefined,
      order_no: query.order_no.trim() || undefined,
      apply_no: query.apply_no.trim() || undefined,
      vin: query.vin.trim() || undefined,
      customer_name: query.customer_name.trim() || undefined,
      keyword: query.keyword.trim() || undefined,
    })
    list.value = res.list
    total.value = res.total
  } catch (e) {
    message.error(e instanceof Error ? e.message : '任务加载失败')
  } finally {
    loading.value = false
  }
}

function search() {
  query.page = 1
  load()
}

function reset() {
  query.status = ''
  query.task_no = ''
  query.order_no = ''
  query.apply_no = ''
  query.vin = ''
  query.customer_name = ''
  query.keyword = ''
  query.page = 1
  load()
}

function openAssign(task: PortalTask) {
  assign.task = task
  assign.show = true
}

function onAssigned() {
  load()
}

const detailState = reactive({
  show: false,
  id: null as number | null,
})

function openDetail(row: PortalTask) {
  detailState.id = row.id
  detailState.show = true
}

const baseColumns: DataTableColumns<PortalTask> = [
  {
    title: '序号',
    key: '__index',
    width: 60,
    align: 'center',
    fixed: 'left',
    render: (_row, index) => (query.page - 1) * query.size + index + 1,
  },
  {
    title: '任务单号',
    key: 'task_no',
    width: 150,
    resizable: true,
    render: (row) =>
      h(
        'a',
        {
          class: 'link',
          onClick: () => openDetail(row),
        },
        row.task_no
      ),
  },
  { title: '订单号', key: 'order_no', width: 150, resizable: true, render: (row) => row.order_no || '-' },
  { title: '发运申请号', key: 'apply_no', width: 150, resizable: true, render: (row) => row.apply_no || '-' },
  { title: '客户', key: 'customer_name', width: 140, resizable: true, ellipsis: { tooltip: true } },
  {
    title: '运输路线',
    key: 'route',
    width: 260,
    resizable: true,
    ellipsis: { tooltip: true },
    render: (row) =>
      h('span', { class: 'route' }, `${row.ship_location || '-'} → ${row.delivery_area || '-'}`),
  },
  {
    title: '车辆',
    key: 'vins',
    width: 170,
    resizable: true,
    ellipsis: { tooltip: true },
    render: (row) => row.vins || '-',
  },
  {
    title: '计划运费',
    key: 'plan_freight',
    width: 110,
    resizable: true,
    align: 'right',
    render: (row) => (row.plan_freight == null ? '-' : `¥ ${Number(row.plan_freight).toFixed(2)}`),
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    resizable: true,
    render: (row) => h(StatusBadge, { status: row.status, size: 'small' }),
  },
  {
    title: '司机',
    key: 'driver_name',
    width: 110,
    resizable: true,
    render: (row) => (row.driver_name ? `${row.driver_name}` : '待指派'),
  },
  {
    title: '计划提车日期',
    key: 'plan_pickup_date',
    width: 120,
    resizable: true,
    render: (row) => dateOnly(row.plan_pickup_date),
  },
  {
    title: '操作',
    key: 'actions',
    width: 130,
    fixed: 'right',
    render: (row) =>
      h('div', { class: 'actions' }, [
        h(
          NButton,
          { size: 'small', quaternary: true, type: 'primary', onClick: () => openDetail(row) },
          { default: () => '详情' }
        ),
        row.status === 'DISPATCHED'
          ? h(
              NButton,
              { size: 'small', quaternary: true, type: 'primary', onClick: () => openAssign(row) },
              { default: () => '接单指派' }
            )
          : null,
      ]),
  },
]

const columns = computed<DataTableColumns<PortalTask>>(() => {
  if (!showCarrier.value) return baseColumns
  const carrierColumn: DataTableColumns<PortalTask>[number] = {
    title: '承运商',
    key: 'carrier_name',
    width: 170,
    resizable: true,
    ellipsis: { tooltip: true },
    render: (row) => row.carrier_name || '-',
  }
  return [baseColumns[0], carrierColumn, ...baseColumns.slice(1)]
})

onMounted(load)
</script>

<template>
  <div class="stp-page">
    <!-- 筛选栏 -->
    <n-card class="query-card" :bordered="false">
      <QueryBar>
        <QueryField label="任务号">
          <n-input
            v-model:value="query.task_no"
            placeholder="请输入任务单号"
            clearable
            @keydown.enter="search"
          />
        </QueryField>
        <QueryField label="状态">
          <n-select
            v-model:value="query.status"
            :options="statusOptions"
            placeholder="请选择状态"
            clearable
          />
        </QueryField>
        <QueryField label="VIN">
          <n-input
            v-model:value="query.vin"
            placeholder="请输入车架号"
            clearable
            @keydown.enter="search"
          />
        </QueryField>
        <QueryField label="客户名称">
          <n-input
            v-model:value="query.customer_name"
            placeholder="请输入客户名称"
            clearable
            @keydown.enter="search"
          />
        </QueryField>
        <QueryField v-show="filterExpanded" label="订单号">
          <n-input
            v-model:value="query.order_no"
            placeholder="请输入订单号"
            clearable
            @keydown.enter="search"
          />
        </QueryField>
        <QueryField v-show="filterExpanded" label="发运申请号">
          <n-input
            v-model:value="query.apply_no"
            placeholder="请输入发运申请号"
            clearable
            @keydown.enter="search"
          />
        </QueryField>
        <template #actions>
          <n-button quaternary class="page-card__toggle" @click="filterExpanded = !filterExpanded">
            {{ filterExpanded ? '收起' : '展开' }}
            <span class="page-card__caret" :class="{ 'is-open': filterExpanded }">▾</span>
          </n-button>
          <n-button @click="reset">重置</n-button>
          <n-button type="primary" @click="search">查询</n-button>
        </template>
      </QueryBar>
    </n-card>

    <!-- 列表 -->
    <n-card class="table-card" :bordered="false">
      <div class="table-toolbar">
        <span class="table-toolbar__hint">
          共 {{ total }} 条任务，{{ showCarrier ? '展示权限范围内的全部承运商' : '仅展示本承运商数据' }}
        </span>
      </div>
      <n-data-table
        remote
        :columns="columns"
        :data="list"
        :loading="loading"
        :row-key="(row: PortalTask) => row.id"
        :bordered="false"
        :scroll-x="1820"
        size="small"
      />
      <div class="page-pager">
        <n-pagination
          v-model:page="query.page"
          v-model:page-size="query.size"
          :item-count="total"
          :page-sizes="[10, 20, 50, 100]"
          show-size-picker
          show-quick-jumper
          :suffix="() => `总数 ${total}`"
          @update:page="load"
          @update:page-size="() => { query.page = 1; load() }"
        />
      </div>
    </n-card>

    <AssignDriverModal
      v-model:show="assign.show"
      :task-id="assign.task?.id ?? null"
      :task-no="assign.task?.task_no"
      :version="assign.task?.version"
      :carrier-id="assign.task?.carrier_id"
      @assigned="onAssigned"
    />

    <TaskDetailDrawer v-model:show="detailState.show" :task-id="detailState.id" @changed="load" />
  </div>
</template>

<style scoped>
.page-card__caret {
  display: inline-block;
  margin-left: 2px;
  font-size: 12px;
  transition: transform 0.2s ease;
}
.page-card__caret.is-open {
  transform: rotate(180deg);
}
.page-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
  padding: 0 15px;
}
:deep(.link) {
  color: #1890ff;
  cursor: pointer;
  text-decoration: none;
}
:deep(.link:hover) {
  text-decoration: underline;
}
:deep(.route) {
  color: #666666;
}
:deep(.actions) {
  display: flex;
  gap: 8px;
}
</style>
