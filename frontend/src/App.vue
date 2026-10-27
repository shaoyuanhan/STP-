<script setup lang="ts">
import { zhCN, dateZhCN } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#1890ff',
    primaryColorHover: '#369cfd',
    primaryColorPressed: '#087ae3',
    primaryColorSuppl: '#1890ff',
    infoColor: '#2080f0',
    successColor: '#18a058',
    warningColor: '#f0a020',
    errorColor: '#d03050',
    borderRadius: '4px',
    borderRadiusSmall: '4px',
    fontSize: '14px',
    fontSizeMedium: '14px',
    fontSizeSmall: '12px',
    fontSizeLarge: '14px',
    fontFamily:
      "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'WenQuanYi Micro Hei', 'Helvetica Neue', Arial, sans-serif",
    textColorBase: '#2d3033',
    textColor1: '#2d3033',
    textColor2: '#2d3033',
    textColor3: '#666666',
    textColorDisabled: '#999999',
    placeholderColor: '#999999',
    borderColor: '#eeeeee',
    dividerColor: '#eeeeee',
    bodyColor: '#f5f6fb',
    cardColor: '#ffffff',
    modalColor: '#ffffff',
    popoverColor: '#ffffff',
    tableColor: '#ffffff',
    inputColor: '#ffffff',
  },
  Form: {
    labelTextColor: '#666666',
  },
  Card: {
    borderRadius: '4px',
    boxShadow: '0 1px 2px rgba(31, 45, 61, 0.04)',
  },
  Modal: {
    borderRadius: '4px',
  },
  DataTable: {
    thColor: '#fafafa',
    thTextColor: '#2d3033',
    thFontWeight: '500',
    thFontSizeSmall: '14px',
    tdFontSizeSmall: '14px',
    tdColor: '#ffffff',
    tdColorHover: '#f7fafd',
    tdColorSorted: '#f7fafd',
    tdTextColor: '#2d3033',
    borderColor: '#eeeeee',
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
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  background-color: #f5f6fb;
  color: #2d3033;
  overflow: hidden;
}

* {
  box-sizing: border-box;
}

.stp-page {
  min-width: 0;
  padding: 10px 20px 20px;
}

.stp-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.stp-page__title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  margin: 0;
}

.query-card {
  margin-bottom: 10px;
  border-color: #eae5e5 !important;
}

.query-card > .n-card-content,
.table-card > .n-card-content {
  padding: 15px !important;
}

.query-bar {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px 20px;
}

.query-fields {
  flex: 1 1 338px;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 16px 20px;
}

.query-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.query-item > span:first-child {
  width: 110px;
  flex: none;
  text-align: right;
  color: #666666;
  font-size: 14px;
  white-space: nowrap;
}

.query-item > .n-input,
.query-item > .n-select,
.query-item > .n-date-picker,
.query-item > .n-input-number {
  width: 220px;
  flex: none;
}

.query-buttons {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 20px;
  margin-left: auto;
}

.table-toolbar {
  min-height: 32px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.table-toolbar__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
}

.table-toolbar__hint {
  color: #999999;
  font-size: 14px;
}

.table-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px;
  color: #666666;
}

.table-summary strong {
  color: #d03050;
  font-weight: 600;
}

.action-buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
  gap: 8px;
  white-space: nowrap;
}

.modal-footer {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.form-modal {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 48px);
}

.form-modal > .n-card-header,
.form-modal > .n-card__footer {
  flex: none;
}

.form-modal > .n-card-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.stp-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: #2d3033;
  font-size: 14px;
  font-weight: 900;
}

.stp-section-title::before {
  content: '';
  width: 4px;
  height: 16px;
  flex: none;
  border-radius: 2px;
  background: #1890ff;
}
</style>
