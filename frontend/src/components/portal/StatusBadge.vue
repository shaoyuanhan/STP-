<script setup lang="ts">
/** 承运商/司机端任务状态：直接复用运营端 StatusTag，保证全站状态展示写法唯一 */
import StatusTag from '@/components/StatusTag.vue'

withDefaults(defineProps<{ status: string; size?: 'small' | 'normal' }>(), { size: 'small' })
</script>

<template>
  <StatusTag type="task" :value="status" />
</template>
