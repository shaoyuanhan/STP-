<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue'
import type { DataTableColumns } from 'naive-ui'
import { NButton, NTag } from 'naive-ui'
import PageTable from '@/components/PageTable.vue'
import QueryBar from '@/components/QueryBar.vue'
import QueryField from '@/components/QueryField.vue'
import DetailSection from '@/components/DetailSection.vue'
import { getOperationLog, listOperationLogs, listOperationOperators } from '@/services/operationLogs'
import type { OperationLog, OperationLogOperator, OperationLogQuery } from '@/types/api'
import { datetime } from '@/utils/format'

interface PageTableHandle {
  refresh: () => Promise<void>
}

type AppliedQuery = OperationLogQuery & { _t: number }

const BUSINESS_LABELS: Record<string, string> = {
  FACTORY: '工厂',
  CARRIER: '承运商',
  DRIVER: '司机',
  SHIPPING_TASK: '发运任务',
  FREIGHT_BILL: '运费单',
  ESIGN: '电子签',
  ACCOUNT: '账号',
  ROLE: '角色',
  FILE: '文件',
  SYSTEM: '系统',
}

const OPERATION_LABELS: Record<string, string> = {
  INSERT: '新增',
  UPDATE: '编辑',
  DELETE: '删除',
  STATUS: '状态变更',
  IMPORT: '导入',
  EXPORT: '导出',
  DISPATCH: '派单',
  BATCH_DISPATCH: '批量派单',
  CANCEL_DISPATCH: '取消派单',
  REASSIGN: '改派',
  ACCEPT: '接单',
  CANCEL_ACCEPT: '取消接单',
  CANCEL: '取消',
  PICKUP: '确认提车',
  ARRIVE: '确认到达',
  FINISH: '结单',
  RECONCILE: '对账',
  PERMISSION_UPDATE: '配置权限',
  DATA_SCOPE_UPDATE: '配置数据权限',
  READ: '标记已读',
  RECEIVE: '接收',
  SYNC: '同步',
  RECEIPT_SYNC: '同步回单',
  SIGN_STATUS: '同步签署状态',
  TRACKING: '同步轨迹',
  UPLOAD: '上传',
  OTHER: '其他',
}

const businessOptions = Object.entries(BUSINESS_LABELS).map(([value, label]) => ({ value, label }))
const operationOptions = Object.entries(OPERATION_LABELS).map(([value, label]) => ({ value, label }))
const resultOptions = [
  { value: 'SUCCESS', label: '成功' },
  { value: 'FAIL', label: '失败' },
]

const tableRef = ref<PageTableHandle | null>(null)
const showAdvanced = ref(false)
const operatorRows = ref<OperationLogOperator[]>([])
const filters = reactive({
  operator_name: null as string | null,
  operator_id: '',
  business_type: null as string | null,
  operation_type: null as string | null,
  business_id: '',
  result_status: null as string | null,
  range: null as [number, number] | null,
  keyword: '',
})
const applied = ref<AppliedQuery>({ _t: 0 })

const operatorOptions = computed(() => {
  const options = new Map<string, { label: string; value: string }>()
  operatorRows.value.forEach((row) => {
    if (!options.has(row.operator_name)) {
      options.set(row.operator_name, {
        label: row.operator_id ? `${row.operator_name}（ID ${row.operator_id}）` : row.operator_name,
        value: row.operator_name,
      })
    }
  })
  return [...options.values()]
})

const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<OperationLog | null>(null)

function businessLabel(value?: string | null) {
  return value ? BUSINESS_LABELS[value] || value : '-'
}

function operationLabel(value?: string | null) {
  return value ? OPERATION_LABELS[value] || value : '-'
}

function businessNo(row: OperationLog) {
  return row.business_no || row.business_id || '-'
}

function resultTag(value?: string | null) {
  const success = value === 'SUCCESS'
  return h(NTag, { size: 'small', type: success ? 'success' : 'error', bordered: false }, {
    default: () => success ? '成功' : '失败',
  })
}

function methodTag(value?: string | null) {
  const type = value === 'GET' ? 'default' : value === 'DELETE' ? 'error' : 'info'
  return h(NTag, { size: 'small', type, bordered: false }, { default: () => value || '-' })
}

function localDateTime(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function buildQuery(): OperationLogQuery {
  return {
    operator_name: filters.operator_name,
    operator_id: filters.operator_id.trim(),
    business_type: filters.business_type,
    operation_type: filters.operation_type,
    business_id: filters.business_id.trim(),
    result_status: filters.result_status,
    start_time: filters.range ? localDateTime(filters.range[0]) : '',
    end_time: filters.range ? localDateTime(filters.range[1]) : '',
    keyword: filters.keyword.trim(),
  }
}

function search() {
  applied.value = { ...buildQuery(), _t: Date.now() }
}

function reset() {
  Object.assign(filters, {
    operator_name: null,
    operator_id: '',
    business_type: null,
    operation_type: null,
    business_id: '',
    result_status: null,
    range: null,
    keyword: '',
    })
  search()
}

async function openDetail(row: OperationLog) {
  detailOpen.value = true
  detailLoading.value = true
  detail.value = row
  try {
    detail.value = await getOperationLog(row.id)
  } finally {
    detailLoading.value = false
  }
}

function prettyJson(value?: string | null) {
  if (!value) return '-'
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

const columns: DataTableColumns<OperationLog> = [
  {
    title: '操作时间',
    key: 'operator_time',
    width: 175,
    fixed: 'left',
    render: (row) => datetime(row.operator_time),
  },
  {
    title: '操作内容',
    key: 'operation_desc',
    width: 190,
    ellipsis: { tooltip: true },
    render: (row) => row.operation_desc || '-',
  },
  {
    title: '业务类型',
    key: 'business_type',
    width: 115,
    render: (row) => businessLabel(row.business_type),
  },
  {
    title: '业务单号',
    key: 'business_id',
    width: 165,
    ellipsis: { tooltip: true },
    render: (row) => businessNo(row),
  },
  {
    title: '操作类型',
    key: 'operation_type',
    width: 125,
    render: (row) => operationLabel(row.operation_type),
  },
  {
    title: '操作人',
    key: 'operator_name',
    width: 150,
    render: (row) => h('div', { class: 'operator-cell' }, [
      h('span', row.operator_name || '-'),
      row.operator_id ? h('small', `ID ${row.operator_id}`) : null,
    ]),
  },
  {
    title: '操作结果',
    key: 'result_status',
    width: 95,
    align: 'center',
    render: (row) => resultTag(row.result_status),
  },
  {
    title: '请求方式',
    key: 'request_method',
    width: 100,
    align: 'center',
    render: (row) => methodTag(row.request_method),
  },
  {
    title: '请求接口',
    key: 'request_url',
    width: 260,
    ellipsis: { tooltip: true },
    render: (row) => row.request_url || '-',
  },
  {
    title: '耗时',
    key: 'duration',
    width: 90,
    align: 'right',
    render: (row) => row.duration === null || row.duration === undefined ? '-' : `${row.duration} ms`,
  },
  {
    title: '操作',
    key: '__actions',
    width: 70,
    fixed: 'right',
    render: (row) => h(NButton, {
      text: true,
      type: 'primary',
      size: 'tiny',
      onClick: () => openDetail(row),
    }, { default: () => '详情' }),
  },
]

onMounted(() => {
  listOperationOperators().then((rows) => { operatorRows.value = rows }).catch(() => {})
})
</script>

<template>
  <div class="logs-page">
    <n-alert class="log-notice" type="info" :bordered="false">
      输入发运单号等业务单号后，列表逐条展示每个环节的操作时间、操作内容、操作人和操作结果。
    </n-alert>

    <QueryBar>
      <QueryField label="业务单号">
        <n-input v-model:value="filters.business_id" clearable placeholder="请输入发运单号 / 业务单号" @keyup.enter="search" />
      </QueryField>
      <QueryField label="操作人">
        <n-select
          v-model:value="filters.operator_name"
          :options="operatorOptions"
          clearable
          filterable
          placeholder="请选择或输入操作人"
          @keyup.enter="search"
        />
      </QueryField>
      <QueryField label="业务类型">
        <n-select v-model:value="filters.business_type" :options="businessOptions" clearable placeholder="全部业务类型" />
      </QueryField>
      <QueryField label="操作类型">
        <n-select v-model:value="filters.operation_type" :options="operationOptions" clearable filterable placeholder="全部操作类型" />
      </QueryField>
      <QueryField label="操作结果">
        <n-select v-model:value="filters.result_status" :options="resultOptions" clearable placeholder="全部结果" />
      </QueryField>
      <QueryField label="操作人 ID">
        <n-input v-model:value="filters.operator_id" clearable placeholder="请输入操作人 ID" @keyup.enter="search" />
      </QueryField>
      <QueryField label="操作时间" wide>
        <n-date-picker
          v-model:value="filters.range"
          type="datetimerange"
          clearable
          start-placeholder="开始时间"
          end-placeholder="结束时间"
        />
      </QueryField>
      <template v-if="showAdvanced">
        <QueryField label="关键字">
          <n-input v-model:value="filters.keyword" clearable placeholder="操作内容、接口或错误信息" @keyup.enter="search" />
        </QueryField>
      </template>
      <template #actions>
        <n-button text type="primary" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? '收起 ▴' : '展开 ▾' }}
        </n-button>
        <n-button @click="reset">重置</n-button>
        <n-button type="primary" @click="search">查询</n-button>
      </template>
    </QueryBar>

    <n-divider />

    <PageTable
      ref="tableRef"
      :columns="columns"
      :remote="({ page, pageSize }) => {
        const { _t, ...query } = applied
        return listOperationLogs({ ...query, page, size: pageSize })
      }"
      :query="applied"
      :scroll-x="1750"
      :init-page-size="20"
    />

    <n-drawer v-model:show="detailOpen" :width="760" placement="right">
      <n-drawer-content :native-scrollbar="false" closable>
        <template #header>操作日志详情</template>
        <n-spin :show="detailLoading">
          <template v-if="detail">
            <DetailSection title="操作信息" :column="2">
              <n-descriptions-item label="操作内容">{{ detail.operation_desc || '-' }}</n-descriptions-item>
              <n-descriptions-item label="操作结果">
                <n-tag :type="detail.result_status === 'SUCCESS' ? 'success' : 'error'" size="small" :bordered="false">
                  {{ detail.result_status === 'SUCCESS' ? '成功' : '失败' }}
                </n-tag>
              </n-descriptions-item>
              <n-descriptions-item label="操作人">{{ detail.operator_name || '-' }}</n-descriptions-item>
              <n-descriptions-item label="操作人 ID">{{ detail.operator_id || '-' }}</n-descriptions-item>
              <n-descriptions-item label="业务类型">{{ businessLabel(detail.business_type) }}</n-descriptions-item>
              <n-descriptions-item label="业务单号">{{ businessNo(detail) }}</n-descriptions-item>
              <n-descriptions-item label="操作时间">{{ datetime(detail.operator_time) }}</n-descriptions-item>
              <n-descriptions-item label="执行耗时">{{ detail.duration ?? '-' }} ms</n-descriptions-item>
              <n-descriptions-item label="请求方式">{{ detail.request_method || '-' }}</n-descriptions-item>
              <n-descriptions-item label="请求接口" :span="2">{{ detail.request_url || '-' }}</n-descriptions-item>
              <n-descriptions-item v-if="detail.error_message" label="失败原因" :span="2">
                <span class="error-text">{{ detail.error_message }}</span>
              </n-descriptions-item>
              <n-descriptions-item v-if="detail.remark" label="结果说明" :span="2">{{ detail.remark }}</n-descriptions-item>
            </DetailSection>

            <section v-if="detail.request_params" class="payload-section">
              <h3>请求参数</h3>
              <pre>{{ prettyJson(detail.request_params) }}</pre>
            </section>
            <section v-if="detail.before_data" class="payload-section">
              <h3>操作前数据</h3>
              <pre>{{ prettyJson(detail.before_data) }}</pre>
            </section>
            <section v-if="detail.after_data" class="payload-section">
              <h3>操作后数据</h3>
              <pre>{{ prettyJson(detail.after_data) }}</pre>
            </section>
          </template>
        </n-spin>
      </n-drawer-content>
    </n-drawer>

  </div>
</template>

<style scoped>
.logs-page {
  padding: 16px;
  background: #ffffff;
}

.log-notice {
  margin-bottom: 16px;
}

.operator-cell {
  display: flex;
  flex-direction: column;
  line-height: 20px;
}

.operator-cell small {
  color: #999999;
}

.error-text {
  color: #d03050;
}

.payload-section {
  margin-bottom: 20px;
}

.payload-section h3 {
  margin: 0 0 10px;
  color: #2d3033;
  font-size: 14px;
}

.payload-section pre {
  max-height: 320px;
  margin: 0;
  padding: 14px;
  overflow: auto;
  border: 1px solid #e8eaee;
  border-radius: 6px;
  background: #f7f8fa;
  color: #374151;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
