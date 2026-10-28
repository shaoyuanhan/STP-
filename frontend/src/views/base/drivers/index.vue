<script setup lang="ts">
/**
 * 基础数据 - 司机管理（契约 5.3 / 既有需求 10）
 *
 * - 列表：姓名/手机号/身份证号/驾驶证号/准驾车型/有效期/所属承运商（唯一归属）/来源/状态
 * - 新增/编辑：姓名、身份证号创建后不可修改（编辑时禁用输入框）；
 *   手机号 PhoneInput；准驾车型下拉；驾驶证有效期起止校验；所属承运商单选必填（carrier_id）
 * - 停用/启用：停用后不可再分派新任务，不影响在途运单
 */
import { computed, h, onActivated, onMounted, reactive, ref } from 'vue'
import type {
  DataTableColumns,
  FormInst,
  FormRules,
  SelectOption,
  UploadFileInfo,
} from 'naive-ui'
import { NButton } from 'naive-ui'
import { useMessage } from 'naive-ui'
import PageTable from '@/components/PageTable.vue'
import StatusTag from '@/components/StatusTag.vue'
import ConfirmAction from '@/components/ConfirmAction.vue'
import PhoneInput from '@/components/PhoneInput.vue'
import DetailSection from '@/components/DetailSection.vue'
import { listCarriers } from '@/services/carriers'
import {
  createDriver,
  downloadDriverTemplate,
  exportDrivers,
  getDriver,
  importDrivers,
  listDrivers,
  updateDriver,
  updateDriverStatus,
} from '@/services/drivers'
import { dateOnly, datetime, formatPhone } from '@/utils/format'
import type {
  Driver,
  DriverImportRowResult,
  DriverImportResult,
  DriverPayload,
  DriverQuery,
  DriverSource,
  DriverStatus,
} from '@/types/api'

/** PageTable 实例句柄 */
interface PageTableHandle {
  reload: () => Promise<void>
  refresh: () => Promise<void>
}

/**
 * 列表行：后端返回数据库原生字段 driver_name（types/api.ts 的 Driver.name 未对齐实际响应），
 * 所属承运商为唯一的 carrier_id / carrier_name。
 */
interface DriverRow extends Omit<Driver, 'name'> {
  driver_name: string
  carrier_id?: number | null
  carrier_name?: string | null
}

const message = useMessage()

/**
 * 成功提示文案：优先用后端信封 message（正式环境由后端下发），
 * message 为空或占位（'success'）时才用前端兜底文案
 */
function envSuccessText(env: { message?: string | null }, fallback: string): string {
  const text = String(env?.message ?? '').trim()
  return text && text.toLowerCase() !== 'success' ? text : fallback
}

/** 司机来源展示（1 系统录入 / 2 狮桥同步） */
const SOURCE_LABELS: Record<number, string> = { 1: '系统录入', 2: '狮桥同步' }

/** 准驾车型下拉（字典接口未提供，前端本地枚举） */
const LICENSE_TYPES = ['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2']
const licenseTypeOptions: SelectOption[] = LICENSE_TYPES.map((t) => ({ label: t, value: t }))

// ---------------- 筛选（按字段分项） ----------------
const filter = reactive<{
  driver_name: string
  phone: string
  id_card: string
  license_no: string
  external_driver_id: string
  carrier_id: string | number
  source: string | number
  status: string | number
}>({
  driver_name: '',
  phone: '',
  id_card: '',
  license_no: '',
  external_driver_id: '',
  carrier_id: '', // '' 全部
  source: '',
  status: '',
})

const filterSourceOptions: SelectOption[] = [
  { label: '全部', value: '' },
  { label: '系统录入', value: 1 },
  { label: '狮桥同步', value: 2 },
]

const filterStatusOptions: SelectOption[] = [
  { label: '全部', value: '' },
  { label: '启用', value: 1 },
  { label: '停用', value: 0 },
]

/** 已应用的查询（_t 强制 PageTable 重新请求） */
type AppliedQuery = {
  driver_name?: string
  phone?: string
  id_card?: string
  license_no?: string
  external_driver_id?: string
  carrier_id?: number
  source?: DriverSource
  status?: DriverStatus
  _t: number
}
const applied = ref<AppliedQuery>({ _t: 0 })

const carrierOptions = ref<SelectOption[]>([])

function buildAppliedQuery(): AppliedQuery {
  const trim = (v: string) => v.trim() || undefined
  return {
    driver_name: trim(filter.driver_name),
    phone: trim(filter.phone),
    id_card: trim(filter.id_card),
    license_no: trim(filter.license_no),
    external_driver_id: trim(filter.external_driver_id),
    carrier_id: filter.carrier_id === '' ? undefined : Number(filter.carrier_id),
    source: filter.source === '' ? undefined : (Number(filter.source) as DriverSource),
    status: filter.status === '' ? undefined : (Number(filter.status) as DriverStatus),
    _t: Date.now(),
  }
}

function handleSearch() {
  applied.value = buildAppliedQuery()
}

function handleReset() {
  filter.driver_name = ''
  filter.phone = ''
  filter.id_card = ''
  filter.license_no = ''
  filter.external_driver_id = ''
  filter.carrier_id = ''
  filter.source = ''
  filter.status = ''
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
    const filename = await exportDrivers(query as DriverQuery)
    message.success(`已导出：${filename}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出失败，请稍后重试')
  } finally {
    exporting.value = false
  }
}

// ---------------- 列表 ----------------
const tableRef = ref<PageTableHandle | null>(null)
const driverRows = ref<DriverRow[]>([])

async function fetchDrivers({ page, pageSize }: { page: number; pageSize: number }) {
  const result = await listDrivers({ page, size: pageSize, ...applied.value })
  driverRows.value = result.list as unknown as DriverRow[]
  return { list: driverRows.value, total: result.total ?? 0 }
}

// ---------------- Excel 导入 ----------------
const showImport = ref(false)
const importing = ref(false)
const templateDownloading = ref(false)
const importFileList = ref<UploadFileInfo[]>([])
const importResult = ref<DriverImportResult | null>(null)
const importFailures = computed(
  () => importResult.value?.results.filter((item) => !item.success) ?? [],
)

const importFailureColumns: DataTableColumns<DriverImportRowResult> = [
  { title: 'Excel 行号', key: 'row', width: 100 },
  { title: '失败原因', key: 'message', minWidth: 260 },
]

function openImport() {
  importFileList.value = []
  importResult.value = null
  showImport.value = true
}

function handleImportFileListChange(files: UploadFileInfo[]) {
  importResult.value = null
  if (files.length && !files[0].name.toLowerCase().endsWith('.xlsx')) {
    importFileList.value = []
    message.warning('请选择 .xlsx 格式的文件')
    return
  }
  importFileList.value = files
}

async function handleTemplateDownload() {
  if (templateDownloading.value) return
  templateDownloading.value = true
  try {
    const filename = await downloadDriverTemplate()
    message.success(`已下载：${filename}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '模板下载失败，请稍后重试')
  } finally {
    templateDownloading.value = false
  }
}

async function submitImport() {
  const file = importFileList.value[0]?.file
  if (!file) {
    message.warning('请先选择要导入的 .xlsx 文件')
    return
  }
  if (importing.value) return
  importing.value = true
  try {
    const data = new FormData()
    data.append('file', file)
    const result = await importDrivers(data)
    importResult.value = result
    message.success(`导入完成：成功 ${result.success} 条，失败 ${result.failed} 条`)
    await tableRef.value?.refresh()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '司机导入失败，请稍后重试')
  } finally {
    importing.value = false
  }
}

const columns: DataTableColumns<DriverRow> = [
  { title: '姓名', key: 'driver_name', width: 100 },
  {
    title: '第三方司机ID',
    key: 'external_driver_id',
    width: 150,
    ellipsis: { tooltip: true },
    render: (row) => row.external_driver_id || '-',
  },
  { title: '手机号', key: 'phone', width: 140, render: (row) => formatPhone(row.phone) },
  { title: '身份证号', key: 'id_card', width: 190 },
  { title: '驾驶证号', key: 'license_no', width: 170, ellipsis: { tooltip: true }, render: (row) => row.license_no || '-' },
  { title: '准驾车型', key: 'license_type', width: 90, render: (row) => row.license_type || '-' },
  {
    title: '有效期自',
    key: 'license_valid_from',
    width: 120,
    render: (row) => dateOnly(row.license_valid_from),
  },
  {
    title: '有效期至',
    key: 'license_valid_to',
    width: 120,
    render: (row) => dateOnly(row.license_valid_to),
  },
  {
    title: '所属承运商',
    key: 'carrier_name',
    width: 200,
    minWidth: 180,
    render: (row) => row.carrier_name || '-',
  },
  {
    title: '来源',
    key: 'source',
    width: 90,
    render: (row) => SOURCE_LABELS[Number(row.source)] ?? '-',
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: (row) => h(StatusTag, { type: 'driver', value: row.status }),
  },
  {
    title: '操作',
    key: 'actions',
    width: 180,
    align: 'center',
    fixed: 'right',
    render: (row) =>
      h('div', { class: 'action-buttons' }, [
        h(
          NButton,
          { size: 'small', quaternary: true, type: 'primary', onClick: () => openDetail(row) },
          { default: () => '详情' },
        ),
        h(
          NButton,
          { size: 'small', quaternary: true, type: 'primary', onClick: () => openForm(row) },
          { default: () => '修改' },
        ),
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: row.status === 1 ? 'error' : 'primary',
            onClick: () => openStatusConfirm(row),
          },
          { default: () => (row.status === 1 ? '停用' : '启用') },
        ),
      ]),
  },
]

// ---------------- 详情抽屉 ----------------
const showDetail = ref(false)
const detailId = ref<number | null>(null)
const detailRow = ref<DriverRow | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
let detailReqId = 0

async function loadDetail(id: number) {
  const reqId = ++detailReqId
  detailLoading.value = true
  detailError.value = ''
  try {
    const result = await getDriver(id)
    if (reqId === detailReqId) detailRow.value = result as unknown as DriverRow
  } catch (error) {
    if (reqId !== detailReqId) return
    detailRow.value = null
    detailError.value = error instanceof Error ? error.message : '司机详情加载失败'
    message.error(detailError.value)
  } finally {
    if (reqId === detailReqId) detailLoading.value = false
  }
}

function openDetail(row: DriverRow) {
  detailId.value = row.id
  detailRow.value = null
  showDetail.value = true
  void loadDetail(row.id)
}

// ---------------- 新增 / 编辑弹窗 ----------------
const showForm = ref(false)
const editing = ref<DriverRow | null>(null)
const submitting = ref(false)
const formRef = ref<FormInst | null>(null)
const phoneRef = ref<InstanceType<typeof PhoneInput> | null>(null)

const formModel = reactive({
  name: '',
  external_driver_id: '',
  phone: '',
  id_card: '',
  license_no: '',
  license_type: null as string | null,
  license_valid_from: null as string | null,
  license_valid_to: null as string | null,
  carrier_id: null as number | null,
  remark: '',
})

const formRules: FormRules = {
  name: [{ required: true, message: '请输入司机姓名', trigger: ['input', 'blur'] }],
  id_card: [
    { required: true, message: '请输入身份证号', trigger: ['input', 'blur'] },
    {
      message: '身份证号格式不正确，应为 18 位（末位可为 X）',
      trigger: ['input', 'blur'],
      validator: () => /^\d{17}[\dXx]$/.test(formModel.id_card.trim()),
    },
  ],
  phone: [
    { required: true, message: '请输入手机号', trigger: ['input', 'blur'] },
    {
      message: '请输入有效的手机号（司机需留手机号，座机/400 号码无法通过校验）',
      trigger: ['input', 'blur'],
      validator: () => (formModel.phone ? (phoneRef.value?.isValid() ?? true) : true),
    },
  ],
  license_valid_from: [
    { required: true, message: '请选择驾驶证有效期起', trigger: ['change', 'blur'] },
  ],
  license_valid_to: [
    { required: true, message: '请选择驾驶证有效期至', trigger: ['change', 'blur'] },
    {
      message: '有效期至不能早于有效期起',
      trigger: ['change', 'blur'],
      validator: () =>
        !formModel.license_valid_from ||
        !formModel.license_valid_to ||
        formModel.license_valid_to >= formModel.license_valid_from,
    },
  ],
  carrier_id: [{ required: true, type: 'number', message: '请选择所属承运商', trigger: ['change', 'blur'] }],
}

function toDateStr(value: string | [string, string] | null | undefined): string {
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

function openForm(row: DriverRow | null) {
  editing.value = row
  formModel.name = row?.driver_name ?? ''
  formModel.external_driver_id = row?.external_driver_id ?? ''
  formModel.phone = row?.phone ?? ''
  formModel.id_card = row?.id_card ?? ''
  formModel.license_no = row?.license_no ?? ''
  formModel.license_type = row?.license_type ?? null
  formModel.license_valid_from = row?.license_valid_from ? String(row.license_valid_from).slice(0, 10) : null
  formModel.license_valid_to = row?.license_valid_to ? String(row.license_valid_to).slice(0, 10) : null
  formModel.carrier_id = row?.carrier_id ? Number(row.carrier_id) : null
  formModel.remark = row?.remark ?? ''
  showForm.value = true
}

async function submitForm() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  const payload: DriverPayload = {
    name: formModel.name.trim(),
    external_driver_id: formModel.external_driver_id.trim() || null,
    phone: formModel.phone,
    id_card: formModel.id_card.trim().toUpperCase(),
    license_no: formModel.license_no.trim() || null,
    license_type: formModel.license_type || null,
    license_valid_from: toDateStr(formModel.license_valid_from),
    license_valid_to: toDateStr(formModel.license_valid_to),
    carrier_id: Number(formModel.carrier_id),
    remark: formModel.remark.trim() || null,
  }
  submitting.value = true
  try {
    if (editing.value) {
      // 姓名/身份证不可修改：禁用输入框中的原值原样回传，后端校验一致即通过
      const env = await updateDriver(editing.value.id, payload)
      message.success(envSuccessText(env, '司机信息已保存'))
    } else {
      const env = await createDriver(payload)
      message.success(envSuccessText(env, '新增司机成功（来源：系统录入）'))
    }
    showForm.value = false
    tableRef.value?.refresh()
  } catch (err) {
    message.error(err instanceof Error ? err.message : '保存失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

// ---------------- 停用 / 启用确认 ----------------
const showStatusConfirm = ref(false)
const statusTarget = ref<DriverRow | null>(null)
const statusSubmitting = ref(false)

function openStatusConfirm(row: DriverRow) {
  statusTarget.value = row
  showStatusConfirm.value = true
}

const statusConfirmTitle = computed(() =>
  statusTarget.value?.status === 1 ? '确认停用该司机？' : '确认启用该司机？',
)

const statusConfirmContent = computed(() => {
  const row = statusTarget.value
  if (!row) return ''
  if (row.status === 1) {
    return `停用后「${row.driver_name}」不可再派新任务，不影响在途运单。`
  }
  return `启用后「${row.driver_name}」可正常分派任务。`
})

async function confirmStatusChange() {
  const row = statusTarget.value
  if (!row) return
  const next: 1 | 0 = row.status === 1 ? 0 : 1
  statusSubmitting.value = true
  try {
    const env = await updateDriverStatus(row.id, next)
    message.success(
      envSuccessText(
        env,
        next === 0 ? `「${row.driver_name}」已停用，不可再派新任务` : `「${row.driver_name}」已启用`,
      ),
    )
    showStatusConfirm.value = false
    tableRef.value?.refresh()
  } catch (err) {
    message.error(err instanceof Error ? err.message : '操作失败，请稍后重试')
  } finally {
    statusSubmitting.value = false
  }
}

// ---------------- 承运商下拉选项（筛选 + 表单共用） ----------------
async function loadCarrierOptions() {
  try {
    const page = await listCarriers({ page: 1, size: 200 })
    carrierOptions.value = (page.list ?? []).map((c) => ({ label: c.carrier_name, value: c.id }))
  } catch {
    // 承运商下拉加载失败不阻塞司机列表
    carrierOptions.value = []
  }
}

onMounted(loadCarrierOptions)
// keep-alive 页签切回时重新拉取（承运商页新增后回来自动可见）
onActivated(loadCarrierOptions)
</script>

<template>
  <div class="stp-page">
    <!-- 筛选栏 -->
    <n-card class="query-card" :bordered="false">
      <div class="query-bar">
        <div class="query-fields">
          <div class="query-item">
            <span>司机姓名</span>
            <n-input
              v-model:value="filter.driver_name"
              clearable
              placeholder="请输入司机姓名"
              @keydown.enter="handleSearch"
            />
          </div>
          <div class="query-item">
            <span>手机号</span>
            <n-input
              v-model:value="filter.phone"
              clearable
              placeholder="请输入手机号"
              @keydown.enter="handleSearch"
            />
          </div>
          <div class="query-item">
            <span>身份证号</span>
            <n-input
              v-model:value="filter.id_card"
              clearable
              placeholder="请输入身份证号"
              @keydown.enter="handleSearch"
            />
          </div>
          <div class="query-item">
            <span>驾驶证号</span>
            <n-input
              v-model:value="filter.license_no"
              clearable
              placeholder="请输入驾驶证号"
              @keydown.enter="handleSearch"
            />
          </div>
          <div class="query-item">
            <span>第三方司机ID</span>
            <n-input
              v-model:value="filter.external_driver_id"
              clearable
              placeholder="请输入第三方司机ID"
              @keydown.enter="handleSearch"
            />
          </div>
          <div class="query-item">
            <span>所属承运商</span>
            <n-select
              v-model:value="filter.carrier_id"
              :options="[{ label: '全部', value: '' }, ...carrierOptions]"
            />
          </div>
          <div class="query-item">
            <span>来源</span>
            <n-select v-model:value="filter.source" :options="filterSourceOptions" />
          </div>
          <div class="query-item">
            <span>状态</span>
            <n-select v-model:value="filter.status" :options="filterStatusOptions" />
          </div>
        </div>
        <div class="query-buttons">
          <n-button type="primary" quaternary @click="handleReset">重置</n-button>
          <n-button type="primary" @click="handleSearch">查询</n-button>
        </div>
      </div>
    </n-card>

    <!-- 列表 -->
    <n-card class="table-card" :bordered="false">
      <div class="table-toolbar">
        <span class="table-toolbar__hint">
          司机信息支持系统录入与狮桥同步；姓名与身份证号创建后不可修改；停用后不可派新任务，不影响在途运单
        </span>
        <div class="table-toolbar__actions">
          <n-button @click="openImport">Excel 导入</n-button>
          <n-button :loading="exporting" @click="handleExport">导出</n-button>
          <n-button type="primary" @click="openForm(null)">新增司机</n-button>
        </div>
      </div>
      <PageTable
        ref="tableRef"
        :columns="columns"
        :remote="fetchDrivers"
        :query="applied"
        :scroll-x="1650"
      />
    </n-card>

    <!-- Excel 导入 -->
    <n-modal
      v-model:show="showImport"
      preset="card"
      size="huge"
      title="导入司机"
      :bordered="false"
      :style="{ width: '640px', maxWidth: '94vw' }"
      :mask-closable="!importing"
      :closable="!importing"
    >
      <div class="driver-import">
        <div class="driver-import__template">
          <span>请按模板填写司机信息，仅支持 .xlsx 文件。</span>
          <n-button
            text
            type="primary"
            :loading="templateDownloading"
            @click="handleTemplateDownload"
          >
            下载导入模板
          </n-button>
        </div>
        <n-upload
          :file-list="importFileList"
          :default-upload="false"
          :max="1"
          :disabled="importing"
          accept=".xlsx"
          @update:file-list="handleImportFileListChange"
        >
          <n-button :disabled="importing">选择 .xlsx 文件</n-button>
        </n-upload>
        <n-alert
          v-if="importResult"
          :type="importResult.failed > 0 ? 'warning' : 'success'"
          :show-icon="false"
        >
          导入结果：共 {{ importResult.total }} 条，成功 {{ importResult.success }} 条，失败
          {{ importResult.failed }} 条
        </n-alert>
        <n-data-table
          v-if="importFailures.length"
          size="small"
          :columns="importFailureColumns"
          :data="importFailures"
          :row-key="(row: DriverImportRowResult) => row.row"
          :max-height="240"
          :bordered="false"
        />
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button
            type="primary"
            :loading="importing"
            :disabled="!importFileList.length"
            @click="submitImport"
          >
            开始导入
          </n-button>
          <n-button :disabled="importing" @click="showImport = false">
            {{ importResult ? '关闭' : '取消' }}
          </n-button>
        </div>
      </template>
    </n-modal>

    <!-- 司机详情 -->
    <n-drawer
      v-model:show="showDetail"
      :width="'min(760px, 94vw)'"
      placement="right"
    >
      <n-drawer-content title="司机详情" closable :native-scrollbar="false">
        <n-spin :show="detailLoading">
          <div v-if="detailError" class="detail-error">
            <span>{{ detailError }}</span>
            <n-button size="small" type="primary" @click="detailId !== null && loadDetail(detailId)">
              重试
            </n-button>
          </div>
          <div v-else-if="detailRow" class="driver-detail">
          <DetailSection title="基本信息" :column="2">
            <n-descriptions-item label="姓名">{{ detailRow.driver_name }}</n-descriptions-item>
            <n-descriptions-item label="第三方司机ID">{{ detailRow.external_driver_id || '-' }}</n-descriptions-item>
            <n-descriptions-item label="手机号">{{ formatPhone(detailRow.phone) }}</n-descriptions-item>
            <n-descriptions-item label="身份证号">{{ detailRow.id_card }}</n-descriptions-item>
            <n-descriptions-item label="所属承运商">{{ detailRow.carrier_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="来源">
              {{ SOURCE_LABELS[Number(detailRow.source)] ?? '-' }}
            </n-descriptions-item>
            <n-descriptions-item label="状态">
              <StatusTag type="driver" :value="detailRow.status" />
            </n-descriptions-item>
            <n-descriptions-item label="备注" :span="2">
              <span class="driver-detail__remark">{{ detailRow.remark || '-' }}</span>
            </n-descriptions-item>
          </DetailSection>

          <DetailSection title="驾照信息" :column="2">
            <n-descriptions-item label="驾驶证号">{{ detailRow.license_no || '-' }}</n-descriptions-item>
            <n-descriptions-item label="准驾车型">{{ detailRow.license_type || '-' }}</n-descriptions-item>
            <n-descriptions-item label="有效期自">{{ dateOnly(detailRow.license_valid_from) }}</n-descriptions-item>
            <n-descriptions-item label="有效期至">{{ dateOnly(detailRow.license_valid_to) }}</n-descriptions-item>
          </DetailSection>

          <DetailSection title="审计信息" :column="2">
            <n-descriptions-item label="创建人">{{ detailRow.create_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="创建时间">{{ datetime(detailRow.create_time) }}</n-descriptions-item>
            <n-descriptions-item label="更新人">{{ detailRow.update_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="更新时间">{{ datetime(detailRow.update_time) }}</n-descriptions-item>
          </DetailSection>
          </div>
        </n-spin>
      </n-drawer-content>
    </n-drawer>

    <!-- 新增 / 编辑弹窗 -->
    <n-modal
      v-model:show="showForm"
      preset="card"
      size="huge"
      :bordered="false"
      :title="editing ? '编辑司机' : '新增司机'"
      class="form-modal"
      :style="{ width: '600px', maxWidth: '94vw' }"
      :mask-closable="!submitting"
      :closable="!submitting"
    >
      <n-form
        ref="formRef"
        :model="formModel"
        :rules="formRules"
        label-placement="left"
        label-width="100"
        require-mark-placement="left"
      >
        <n-form-item label="姓名" path="name">
          <n-input
            v-model:value="formModel.name"
            :maxlength="64"
            clearable
            :disabled="Boolean(editing) || submitting"
            placeholder="请输入司机姓名"
          />
        </n-form-item>
        <n-form-item label="第三方司机ID" path="external_driver_id">
          <div class="readonly-field">
            <n-input
              v-model:value="formModel.external_driver_id"
              :maxlength="64"
              clearable
              :disabled="submitting"
              placeholder="如 SQD-000123（选填，外部系统司机ID）"
            />
            <span class="field-tip">外部系统主键，选填且全局唯一；接单/回传可用该ID定位司机</span>
          </div>
        </n-form-item>
        <n-form-item label="身份证号" path="id_card">
          <n-input
            v-model:value="formModel.id_card"
            :maxlength="18"
            clearable
            :disabled="Boolean(editing) || submitting"
            placeholder="请输入 18 位身份证号"
          />
        </n-form-item>
        <div v-if="editing" class="locked-tip">姓名与身份证号创建后不可修改</div>
        <n-form-item label="手机号" path="phone">
          <div class="readonly-field">
            <PhoneInput
              ref="phoneRef"
              v-model="formModel.phone"
              :disabled="submitting"
              placeholder="请输入手机号"
            />
            <span class="field-tip">司机需留手机号，座机/400 号码无法通过校验</span>
          </div>
        </n-form-item>
        <n-form-item label="驾驶证号" path="license_no">
          <n-input
            v-model:value="formModel.license_no"
            :maxlength="32"
            clearable
            :disabled="submitting"
            placeholder="选填"
          />
        </n-form-item>
        <n-form-item label="准驾车型" path="license_type">
          <n-select
            v-model:value="formModel.license_type"
            :options="licenseTypeOptions"
            clearable
            :disabled="submitting"
            placeholder="请选择准驾车型（选填）"
          />
        </n-form-item>
        <n-form-item label="有效期自" path="license_valid_from">
          <n-date-picker
            v-model:formatted-value="formModel.license_valid_from"
            type="date"
            value-format="yyyy-MM-dd"
            clearable
            :disabled="submitting"
            class="page-card__date"
          />
        </n-form-item>
        <n-form-item label="有效期至" path="license_valid_to">
          <n-date-picker
            v-model:formatted-value="formModel.license_valid_to"
            type="date"
            value-format="yyyy-MM-dd"
            clearable
            :disabled="submitting"
            class="page-card__date"
          />
        </n-form-item>
        <n-form-item label="所属承运商" path="carrier_id">
          <n-select
            v-model:value="formModel.carrier_id"
            :options="carrierOptions"
            filterable
            :disabled="submitting"
            placeholder="请选择所属承运商"
          />
        </n-form-item>
        <n-form-item label="备注" path="remark">
          <n-input
            v-model:value="formModel.remark"
            type="textarea"
            :rows="3"
            :maxlength="200"
            show-count
            :disabled="submitting"
            placeholder="选填"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button type="primary" :loading="submitting" @click="submitForm">
            {{ editing ? '保存' : '新增司机' }}
          </n-button>
          <n-button :disabled="submitting" @click="showForm = false">取消</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 停用 / 启用确认 -->
    <ConfirmAction
      v-model:show="showStatusConfirm"
      :type="statusTarget && statusTarget.status === 1 ? 'error' : 'default'"
      :title="statusConfirmTitle"
      :content="statusConfirmContent"
      :confirm-text="statusTarget && statusTarget.status === 1 ? '确认停用' : '确认启用'"
      cancel-text="取消"
      :loading="statusSubmitting"
      :auto-close="false"
      @confirm="confirmStatusChange"
    />
  </div>
</template>

<style scoped>
.driver-import {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.driver-import__template {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: #666666;
  font-size: 13px;
}

.detail-error {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
  color: #d03050;
}

.page-card__date {
  width: 100%;
}

.driver-detail > :last-child {
  margin-bottom: 0;
}

.driver-detail__remark {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.readonly-field {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-tip {
  font-size: 12px;
  color: #999999;
  line-height: 1.5;
}

.locked-tip {
  margin: -8px 0 14px 100px;
  font-size: 12px;
  color: #f0a020;
}
</style>
