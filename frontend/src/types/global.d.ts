/**
 * 全局类型声明
 * - window.intlTelInput / window.itiZh：由 index.html 引入的本地 vendor 脚本挂载
 *  （public/vendor/intl-tel-input/js/intlTelInputWithUtils.min.js 与 iti-zh-locale.js）
 * - naive-ui 全量注册（main.ts 中 app.use(naive)）后，
 *   通过引入 naive-ui 自带的 volar.d.ts 使模板中的 N* 组件获得类型提示
 */

import 'naive-ui/volar.d.ts'

// 顶部 import 使本文件成为模块，全局声明必须放进 declare global
interface ImportMetaEnv {
  readonly VITE_AMAP_KEY?: string
  readonly VITE_AMAP_SECURITY_JS_CODE?: string
}

declare global {
  /** intl-tel-input 实例（组件通过 expose 暴露给业务方做校验） */
  interface IntlTelInputInstance {
    /** 输出 E.164 格式号码，号码不完整时返回 undefined */
    getNumber(): string | undefined
    /** 设置号码（自动识别国家），v24+ 支持 */
    setNumber(number: string): void
    setCountry(iso2: string): void
    getSelectedCountryData(): { iso2: string; dialCode?: string; name?: string } | null
    /** 宽松校验（v29 中仅位数校验，演示环境建议用 isValidNumberPrecise） */
    isValidNumber?(): boolean
    /** 严格校验（libphonenumber isValidNumberPrecise） */
    isValidNumberPrecise?(): boolean
    getNumberType?(): number
    getValidationError?(): number
    destroy(): void
  }

  interface Window {
    intlTelInput?: (input: HTMLInputElement, options: Record<string, unknown>) => IntlTelInputInstance
    /** 中文文案（selectedCountryAriaLabel 等），PhoneInput 初始化时传入 i18n */
    itiZh?: Record<string, unknown>
  }
}

export {}
