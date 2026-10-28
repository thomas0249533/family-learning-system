<template>
  <figure v-if="path" class="qimage">
    <img
      v-if="state === 'ok'"
      class="qimage__img"
      :src="objectUrl"
      :alt="alt || '题目配图'"
      loading="lazy"
      decoding="async"
      @error="onImgError"
    />
    <!--
      缺失 / 损坏时不装作没事：显示一行淡字。
      图片是题干的一部分（"图中一共有几个三角形"离开图无法作答），
      静默留白会让孩子以为自己看漏了，而家长也永远发现不了内容缺陷。
    -->
    <div v-else-if="state === 'missing'" class="qimage__placeholder">
      <span class="qimage__placeholder-text">配图缺失</span>
    </div>
    <!-- 加载中：给一个固定高度的小占位，避免图片到达时把下面的选项顶一下 -->
    <div v-else class="qimage__placeholder qimage__placeholder--loading" aria-hidden="true" />
  </figure>
</template>

<script setup lang="ts">
// =====================================================================
// QuestionImage · 题干配图（V2.12）
// ---------------------------------------------------------------------
// 职责只有一件事：把 `[packageId, path]` 变成一张能显示的图，并且**保证 URL 被释放**。
//
// ## 为什么 URL 生命周期必须留在这里
// Blob 存在 IndexedDB（见 core/package-manager/packageAssetStore）。要在 <img> 上显示
// 必须 `URL.createObjectURL(blob)`，而这个 URL **不会自己失效** —— 不 revoke 就一直
// 占着那份 Blob 的内存。把它塞进全局缓存"复用"看似省事，实则要做引用计数，
// 一旦少减一次就会泄漏；而图片本身很小、解码很快，重复创建完全可接受。
// 所以：**一个组件实例 = 一个 URL**，卸载 / 换题时必 revoke。
//
// ## 为什么单独一个组件而不是塞进 QuestionText 的 v-html
// `QuestionText` 的注释里写死了安全边界：题干里的一切都当纯文本转义，`<img onerror>`
// 只会是文字。如果把图片语法塞进那条链路，就得在 v-html 里拼 blob URL —— 等于
// 把唯一的安全保证换掉了。分开渲染，两条边界互不影响。
//
// ## 加载失败不抛错
// `loadAssetBlob` 取不到返回 null（导入时已由 E023 / W035 拦过一道），
// 这里降级成一块占位，绝不打断答题。
// =====================================================================
import { ref, watch, onBeforeUnmount } from 'vue'
import { loadAssetBlob } from '@core/package-manager/packageAssetStore'

const props = defineProps<{
  /** 图片所属学习包 */
  packageId?: string | null
  /** 包内相对路径，如 `assets/shape-01.png` */
  path?: string | null
  /** 画面描述（无障碍 / 朗读） */
  alt?: string | null
}>()

type LoadState = 'loading' | 'ok' | 'missing'

const state = ref<LoadState>('loading')
const objectUrl = ref<string>('')

/** 释放当前 URL。调用点只有两处：换图前、卸载时 —— 少一处都会泄漏 */
function revoke(): void {
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value)
    objectUrl.value = ''
  }
}

async function load(packageId: string | null | undefined, path: string | null | undefined): Promise<void> {
  revoke()
  if (!packageId || !path) {
    state.value = 'missing'
    return
  }
  state.value = 'loading'
  try {
    const blob = await loadAssetBlob(packageId, path)
    // 二次确认：await 期间可能已经换了题（组件被复用），此时这次结果已经过时
    if (!blob) {
      state.value = 'missing'
      return
    }
    objectUrl.value = URL.createObjectURL(blob)
    state.value = 'ok'
  } catch {
    state.value = 'missing'
  }
}

watch(
  () => [props.packageId, props.path] as const,
  ([pid, p]) => {
    void load(pid, p)
  },
  { immediate: true },
)

/** <img> 自己解码失败（文件损坏 / mime 与内容不符）：同样降级，别留一个破图标 */
function onImgError(): void {
  revoke()
  state.value = 'missing'
}

onBeforeUnmount(revoke)
</script>

<style scoped lang="scss">
.qimage {
  margin: $space-2 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $space-1;
}

.qimage__img {
  display: block;
  /* 不设固定宽高：图形题的长宽比各不相同（一条线 vs 3×3 网格），
     按固有尺寸显示、超出容器时等比缩小最不容易变形。
     不放大小图：SVG 放大虽不糊，但一条 348×110 的线段图撑到卡片宽之后，
     线宽会跟着变成 6~7px，看起来像粗黑条，反而不像课本上的图。 */
  max-width: 100%;
  height: auto;
  max-height: 320px;
  object-fit: contain;
  border-radius: $radius-md;
  background: $bg-color;
}

.qimage__placeholder {
  width: 100%;
  min-height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: $radius-md;
  border: 1px dashed $border-color;
  background: $bg-color-hover;
}

/* 加载中不显示任何文字：多数情况只闪一帧，写"加载中"反而更吵 */
.qimage__placeholder--loading {
  border-style: solid;
  opacity: 0.6;
}

.qimage__placeholder-text {
  font-size: $font-2xs;
  color: $text-sub;
}
</style>
