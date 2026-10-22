/**
 * 高德 JS API 2.0 加载器。
 * Key 与安全密钥放在 frontend/.env，不进仓库。
 */

let loading: Promise<AMapNamespace> | null = null

export interface AMapNamespace {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => AMapInstance
  Polyline: new (opts: Record<string, unknown>) => AMapOverlay
  Marker: new (opts: Record<string, unknown>) => AMapOverlay
  Pixel: new (x: number, y: number) => unknown
  DistrictLayer?: {
    Country: new (opts: Record<string, unknown>) => AMapDistrict
  }
  plugin?: (names: string[], cb: () => void) => void
  ToolBar?: new (opts: Record<string, unknown>) => unknown
  Scale?: new (opts?: Record<string, unknown>) => unknown
}

export interface AMapInstance {
  add: (overlay: unknown) => void
  remove: (overlay: unknown) => void
  getAllOverlays?: () => unknown[]
  addControl: (control: unknown) => void
  setFitView: (
    overlays: unknown[] | null | undefined,
    immediately: boolean,
    avoid: number[],
    maxZoom?: number,
  ) => void
  setZoomAndCenter: (zoom: number, center: [number, number], immediately?: boolean) => void
  getZoom?: () => number
  resize: () => void
  destroy: () => void
  setPitch?: (pitch: number, immediately?: boolean) => void
  setRotation?: (rotation: number, immediately?: boolean) => void
  on: (event: string, handler: (event: AMapClickEvent) => void) => void
}

export interface AMapOverlay {
  on: (event: string, handler: (event?: unknown) => void) => void
  setOptions: (opts: Record<string, unknown>) => void
  getExtData: () => { id?: number; alert?: boolean }
}

export interface AMapDistrict {
  setMap: (map: AMapInstance | null) => void
  setStyles?: (styles: Record<string, unknown>) => void
  getDistrictByContainerPos?: (pixel: unknown) => { NAME_CHN?: string; NAME?: string } | null
}

export interface AMapClickEvent {
  pixel?: unknown
}

interface AMapWindow extends Window {
  AMap?: AMapNamespace
  Loca?: unknown
  _AMapSecurityConfig?: { securityJsCode: string }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`脚本加载失败: ${src}`))
    document.head.appendChild(script)
  })
}

export function amapKey(): string {
  return String(import.meta.env.VITE_AMAP_KEY ?? '').trim()
}

export function loadAmap(): Promise<AMapNamespace> {
  const key = amapKey()
  if (!key) return Promise.reject(new Error('未配置高德 Key'))
  const w = window as AMapWindow
  if (w.AMap && w.Loca) return Promise.resolve(w.AMap)
  if (loading) return loading

  const security = String(import.meta.env.VITE_AMAP_SECURITY_JS_CODE ?? '').trim()
  if (security) w._AMapSecurityConfig = { securityJsCode: security }

  loading = (async () => {
    if (!w.AMap) {
      await loadScript(
        `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.ToolBar,AMap.Scale`,
      )
    }
    if (!w.AMap) throw new Error('高德地图脚本已加载，但未挂上 AMap')
    if (!w.Loca) {
      await loadScript(`https://webapi.amap.com/loca?v=2.0.0&key=${encodeURIComponent(key)}`)
    }
    return w.AMap
  })().catch((error) => {
    loading = null
    throw error
  })
  return loading
}
