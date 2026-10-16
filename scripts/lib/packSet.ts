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

export interface BuildSetInput {
  manifest: SetManifest
  /** 已重写 ID 的包数组 */
  packages: any[]
}

/**
 * 打包为 ZIP
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

  return zipSync(files, { level: 6 })
}