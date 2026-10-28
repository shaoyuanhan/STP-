/**
 * 展示格式化工具
 *  - money：千分位 + 两位小数（金额 DECIMAL 可能以字符串返回，统一 Number() 归一）
 *  - datetime：YYYY-MM-DD HH:mm
 *  - dateShort：MM-DD HH:mm
 *  - formatPhone：E.164 → 展示格式（国内 138 0013 8000）
 */

/** 金额展示：千分位 + 两位小数；空值/非法值返回占位符 */
export function money(
  value: number | string | null | undefined,
  options: { placeholder?: string } = {},
): string {
  const { placeholder = '-' } = options
  if (value === null || value === undefined || value === '') return placeholder
  const num = Number(value)
  if (!Number.isFinite(num)) return placeholder
  return num.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** 解析时间：兼容 Date / 时间戳 / 'YYYY-MM-DD HH:mm:ss' / ISO 字符串 */
function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  // 'YYYY-MM-DD HH:mm:ss' → ISO 化，避免 Safari 解析失败
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)
    ? text.replace(' ', 'T')
    : text
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 日期时间：YYYY-MM-DD HH:mm:ss；空值/非法值返回占位符 */
export function datetime(value: unknown, placeholder = '-'): string {
  const d = parseDate(value)
  if (!d) return placeholder
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 短日期时间：MM-DD HH:mm（同年内省去年份） */
export function dateShort(value: unknown, placeholder = '-'): string {
  const d = parseDate(value)
  if (!d) return placeholder
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 纯日期：YYYY-MM-DD */
export function dateOnly(value: unknown, placeholder = '-'): string {
  const d = parseDate(value)
  if (!d) return placeholder
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 电话展示格式化：
 *  - E.164 国内 +8613xxxxxxxxx → 138 0013 8000
 *  - 无 + 前缀的 11 位国内号 → 138 0013 8000
 *  - 其他国际号码原样返回
 */
export function formatPhone(value: unknown, placeholder = '-'): string {
  if (value === null || value === undefined || value === '') return placeholder
  const text = String(value).trim()
  // 国内手机号（E.164 或裸号）
  const cnMatch = /^(?:\+?86)?(1[3-9]\d{9})$/.exec(text)
  if (cnMatch) {
    const m = cnMatch[1]
    return `${m.slice(0, 3)} ${m.slice(3, 7)} ${m.slice(7)}`
  }
  // 国内座机：区号-号码
  const telMatch = /^(0\d{2,3})-?(\d{7,8})$/.exec(text)
  if (telMatch) return `${telMatch[1]}-${telMatch[2]}`
  return text
}
