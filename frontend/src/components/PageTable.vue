<script setup lang="ts" generic="T extends object">
/**
 * 分页表格封装：NDataTable + 远程分页 + loading + 空态/错误态
 *
 * 用法：
 *   <PageTable
 *     :columns="columns"
 *     :remote="({ page, pageSize }) => listCarriers({ ...query, page, size: pageSize })"
 *     :query="query"
 *   />
 *
 * 约定：
 *  - remote 收到 { page, pageSize }，返回 { list, total }（信封已在 services 层拆包）
 *  - query 为响应式查询参数对象，变化时自动回到第 1 页并重新请求
 *  - 页码/每页条数变化自动重新请求
 *  - 请求失败展示错误 + 重试按钮，不抛断页面
 */

import { computed, onActivated, onMounted, ref, watch } from 'vue'
import type { DataTableColumns, DataTableRowData, PaginationProps } from 'naive-ui'

const props = withDefaults(
  defineProps<{
    /** 表格列定义 */
    columns: DataTableColumns<T>
    /** 远程数据函数（返回 { list, total }） */
    remote: (params: { page: number; pageSize: number }) => Promise<{ list: T[]; total: number }>
    /** 查询参数（deep watch，变化自动重置到第一页并重新请求） */
    query?: Record<string, unknown>
    /** 行 key，默认取 row.id */
    rowKey?: (row: T) => number | string
    /** 表格横向滚动宽度 */
    scrollX?: number
    /** 初始每页条数 */
    initPageSize?: number
    /** 挂载后是否立即请求 */
    immediate?: boolean
    /** 表格尺寸 */
    tableSize?: 'small' | 'medium' | 'large'
  }>(),
  {
    query: () => ({}),
    rowKey: (row: T) => (row as unknown as { id: number | string }).id,
    initPageSize: 10,
    immediate: true,
    tableSize: 'small',
  },
)

const loading = ref(false)
const data = ref<T[]>([])
// NDataTable 的 data 收 RowData[]，泛型 T 需桥接一次
const tableData = computed(() => data.value as unknown as DataTableRowData[])

// 列宽拖动统一在封装层开启；选择/展开列与 __ 开头的辅助列不参与（无实际内容宽度可调）
const tableColumns = computed<DataTableColumns<T>>(() =>
  props.columns.map((column) => {
    const key = 'key' in column ? String(column.key) : ''
    const isAuxiliary =
      column.type === 'selection' || column.type === 'expand' || key.startsWith('__')
    return isAuxiliary ? column : { ...column, resizable: true }
  }),
)

const total = ref(0)
const page = ref(1)
const pageSize = ref(props.initPageSize)
const error = ref<string | null>(null)

async function fetchData() {
  loading.value = true
  error.value = null
  try {
    const result = await props.remote({ page: page.value, pageSize: pageSize.value })
    data.value = result?.list ?? []
    total.value = result?.total ?? 0
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err)
    data.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

/** 重置到第一页并重新请求（新增/删除/查询变更后调用） */
function reload() {
  page.value = 1
  return fetchData()
}

/** 保持当前页重新请求（编辑/状态切换后调用） */
function refresh() {
  return fetchData()
}

function handlePageChange(next: number) {
  page.value = next
  fetchData()
}

function handlePageSizeChange(next: number) {
  pageSize.value = next
  page.value = 1
  fetchData()
}

const pagination = computed<PaginationProps>(() => ({
  page: page.value,
  pageSize: pageSize.value,
  itemCount: total.value,
  pageSizes: [10, 20, 50, 100],
  showSizePicker: true,
  showQuickJumper: true,
  prefix: () => `共 ${total.value} 条`,
  onChange: handlePageChange,
  onUpdatePageSize: handlePageSizeChange,
}))

watch(
  () => props.query,
  () => {
    page.value = 1
    fetchData()
  },
  { deep: true },
)

onMounted(() => {
  if (props.immediate) fetchData()
})

// keep-alive 页签切换回来时刷新数据（保留筛选与页码，只拉最新列表）
onActivated(() => {
  fetchData()
})

defineExpose({
  reload,
  refresh,
  loading,
  page,
  pageSize,
  total,
})
</script>

<template>
  <div class="page-table">
    <n-data-table
      remote
      :size="tableSize"
      :columns="tableColumns"
      :data="tableData"
      :loading="loading"
      :pagination="pagination"
      :row-key="rowKey"
      :scroll-x="scrollX"
      :bordered="false"
    >
      <template #empty>
        <div v-if="error" class="page-table__error">
          <span class="page-table__error-text">{{ error }}</span>
          <n-button size="tiny" type="primary" quaternary @click="refresh()">重试</n-button>
        </div>
        <n-empty v-else description="暂无数据" />
      </template>
    </n-data-table>
  </div>
</template>

<style scoped>
.page-table__error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 0;
}

.page-table__error-text {
  color: #e5484d;
  font-size: 13px;
}
</style>
