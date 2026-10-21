<script setup lang="ts">
/**
 * 临时登录页。深向原图登录先隐藏，等原始素材到了再按原图重做。
 * 目前只校验账号密码。司机账号会被拒绝，并引导到小程序。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { passwordLogin, setSession } from '@/services/portal'
import { useSessionStore } from '@/stores/session'
import type { PortalProfile } from '@/services/portal'

const router = useRouter()
const message = useMessage()
const session = useSessionStore()
const account = ref('')
const password = ref('')
const loading = ref(false)

function homeOf(profile: PortalProfile) {
  return profile.type === 'CARRIER' ? '/portal/carrier/dashboard' : '/dashboard'
}

async function onSubmit() {
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
    <form class="login__card" @submit.prevent="onSubmit">
      <h1>DEEP WAY 智能运输管理平台</h1>
      <label>
        <span>账号</span>
        <input v-model="account" autocomplete="username" placeholder="请输入账号" />
      </label>
      <label>
        <span>密码</span>
        <input v-model="password" type="password" autocomplete="current-password" placeholder="请输入密码" />
      </label>
      <button type="submit" :disabled="loading">{{ loading ? '登录中…' : '登录' }}</button>
      <button type="button" class="login__mini" @click="router.push('/m/login')">司机小程序登录</button>
    </form>
  </div>
</template>

<style scoped>
.login {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f3f5f8;
}
.login__card {
  width: 360px;
  padding: 32px 28px 24px;
  background: #fff;
  border: 1px solid #e8e8e8;
}
.login__card h1 {
  margin: 0 0 24px;
  color: #1c2433;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
}
label {
  display: block;
  margin-bottom: 14px;
}
label span {
  display: block;
  margin-bottom: 6px;
  color: #595959;
  font-size: 13px;
}
input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border: 1px solid #d9d9d9;
  border-radius: 2px;
  color: #1a1a1a;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
}
input:focus { border-color: #0e6e64; }
button[type='submit'] {
  width: 100%;
  height: 36px;
  margin-top: 8px;
  border: 0;
  border-radius: 2px;
  background: #1c2433;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
button[type='submit']:disabled { cursor: default; opacity: 0.7; }
.login__mini {
  width: 100%;
  margin-top: 12px;
  border: 0;
  background: transparent;
  color: #0e6e64;
  font-size: 13px;
  cursor: pointer;
}
</style>
