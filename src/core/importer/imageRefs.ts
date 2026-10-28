/**
 * imageRefs.ts —— 数一个包里有多少道题带配图（V2.12.3）
 * =====================================================================
 * 为什么需要这个纯函数：
 * 图片资产**只存在于 .lpkgset.zip 里**（`packages/<包id>/assets/…`）。
 * 单包 JSON 导入这条路（`confirmAndImport`）拿到的是一个 .json 文件 ——
 * 它天然不携带任何图片字节。于是「用单包 JSON 导入了一个含图的包」会得到：
 * 题目全在、`image` 字段全在、`packageAssets` 表里一条也没有 ——
 * 孩子看到的是每道题下面一块「配图缺失」。
 *
 * 这件事本来完全静默：导入成功、无错误、无警告。所以这里先数清楚，
 * 让调用方能把「本包 N 道题有图，但 JSON 不带图」变成一条导入警告。
 *
 * 只数不判：哪些题算"带图"由 `image` 字段是否非空决定，不校验路径合法性
 * （那是 `assetPath` / `normalizePackage` 的职责）。
 */

interface HasImage {
  image?: unknown
}

interface HasExercises {
  exercises?: unknown
}

/** 统计 `pkg.exercises` 中 `image` 非空的题数。形状不对时返回 0，绝不抛错。 */
export function countImageExercises(pkg: HasExercises | null | undefined): number {
  const list = pkg?.exercises
  if (!Array.isArray(list)) return 0
  let n = 0
  for (const ex of list as HasImage[]) {
    if (ex && typeof ex.image === 'string' && ex.image.trim() !== '') n += 1
  }
  return n
}
