<script setup lang="ts">
/**
 * 状态文字：按任务、合作状态、对账与电子签语义展示统一状态色。
 *
 * 用法：<StatusTag type="task" :value="row.status" />
 *
 * 支持六类状态（契约第 3/4 节）：
 *  - task     任务状态（WAIT_DISPATCH…CANCELLED，契约 3.1 状态机）
 *  - carrier  承运商状态（tinyint 1 合作中 / 0 已停用）
 *  - driver   司机状态（tinyint 1 启用 / 0 停用）
 *  - reconcile 对账状态（tinyint 0 待对账 / 1 已对账）
 *  - esign    电子签状态（WAIT_SIGN / SIGNED / CANCELLED）
 *  - enable   通用启停用（tinyint 1 启用 / 0 停用）
 *
 * 状态使用语义色文字，不叠加标签底色。
 *
 * 内置映射优先；未知值回退到字典接口（stores/dictionary），
 * 字典未加载时静默拉取一次（失败不阻塞渲染，回显原始值）。
 */

import { computed, onMounted } from 'vue'
import { useDictionaryStore } from '@/stores/dictionary'
import type { DictKey } from '@/stores/dictionary'
import type { EsignStatus, TaskStatus } from '@/types/api'

type StatusKind = 'task' | 'carrier' | 'driver' | 'reconcile' | 'esign' | 'enable'
type StatusColor = 'blue' | 'green' | 'orange' | 'red' | 'gray'

interface StatusDisplay {
  label: string
  color: StatusColor
}

const props = withDefaults(
  defineProps<{
    /** 状态类别 */
    type: StatusKind
    /** 状态值（枚举字符串或 tinyint 数字） */
    value?: string | number | null
  }>(),
  {
    value: null,
  },
)

const dictStore = useDictionaryStore()
// 字典兜底：页面忘记预加载字典时也能拿到 label（失败静默）
onMounted(() => {
  dictStore.ensureLoaded().catch(() => {
    /* 字典接口不可用时不阻塞状态展示 */
  })
})

/** 任务状态映射（契约 3.1） */
const TASK_STATUS_MAP: Record<TaskStatus, StatusDisplay> = {
  WAIT_DISPATCH: { label: '待派单', color: 'orange' },
  DISPATCHED: { label: '已派单', color: 'blue' },
  CARRIER_ACCEPTED: { label: '承运商已接单', color: 'blue' },
  OUTBOUND: { label: '已出库', color: 'blue' },
  PICKED: { label: '已提车', color: 'blue' },
  IN_TRANSIT: { label: '在途', color: 'blue' },
  ARRIVED: { label: '已到达', color: 'orange' },
  FINISHED: { label: '已完结', color: 'green' },
  CANCELLED: { label: '已取消', color: 'red' },
}

/** 电子签状态映射（契约 4：esign_record.sign_status） */
const ESIGN_STATUS_MAP: Record<EsignStatus, StatusDisplay> = {
  WAIT_SIGN: { label: '待签署', color: 'orange' },
  SIGNED: { label: '已签署', color: 'green' },
  CANCELLED: { label: '已取消', color: 'red' },
}

/** 承运商/司机/账号/角色 tinyint 状态映射 */
const ENABLE_STATUS_MAP: Record<'carrier' | 'driver' | 'enable', Record<'1' | '0', StatusDisplay>> = {
  carrier: {
    '1': { label: '合作中', color: 'green' },
    '0': { label: '已停用', color: 'red' },
  },
  driver: {
    '1': { label: '启用', color: 'green' },
    '0': { label: '停用', color: 'red' },
  },
  enable: {
    '1': { label: '启用', color: 'green' },
    '0': { label: '停用', color: 'red' },
  },
}

/** 对账状态映射 */
const RECONCILE_STATUS_MAP: Record<'0' | '1', StatusDisplay> = {
  '0': { label: '待对账', color: 'orange' },
  '1': { label: '已对账', color: 'green' },
}

const DICT_KEY_OF: Record<StatusKind, DictKey> = {
  task: 'taskStatus',
  carrier: 'carrierStatus',
  driver: 'driverStatus',
  reconcile: 'reconcileStatus',
  esign: 'esignStatus',
  enable: 'driverStatus',
}

const display = computed<StatusDisplay>(() => {
  const value = props.value
  if (value === null || value === undefined || value === '') {
    return { label: '-', color: 'gray' }
  }

  const text = String(value)

  if (props.type === 'task') {
    const hit = TASK_STATUS_MAP[text as TaskStatus]
    if (hit) return hit
  } else if (props.type === 'esign') {
    const hit = ESIGN_STATUS_MAP[text as EsignStatus]
    if (hit) return hit
  } else if (props.type === 'carrier' || props.type === 'driver' || props.type === 'enable') {
    const num = Number(value)
    if (Number.isFinite(num) && (num === 0 || num === 1)) {
      return ENABLE_STATUS_MAP[props.type][num === 1 ? '1' : '0']
    }
  } else {
    const num = Number(value)
    if (Number.isFinite(num) && (num === 0 || num === 1)) {
      return RECONCILE_STATUS_MAP[num === 1 ? '1' : '0']
    }
  }

  // 字典兜底（保证后端扩展枚举时也能显示中文）
  const label = dictStore.getLabel(DICT_KEY_OF[props.type], value)
  return { label: label || text, color: 'gray' }
})
</script>

<template>
  <span class="status-text" :class="`status-text--${display.color}`">{{ display.label }}</span>
</template>

<style scoped>
.status-text {
  font-size: 14px;
  line-height: 22px;
  white-space: nowrap;
}

.status-text--blue {
  color: #1890ff;
}

.status-text--green {
  color: #18a058;
}

.status-text--orange {
  color: #f0a020;
}

.status-text--red {
  color: #d03050;
}

.status-text--gray {
  color: #999999;
}
</style>
