import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/db'
import type { LearningPackageRecord } from '@/db'
import { invalidateOwnerIndex, setOwnerIndexSource } from '@core/progress/ownerIndexCache'

export const usePackageStore = defineStore('package', () => {
  const packages = ref<LearningPackageRecord[]>([])
  const currentPackage = ref<LearningPackageRecord | null>(null)

  async function loadPackages() {
    packages.value = await db.packages.toArray()
    // V1.3 · E-01：包数组是归属索引的唯一来源，加载后立刻刷新（导入/删除后同样走这里）
    setOwnerIndexSource(packages.value)
  }

  function setCurrentPackage(pkg: LearningPackageRecord) {
    currentPackage.value = pkg
  }

  /** 包被删除/替换后调用：让归属索引下次用时重建（避免拿旧数组做写入决策） */
  function invalidateOwnerIndexCache() {
    invalidateOwnerIndex()
  }

  // ✅ 新增：如果内存中丢失了 currentPackage，根据 packageId 从 IndexedDB 重新拉取
  async function loadPackageById(packageId: string) {
    if (currentPackage.value?.packageId === packageId) return
    const pkg = await db.packages.get(packageId)
    if (pkg) {
      currentPackage.value = pkg
    } else {
      console.error(`未找到 ID 为 ${packageId} 的学习包`)
    }
  }

  return {
    packages,
    currentPackage,
    loadPackages,
    setCurrentPackage,
    invalidateOwnerIndexCache,
    loadPackageById,
  }
})
