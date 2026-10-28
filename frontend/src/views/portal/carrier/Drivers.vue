<script setup lang="ts">
/**
 * 承运商 - 司机管理
 * 新增司机（身份证已存在时仅建立本承运商关联）、编辑、启停用
 */
import { computed, h, onMounted, reactive, ref } from 'vue'
import type { DataTableColumns, FormInst, FormRules } from 'naive-ui'
import { NButton, NTag, useDialog, useMessage } from 'naive-ui'
import {
  createCarrierDriver, fetchCarrierDrivers, maskIdCard,
  updateCarrierDriver, updateCarrierDriverStatus,
} from '@/services/portal'
import type { DriverPayload, PortalDriver } from '@/services/portal'
import QueryBar from '@/components/QueryBar.vue'
import QueryField from '@/components/QueryField.vue'
import StatusTag from '@/components/StatusTag.vue'

const message = useMessage()
const dialog = useDialog()

const loading = ref(false)
const filters = reactive({
  driver_name: '',
  phone: '',
  license_no: '',
  status: null as number | null,
})
const list = ref<PortalDriver[]>([])
const page = ref(1)
const pageSize = ref(10)

const modal = reactive({
  show: false,
  mode: 'create' as 'create' | 'edit',
  driver: null as PortalDriver | null,
  submitting: false,
})

interface DriverForm extends Omit<DriverPayload, 'license_valid_from' | 'license_valid_to'> {
  license_valid_from: string | null
  license_valid_to: string | null
}

const form = reactive<DriverForm>({
  name: '',
  phone: '',
  id_card: '',
  license_no: '',
  license_type: '',
  license_valid_from: null,
  license_valid_to: null,
  remark: '',
})

const formRef = ref<FormInst | null>(null)

const rules: FormRules = {
  name: { required: true, message: '请输入司机姓名', trigger: 'blur' },
  phone: { required: true, message: '请输入手机号', trigger: 'blur' },
  id_card: { required: true, message: '请输入身份证号', trigger: 'blur' },
  license_valid_from: { required: true, message: '请选择驾驶证有效期起', trigger: 'change' },
  license_valid_to: { required: true, message: '请选择驾驶证有效期止', trigger: 'change' },
}

async function load() {
  loading.value = true
  try {
    list.value = await fetchCarrierDrivers({
      driver_name: filters.driver_name.trim() || undefined,
      phone: filters.phone.trim() || undefined,
      license_no: filters.license_no.trim() || undefined,
      status: filters.status,
    })
    page.value = 1
  } catch (e) {
    message.error(e instanceof Error ? e.message : '司机列表加载失败')
  } finally {
    loading.value = false
  }
}

const pagedList = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return list.value.slice(start, start + pageSize.value)
})

function resetFilters() {
  filters.driver_name = ''
  filters.phone = ''
  filters.license_no = ''
  filters.status = null
  load()
}

function openCreate() {
  modal.mode = 'create'
  modal.driver = null
  Object.assign(form, {
    name: '', phone: '', id_card: '', license_no: '', license_type: '',
    license_valid_from: null, license_valid_to: null, remark: '',
  })
  modal.show = true
}

function openEdit(row: PortalDriver) {
  modal.mode = 'edit'
  modal.driver = row
  Object.assign(form, {
    name: row.driver_name,
    phone: row.phone,
    id_card: row.id_card,
    license_no: row.license_no || '',
    license_type: row.license_type || '',
    license_valid_from: row.license_valid_from || null,
    license_valid_to: row.license_valid_to || null,
    remark: row.remark || '',
  })
  modal.show = true
}

async function submit() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  modal.submitting = true
  try {
    const payload: DriverPayload = {
      ...form,
      license_valid_from: form.license_valid_from ?? '',
      license_valid_to: form.license_valid_to ?? '',
    }
    if (modal.mode === 'create') {
      const res = await createCarrierDriver(payload)
      message.success(res.reused ? '该司机已在当前承运商建档，信息已更新' : '司机新增成功，可使用手机号验证码登录司机端')
    } else if (modal.driver) {
      await updateCarrierDriver(modal.driver.id, { ...payload, name: undefined, id_card: undefined })
      message.success('司机信息已更新')
    }
    modal.show = false
    load()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    modal.submitting = false
  }
}

function toggleStatus(row: PortalDriver) {
  const next = Number(row.status) === 1 ? 0 : 1
  dialog.warning({
    title: next === 1 ? '启用司机' : '停用司机',
    content:
      next === 1
        ? `确认启用司机「${row.driver_name}」？启用后可被分派任务。`
        : `确认停用司机「${row.driver_name}」？停用后不可再分派任务，进行中的任务不受影响。`,
    positiveText: '确认',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await updateCarrierDriverStatus(row.id, next as 0 | 1)
        message.success(next === 1 ? '司机已启用' : '司机已停用')
        load()
      } catch (e) {
        message.error(e instanceof Error ? e.message : '操作失败')
      }
    },
  })
}

const columns: DataTableColumns<PortalDriver> = [
  {
    title: '序号',
    key: '__index',
    width: 60,
    align: 'center',
    fixed: 'left',
    render: (_row, index) => (page.value - 1) * pageSize.value + index + 1,
  },
  { title: '司机姓名', key: 'driver_name', width: 110 },
  { title: '手机号', key: 'phone', width: 140 },
  { title: '身份证号', key: 'id_card', width: 170, render: (row) => maskIdCard(row.id_card) },
  { title: '准驾车型', key: 'license_type', width: 90, render: (row) => row.license_type || '-' },
  {
    title: '驾驶证有效期',
    key: 'license_valid_to',
    width: 190,
    render: (row) => `${row.license_valid_from || '-'} ~ ${row.license_valid_to || '-'}`,
  },
  {
    title: '在途任务',
    key: 'active_task_count',
    width: 90,
    align: 'center',
    render: (row) => row.active_task_count ?? 0,
  },
  {
    title: '来源',
    key: 'source',
    width: 90,
    render: (row) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: row.source === 2 ? 'info' : 'default' },
        { default: () => (row.source === 2 ? '狮桥同步' : '自建') }
      ),
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: (row) => h(StatusTag, { type: 'driver', value: row.status }),
  },
  {
    title: '操作',
    key: 'actions',
    width: 130,
    align: 'center',
    fixed: 'right',
    render: (row) =>
      h('div', { class: 'actions' }, [
        ...(Number(row.source) === 1
          ? [h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openEdit(row) }, { default: () => '编辑' })]
          : []),
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: Number(row.status) === 1 ? 'error' : 'success',
            onClick: () => toggleStatus(row),
          },
          { default: () => (Number(row.status) === 1 ? '停用' : '启用') }
        ),
      ]),
  },
]

onMounted(load)
</script>

<template>
  <div class="stp-page">
    <!-- 筛选栏 -->
    <n-card class="query-card" :bordered="false">
      <QueryBar>
        <QueryField label="司机姓名">
          <n-input
            v-model:value="filters.driver_name"
            placeholder="请输入司机姓名"
            clearable
            @keydown.enter="load"
            @clear="load"
          />
        </QueryField>
        <QueryField label="手机号">
          <n-input
            v-model:value="filters.phone"
            placeholder="请输入手机号"
            clearable
            @keydown.enter="load"
            @clear="load"
          />
        </QueryField>
        <QueryField label="驾驶证号">
          <n-input
            v-model:value="filters.license_no"
            placeholder="请输入驾驶证号"
            clearable
            @keydown.enter="load"
            @clear="load"
          />
        </QueryField>
        <QueryField label="状态">
          <n-select
            v-model:value="filters.status"
            placeholder="请选择状态"
            clearable
            :options="[{ label: '启用', value: 1 }, { label: '停用', value: 0 }]"
            @update:value="load"
          />
        </QueryField>
        <template #actions>
          <n-button @click="resetFilters">重置</n-button>
          <n-button type="primary" @click="load">查询</n-button>
        </template>
      </QueryBar>
    </n-card>

    <!-- 列表 -->
    <n-card class="table-card" :bordered="false">
      <div class="table-toolbar">
        <span class="table-toolbar__hint">
          司机使用手机号 + 短信验证码登录司机端，无需设置密码
        </span>
        <n-button type="primary" @click="openCreate">新增司机</n-button>
      </div>
      <n-data-table
        :columns="columns"
        :data="pagedList"
        :loading="loading"
        :row-key="(row: PortalDriver) => row.id"
        :bordered="false"
        :scroll-x="1160"
        size="small"
      />
      <div class="page-pager">
        <n-pagination
          v-model:page="page"
          v-model:page-size="pageSize"
          :item-count="list.length"
          :page-sizes="[10, 20, 50, 100]"
          show-size-picker
          show-quick-jumper
          :suffix="() => `总数 ${list.length}`"
        />
      </div>
    </n-card>

    <n-modal
      v-model:show="modal.show"
      preset="card"
      style="width: 600px"
      :title="modal.mode === 'create' ? '新增司机' : '编辑司机'"
      :bordered="false"
    >
      <n-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-placement="left"
        label-width="100"
        require-mark-placement="left"
      >
        <n-form-item label="司机姓名" path="name">
          <n-input v-model:value="form.name" :disabled="modal.mode === 'edit'" placeholder="请输入姓名" />
        </n-form-item>
        <n-form-item label="手机号" path="phone">
          <n-input v-model:value="form.phone" placeholder="如 +8613911110002" />
        </n-form-item>
        <n-form-item label="身份证号" path="id_card">
          <n-input v-model:value="form.id_card" :disabled="modal.mode === 'edit'" placeholder="请输入身份证号" />
        </n-form-item>
        <n-form-item label="驾驶证号">
          <n-input v-model:value="form.license_no" placeholder="选填" />
        </n-form-item>
        <n-form-item label="准驾车型">
          <n-input v-model:value="form.license_type" placeholder="如 A2" />
        </n-form-item>
        <n-form-item label="驾驶证有效期起" path="license_valid_from">
          <n-date-picker
            v-model:formatted-value="form.license_valid_from"
            type="date"
            value-format="yyyy-MM-dd"
            style="width: 100%"
          />
        </n-form-item>
        <n-form-item label="驾驶证有效期止" path="license_valid_to">
          <n-date-picker
            v-model:formatted-value="form.license_valid_to"
            type="date"
            value-format="yyyy-MM-dd"
            style="width: 100%"
          />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="form.remark" type="textarea" :rows="2" placeholder="选填" />
        </n-form-item>
      </n-form>
      <div v-if="modal.mode === 'create'" class="modal-hint">
        驾驶证已过期不可新增；身份证号已存在的司机只会加入本承运商，不会重复建档。
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button type="primary" :loading="modal.submitting" @click="submit">保存</n-button>
          <n-button @click="modal.show = false">取消</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.modal-hint {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.6;
  color: #666666;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 20px;
}
.page-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
  padding: 0 15px;
}
:deep(.actions) {
  display: flex;
  gap: 4px;
}
</style>
