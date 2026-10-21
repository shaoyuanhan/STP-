<script setup lang="ts">
/**
 * 司机小程序登录。只接受司机账号，风格与后台登录页一致：白底、深向标识、黑按钮。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { driverPasswordLogin, setSession } from '@/services/portal'

const router = useRouter()
const message = useMessage()
const account = ref('')
const password = ref('')
const loading = ref(false)

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
    const res = await driverPasswordLogin(account.value.trim(), password.value)
    setSession(res.token, res.profile)
    message.success(`登录成功，${res.profile.driver_name || res.profile.name}`)
    router.replace('/m/tasks')
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
      <div class="mini__hero"></div>
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
        <form @submit.prevent="onSubmit">
          <label>
            <input v-model="account" placeholder="请输入账号或手机号" autocomplete="username" />
          </label>
          <label>
            <input v-model="password" type="password" placeholder="请输入密码" autocomplete="current-password" />
          </label>
          <button type="submit" :disabled="loading">{{ loading ? '登录中…' : '登 录' }}</button>
        </form>
        <p class="mini__copy">©2024 安徽深向科技有限公司</p>
      </div>
    </div>
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
.mini__hero {
  height: 34%;
  flex: none;
  background: #9ec4ea url('@/assets/login-truck.jpg') left center / cover no-repeat;
}
.mini__sheet {
  flex: 1;
  padding: 28px 28px 20px;
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
}
input:focus {
  border-color: #1a1a1a;
}
button {
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
button:disabled {
  opacity: 0.7;
}
.mini__copy {
  margin: 28px 0 0;
  color: #c0c4cc;
  font-size: 12px;
  text-align: center;
}
</style>
