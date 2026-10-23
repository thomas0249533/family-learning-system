<template>
  <div class="catalog-sync">
    <n-card title="🌐 联网校验与库同步" :bordered="false" class="block">
      <n-space vertical size="medium">
        <div class="field">
          <label>catalog 地址（GitHub Raw / 坚果云 / WebDAV 分享链接等）</label>
          <n-input
            v-model:value="catalogUrl"
            placeholder="https://raw.githubusercontent.com/owner/repo/main/catalog.json"
            @keyup.enter="checkUpdates"
          />
        </div>

        <n-space>
          <n-button type="primary" :loading="checking" @click="checkUpdates">检查更新</n-button>
          <n-button quaternary @click="catalogUrl = ''">清空</n-button>
        </n-space>

        <!-- 顶层错误：优雅提示，绝不白屏 -->
        <n-alert
          v-if="catalogError"
          :type="catalogError.kind === 'cors' ? 'warning' : 'error'"
          :title="errorTitle"
          show-icon
        >
          {{ catalogError.message }}
          <template v-if="catalogError.kind === 'cors'">
            <div class="cors-hint">
              提示：纯前端 WebView 下 fetch 受 CORS 限制。<code>raw.githubusercontent.com</code>
              带 <code>Access-Control-Allow-Origin:*</code> 可直接取；坚果云 / WebDAV
              分享链接大概率被浏览器跨域拦截，请改用带 CORS 头的链接或用本地 ZIP 导入。
            </div>
          </template>
        </n-alert>

        <div v-if="checks.length" class="results">
          <div class="results-head">共 {{ checks.length }} 个包</div>
          <div v-for="c in checks" :key="c.packageId" class="row">
            <div class="row-main">
              <span class="pkg">{{ c.packageId }}</span>
              <n-tag :type="statusType(c)" size="small">{{ statusText(c) }}</n-tag>
              <span class="ver">
                <template v-if="c.currentVersion">本地 {{ c.currentVersion }}</template>
                <template v-else>本地无此包</template>
                → 远程 {{ c.remoteVersion }}
              </span>
            </div>
            <n-button
              size="small"
              type="success"
              :loading="updating === c.packageId"
              :disabled="!c.hasUpdate || !c.url"
              @click="updateOne(c)"
            >
              一键更新
            </n-button>
          </div>
        </div>

        <n-alert v-if="updateMsg" :type="updateOk ? 'success' : 'error'" :title="updateOk ? '更新完成' : '更新失败'" />
        <div v-if="updateMsg" class="update-msg">{{ updateMsg }}</div>
      </n-space>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NCard, NSpace, NInput, NButton, NTag, NAlert } from 'naive-ui'
import { usePackageStore } from '@core/stores/package'
import {
  fetchCatalog,
  compareWithLocal,
  type CatalogError,
  type UpdateCheck,
  type CatalogTransport,
} from '@core/importer/catalogService'
import { PackageImporter } from '@core/importer/importService'

const packageStore = usePackageStore()

const catalogUrl = ref('')
const checking = ref(false)
const catalogError = ref<CatalogError | null>(null)
const checks = ref<UpdateCheck[]>([])
const updating = ref<string | null>(null)
const updateMsg = ref('')
const updateOk = ref(false)

const errorTitle = computed(() => {
  const k = catalogError.value?.kind
  if (k === 'cors') return '跨域被拦截（CORS）'
  if (k === 'http') return '服务器错误'
  if (k === 'parse') return '解析失败'
  return '网络请求失败'
})

function localPackages() {
  return packageStore.packages.map((p) => ({
    packageId: p.packageId,
    version: (p.manifest as any)?.version ?? '0.0.0',
    checksum: (p.manifest as any)?.checksum,
  }))
}

function statusType(c: UpdateCheck): 'success' | 'warning' | 'info' {
  if (!c.hasUpdate) return 'info'
  return c.currentVersion ? 'warning' : 'success'
}
function statusText(c: UpdateCheck): string {
  if (!c.hasUpdate) return '已是最新'
  return c.currentVersion ? '有更新' : '本地无此包'
}

async function checkUpdates() {
  catalogError.value = null
  checks.value = []
  updateMsg.value = ''
  if (!catalogUrl.value.trim()) {
    catalogError.value = { ok: false, kind: 'parse', message: '请输入 catalog 地址' }
    return
  }
  checking.value = true
  try {
    const result = await fetchCatalog(catalogUrl.value.trim())
    if (!result.ok) {
      catalogError.value = result
      return
    }
    checks.value = compareWithLocal(result, localPackages())
  } catch (e: any) {
    // 兜底：任何意外都转成类型化错误，绝不冒泡到调用方导致白屏
    catalogError.value = {
      ok: false,
      kind: 'network',
      message: `未预期错误：${e?.message ?? String(e)}`,
    }
  } finally {
    checking.value = false
  }
}

async function updateOne(c: UpdateCheck) {
  if (!c.url) return
  updating.value = c.packageId
  updateMsg.value = ''
  try {
    const resp = await fetch(c.url)
    if (!resp.ok) {
      updateOk.value = false
      updateMsg.value = `下载失败：HTTP ${resp.status}`
      return
    }
    const blob = await resp.blob()
    const name = c.url.split('/').pop() || `${c.packageId}.lpkgset`
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })
    const res = await PackageImporter.importPackageSet(file)
    if (res.success) {
      updateOk.value = true
      updateMsg.value = `已更新 ${res.imported ?? 1} 个包`
      await packageStore.loadPackages()
      // 刷新比对结果
      await checkUpdates()
    } else {
      updateOk.value = false
      updateMsg.value = `导入失败：${(res.errors ?? []).map((e) => e.message).join('；')}`
    }
  } catch (e: any) {
    updateOk.value = false
    updateMsg.value = `更新失败：${e?.message ?? String(e)}（若为跨域拦截，请改用带 CORS 头的链接）`
  } finally {
    updating.value = null
  }
}

// 供测试 / 外部复用：注入 mock transport 跑校验
async function checkUpdatesWith(transport: CatalogTransport) {
  catalogError.value = null
  checks.value = []
  if (!catalogUrl.value.trim()) return
  const result = await fetchCatalog(catalogUrl.value.trim(), transport)
  if (!result.ok) {
    catalogError.value = result
    return
  }
  checks.value = compareWithLocal(result, localPackages())
}
defineExpose({ checkUpdatesWith })
</script>

<style lang="scss" scoped>
.catalog-sync {
  padding: 4px;
}
.block {
  background: $card-bg;
  border: 1px solid $border-color;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  label {
    font-size: 12px;
    color: $text-sub;
  }
}
.cors-hint {
  margin-top: 6px;
  font-size: 12px;
  color: $text-sub;
  code {
    background: $bg-color;
    border: 1px solid $border-light;
    border-radius: 4px;
    padding: 0 4px;
  }
}
.results {
  border: 1px solid $border-color;
  border-radius: 8px;
  overflow: hidden;
}
.results-head {
  padding: 8px 12px;
  background: $bg-color;
  font-size: 12px;
  color: $text-sub;
  border-bottom: 1px solid $border-light;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid $border-light;
  &:last-child {
    border-bottom: none;
  }
}
.row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.pkg {
  font-weight: 600;
  color: $text-main;
}
.ver {
  font-size: 12px;
  color: $text-muted;
}
.update-msg {
  font-size: 12px;
  color: $text-sub;
}
</style>
