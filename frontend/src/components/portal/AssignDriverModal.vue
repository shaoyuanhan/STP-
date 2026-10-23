<script setup lang="ts">
/**
 * 接单并指派司机弹窗（列表页与详情页共用）
 * 只列出本承运商司机；停用、驾驶证过期的司机不可选
 */
import { computed, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { assignCarrierTask, fetchCarrierDrivers } from '@/services/portal'
import type { PortalDriver } from '@/services/portal'

const props = defineProps<{
  show: boolean
  taskId: number | null
  taskNo?: string
  version?: number
  carrierId?: number | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'assigned', payload: { driver_name: string }): void
}>()

const message = useMessage()
const loading = ref(false)
const submitting = ref(false)
const drivers = ref<PortalDriver[]>([])
const driverId = ref<number | null>(null)

function today() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function disabledReason(d: PortalDriver): string {
  if (Number(d.status) !== 1) return '已停用'
  if (d.license_valid_to && d.license_valid_to < today()) return '驾驶证已过期'
  return ''
}

const options = computed(() =>
  drivers.value.map((d) => {
    const reason = disabledReason(d)
    return {
      label: `${d.driver_name} · ${d.phone}${reason ? `（${reason}）` : ` · 在途 ${d.active_task_count ?? 0} 单`}`,
      value: d.id,
      disabled: Boolean(reason),
    }
  })
)

watch(
  () => props.show,
  async (visible) => {
    if (!visible) return
    driverId.value = null
    loading.value = true
    try {
      drivers.value = await fetchCarrierDrivers({ carrier_id: props.carrierId })
    } catch (e) {
      message.error(e instanceof Error ? e.message : '司机列表加载失败')
    } finally {
      loading.value = false
    }
  }
)

function close() {
  emit('update:show', false)
}

async function submit() {
  if (!props.taskId) return
  if (!driverId.value) {
    message.warning('请选择司机')
    return
  }
  submitting.value = true
  try {
    const res = await assignCarrierTask(props.taskId, {
      driver_id: driverId.value,
      version: Number(props.version ?? 0),
    })
    message.success(`接单成功，已指派 ${res.driver_name}`)
    emit('assigned', { driver_name: res.driver_name })
    close()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '接单失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    style="width: 480px"
    :title="`接单并指派司机${taskNo ? ` · ${taskNo}` : ''}`"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <n-spin :show="loading">
      <div class="assign">
        <n-select
          v-model:value="driverId"
          :options="options"
          placeholder="请选择本承运商司机"
          filterable
          :disabled="!options.length"
        />
        <div v-if="!loading && !options.length" class="assign__empty">
          暂无可用司机，请先在「司机管理」中新增
        </div>
      </div>
    </n-spin>
    <template #footer>
      <div class="assign__footer">
        <n-button @click="close">取消</n-button>
        <n-button type="primary" :loading="submitting" @click="submit">确认接单</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.assign {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.assign__empty {
  font-size: 12px;
  color: #8c8c8c;
}
.assign__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
