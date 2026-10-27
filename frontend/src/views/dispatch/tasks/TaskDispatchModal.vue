<script setup lang="ts">
/**
 * 派单 / 改派弹窗（契约 5.4 + 既有需求 2）
 *
 * - 承运商下拉：仅合作中可选，已停用置灰并标注「不可派单」；改派时排除原承运商
 * - 线路参考价只读（= CRM 同步计划运费，不可修改）
 * - 派单备注 ≤500 字（存 dispatch_record.remark）
 * - 提交携带列表行 version（乐观锁）；D0001 冲突提示并通知父级刷新列表
 * - 打开时拉取任务详情：取权威参考价/原承运商；
 *   是否允许本操作以后端返回的 allowedActions 为准（前端不做状态判断）
 * - 成功提示直接使用后端信封 message（含狮桥同步说明文案）
 */
import { computed, reactive, ref, watch } from 'vue'
import type { FormInst, FormRules, SelectOption } from 'naive-ui'
import { useMessage } from 'naive-ui'
import MoneyText from '@/components/MoneyText.vue'
import { listCarriers } from '@/services/carriers'
import { dispatchTask, getShippingTask, reassignDispatch } from '@/services/tasks'
import type { Carrier, ShippingTask, ShippingTaskDetail, ShippingTaskListItem } from '@/types/api'
import { buildCarrierOptions, describeApiError, type TaskRowExt } from './shared'

const props = defineProps<{
  show: boolean
  /** dispatch=派单（仅待派单）；reassign=改派（仅已派单，换承运商） */
  mode: 'dispatch' | 'reassign'
  task: ShippingTaskListItem | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'success'): void
  (e: 'conflict'): void
}>()

const message = useMessage()

const isReassign = computed(() => props.mode === 'reassign')

// ---------------- 承运商下拉 ----------------
const carriers = ref<Carrier[]>([])
const carrierOptions = ref<SelectOption[]>([])
const carriersLoading = ref(false)

async function loadCarriers() {
  carriersLoading.value = true
  try {
    const page = await listCarriers({ page: 1, size: 500 })
    carriers.value = page.list ?? []
  } catch {
    carriers.value = []
  } finally {
    carriersLoading.value = false
  }
  rebuildCarrierOptions()
}

function rebuildCarrierOptions() {
  carrierOptions.value = buildCarrierOptions(carriers.value, originalCarrierId.value)
}

// ---------------- 打开时拉取任务详情（权威参考价/原承运商/后端可用操作） ----------------
const detailTask = ref<ShippingTask | null>(null)
const allowedActions = ref<string[] | null>(null)
const detailLoading = ref(false)
let detailReqId = 0

async function loadDetail() {
  const row = props.task
  if (!row) return
  const reqId = ++detailReqId
  detailLoading.value = true
  try {
    const detail: ShippingTaskDetail = await getShippingTask(row.id)
    if (reqId !== detailReqId) return
    detailTask.value = detail.task
    allowedActions.value = detail.allowedActions ?? []
  } catch {
    if (reqId === detailReqId) {
      detailTask.value = null
      allowedActions.value = null
    }
  } finally {
    if (reqId === detailReqId) detailLoading.value = false
  }
  rebuildCarrierOptions()
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

/** 线路参考价：详情优先，列表行兜底（后端列表 SQL 实际返回 plan_freight） */
const planFreight = computed(
  () => detailTask.value?.plan_freight ?? (props.task as TaskRowExt | null)?.plan_freight ?? null,
)

/** 改派时排除的原承运商 ID：详情 carrier_id 优先，名称唯一兜底 */
const originalCarrierId = computed<number | null>(() => {
  if (!isReassign.value) return null
  if (detailTask.value?.carrier_id != null) return detailTask.value.carrier_id
  const name = props.task?.carrier_name
  const hit = name ? carriers.value.find((c) => c.carrier_name === name) : null
  return hit?.id ?? null
})

// 详情返回后需按原承运商重建下拉
watch(originalCarrierId, () => rebuildCarrierOptions())

/**
 * 当前状态是否允许本操作：以后端详情返回的 allowedActions 为准
 * （WAIT_DISPATCH→[DISPATCH,BATCH_DISPATCH]，DISPATCHED→[CANCEL_DISPATCH,REASSIGN]）；
 * 详情未加载成功时不拦截，由提交接口做最终校验。
 */
const actionBlocked = computed(() => {
  const actions = allowedActions.value
  if (!actions) return false
  const expected = isReassign.value ? 'REASSIGN' : 'DISPATCH'
  return !actions.includes(expected)
})

watch(
  () => props.show,
  (visible) => {
    if (!visible) return
    form.carrier_id = null
    form.remark = ''
    formRef.value?.restoreValidation()
    detailTask.value = null
    allowedActions.value = null
    carriers.value = []
    carrierOptions.value = []
    loadCarriers()
    loadDetail()
  },
)

function close() {
  emit('update:show', false)
}

async function handleSubmit() {
  const row = props.task
  if (!row || submitting.value) return
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  if (actionBlocked.value) return
  submitting.value = true
  try {
    const payload = {
      task_id: row.id,
      carrier_id: form.carrier_id as number,
      remark: form.remark.trim() || undefined,
      version: row.version, // 乐观锁：携带列表行 version
    }
    // 成功提示直接使用后端信封 message（含狮桥同步说明文案），前端不拼接
    if (isReassign.value) {
      const env = await reassignDispatch(payload)
      message.success(env.message)
    } else {
      const env = await dispatchTask(payload)
      message.success(env.message)
    }
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
    :title="`${isReassign ? '改派' : '派单'} · ${task?.task_no ?? ''}`"
    class="form-modal dispatch-modal"
    :style="{ width: '600px', maxWidth: '94vw' }"
    :mask-closable="!submitting"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <div v-if="task" class="dispatch-modal__body">
      <div class="dispatch-modal__tip">
        {{
          isReassign
            ? '改派将同步狮桥取消原派单，并重新下发至新承运商；由新承运商确认接单并分配司机'
            : '派单后同步至三方物流系统（狮桥发运系统），由承运商确认接单并分配司机'
        }}
      </div>

      <n-alert v-if="actionBlocked" type="error" class="dispatch-modal__alert">
        任务状态已变化，当前不可{{ isReassign ? '改派' : '派单' }}，请关闭后刷新列表
      </n-alert>

      <n-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-placement="left"
        label-width="110px"
        :show-require-mark="false"
      >
        <n-form-item v-if="isReassign" label="当前承运商">
          <span>{{ task.carrier_name || '-' }}</span>
        </n-form-item>
        <n-form-item label="线路参考价">
          <div class="dispatch-modal__price">
            <MoneyText :value="planFreight" prefix="¥" bold />
            <span class="dispatch-modal__price-note">取自 CRM 同步的计划运费，不可修改</span>
          </div>
        </n-form-item>
        <n-form-item label="承运商" path="carrier_id">
          <div class="dispatch-modal__field">
            <n-select
              v-model:value="form.carrier_id"
              class="dispatch-modal__select"
              :options="carrierOptions"
              :loading="carriersLoading"
              filterable
              :placeholder="isReassign ? '请选择新的承运商' : '请选择承运商'"
            />
            <div class="dispatch-modal__hint">仅可选择合作中的承运商；已停用的承运商不可被派单</div>
          </div>
        </n-form-item>
        <n-form-item label="派单备注">
          <n-input
            v-model:value="form.remark"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-count
            :placeholder="
              isReassign ? '选填，改派说明（如：原承运商运力不足）' : '选填，调度派单说明（如：加急发运、限高架车辆注意）'
            "
          />
        </n-form-item>
      </n-form>
    </div>

    <template #footer>
      <div class="modal-footer">
        <n-button
          type="primary"
          :loading="submitting"
          :disabled="actionBlocked"
          @click="handleSubmit"
        >
          {{ isReassign ? '确认改派' : '确认派单' }}
        </n-button>
        <n-button :disabled="submitting" @click="close">取消</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.dispatch-modal__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dispatch-modal__tip {
  margin-bottom: 16px;
  padding: 8px 12px;
  background: #f7f8fa;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: #666666;
}

.dispatch-modal__alert {
  margin-bottom: 12px;
}

.dispatch-modal__price {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.dispatch-modal__price-note {
  font-size: 12px;
  color: #999999;
}

.dispatch-modal__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.dispatch-modal__select {
  width: 100%;
}

.dispatch-modal__hint {
  font-size: 12px;
  color: #999999;
  line-height: 1.5;
}
</style>
