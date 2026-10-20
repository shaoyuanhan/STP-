/**
 * 数据字典接口（契约 5.1 GET /api/dictionaries）
 *
 * 页面请优先使用 stores/dictionary.ts（带缓存与 getters），
 * 仅在需要强制刷新字典时直接调用本文件。
 */

import { get } from './http'
import type { Dictionaries } from '@/types/api'

export function getDictionaries(): Promise<Dictionaries> {
  return get<Dictionaries>('/dictionaries')
}
