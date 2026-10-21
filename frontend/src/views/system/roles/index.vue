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
  role_kind: 'PLATFORM' as 'PLATFORM' | 'CARRIER' | 'DRIVER',
  remark: '',
  status: 1,
})
const rules: FormRules = {
  role_name: { required: true, message: '请填写角色名称', trigger: 'blur' },
  role_code: { required: true, message: '请填写角色编码', trigger: 'blur' },
}
const kindOptions = [
  { label: '平台后台', value: 'PLATFORM' },
  { label: '承运商后台', value: 'CARRIER' },
  { label: '司机小程序', value: 'DRIVER' },
]
const kindText: Record<string, string> = { PLATFORM: '平台后台', CARRIER: '承运商后台', DRIVER: '司机小程序' }

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
      role_code: form.role_code.trim(),
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
  { title: '角色名称', key: 'role_name', width: 160 },
  { title: '编码', key: 'role_code', width: 180 },
  { title: '类型', key: 'role_kind', width: 120, render: (row) => kindText[row.role_kind] || row.role_kind },
  { title: '说明', key: 'remark', minWidth: 220, ellipsis: { tooltip: true }, render: (row) => row.remark || '-' },
  { title: '状态', key: 'status', width: 80, render: (row) => (Number(row.status) === 1 ? '启用' : '停用') },
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
    <p class="roles__note">功能权限控制模块和按钮。数据权限控制能看到哪些承运商的运单，以及成品、散件。</p>
    <PageTable ref="tableRef" :columns="columns" :remote="remote" :query="applied" :scroll-x="1080" />

    <n-modal v-model:show="show" preset="card" :title="editingId ? '编辑角色' : '新增角色'" style="width: 520px">
      <n-form ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="88">
        <n-form-item label="角色名称" path="role_name">
          <n-input v-model:value="form.role_name" />
        </n-form-item>
        <n-form-item label="角色编码" path="role_code">
          <n-input v-model:value="form.role_code" :disabled="Boolean(editingId)" placeholder="如 REGION_DISPATCH" />
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

    <n-drawer v-model:show="permOpen" :width="640" placement="right">
      <n-drawer-content :title="`配置权限 · ${permRole?.role_name || ''}`" closable>
        <h3 class="perm__title">功能权限</h3>
        <p class="perm__hint">平台后台、承运商后台、司机小程序的模块和按钮都在这里勾选。账号登录哪个端，由角色类型决定。</p>
        <section v-for="group in groupedModules" :key="group.kind" class="perm__group">
          <h4 class="perm__group-title">{{ group.label }}</h4>
          <div v-for="mod in group.modules" :key="mod.code" class="perm__mod">
            <n-checkbox
              :checked="moduleOn(mod)"
              :indeterminate="moduleHalf(mod)"
              @update:checked="(on: boolean) => toggleModule(mod, on)"
            >
              {{ mod.name }}
            </n-checkbox>
            <div class="perm__actions">
              <n-checkbox-group v-model:value="checked">
                <n-checkbox v-for="action in mod.actions" :key="action.code" :value="action.code">
                  {{ action.name }}
                </n-checkbox>
              </n-checkbox-group>
            </div>
          </div>
        </section>

        <h3 class="perm__title">数据权限</h3>
        <div class="perm__block">
          <div class="perm__label">承运商运单</div>
          <n-radio-group v-model:value="carrierAll">
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
            class="perm__select"
          />
          <p v-if="permRole?.role_kind === 'CARRIER'" class="perm__hint">承运商账号实际只能看到自己所属承运商，与这里的范围取交集。</p>
          <p v-if="permRole?.role_kind === 'DRIVER'" class="perm__hint">司机只在小程序查看分配给自己的任务，不按承运商列表展开。</p>
        </div>
        <div class="perm__block">
          <div class="perm__label">物料类型</div>
          <n-checkbox-group v-model:value="materials">
            <n-checkbox v-for="item in materialOptions" :key="item.value" :value="item.value">{{ item.label }}</n-checkbox>
          </n-checkbox-group>
          <p class="perm__hint">未标注物料类型的历史运单仍可见。新运单标注成品或散件后，按这里的范围过滤。</p>
        </div>
        <template #footer>
          <n-space justify="end">
            <n-button @click="permOpen = false">取消</n-button>
            <n-button type="primary" :loading="permSaving" @click="savePerm">保存权限</n-button>
          </n-space>
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
.roles__note, .perm__hint {
  margin: 0 0 10px;
  color: #8c8c8c;
  font-size: 12px;
}
.perm__title {
  margin: 4px 0 10px;
  font-size: 14px;
}
.perm__group { margin-bottom: 8px; }
.perm__group-title {
  margin: 12px 0 0;
  padding: 6px 8px;
  background: #f5f7fa;
  color: #1c2433;
  font-size: 13px;
  font-weight: 600;
}
.perm__mod {
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
}
.perm__actions {
  padding: 6px 0 2px 24px;
}
.perm__block { margin-bottom: 16px; }
.perm__label { margin-bottom: 8px; color: #262626; font-weight: 600; }
.perm__select { margin-top: 8px; }
</style>
