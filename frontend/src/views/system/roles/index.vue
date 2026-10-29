<script setup lang="ts">
/**
 * 角色管理。功能权限按模块和按钮勾选，数据权限按承运商运单范围配置。
 */
import { computed, h, reactive, ref } from 'vue'
import type { DataTableColumns, FormInst, FormRules, TreeOption } from 'naive-ui'
import { NButton, NDropdown, useMessage } from 'naive-ui'
import PageTable from '@/components/PageTable.vue'
import QueryBar from '@/components/QueryBar.vue'
import QueryField from '@/components/QueryField.vue'
import StatusTag from '@/components/StatusTag.vue'
import ConfirmAction from '@/components/ConfirmAction.vue'
import DetailSection from '@/components/DetailSection.vue'
import {
  createRole, fetchMe, getProfile, getRole, listRoles, roleCatalog, saveRoleDataScope, saveRolePermissions, updateProfile, updateRole,
} from '@/services/portal'
import type { PermModule, RoleRow } from '@/services/portal'
import { datetime } from '@/utils/format'
import { useSessionStore } from '@/stores/session'

interface PageTableHandle {
  refresh: () => Promise<void>
}

const message = useMessage()
const session = useSessionStore()
const tableRef = ref<PageTableHandle | null>(null)
const filters = reactive({
  role_name: '',
  role_code: '',
  role_kind: null as string | null,
  status: null as number | null,
})
const applied = ref({
  role_name: '',
  role_code: '',
  role_kind: null as string | null,
  status: null as number | null,
  _t: 0,
})
const show = ref(false)
const saving = ref(false)
const formRef = ref<FormInst | null>(null)
const editingId = ref<number | null>(null)
const form = reactive({
  role_code: '',
  role_name: '',
  role_kind: 'PLATFORM' as 'SUPER' | 'PLATFORM' | 'CARRIER' | 'DRIVER',
  remark: '',
  status: 1,
})
const rules: FormRules = {
  role_name: { required: true, message: '请填写角色名称', trigger: 'blur' },
}
const kindOptions = [
  { label: '超级管理员', value: 'SUPER' },
  { label: '平台后台', value: 'PLATFORM' },
  { label: '承运商后台', value: 'CARRIER' },
  { label: '司机小程序', value: 'DRIVER' },
]
const kindText: Record<string, string> = {
  SUPER: '超级管理员',
  PLATFORM: '平台后台',
  CARRIER: '承运商后台',
  DRIVER: '司机小程序',
}

const permOpen = ref(false)
const permRole = ref<RoleRow | null>(null)
const modules = ref<PermModule[]>([])
const carrierOptions = ref<Array<{ label: string; value: number }>>([])
const checked = ref<string[]>([])
const carrierAll = ref(true)
const carrierIds = ref<number[]>([])
const permSaving = ref(false)
const dataOpen = ref(false)
const dataRole = ref<RoleRow | null>(null)
const dataSaving = ref(false)
const detailOpen = ref(false)
const detailLoading = ref(false)
const detailRole = ref<RoleRow | null>(null)
const detailModules = ref<PermModule[]>([])
const detailCarriers = ref<Array<{ id: number; carrier_name: string }>>([])
const statusOpen = ref(false)
const statusTarget = ref<RoleRow | null>(null)
const statusSaving = ref(false)

const detailPermissions = computed(() => {
  const labels = new Map<string, string>(
    detailModules.value.flatMap((mod) =>
      mod.actions.map((action) => [action.code, `${mod.name} / ${action.name}`] as [string, string]),
    ),
  )
  return (detailRole.value?.permissions ?? []).map((code) => labels.get(code) || code)
})

const detailCarrierText = computed(() => {
  if (detailRole.value?.carrier_all) return '全部承运商'
  const names = new Map(detailCarriers.value.map((item) => [item.id, item.carrier_name]))
  const selected = (detailRole.value?.carrier_ids ?? []).map((id) => names.get(id) || `承运商 ${id}`)
  return selected.length ? selected.join('、') : '-'
})

/** 资源树分组（对齐侧栏菜单结构），承运商端 / 司机端单独成组 */
const MENU_GROUPS = [
  { key: 'g-dash', label: '工作台', mods: ['dashboard'] },
  { key: 'g-dispatch', label: '运输调度', mods: ['tasks', 'tracking'] },
  { key: 'g-freight', label: '应付运费', mods: ['freight'] },
  { key: 'g-esign', label: '电子签章', mods: ['esigns'] },
  { key: 'g-base', label: '基础数据', mods: ['carriers', 'drivers'] },
  { key: 'g-system', label: '系统管理', mods: ['accounts', 'roles', 'operationLogs'] },
  { key: 'g-carrier', label: '承运商后台', mods: ['portal-dashboard', 'portal-tasks', 'portal-drivers', 'portal-messages'] },
  { key: 'g-driver', label: '司机小程序', mods: ['mini-tasks', 'mini-messages'] },
] as const

/** 树数据：分组 → 模块 → 按钮（key 用模块 code / 按钮权限码） */
const treeData = computed<TreeOption[]>(() => MENU_GROUPS
  .map((group) => ({
    key: group.key,
    label: group.label,
    children: group.mods
      .map((code) => modules.value.find((mod) => mod.code === code))
      .filter((mod): mod is PermModule => Boolean(mod))
      .map((mod) => ({
        key: mod.code,
        label: mod.name,
        children: mod.actions.map((action) => ({ key: action.code, label: action.name })),
      })),
  }))
  .filter((group) => group.children.length))

const expandedKeys = ref<string[]>([])
const totalActions = computed(() => modules.value.reduce((sum, mod) => sum + mod.actions.length, 0))

/** 受控勾选集：叶子为按钮权限码，父级按「子级全选」推导补齐 */
const treeCheckedKeys = computed<string[]>(() => {
  const picked = new Set(checked.value)
  const keys = [...checked.value]
  for (const group of treeData.value) {
    const mods = group.children ?? []
    const full = mods.filter((mod) => (mod.children ?? []).every((leaf) => picked.has(String(leaf.key))))
    keys.push(...full.map((mod) => String(mod.key)))
    if (mods.length && full.length === mods.length) keys.push(String(group.key))
  }
  return keys
})

function onTreeChecked(keys: Array<string | number>) {
  const modCodes = new Set(modules.value.map((mod) => mod.code))
  const groupKeys = new Set<string>(MENU_GROUPS.map((group) => group.key))
  checked.value = keys
    .map(String)
    .filter((key) => !modCodes.has(key) && !groupKeys.has(key))
}

function checkAll(on: boolean) {
  checked.value = on ? modules.value.flatMap((mod) => mod.actions.map((action) => action.code)) : []
}

function search() {
  applied.value = {
    role_name: filters.role_name.trim(),
    role_code: filters.role_code.trim(),
    role_kind: filters.role_kind,
    status: filters.status,
    _t: Date.now(),
  }
}

function reset() {
  filters.role_name = ''
  filters.role_code = ''
  filters.role_kind = null
  filters.status = null
  search()
}

function openCreate() {
  editingId.value = null
  form.role_code = ''
  form.role_name = ''
  form.role_kind = 'PLATFORM'
  form.remark = ''
  form.status = 1
  show.value = true
}

function openEdit(row: RoleRow) {
  editingId.value = row.id
  form.role_code = row.role_code
  form.role_name = row.role_name
  form.role_kind = row.role_kind
  form.remark = row.remark || ''
  form.status = Number(row.status) === 1 ? 1 : 0
  show.value = true
}

async function save() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  saving.value = true
  try {
    const payload = {
      role_name: form.role_name.trim(),
      role_kind: form.role_kind,
      remark: form.remark.trim(),
      status: form.status,
    }
    if (editingId.value) await updateRole(editingId.value, payload)
    else await createRole(payload)
    message.success(editingId.value ? '角色已更新' : '角色已创建，请继续配置权限')
    show.value = false
    await tableRef.value?.refresh()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function openDetail(row: RoleRow) {
  detailRole.value = row
  detailOpen.value = true
  detailLoading.value = true
  try {
    const [catalog, detail] = await Promise.all([roleCatalog(), getRole(row.id)])
    detailModules.value = catalog.modules
    detailCarriers.value = catalog.carriers
    detailRole.value = detail
  } catch (e) {
    message.error(e instanceof Error ? e.message : '角色详情加载失败')
  } finally {
    detailLoading.value = false
  }
}

function openStatusConfirm(row: RoleRow) {
  statusTarget.value = row
  statusOpen.value = true
}

const statusConfirmTitle = computed(() =>
  Number(statusTarget.value?.status) === 1 ? '确认停用该角色？' : '确认启用该角色？',
)

const statusConfirmContent = computed(() => {
  const row = statusTarget.value
  if (!row) return ''
  return Number(row.status) === 1
    ? `停用后，绑定「${row.role_name}」的账号将无法正常使用该角色权限，确定停用吗？`
    : `启用后，绑定「${row.role_name}」的账号可恢复使用该角色权限，确定启用吗？`
})

async function confirmStatusChange() {
  const row = statusTarget.value
  if (!row) return
  const next = Number(row.status) === 1 ? 0 : 1
  statusSaving.value = true
  try {
    await updateRole(row.id, {
      role_name: row.role_name,
      role_kind: row.role_kind,
      remark: row.remark || '',
      status: next,
    })
    message.success(next === 1 ? '角色已启用' : '角色已停用')
    statusOpen.value = false
    await tableRef.value?.refresh()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '状态更新失败')
  } finally {
    statusSaving.value = false
  }
}

async function openPerm(row: RoleRow) {
  permRole.value = row
  permOpen.value = true
  try {
    const [catalog, detail] = await Promise.all([roleCatalog(), getRole(row.id)])
    modules.value = catalog.modules
    checked.value = detail.permissions || []
    expandedKeys.value = treeData.value.flatMap((group) => [
      String(group.key),
      ...(group.children ?? []).map((mod) => String(mod.key)),
    ])
  } catch (e) {
    message.error(e instanceof Error ? e.message : '权限加载失败')
  }
}

async function savePerm() {
  if (!permRole.value) return
  permSaving.value = true
  try {
    await saveRolePermissions(permRole.value.id, { permissions: checked.value })
    if (getProfile()?.role_id === permRole.value.id) {
      const profile = await fetchMe()
      updateProfile(profile)
      session.applyProfile()
    }
    message.success('功能权限已保存，当前账号已立即生效，其他账号重新登录后生效')
    permOpen.value = false
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    permSaving.value = false
  }
}

async function openDataPerm(row: RoleRow) {
  dataRole.value = row
  dataOpen.value = true
  try {
    const [catalog, detail] = await Promise.all([roleCatalog(), getRole(row.id)])
    carrierOptions.value = catalog.carriers.map((item) => ({ label: item.carrier_name, value: item.id }))
    carrierAll.value = Boolean(detail.carrier_all)
    carrierIds.value = detail.carrier_ids || []
  } catch (e) {
    message.error(e instanceof Error ? e.message : '数据权限加载失败')
  }
}

async function saveDataPerm() {
  if (!dataRole.value) return
  dataSaving.value = true
  try {
    await saveRoleDataScope(dataRole.value.id, {
      carrier_all: carrierAll.value,
      carrier_ids: carrierIds.value,
    })
    if (getProfile()?.role_id === dataRole.value.id) {
      const profile = await fetchMe()
      updateProfile(profile)
      session.applyProfile()
    }
    message.success('数据权限已保存，当前账号已立即生效，其他账号重新登录后生效')
    dataOpen.value = false
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    dataSaving.value = false
  }
}

function handleMoreAction(key: string | number, row: RoleRow) {
  if (key === 'permissions') openPerm(row)
  if (key === 'data') openDataPerm(row)
  if (key === 'status') openStatusConfirm(row)
}

const columns: DataTableColumns<RoleRow> = [
  { title: '角色名称', key: 'role_name', width: 160, ellipsis: { tooltip: true } },
  {
    title: '编码',
    key: 'role_code',
    width: 180,
    ellipsis: { tooltip: true },
    render: (row) => h('span', { class: 'roles-code' }, row.role_code),
  },
  { title: '类型', key: 'role_kind', width: 120, render: (row) => kindText[row.role_kind] || row.role_kind },
  { title: '说明', key: 'remark', minWidth: 220, ellipsis: { tooltip: true }, render: (row) => row.remark || '-' },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: (row) => h(StatusTag, { type: 'enable', value: row.status }),
  },
  { title: '更新时间', key: 'update_time', width: 180, render: (row) => (row.update_time ? datetime(row.update_time) : '-') },
  {
    title: '操作',
    key: 'actions',
    width: 180,
    align: 'center',
    fixed: 'right',
    render: (row) => h('div', { class: 'action-buttons' }, [
      h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openDetail(row) }, { default: () => '详情' }),
      h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openEdit(row) }, { default: () => '编辑' }),
      h(
        NDropdown,
        {
          trigger: 'click',
          placement: 'bottom-end',
          options: [
            { label: '功能权限', key: 'permissions' },
            { label: '数据权限', key: 'data' },
            ...(Number(row.builtin) === 1 && row.role_kind === 'SUPER'
              ? []
              : [{ label: Number(row.status) === 1 ? '停用' : '启用', key: 'status' }]),
          ],
          onSelect: (key: string | number) => handleMoreAction(key, row),
        },
        { default: () => h(NButton, { size: 'small', quaternary: true, type: 'primary' }, { default: () => '更多' }) },
      ),
    ]),
  },
]

function remote({ page, pageSize }: { page: number; pageSize: number }) {
  return listRoles({
    page,
    size: pageSize,
    role_name: applied.value.role_name || undefined,
    role_code: applied.value.role_code || undefined,
    role_kind: applied.value.role_kind || undefined,
    status: applied.value.status,
  })
}
</script>

<template>
  <div class="stp-page">
    <!-- 筛选栏 -->
    <n-card class="query-card" :bordered="false">
      <QueryBar>
        <QueryField label="角色名称">
          <n-input v-model:value="filters.role_name" clearable placeholder="请输入角色名称" @keydown.enter="search" />
        </QueryField>
        <QueryField label="角色编码">
          <n-input v-model:value="filters.role_code" clearable placeholder="如 CARRIER003" @keydown.enter="search" />
        </QueryField>
        <QueryField label="类型">
          <n-select v-model:value="filters.role_kind" placeholder="请选择类型" clearable :options="kindOptions" />
        </QueryField>
        <QueryField label="状态">
          <n-select
            v-model:value="filters.status"
            placeholder="请选择状态"
            clearable
            :options="[{ label: '启用', value: 1 }, { label: '停用', value: 0 }]"
          />
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
          功能权限控制模块和按钮 · 数据权限控制可见的承运商运单范围
        </span>
        <n-button type="primary" @click="openCreate">新增角色</n-button>
      </div>
      <PageTable ref="tableRef" :columns="columns" :remote="remote" :query="applied" :scroll-x="1150" />
    </n-card>

    <n-drawer v-model:show="detailOpen" :width="'min(760px, 94vw)'" placement="right">
      <n-drawer-content title="角色详情" closable :native-scrollbar="false">
        <n-spin :show="detailLoading">
          <template v-if="detailRole">
            <DetailSection title="角色信息" :column="2">
              <n-descriptions-item label="角色名称">{{ detailRole.role_name }}</n-descriptions-item>
              <n-descriptions-item label="角色编码">{{ detailRole.role_code }}</n-descriptions-item>
              <n-descriptions-item label="类型">{{ kindText[detailRole.role_kind] }}</n-descriptions-item>
              <n-descriptions-item label="状态">
                <StatusTag type="enable" :value="detailRole.status" />
              </n-descriptions-item>
              <n-descriptions-item label="说明" :span="2">{{ detailRole.remark || '-' }}</n-descriptions-item>
              <n-descriptions-item label="更新时间" :span="2">
                {{ detailRole.update_time ? datetime(detailRole.update_time) : '-' }}
              </n-descriptions-item>
            </DetailSection>
            <DetailSection title="功能权限" :column="1">
              <n-descriptions-item label="已配置权限">
                <n-space v-if="detailPermissions.length" :size="6">
                  <n-tag v-for="item in detailPermissions" :key="item" size="small" :bordered="false">
                    {{ item }}
                  </n-tag>
                </n-space>
                <span v-else>-</span>
              </n-descriptions-item>
            </DetailSection>
            <DetailSection title="数据权限" :column="1">
              <n-descriptions-item label="承运商运单">{{ detailCarrierText }}</n-descriptions-item>
            </DetailSection>
          </template>
        </n-spin>
      </n-drawer-content>
    </n-drawer>

    <n-modal v-model:show="show" preset="card" :title="editingId ? '编辑角色' : '新增角色'" style="width: 600px">
      <n-form ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="100" require-mark-placement="left">
        <n-form-item label="角色名称" path="role_name">
          <n-input v-model:value="form.role_name" />
        </n-form-item>
        <n-form-item label="角色编码">
          <n-input
            :value="editingId ? form.role_code : ''"
            disabled
            placeholder="保存后按类型自动生成，如 CARRIER003"
          />
        </n-form-item>
        <n-form-item label="类型">
          <n-select v-model:value="form.role_kind" :options="kindOptions" :disabled="Boolean(editingId)" />
        </n-form-item>
        <n-form-item label="说明">
          <n-input v-model:value="form.remark" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
          <n-button @click="show = false">取消</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-drawer v-model:show="permOpen" :width="640" placement="right">
      <n-drawer-content closable>
        <template #header>
          <div class="perm-head">
            <span class="perm-head__title">功能权限</span>
            <template v-if="permRole">
              <n-divider vertical />
              <span class="perm-head__role">{{ permRole.role_name }}</span>
              <n-tag size="small" :bordered="false" type="info">{{ kindText[permRole.role_kind] }}</n-tag>
            </template>
          </div>
        </template>

        <div class="perm-panel">
          <div class="perm-panel__bar">
            <span class="perm-panel__summary">
              已选 <b>{{ checked.length }}</b> / {{ totalActions }} 项
            </span>
            <n-space :size="2" align="center">
              <n-button text type="primary" size="small" @click="checkAll(true)">全选</n-button>
              <n-divider vertical />
              <n-button text size="small" @click="checkAll(false)">清空</n-button>
            </n-space>
          </div>
          <n-tree
            v-model:expanded-keys="expandedKeys"
            :checked-keys="treeCheckedKeys"
            :data="treeData"
            checkable
            cascade
            :selectable="false"
            block-line
            expand-on-click
            :indent="20"
            class="perm-panel__tree"
            @update:checked-keys="onTreeChecked"
          />
        </div>

        <template #footer>
          <div class="perm-footer">
            <span class="perm-footer__count">
              已选 <b>{{ checked.length }}</b> 项功能权限
            </span>
            <n-space :size="8">
              <n-button @click="permOpen = false">取消</n-button>
              <n-button type="primary" :loading="permSaving" @click="savePerm">保存功能权限</n-button>
            </n-space>
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>

    <n-drawer v-model:show="dataOpen" :width="560" placement="right">
      <n-drawer-content closable>
        <template #header>
          <div class="perm-head">
            <span class="perm-head__title">数据权限</span>
            <template v-if="dataRole">
              <n-divider vertical />
              <span class="perm-head__role">{{ dataRole.role_name }}</span>
              <n-tag size="small" :bordered="false" type="info">{{ kindText[dataRole.role_kind] }}</n-tag>
            </template>
          </div>
        </template>

        <div class="perm-section">
          <div class="perm-section__head">
            <span class="perm-section__title">可见数据范围</span>
            <span class="perm-section__hint">控制该角色可见的承运商运单范围</span>
          </div>
          <div class="perm-row">
            <div class="perm-row__label">承运商运单</div>
            <div class="perm-row__body">
              <n-radio-group v-model:value="carrierAll" :disabled="dataRole?.role_kind !== 'PLATFORM' && dataRole?.role_kind !== 'SUPER'">
                <n-radio :value="true">全部承运商</n-radio>
                <n-radio :value="false">指定承运商</n-radio>
              </n-radio-group>
              <n-select
                v-if="!carrierAll"
                v-model:value="carrierIds"
                multiple
                filterable
                :options="carrierOptions"
                placeholder="选择可查看运单的承运商"
                class="perm-row__select"
              />
              <p v-if="dataRole?.role_kind === 'CARRIER'" class="perm-row__hint">
                承运商账号实际只能看到自己所属承运商，与这里的范围取交集。
              </p>
              <p v-if="dataRole?.role_kind === 'DRIVER'" class="perm-row__hint">
                司机只在小程序查看分配给自己的任务，不按承运商列表展开。
              </p>
            </div>
          </div>
        </div>

        <template #footer>
          <div class="perm-footer">
            <span class="perm-footer__count">仅更新数据权限，不影响功能权限</span>
            <n-space :size="8">
              <n-button @click="dataOpen = false">取消</n-button>
              <n-button type="primary" :loading="dataSaving" @click="saveDataPerm">保存数据权限</n-button>
            </n-space>
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>

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

<style scoped>
/* 表格 render 函数内的元素不带本组件 scoped 属性，用 :deep() 保证命中 */
:deep(.roles-code) {
  font-family: 'SF Mono', 'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace;
  font-variant-numeric: tabular-nums;
}
:deep(.roles-status) {
  white-space: nowrap;
}
:deep(.roles-status--on) {
  color: #18a058;
}
:deep(.roles-status--off) {
  color: #999999;
}
/* ---- 配置权限抽屉 ---- */
.perm-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.perm-head__title {
  color: #2d3033;
  font-size: 15px;
  font-weight: 600;
}
.perm-head__role {
  color: #666666;
  font-size: 13px;
}
.perm-panel {
  border: 1px solid #eeeeee;
  border-radius: 4px;
  overflow: hidden;
}
.perm-panel__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 14px;
  background: #f5f6fb;
  border-bottom: 1px solid #eeeeee;
}
.perm-panel__summary {
  color: #666666;
  font-size: 13px;
}
.perm-panel__summary b {
  color: #1890ff;
  font-weight: 600;
}
.perm-panel__tree {
  height: 52vh;
  padding: 6px 2px;
  overflow: auto;
  box-sizing: border-box;
}
.perm-section {
  margin-top: 0;
  border: 1px solid #eeeeee;
  border-radius: 4px;
}
.perm-section__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 11px 14px;
  background: #f5f6fb;
  border-bottom: 1px solid #eeeeee;
}
.perm-section__title {
  color: #2d3033;
  font-size: 13px;
  font-weight: 600;
}
.perm-section__hint {
  color: #999999;
  font-size: 12px;
}
.perm-row {
  display: flex;
  gap: 16px;
  padding: 12px 14px;
  border-bottom: 1px solid #eeeeee;
}
.perm-row:last-child {
  border-bottom: 0;
}
.perm-row__label {
  flex: none;
  width: 78px;
  padding-top: 2px;
  color: #666666;
  font-size: 13px;
}
.perm-row__body {
  flex: 1;
  min-width: 0;
}
.perm-row__select {
  margin-top: 10px;
}
.perm-row__hint {
  margin: 8px 0 0;
  color: #999999;
  font-size: 12px;
  line-height: 1.6;
}
.perm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.perm-footer__count {
  color: #999999;
  font-size: 12px;
}
.perm-footer__count b {
  color: #1890ff;
  font-weight: 600;
}
</style>
