<script setup lang="ts">
withDefaults(defineProps<{ label: string; wide?: boolean }>(), { wide: false })
</script>

<template>
  <div class="qb-field" :class="{ 'qb-field--wide': wide }">
    <span class="qb-field__label">{{ label }}</span>
    <div class="qb-field__control">
      <slot />
    </div>
  </div>
</template>

<style>
/* 单个查询字段：标签右对齐，控件使用统一宽度；窄屏时控件收缩而非重叠。 */
.qb-field {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 var(--qb-field-width, 338px);
  max-width: 100%;
  min-width: 0;
}

.qb-field--wide {
  flex-basis: calc(var(--qb-field-width, 338px) * 2 + var(--qb-column-gap, 20px));
}

.qb-field__label {
  flex: 0 0 var(--qb-label-width, 110px);
  width: var(--qb-label-width, 110px);
  font-size: 14px;
  color: #666666;
  white-space: nowrap;
  text-align: right;
}

.qb-field__control {
  flex: 1 1 0;
  min-width: 0;
}

.qb-field__control > * {
  width: 100%;
}
</style>
