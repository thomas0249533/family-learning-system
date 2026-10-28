import { normalizeJudgeList } from '@core/quiz/judge'
import { isSupportedAssetPath, normalizeAssetPath } from '@core/package-manager/assetPath'

export interface NormalizeIssue {
  level: 'error' | 'warning'
  code: string
  path: string
  message: string
  hint?: string
}

export interface NormalizeResult<T = any> {
  package: T | null
  errors: NormalizeIssue[]
  warnings: NormalizeIssue[]
  stats?: {
    knowledgePoints: number
    exercises: number
    units: number
    topics: number
    dependencies: number
  }
}

/** 跨包上下文：本批次其他包提供的 ID 池 */
export interface NormalizeContext {
  externalKpIds?: Set<string>
  externalPackageIds?: Set<string>
  /**
   * 本包可用的图片资产路径集合（V2.12）。
   *
   * 由调用方提供：Node 校验脚本从磁盘 `packages/<pkgId>/assets/` 扫，
   * 导入器从 ZIP 条目里取。**不提供时只校验路径格式、不校验图片是否真的存在** ——
   * 单独导入一个 `.json` 包（没有配套图片）时，我们不能因此把它判成非法包。
   */
  assetPaths?: Set<string>
}

function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

const VALID_TYPES = ['single', 'blank', 'multiple', 'judge', 'matching', 'spelling', 'essay']

export function normalizePackage(
  rawInput: any,
  ctx: NormalizeContext = {}
): NormalizeResult {
  const errors: NormalizeIssue[] = []
  const warnings: NormalizeIssue[] = []
  const { externalKpIds, assetPaths } = ctx

  if (!rawInput || typeof rawInput !== 'object') {
    errors.push({ level: 'error', code: 'E001', path: '$', message: '学习包不是有效 JSON 对象', hint: '请确认文件是 JSON 格式' })
    return { package: null, errors, warnings }
  }
  if (!rawInput.manifest || typeof rawInput.manifest !== 'object') {
    errors.push({ level: 'error', code: 'E002', path: 'manifest', message: '缺少 manifest 字段', hint: 'manifest 是学习包元数据' })
    return { package: null, errors, warnings }
  }
  if (!rawInput.manifest.packageId) {
    errors.push({ level: 'error', code: 'E003', path: 'manifest.packageId', message: '缺少 manifest.packageId', hint: 'packageId 是学习包唯一标识' })
    return { package: null, errors, warnings }
  }

  const pkg = toPlain(rawInput)
  pkg.packageId = pkg.manifest.packageId

  // ---------- 依赖检查 ----------
  const deps: string[] = Array.isArray(pkg.manifest.dependencies) ? pkg.manifest.dependencies : []
  const selfId = pkg.manifest.packageId
  const seenDeps = new Set<string>()

  deps.forEach((depId: any, i: number) => {
    const path = `manifest.dependencies[${i}]`
    if (typeof depId !== 'string' || !depId) {
      errors.push({ level: 'error', code: 'E020', path, message: `依赖项不是有效字符串: ${JSON.stringify(depId)}`, hint: 'dependencies 应为 packageId 字符串数组' })
      return
    }
    if (depId === selfId) {
      errors.push({ level: 'error', code: 'E021', path, message: `包不能依赖自身: ${depId}`, hint: '移除 dependencies 中的自己' })
      return
    }
    if (seenDeps.has(depId)) {
      warnings.push({ level: 'warning', code: 'W020', path, message: `依赖项重复: ${depId}（已去重）`, hint: '同一 packageId 只需声明一次' })
      return
    }
    seenDeps.add(depId)
  })
  pkg.manifest.dependencies = Array.from(seenDeps)

  // ---------- 知识点索引 ----------
  const kpMap = new Map<string, any>()
  if (Array.isArray(pkg.knowledgePoints)) {
    pkg.knowledgePoints.forEach((kp: any, i: number) => {
      const path = `knowledgePoints[${i}]`
      if (!kp?.id) {
        warnings.push({ level: 'warning', code: 'W001', path, message: '知识点缺少 id，已跳过', hint: '知识点 id 建议语义化命名' })
        return
      }
      if (kpMap.has(kp.id)) {
        errors.push({ level: 'error', code: 'E004', path, message: `知识点 id 重复: ${kp.id}`, hint: '每个知识点 id 必须全局唯一' })
        return
      }
      kp.exerciseIds = []
      if (!Array.isArray(kp.prerequisites)) kp.prerequisites = []
      kpMap.set(kp.id, kp)
    })
  }

  /** 判断 ID 是否存在于本包或外部池中 */
  const idExists = (id: string): boolean => {
    if (kpMap.has(id)) return true
    if (externalKpIds?.has(id)) return true
    return false
  }

  // ---------- 前置引用校验（E013，支持跨包） ----------
  kpMap.forEach((kp, id) => {
    const kpPath = `knowledgePoints[${id}]`
    kp.prerequisites.forEach((preId: string, pi: number) => {
      const path = `${kpPath}.prerequisites[${pi}]`
      if (typeof preId !== 'string' || !preId) {
        errors.push({ level: 'error', code: 'E013', path, message: `知识点 ${id} 的前置项不是有效字符串`, hint: 'prerequisites 应为知识点 id 字符串数组' })
        return
      }
      if (preId === id) {
        errors.push({ level: 'error', code: 'E013', path, message: `知识点 ${id} 不能把自己作为前置`, hint: '移除 self-reference' })
        return
      }
      if (!idExists(preId)) {
        errors.push({ level: 'error', code: 'E013', path, message: `知识点 ${id} 引用了不存在的前置: ${preId}`, hint: '检查本包和同批次其他包的 knowledgePoints 是否包含该 id' })
      }
    })
  })

  // ---------- 前置环检测（仅限本包内） ----------
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const cycles: string[][] = []
  const stack: string[] = []

  function dfs(id: string) {
    if (inStack.has(id)) {
      const idx = stack.indexOf(id)
      if (idx >= 0) cycles.push([...stack.slice(idx), id])
      return
    }
    if (visited.has(id)) return
    visited.add(id)
    inStack.add(id)
    stack.push(id)
    const kp = kpMap.get(id)
    if (kp) {
      for (const preId of kp.prerequisites) {
        if (kpMap.has(preId)) dfs(preId)
      }
    }
    stack.pop()
    inStack.delete(id)
  }
  kpMap.forEach((_, id) => dfs(id))

  if (cycles.length > 0) {
    const chains = cycles.map(c => c.join(' → ')).join('；')
    errors.push({
      level: 'error',
      code: 'E014',
      path: 'knowledgePoints[].prerequisites',
      message: `检测到知识点前置循环依赖: ${chains}`,
      hint: '移除形成环的前置声明',
    })
  }

  if (!Array.isArray(pkg.exercises)) pkg.exercises = []

  const seenExerciseIds = new Set<string>()
  let topicCount = 0

  // ---------- 遍历 units ----------
  if (Array.isArray(pkg.units)) {
    pkg.units.forEach((unit: any, ui: number) => {
      if (!Array.isArray(unit.topics)) return
      unit.topics.forEach((topic: any, ti: number) => {
        topicCount++
        const topicPath = `units[${ui}].topics[${ti}]`
        const topicKpIds: string[] = Array.isArray(topic.knowledgePointIds) ? topic.knowledgePointIds : []
        if (!Array.isArray(topic.exercises)) return

        topic.exercises.forEach((ex: any, ei: number) => {
          const exPath = `${topicPath}.exercises[${ei}]`

          if (!ex?.id) {
            errors.push({ level: 'error', code: 'E005', path: exPath, message: '题目缺少 id', hint: '每道题必须有唯一 id' })
            return
          }
          if (!ex.type) {
            errors.push({ level: 'error', code: 'E006', path: exPath, message: `题目 ${ex.id} 缺少 type`, hint: `type 应为 ${VALID_TYPES.join(' / ')} 之一` })
            return
          }
          if (!VALID_TYPES.includes(ex.type)) {
            errors.push({ level: 'error', code: 'E006', path: exPath, message: `题目 ${ex.id} 的 type 无效: ${ex.type}`, hint: `type 应为 ${VALID_TYPES.join(' / ')} 之一` })
            return
          }
          if (ex.answer === undefined || ex.answer === null || ex.answer === '') {
            errors.push({ level: 'error', code: 'E007', path: exPath, message: `题目 ${ex.id} 缺少 answer`, hint: 'answer 是标准答案' })
            return
          }

          // 判断题 answer 形状校验。
          // ⚠️ 必须写成「接受合法形态」而非「一律拒绝数组」：
          //    现有 english-7-up-rjb 的 18 道**多陈述**判断题 answer 就是数组（如 ["F","T","F","T"]），
          //    引擎已支持（@core/quiz/judge）。若此处拒绝数组，会把这些题全挡在导入之外 ——
          //    那只是把「引擎判错」换成了「根本导不进来」。
          if (ex.type === 'judge') {
            const rawCount = Array.isArray(ex.answer) ? ex.answer.length : 1
            const tokenCount = normalizeJudgeList(ex.answer).length
            if (tokenCount !== rawCount) {
              errors.push({
                level: 'error',
                code: 'E015',
                path: exPath,
                message: `判断题 ${ex.id} 的 answer 含无法识别的值`,
                hint: `answer 每项应为 对/错 或 T/F（大小写均可）、true/false；当前 ${JSON.stringify(ex.answer)}`,
              })
              return
            }
            if (Array.isArray(ex.answer) && ex.answer.length === 1) {
              warnings.push({
                level: 'warning',
                code: 'W015',
                path: exPath,
                message: `判断题 ${ex.id} 的 answer 是单元素数组`,
                hint: '单句判断题请直接写标量（"对" / "错" / "T" / "F"）',
              })
            }
          }

          if (ex.type === 'matching') {
            if (!Array.isArray(ex.left) || !Array.isArray(ex.right) || !Array.isArray(ex.answer)) {
              errors.push({ level: 'error', code: 'E012', path: exPath, message: `连线题 ${ex.id} 需提供 left / right / answer 三个数组`, hint: 'answer 是索引数组' })
              return
            }
            if (ex.answer.length !== ex.left.length) {
              errors.push({ level: 'error', code: 'E012', path: exPath, message: `连线题 ${ex.id} 的 answer 长度应等于 left 长度`, hint: `left 有 ${ex.left.length} 项` })
              return
            }
          }

          /**
           * ---------- 题干配图（V2.12） ----------
           *
           * 三道关卡，顺序有意：
           *   1. 路径合法（不能 `..`、不能指向目录）—— 防的是外部输入把同一个文件
           *      写成多种形态，导致存库与取图对不上；
           *   2. 扩展名在白名单内 —— 防的是把 .exe 塞进 assets 冒充图片；
           *   3. 图片**真的在包里** —— 只在调用方给了资产清单时才能判。
           *      存档一份"引用不存在的图"的题，孩子看到的是空白，且永远查不出原因，
           *      所以这一条必须是 error 而不是 warning。
           *
           * 规范化后的路径**写回题目**：渲染层拿 `exercise.image` 直接查库，
           * 若保留 `./assets/x.png` 这种写法，就会出现"校验通过但取不到图"。
           */
          if (ex.image !== undefined && ex.image !== null && ex.image !== '') {
            const imagePath = normalizeAssetPath(ex.image)
            if (imagePath === null) {
              errors.push({
                level: 'error',
                code: 'E022',
                path: `${exPath}.image`,
                message: `题目 ${ex.id} 的配图路径非法：${JSON.stringify(ex.image)}`,
                hint: '写包内相对路径，如 assets/shape-01.png；不能含 .. 或指向目录',
              })
              return
            }
            if (!isSupportedAssetPath(imagePath)) {
              errors.push({
                level: 'error',
                code: 'E022',
                path: `${exPath}.image`,
                message: `题目 ${ex.id} 的配图格式不支持：${imagePath}`,
                hint: '只收 png / jpg / jpeg / webp / gif / svg',
              })
              return
            }
            if (assetPaths && !assetPaths.has(imagePath)) {
              errors.push({
                level: 'error',
                code: 'E023',
                path: `${exPath}.image`,
                message: `题目 ${ex.id} 的配图在包里不存在：${imagePath}`,
                hint: `图片应放在 packages/${pkg.manifest.packageId}/assets/ 下，且文件名大小写一致`,
              })
              return
            }
            ex.image = imagePath
            if (typeof ex.imageAlt !== 'string' || ex.imageAlt.trim() === '') {
              warnings.push({
                level: 'warning',
                code: 'W034',
                path: `${exPath}.imageAlt`,
                message: `题目 ${ex.id} 有配图但缺少 imageAlt`,
                hint: '补一句画面描述（如「一个大三角形被分成 4 个小三角形」），朗读与无障碍会用到',
              })
            }
          } else if (ex.image !== undefined) {
            // 显式 null / '' → 删掉字段，免得渲染层拿到空串去查库
            delete ex.image
          }

          if (seenExerciseIds.has(ex.id)) {
            warnings.push({ level: 'warning', code: 'W002', path: exPath, message: `题目 id 重复: ${ex.id}（保留第一条）`, hint: '题目 id 应全局唯一' })
            return
          }
          seenExerciseIds.add(ex.id)

          let finalKpIds: string[]
          if (Array.isArray(ex.knowledgePointIds) && ex.knowledgePointIds.length > 0) {
            finalKpIds = [...ex.knowledgePointIds]
          } else if (topicKpIds.length > 0) {
            finalKpIds = [...topicKpIds]
          } else {
            finalKpIds = []
          }

          if (finalKpIds.length === 0) {
            errors.push({ level: 'error', code: 'E008', path: exPath, message: `题目 ${ex.id} 无知识点关联`, hint: '请在题目或所属 topic 上提供 knowledgePointIds' })
            return
          }

          // ---------- E009 支持跨包 ----------
          const dangling = finalKpIds.filter(id => !idExists(id))
          if (dangling.length > 0) {
            errors.push({ level: 'error', code: 'E009', path: exPath, message: `题目 ${ex.id} 引用了不存在的知识点: ${dangling.join(', ')}`, hint: '检查本包和同批次其他包的 knowledgePoints 是否包含该 id' })
            return
          }

          ex.knowledgePointIds = finalKpIds

          /**
           * 给每道题标上**来源包**（V2.12）。
           *
           * 为什么题目需要知道自己的包：图片资产按 `[packageId, path]` 存。
           * 而练习页拿到的 `packageId` 是**路由里的入口包** —— 一旦跨包（依赖包的
           * 单元被合并进当前视图），用入口包去查图必然查不到，孩子看到的是"配图缺失"。
           *
           * 代价是每道题多一个字符串（1440 题的包约多 60KB），换来的是
           * 任何取到一道题的地方都能自解析出图在哪 —— 不必再沿调用链猜。
           */
          ex.packageId = pkg.manifest.packageId

          for (const kpId of finalKpIds) {
            const kp = kpMap.get(kpId)
            if (kp && !kp.exerciseIds.includes(ex.id)) {
              kp.exerciseIds.push(ex.id)
            }
          }

          pkg.exercises.push(ex)
        })
      })
    })
  }

  const stats = {
    knowledgePoints: pkg.knowledgePoints?.length ?? 0,
    exercises: pkg.exercises.length,
    units: pkg.units?.length ?? 0,
    topics: topicCount,
    dependencies: pkg.manifest.dependencies.length,
  }

  if (errors.length > 0) return { package: null, errors, warnings, stats }
  return { package: pkg, errors, warnings, stats }
}