<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue'
import type { DataTableColumns, FormInst, FormRules, SelectOption } from 'naive-ui'
import { NButton, NTag, useMessage } from 'naive-ui'
import PageTable from '@/components/PageTable.vue'
import QueryBar from '@/components/QueryBar.vue'
import QueryField from '@/components/QueryField.vue'
import PhoneInput from '@/components/PhoneInput.vue'
import ConfirmAction from '@/components/ConfirmAction.vue'
import {
  createPickupPoint,
  listPickupPointFactories,
  listPickupPointRegions,
  listPickupPoints,
  updatePickupPoint,
  updatePickupPointStatus,
} from '@/services/pickupPoints'
import { dateOnly, formatPhone } from '@/utils/format'
import type {
  PickupPoint,
  PickupPointFactoryOption,
  PickupPointPayload,
  PickupPointQuery,
  RegionOption,
} from '@/types/api'

interface PageTableHandle {
  reload: () => Promise<void>
  refresh: () => Promise<void>
}

const message = useMessage()
const tableRef = ref<PageTableHandle | null>(null)
const filterExpanded = ref(false)
const regionOptions = ref<RegionOption[]>([])
const factoryOptions = ref<PickupPointFactoryOption[]>([])
const regionLoading = ref(false)
const factoryLoading = ref(false)

function envSuccessText(env: { message?: string | null }, fallback: string): string {
  const text = String(env?.message ?? '').trim()
  return text && text.toLowerCase() !== 'success' ? text : fallback
}

function regionText(row: PickupPoint): string {
  return [row.province_name, row.city_name, row.district_name].filter(Boolean).join(' / ') || '-'
}

const filter = reactive({
  factory_id: null as number | null,
  pickup_code: '',
  pickup_name: '',
  province_code: null as string | null,
  contact_person: '',
  enabled: null as string | null,
})

type AppliedQuery = PickupPointQuery & { _t: number }
const applied = ref<AppliedQuery>({ _t: 0 })

const factorySelectOptions = computed<SelectOption[]>(() =>
  factoryOptions.value.map((item) => ({
    label: `${item.factory_name}（${item.factory_code}）`,
    value: item.id,
  })),
)
const provinceOptions = computed<SelectOption[]>(() =>
  regionOptions.value.map((item) => ({ label: item.label, value: item.value })),
)
const statusOptions: SelectOption[] = [
  { label: '启用', value: '1' },
  { label: '停用', value: '0' },
]
const defaultPointOptions: SelectOption[] = [
  { label: '是', value: '1' },
  { label: '否', value: '0' },
]

function buildAppliedQuery(): AppliedQuery {
  const trim = (value: string) => value.trim() || undefined
  return {
    factory_id: filter.factory_id ?? undefined,
    pickup_code: trim(filter.pickup_code),
    pickup_name: trim(filter.pickup_name),
    province_code: filter.province_code || undefined,
    contact_person: trim(filter.contact_person),
    enabled: filter.enabled ?? undefined,
    _t: Date.now(),
  }
}

function handleSearch() {
  applied.value = buildAppliedQuery()
}

function handleReset() {
  filter.factory_id = null
  filter.pickup_code = ''
  filter.pickup_name = ''
  filter.province_code = null
  filter.contact_person = ''
  filter.enabled = null
  applied.value = buildAppliedQuery()
}

async function fetchPickupPoints({ page, pageSize }: { page: number; pageSize: number }) {
  return listPickupPoints({ page, size: pageSize, ...applied.value })
}

const columns: DataTableColumns<PickupPoint> = [
  { title: '公司名称', key: 'company_name', width: 220, ellipsis: { tooltip: true } },
  { title: '所属工厂', key: 'factory_name', width: 160, ellipsis: { tooltip: true } },
  { title: '提车点编码', key: 'pickup_code', width: 140, ellipsis: { tooltip: true } },
  { title: '提车点名称/仓库', key: 'pickup_name', width: 180, ellipsis: { tooltip: true } },
  { title: '提车地区', key: 'region', width: 220, render: (row) => regionText(row) },
  { title: '详细地址', key: 'detail_address', width: 280, ellipsis: { tooltip: true } },
  { title: '联系人', key: 'contact_person', width: 100 },
  {
    title: '联系电话',
    key: 'contact_phone',
    width: 150,
    render: (row) => formatPhone(row.contact_phone),
  },
  {
    title: '默认',
    key: 'is_default',
    width: 80,
    render: (row) => row.is_default === 1
      ? h(NTag, { size: 'small', type: 'primary', bordered: false }, { default: () => '默认' })
      : '-',
  },
  {
    title: '状态',
    key: 'enabled',
    width: 80,
    render: (row) => h(
      NTag,
      { size: 'small', type: row.enabled === 1 ? 'success' : 'default', bordered: false },
      { default: () => (row.enabled === 1 ? '启用' : '停用') },
    ),
  },
  {
    title: '创建日期',
    key: 'create_time',
    width: 120,
    render: (row) => dateOnly(row.create_time),
  },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    align: 'center',
    fixed: 'right',
    render: (row) => h('div', { class: 'action-buttons' }, [
      h(
        NButton,
        { size: 'small', quaternary: true, type: 'primary', onClick: () => openForm(row) },
        { default: () => '编辑' },
      ),
      h(
        NButton,
        {
          size: 'small',
          quaternary: true,
          type: row.enabled === 1 ? 'error' : 'primary',
          onClick: () => openStatusConfirm(row),
        },
        { default: () => (row.enabled === 1 ? '停用' : '启用') },
      ),
    ]),
  },
]

const showForm = ref(false)
const editing = ref<PickupPoint | null>(null)
const submitting = ref(false)
const formRef = ref<FormInst | null>(null)
const phoneRef = ref<InstanceType<typeof PhoneInput> | null>(null)
const formModel = reactive({
  factory_id: null as number | null,
  pickup_code: '',
  pickup_name: '',
  region: null as string | null,
  detail_address: '',
  contact_person: '',
  contact_phone: '',
  is_default: '0' as '0' | '1',
  remark: '',
})

const formRules: FormRules = {
  factory_id: [{
    required: true,
    message: '请选择所属工厂',
    trigger: ['change', 'blur'],
    validator: () => Boolean(formModel.factory_id),
  }],
  pickup_code: [{ required: true, message: '请输入提车点编码', trigger: ['input', 'blur'] }],
  pickup_name: [{ required: true, message: '请输入提车点名称/仓库', trigger: ['input', 'blur'] }],
  region: [{
    required: true,
    message: '请选择完整的省、市、区',
    trigger: ['change', 'blur'],
    validator: () => Boolean(formModel.region),
  }],
  detail_address: [{ required: true, message: '请输入详细地址', trigger: ['input', 'blur'] }],
  contact_person: [{ required: true, message: '请输入提车联系人', trigger: ['input', 'blur'] }],
  contact_phone: [
    { required: true, message: '请输入提车联系人电话', trigger: ['input', 'blur'] },
    {
      message: '请输入有效的联系电话（默认中国 +86，支持手机/座机/400）',
      trigger: ['input', 'blur'],
      validator: () => (formModel.contact_phone ? (phoneRef.value?.isValid() ?? true) : true),
    },
  ],
}

function openForm(row: PickupPoint | null = null) {
  editing.value = row
  formModel.factory_id = row?.factory_id ?? null
  formModel.pickup_code = row?.pickup_code ?? ''
  formModel.pickup_name = row?.pickup_name ?? ''
  formModel.region = row?.district_code ?? null
  formModel.detail_address = row?.detail_address ?? ''
  formModel.contact_person = row?.contact_person ?? ''
  formModel.contact_phone = row?.contact_phone ?? ''
  formModel.is_default = row?.is_default === 1 ? '1' : '0'
  formModel.remark = row?.remark ?? ''
  showForm.value = true
}

const defaultPointTip = computed(() =>
  editing.value?.enabled === 0
    ? '该提车点已停用，请先在列表启用后再设为默认'
    : '同一工厂仅保留一个默认提车点',
)

async function submitForm() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  const payload: PickupPointPayload = {
    factory_id: formModel.factory_id ?? 0,
    pickup_code: formModel.pickup_code.trim(),
    pickup_name: formModel.pickup_name.trim(),
    province_code: formModel.region ? `${formModel.region.slice(0, 2)}0000` : '',
    city_code: formModel.region ? `${formModel.region.slice(0, 4)}00` : '',
    district_code: formModel.region ?? '',
    detail_address: formModel.detail_address.trim(),
    contact_person: formModel.contact_person.trim(),
    contact_phone: formModel.contact_phone,
    is_default: formModel.is_default === '1',
    remark: formModel.remark.trim(),
  }
  submitting.value = true
  try {
    const env = editing.value
      ? await updatePickupPoint(editing.value.id, payload)
      : await createPickupPoint(payload)
    message.success(envSuccessText(env, editing.value ? '提车点信息已保存' : '新增提车点成功'))
    showForm.value = false
    await tableRef.value?.refresh()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

const showStatusConfirm = ref(false)
const statusTarget = ref<PickupPoint | null>(null)
const statusSubmitting = ref(false)

function openStatusConfirm(row: PickupPoint) {
  statusTarget.value = row
  showStatusConfirm.value = true
}

const statusConfirmTitle = computed(() =>
  statusTarget.value?.enabled === 1 ? '确认停用该提车点？' : '确认启用该提车点？',
)

const statusConfirmContent = computed(() => {
  const row = statusTarget.value
  if (!row) return ''
  if (row.enabled === 1) {
    const defaultTip = row.is_default === 1 ? '，并同步取消默认提车点标识' : ''
    return `停用后「${row.pickup_name}」不再作为可选提车点${defaultTip}。`
  }
  return `启用后「${row.pickup_name}」将恢复为可选提车点。`
})

async function confirmStatusChange() {
  const row = statusTarget.value
  if (!row) return
  const next: 1 | 0 = row.enabled === 1 ? 0 : 1
  statusSubmitting.value = true
  try {
    const env = await updatePickupPointStatus(row.id, next)
    message.success(envSuccessText(env, next === 0 ? '提车点已停用' : '提车点已启用'))
    showStatusConfirm.value = false
    await tableRef.value?.refresh()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败，请稍后重试')
  } finally {
    statusSubmitting.value = false
  }
}

async function loadFactories() {
  factoryLoading.value = true
  try {
    factoryOptions.value = await listPickupPointFactories()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '工厂选项加载失败')
  } finally {
    factoryLoading.value = false
  }
}

async function loadRegions() {
  regionLoading.value = true
  try {
    regionOptions.value = await listPickupPointRegions()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '行政区划数据加载失败')
  } finally {
    regionLoading.value = false
  }
}

onMounted(() => {
  loadFactories()
  loadRegions()
})
</script>

<template>
  <div class="stp-page">
    <n-card class="query-card" :bordered="false">
      <QueryBar>
        <QueryField label="所属工厂">
          <n-select
            v-model:value="filter.factory_id"
            clearable
            filterable
            :loading="factoryLoading"
            :options="factorySelectOptions"
            placeholder="请选择所属工厂"
          />
        </QueryField>
        <QueryField label="提车点编码">
          <n-input v-model:value="filter.pickup_code" clearable placeholder="请输入提车点编码" @keydown.enter="handleSearch" />
        </QueryField>
        <QueryField label="提车点/仓库">
          <n-input v-model:value="filter.pickup_name" clearable placeholder="请输入提车点或仓库名称" @keydown.enter="handleSearch" />
        </QueryField>
        <QueryField v-show="filterExpanded" label="所在省份">
          <n-select
            v-model:value="filter.province_code"
            clearable
            filterable
            :loading="regionLoading"
            :options="provinceOptions"
            placeholder="请选择省份"
          />
        </QueryField>
        <QueryField v-show="filterExpanded" label="提车联系人">
          <n-input v-model:value="filter.contact_person" clearable placeholder="请输入联系人" @keydown.enter="handleSearch" />
        </QueryField>
        <QueryField v-show="filterExpanded" label="启用状态">
          <n-select v-model:value="filter.enabled" clearable :options="statusOptions" placeholder="请选择状态" />
        </QueryField>
        <template #actions>
          <n-button quaternary class="query-card__toggle" @click="filterExpanded = !filterExpanded">
            {{ filterExpanded ? '收起' : '展开' }}
            <span class="query-card__caret" :class="{ 'is-open': filterExpanded }">▾</span>
          </n-button>
          <n-button @click="handleReset">重置</n-button>
          <n-button type="primary" @click="handleSearch">查询</n-button>
        </template>
      </QueryBar>
    </n-card>

    <n-card class="table-card" :bordered="false">
      <div class="table-toolbar">
        <span class="table-toolbar__hint">
          集中维护工厂下属仓库和发运地点（提车点），省市区、详细地址及联系人均以具体提车点为准
        </span>
        <div class="table-toolbar__actions">
          <n-button type="primary" @click="openForm()">新增提车点</n-button>
        </div>
      </div>
      <PageTable
        ref="tableRef"
        :columns="columns"
        :remote="fetchPickupPoints"
        :query="applied"
        :scroll-x="1900"
      />
    </n-card>

    <n-modal
      v-model:show="showForm"
      preset="card"
      size="huge"
      :bordered="false"
      :title="editing ? '编辑提车点' : '新增提车点'"
      class="form-modal"
      :style="{ width: '680px', maxWidth: '94vw' }"
      :mask-closable="!submitting"
      :closable="!submitting"
    >
      <n-form
        ref="formRef"
        :model="formModel"
        :rules="formRules"
        label-placement="left"
        label-width="110"
        require-mark-placement="left"
      >
        <n-form-item label="所属工厂" path="factory_id">
          <n-select
            v-model:value="formModel.factory_id"
            filterable
            :loading="factoryLoading"
            :options="factorySelectOptions"
            :disabled="submitting"
            placeholder="请选择所属工厂"
          />
        </n-form-item>
        <n-form-item label="提车点编码" path="pickup_code">
          <div class="form-field">
            <n-input
              v-model:value="formModel.pickup_code"
              :maxlength="32"
              clearable
              :disabled="submitting"
              placeholder="请输入全局唯一的提车点编码"
            />
            <span class="field-tip">建议使用稳定编码，例如 JH-HF-SCK，保存后仍可在编辑时调整</span>
          </div>
        </n-form-item>
        <n-form-item label="提车点/仓库" path="pickup_name">
          <n-input
            v-model:value="formModel.pickup_name"
            :maxlength="128"
            clearable
            :disabled="submitting"
            placeholder="例如：合肥-生产库"
          />
        </n-form-item>
        <n-form-item label="提车地区" path="region">
          <div class="form-field">
            <n-cascader
              v-model:value="formModel.region"
              :options="regionOptions"
              :loading="regionLoading"
              :disabled="submitting"
              clearable
              filterable
              expand-trigger="hover"
              placeholder="请选择省 / 市 / 区"
            />
            <span class="field-tip">保存省市区名称及六位行政区划代码，城市代码使用地级市编码</span>
          </div>
        </n-form-item>
        <n-form-item label="详细地址" path="detail_address">
          <n-input
            v-model:value="formModel.detail_address"
            type="textarea"
            :rows="2"
            :maxlength="255"
            show-count
            :disabled="submitting"
            placeholder="请输入完整省市区、道路、门牌号及仓库导航信息"
          />
        </n-form-item>
        <n-form-item label="提车联系人" path="contact_person">
          <n-input
            v-model:value="formModel.contact_person"
            :maxlength="64"
            clearable
            :disabled="submitting"
            placeholder="请输入提车联系人姓名"
          />
        </n-form-item>
        <n-form-item label="联系人电话" path="contact_phone">
          <div class="form-field">
            <PhoneInput
              ref="phoneRef"
              v-model="formModel.contact_phone"
              :disabled="submitting"
              placeholder="请输入提车联系人电话"
            />
            <span class="field-tip">默认中国 +86，支持手机、座机和 400/800 电话</span>
          </div>
        </n-form-item>
        <n-form-item label="默认提车点">
          <div class="form-field">
            <n-select
              v-model:value="formModel.is_default"
              :options="defaultPointOptions"
              :disabled="submitting || editing?.enabled === 0"
            />
            <span class="field-tip">{{ defaultPointTip }}</span>
          </div>
        </n-form-item>
        <n-form-item label="备注">
          <n-input
            v-model:value="formModel.remark"
            type="textarea"
            :rows="2"
            :maxlength="512"
            show-count
            :disabled="submitting"
            placeholder="可填写导航说明或仓库特殊要求"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button type="primary" :loading="submitting" @click="submitForm">
            {{ editing ? '保存' : '新增提车点' }}
          </n-button>
          <n-button :disabled="submitting" @click="showForm = false">取消</n-button>
        </div>
      </template>
    </n-modal>

    <ConfirmAction
      v-model:show="showStatusConfirm"
      :type="statusTarget && statusTarget.enabled === 1 ? 'error' : 'default'"
      :title="statusConfirmTitle"
      :content="statusConfirmContent"
      :confirm-text="statusTarget && statusTarget.enabled === 1 ? '确认停用' : '确认启用'"
      cancel-text="取消"
      :loading="statusSubmitting"
      :auto-close="false"
      @confirm="confirmStatusChange"
    />
  </div>
</template>

<style scoped>
.table-toolbar__actions {
  display: flex;
  gap: 8px;
}

.action-buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.form-field {
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
</style>
