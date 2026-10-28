<script setup lang="ts">
/**
 * 登录页。左侧使用深向卡车原图，右侧账号密码登录。
 * 域账号和扫码入口先展示，暂不开放。司机账号会被拒绝，并引导到小程序。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { passwordLogin, setSession } from '@/services/portal'
import { useSessionStore } from '@/stores/session'
import type { PortalProfile } from '@/services/portal'
import truck from '@/assets/login-truck-photo.jpg'

const router = useRouter()
const message = useMessage()
const session = useSessionStore()
const account = ref('')
const password = ref('')
const showPassword = ref(false)
const loading = ref(false)
const tab = ref<'ldap' | 'password' | 'qr'>('password')

function homeOf(profile: PortalProfile) {
  return profile.type === 'CARRIER' ? '/portal/carrier/tasks' : '/dashboard'
}

function pickTab(next: 'ldap' | 'password' | 'qr') {
  tab.value = next
  if (next !== 'password') message.info('该登录方式暂未开放')
}

async function onSubmit() {
  if (tab.value !== 'password') {
    message.info('请使用密码登录')
    return
  }
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
    const res = await passwordLogin(account.value.trim(), password.value)
    setSession(res.token, res.profile)
    session.applyProfile()
    message.success(`欢迎回来，${res.profile.name}`)
    router.replace(homeOf(res.profile))
  } catch (e) {
    message.error(e instanceof Error ? e.message : '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <img class="login__photo" :src="truck" alt="" />
    <div class="login__slant" aria-hidden="true"></div>
    <form class="login__form" @submit.prevent="onSubmit">
      <div class="login__brand">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M4 10.5 16 4l12 6.5L16 17 4 10.5Z" />
          <path d="M4 18.2 16 11.7l12 6.5L16 24.7 4 18.2Z" />
        </svg>
        <span>深向</span>
      </div>
      <div class="login__tabs">
        <button type="button" :class="{ 'is-on': tab === 'ldap' }" @click="pickTab('ldap')">域账号</button>
        <button type="button" :class="{ 'is-on': tab === 'password' }" @click="pickTab('password')">密码登录</button>
        <button type="button" :class="{ 'is-on': tab === 'qr' }" @click="pickTab('qr')">app扫码登录</button>
      </div>
      <label class="login__field">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19.2c.8-3.2 3.2-5 6.5-5s5.7 1.8 6.5 5"/></svg>
        <input v-model="account" autocomplete="username" placeholder="请输入账号" />
      </label>
      <label class="login__field">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="10" width="12" height="9" rx="1.4"/><path d="M8.5 10V8.2a3.5 3.5 0 0 1 7 0V10"/></svg>
        <input
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
          placeholder="请输入密码"
        />
        <button type="button" class="login__eye" tabindex="-1" @click="showPassword = !showPassword">
          {{ showPassword ? '隐藏' : '显示' }}
        </button>
      </label>
      <button class="login__go" type="submit" :disabled="loading">{{ loading ? '登录中…' : '登 录' }}</button>
      <div class="login__other">
        <span>其他登录方式</span>
        <button type="button" class="login__mini" @click="router.push('/m/login')">司机小程序</button>
      </div>
      <p class="login__copy">©2024 安徽深向科技有限公司</p>
    </form>
  </div>
</template>

<style scoped>
.login {
  position: relative;
  height: 100vh;
  overflow: hidden;
  background: #f5f6fb;
}
.login__photo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 22% center;
}
.login__slant {
  position: absolute;
  top: -8%;
  right: -6%;
  width: 50%;
  height: 116%;
  background: #fafafa;
  transform: skewX(-10deg);
  transform-origin: center right;
}
.login__form {
  position: absolute;
  top: 0;
  right: 16vw;
  width: 340px;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  box-sizing: border-box;
}
.login__brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 28px;
  color: #2d3033;
}
.login__brand svg {
  width: 36px;
  height: 36px;
  fill: #2d3033;
}
.login__brand span {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 4px;
}
.login__tabs {
  display: flex;
  justify-content: center;
  gap: 22px;
  margin-bottom: 22px;
}
.login__tabs button {
  padding: 0 0 8px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #666666;
  font-size: 14px;
  cursor: pointer;
}
.login__tabs button.is-on {
  color: #2d3033;
  font-weight: 600;
  border-bottom-color: #2d3033;
}
.login__field {
  position: relative;
  display: block;
  margin-bottom: 14px;
}
.login__field svg {
  position: absolute;
  left: 12px;
  top: 13px;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: #666666;
  stroke-width: 1.6;
}
.login__field input {
  width: 100%;
  height: 44px;
  padding: 0 64px 0 40px;
  border: 1px solid #eeeeee;
  border-radius: 2px;
  background: #fff;
  color: #2d3033;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
}
.login__field input:focus { border-color: #999999; }
.login__eye {
  position: absolute;
  right: 8px;
  top: 8px;
  height: 28px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: #666666;
  font-size: 12px;
  cursor: pointer;
}
.login__go {
  height: 44px;
  margin-top: 8px;
  border: 0;
  border-radius: 2px;
  background: #001529;
  color: #fff;
  font-size: 16px;
  letter-spacing: 6px;
  cursor: pointer;
}
.login__go:disabled { cursor: default; opacity: 0.7; }
.login__other {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-top: 36px;
  color: #999999;
  font-size: 12px;
}
.login__other span {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.login__other span::before,
.login__other span::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #eeeeee;
}
.login__mini {
  height: 32px;
  padding: 0 14px;
  border: 1px solid #eeeeee;
  border-radius: 16px;
  background: #fff;
  color: #2d3033;
  font-size: 13px;
  cursor: pointer;
}
.login__copy {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 22px;
  margin: 0;
  color: #999999;
  font-size: 12px;
  text-align: center;
}
@media (max-width: 900px) {
  .login__photo {
    height: 42%;
    object-position: center 40%;
  }
  .login__slant {
    top: 36%;
    right: 0;
    width: 100%;
    height: 70%;
    transform: none;
  }
  .login__form {
    top: 38%;
    right: 0;
    left: 0;
    width: auto;
    height: 62%;
    padding: 24px 24px 48px;
  }
  .login__copy { left: 24px; right: 24px; }
}
</style>
