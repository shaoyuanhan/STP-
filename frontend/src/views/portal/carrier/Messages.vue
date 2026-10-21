<script setup lang="ts">
/**
 * 承运商 - 消息中心
 * 通知包含站内信 / 短信 / 微信渠道（本地 mock 模式仅落库留痕）
 */
import { computed, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import {
  fetchCarrierNotifications, readCarrierNotification,
} from '@/services/portal'
import type { PortalNotification } from '@/services/portal'

const message = useMessage()
const loading = ref(false)
const list = ref<PortalNotification[]>([])

const CHANNEL: Record<string, string> = { INBOX: '站内信', SMS: '短信', WECHAT: '微信' }

const unreadCount = computed(() => list.value.filter((n) => Number(n.read_status) === 0).length)

async function load() {
  loading.value = true
  try {
    list.value = await fetchCarrierNotifications()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '消息加载失败')
  } finally {
    loading.value = false
  }
}

async function read(item: PortalNotification) {
  if (Number(item.read_status) === 1) return
  try {
    await readCarrierNotification(item.id)
    item.read_status = 1
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  }
}

onMounted(load)
</script>

<template>
  <div class="stp-page">
    <div class="page-toolbar">
      <span class="page-toolbar__hint">共 {{ list.length }} 条消息，未读 {{ unreadCount }} 条</span>
      <n-button size="small" @click="load">刷新</n-button>
    </div>

    <div class="card">
      <div class="panel-head"><span>消息列表</span></div>
      <n-spin :show="loading">
        <div v-if="!list.length" class="empty-row">暂无消息</div>
        <div
          v-for="item in list"
          :key="item.id"
          class="msg-item"
          :class="{ 'is-unread': Number(item.read_status) === 0 }"
          @click="read(item)"
        >
          <div class="msg-item__head">
            <span class="msg-dot" />
            <span class="msg-item__title">{{ item.title }}</span>
            <n-tag size="small" :bordered="false">{{ CHANNEL[item.channel] || item.channel }}</n-tag>
            <span class="msg-item__time">{{ item.create_time }}</span>
          </div>
          <div class="msg-item__content">{{ item.content }}</div>
          <div class="msg-item__meta">
            {{ Number(item.read_status) === 1 ? '已读' : '未读' }}
            <span v-if="item.provider_msg">· {{ item.provider_msg }}</span>
          </div>
        </div>
      </n-spin>
    </div>
  </div>
</template>

<style scoped>
.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.page-toolbar__hint {
  font-size: 12px;
  color: #8c8c8c;
}
.card {
  background: #ffffff;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04);
}
.panel-head {
  padding: 13px 16px;
  border-bottom: 1px solid #f0f0f0;
  font-weight: 600;
  color: #262626;
}
.empty-row {
  padding: 40px 0;
  text-align: center;
  font-size: 12px;
  color: #bfbfbf;
}
.msg-item {
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background 0.15s;
}
.msg-item:last-child {
  border-bottom: none;
}
.msg-item:hover {
  background: #f7fafd;
}
.msg-item.is-unread {
  background: #f7fbff;
}
.msg-item.is-unread:hover {
  background: #f0f7ff;
}
.msg-item__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.msg-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d9d9d9;
  flex: none;
}
.msg-item.is-unread .msg-dot {
  background: #1677ff;
}
.msg-item__title {
  font-size: 13px;
  font-weight: 500;
  color: #262626;
}
.msg-item__time {
  margin-left: auto;
  font-size: 12px;
  color: #8c8c8c;
}
.msg-item__content {
  margin: 6px 0 0 14px;
  font-size: 12px;
  line-height: 1.7;
  color: #595959;
}
.msg-item__meta {
  margin: 6px 0 0 14px;
  font-size: 11px;
  color: #8c8c8c;
}
</style>
