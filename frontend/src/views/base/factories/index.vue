<script setup lang="ts">
import { computed, h, reactive, ref } from 'vue'
import type { DataTableColumns, FormInst, FormRules, UploadFileInfo } from 'naive-ui'
import { NButton, useMessage } from 'naive-ui'
import PageTable from '@/components/PageTable.vue'
import QueryBar from '@/components/QueryBar.vue'
import QueryField from '@/components/QueryField.vue'
import PhoneInput from '@/components/PhoneInput.vue'
import DetailSection from '@/components/DetailSection.vue'
import {
  createFactory,
  downloadFactoryTemplate,
  exportFactories,
  getFactory,
  importFactories,
  listFactories,
  updateFactory,
} from '@/services/factories'
import { dateOnly, datetime, formatPhone } from '@/utils/format'
import type {
  Factory,
  FactoryImportResult,
  FactoryImportRowResult,
  FactoryPayload,
  FactoryQuery,
} from '@/types/api'

interface PageTableHandle {
  reload: () => Promise<void>
  refresh: () => Promise<void>
}

const message = useMessage()
const filterExpanded = ref(false)
const tableRef = ref<PageTableHandle | null>(null)

function envSuccessText(env: { message?: string | null }, fallback: string): string {
  const text = String(env?.message ?? '').trim()
  return text && text.toLowerCase() !== 'success' ? text : fallback
}

const filter = reactive({
  company_code: '',
  company_name: '',
  factory_code: '',
  factory_name: '',
  contact_person: '',
})

type AppliedQuery = FactoryQuery & { _t: number }
const applied = ref<AppliedQuery>({ _t: 0 })

function buildAppliedQuery(): AppliedQuery {
  const trim = (value: string) => value.trim() || undefined
  return {
    company_code: trim(filter.company_code),
    company_name: trim(filter.company_name),
    factory_code: trim(filter.factory_code),
    factory_name: trim(filter.factory_name),
    contact_person: trim(filter.contact_person),
    _t: Date.now(),
  }
}

function handleSearch() {
  applied.value = buildAppliedQuery()
}

function handleReset() {
  filter.company_code = ''
  filter.company_name = ''
  filter.factory_code = ''
  filter.factory_name = ''
  filter.contact_person = ''
  applied.value = buildAppliedQuery()
}

async function fetchFactories({ page, pageSize }: { page: number; pageSize: number }) {
  return listFactories({ page, size: pageSize, ...applied.value })
}

const columns: DataTableColumns<Factory> = [
  { title: '公司编码', key: 'company_code', width: 130, ellipsis: { tooltip: true } },
  { title: '公司名称', key: 'company_name', width: 200, ellipsis: { tooltip: true } },
  { title: '工厂编码', key: 'factory_code', width: 140, ellipsis: { tooltip: true } },
  { title: '工厂名称', key: 'factory_name', width: 200, ellipsis: { tooltip: true } },
  { title: '工厂联系人', key: 'contact_person', width: 110 },
  {
    title: '联系人电话',
    key: 'contact_phone',
    width: 150,
    render: (row) => formatPhone(row.contact_phone),
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
    width: 130,
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
          { default: () => '编辑' },
        ),
      ]),
  },
]

const exporting = ref(false)
async function handleExport() {
  if (exporting.value) return
  exporting.value = true
  try {
    const query = { ...applied.value } as Record<string, unknown>
    delete query._t
    const filename = await exportFactories(query as FactoryQuery)
    message.success(`已导出：${filename}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出失败，请稍后重试')
  } finally {
    exporting.value = false
  }
}

const showDetail = ref(false)
const detailRow = ref<Factory | null>(null)
async function openDetail(row: Factory) {
  detailRow.value = row
  showDetail.value = true
  try {
    detailRow.value = await getFactory(row.id)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '工厂详情加载失败')
  }
}

const showForm = ref(false)
const editing = ref<Factory | null>(null)
const submitting = ref(false)
const formRef = ref<FormInst | null>(null)
const phoneRef = ref<InstanceType<typeof PhoneInput> | null>(null)
const formModel = reactive({
  company_code: '',
  company_name: '',
  factory_code: '',
  factory_name: '',
  contact_person: '',
  contact_phone: '',
})

const formRules: FormRules = {
  company_code: [{ required: true, message: '请输入公司编码', trigger: ['input', 'blur'] }],
  company_name: [{ required: true, message: '请输入公司名称', trigger: ['input', 'blur'] }],
  factory_code: [{ required: true, message: '请输入工厂编码', trigger: ['input', 'blur'] }],
  factory_name: [{ required: true, message: '请输入工厂名称', trigger: ['input', 'blur'] }],
  contact_person: [{ required: true, message: '请输入工厂联系人', trigger: ['input', 'blur'] }],
  contact_phone: [
    { required: true, message: '请输入工厂联系人电话', trigger: ['input', 'blur'] },
    {
      message: '请输入有效的联系电话（默认中国 +86，支持手机/座机/400）',
      trigger: ['input', 'blur'],
      validator: () => (formModel.contact_phone ? (phoneRef.value?.isValid() ?? true) : true),
    },
  ],
}

function openForm(row: Factory | null) {
  editing.value = row
  formModel.company_code = row?.company_code ?? ''
  formModel.company_name = row?.company_name ?? ''
  formModel.factory_code = row?.factory_code ?? ''
  formModel.factory_name = row?.factory_name ?? ''
  formModel.contact_person = row?.contact_person ?? ''
  formModel.contact_phone = row?.contact_phone ?? ''
  showForm.value = true
}

async function submitForm() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  const payload: FactoryPayload = {
    company_code: formModel.company_code.trim(),
    company_name: formModel.company_name.trim(),
    factory_code: formModel.factory_code.trim(),
    factory_name: formModel.factory_name.trim(),
    contact_person: formModel.contact_person.trim(),
    contact_phone: formModel.contact_phone,
  }
  submitting.value = true
  try {
    if (editing.value) {
      const env = await updateFactory(editing.value.id, payload)
      message.success(envSuccessText(env, '工厂信息已保存'))
    } else {
      const env = await createFactory(payload)
      message.success(envSuccessText(env, '新增工厂成功'))
    }
    showForm.value = false
    await tableRef.value?.refresh()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

const showImport = ref(false)
const importing = ref(false)
const templateDownloading = ref(false)
const importFileList = ref<UploadFileInfo[]>([])
const importResult = ref<FactoryImportResult | null>(null)
const importFailures = computed(
  () => importResult.value?.results.filter((item) => !item.success) ?? [],
)
const importFailureColumns: DataTableColumns<FactoryImportRowResult> = [
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
    const filename = await downloadFactoryTemplate()
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
    const result = await importFactories(data)
    importResult.value = result
    if (result.failed > 0) message.warning(`导入完成：成功 ${result.success} 条，失败 ${result.failed} 条`)
    else message.success(`导入成功 ${result.success} 条`)
    await tableRef.value?.refresh()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '工厂导入失败，请稍后重试')
  } finally {
    importing.value = false
  }
}

</script>

<template>
  <div class="stp-page">
    <n-card class="query-card" :bordered="false">
      <QueryBar>
        <QueryField label="公司编码">
          <n-input v-model:value="filter.company_code" clearable placeholder="请输入公司编码" @keydown.enter="handleSearch" />
        </QueryField>
        <QueryField label="公司名称">
          <n-input v-model:value="filter.company_name" clearable placeholder="请输入公司名称" @keydown.enter="handleSearch" />
        </QueryField>
        <QueryField label="工厂编码">
          <n-input v-model:value="filter.factory_code" clearable placeholder="请输入工厂编码" @keydown.enter="handleSearch" />
        </QueryField>
        <QueryField label="工厂名称">
          <n-input v-model:value="filter.factory_name" clearable placeholder="请输入工厂名称" @keydown.enter="handleSearch" />
        </QueryField>
        <QueryField v-show="filterExpanded" label="工厂联系人">
          <n-input v-model:value="filter.contact_person" clearable placeholder="请输入联系人" @keydown.enter="handleSearch" />
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
          工厂仅维护公司归属、基本信息和工厂联系人；仓库及具体地址请在“发运地点管理”中维护
        </span>
        <div class="table-toolbar__actions">
          <n-button :loading="exporting" @click="handleExport">导出</n-button>
          <n-button @click="openImport">Excel 导入</n-button>
          <n-button type="primary" @click="openForm(null)">新增工厂</n-button>
        </div>
      </div>
      <PageTable
        ref="tableRef"
        :columns="columns"
        :remote="fetchFactories"
        :query="applied"
        :scroll-x="1200"
      />
    </n-card>

    <n-modal
      v-model:show="showImport"
      preset="card"
      title="导入工厂"
      :bordered="false"
      :style="{ width: '640px', maxWidth: '94vw' }"
      :mask-closable="!importing"
      :closable="!importing"
    >
      <div class="factory-import">
        <div class="factory-import__template">
          <span>请按模板填写工厂信息，仅支持 .xlsx 文件。每行独立校验，失败行不影响其他数据。</span>
          <n-button text type="primary" :loading="templateDownloading" @click="handleTemplateDownload">
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
        <n-alert v-if="importResult" :type="importResult.failed > 0 ? 'warning' : 'success'" :show-icon="false">
          导入结果：共 {{ importResult.total }} 条，成功 {{ importResult.success }} 条，失败 {{ importResult.failed }} 条
        </n-alert>
        <n-data-table
          v-if="importFailures.length"
          size="small"
          :columns="importFailureColumns"
          :data="importFailures"
          :row-key="(row: FactoryImportRowResult) => row.row"
          :max-height="240"
          :bordered="false"
        />
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button type="primary" :loading="importing" :disabled="!importFileList.length" @click="submitImport">
            开始导入
          </n-button>
          <n-button :disabled="importing" @click="showImport = false">
            {{ importResult ? '关闭' : '取消' }}
          </n-button>
        </div>
      </template>
    </n-modal>

    <n-drawer v-model:show="showDetail" :width="'min(860px, 94vw)'" placement="right">
      <n-drawer-content title="工厂详情" closable :native-scrollbar="false">
        <div v-if="detailRow" class="factory-detail">
          <DetailSection title="公司与工厂" :column="2">
            <n-descriptions-item label="公司编码">{{ detailRow.company_code }}</n-descriptions-item>
            <n-descriptions-item label="公司名称">{{ detailRow.company_name }}</n-descriptions-item>
            <n-descriptions-item label="工厂编码">{{ detailRow.factory_code }}</n-descriptions-item>
            <n-descriptions-item label="工厂名称">{{ detailRow.factory_name }}</n-descriptions-item>
            <n-descriptions-item label="工厂联系人">{{ detailRow.contact_person }}</n-descriptions-item>
            <n-descriptions-item label="联系人电话">{{ formatPhone(detailRow.contact_phone) }}</n-descriptions-item>
          </DetailSection>
          <DetailSection title="审计信息" :column="2">
            <n-descriptions-item label="创建人">{{ detailRow.create_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="创建时间">{{ datetime(detailRow.create_time) }}</n-descriptions-item>
            <n-descriptions-item label="更新人">{{ detailRow.update_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="更新时间">{{ datetime(detailRow.update_time) }}</n-descriptions-item>
          </DetailSection>
        </div>
      </n-drawer-content>
    </n-drawer>

    <n-modal
      v-model:show="showForm"
      preset="card"
      size="huge"
      :bordered="false"
      :title="editing ? '编辑工厂' : '新增工厂'"
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
        <n-form-item label="公司编码" path="company_code">
          <n-input v-model:value="formModel.company_code" :maxlength="32" clearable :disabled="submitting" placeholder="请输入公司编码" />
        </n-form-item>
        <n-form-item label="公司名称" path="company_name">
          <n-input v-model:value="formModel.company_name" :maxlength="128" clearable :disabled="submitting" placeholder="请输入公司名称" />
        </n-form-item>
        <n-form-item label="工厂编码" path="factory_code">
          <div class="readonly-field">
            <n-input v-model:value="formModel.factory_code" :maxlength="32" clearable :disabled="submitting" placeholder="请输入工厂编码" />
            <span class="field-tip">工厂编码全局唯一，新增后仍可在编辑时调整</span>
          </div>
        </n-form-item>
        <n-form-item label="工厂名称" path="factory_name">
          <n-input v-model:value="formModel.factory_name" :maxlength="128" clearable :disabled="submitting" placeholder="请输入工厂名称" />
        </n-form-item>
        <n-form-item label="工厂联系人" path="contact_person">
          <n-input v-model:value="formModel.contact_person" :maxlength="64" clearable :disabled="submitting" placeholder="请输入工厂联系人" />
        </n-form-item>
        <n-form-item label="联系人电话" path="contact_phone">
          <div class="readonly-field">
            <PhoneInput ref="phoneRef" v-model="formModel.contact_phone" :disabled="submitting" placeholder="请输入工厂联系人电话" />
            <span class="field-tip">默认中国 +86，支持手机、座机和 400/800 电话</span>
          </div>
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button type="primary" :loading="submitting" @click="submitForm">
            {{ editing ? '保存' : '新增工厂' }}
          </n-button>
          <n-button :disabled="submitting" @click="showForm = false">取消</n-button>
        </div>
      </template>
    </n-modal>

  </div>
</template>

<style scoped>
.factory-import {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.factory-import__template {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: #666666;
  font-size: 13px;
}

.table-toolbar__actions {
  display: flex;
  gap: 8px;
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

.factory-detail > :last-child {
  margin-bottom: 0;
}
</style>
