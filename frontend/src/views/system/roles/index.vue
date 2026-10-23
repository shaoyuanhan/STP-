<script setup lang="ts">
/**
 * 角色管理。功能权限按模块和按钮勾选，数据权限按承运商运单和物料类型（成品/散件）。
 */
import { computed, h, reactive, ref } from 'vue'
import type { DataTableColumns, FormInst, FormRules } from 'naive-ui'
import { NButton, useMessage } from 'naive-ui'
import PageTable from '@/components/PageTable.vue'
import {
  createRole, fetchMe, getProfile, getRole, listRoles, roleCatalog, saveRolePermissions, updateProfile, updateRole,
} from '@/services/portal'
import type { PermModule, RoleRow } from '@/services/portal'
import { datetimeFull } from '@/utils/format'
import { useSessionStore } from '@/stores/session'

interface PageTableHandle {
  refresh: () => Promise<void>
  total: number
  page: number
  pageSize: number
}

const message = useMessage()
const session = useSessionStore()
const tableRef = ref<PageTableHandle | null>(null)
const keyword = ref('')
const applied = ref({ keyword: '', _t: 0 })
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
const materialOptions = ref<Array<{ value: string; label: string }>>([])
const carrierOptions = ref<Array<{ label: string; value: number }>>([])
const checked = ref<string[]>([])
const carrierAll = ref(true)
const carrierIds = ref<number[]>([])
const materials = ref<string[]>(['FINISHED', 'LOOSE'])
const permSaving = ref(false)

const kindOrder = ['PLATFORM', 'CARRIER', 'DRIVER'] as const
const groupedModules = computed(() => kindOrder
  .map((kind) => ({
    kind,
    label: kindText[kind],
    modules: modules.value.filter((item) => item.kind === kind),
  }))
  .filter((group) => group.modules.length))

/** 当前端页签，默认定位到角色自身所属端 */
const activeKind = ref<(typeof kindOrder)[number]>('PLATFORM')
const activeGroup = computed(
  () => groupedModules.value.find((group) => group.kind === activeKind.value) ?? groupedModules.value[0] ?? null,
)

function moduleHit(mod: PermModule) {
  return mod.actions.filter((action) => checked.value.includes(action.code)).length
}

function kindStats(group: { kind: string; modules: PermModule[] } | null) {
  const total = group?.modules.reduce((sum, mod) => sum + mod.actions.length, 0) ?? 0
  const hit = group?.modules.reduce((sum, mod) => sum + moduleHit(mod), 0) ?? 0
  return { hit, total }
}

function toggleKind(kind: string, on: boolean) {
  const codes = modules.value
    .filter((mod) => mod.kind === kind)
    .flatMap((mod) => mod.actions.map((action) => action.code))
  checked.value = on
    ? [...new Set([...checked.value, ...codes])]
    : checked.value.filter((code) => !codes.includes(code))
}

function search() {
  applied.value = { keyword: keyword.value.trim(), _t: Date.now() }
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

async function openPerm(row: RoleRow) {
  permRole.value = row
  activeKind.value = row.role_kind === 'CARRIER' || row.role_kind === 'DRIVER' ? row.role_kind : 'PLATFORM'
  permOpen.value = true
  try {
    const [catalog, detail] = await Promise.all([roleCatalog(), getRole(row.id)])
    modules.value = catalog.modules
    materialOptions.value = catalog.materials
    carrierOptions.value = catalog.carriers.map((item) => ({ label: item.carrier_name, value: item.id }))
    checked.value = detail.permissions || []
    carrierAll.value = Boolean(detail.carrier_all)
    carrierIds.value = detail.carrier_ids || []
    materials.value = detail.materials?.length ? detail.materials : ['FINISHED', 'LOOSE']
  } catch (e) {
    message.error(e instanceof Error ? e.message : '权限加载失败')
  }
}

function toggleModule(mod: PermModule, on: boolean) {
  const codes = mod.actions.map((action) => action.code)
  checked.value = on
    ? [...new Set([...checked.value, ...codes])]
    : checked.value.filter((code) => !codes.includes(code))
}

function moduleOn(mod: PermModule) {
  return mod.actions.every((action) => checked.value.includes(action.code))
}

function moduleHalf(mod: PermModule) {
  const hit = mod.actions.filter((action) => checked.value.includes(action.code)).length
  return hit > 0 && hit < mod.actions.length
}

async function savePerm() {
  if (!permRole.value) return
  permSaving.value = true
  try {
    await saveRolePermissions(permRole.value.id, {
      permissions: checked.value,
      carrier_all: carrierAll.value,
      carrier_ids: carrierIds.value,
      materials: materials.value,
    })
    if (getProfile()?.role_id === permRole.value.id) {
      const profile = await fetchMe()
      updateProfile(profile)
      session.applyProfile()
    }
    message.success('权限已保存，当前账号已立即生效，其他账号重新登录后生效')
    permOpen.value = false
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    permSaving.value = false
  }
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
    width: 80,
    render: (row) =>
      h(
        'span',
        { class: Number(row.status) === 1 ? 'roles-status roles-status--on' : 'roles-status roles-status--off' },
        Number(row.status) === 1 ? '启用' : '停用',
      ),
  },
  { title: '更新时间', key: 'update_time', width: 170, render: (row) => (row.update_time ? datetimeFull(row.update_time) : '-') },
  {
    title: '操作',
    key: 'actions',
    width: 140,
    render: (row) => h('div', { style: 'display:flex;gap:8px' }, [
      h(NButton, { text: true, type: 'primary', onClick: () => openEdit(row) }, { default: () => '编辑' }),
      h(NButton, { text: true, type: 'primary', onClick: () => openPerm(row) }, { default: () => '配置权限' }),
    ]),
  },
]

/** 当前页实际展示条数（末页不足一页时按剩余条数） */
const pageShown = computed(() => {
  const table = tableRef.value
  if (!table) return 0
  const rest = table.total - (table.page - 1) * table.pageSize
  return Math.max(0, Math.min(table.pageSize, rest))
})

function remote({ page, pageSize }: { page: number; pageSize: number }) {
  return listRoles({ page, size: pageSize, keyword: applied.value.keyword || undefined })
}
</script>

<template>
  <div class="stp-page">
    <div class="stp-page__header">
      <h1 class="stp-page__title">角色管理</h1>
      <n-button type="primary" @click="openCreate">新增角色</n-button>
    </div>
    <div class="roles__filter">
      <n-input v-model:value="keyword" placeholder="角色名称 / 编码" clearable @keyup.enter="search" />
      <n-button @click="search">查询</n-button>
    </div>
    <div class="roles__bar">
      <span>共 <b>{{ tableRef?.total ?? 0 }}</b> 条记录，当前页显示 <b>{{ pageShown }}</b> 条</span>
      <span class="roles__bar-tip">功能权限控制模块和按钮 · 数据权限控制可见的承运商运单与物料类型（成品 / 散件）</span>
    </div>
    <PageTable ref="tableRef" :columns="columns" :remote="remote" :query="applied" :scroll-x="1080" />

    <n-modal v-model:show="show" preset="card" :title="editingId ? '编辑角色' : '新增角色'" style="width: 520px">
      <n-form ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="88">
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
        <n-form-item label="状态">
          <n-radio-group v-model:value="form.status">
            <n-radio :value="1">启用</n-radio>
            <n-radio :value="0">停用</n-radio>
          </n-radio-group>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="show = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-drawer v-model:show="permOpen" :width="800" placement="right">
      <n-drawer-content closable>
        <template #header>
          <div class="perm-head">
            <span class="perm-head__title">配置权限</span>
            <template v-if="permRole">
              <n-divider vertical />
              <span class="perm-head__role">{{ permRole.role_name }}</span>
              <n-tag size="small" :bordered="false" type="info">{{ kindText[permRole.role_kind] }}</n-tag>
            </template>
          </div>
        </template>

        <div class="perm-tabs">
          <n-tabs v-model:value="activeKind" type="line" animated>
            <n-tab-pane
              v-for="group in groupedModules"
              :key="group.kind"
              :name="group.kind"
              :tab="`${group.label} ${kindStats(group).hit}/${kindStats(group).total}`"
            />
          </n-tabs>
        </div>

        <div class="perm-panel">
          <div class="perm-panel__bar">
            <span class="perm-panel__summary">
              {{ activeGroup?.label }}功能权限 · 已选
              <b>{{ kindStats(activeGroup).hit }}</b> / {{ kindStats(activeGroup).total }} 项
            </span>
            <n-space :size="2" align="center">
              <n-button text type="primary" size="small" @click="toggleKind(activeKind, true)">全选</n-button>
              <n-divider vertical />
              <n-button text size="small" @click="toggleKind(activeKind, false)">清空</n-button>
            </n-space>
          </div>

          <div class="perm-list">
            <div
              v-for="mod in activeGroup?.modules ?? []"
              :key="mod.code"
              class="perm-mod"
              :class="{ 'is-on': moduleOn(mod) }"
            >
              <div class="perm-mod__head">
                <div class="perm-mod__name">
                  <n-checkbox
                    :checked="moduleOn(mod)"
                    :indeterminate="moduleHalf(mod)"
                    @update:checked="(on: boolean) => toggleModule(mod, on)"
                  />
                  <span class="perm-mod__title">{{ mod.name }}</span>
                </div>
                <span class="perm-mod__count">{{ moduleHit(mod) }}/{{ mod.actions.length }}</span>
              </div>
              <div class="perm-mod__actions">
                <n-checkbox-group v-model:value="checked">
                  <n-checkbox v-for="action in mod.actions" :key="action.code" :value="action.code">
                    {{ action.name }}
                  </n-checkbox>
                </n-checkbox-group>
              </div>
            </div>
            <n-empty v-if="!activeGroup" description="该端暂无可配置模块" size="small" />
          </div>
        </div>

        <div class="perm-section">
          <div class="perm-section__head">
            <span class="perm-section__title">数据权限</span>
            <span class="perm-section__hint">控制该角色可见的运单与物料范围</span>
          </div>
          <div class="perm-row">
            <div class="perm-row__label">承运商运单</div>
            <div class="perm-row__body">
              <n-radio-group v-model:value="carrierAll" :disabled="permRole?.role_kind !== 'PLATFORM' && permRole?.role_kind !== 'SUPER'">
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
              <p v-if="permRole?.role_kind === 'CARRIER'" class="perm-row__hint">
                承运商账号实际只能看到自己所属承运商，与这里的范围取交集。
              </p>
              <p v-if="permRole?.role_kind === 'DRIVER'" class="perm-row__hint">
                司机只在小程序查看分配给自己的任务，不按承运商列表展开。
              </p>
            </div>
          </div>
          <div class="perm-row">
            <div class="perm-row__label">物料类型</div>
            <div class="perm-row__body">
              <n-checkbox-group v-model:value="materials">
                <n-checkbox v-for="item in materialOptions" :key="item.value" :value="item.value">
                  {{ item.label }}
                </n-checkbox>
              </n-checkbox-group>
              <p class="perm-row__hint">未标注物料类型的历史运单仍可见。新运单标注成品或散件后，按这里的范围过滤。</p>
            </div>
          </div>
        </div>

        <template #footer>
          <div class="perm-footer">
            <span class="perm-footer__count">
              已选 <b>{{ checked.length }}</b> 项功能权限
            </span>
            <n-space :size="8">
              <n-button @click="permOpen = false">取消</n-button>
              <n-button type="primary" :loading="permSaving" @click="savePerm">保存权限</n-button>
            </n-space>
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<style scoped>
.roles__filter {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.roles__filter .n-input { width: 260px; }
.roles__bar {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  padding: 0 4px;
  color: #595959;
  font-size: 13px;
}
.roles__bar b {
  color: #262626;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.roles__bar-tip {
  margin-left: auto;
  color: #8c8c8c;
  font-size: 12px;
}
/* 表格 render 函数内的元素不带本组件 scoped 属性，用 :deep() 保证命中 */
:deep(.roles-code) {
  font-family: 'SF Mono', 'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace;
  font-variant-numeric: tabular-nums;
}
:deep(.roles-status) {
  white-space: nowrap;
}
:deep(.roles-status--on) {
  color: #389e0d;
}
:deep(.roles-status--off) {
  color: #8c8c8c;
}
.perm-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.perm-head__title {
  color: #262626;
  font-size: 15px;
  font-weight: 600;
}
.perm-head__role {
  color: #595959;
  font-size: 13px;
}
.perm-tabs {
  margin: -4px 0 12px;
  border-bottom: 1px solid #f0f0f0;
}
.perm-panel {
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  overflow: hidden;
}
.perm-panel__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 14px;
  background: #fafbfc;
  border-bottom: 1px solid #f0f0f0;
}
.perm-panel__summary {
  color: #595959;
  font-size: 13px;
}
.perm-panel__summary b {
  color: #1677ff;
  font-weight: 600;
}
.perm-list {
  max-height: 46vh;
  overflow-y: auto;
}
.perm-mod {
  padding: 12px 14px;
  border-bottom: 1px solid #f5f5f5;
}
.perm-mod:last-child {
  border-bottom: 0;
}
.perm-mod.is-on {
  background: #fafdff;
}
.perm-mod__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.perm-mod__name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.perm-mod__title {
  color: #262626;
  font-size: 13px;
  font-weight: 600;
}
.perm-mod__count {
  color: #bfbfbf;
  font-size: 12px;
}
.perm-mod__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  padding: 8px 0 0 24px;
}
.perm-section {
  margin-top: 16px;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
}
.perm-section__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 11px 14px;
  background: #fafbfc;
  border-bottom: 1px solid #f0f0f0;
}
.perm-section__title {
  color: #262626;
  font-size: 13px;
  font-weight: 600;
}
.perm-section__hint {
  color: #8c8c8c;
  font-size: 12px;
}
.perm-row {
  display: flex;
  gap: 16px;
  padding: 12px 14px;
  border-bottom: 1px solid #f5f5f5;
}
.perm-row:last-child {
  border-bottom: 0;
}
.perm-row__label {
  flex: none;
  width: 78px;
  padding-top: 2px;
  color: #595959;
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
  color: #8c8c8c;
  font-size: 12px;
  line-height: 1.6;
}
.perm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.perm-footer__count {
  color: #8c8c8c;
  font-size: 12px;
}
.perm-footer__count b {
  color: #1677ff;
  font-weight: 600;
}
</style>
