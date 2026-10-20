<script setup lang="ts">
import { zhCN, dateZhCN } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'

/**
 * 品牌主题（对齐旧版设计系统，见仓库 git 历史 frontend/index.html :root 变量）：
 * 主色 #1677ff、成功 #389e0d、警告 #fa8c16、危险 #f5222d；
 * 文本 #262626/#595959/#8c8c8c、页面底 #f0f2f5、正文 13px PingFang SC。
 * 页面阶段如需调整主题，统一改这里的 themeOverrides，不改各页面。
 */
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#1677ff',
    primaryColorHover: '#4096ff',
    primaryColorPressed: '#0958d9',
    primaryColorSuppl: '#4096ff',
    infoColor: '#1677ff',
    infoColorHover: '#4096ff',
    infoColorPressed: '#0958d9',
    infoColorSuppl: '#4096ff',
    successColor: '#389e0d',
    successColorHover: '#49b018',
    successColorPressed: '#2f7d0b',
    successColorSuppl: '#49b018',
    warningColor: '#fa8c16',
    warningColorHover: '#ffa940',
    warningColorPressed: '#d46b08',
    warningColorSuppl: '#ffa940',
    errorColor: '#f5222d',
    errorColorHover: '#ff4d4f',
    errorColorPressed: '#cf1322',
    errorColorSuppl: '#ff4d4f',
    borderRadius: '4px',
    borderRadiusSmall: '4px',
    fontSize: '13px',
    fontSizeMedium: '13px',
    fontSizeSmall: '12px',
    fontSizeLarge: '14px',
    fontFamily:
      "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'WenQuanYi Micro Hei', 'Helvetica Neue', Arial, sans-serif",
    textColorBase: '#262626',
    textColor1: '#262626',
    textColor2: '#595959',
    textColor3: '#8c8c8c',
    textColorDisabled: '#bfbfbf',
    placeholderColor: '#bfbfbf',
    borderColor: '#d9d9d9',
    dividerColor: '#f0f0f0',
    bodyColor: '#f0f2f5',
    cardColor: '#ffffff',
    modalColor: '#ffffff',
    popoverColor: '#ffffff',
    tableColor: '#ffffff',
    inputColor: '#ffffff',
  },
  Card: {
    borderRadius: '6px',
    boxShadow: '0 1px 2px rgba(31, 45, 61, 0.04)',
  },
  Modal: {
    borderRadius: '8px',
  },
  DataTable: {
    thColor: '#fafafa',
    thTextColor: '#595959',
    thFontWeight: '500',
    tdColor: '#ffffff',
    tdColorHover: '#f7fafd',
    tdColorSorted: '#f7fafd',
    borderColor: '#f0f0f0',
    thPaddingSmall: '11px 12px',
    tdPaddingSmall: '10px 12px',
  },
  Menu: {
    borderRadius: '4px',
  },
  Tag: {
    borderRadius: '4px',
  },
  Button: {
    fontWeight: '400',
  },
}
</script>

<template>
  <n-config-provider
    class="app-provider"
    :locale="zhCN"
    :date-locale="dateZhCN"
    :theme-overrides="themeOverrides"
    :inline-theme-disabled="true"
  >
    <n-message-provider placement="top">
      <n-dialog-provider>
        <n-notification-provider>
          <router-view />
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
/* 全局基础样式（App 级，非 scoped） */
html,
body,
#app {
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'WenQuanYi Micro Hei',
    'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  background-color: #f0f2f5;
  color: #262626;
  overflow: hidden;
}

* {
  box-sizing: border-box;
}

/* 页面通用容器：所有 views 页面根节点使用（对齐旧版 .content 内边距） */
.stp-page {
  padding: 14px 16px 26px;
}

.stp-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.stp-page__title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  margin: 0;
}
</style>
