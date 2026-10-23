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
/* 单个查询字段：标签占固定一列并左对齐，控件占满剩余空间。
   宽度由 QueryBar 上的 --qb-* 变量统一注入，页面无需写任何宽度。
   wide 用于日期区间等需要双倍宽度的字段。 */
.qb-field {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 var(--qb-field-width, 268px);
  max-width: 100%;
  min-width: 0;
}

.qb-field--wide {
  flex-basis: calc(var(--qb-field-width, 268px) * 2 + var(--qb-column-gap, 18px));
}

.qb-field__label {
  flex: 0 0 var(--qb-label-width, 96px);
  width: var(--qb-label-width, 96px);
  font-size: 13px;
  color: #595959;
  white-space: nowrap;
  text-align: left;
}

.qb-field__control {
  flex: 1 1 0;
  min-width: 0;
}

.qb-field__control > * {
  width: 100%;
}
</style>
