<script setup lang="ts">
/**
 * 基础数据 - 承运商管理（契约 5.2 / 既有需求 9）
 *
 * - 列表：编码/名称/联系人/电话/合作路线/在册司机/状态/备注/创建日期 + 筛选（关键字/状态）
 * - 新增/编辑：编码 CAR-XXX 系统自动生成只读；名称必填（后端去重 A0002）；
 *   联系人必填；联系电话 PhoneInput（E.164）
 * - 停用/启用：ConfirmAction 二次确认；停用后不可被派单、不影响在途运单
 */
import { computed, h, reactive, ref } from 'vue'
import type { DataTableColumns, FormInst, FormRules, SelectOption } from 'naive-ui'
import { NButton } from 'naive-ui'
import { useMessage } from 'naive-ui'
import PageTable from '@/components/PageTable.vue'
import StatusTag from '@/components/StatusTag.vue'
import ConfirmAction from '@/components/ConfirmAction.vue'
import PhoneInput from '@/components/PhoneInput.vue'
import { createCarrier, listCarriers, updateCarrier, updateCarrierStatus } from '@/services/carriers'
import { dateOnly, formatPhone } from '@/utils/format'
import type { Carrier, CarrierPayload, CarrierStatus } from '@/types/api'

/** PageTable 实例句柄（refresh=保持当前页刷新，reload=回第一页） */
interface PageTableHandle {
  reload: () => Promise<void>
  refresh: () => Promise<void>
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

// ---------------- 筛选 ----------------
const filter = reactive<{ keyword: string; status: string | number }>({
  keyword: '',
  status: '', // '' 全部 / 1 合作中 / 0 已停用
})

const statusOptions: SelectOption[] = [
  { label: '全部', value: '' },
  { label: '合作中', value: 1 },
  { label: '已停用', value: 0 },
]

/** 已应用的查询（查询按钮触发替换；_t 强制 PageTable 重新请求） */
type AppliedQuery = { keyword?: string; status?: CarrierStatus; _t: number }
const applied = ref<AppliedQuery>({ _t: 0 })

function buildAppliedQuery(): AppliedQuery {
  return {
    keyword: filter.keyword.trim() || undefined,
    status: filter.status === '' ? undefined : (Number(filter.status) as CarrierStatus),
    _t: Date.now(),
  }
}

function handleSearch() {
  applied.value = buildAppliedQuery()
}

function handleReset() {
  filter.keyword = ''
  filter.status = ''
  applied.value = buildAppliedQuery()
}

// ---------------- 列表 ----------------
const tableRef = ref<PageTableHandle | null>(null)

async function fetchCarriers({ page, pageSize }: { page: number; pageSize: number }) {
  return listCarriers({ page, size: pageSize, ...applied.value })
}

const columns: DataTableColumns<Carrier> = [
  { title: '承运商编码', key: 'carrier_code', width: 108 },
  { title: '承运商名称', key: 'carrier_name', width: 170, ellipsis: { tooltip: true } },
  { title: '联系人', key: 'contact_person', width: 96 },
  {
    title: '联系电话',
    key: 'contact_phone',
    width: 150,
    render: (row) => formatPhone(row.contact_phone),
  },
  {
    title: '合作路线',
    key: 'cooperation_routes',
    width: 150,
    ellipsis: { tooltip: true },
    render: (row) => row.cooperation_routes || '-',
  },
  {
    title: '在册司机',
    key: 'driver_count',
    width: 86,
    render: (row) => String(row.driver_count ?? 0),
  },
  {
    title: '状态',
    key: 'status',
    width: 92,
    render: (row) => h(StatusTag, { type: 'carrier', value: row.status }),
  },
  {
    title: '备注',
    key: 'remark',
    minWidth: 140,
    ellipsis: { tooltip: true },
    render: (row) => row.remark || '-',
  },
  {
    title: '创建日期',
    key: 'create_time',
    width: 104,
    render: (row) => dateOnly(row.create_time),
  },
  {
    title: '操作',
    key: 'actions',
    width: 76,
    fixed: 'right',
    render: (row) =>
      h('div', { class: 'row-actions' }, [
        h(
          NButton,
          { text: true, type: 'primary', onClick: () => openForm(row) },
          { default: () => '编辑' },
        ),
        h(
          NButton,
          {
            text: true,
            type: row.status === 1 ? 'error' : 'primary',
            onClick: () => openStatusConfirm(row),
          },
          { default: () => (row.status === 1 ? '停用' : '启用') },
        ),
      ]),
  },
]

// ---------------- 新增 / 编辑弹窗 ----------------
const showForm = ref(false)
const editing = ref<Carrier | null>(null)
const submitting = ref(false)
const formRef = ref<FormInst | null>(null)
const phoneRef = ref<InstanceType<typeof PhoneInput> | null>(null)

const formModel = reactive({
  carrier_name: '',
  contact_person: '',
  contact_phone: '',
  cooperation_routes: '',
  remark: '',
})

const formRules: FormRules = {
  carrier_name: [
    { required: true, message: '请输入承运商名称', trigger: ['input', 'blur'] },
    { message: '承运商名称不能超过 128 字', trigger: ['input', 'blur'], validator: () => formModel.carrier_name.trim().length <= 128 },
  ],
  contact_person: [{ required: true, message: '请输入联系人', trigger: ['input', 'blur'] }],
  contact_phone: [
    { required: true, message: '请输入联系电话', trigger: ['input', 'blur'] },
    {
      message: '请输入有效的联系电话（默认中国 +86，支持手机/座机/400）',
      trigger: ['input', 'blur'],
      validator: () => (formModel.contact_phone ? (phoneRef.value?.isValid() ?? true) : true),
    },
  ],
}

function openForm(row: Carrier | null) {
  editing.value = row
  formModel.carrier_name = row?.carrier_name ?? ''
  formModel.contact_person = row?.contact_person ?? ''
  formModel.contact_phone = row?.contact_phone ?? ''
  formModel.cooperation_routes = row?.cooperation_routes ?? ''
  formModel.remark = row?.remark ?? ''
  showForm.value = true
}

async function submitForm() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  const payload: CarrierPayload = {
    carrier_name: formModel.carrier_name.trim(),
    contact_person: formModel.contact_person.trim(),
    contact_phone: formModel.contact_phone,
    cooperation_routes: formModel.cooperation_routes.trim() || null,
    remark: formModel.remark.trim() || null,
  }
  submitting.value = true
  try {
    if (editing.value) {
      const env = await updateCarrier(editing.value.id, payload)
      message.success(envSuccessText(env, '承运商信息已保存'))
    } else {
      const env = await createCarrier(payload)
      const code = env.data?.carrier_code
      message.success(
        envSuccessText(
          env,
          code ? `新增承运商成功，编码 ${code}（系统自动生成）` : '新增承运商成功',
        ),
      )
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
const statusTarget = ref<Carrier | null>(null)
const statusSubmitting = ref(false)

function openStatusConfirm(row: Carrier) {
  statusTarget.value = row
  showStatusConfirm.value = true
}

const statusConfirmTitle = computed(() =>
  statusTarget.value?.status === 1 ? '确认停用该承运商？' : '确认启用该承运商？',
)

const statusConfirmContent = computed(() => {
  const row = statusTarget.value
  if (!row) return ''
  if (row.status === 1) {
    return `停用后「${row.carrier_name}」不可再被派单（派单弹窗中将置灰不可选），不影响在途运单。`
  }
  return `启用后「${row.carrier_name}」恢复合作中状态，可正常接收新派单。`
})

async function confirmStatusChange() {
  const row = statusTarget.value
  if (!row) return
  const next: 1 | 0 = row.status === 1 ? 0 : 1
  statusSubmitting.value = true
  try {
    const env = await updateCarrierStatus(row.id, next)
    message.success(
      envSuccessText(
        env,
        next === 0
          ? `「${row.carrier_name}」已停用，不可再被派单`
          : `「${row.carrier_name}」已启用，可正常派单`,
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
</script>

<template>
  <div class="stp-page">
    <!-- 筛选栏 -->
    <n-card class="page-card" :bordered="false">
      <div class="page-card__filters">
        <div class="page-card__field">
          <span class="page-card__label">关键字</span>
          <n-input
            v-model:value="filter.keyword"
            class="page-card__input"
            clearable
            placeholder="名称 / 联系人 / 电话 / 编码"
            @keydown.enter="handleSearch"
          />
        </div>
        <div class="page-card__field">
          <span class="page-card__label">状态</span>
          <n-select v-model:value="filter.status" class="page-card__select" :options="statusOptions" />
        </div>
        <div class="page-card__actions">
          <n-button @click="handleReset">重置</n-button>
          <n-button type="primary" @click="handleSearch">查询</n-button>
        </div>
      </div>
    </n-card>

    <!-- 工具栏 -->
    <div class="page-toolbar">
      <span class="page-toolbar__hint">
        承运商编码由系统自动生成（CAR-XXX）；已停用的承运商不可被派单，在途运单不受影响
      </span>
      <n-button type="primary" @click="openForm(null)">新增承运商</n-button>
    </div>

    <!-- 列表 -->
    <n-card class="page-card" :bordered="false">
      <PageTable
        ref="tableRef"
        :columns="columns"
        :remote="fetchCarriers"
        :query="applied"
        :scroll-x="1160"
      />
    </n-card>

    <!-- 新增 / 编辑弹窗 -->
    <n-modal
      v-model:show="showForm"
      preset="card"
      :title="editing ? '编辑承运商' : '新增承运商'"
      class="form-modal"
      :style="{ width: '560px' }"
      :mask-closable="!submitting"
      :closable="!submitting"
    >
      <n-form
        ref="formRef"
        :model="formModel"
        :rules="formRules"
        label-placement="left"
        label-width="96"
        require-mark-placement="right-hanging"
      >
        <n-form-item label="承运商编码" path="carrier_code">
          <div class="readonly-field">
            <n-input :value="editing ? editing.carrier_code : '系统自动生成（CAR-XXX）'" disabled />
            <span class="field-tip">编码规则：CAR-三位序列号，系统自动生成，不可修改</span>
          </div>
        </n-form-item>
        <n-form-item label="承运商名称" path="carrier_name">
          <n-input
            v-model:value="formModel.carrier_name"
            :maxlength="128"
            clearable
            :disabled="submitting"
            placeholder="请输入承运商名称"
          />
        </n-form-item>
        <n-form-item label="联系人" path="contact_person">
          <n-input
            v-model:value="formModel.contact_person"
            :maxlength="30"
            clearable
            :disabled="submitting"
            placeholder="请输入联系人"
          />
        </n-form-item>
        <n-form-item label="联系电话" path="contact_phone">
          <div class="readonly-field">
            <PhoneInput
              ref="phoneRef"
              v-model="formModel.contact_phone"
              :disabled="submitting"
              placeholder="请输入联系电话"
            />
            <span class="field-tip">默认中国 +86：手机 11 位；座机为区号+8 位号码；400/800 十位，点击国旗可切换国家</span>
          </div>
        </n-form-item>
        <n-form-item label="合作路线" path="cooperation_routes">
          <n-input
            v-model:value="formModel.cooperation_routes"
            :maxlength="512"
            clearable
            :disabled="submitting"
            placeholder="如：合肥—华东、合肥—华南"
          />
        </n-form-item>
        <n-form-item label="备注" path="remark">
          <n-input
            v-model:value="formModel.remark"
            type="textarea"
            :rows="3"
            :maxlength="512"
            show-count
            :disabled="submitting"
            placeholder="选填"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="form-modal__footer">
          <n-button :disabled="submitting" @click="showForm = false">取 消</n-button>
          <n-button type="primary" :loading="submitting" @click="submitForm">
            {{ editing ? '保 存' : '新增承运商' }}
          </n-button>
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
      cancel-text="取 消"
      :loading="statusSubmitting"
      :auto-close="false"
      @confirm="confirmStatusChange"
    />
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
  width: 140px;
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

/* 列操作按钮竖排（render 函数内的元素无本组件 scopeId，需 :deep） */
:deep(.row-actions) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

/* 表单只读字段与提示 */
.readonly-field {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-tip {
  font-size: 12px;
  color: #8c8c8c;
  line-height: 1.5;
}

.form-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
