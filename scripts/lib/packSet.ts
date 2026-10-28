import { zipSync, strToU8 } from 'fflate'

export interface SetManifest {
  schemaVersion: string
  setId: string
  title: string
  subject: string
  grade: number
  term: string
  edition: string
  importOrder: string[]
}

/**
 * 一份待打包的图片资产。
 *
 * `path` 是**包内相对路径**（`assets/shape-01.png`），与包 JSON 里 `exercise.image`
 * 的写法完全一致 —— 打包时只在前面补 `packages/<packageId>/`，
 * 所以源目录、包 JSON、ZIP 条目三处的路径不需要任何转换表。
 */
export interface PackAsset {
  packageId: string
  path: string
  bytes: Uint8Array
}

export interface BuildSetInput {
  manifest: SetManifest
  /** 已重写 ID 的包数组 */
  packages: any[]
  /** 图片资产（V2.12）。为空时产出的 ZIP 与旧版完全一致 */
  assets?: PackAsset[]
}

/**
 * 打包为 ZIP
 *
 * 资产落在 `packages/<packageId>/assets/...`：按包隔离，因为两个包完全可能
 * 各有一张 `assets/01.png`。
 */
export function buildLpkgsetZip(input: BuildSetInput): Uint8Array {
  const files: Record<string, Uint8Array> = {}

  // manifest.json
  files['manifest.json'] = strToU8(JSON.stringify(input.manifest, null, 2))

  // packages/*.json
  for (const pkg of input.packages) {
    const packageId = pkg.manifest.packageId
    files[`packages/${packageId}.json`] = strToU8(JSON.stringify(pkg, null, 2))
  }

  // packages/<packageId>/assets/*
  for (const asset of input.assets ?? []) {
    // 包内路径若已带 `assets/` 前缀就直接拼；否则补上（容忍 `shape-01.png` 这种写法）
    const rel = asset.path.startsWith('assets/') ? asset.path : `assets/${asset.path}`
    files[`packages/${asset.packageId}/${rel}`] = asset.bytes
  }

  return zipSync(files, { level: 6 })
}
