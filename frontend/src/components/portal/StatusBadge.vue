<script setup lang="ts">
/** 状态标签：与运营端 StatusTag 同一套药丸样式（22px 高 / 4px 圆角 / 浅底深字） */
import { computed } from 'vue'
import { statusLabel } from '@/services/portal'

const props = defineProps<{ status: string; size?: 'small' | 'normal' }>()

const tone = computed(() => {
  const map: Record<string, string> = {
    WAIT_DISPATCH: 'gray',
    DISPATCHED: 'blue',
    CARRIER_ACCEPTED: 'cyan',
    PICKED: 'cyan',
    OUTBOUND: 'blue',
    IN_TRANSIT: 'green',
    ARRIVED: 'orange',
    FINISHED: 'green',
    CANCELLED: 'red',
  }
  return map[props.status] || 'gray'
})
</script>

<template>
  <span class="status-badge" :class="[`status-badge--${tone}`, { 'status-badge--small': size === 'small' }]">
    {{ statusLabel(status) }}
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}
.status-badge--small {
  height: 20px;
  padding: 0 6px;
  font-size: 11px;
}
.status-badge--blue {
  background: #e6f4ff;
  color: #1677ff;
}
.status-badge--green {
  background: #f6ffed;
  color: #389e0d;
}
.status-badge--orange {
  background: #fff7e6;
  color: #fa8c16;
}
.status-badge--red {
  background: #fff1f0;
  color: #f5222d;
}
.status-badge--gray {
  background: #fafafa;
  color: #595959;
  border: 1px solid #f0f0f0;
}
.status-badge--cyan {
  background: #e6fffb;
  color: #08979c;
}
</style>
