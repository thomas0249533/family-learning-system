import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from '@core/router'
import naive from 'naive-ui'
import '@core/styles/index.scss'
import { db } from './db'
import { initProfile } from '@core/profile/currentProfile'
import { recoverV3IfNeeded } from '@core/storage/migrateV3Recovery'
import { recoverV4IfNeeded } from '@core/storage/migrateV4Recovery'
import { runStartupOrphanRecovery } from '@core/storage/startupOrphanRecovery'

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

/**
 * V1.4 · B1：**先落定"当前档案"再挂载**。
 *
 * `initProfile()` 的第一次读库会触发 `db.open()` → 跑 v4 的 `upgrade()`。
 * 所以它必须在挂载前 await 完：否则首屏渲染时 `currentProfileId()` 还是默认值，
 * 页面读到的是 default 档案的数据，切档案后才"跳一下"。
 *
 * 读库失败也继续（回落 default），不能让档案读取失败导致整个应用白屏。
 */
initProfile()
  .catch(() => undefined)
  .then(() => router.isReady())
  .then(() => {
    app.mount('#app')

    // V1.3 · E-01：v3 迁移若在 upgrade() 里失败（标记 status='failed'），启动后用同一份纯函数补跑一次。
    // 正常路径只读一条 settings，零成本；失败也只告警不阻塞（AC-E1-7）。
    //
    // V1.4 · B1：v4 补偿**先于** v3 补偿。v4 补的是"行上缺 profileId"，
    // 而 v3 的重归因会把整行替换掉（spread 会带上 profileId，但前提是那一行本来就有）。
    // 顺序反过来的话，"缺 profileId 的行"会一直缺下去 —— 白跑一遍。
    void recoverV4IfNeeded()
      .catch(() => undefined) // 补偿内部永不抛，这里只是不让启动链断掉
      .then(() => recoverV3IfNeeded())
      .catch(() => undefined)
      .then(() =>
        // 补偿跑完之后，再兜一次"孤儿进度行"重归因（一天最多一次，本地日期键）。
        // 首屏已经 mount，扫表在 IDB 的异步回调里做，不挡首次渲染；失败内部已 swallow。
        runStartupOrphanRecovery()
      )
  })