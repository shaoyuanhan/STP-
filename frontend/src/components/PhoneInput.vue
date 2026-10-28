<script setup lang="ts">
/**
 * 国际电话号码输入（intl-tel-input 本地 vendor 包装）
 *
 * 依赖：index.html 已引入本地 vendor 脚本（public/vendor/intl-tel-input），
 *       window.intlTelInput（含 libphonenumber utils）与 window.itiZh（中文文案）。
 *
 * 用法：
 *   <PhoneInput v-model="form.phone" placeholder="请输入手机号" />
 *
 * 约定：
 *  - v-model 输出 E.164（如 +8613800138000；输入未完成时输出 ''）
 *  - 默认中国 +86，initialValue 自动识别国家并回填
 *  - 表单校验：通过 ref 暴露的 isValid()（libphonenumber 严格校验）
 *  - 组件销毁时调用 iti.destroy() 释放 DOM
 */

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue?: string | null
    placeholder?: string
    disabled?: boolean
    /** 初始国家（ISO 2 位码），默认中国 */
    initialCountry?: string
    /** 区号与号码分离展示（默认开启） */
    separateDialCode?: boolean
  }>(),
  {
    modelValue: '',
    placeholder: '请输入电话号码',
    disabled: false,
    initialCountry: 'cn',
    separateDialCode: true,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
  (e: 'blur', event: FocusEvent): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)
let iti: IntlTelInputInstance | null = null

function currentE164(): string {
  if (iti) return iti.getNumber() || ''
  return inputRef.value?.value ?? ''
}

function emitValue() {
  const value = currentE164()
  emit('update:modelValue', value)
  emit('change', value)
}

onMounted(() => {
  const input = inputRef.value
  if (!input) return
  if (typeof window.intlTelInput === 'function') {
    iti = window.intlTelInput(input, {
      initialCountry: props.initialCountry,
      separateDialCode: props.separateDialCode,
      placeholderNumberType: 'MOBILE',
      i18n: window.itiZh ?? undefined,
    })
    // 初始值处理：E.164 自动识别国家并回填
    if (props.modelValue) iti.setNumber(props.modelValue)
    input.addEventListener('input', emitValue)
    input.addEventListener('countrychange', emitValue)
  } else {
    // vendor 脚本未就绪时降级为普通输入框（输出原始值）
    console.warn('[PhoneInput] window.intlTelInput 未加载，已降级为普通输入框（请检查 index.html vendor 脚本）')
    input.value = props.modelValue ?? ''
    input.addEventListener('input', emitValue)
  }
})

// 外部赋值同步（如编辑弹窗回显、表单重置）
watch(
  () => props.modelValue,
  (next) => {
    const value = next ?? ''
    if (value === currentE164()) return
    if (iti) {
      if (value) {
        iti.setNumber(value)
      } else {
        iti.setCountry(props.initialCountry)
        if (inputRef.value) inputRef.value.value = ''
      }
    } else if (inputRef.value) {
      inputRef.value.value = value
    }
  },
)

onBeforeUnmount(() => {
  if (inputRef.value) {
    inputRef.value.removeEventListener('input', emitValue)
    inputRef.value.removeEventListener('countrychange', emitValue)
  }
  if (iti) {
    iti.destroy()
    iti = null
  }
})

defineExpose({
  /** intl-tel-input 实例（高级场景直接访问） */
  getInstance: () => iti,
  /** 当前 E.164 值 */
  getNumber: () => currentE164(),
  /** 是否有效号码（libphonenumber 严格校验优先） */
  isValid: (): boolean => {
    if (!iti) return Boolean(inputRef.value?.value)
    if (typeof iti.isValidNumberPrecise === 'function') return iti.isValidNumberPrecise()
    if (typeof iti.isValidNumber === 'function') return iti.isValidNumber()
    return Boolean(iti.getNumber())
  },
  /** 手动重置（清空并恢复默认国家） */
  reset: () => {
    if (iti) {
      iti.setCountry(props.initialCountry)
      if (inputRef.value) inputRef.value.value = ''
      emitValue()
    } else if (inputRef.value) {
      inputRef.value.value = ''
      emitValue()
    }
  },
})
</script>

<template>
  <div class="phone-input" :class="{ 'phone-input--disabled': disabled }">
    <input
      ref="inputRef"
      type="tel"
      class="phone-input__input"
      :placeholder="placeholder"
      :disabled="disabled"
      autocomplete="off"
      @blur="emit('blur', $event)"
    />
  </div>
</template>

<style scoped>
.phone-input {
  width: 100%;
  display: inline-flex;
}

/* intl-tel-input 动态包裹的容器与输入框 */
.phone-input :deep(.iti) {
  width: 100%;
  display: inline-flex;
}

.phone-input :deep(.iti input) {
  flex: 1;
}

.phone-input__input {
  width: 100%;
  height: 34px;
  padding: 0 12px;
  border: 1px solid #eeeeee;
  border-radius: 4px;
  outline: none;
  font-size: 14px;
  color: #2d3033;
  background: #fff;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.phone-input__input::placeholder {
  color: #999999;
}

.phone-input__input:focus {
  border-color: #1890ff;
  box-shadow: 0 0 0 2px rgb(24 144 255 / 12%);
}

.phone-input__input:disabled {
  background: #fafafa;
  cursor: not-allowed;
  color: #999999;
}
</style>
