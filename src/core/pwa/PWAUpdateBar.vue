<template>
  <!-- B4 · Tauri 桌面端不渲染 SW 更新条（Web 端行为不变） -->
  <template v-if="!isTauri()">
    <!-- 更新可用提示 -->
    <transition name="slide-up">
      <div v-if="needRefresh" class="pwa-bar update-bar">
        <span class="pwa-icon">🆕</span>
        <span class="pwa-text">有新版本可用</span>
        <button class="pwa-btn primary" @click="applyUpdate" :disabled="state === 'updating'">
          {{ state === 'updating' ? '更新中...' : '立即更新' }}
        </button>
        <button class="pwa-btn" @click="dismiss">稍后</button>
      </div>
    </transition>

    <!-- 离线就绪提示 -->
    <transition name="slide-up">
      <div v-if="offlineReady && !needRefresh" class="pwa-bar offline-bar">
        <span class="pwa-icon">📥</span>
        <span class="pwa-text">已可离线使用</span>
        <button class="pwa-btn" @click="dismiss">知道了</button>
      </div>
    </transition>
  </template>
</template>

<script setup lang="ts">
import { usePWAUpdate } from './usePWAUpdate'
import { isTauri } from './isTauri'

const { state, needRefresh, offlineReady, applyUpdate, dismiss } = usePWAUpdate()
</script>

<style scoped lang="scss">
.pwa-bar {
  position: fixed;
  left: 50%;
  bottom: 80px;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  background: $card-bg;
  border-radius: 12px;
  box-shadow: $shadow-md;
  font-size: 14px;
  max-width: 92vw;
  width: auto;

  &.update-bar { border-left: 4px solid $danger-color; }
  &.offline-bar { border-left: 4px solid $success-color; }

  .pwa-icon { font-size: 18px; }
  .pwa-text { font-weight: 600; color: $text-main; white-space: nowrap; }

  .pwa-btn {
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    border: 1px solid $border-color;
    background: $surface-2;
    color: $text-main;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;

    &:hover { background: $bg-color-hover; }

    &.primary {
      background: $danger-color;
      color: $on-strong;
      border-color: $danger-color;
      &:hover { background: $danger-color; }
      &:disabled { opacity: 0.6; cursor: not-allowed; }
    }
  }
}

.slide-up-enter-active, .slide-up-leave-active { transition: all 0.25s ease; }
.slide-up-enter-from, .slide-up-leave-to { opacity: 0; transform: translate(-50%, 20px); }
</style>