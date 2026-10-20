<script setup lang="ts">
/**
 * 响应报文面板：请求预览 + 完整信封 JSON
 *
 * 契约第 2 节信封 { code, message, data }：
 *   - code === '00000' → 绿色「成功」标签 + 绿色 JSON
 *   - 其他（A0001/A0002/B0001/C0001/D0001/D0002…）→ 红色标签 + 红色 JSON
 *
 * 演示价值：失败分支（重复下发 C0001、状态机拦截 D0001 等）的完整报文原样可见。
 */
import { computed } from 'vue'
import type { SimResponseState } from '../sim-types'

const props = defineProps<{
  /** 该接口的调用状态（为 null 不渲染） */
  state: SimResponseState | null
}>()

const isSuccess = computed(() => props.state?.envelope?.code === '00000')

const responseJson = computed(() =>
  props.state?.envelope ? JSON.stringify(props.state.envelope, null, 2) : '',
)
</script>

<template>
  <div v-if="state && (state.envelope || state.loading)" class="sim-resp">
    <div class="sim-resp__head">
      <span class="sim-resp__label">响应报文</span>
      <n-tag v-if="state.envelope" size="small" :type="isSuccess ? 'success' : 'error'">
        {{ state.envelope.code }} · {{ isSuccess ? '成功' : '失败' }}
      </n-tag>
      <n-spin v-if="state.loading" :size="12" class="sim-resp__spin" />
      <span v-if="state.time" class="sim-resp__time">{{ state.time }}</span>
    </div>
    <pre class="sim-resp__block sim-resp__req">{{ state.request }}</pre>
    <pre
      v-if="state.envelope"
      class="sim-resp__block sim-resp__json"
      :class="isSuccess ? 'sim-resp__json--ok' : 'sim-resp__json--fail'"
    >{{ responseJson }}</pre>
  </div>
</template>

<style scoped>
.sim-resp {
  margin-top: 12px;
  border-top: 1px dashed #e5e6eb;
  padding-top: 10px;
}

.sim-resp__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.sim-resp__label {
  font-size: 12px;
  font-weight: 600;
  color: #595959;
}

.sim-resp__time {
  margin-left: auto;
  font-size: 12px;
  color: #8c8c8c;
  font-variant-numeric: tabular-nums;
}

.sim-resp__block {
  margin: 0 0 8px;
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-x: auto;
  max-height: 260px;
  overflow-y: auto;
}

.sim-resp__req {
  background: #f7f8fa;
  color: #595959;
  border: 1px solid #e5e6eb;
}

.sim-resp__json {
  margin-bottom: 0;
  border: 1px solid transparent;
}

/* 成功/失败配色对齐旧版设计系统：成功 #389e0d 系、危险 #f5222d 系 */
.sim-resp__json--ok {
  background: #f6ffed;
  border-color: #b7eb8f;
  color: #389e0d;
}

.sim-resp__json--fail {
  background: #fff1f0;
  border-color: #ffa39e;
  color: #f5222d;
}
</style>
