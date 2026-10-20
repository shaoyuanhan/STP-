import { createApp } from 'vue'
import { createPinia } from 'pinia'
import naive from 'naive-ui'

import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)
// Naive UI 全量注册：页面模板中可直接使用 n-* 组件（类型由 naive-ui/volar.d.ts 提供）
app.use(naive)

app.mount('#app')
