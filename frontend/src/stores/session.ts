/**
 * 登录会话。用户来自后台 / 小程序登录后写入的门户账号。
 */
import { defineStore } from 'pinia'
import { getProfile, roleLabel } from '@/services/portal'

export interface SessionUser {
  id: number | string
  name: string
  role: string
  roleLabel: string
}

function userFromProfile(): SessionUser {
  const profile = getProfile()
  if (!profile) return { id: '', name: '', role: '', roleLabel: '' }
  return {
    id: profile.account_id,
    name: profile.name,
    role: profile.account_type,
    roleLabel: profile.role_name || roleLabel(profile.account_type),
  }
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    user: userFromProfile(),
    demoMode: false,
  }),
  getters: {
    userName: (state) => state.user.name,
    userRoleLabel: (state) => state.user.roleLabel,
    isLoggedIn: (state) => Boolean(state.user.id),
  },
  actions: {
    applyProfile() {
      this.user = userFromProfile()
      this.demoMode = false
    },
    setUser(user: SessionUser) {
      this.user = user
      this.demoMode = false
    },
    clearSession() {
      this.user = { id: '', name: '', role: '', roleLabel: '' }
      this.demoMode = false
    },
  },
})
