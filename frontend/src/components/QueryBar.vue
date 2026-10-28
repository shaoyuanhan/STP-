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
  --qb-label-width: 110px;
  --qb-control-width: 220px;
  --qb-field-width: calc(var(--qb-label-width) + 8px + var(--qb-control-width));
  --qb-column-gap: 10px;
  --qb-row-gap: 15px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--qb-row-gap) var(--qb-column-gap);
}

.qb .qb__actions {
  flex: 0 0 auto;
  max-width: 100%;
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 20px;
}
</style>
