import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from '@core/router'
import naive from 'naive-ui'
import '@core/styles/index.scss'
import { db } from './db'

import { registerMathTemplate } from '@templates/math/index'
import { registerChineseTemplate } from '@templates/chinese/index'
import { registerEnglishTemplate } from '@templates/english/index'
import { registerAllModules } from '@core/registry/registerAll'

// 顺序：先注册各学科模板，最后统一注册所有模块（幂等）
registerMathTemplate()
registerChineseTemplate()
registerEnglishTemplate()
registerAllModules()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(naive)

;(window as any).db = db

router.isReady().then(() => {
  app.mount('#app')
})