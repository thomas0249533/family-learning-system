import { computed, type Ref, type ComputedRef } from 'vue'
import { usePackageStore } from '@core/stores/package'

function stripPrefix(id: string): string {
  const idx = id.indexOf('::')
  return idx >= 0 ? id.slice(idx + 2) : id
}

export function useKnowledgePoints(
  kpIds: Ref<string[] | undefined> | ComputedRef<string[] | undefined>
) {
  const packageStore = usePackageStore()

  return computed(() => {
    const ids = kpIds.value ?? []
    if (ids.length === 0) return []

    // ✅ 全局池：遍历所有包的知识点
    const globalMap = new Map<string, any>()
    const globalMapShort = new Map<string, any>()
    for (const pkg of packageStore.packages) {
      for (const kp of pkg.knowledgePoints ?? []) {
        globalMap.set(kp.id, kp)
        globalMapShort.set(stripPrefix(kp.id), kp)
      }
    }

    return ids
      .map(id => globalMap.get(id) ?? globalMapShort.get(stripPrefix(id)))
      .filter(Boolean)
  })
}