<script setup lang="ts">
/**
 * 页面建设占位组件（骨架阶段使用）
 *
 * 页面组填充 views 时会整体替换各自目录下的 index.vue，
 * 本组件无需保留；期间保证 8 个路由全部可访问、可编译。
 */

defineProps<{
  /** 页面标题 */
  title: string
  /** 页面职责一句话说明 */
  description?: string
}>()
</script>

<template>
  <div class="stp-page">
    <n-card :title="title" class="page-placeholder">
      <template #header-extra>
        <n-tag size="small" type="warning" :bordered="false">建设中</n-tag>
      </template>
      <n-empty size="large" description="页面建设中" class="page-placeholder__empty">
        <template #icon>
          <n-icon :size="52" color="#c1c8d3">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 21h18" />
              <path d="M5 21V11l5-3v13" />
              <path d="M10 21V4l9 3v14" />
              <path d="M13.5 10h2M13.5 14h2M13.5 17.5h2" />
            </svg>
          </n-icon>
        </template>
        <template #extra>
          <div class="page-placeholder__tips">
            <p v-if="description" class="page-placeholder__desc">{{ description }}</p>
            <p class="page-placeholder__note">路由、布局与公共组件（services / stores / components）已就绪，本页面将在后续迭代中填充。</p>
          </div>
        </template>
      </n-empty>
    </n-card>
  </div>
</template>

<style scoped>
.page-placeholder__empty {
  padding: 72px 0;
}

.page-placeholder__tips {
  margin-top: 4px;
  text-align: center;
}

.page-placeholder__desc {
  margin: 0 0 6px;
  font-size: 14px;
  color: #666666;
}

.page-placeholder__note {
  margin: 0;
  font-size: 12px;
  color: #999999;
}
</style>
