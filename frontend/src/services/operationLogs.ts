import { get } from './http'
import type {
  OperationLog,
  OperationLogOperator,
  OperationLogQuery,
  PageResult,
} from '@/types/api'

export function listOperationLogs(query: OperationLogQuery = {}): Promise<PageResult<OperationLog>> {
  return get<PageResult<OperationLog>>('/operationLog', query as Record<string, unknown>)
}

export function getOperationLog(id: number): Promise<OperationLog> {
  return get<OperationLog>(`/operationLog/${id}`)
}

export function listOperationOperators(): Promise<OperationLogOperator[]> {
  return get<OperationLogOperator[]>('/operationLog/operators')
}
