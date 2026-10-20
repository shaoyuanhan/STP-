<script setup lang="ts">
/**
 * 批量派单弹窗（契约 5.4 + 既有需求 3）
 *
 * - 任务清单：任务单号/客户名称/VIN/线路参考价 + 参考价合计行
 * - 承运商下拉：仅合作中可选；批量备注 ≤500 字
 * - 仅对「待派单」任务生效，非待派单由后端逐项跳过并返回原因
 * - 提交后展示结果：成功 N 单 / 参考价合计 / 跳过明细；
 *   汇总提示文案直接使用后端信封 message（如「批量派单完成：成功 N 单，跳过 M 单」）
 */
import { computed, h, reactive, ref, watch } from 'vue'
import type { DataTableColumns, FormInst, FormRules, SelectOption } from 'naive-ui'
import { useMessage } from 'naive-ui'
import MoneyText from '@/components/MoneyText.vue'
import { listCarriers } from '@/services/carriers'
import { batchDispatchTasks } from '@/services/tasks'
import type {
  BatchDispatchResult,
  BatchDispatchSkipped,
  Carrier,
  ShippingTaskListItem,
} from '@/types/api'
import { buildCarrierOptions, describeApiError, splitVins, type TaskRowExt } from './shared'

const props = defineProps<{
  show: boolean
  /** 勾选的「待派单」任务（打开时快照，避免提交过程中列表刷新影响） */
  tasks: ShippingTaskListItem[]
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'success'): void
}>()

const message = useMessage()

// ---------------- 打开时快照 ----------------
const snapshot = ref<ShippingTaskListItem[]>([])
const phase = ref<'form' | 'result'>('form')
const result = ref<BatchDispatchResult | null>(null)
/** 后端返回的汇总文案（结果阶段展示） */
const resultMessage = ref('')

// ---------------- 承运商下拉 ----------------
const carriers = ref<Carrier[]>([])
const carrierOptions = ref<SelectOption[]>([])
const carriersLoading = ref(false)

async function loadCarriers() {
  carriersLoading.value = true
  try {
    const page = await listCarriers({ page: 1, size: 500 })
    carriers.value = page.list ?? []
    carrierOptions.value = buildCarrierOptions(carriers.value)
  } catch {
    carriers.value = []
    carrierOptions.value = []
  } finally {
    carriersLoading.value = false
  }
}

// ---------------- 表单 ----------------
const formRef = ref<FormInst | null>(null)
const form = reactive({
  carrier_id: null as number | null,
  remark: '',
})
const submitting = ref(false)

const rules: FormRules = {
  carrier_id: {
    required: true,
    type: 'number',
    message: '请选择承运商',
    trigger: ['blur', 'change'],
  },
}

/** 列表行参考价（后端列表 SQL 实际返回 plan_freight） */
function freightOf(row: ShippingTaskListItem): number {
  return Number((row as TaskRowExt).plan_freight) || 0
}

const totalFreight = computed(() =>
  snapshot.value.reduce((sum, row) => sum + freightOf(row), 0),
)

const selectedCarrierName = computed(
  () => carriers.value.find((c) => c.id === form.carrier_id)?.carrier_name ?? '',
)

// ---------------- 任务清单表格 ----------------
const taskColumns: DataTableColumns<ShippingTaskListItem> = [
  { title: '任务单号', key: 'task_no', width: 150 },
  {
    title: '客户名称',
    key: 'customer_name',
    minWidth: 140,
    ellipsis: { tooltip: true },
    render: (row) => row.customer_name || '-',
  },
  {
    title: 'VIN',
    key: 'vins',
    width: 190,
    render: (row) => {
      const list = splitVins(row.vins)
      if (!list.length) return '-'
      const text = list.length > 1 ? `${list[0]} 等 ${list.length} 台` : list[0]
      return h('span', { title: list.join('、') }, text)
    },
  },
  {
    title: '线路参考价',
    key: 'plan_freight',
    width: 110,
    align: 'right',
    render: (row) => h(MoneyText, { value: freightOf(row), prefix: '¥' }),
  },
]

const skippedColumns: DataTableColumns<BatchDispatchSkipped> = [
  { title: '任务单号', key: 'task_no', width: 150, render: (row) => row.task_no || '-' },
  { title: '跳过原因', key: 'reason' },
]

// ---------------- 打开 / 提交 ----------------
watch(
  () => props.show,
  (visible) => {
    if (!visible) return
    snapshot.value = [...props.tasks]
    phase.value = 'form'
    result.value = null
    resultMessage.value = ''
    form.carrier_id = null
    form.remark = ''
    formRef.value?.restoreValidation()
    loadCarriers()
  },
)

function close() {
  emit('update:show', false)
}

async function handleSubmit() {
  if (submitting.value) return
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  if (!snapshot.value.length) {
    message.warning('未选择任务，请关闭后重新勾选「待派单」状态的任务')
    return
  }
  submitting.value = true
  try {
    // 汇总提示直接使用后端信封 message（成功 N 单/跳过 M 单），前端不拼接
    const env = await batchDispatchTasks({
      task_ids: snapshot.value.map((row) => row.id),
      carrier_id: form.carrier_id as number,
      remark: form.remark.trim() || undefined,
    })
    result.value = env.data
    resultMessage.value = env.message
    phase.value = 'result'
    message.success(env.message)
    // 操作已完成：立即通知父级刷新列表（弹窗保留展示结果）
    emit('success')
  } catch (error) {
    message.error(describeApiError(error).message)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="phase === 'form' ? `批量派单（${snapshot.length} 单）` : '批量派单结果'"
    class="batch-modal"
    :style="{ width: '720px', maxWidth: '94vw' }"
    :mask-closable="!submitting"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <!-- 表单阶段：任务清单 + 参考价合计 + 承运商 + 批量备注 -->
    <div v-if="phase === 'form'" class="batch-modal__body">
      <div v-if="!snapshot.length" class="batch-modal__empty">
        <n-empty description="未选择任务，请关闭后重新勾选「待派单」状态的任务" />
      </div>
      <template v-else>
        <n-data-table
          class="batch-modal__table"
          :columns="taskColumns"
          :data="snapshot"
          :row-key="(row: ShippingTaskListItem) => row.id"
          :bordered="true"
          size="small"
          :scroll-x="620"
        />
        <div class="batch-modal__total">
          <span>参考价合计（{{ snapshot.length }} 单）</span>
          <MoneyText :value="totalFreight" prefix="¥" bold class="batch-modal__total-value" />
        </div>

        <n-form
          ref="formRef"
          class="batch-modal__form"
          :model="form"
          :rules="rules"
          label-placement="left"
          label-width="110px"
          :show-require-mark="false"
        >
          <n-form-item label="承运商" path="carrier_id">
            <div class="batch-modal__field">
              <n-select
                v-model:value="form.carrier_id"
                class="batch-modal__select"
                :options="carrierOptions"
                :loading="carriersLoading"
                filterable
                placeholder="请选择承运商"
              />
              <div class="batch-modal__hint">
                批量派单仅对待派单任务生效，非待派单自动跳过；仅可选择合作中的承运商
              </div>
            </div>
          </n-form-item>
          <n-form-item label="批量派单备注">
            <n-input
              v-model:value="form.remark"
              type="textarea"
              :rows="3"
              maxlength="500"
              show-count
              placeholder="选填，将写入所选任务的派单备注（如：同线路拼载发运）"
            />
          </n-form-item>
        </n-form>
      </template>
    </div>

    <!-- 结果阶段：后端汇总文案 / 成功 N 单 / 合计 X 元 / 跳过及原因 -->
    <div v-else class="batch-modal__body">
      <n-alert :type="result && result.skipped?.length ? 'warning' : 'success'" class="batch-modal__result-tip">
        {{ resultMessage }}
        <template v-if="selectedCarrierName">（承运商：{{ selectedCarrierName }}）</template>
      </n-alert>

      <div v-if="result" class="batch-modal__result-grid">
        <div class="batch-modal__result-item">
          <span class="batch-modal__result-label">成功派单</span>
          <span class="batch-modal__result-value">{{ result.dispatched }} 单</span>
        </div>
        <div class="batch-modal__result-item">
          <span class="batch-modal__result-label">参考价合计</span>
          <MoneyText :value="result.total_freight" prefix="¥" bold />
        </div>
      </div>

      <template v-if="result && result.skipped?.length">
        <div class="batch-modal__skipped-title">跳过明细</div>
        <n-data-table
          :columns="skippedColumns"
          :data="result.skipped"
          :row-key="(row: BatchDispatchSkipped) => row.task_id"
          size="small"
          :bordered="true"
        />
      </template>
    </div>

    <template #footer>
      <div class="batch-modal__footer">
        <template v-if="phase === 'form'">
          <n-button :disabled="submitting" @click="close">取消</n-button>
          <n-button
            type="primary"
            :loading="submitting"
            :disabled="!snapshot.length"
            @click="handleSubmit"
          >
            确认派单
          </n-button>
        </template>
        <n-button v-else type="primary" @click="close">知道了</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.batch-modal__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.batch-modal__empty {
  padding: 24px 0;
}

.batch-modal__total {
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
  gap: 10px;
  padding: 8px 12px;
  background: #f7f8fa;
  border-radius: 4px;
  font-size: 13px;
  color: #595959;
}

.batch-modal__total :deep(.money-text) {
  color: #1677ff;
}

.batch-modal__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.batch-modal__hint {
  font-size: 12px;
  color: #8c8c8c;
  line-height: 1.5;
}

.batch-modal__result-grid {
  display: flex;
  gap: 40px;
  padding: 12px 4px;
}

.batch-modal__result-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
}

.batch-modal__result-label {
  color: #8c8c8c;
  font-size: 13px;
}

.batch-modal__result-value {
  font-weight: 600;
  color: #262626;
}

.batch-modal__skipped-title {
  font-size: 13px;
  font-weight: 600;
  color: #262626;
}

.batch-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
