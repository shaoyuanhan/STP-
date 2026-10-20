/**
 * 会话 Store（演示模式）
 *
 * 本期为内部演示环境，未接入真实登录（前端技术方案 Q03 待确认），
 * 使用固定演示用户「系统管理员」；后续接入 SSO/网关鉴权时，
 * 在此替换为真实会话初始化逻辑，布局等公共文件无需改动。
 */

import { defineStore } from 'pinia'

export interface SessionUser {
  id: number | string
  name: string
  role: string
  /** 角色显示名 */
  roleLabel: string
}

const DEMO_USER: SessionUser = {
  id: 'demo-admin',
  name: '系统管理员',
  role: 'admin',
  roleLabel: '管理员',
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    user: { ...DEMO_USER } as SessionUser,
    /** 演示模式标记：外部系统模拟面板等场景用于提示 */
    demoMode: true,
  }),
  getters: {
    userName: (state) => state.user.name,
    userRoleLabel: (state) => state.user.roleLabel,
    isLoggedIn: () => true,
  },
  actions: {
    /** 预留：接入真实登录后设置会话用户 */
    setUser(user: SessionUser) {
      this.user = user
      this.demoMode = false
    },
    /** 预留：登出清理（当前演示模式为空实现） */
    clearSession() {
      this.user = { ...DEMO_USER }
      this.demoMode = true
    },
  },
})
