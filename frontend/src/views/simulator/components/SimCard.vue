<script setup lang="ts">
/**
 * 外部接口模拟卡片：方法 / 路径标题 + 一句话摘要 + 业务说明折叠 + 表单插槽
 *
 * 用法：
 *   <SimCard no="#1" title="CRM 下发发运申请" method="POST"
 *            path="/api/external/shipping-tasks/receive" summary="…" :desc="['…']">
 *     <表单 / 提交按钮 / SimResponse />
 *   </SimCard>
 */
withDefaults(
  defineProps<{
    /** 契约接口序号（#1…#14 / MOCK-1 / MOCK-2） */
    no: string
    /** 接口名称 */
    title: string
    /** 请求方法 */
    method: 'GET' | 'POST'
    /** 完整接口路径（含 /api 前缀） */
    path: string
    /** 一句话摘要 */
    summary: string
    /** 业务说明（折叠面板内逐行展示） */
    desc?: string[]
    /** 是否占满整行（字段多的接口用） */
    wide?: boolean
  }>(),
  {
    desc: () => [],
    wide: false,
  },
)
</script>

<template>
  <n-card size="small" :bordered="false" class="sim-card" :class="{ 'sim-card--wide': wide }">
    <template #header>
      <div class="sim-card__head">
        <n-tag :type="method === 'GET' ? 'success' : 'info'" size="small" class="sim-card__method">
          {{ method }}
        </n-tag>
        <span class="sim-card__title">{{ no }} {{ title }}</span>
      </div>
    </template>
    <template #header-extra>
      <span class="sim-card__path" :title="path">{{ path }}</span>
    </template>

    <div class="sim-card__summary">{{ summary }}</div>
    <n-collapse v-if="desc.length" class="sim-card__collapse">
      <n-collapse-item title="业务说明" name="desc">
        <div v-for="(line, index) in desc" :key="index" class="sim-card__desc">{{ line }}</div>
      </n-collapse-item>
    </n-collapse>

    <slot />
  </n-card>
</template>

<style scoped>
.sim-card {
  border-radius: 6px;
}

/* 卡片在父级两列栅格中占满整行 */
.sim-card--wide {
  grid-column: 1 / -1;
}

.sim-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sim-card__method {
  flex: none;
  font-weight: 600;
}

.sim-card__title {
  font-size: 14px;
  font-weight: 600;
  color: #262626;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sim-card__path {
  font-size: 12px;
  color: #8c8c8c;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}

.sim-card__summary {
  font-size: 12px;
  color: #595959;
  background: #f7f8fa;
  border-radius: 4px;
  padding: 6px 10px;
  margin-bottom: 10px;
  line-height: 1.6;
}

.sim-card__collapse {
  margin-bottom: 6px;
}

.sim-card__desc {
  font-size: 12px;
  color: #595959;
  line-height: 1.8;
}

.sim-card__desc::before {
  content: '· ';
  color: #1677ff;
  font-weight: 700;
}
</style>
