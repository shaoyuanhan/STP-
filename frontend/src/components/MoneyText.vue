<script setup lang="ts">
/**
 * 金额文本：千分位 + 两位小数（DECIMAL 可能以字符串返回，统一 Number() 归一）
 *
 * 用法：<MoneyText :value="bill.actual_freight" />          → 1,234.56
 *      <MoneyText :value="plan_freight" prefix="¥" />       → ¥1,234.56
 *      <MoneyText :value="null" placeholder="-" />
 */

import { computed } from 'vue'
import { money } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    /** 金额（数字或 DECIMAL 字符串） */
    value?: number | string | null
    /** 前缀，如 ¥ */
    prefix?: string
    /** 空值占位符 */
    placeholder?: string
    /** 是否加粗 */
    bold?: boolean
  }>(),
  {
    value: null,
    prefix: '',
    placeholder: '-',
    bold: false,
  },
)

const text = computed(() => {
  const isEmpty =
    props.value === null ||
    props.value === undefined ||
    props.value === '' ||
    !Number.isFinite(Number(props.value))
  const formatted = money(props.value, { placeholder: props.placeholder })
  if (isEmpty) return formatted
  return `${props.prefix}${formatted}`
})
</script>

<template>
  <span class="money-text" :class="{ 'money-text--bold': bold }">{{ text }}</span>
</template>

<style scoped>
.money-text--bold {
  font-weight: 600;
}
</style>
