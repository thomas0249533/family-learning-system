<template>
  <ThemeProvider>
    <n-message-provider>
      <n-dialog-provider>
        <AppShell />
        <PWAUpdateBar />
      </n-dialog-provider>
    </n-message-provider>
  </ThemeProvider>
</template>

<script setup lang="ts">
// =====================================================================
// App.vue · 仅负责组合（B5 拆分后）
// ---------------------------------------------------------------------
// ThemeProvider（n-config-provider + themeOverrides + 字号）
//   > n-message-provider > n-dialog-provider
//     > AppShell（布局骨架）+ PWAUpdateBar
// 布局样式已迁入 AppShell.vue；主题覆盖逻辑集中在 ThemeProvider.vue。
// =====================================================================
import { NMessageProvider, NDialogProvider } from 'naive-ui'
import ThemeProvider from '@/components/ThemeProvider.vue'
import AppShell from '@/components/AppShell.vue'
import PWAUpdateBar from '@core/pwa/PWAUpdateBar.vue'
</script>
