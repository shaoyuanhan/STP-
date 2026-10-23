<script setup lang="ts">
/**
 * 司机端承运商选择面板（登录时选择 / 已登录时切换）
 * 展示承运商名称、司机姓名与进行中任务数，有在途单的排前面并标注。
 */
import { computed } from 'vue'
import type { DriverCarrierOption } from '@/services/portal'

const props = withDefaults(
  defineProps<{
    show: boolean
    carriers: DriverCarrierOption[]
    current?: number | null
    title?: string
    loading?: boolean
  }>(),
  { current: null, title: '选择所属承运商', loading: false }
)

const emit = defineEmits<{
  (e: 'select', carrierId: number): void
  (e: 'close'): void
}>()

const sorted = computed(() =>
  [...props.carriers].sort((a, b) => {
    if (b.active_task_count !== a.active_task_count) return b.active_task_count - a.active_task_count
    return a.carrier_id - b.carrier_id
  })
)
</script>

<template>
  <Transition name="sheet">
    <div v-if="show" class="sheet" @click.self="emit('close')">
      <div class="sheet__panel">
        <div class="sheet__head">
          <span class="sheet__title">{{ title }}</span>
          <button type="button" class="sheet__close" @click="emit('close')">关闭</button>
        </div>
        <p class="sheet__tip">同一手机号在多家承运商有档案时，选择要进入的一家</p>
        <button
          v-for="item in sorted"
          :key="item.carrier_id"
          type="button"
          class="sheet__item"
          :class="{ 'is-on': current === item.carrier_id }"
          :disabled="loading"
          @click="emit('select', item.carrier_id)"
        >
          <span class="sheet__row">
            <span class="sheet__name">{{ item.carrier_name || `承运商 #${item.carrier_id}` }}</span>
            <span v-if="item.active_task_count" class="sheet__badge">在途 {{ item.active_task_count }}</span>
            <span v-else-if="current === item.carrier_id" class="sheet__badge sheet__badge--muted">当前</span>
          </span>
          <span class="sheet__meta">{{ item.driver_name }}</span>
        </button>
        <p v-if="!sorted.length" class="sheet__empty">暂无可进入的承运商</p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.sheet {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(15, 23, 42, 0.42);
}
.sheet__panel {
  width: min(480px, 100%);
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  border-radius: 12px 12px 0 0;
  background: #fff;
}
.sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sheet__title {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
}
.sheet__close {
  border: 0;
  background: transparent;
  color: #8c8c8c;
  font-size: 13px;
  cursor: pointer;
}
.sheet__tip {
  margin: 6px 0 12px;
  font-size: 12px;
  color: #8c8c8c;
}
.sheet__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  margin-bottom: 8px;
  padding: 12px;
  border: 1px solid #eceff3;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  cursor: pointer;
}
.sheet__item.is-on {
  border-color: #1a1a1a;
  background: #fafafa;
}
.sheet__item:disabled {
  opacity: 0.6;
}
.sheet__row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sheet__name {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
}
.sheet__badge {
  padding: 1px 8px;
  border-radius: 10px;
  background: #1a1a1a;
  color: #fff;
  font-size: 11px;
}
.sheet__badge--muted {
  background: #eef0f3;
  color: #595959;
}
.sheet__meta {
  font-size: 12px;
  color: #8c8c8c;
}
.sheet__empty {
  margin: 8px 0;
  color: #8c8c8c;
  font-size: 13px;
  text-align: center;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.18s ease;
}
.sheet-enter-active .sheet__panel,
.sheet-leave-active .sheet__panel {
  transition: transform 0.22s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet__panel,
.sheet-leave-to .sheet__panel {
  transform: translateY(100%);
}
</style>
