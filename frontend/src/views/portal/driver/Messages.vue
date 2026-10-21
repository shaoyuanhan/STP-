<script setup lang="ts">
/**
 * 司机端 - 消息（H5）
 */
import { onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { fetchDriverNotifications, readDriverNotification } from '@/services/portal'
import type { PortalNotification } from '@/services/portal'

const message = useMessage()
const loading = ref(false)
const list = ref<PortalNotification[]>([])

const CHANNEL: Record<string, string> = { INBOX: '站内信', SMS: '短信', WECHAT: '微信' }

async function load() {
  loading.value = true
  try {
    list.value = await fetchDriverNotifications()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '消息加载失败')
  } finally {
    loading.value = false
  }
}

async function read(item: PortalNotification) {
  if (Number(item.read_status) === 1) return
  try {
    await readDriverNotification(item.id)
    item.read_status = 1
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  }
}

onMounted(load)
</script>

<template>
  <div class="dmsg">
    <n-spin :show="loading && !list.length">
      <div v-if="!list.length && !loading" class="dmsg__empty">暂无消息</div>
      <div
        v-for="item in list"
        :key="item.id"
        class="dmsg__item"
        :class="{ 'dmsg__item--unread': Number(item.read_status) === 0 }"
        @click="read(item)"
      >
        <div class="dmsg__head">
          <span class="dmsg__dot" />
          <span class="dmsg__title">{{ item.title }}</span>
          <span class="dmsg__channel">{{ CHANNEL[item.channel] || item.channel }}</span>
        </div>
        <div class="dmsg__content">{{ item.content }}</div>
        <div class="dmsg__time">{{ item.create_time }}</div>
      </div>
    </n-spin>
  </div>
</template>

<style scoped>
.dmsg {
  padding-bottom: 8px;
}
.dmsg__empty {
  padding: 70px 0;
  text-align: center;
  font-size: 12px;
  color: #8c8c8c;
}
.dmsg__item {
  background: #fff;
  border-radius: 6px;
  padding: 12px 14px;
  margin-bottom: 9px;
  box-shadow: 0 1px 2px rgba(31, 45, 61, 0.04);
  cursor: pointer;
}
.dmsg__item--unread {
  box-shadow: inset 2px 0 0 #1677ff, 0 1px 2px rgba(31, 45, 61, 0.04);
}
.dmsg__head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.dmsg__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d9d9d9;
}
.dmsg__item--unread .dmsg__dot {
  background: #1677ff;
}
.dmsg__title {
  font-size: 13px;
  font-weight: 500;
  color: #262626;
}
.dmsg__channel {
  margin-left: auto;
  font-size: 11px;
  color: #1677ff;
  background: #e6f4ff;
  border-radius: 3px;
  padding: 1px 6px;
}
.dmsg__content {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.7;
  color: #595959;
}
.dmsg__time {
  margin-top: 6px;
  font-size: 11px;
  color: #8c8c8c;
}
</style>
