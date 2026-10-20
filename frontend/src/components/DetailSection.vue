<script setup lang="ts">
/**
 * 详情分区：标题 + NDescriptions 描述栅格
 *
 * 用法：
 *   <DetailSection title="基础信息">
 *     <n-descriptions-item label="客户">{{ task.customer_name }}</n-descriptions-item>
 *     ...
 *   </DetailSection>
 *
 * 内容通过默认插槽传入 NDescriptionsItem 列表；
 * 右侧可加操作按钮（#extra 插槽，如"编辑"）。
 */

import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 分区标题 */
    title: string
    /** 描述栅格列数 */
    column?: number
    /** 尺寸 */
    size?: 'small' | 'medium' | 'large'
    /** 是否显示边框 */
    bordered?: boolean
    /** label 位置 */
    labelPlacement?: 'left' | 'top'
    /** label 单元格样式（默认浅灰背景） */
    labelStyle?: CSSProperties
  }>(),
  {
    column: 3,
    size: 'small',
    bordered: true,
    labelPlacement: 'left',
    labelStyle: () => ({ width: '120px', background: '#f7f8fa' }),
  },
)

const resolvedColumn = computed(() => props.column)
const resolvedLabelStyle = computed(() => props.labelStyle)
</script>

<template>
  <section class="detail-section">
    <div class="detail-section__header">
      <span class="detail-section__bar"></span>
      <h3 class="detail-section__title">{{ title }}</h3>
      <div class="detail-section__extra">
        <slot name="extra" />
      </div>
    </div>
    <n-descriptions
      class="detail-section__descriptions"
      :column="resolvedColumn"
      :size="size"
      :bordered="bordered"
      :label-placement="labelPlacement"
      :label-style="resolvedLabelStyle"
    >
      <slot />
    </n-descriptions>
  </section>
</template>

<style scoped>
.detail-section {
  margin-bottom: 20px;
}

.detail-section__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.detail-section__bar {
  flex: none;
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: #1677ff;
}

.detail-section__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #1f2329;
  line-height: 1.4;
}

.detail-section__extra {
  margin-left: auto;
}
</style>
