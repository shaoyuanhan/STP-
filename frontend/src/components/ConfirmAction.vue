<script setup lang="ts">
/**
 * 确认操作弹窗封装（危险/常规确认）
 *
 * 用法（受控）：
 *   <ConfirmAction
 *     v-model:show="show"
 *     type="error"
 *     title="确认停用该承运商？"
 *     content="停用后不可再被新派单选择，在途任务不受影响。"
 *     :loading="submitting"
 *     :auto-close="false"
 *     @confirm="handleConfirm"
 *   />
 *
 * 约定：
 *  - type="error"：红色警示按钮（危险操作：停用/取消/修改等）
 *  - type="default"：常规确认按钮
 *  - confirm 事件后默认自动关闭（auto-close）；提交异步流程时
 *    传 :loading="true" + :auto-close="false"，成功后由父组件关闭
 *  - 正文支持 content 字符串或默认插槽（复杂内容/表单）
 */

const props = withDefaults(
  defineProps<{
    show: boolean
    /** 弹窗标题 */
    title: string
    /** 正文文案（与默认插槽二选一） */
    content?: string
    /** default 常规确认 / error 危险确认 */
    type?: 'default' | 'error'
    /** 确认按钮文案 */
    confirmText?: string
    /** 取消按钮文案 */
    cancelText?: string
    /** 提交中（确认按钮转圈并禁用，弹窗不可关闭） */
    loading?: boolean
    /** confirm 后是否自动关闭弹窗（异步流程请设为 false 由父组件控制） */
    autoClose?: boolean
  }>(),
  {
    content: '',
    type: 'default',
    confirmText: '确 定',
    cancelText: '取 消',
    loading: false,
    autoClose: true,
  },
)

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

function handlePositiveClick(): boolean {
  emit('confirm')
  if (!props.loading && props.autoClose) {
    emit('update:show', false)
  }
  // 返回 false 阻止内置关闭逻辑，统一由本组件控制
  return false
}

function handleNegativeClick(): boolean {
  if (props.loading) return false
  emit('cancel')
  emit('update:show', false)
  return false
}

function handleClose(): boolean {
  if (props.loading) return false
  emit('update:show', false)
  return false
}
</script>

<template>
  <n-modal
    :show="show"
    preset="dialog"
    :type="type === 'error' ? 'error' : 'info'"
    :title="title"
    :content="content || undefined"
    :positive-text="confirmText"
    :negative-text="cancelText"
    :loading="loading"
    :mask-closable="false"
    :closable="!loading"
    @positive-click="handlePositiveClick"
    @negative-click="handleNegativeClick"
    @close="handleClose"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <slot />
  </n-modal>
</template>
