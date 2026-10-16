import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/db'
import type { LearningPackageRecord } from '@/db'

export const usePackageStore = defineStore('package', () => {
  const packages = ref<LearningPackageRecord[]>([])
  const currentPackage = ref<LearningPackageRecord | null>(null)

  async function loadPackages() {
    packages.value = await db.packages.toArray()
  }

  function setCurrentPackage(pkg: LearningPackageRecord) {
    currentPackage.value = pkg
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

  return { packages, currentPackage, loadPackages, setCurrentPackage, loadPackageById }
})