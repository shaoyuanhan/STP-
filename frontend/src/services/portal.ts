/**
 * 承运商端 / 司机端 API 与登录态
 * 独立 axios 实例：自动携带 Bearer Token；登录失效时清理会话并跳转门户登录页
 */
import axios from 'axios'

const TOKEN_KEY = 'stp_portal_token'
const PROFILE_KEY = 'stp_portal_profile'

export interface PortalProfile {
  account_id: number
  type: 'ADMIN' | 'CARRIER' | 'DRIVER'
  account_type: string
  username?: string | null
  name: string
  phone: string
  role: string
  role_id?: number | null
  role_name?: string | null
  permissions?: string[]
  data_scope?: { carriers: 'ALL' | number[]; materials: 'ALL' | string[] }
  carrier_id: number | null
  carrier_name: string | null
  driver_id: number | null
  driver_name: string | null
  unread?: number
}

export interface PortalTask {
  id: number
  task_no: string
  order_no?: string | null
  apply_no?: string | null
  customer_name: string
  status: string
  ship_location?: string | null
  delivery_area?: string | null
  delivery_address?: string | null
  plan_freight?: string | number | null
  actual_freight?: string | number | null
  mileage?: string | number | null
  plan_pickup_date?: string | null
  outbound_date?: string | null
  ship_time?: string | null
  arrive_time?: string | null
  finish_time?: string | null
  create_time?: string | null
  version: number
  carrier_id?: number | null
  vins?: string | null
  vehicle_models?: string | null
  driver_name?: string | null
  driver_phone?: string | null
  carrier_name?: string | null
  delivery_phone?: string | null
  receiver_phone?: string | null
}

export interface PortalVehicle {
  id: number
  vin: string
  vehicle_model?: string | null
  engine_config?: string | null
  cabin_type?: string | null
  order_no?: string | null
  report_no?: string | null
  ship_location?: string | null
  plan_freight?: string | number | null
  actual_freight?: string | number | null
}

export interface PortalStatusLog {
  id: number
  from_status: string | null
  to_status: string
  source: string
  operator?: string | null
  remark?: string | null
  photos?: string | null
  create_time: string
}

export interface PortalFile {
  id: number
  biz_type: string
  file_url: string
  uploader_name?: string | null
  create_time: string
}

export interface PortalTaskDetail {
  task: PortalTask & { receiver_name?: string | null; receiver_phone?: string | null }
  vehicles: PortalVehicle[]
  status_logs: PortalStatusLog[]
  files: PortalFile[]
  allowed_actions: string[]
  dispatch_records?: Array<Record<string, unknown>>
  pickup_photo_min?: number
  dev_tools?: boolean
}

export interface PortalDriver {
  id: number
  driver_name: string
  phone: string
  id_card: string
  license_no?: string | null
  license_type?: string | null
  license_valid_from?: string | null
  license_valid_to?: string | null
  source: number
  status: number
  remark?: string | null
  active_task_count?: number
  account_status?: number | null
}

export interface PortalNotification {
  id: number
  receiver_type: string
  receiver_id: number
  channel: string
  title: string
  content: string
  biz_type?: string | null
  biz_id?: number | null
  send_status: string
  provider_msg?: string | null
  read_status: number
  create_time: string
}

export interface PageData<T> {
  list: T[]
  total: number
  page: number
  size: number
}

class PortalApiError extends Error {
  code: string
  status: number
  constructor(message: string, code = 'B0001', status = 0) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? ''
}

export function getProfile(): PortalProfile | null {
  const raw = sessionStorage.getItem(PROFILE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PortalProfile
  } catch {
    return null
  }
}

export function setSession(token: string, profile: PortalProfile): void {
  sessionStorage.setItem(TOKEN_KEY, token)
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
}

export function updateProfile(profile: PortalProfile): void {
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
}

export function can(code: string): boolean {
  const permissions = getProfile()?.permissions
  if (!permissions) return true
  return permissions.includes(code)
}

export function clearSession(): void {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(PROFILE_KEY)
}

const http = axios.create({ baseURL: '/api', timeout: 30000 })

http.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (response) => {
    const body = response.data as { code: string; message: string; data: unknown }
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === '00000') return body.data as never
      return Promise.reject(new PortalApiError(body.message || '请求失败', body.code, response.status))
    }
    return response.data as never
  },
  (error: { response?: { status: number; data?: { code?: string; message?: string } }; message?: string }) => {
    const status = error.response?.status ?? 0
    const body = error.response?.data
    const code = body?.code || `HTTP_${status}`
    if (status === 401 || code === 'A0003') {
      clearSession()
      const path = window.location.pathname
      const loginPath = path.startsWith('/m') ? '/m/login' : '/login'
      if (path !== '/login' && path !== '/m/login') {
        window.location.href = loginPath
      }
    }
    return Promise.reject(new PortalApiError(body?.message || error.message || '网络异常', code, status))
  }
)

async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as Promise<T>
}

async function post<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as Promise<T>
}

// ---------------- 认证 ----------------

export interface PortalMeta {
  sms_provider: string
  wx_provider: string
  pickup_photo_min: number
  dev_tools: boolean
}

export function fetchPortalMeta(): Promise<PortalMeta> {
  return get<PortalMeta>('/portal/meta')
}

export function passwordLogin(account: string, password: string): Promise<{ token: string; profile: PortalProfile }> {
  return post('/portal/auth/login', { account, password })
}

export function driverPasswordLogin(account: string, password: string): Promise<{ token: string; profile: PortalProfile }> {
  return post('/portal/auth/driver-login', { account, password })
}

export function staffLogin(phone: string, password: string): Promise<{ token: string; profile: PortalProfile }> {
  return post('/portal/auth/staff-login', { phone, password })
}

export function sendSmsCode(phone: string): Promise<{ dev_code?: string; mock: boolean }> {
  return post('/portal/auth/sms-code', { phone })
}

/** 司机可登录的承运商（同一手机号在多家承运商各有档案时用于选择/切换） */
export interface DriverCarrierOption {
  carrier_id: number
  carrier_name: string
  driver_id: number
  driver_name: string
  active_task_count: number
  current?: boolean
}

export type SmsLoginResult =
  | { need_choice: false; token: string; profile: PortalProfile; auto_selected?: boolean }
  | { need_choice: true; ticket: string; expire_in: number; carriers: DriverCarrierOption[] }

export function smsLogin(phone: string, code: string): Promise<SmsLoginResult> {
  return post('/portal/auth/sms-login', { phone, code })
}

export function confirmSmsLogin(
  ticket: string,
  carrierId: number
): Promise<{ token: string; profile: PortalProfile }> {
  return post('/portal/auth/sms-login/confirm', { ticket, carrier_id: carrierId })
}

export function fetchMyCarriers(): Promise<DriverCarrierOption[]> {
  return get('/portal/auth/my-carriers')
}

export function switchCarrier(carrierId: number): Promise<{ token: string; profile: PortalProfile }> {
  return post('/portal/auth/switch-carrier', { carrier_id: carrierId })
}

export function fetchMe(): Promise<PortalProfile> {
  return get('/portal/auth/me')
}

// ---------------- 公共 ----------------

export function uploadImage(dataUrl: string): Promise<{ url: string; size: number }> {
  return post('/portal/files/upload', { data_url: dataUrl })
}

export function devWmsOutbound(taskId: number): Promise<{ status: string }> {
  return post(`/portal/dev/tasks/${taskId}/wms-outbound`)
}

// ---------------- 承运商端 ----------------

export interface CarrierCounts {
  counts: Record<string, number>
  labels: Record<string, string>
}

export function fetchCarrierCounts(): Promise<CarrierCounts> {
  return get('/portal/carrier/tasks/counts')
}

export function fetchCarrierTasks(params: {
  page?: number
  size?: number
  status?: string
  task_no?: string
  order_no?: string
  apply_no?: string
  vin?: string
  customer_name?: string
  keyword?: string
}): Promise<PageData<PortalTask>> {
  return get('/portal/carrier/tasks', params)
}

export function fetchCarrierTask(id: number): Promise<PortalTaskDetail> {
  return get(`/portal/carrier/tasks/${id}`)
}

export function assignCarrierTask(
  id: number,
  payload: { driver_id: number; version: number }
): Promise<{ status: string; version: number; driver_name: string }> {
  return post(`/portal/carrier/tasks/${id}/assign`, payload)
}

export function fetchCarrierDrivers(params: {
  keyword?: string
  carrier_id?: number | null
  driver_name?: string
  phone?: string
  license_no?: string
  status?: number | '' | null
} = {}): Promise<PortalDriver[]> {
  const { carrier_id: carrierId, ...rest } = params
  const query: Record<string, unknown> = {}
  Object.entries(rest).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query[key] = value
  })
  if (carrierId) query.carrier_id = carrierId
  return get('/portal/carrier/drivers', Object.keys(query).length ? query : undefined)
}

export interface DriverPayload {
  name: string
  phone: string
  id_card: string
  license_no?: string
  license_type?: string
  license_valid_from: string
  license_valid_to: string
  remark?: string
}

export function createCarrierDriver(payload: DriverPayload): Promise<{ driver: PortalDriver; reused: boolean }> {
  return post('/portal/carrier/drivers', payload)
}

export function updateCarrierDriver(id: number, payload: Partial<DriverPayload>): Promise<PortalDriver> {
  return http.put(`/portal/carrier/drivers/${id}`, payload) as Promise<PortalDriver>
}

export function updateCarrierDriverStatus(id: number, status: 0 | 1): Promise<{ id: number; status: number }> {
  return http.put(`/portal/carrier/drivers/${id}/status`, { status }) as Promise<{ id: number; status: number }>
}

export function fetchCarrierNotifications(): Promise<PortalNotification[]> {
  return get('/portal/carrier/notifications')
}

export function readCarrierNotification(id: number): Promise<null> {
  return post(`/portal/carrier/notifications/${id}/read`)
}

// ---------------- 司机端 ----------------

export function fetchDriverTasks(params: {
  page?: number
  size?: number
  tab?: string
  task_no?: string
  order_no?: string
  apply_no?: string
  vin?: string
  customer_name?: string
  keyword?: string
}): Promise<PageData<PortalTask>> {
  return get('/portal/driver/tasks', params)
}

export function fetchDriverTask(id: number): Promise<PortalTaskDetail> {
  return get(`/portal/driver/tasks/${id}`)
}

export function driverPickup(
  id: number,
  payload: { version: number; photos: string[]; pickup_date?: string }
): Promise<{ status: string; version: number }> {
  return post(`/portal/driver/tasks/${id}/pickup`, payload)
}

export function driverArrive(
  id: number,
  payload: {
    version: number
    photos: string[]
    actual_freight: number
    mileage?: number | null
    arrive_time?: string
  }
): Promise<{ status: string; version: number; freight_no: string }> {
  return post(`/portal/driver/tasks/${id}/arrive`, payload)
}

export function driverFinish(
  id: number,
  payload: { version: number; photos: string[]; receiver?: string; remark?: string }
): Promise<{ status: string; version: number }> {
  return post(`/portal/driver/tasks/${id}/finish`, payload)
}

export function fetchDriverNotifications(): Promise<PortalNotification[]> {
  return get('/portal/driver/notifications')
}

export function readDriverNotification(id: number): Promise<null> {
  return post(`/portal/driver/notifications/${id}/read`)
}

// ---------------- 展示辅助 ----------------

export const TASK_STATUS_LABELS: Record<string, string> = {
  WAIT_DISPATCH: '待派单',
  DISPATCHED: '待接单',
  CARRIER_ACCEPTED: '待提车',
  PICKED: '已提车',
  OUTBOUND: '已出库',
  IN_TRANSIT: '在途',
  ARRIVED: '待结单',
  FINISHED: '已完结',
  CANCELLED: '已取消',
}

export function statusLabel(status: string): string {
  return TASK_STATUS_LABELS[status] || status
}

export const ROLE_OPTIONS = [
  { value: 'ADMIN', label: '平台管理员', hint: '登录后台，可使用全部功能并配置账号角色' },
  { value: 'CARRIER_ADMIN', label: '承运商管理员', hint: '登录后台，只处理本承运商的任务、司机和消息' },
  { value: 'CARRIER_DISPATCHER', label: '承运商调度', hint: '登录后台，只处理本承运商的任务、司机和消息' },
  { value: 'DRIVER', label: '司机', hint: '不能登录后台，只能登录小程序' },
] as const

export function roleLabel(role?: string | null): string {
  return ROLE_OPTIONS.find((item) => item.value === role)?.label || role || '-'
}

export interface AccountRow {
  id: number
  username?: string | null
  account_type: string
  phone: string
  display_name: string
  carrier_id?: number | null
  driver_id?: number | null
  role_id?: number | null
  role_name?: string | null
  role_kind?: string | null
  role: string
  status: number
  last_login_time?: string | null
  carrier_name?: string | null
  driver_name?: string | null
}

export function listAccounts(params: {
  page?: number
  size?: number
  username?: string
  display_name?: string
  phone?: string
  keyword?: string
  account_type?: string
}): Promise<PageData<AccountRow>> {
  return get('/portal/accounts', params)
}

export function createAccount(payload: Record<string, unknown>): Promise<{ id: number }> {
  return post('/portal/accounts', payload)
}

export function updateAccount(id: number, payload: Record<string, unknown>): Promise<{ id: number }> {
  return http.put(`/portal/accounts/${id}`, payload) as Promise<{ id: number }>
}

export interface RoleRow {
  id: number
  role_code: string
  role_name: string
  role_kind: 'SUPER' | 'PLATFORM' | 'CARRIER' | 'DRIVER'
  remark?: string | null
  status: number
  builtin: number
  update_time?: string
  permissions?: string[]
  carrier_ids?: number[]
  carrier_all?: boolean
  materials?: string[]
}

export interface PermModule {
  code: string
  name: string
  kind: 'PLATFORM' | 'CARRIER' | 'DRIVER'
  actions: Array<{ code: string; name: string }>
}

export function listRoles(params: {
  page?: number
  size?: number
  role_name?: string
  role_code?: string
  role_kind?: string
  status?: number | '' | null
  keyword?: string
} = {}): Promise<PageData<RoleRow>> {
  return get('/portal/roles', params)
}

export function getRole(id: number): Promise<RoleRow> {
  return get(`/portal/roles/${id}`)
}

export function roleCatalog(): Promise<{
  modules: PermModule[]
  materials: Array<{ value: string; label: string }>
  carriers: Array<{ id: number; carrier_name: string }>
}> {
  return get('/portal/roles/catalog')
}

export function createRole(payload: Record<string, unknown>): Promise<{ id: number }> {
  return post('/portal/roles', payload)
}

export function updateRole(id: number, payload: Record<string, unknown>): Promise<{ id: number }> {
  return http.put(`/portal/roles/${id}`, payload) as Promise<{ id: number }>
}

export function saveRolePermissions(id: number, payload: Record<string, unknown>): Promise<{ id: number }> {
  return http.put(`/portal/roles/${id}/permissions`, payload) as Promise<{ id: number }>
}

export function maskIdCard(value?: string | null): string {
  if (!value) return '-'
  return value.length > 8 ? `${value.slice(0, 4)}**********${value.slice(-4)}` : value
}

/** 文件转 data URL（压缩到最长边 1600px，JPEG 0.82） */
export function fileToCompressedDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('图片格式不支持'))
      img.onload = () => {
        const max = 1600
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('浏览器不支持图片压缩'))
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
