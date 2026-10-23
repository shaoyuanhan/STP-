<script setup lang="ts">
/**
 * 司机小程序登录。默认手机号 + 短信验证码（司机日常只记手机号）。
 * 同一手机号在多家承运商有档案时：
 *   - 只有一家有在途任务 → 后端自动进入该家；
 *   - 否则弹承运商选择面板，选完再换 token。
 * 需要密码登录的司机可通过底部入口切换。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import CarrierSheet from '@/components/CarrierSheet.vue'
import {
  confirmSmsLogin,
  driverPasswordLogin,
  sendSmsCode,
  setSession,
  smsLogin,
  type DriverCarrierOption,
  type PortalProfile,
} from '@/services/portal'

const router = useRouter()
const message = useMessage()

const mode = ref<'sms' | 'password'>('sms')
const phone = ref('')
const code = ref('')
const account = ref('')
const password = ref('')

const loading = ref(false)
const countdown = ref(0)
const devCode = ref('')
const lastCarrier = ref<number | null>(Number(localStorage.getItem('stp_last_carrier')) || null)

const tickets = ref('')
const carriers = ref<DriverCarrierOption[]>([])
const showSheet = ref(false)

let timer: number | undefined
const codeButtonText = computed(() => (countdown.value > 0 ? `${countdown.value}s 后重发` : '获取验证码'))

// 自动填充/输入法常带入空格或横线，统一过滤为连续字符，避免用户看到 "139 1111 0008" 这类分组
function onPhoneInput(e: Event) {
  const el = e.target as HTMLInputElement
  const cleaned = el.value.replace(/[\s-]/g, '')
  if (el.value !== cleaned) el.value = cleaned
  phone.value = cleaned
}

function onAccountInput(e: Event) {
  const el = e.target as HTMLInputElement
  const cleaned = el.value.replace(/[\s-]/g, '')
  if (el.value !== cleaned) el.value = cleaned
  account.value = cleaned
}

function startCountdown() {
  countdown.value = 60
  window.clearInterval(timer)
  timer = window.setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) window.clearInterval(timer)
  }, 1000)
}

onBeforeUnmount(() => window.clearInterval(timer))

async function onSendCode() {
  if (!/^1\d{10}$/.test(phone.value)) {
    message.warning('请输入 11 位手机号')
    return
  }
  loading.value = true
  try {
    const res = await sendSmsCode(phone.value)
    devCode.value = res.dev_code || ''
    startCountdown()
    message.success(res.dev_code ? `验证码已发送（测试环境：${res.dev_code}）` : '验证码已发送')
  } catch (e) {
    message.error(e instanceof Error ? e.message : '发送失败')
  } finally {
    loading.value = false
  }
}

function enter(token: string, profile: PortalProfile, auto: boolean) {
  setSession(token, profile)
  localStorage.setItem('stp_last_carrier', String(profile.carrier_id ?? ''))
  message.success(
    auto && profile.carrier_name
      ? `已进入 ${profile.carrier_name}`
      : `登录成功，${profile.driver_name || profile.name}`
  )
  router.replace('/m/tasks')
}

async function onSmsSubmit() {
  if (!/^1\d{10}$/.test(phone.value)) {
    message.warning('请输入 11 位手机号')
    return
  }
  if (!/^\d{6}$/.test(code.value)) {
    message.warning('请输入 6 位验证码')
    return
  }
  loading.value = true
  try {
    const res = await smsLogin(phone.value, code.value)
    if (res.need_choice) {
      tickets.value = res.ticket
      carriers.value = res.carriers
      showSheet.value = true
      return
    }
    enter(res.token, res.profile, Boolean(res.auto_selected))
  } catch (e) {
    message.error(e instanceof Error ? e.message : '登录失败')
  } finally {
    loading.value = false
  }
}

async function onPickCarrier(carrierId: number) {
  loading.value = true
  try {
    const res = await confirmSmsLogin(tickets.value, carrierId)
    showSheet.value = false
    enter(res.token, res.profile, false)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '登录失败')
  } finally {
    loading.value = false
  }
}

async function onPasswordSubmit() {
  if (!account.value.trim()) {
    message.warning('请输入账号')
    return
  }
  if (!password.value) {
    message.warning('请输入密码')
    return
  }
  loading.value = true
  try {
    const res = await driverPasswordLogin(account.value, password.value)
    enter(res.token, res.profile, false)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mini">
    <div class="mini__phone">
      <div class="mini__sheet">
        <div class="mini__brand">
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <path d="M7 9.2 18 4l11 5.2L18 14.4 7 9.2Z" />
            <path d="M7 16.2 18 11l11 5.2L18 21.4 7 16.2Z" />
            <path d="M11.2 22.2 18 18.6l6.8 3.6L18 32l-6.8-9.8Z" />
          </svg>
          <span>深向</span>
        </div>
        <p class="mini__title">司机小程序</p>

        <form v-if="mode === 'sms'" @submit.prevent="onSmsSubmit">
          <label>
            <input
              :value="phone"
              inputmode="numeric"
              placeholder="请输入手机号"
              autocomplete="tel"
              @input="onPhoneInput"
            />
          </label>
          <label class="mini__code">
            <input
              v-model="code"
              inputmode="numeric"
              maxlength="6"
              placeholder="请输入验证码"
              autocomplete="one-time-code"
            />
            <button type="button" class="mini__send" :disabled="loading || countdown > 0" @click="onSendCode">
              {{ codeButtonText }}
            </button>
          </label>
          <button type="submit" :disabled="loading">{{ loading ? '登录中…' : '登 录' }}</button>
        </form>

        <form v-else @submit.prevent="onPasswordSubmit">
          <label>
            <input :value="account" placeholder="请输入账号或手机号" autocomplete="username" @input="onAccountInput" />
          </label>
          <label>
            <input v-model="password" type="password" placeholder="请输入密码" autocomplete="current-password" />
          </label>
          <button type="submit" :disabled="loading">{{ loading ? '登录中…' : '登 录' }}</button>
        </form>

        <p class="mini__switch">
          <button type="button" @click="mode = mode === 'sms' ? 'password' : 'sms'">
            {{ mode === 'sms' ? '使用密码登录' : '使用手机号验证码登录' }}
          </button>
        </p>
        <p class="mini__copy">©2024 安徽深向科技有限公司</p>
      </div>
    </div>

    <CarrierSheet
      :show="showSheet"
      :carriers="carriers"
      :current="lastCarrier"
      :loading="loading"
      @select="onPickCarrier"
      @close="showSheet = false"
    />
  </div>
</template>

<style scoped>
.mini {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e8eaed;
}
.mini__phone {
  width: min(390px, 100%);
  height: min(780px, 100%);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12);
}
.mini__sheet {
  flex: 1;
  padding: 56px 28px 20px;
}
.mini__brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #1a1a1a;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 2px;
}
.mini__brand svg {
  width: 30px;
  height: 30px;
  fill: #1a1a1a;
}
.mini__title {
  margin: 8px 0 22px;
  color: #8c8c8c;
  font-size: 13px;
  text-align: center;
}
form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
input {
  width: 100%;
  height: 42px;
  padding: 0 12px;
  border: 1px solid #e5e6eb;
  border-radius: 4px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
}
input:focus {
  border-color: #1a1a1a;
}
.mini__code {
  position: relative;
  display: block;
}
.mini__code input {
  padding-right: 112px;
}
.mini__send {
  position: absolute;
  top: 6px;
  right: 6px;
  height: 30px;
  min-width: 96px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  background: #fff;
  color: #1a1a1a;
  font-size: 12px;
  cursor: pointer;
}
.mini__send:disabled {
  color: #bfbfbf;
  cursor: default;
}
button[type='submit'] {
  height: 42px;
  margin-top: 6px;
  border: 0;
  border-radius: 4px;
  background: #1a1a1a;
  color: #fff;
  font-size: 15px;
  letter-spacing: 6px;
  cursor: pointer;
}
button[type='submit']:disabled {
  opacity: 0.7;
}
.mini__switch {
  margin: 14px 0 0;
  text-align: center;
}
.mini__switch button {
  border: 0;
  background: transparent;
  color: #595959;
  font-size: 12px;
  cursor: pointer;
}
.mini__copy {
  margin: 28px 0 0;
  color: #c0c4cc;
  font-size: 12px;
  text-align: center;
}
</style>
