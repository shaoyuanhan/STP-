import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    /** 页面标题（面包屑与 document.title） */
    title?: string
    /** 菜单分组名（面包屑第一级） */
    group?: string
  }
}

export {}
