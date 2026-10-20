/**
 * 数据字典 Store
 *
 * 首次用到时拉取 GET /api/dictionaries 并缓存（含并发去重与失败可重试），
 * 导出各字典 getters 与 getLabel 工具。页面里请先调用 ensureLoaded()，
 * 再使用 options/getLabel；StatusTag 等公共组件内部已做兜底。
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getDictionaries } from '@/services/dict'
import type { DictOption, Dictionaries } from '@/types/api'

export type DictKey =
  | 'taskStatus'
  | 'carrierStatus'
  | 'driverStatus'
  | 'driverSource'
  | 'reconcileStatus'
  | 'esignStatus'

const EMPTY_DICTS: Dictionaries = {
  taskStatus: [],
  carrierStatus: [],
  driverStatus: [],
  driverSource: [],
  reconcileStatus: [],
  esignStatus: [],
  cancelReasons: [],
}

export const useDictionaryStore = defineStore('dictionary', () => {
  const dictionaries = ref<Dictionaries>({ ...EMPTY_DICTS })
  const loaded = ref(false)
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  let pending: Promise<Dictionaries> | null = null

  /** 拉取并缓存字典；成功后重复调用直接命中缓存，失败后允许重试 */
  function ensureLoaded(): Promise<Dictionaries> {
    if (loaded.value) return Promise.resolve(dictionaries.value)
    if (!pending) {
      loading.value = true
      loadError.value = null
      pending = getDictionaries()
        .then((data) => {
          dictionaries.value = { ...EMPTY_DICTS, ...data }
          loaded.value = true
          return dictionaries.value
        })
        .catch((error: unknown) => {
          loadError.value = error instanceof Error ? error.message : String(error)
          throw error
        })
        .finally(() => {
          loading.value = false
          pending = null
        })
    }
    return pending
  }

  function getOptions(key: DictKey): DictOption[] {
    return dictionaries.value[key] ?? []
  }

  /** 按 value 取 label；未匹配时回显原始值（StatusTag 已内置状态映射，此方法用于下拉等场景） */
  function getLabel(key: DictKey, value: unknown): string {
    if (value === null || value === undefined || value === '') return ''
    const text = String(value)
    const hit = getOptions(key).find((option) => String(option.value) === text)
    return hit ? hit.label : text
  }

  // ---- 字典 getters ----
  const taskStatusOptions = computed<DictOption[]>(() => getOptions('taskStatus'))
  const carrierStatusOptions = computed<DictOption[]>(() => getOptions('carrierStatus'))
  const driverStatusOptions = computed<DictOption[]>(() => getOptions('driverStatus'))
  const driverSourceOptions = computed<DictOption[]>(() => getOptions('driverSource'))
  const reconcileStatusOptions = computed<DictOption[]>(() => getOptions('reconcileStatus'))
  const esignStatusOptions = computed<DictOption[]>(() => getOptions('esignStatus'))
  const cancelReasons = computed<string[]>(() => dictionaries.value.cancelReasons ?? [])

  return {
    dictionaries,
    loaded,
    loading,
    loadError,
    ensureLoaded,
    getOptions,
    getLabel,
    taskStatusOptions,
    carrierStatusOptions,
    driverStatusOptions,
    driverSourceOptions,
    reconcileStatusOptions,
    esignStatusOptions,
    cancelReasons,
  }
})
