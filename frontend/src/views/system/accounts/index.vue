<script setup lang="ts">
/**
 * 账号与角色。平台管理员按登录人配置角色：
 * 平台管理员、承运商管理员、承运商调度进入同一套后台；司机只能登录小程序。
 */
import { computed, h, reactive, ref } from 'vue'
import type { DataTableColumns, FormInst, FormRules, SelectOption } from 'naive-ui'
import { NButton, useMessage } from 'naive-ui'
import PageTable from '@/components/PageTable.vue'
import QueryBar from '@/components/QueryBar.vue'
import QueryField from '@/components/QueryField.vue'
import StatusTag from '@/components/StatusTag.vue'
import ConfirmAction from '@/components/ConfirmAction.vue'
import DetailSection from '@/components/DetailSection.vue'
import { listCarriers } from '@/services/carriers'
import { listDrivers } from '@/services/drivers'
import {
  createAccount, listAccounts, listRoles, updateAccount,
} from '@/services/portal'
import type { AccountRow, RoleRow } from '@/services/portal'
import { datetime, formatPhone } from '@/utils/format'

interface PageTableHandle {
  reload: () => Promise<void>
  refresh: () => Promise<void>
}

const message = useMessage()
const KIND_TEXT: Record<string, string> = {
  SUPER: '超级管理员',
  PLATFORM: '平台后台',
  CARRIER: '承运商后台',
  DRIVER: '司机小程序',
}
const tableRef = ref<PageTableHandle | null>(null)
const filters = reactive({
  username: '',
  display_name: '',
  phone: '',
})
const applied = ref({ username: '', display_name: '', phone: '', _t: 0 })
const show = ref(false)
const saving = ref(false)
const formRef = ref<FormInst | null>(null)
const editingId = ref<number | null>(null)
const carrierOptions = ref<SelectOption[]>([])
const driverOptions = ref<SelectOption[]>([])
const roles = ref<RoleRow[]>([])
const detailOpen = ref(false)
const detailRow = ref<AccountRow | null>(null)
const statusOpen = ref(false)
const statusTarget = ref<AccountRow | null>(null)
const statusSaving = ref(false)

const form = reactive({
  username: '',
  display_name: '',
  phone: '',
  password: '',
  role_id: null as number | null,
  carrier_id: null as number | null,
  driver_id: null as number | null,
  status: 1,
})

const rules: FormRules = {
  display_name: { required: true, message: '请填写姓名', trigger: 'blur' },
  phone: { required: true, message: '请填写手机号', trigger: 'blur' },
  role_id: { required: true, type: 'number', message: '请选择角色', trigger: 'change' },
}

const roleOptions = computed(() => roles.value
  .filter((item) => item.role_kind !== 'DRIVER')
  .map((item) => ({
    label: `${item.role_name}（${KIND_TEXT[item.role_kind || ''] || '平台后台'}）`,
    value: item.id,
  })))
const currentRole = computed(() => roles.value.find((item) => item.id === form.role_id) ?? null)

function search() {
  applied.value = {
    username: filters.username.trim(),
    display_name: filters.display_name.trim(),
    phone: filters.phone.trim(),
    _t: Date.now(),
  }
}

function reset() {
  filters.username = ''
  filters.display_name = ''
  filters.phone = ''
  search()
}

async function loadOptions() {
  const [carriers, drivers, rolePage] = await Promise.all([
    listCarriers({ page: 1, size: 100 }),
    listDrivers({ page: 1, size: 100 }),
    listRoles({ page: 1, size: 100 }),
  ])
  roles.value = rolePage.list.filter((item) => Number(item.status) === 1)
  carrierOptions.value = carriers.list.map((item) => ({ label: item.carrier_name, value: item.id }))
  driverOptions.value = drivers.list.map((item) => ({
    label: `${item.name} ${item.phone}`,
    value: item.id,
  }))
}

function resetForm() {
  form.username = ''
  form.display_name = ''
  form.phone = ''
  form.password = ''
  form.role_id = null
  form.carrier_id = null
  form.driver_id = null
  form.status = 1
}

async function openCreate() {
  editingId.value = null
  resetForm()
  show.value = true
  try {
    await loadOptions()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '选项加载失败')
  }
}

async function openEdit(row: AccountRow) {
  if (row.role_kind === 'DRIVER') {
    message.info('司机账号由系统按司机档案自动生成，请在司机管理中启用/停用')
    return
  }
  editingId.value = row.id
  form.username = row.username || ''
  form.display_name = row.display_name
  form.phone = row.phone
  form.password = ''
  form.role_id = row.role_id ?? null
  form.carrier_id = row.carrier_id ?? null
  form.driver_id = row.driver_id ?? null
  form.status = Number(row.status) === 1 ? 1 : 0
  show.value = true
  try {
    await loadOptions()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '选项加载失败')
  }
}

async function save() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  if (!editingId.value && form.password.trim().length < 6) {
    message.warning('密码至少 6 位')
    return
  }
  saving.value = true
  try {
    const payload = {
      username: form.username.trim(),
      display_name: form.display_name.trim(),
      phone: form.phone.trim(),
      password: form.password.trim(),
      role_id: form.role_id,
      carrier_id: form.carrier_id,
      driver_id: form.driver_id,
      status: form.status,
    }
    if (editingId.value) await updateAccount(editingId.value, payload)
    else await createAccount(payload)
    message.success(editingId.value ? '账号已更新' : '账号已创建')
    show.value = false
    await tableRef.value?.refresh()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

function openDetail(row: AccountRow) {
  detailRow.value = row
  detailOpen.value = true
}

function openStatusConfirm(row: AccountRow) {
  statusTarget.value = row
  statusOpen.value = true
}

const statusConfirmTitle = computed(() =>
  Number(statusTarget.value?.status) === 1 ? '确认停用该账号？' : '确认启用该账号？',
)

const statusConfirmContent = computed(() => {
  const row = statusTarget.value
  if (!row) return ''
  return Number(row.status) === 1
    ? `停用后「${row.display_name}」将无法登录系统，确定停用吗？`
    : `启用后「${row.display_name}」可恢复登录系统，确定启用吗？`
})

async function confirmStatusChange() {
  const row = statusTarget.value
  if (!row) return
  const next = Number(row.status) === 1 ? 0 : 1
  statusSaving.value = true
  try {
    await updateAccount(row.id, {
      username: row.username || '',
      display_name: row.display_name,
      phone: row.phone,
      role_id: row.role_id,
      carrier_id: row.carrier_id,
      driver_id: row.driver_id,
      status: next,
    })
    message.success(next === 1 ? '账号已启用' : '账号已停用')
    statusOpen.value = false
    await tableRef.value?.refresh()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '状态更新失败')
  } finally {
    statusSaving.value = false
  }
}

const columns: DataTableColumns<AccountRow> = [
  { title: '登录账号', key: 'username', width: 120, render: (row) => row.username || '-' },
  { title: '姓名', key: 'display_name', width: 120 },
  { title: '手机号', key: 'phone', width: 150, render: (row) => formatPhone(row.phone) },
  { title: '角色', key: 'role_name', width: 140, ellipsis: { tooltip: true }, render: (row) => row.role_name || '-' },
  {
    title: '所属',
    key: 'owner',
    minWidth: 160,
    render: (row) => row.carrier_name || row.driver_name || '-',
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: (row) => h(StatusTag, { type: 'enable', value: row.status }),
  },
  {
    title: '最近登录',
    key: 'last_login_time',
    width: 180,
    render: (row) => (row.last_login_time ? datetime(row.last_login_time) : '-'),
  },
  {
    title: '操作',
    key: 'actions',
    width: 210,
    align: 'center',
    fixed: 'right',
    render: (row) =>
      h('div', { class: 'action-buttons' }, [
        h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openDetail(row) }, { default: () => '详情' }),
        ...(row.role_kind === 'DRIVER'
          ? []
          : [
              h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openEdit(row) }, { default: () => '编辑' }),
              h(
                NButton,
                {
                  size: 'small',
                  quaternary: true,
                  type: Number(row.status) === 1 ? 'error' : 'primary',
                  onClick: () => openStatusConfirm(row),
                },
                { default: () => (Number(row.status) === 1 ? '停用' : '启用') },
              ),
            ]),
      ]),
  },
]

function remote({ page, pageSize }: { page: number; pageSize: number }) {
  return listAccounts({
    page,
    size: pageSize,
    username: applied.value.username || undefined,
    display_name: applied.value.display_name || undefined,
    phone: applied.value.phone || undefined,
  })
}
</script>

<template>
  <div class="stp-page">
    <!-- 筛选栏 -->
    <n-card class="query-card" :bordered="false">
      <QueryBar>
        <QueryField label="登录账号">
          <n-input v-model:value="filters.username" clearable placeholder="请输入登录账号" @keydown.enter="search" />
        </QueryField>
        <QueryField label="姓名">
          <n-input v-model:value="filters.display_name" clearable placeholder="请输入姓名" @keydown.enter="search" />
        </QueryField>
        <QueryField label="手机号">
          <n-input v-model:value="filters.phone" clearable placeholder="请输入手机号" @keydown.enter="search" />
        </QueryField>
        <template #actions>
          <n-button @click="reset">重置</n-button>
          <n-button type="primary" @click="search">查询</n-button>
        </template>
      </QueryBar>
    </n-card>

    <!-- 列表 -->
    <n-card class="table-card" :bordered="false">
      <div class="table-toolbar">
        <span class="table-toolbar__hint">
          账号只绑定一个角色；可见模块、按钮与承运商运单范围在角色管理里配置
        </span>
        <n-button type="primary" @click="openCreate">新增账号</n-button>
      </div>
      <PageTable ref="tableRef" :columns="columns" :remote="remote" :query="applied" :scroll-x="1060" />
    </n-card>

    <n-drawer v-model:show="detailOpen" :width="'min(720px, 94vw)'" placement="right">
      <n-drawer-content title="账号详情" closable :native-scrollbar="false">
        <template v-if="detailRow">
          <DetailSection title="账号信息" :column="2">
            <n-descriptions-item label="登录账号">{{ detailRow.username || '-' }}</n-descriptions-item>
            <n-descriptions-item label="姓名">{{ detailRow.display_name }}</n-descriptions-item>
            <n-descriptions-item label="手机号">{{ formatPhone(detailRow.phone) }}</n-descriptions-item>
            <n-descriptions-item label="状态">
              <StatusTag type="enable" :value="detailRow.status" />
            </n-descriptions-item>
            <n-descriptions-item label="最近登录">
              {{ detailRow.last_login_time ? datetime(detailRow.last_login_time) : '-' }}
            </n-descriptions-item>
          </DetailSection>
          <DetailSection title="角色与归属" :column="2">
            <n-descriptions-item label="角色">{{ detailRow.role_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="角色类型">
              {{ KIND_TEXT[detailRow.role_kind || ''] || '-' }}
            </n-descriptions-item>
            <n-descriptions-item label="所属承运商">{{ detailRow.carrier_name || '-' }}</n-descriptions-item>
            <n-descriptions-item label="关联司机">{{ detailRow.driver_name || '-' }}</n-descriptions-item>
          </DetailSection>
        </template>
      </n-drawer-content>
    </n-drawer>

    <n-modal v-model:show="show" preset="card" :title="editingId ? '编辑账号' : '新增账号'" style="width: 600px">
      <n-form ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="100" require-mark-placement="left">
        <n-form-item label="角色" path="role_id">
          <n-select v-model:value="form.role_id" :options="roleOptions" filterable placeholder="选择角色" />
        </n-form-item>
        <n-form-item v-if="currentRole?.role_kind === 'CARRIER'" label="承运商">
          <n-select v-model:value="form.carrier_id" :options="carrierOptions" filterable placeholder="选择承运商" />
        </n-form-item>
        <n-form-item v-if="currentRole?.role_kind === 'DRIVER'" label="司机">
          <n-select v-model:value="form.driver_id" :options="driverOptions" filterable placeholder="选择司机" />
        </n-form-item>
        <n-form-item label="登录账号">
          <n-input v-model:value="form.username" placeholder="选填，也可直接用手机号登录" />
        </n-form-item>
        <n-form-item label="姓名" path="display_name">
          <n-input v-model:value="form.display_name" />
        </n-form-item>
        <n-form-item label="手机号" path="phone">
          <n-input v-model:value="form.phone" placeholder="11 位手机号" />
        </n-form-item>
        <n-form-item :label="editingId ? '重置密码' : '密码'">
          <n-input v-model:value="form.password" type="password" show-password-on="click" :placeholder="editingId ? '不修改请留空' : '至少 6 位'" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
          <n-button @click="show = false">取消</n-button>
        </n-space>
      </template>
    </n-modal>

    <ConfirmAction
      v-model:show="statusOpen"
      :type="Number(statusTarget?.status) === 1 ? 'error' : 'default'"
      :title="statusConfirmTitle"
      :content="statusConfirmContent"
      :confirm-text="Number(statusTarget?.status) === 1 ? '确认停用' : '确认启用'"
      :loading="statusSaving"
      :auto-close="false"
      @confirm="confirmStatusChange"
    />
  </div>
</template>

<style scoped></style>
