import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { migrateSettingChecks } from './domain/settingcheck'
import './styles/global.css'

// 存量核对记录的结论按采集顺序统一回填一遍，只需跑一次。
migrateSettingChecks()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
