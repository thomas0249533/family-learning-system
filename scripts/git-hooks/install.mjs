#!/usr/bin/env node
/**
 * 安装 git 钩子（V1.6 · Stage B · B1）
 *
 * 用法：`npm run hooks:install`
 *
 * ## 为什么不用 husky
 * 见 `pre-commit.mjs` 文件头。一句话：为一个钩子装一套依赖 + `prepare` 生命周期
 * 不值得，而且 husky 的转发脚本出问题时更难查。
 *
 * ## 这个脚本做三件事
 * 1. 把 `scripts/git-hooks/pre-commit` 复制到 `.git/hooks/pre-commit`；
 * 2. 赋予可执行位（Windows 上是空操作，Git for Windows 默认视为可执行）；
 * 3. 若目标位置已有**别的**钩子，先备份成 `pre-commit.bak` 再覆盖 —— 覆盖别人的钩子
 *    是那种"半年后才发现 CI 少跑了一半检查"的事故。
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const source = join(here, 'pre-commit')
const hooksDir = join(repoRoot, '.git', 'hooks')
const target = join(hooksDir, 'pre-commit')

if (!existsSync(join(repoRoot, '.git'))) {
  console.error(`✗ 这里不是 git 仓库根目录：${repoRoot}`)
  process.exit(1)
}
mkdirSync(hooksDir, { recursive: true })

if (existsSync(target)) {
  const existing = readFileSync(target, 'utf8')
  const mine = readFileSync(source, 'utf8')
  if (existing === mine) {
    console.log('[hooks] 已是最新，无需改动')
    process.exit(0)
  }
  const backup = `${target}.bak`
  writeFileSync(backup, existing)
  console.log(`[hooks] 已备份原钩子 → ${backup}`)
}

copyFileSync(source, target)
try {
  chmodSync(target, 0o755)
} catch (err) {
  // Windows 的 NTFS 没有 POSIX 可执行位，Git for Windows 一律视为可执行 —— 不是错误
  console.log(`[hooks] 跳过 chmod（${err.code ?? err.message}），Windows 上正常`)
}

console.log(`[hooks] ✓ 已安装 pre-commit → ${target}`)
console.log('[hooks]   提交时自动跑：tokens:check → typecheck:test')
