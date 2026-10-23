<template>
  <div class="qb">
    <slot />
    <div v-if="$slots.actions" class="qb__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style>
/* 查询区容器：字段按 DOM 顺序自动换行，列宽完全由 QueryField 决定，
   页面不再关心间距与宽度，因此任意字段数、任意页面都保持同一套对齐规则。 */
.qb {
  --qb-label-width: 96px;
  --qb-field-width: 268px;
  --qb-column-gap: 18px;
  --qb-row-gap: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--qb-row-gap) var(--qb-column-gap);
}

.qb .qb__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
