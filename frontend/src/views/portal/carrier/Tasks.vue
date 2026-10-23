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
import AssignDriverModal from '@/components/portal/AssignDriverModal.vue'
import TaskDetailDrawer from './TaskDetailDrawer.vue'
import { fetchCarrierTasks } from '@/services/portal'
import type { PortalTask } from '@/services/portal'
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
  keyword: '',
  page: 1,
  size: 10,
})

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
  { title: '计划提车', key: 'plan_pickup_date', width: 120, resizable: true, render: (row) => row.plan_pickup_date || '-' },
  {
    title: '操作',
    key: 'actions',
    width: 130,
    fixed: 'right',
    render: (row) =>
      h('div', { class: 'actions' }, [
        h(
          NButton,
          { size: 'tiny', quaternary: true, type: 'primary', onClick: () => openDetail(row) },
          { default: () => '详情' }
        ),
        row.status === 'DISPATCHED'
          ? h(
              NButton,
              { size: 'tiny', type: 'primary', onClick: () => openAssign(row) },
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
    <n-card class="page-card" :bordered="false">
      <div class="page-card__filters">
        <div class="page-card__field">
          <span class="page-card__label">关键字</span>
          <n-input
            v-model:value="query.keyword"
            class="page-card__input"
            placeholder="任务号 / 客户 / VIN"
            clearable
            @keydown.enter="search"
          />
        </div>
        <div class="page-card__field">
          <span class="page-card__label">状态</span>
          <n-select
            v-model:value="query.status"
            class="page-card__select"
            :options="statusOptions"
            placeholder="全部状态"
          />
        </div>
        <div class="page-card__actions">
          <n-button @click="reset">重置</n-button>
          <n-button type="primary" @click="search">查询</n-button>
        </div>
      </div>
    </n-card>

    <!-- 工具栏 -->
    <div class="page-toolbar">
      <span class="page-toolbar__hint">
        共 {{ total }} 条任务，{{ showCarrier ? '展示权限范围内的全部承运商' : '仅展示本承运商数据' }}
      </span>
    </div>

    <!-- 列表 -->
    <n-card class="page-card" :bordered="false">
      <n-data-table
        remote
        :columns="columns"
        :data="list"
        :loading="loading"
        :row-key="(row: PortalTask) => row.id"
        :bordered="false"
        :single-line="false"
        :scroll-x="1460"
        size="small"
      />
      <div class="page-pager">
        <n-pagination
          v-model:page="query.page"
          v-model:page-size="query.size"
          :item-count="total"
          :page-sizes="[10, 20, 50]"
          show-size-picker
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
.page-card {
  margin-bottom: 12px;
}
.page-card__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 18px;
}
.page-card__field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.page-card__label {
  font-size: 13px;
  color: #595959;
  white-space: nowrap;
}
.page-card__input {
  width: 220px;
}
.page-card__select {
  width: 150px;
}
.page-card__actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
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
.page-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
:deep(.link) {
  color: #1677ff;
  cursor: pointer;
  text-decoration: none;
}
:deep(.link:hover) {
  text-decoration: underline;
}
:deep(.route) {
  color: #595959;
}
:deep(.actions) {
  display: flex;
  gap: 6px;
}
</style>
