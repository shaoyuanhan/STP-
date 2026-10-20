<script setup lang="ts">
/**
 * 电子签台账（契约 5.7 /api/esign-records，snake_case）
 *
 * - 筛选：电子签 ID / 任务单号 / VIN / 发运申请号 / 签署状态
 * - 列表：签 ID/任务单号/申请号/客户/VIN/签署类型/触发节点/签署方/
 *         发起时间/签署状态/签署时间/任务状态/操作
 * - 详情抽屉：完整台账信息（含审计字段）
 * - 模拟签署：仅「待签署」且已关联任务的记录可操作，
 *   调 POST /api/mock/esign/sign-task（applyNo 优先 / taskNo 兼容），
 *   签署后状态置 SIGNED 并回填签署时间
 */
import { computed, h, onActivated, onMounted, reactive, ref } from 'vue'
import { useMessage, NButton } from 'naive-ui'
import type { DataTableColumns, PaginationProps, SelectOption } from 'naive-ui'
import { listEsignRecords } from '@/services/esigns'
import type { EsignRow } from '@/services/esigns'
import { mockSignTask } from '@/services/external'
import type { EsignStatus } from '@/types/api'
import { datetime } from '@/utils/format'
import StatusTag from '@/components/StatusTag.vue'
import DetailSection from '@/components/DetailSection.vue'
import ConfirmAction from '@/components/ConfirmAction.vue'

const message = useMessage()

// ---- 筛选 ----
const filters = reactive({
  esign_id: '',
  task_no: '',
  vin: '',
  apply_no: '',
  sign_status: null as EsignStatus | null,
})

const signStatusOptions = computed<SelectOption[]>(() => [
  { label: '待签署', value: 'WAIT_SIGN' },
  { label: '已签署', value: 'SIGNED' },
  { label: '已取消', value: 'CANCELLED' },
])

// ---- 列表（手动分页） ----
const loading = ref(false)
const loadError = ref<string | null>(null)
const rows = ref<EsignRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)

/** 当前页待签署条数（提示条展示用） */
const waitSignCount = computed(
  () => rows.value.filter((row) => row.sign_status === 'WAIT_SIGN').length,
)

async function loadPage() {
  loading.value = true
  loadError.value = null
  try {
    const result = await listEsignRecords({
      page: page.value,
      size: pageSize.value,
      esign_id: filters.esign_id.trim() || undefined,
      task_no: filters.task_no.trim() || undefined,
      vin: filters.vin.trim() || undefined,
      apply_no: filters.apply_no.trim() || undefined,
      sign_status: filters.sign_status ?? undefined,
    })
    rows.value = result?.list ?? []
    total.value = result?.total ?? 0
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
  // 抽屉打开时同步最新行数据（如模拟签署后状态变化）
  if (selectedId.value !== null) {
    selectedRow.value = rows.value.find((row) => row.id === selectedId.value) ?? selectedRow.value
  }
}

function handleSearch() {
  page.value = 1
  loadPage()
}

function handleReset() {
  filters.esign_id = ''
  filters.task_no = ''
  filters.vin = ''
  filters.apply_no = ''
  filters.sign_status = null
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

/** 行 key（后端返回主键 id） */
function rowKey(row: EsignRow): number {
  return row.id ?? 0
}

const pagination = computed<PaginationProps>(() => ({
  page: page.value,
  pageSize: pageSize.value,
  itemCount: total.value,
  pageSizes: [10, 20, 50],
  showSizePicker: true,
  showQuickJumper: true,
  prefix: () => `共 ${total.value} 条`,
  onChange: handlePageChange,
  onUpdatePageSize: handlePageSizeChange,
}))

// ---- 详情抽屉 ----
const showDrawer = ref(false)
const selectedId = ref<number | null>(null)
const selectedRow = ref<EsignRow | null>(null)

function openDetail(row: EsignRow) {
  selectedId.value = row.id ?? null
  selectedRow.value = row
  showDrawer.value = true
}

// ---- 模拟签署（演示辅助：POST /api/mock/esign/sign-task） ----
const showSignConfirm = ref(false)
const signSubmitting = ref(false)
const signTarget = ref<EsignRow | null>(null)

/** 仅「待签署」且已关联任务的记录可模拟签署 */
function canSign(row: EsignRow): boolean {
  return row.sign_status === 'WAIT_SIGN' && !!row.task_no
}

function askSign(row: EsignRow) {
  if (!canSign(row)) {
    message.warning('仅「待签署」且已关联任务的电子签可模拟签署')
    return
  }
  signTarget.value = row
  showSignConfirm.value = true
}

async function submitSign() {
  const target = signTarget.value
  if (!target) return
  signSubmitting.value = true
  try {
    const result = (await mockSignTask({
      applyNo: target.apply_no || undefined,
      taskNo: target.task_no || undefined,
    })) as { esignId?: string; vin?: string; signStatus?: string }
    message.success(
      `模拟签署成功：${result?.esignId ?? target.esign_id}${
        result?.vin ? `（VIN：${result.vin}）` : ''
      }，状态已置为已签署`,
    )
    showSignConfirm.value = false
    await loadPage()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    signSubmitting.value = false
  }
}

const columns = computed<DataTableColumns<EsignRow>>(() => [
  { title: '电子签 ID', key: 'esign_id', width: 165, fixed: 'left', ellipsis: { tooltip: true } },
  {
    title: '任务单号',
    key: 'task_no',
    width: 155,
    ellipsis: { tooltip: true },
    render: (row) => row.task_no || '-',
  },
  {
    title: '发运申请号',
    key: 'apply_no',
    width: 145,
    ellipsis: { tooltip: true },
    render: (row) => row.apply_no || '-',
  },
  {
    title: '客户',
    key: 'customer_name',
    minWidth: 110,
    ellipsis: { tooltip: true },
    render: (row) => row.customer_name || '-',
  },
  { title: 'VIN', key: 'vin', width: 185, ellipsis: { tooltip: true } },
  {
    title: '签署类型',
    key: 'sign_type',
    width: 105,
    render: (row) => row.sign_type || '-',
  },
  {
    title: '触发节点',
    key: 'trigger_node',
    width: 105,
    render: (row) => row.trigger_node || '-',
  },
  {
    title: '签署方',
    key: 'sign_party',
    width: 100,
    render: (row) => row.sign_party || '-',
  },
  {
    title: '发起时间',
    key: 'initiate_time',
    width: 150,
    render: (row) => datetime(row.initiate_time),
  },
  {
    title: '签署状态',
    key: 'sign_status',
    width: 92,
    render: (row) => h(StatusTag, { type: 'esign', value: row.sign_status }),
  },
  {
    title: '签署时间',
    key: 'sign_time',
    width: 150,
    render: (row) => datetime(row.sign_time),
  },
  {
    title: '任务状态',
    key: 'task_status',
    width: 112,
    render: (row) =>
      row.task_status
        ? h(StatusTag, { type: 'task', value: row.task_status })
        : h('span', { class: 'esign-muted' }, '-'),
  },
  {
    title: '操作',
    key: 'actions',
    width: 155,
    fixed: 'right',
    render: (row) => {
      const buttons = [
        h(
          NButton,
          { size: 'tiny', quaternary: true, type: 'primary', onClick: () => openDetail(row) },
          { default: () => '详情' },
        ),
      ]
      if (canSign(row)) {
        buttons.push(
          h(
            NButton,
            { size: 'tiny', quaternary: true, type: 'success', onClick: () => askSign(row) },
            { default: () => '模拟签署' },
          ),
        )
      }
      return h('div', { class: 'esign-actions' }, buttons)
    },
  },
])

onMounted(loadPage)

// keep-alive 页签切回时刷新列表（签署状态可能已被模拟器更新）
onActivated(loadPage)
</script>

<template>
  <div class="esign">
    <!-- 筛选 -->
    <n-card size="small" :bordered="false" class="esign-card">
      <div class="esign-filter">
        <div class="esign-filter__field">
          <span class="esign-filter__label">电子签 ID</span>
          <n-input
            v-model:value="filters.esign_id"
            size="small"
            clearable
            placeholder="请输入电子签 ID"
            @keyup.enter="handleSearch"
          />
        </div>
        <div class="esign-filter__field">
          <span class="esign-filter__label">任务单号</span>
          <n-input
            v-model:value="filters.task_no"
            size="small"
            clearable
            placeholder="请输入任务单号（FY 开头）"
            @keyup.enter="handleSearch"
          />
        </div>
        <div class="esign-filter__field">
          <span class="esign-filter__label">VIN</span>
          <n-input
            v-model:value="filters.vin"
            size="small"
            clearable
            placeholder="请输入 17 位车架号"
            @keyup.enter="handleSearch"
          />
        </div>
        <div class="esign-filter__field">
          <span class="esign-filter__label">发运申请号</span>
          <n-input
            v-model:value="filters.apply_no"
            size="small"
            clearable
            placeholder="请输入发运申请号"
            @keyup.enter="handleSearch"
          />
        </div>
        <div class="esign-filter__field">
          <span class="esign-filter__label">签署状态</span>
          <n-select
            v-model:value="filters.sign_status"
            size="small"
            clearable
            placeholder="全部状态"
            :options="signStatusOptions"
          />
        </div>
        <div class="esign-filter__actions">
          <n-button size="small" @click="handleReset">重置</n-button>
          <n-button size="small" type="primary" :loading="loading" @click="handleSearch">查询</n-button>
        </div>
      </div>
    </n-card>

    <!-- 提示条 -->
    <div class="esign-summary">
      <span>共 {{ total }} 条记录</span>
      <span>当前页待签署：<b class="esign-summary__wait">{{ waitSignCount }}</b> 条</span>
      <span class="esign-summary__tip">
        电子签按 VIN + 发运申请号匹配任务；任务取消时关联待签署电子签自动置为已取消
      </span>
    </div>

    <!-- 列表 -->
    <n-card size="small" :bordered="false" class="esign-card">
      <n-data-table
        size="small"
        remote
        :columns="columns"
        :data="rows"
        :loading="loading"
        :pagination="pagination"
        :row-key="rowKey"
        :scroll-x="1720"
        :bordered="false"
      >
        <template #empty>
          <div v-if="loadError" class="esign-error">
            <span>{{ loadError }}</span>
            <n-button size="tiny" type="primary" quaternary @click="loadPage()">重试</n-button>
          </div>
          <n-empty v-else description="暂无电子签记录（CRM 发起物流电子签后自动生成）" />
        </template>
      </n-data-table>
    </n-card>

    <!-- 详情抽屉 -->
    <n-drawer v-model:show="showDrawer" :width="540" placement="right">
      <n-drawer-content :title="`电子签详情 · ${selectedRow?.esign_id ?? ''}`" closable>
        <template v-if="selectedRow">
          <DetailSection title="签署信息" :column="2">
            <n-descriptions-item label="电子签 ID">{{ selectedRow.esign_id }}</n-descriptions-item>
            <n-descriptions-item label="签署状态">
              <StatusTag type="esign" :value="selectedRow.sign_status" />
            </n-descriptions-item>
            <n-descriptions-item label="VIN" :span="2">{{ selectedRow.vin || '-' }}</n-descriptions-item>
            <n-descriptions-item label="签署类型">{{ selectedRow.sign_type || '-' }}</n-descriptions-item>
            <n-descriptions-item label="触发节点">{{ selectedRow.trigger_node || '-' }}</n-descriptions-item>
            <n-descriptions-item label="签署方">{{ selectedRow.sign_party || '-' }}</n-descriptions-item>
            <n-descriptions-item label="发起时间">{{ datetime(selectedRow.initiate_time) }}</n-descriptions-item>
            <n-descriptions-item label="签署时间">{{ datetime(selectedRow.sign_time) }}</n-descriptions-item>
          </DetailSection>

          <DetailSection title="关联任务" :column="2">
            <n-descriptions-item label="任务单号">{{ selectedRow.task_no || '-' }}</n-descriptions-item>
            <n-descriptions-item label="发运申请号">{{ selectedRow.apply_no || '-' }}</n-descriptions-item>
            <n-descriptions-item label="客户名称">{{ selectedRow.customer_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="任务状态">
              <StatusTag v-if="selectedRow.task_status" type="task" :value="selectedRow.task_status" />
              <span v-else class="esign-muted">-</span>
            </n-descriptions-item>
          </DetailSection>

          <DetailSection title="审计信息" :column="2">
            <n-descriptions-item label="创建人">{{ selectedRow.create_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="创建时间">{{ datetime(selectedRow.create_time) }}</n-descriptions-item>
            <n-descriptions-item label="更新人">{{ selectedRow.update_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="更新时间">{{ datetime(selectedRow.update_time) }}</n-descriptions-item>
          </DetailSection>

          <n-alert v-if="selectedRow.sign_status === 'CANCELLED'" type="warning" :show-icon="false" class="esign-drawer__alert">
            该电子签已取消（任务取消时关联待签署电子签自动置为已取消）。
          </n-alert>
          <n-alert
            v-else-if="selectedRow.sign_status === 'WAIT_SIGN' && !selectedRow.task_no"
            type="warning"
            :show-icon="false"
            class="esign-drawer__alert"
          >
            该记录未关联任务，无法模拟签署。
          </n-alert>
        </template>
        <div v-else class="esign-drawer-skeleton">
          <n-skeleton text width="40%" />
          <n-skeleton text :repeat="6" />
        </div>
        <template v-if="selectedRow && canSign(selectedRow)" #footer>
          <div class="esign-drawer__footer">
            <n-button size="small" type="success" @click="askSign(selectedRow)">模拟签署</n-button>
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>

    <!-- 模拟签署确认 -->
    <ConfirmAction
      v-model:show="showSignConfirm"
      title="确认模拟签署该电子签？"
      :content="`将以狮桥身份签署 ${signTarget?.esign_id ?? ''}（任务 ${signTarget?.task_no ?? ''} 最新一条待签署电子签），签署后状态置为「已签署」并回填签署时间。`"
      confirm-text="确认签署"
      :loading="signSubmitting"
      :auto-close="false"
      @confirm="submitSign"
    />
  </div>
</template>

<style scoped>
.esign-card {
  border-radius: 6px;
  margin-bottom: 12px;
}

.esign-filter {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.esign-filter__field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.esign-filter__label {
  flex: none;
  font-size: 13px;
  color: #595959;
}

.esign-filter__field .n-input,
.esign-filter__field .n-select {
  width: 190px;
}

.esign-filter__actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.esign-summary {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 13px;
  color: #595959;
  margin-bottom: 12px;
  padding: 0 4px;
}

.esign-summary b {
  color: #262626;
  font-variant-numeric: tabular-nums;
}

.esign-summary__wait {
  color: #fa8c16;
}

.esign-summary__tip {
  margin-left: auto;
  font-size: 12px;
  color: #8c8c8c;
}

.esign-actions {
  display: flex;
  gap: 2px;
}

.esign-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 0;
  color: #f5222d;
  font-size: 13px;
}

.esign-muted {
  color: #8c8c8c;
}

.esign-drawer-skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.esign-drawer__footer {
  display: flex;
  justify-content: flex-end;
}

.esign-drawer__alert {
  margin-top: 16px;
}
</style>
