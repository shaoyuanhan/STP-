<script setup lang="ts">
/**
 * 承运商 - 司机管理
 * 新增司机（身份证已存在时仅建立本承运商关联）、编辑、启停用
 */
import { h, onMounted, reactive, ref } from 'vue'
import type { DataTableColumns, FormInst, FormRules } from 'naive-ui'
import { NButton, NTag, useDialog, useMessage } from 'naive-ui'
import {
  createCarrierDriver, fetchCarrierDrivers, maskIdCard,
  updateCarrierDriver, updateCarrierDriverStatus,
} from '@/services/portal'
import type { DriverPayload, PortalDriver } from '@/services/portal'

const message = useMessage()
const dialog = useDialog()

const loading = ref(false)
const keyword = ref('')
const list = ref<PortalDriver[]>([])

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
    list.value = await fetchCarrierDrivers(keyword.value.trim())
  } catch (e) {
    message.error(e instanceof Error ? e.message : '司机列表加载失败')
  } finally {
    loading.value = false
  }
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
      message.success(res.reused ? '该司机已存在，已加入本承运商' : '司机新增成功，可使用手机号验证码登录司机端')
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
    width: 80,
    render: (row) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: Number(row.status) === 1 ? 'success' : 'default' },
        { default: () => (Number(row.status) === 1 ? '启用' : '停用') }
      ),
  },
  {
    title: '操作',
    key: 'actions',
    width: 130,
    fixed: 'right',
    render: (row) =>
      h('div', { class: 'actions' }, [
        h(NButton, { size: 'tiny', quaternary: true, type: 'primary', onClick: () => openEdit(row) }, { default: () => '编辑' }),
        h(
          NButton,
          {
            size: 'tiny',
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
    <n-card class="page-card" :bordered="false">
      <div class="page-card__filters">
        <div class="page-card__field">
          <span class="page-card__label">关键字</span>
          <n-input
            v-model:value="keyword"
            class="page-card__input"
            placeholder="姓名 / 手机号 / 驾驶证号"
            clearable
            @keydown.enter="load"
            @clear="load"
          />
        </div>
        <div class="page-card__actions">
          <n-button @click="load">查询</n-button>
          <n-button type="primary" @click="openCreate">+ 新增司机</n-button>
        </div>
      </div>
    </n-card>

    <!-- 工具栏 -->
    <div class="page-toolbar">
      <span class="page-toolbar__hint">
        司机使用手机号 + 短信验证码登录司机端，无需设置密码
      </span>
    </div>

    <!-- 列表 -->
    <n-card class="page-card" :bordered="false">
      <n-data-table
        :columns="columns"
        :data="list"
        :loading="loading"
        :row-key="(row: PortalDriver) => row.id"
        :bordered="false"
        :single-line="false"
        :scroll-x="1000"
        size="small"
      />
    </n-card>

    <n-modal
      v-model:show="modal.show"
      preset="card"
      style="width: 560px"
      :title="modal.mode === 'create' ? '新增司机' : '编辑司机'"
      :bordered="false"
    >
      <n-form ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="110">
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
          <n-button @click="modal.show = false">取消</n-button>
          <n-button type="primary" :loading="modal.submitting" @click="submit">保存</n-button>
        </div>
      </template>
    </n-modal>
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
  width: 240px;
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
.modal-hint {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.6;
  color: #8c8c8c;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
:deep(.actions) {
  display: flex;
  gap: 4px;
}
</style>
