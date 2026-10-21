<script setup lang="ts">
/**
 * 登录页直接使用深向登录原图，输入框叠在原图的账号、密码和登录按钮上。
 * 目前只校验账号密码。司机账号会被拒绝，并引导到小程序。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { passwordLogin, setSession } from '@/services/portal'
import { useSessionStore } from '@/stores/session'
import type { PortalProfile } from '@/services/portal'
import hero from '@/assets/login-hero.jpg'

const router = useRouter()
const message = useMessage()
const session = useSessionStore()
const account = ref('')
const password = ref('')
const showPassword = ref(false)
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
    <div class="login__frame">
      <img class="login__art" :src="hero" alt="" />
      <form class="login__form" @submit.prevent="onSubmit">
        <input v-model="account" class="login__user" autocomplete="username" placeholder="请输入账号" />
        <input
          v-model="password"
          class="login__pass"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
          placeholder="请输入密码"
        />
        <button type="button" class="login__eye" tabindex="-1" aria-label="显示密码" @click="showPassword = !showPassword"></button>
        <button class="login__go" type="submit" :disabled="loading">{{ loading ? '登录中…' : '' }}</button>
        <button type="button" class="login__mini" aria-label="司机小程序" @click="router.push('/m/login')"></button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f3f5f8;
  overflow: hidden;
}
.login__frame {
  position: relative;
  height: 100vh;
  aspect-ratio: 1024 / 651;
  max-width: 100vw;
  max-height: 100vh;
}
.login__art {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: fill;
  user-select: none;
  pointer-events: none;
}
.login__user,
.login__pass,
.login__go,
.login__eye,
.login__mini {
  position: absolute;
  border: 0;
  background: transparent;
}
.login__user,
.login__pass {
  left: 62.4%;
  width: 24.6%;
  height: 5.5%;
  padding: 0 36px 0 34px;
  border-radius: 2px;
  background: #fff;
  color: #1a1a1a;
  font-size: 14px;
  outline: none;
}
.login__user { top: 39.4%; }
.login__pass { top: 46.8%; }
.login__user::placeholder,
.login__pass::placeholder { color: transparent; }
.login__eye {
  left: 84.6%;
  top: 46.8%;
  width: 2.2%;
  height: 5.5%;
  color: transparent;
  cursor: pointer;
}
.login__go {
  left: 62.4%;
  top: 54.8%;
  width: 24.8%;
  height: 6.4%;
  color: transparent;
  cursor: pointer;
}
.login__go:disabled { cursor: default; }
.login__mini {
  left: 73.6%;
  top: 79.2%;
  width: 3.4%;
  height: 5.4%;
  border-radius: 50%;
  cursor: pointer;
}
</style>
