<script setup lang="ts">
/**
 * 任务定位控件：applyNo / taskNo 二选一（契约第 6 节统一定位规则）
 *
 * - applyNo：发运申请号，CRM 业务主键，推荐使用
 * - taskNo：任务单号（FY 开头），STP 单号，兼容定位
 * - 两者都无 → 后端返回 A0001；本控件仅提供输入，校验由页面提交时统一做
 */
const applyNo = defineModel<string>('applyNo', { default: '' })
const taskNo = defineModel<string>('taskNo', { default: '' })
</script>

<template>
  <div class="sim-locator">
    <n-input
      v-model:value="applyNo"
      size="small"
      clearable
      placeholder="发运申请号 applyNo（推荐）"
    />
    <n-input
      v-model:value="taskNo"
      size="small"
      clearable
      placeholder="任务单号 taskNo（兼容）"
    />
  </div>
</template>

<style scoped>
.sim-locator {
  display: flex;
  gap: 8px;
  width: 100%;
}

.sim-locator > :first-child {
  flex: 1.2;
}

.sim-locator > :last-child {
  flex: 1;
}
</style>
