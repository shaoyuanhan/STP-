<script setup lang="ts">
/**
 * 取消派单弹窗（契约 5.4 + 既有需求 5，PRD 设计稿交互）
 *
 * - 标题「取消派单 · 任务单号」
 * - 当前状态快照（详情接口：状态 + 承运商 + 司机接单情况）
 * - 校验结论来自后端任务详情 allowedActions（内部规则：DISPATCHED=已派单且司机未接单
 *   才含 CANCEL_DISPATCH）；CRM 侧 cancel-check 是给外部系统用的（如「请先在 STP
 *   取消派单」），内部弹窗不复用；接口异常时显示「校验接口不可用」并禁用提交
 * - 取消原因必填下拉（承运商无法履约/调度调整/其他）+ 补充说明 textarea（非必填）
 * - 「返回」+ 红色「确认取消派单」
 * - 提交携带列表行 version；D0001 冲突提示并通知父级刷新列表
 */
import { computed, reactive, ref, watch } from 'vue'
import type { FormInst, FormRules, SelectOption } from 'naive-ui'
import { useMessage } from 'naive-ui'
import StatusTag from '@/components/StatusTag.vue'
import { cancelDispatch, getShippingTask } from '@/services/tasks'
import { useDictionaryStore } from '@/stores/dictionary'
import { CANCEL_DISPATCH_REASONS } from '@/types/api'
import type { ShippingTask, ShippingTaskListItem } from '@/types/api'
import { describeApiError } from './shared'

const props = defineProps<{
  show: boolean
  task: ShippingTaskListItem | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'success'): void
  (e: 'conflict'): void
}>()

const message = useMessage()
const dictStore = useDictionaryStore()

// ---------------- 打开时拉取任务详情（状态快照 + 后端校验结论） ----------------
const detailTask = ref<ShippingTask | null>(null)
/** 后端按状态计算的可操作列表（详情接口顶层返回） */
const detailAllowedActions = ref<string[]>([])
const detailLoading = ref(false)
let detailReqId = 0

async function loadDetail() {
  const row = props.task
  if (!row) return
  const reqId = ++detailReqId
  detailLoading.value = true
  try {
    const detail = await getShippingTask(row.id)
    if (reqId !== detailReqId) return
    detailTask.value = detail.task
    detailAllowedActions.value = (detail.allowedActions ?? []) as string[]
  } catch {
    if (reqId === detailReqId) {
      detailTask.value = null
      detailAllowedActions.value = []
    }
  } finally {
    if (reqId === detailReqId) detailLoading.value = false
  }
}

/** 当前状态（详情优先，列表行兜底） */
const currentStatus = computed(() => detailTask.value?.status ?? props.task?.status ?? null)
const currentCarrierName = computed(
  () => detailTask.value?.carrier_name ?? props.task?.carrier_name ?? '',
)
/** 司机接单情况：DISPATCHED=未接单；接单后展示司机姓名 */
const driverInfo = computed(() => {
  const status = currentStatus.value
  if (status === 'DISPATCHED') return '司机未接单'
  if (detailTask.value?.driver_name) return `司机 ${detailTask.value.driver_name} 已接单`
  return ''
})

// ---------------- 取消前校验（结论来自后端 allowedActions） ----------------
type CheckState = 'checking' | 'pass' | 'block' | 'error'
const checkState = computed<CheckState>(() => {
  if (detailLoading.value) return 'checking'
  if (!detailTask.value) return 'error'
  return detailAllowedActions.value.includes('CANCEL_DISPATCH') ? 'pass' : 'block'
})

/** 校验结果文案：按后端返回的状态给出内部场景说明 */
const checkDisplay = computed(() => {
  if (checkState.value === 'checking') return { symbol: '', text: '校验中…', kind: 'checking' as const }
  if (checkState.value === 'error') return { symbol: '✕', text: '校验接口不可用', kind: 'block' as const }
  if (checkState.value === 'pass') {
    return { symbol: '✓', text: '已派单且司机未接单，可以取消派单', kind: 'pass' as const }
  }
  const status = currentStatus.value
  let text = '当前状态不可取消派单'
  if (status === 'WAIT_DISPATCH') text = '当前为待派单状态，无需取消派单'
  else if (status === 'CARRIER_ACCEPTED') text = '承运商已接单，需线下协调承运商后处理'
  else if (status && ['PICKED', 'OUTBOUND', 'IN_TRANSIT', 'ARRIVED', 'FINISHED'].includes(status)) {
    text = '车辆已出库发运，不可取消派单'
  } else if (status === 'CANCELLED') text = '该任务已取消，无需操作'
  return { symbol: '✕', text, kind: 'block' as const }
})

/** 是否允许提交：仅后端校验通过时 */
const canSubmit = computed(() => checkState.value === 'pass')

// ---------------- 表单 ----------------
const formRef = ref<FormInst | null>(null)
const form = reactive({
  reason: null as string | null,
  remark: '',
})
const submitting = ref(false)

const reasonOptions = computed<SelectOption[]>(() =>
  (dictStore.cancelReasons.length ? dictStore.cancelReasons : CANCEL_DISPATCH_REASONS).map(
    (reason) => ({ label: reason, value: reason }),
  ),
)

const rules: FormRules = {
  reason: {
    required: true,
    message: '请选择取消原因',
    trigger: ['blur', 'change'],
  },
}

watch(
  () => props.show,
  (visible) => {
    if (!visible) return
    form.reason = null
    form.remark = ''
    formRef.value?.restoreValidation()
    detailTask.value = null
    detailAllowedActions.value = []
    dictStore.ensureLoaded().catch(() => {})
    loadDetail()
  },
)

function close() {
  emit('update:show', false)
}

async function handleSubmit() {
  const row = props.task
  if (!row || submitting.value) return
  if (!canSubmit.value) return
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    // 成功提示直接使用后端信封 message（含狮桥取消同步说明），前端不拼接
    const env = await cancelDispatch({
      task_id: row.id,
      reason: form.reason as string,
      remark: form.remark.trim() || undefined,
      version: row.version, // 乐观锁：携带列表行 version
    })
    message.success(env.message)
    close()
    emit('success')
  } catch (error) {
    const described = describeApiError(error)
    if (described.code === 'D0001') {
      message.error(described.message)
      close()
      emit('conflict')
    } else {
      message.error(described.message)
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="`取消派单 · ${task?.task_no ?? ''}`"
    class="cancel-modal"
    :style="{ width: '600px', maxWidth: '94vw' }"
    :mask-closable="!submitting"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <div v-if="task" class="cancel-modal__body">
      <!-- 当前状态快照 + 后端校验结果 -->
      <div class="cancel-modal__snapshot">
        <div class="cancel-modal__snapshot-row">
          <span class="cancel-modal__label">当前状态</span>
          <span class="cancel-modal__value">
            <StatusTag type="task" :value="currentStatus" />
            <template v-if="currentCarrierName && driverInfo">
              （{{ currentCarrierName }}、{{ driverInfo }}）
            </template>
          </span>
        </div>
        <div class="cancel-modal__snapshot-row">
          <span class="cancel-modal__label">校验结果</span>
          <span class="cancel-modal__value" :class="`is-${checkDisplay.kind}`">
            {{ checkDisplay.symbol }}{{ checkDisplay.symbol ? ' ' : '' }}{{ checkDisplay.text }}
          </span>
        </div>
      </div>

      <n-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-placement="left"
        label-width="100"
        require-mark-placement="left"
      >
        <n-form-item label="取消原因" path="reason">
          <n-select
            v-model:value="form.reason"
            class="cancel-modal__select"
            :options="reasonOptions"
            :disabled="!canSubmit"
            placeholder="请选择取消原因"
          />
        </n-form-item>
        <n-form-item label="补充说明">
          <n-input
            v-model:value="form.remark"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-count
            :disabled="!canSubmit"
            placeholder="补充说明"
          />
        </n-form-item>
      </n-form>
    </div>

    <template #footer>
      <div class="modal-footer">
        <n-button
          type="error"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="handleSubmit"
        >
          确认取消派单
        </n-button>
        <n-button :disabled="submitting" @click="close">返回</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.cancel-modal__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cancel-modal__snapshot {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: #f7f8fa;
  border-radius: 4px;
}

.cancel-modal__snapshot-row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 14px;
}

.cancel-modal__label {
  flex: none;
  color: #666666;
}

.cancel-modal__value {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #2d3033;
  line-height: 1.5;
}

.cancel-modal__value.is-pass {
  color: #18a058;
  font-weight: 600;
}

.cancel-modal__value.is-block {
  color: #d03050;
  font-weight: 600;
}

.cancel-modal__value.is-checking {
  color: #999999;
}
</style>
