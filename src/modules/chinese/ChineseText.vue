<template>
  <AppCard class="chinese-text-card">
    <template v-for="(kp, i) in kps" :key="i">
      <h3 class="text-title">{{ kp.title }}</h3>
      <div class="text-meta" v-if="kp.metadata?.author || kp.metadata?.source">
        <span v-if="kp.metadata?.author">{{ kp.metadata.author }}</span>
        <span v-if="kp.metadata?.source"> · {{ kp.metadata.source }}</span>
      </div>
      <!--
        V1.6 · Stage D · D4：划线辅助
        `.text-host` 是 `position: relative` 的定位宿主 —— 画笔层（InkOverlay 的
        `absolute; inset: 0`）以它为参照铺在正文上，因此**跟着正文一起参与排版**，
        滚动时天然贴合（滚动由 window 完成，不需要任何 scroll 同步）。
        不传 `docKey`（或它为空）时不渲染画笔层，组件行为与 V1.5 完全一致。
      -->
      <div class="text-host" :class="{ 'text-host--ink': cardDocKey(i) !== '' }">
        <div class="text-body" v-html="renderMarkdown(kp.content)"></div>
        <InkOverlay v-if="cardDocKey(i) !== ''" :doc-key="cardDocKey(i)" />
      </div>
    </template>
    <EmptyState v-if="kps.length === 0" description="暂无课文内容" />
  </AppCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import { useKnowledgePoints } from '@core/composables/useKnowledgePoints'
import AppCard from '@/components/ui/AppCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import InkOverlay from '@/components/reading/InkOverlay.vue'

const props = defineProps<{
  knowledgePointIds?: string[]
  data?: any
  packageId: string
  /**
   * 划线痕迹的文档标识（`packageId:topicId`）。
   *
   * 可选：不传时**不启用划线**（画笔层不渲染、不落盘），保证老调用方零改动可用。
   * 之所以由调用方传而不是组件内部拼：`packageId` 有了，但 `topicId` 不在本组件的
   * props 里（它属于路由层），只有 TopicDetail 同时持有两者。
   */
  docKey?: string
}>()

const kps = useKnowledgePoints(computed(() => props.knowledgePointIds))
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
function renderMarkdown(s: string) { return md.render(s ?? '') }

/**
 * 单张卡片的存储键：`docKey#i`。
 *
 * 为什么要带序号：`knowledgePointIds` 可能指向多个知识点，一张卡片一个画笔层，
 * 不带序号会让两段课文的痕迹叠在彼此的坐标系里（都是 0..1，看起来"都对"，
 * 但换段落长度后全错位）。序号是渲染顺序，稳定且无需额外标识。
 */
function cardDocKey(index: number): string {
  return props.docKey ? `${props.docKey}#${index}` : ''
}
</script>

<style scoped lang="scss">
/* radius-lg + shadow-sm 已由 AppCard 承载；此处仅保留卡片间距 */
.chinese-text-card { margin-bottom: 12px; }
.text-title { font-size: 18px; font-weight: 700; color: $subject-chinese-deep; margin-bottom: 4px; }
.text-meta { font-size: 12px; color: $subject-chinese; margin-bottom: 14px; }
/* 画笔层的定位宿主（子组件里 absolute; inset: 0 以它为参照） */
.text-host { position: relative; }
/**
 * 启用划线时给工具栏预留一条（32px），画笔层的工具栏就坐在这一格里。
 * 不这么做就只能让工具栏浮在正文右上角 —— 中文段落占满行宽，浮层必然盖住第一行右侧的字。
 */
.text-host--ink .text-body { padding-top: 32px; }
/* 画线期间禁掉正文选字（由 InkOverlay 在 pointerdown/pointerup 时切换这个类） */
.text-host.ink-drawing .text-body {
  user-select: none;
  -webkit-user-select: none;
}
.text-body {
  font-size: 15px;
  line-height: 1.9;
  color: $text-main;

  :deep(p) { margin: 8px 0; text-indent: 2em; }
  :deep(h1), :deep(h2), :deep(h3) { color: $subject-chinese-deep; margin: 12px 0 6px; }
  :deep(ul), :deep(ol) { padding-left: 24px; }
}
</style>
