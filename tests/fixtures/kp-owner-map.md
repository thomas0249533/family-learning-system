# `kp-owner-map.csv` 说明

## 元数据

- **口径**：`own` = 该包的 **`knowledgePoints` 里声明了该 kpId**（不是 units 引用口径）。这是期望值，不是当前代码行为。
- **用途**：`tests/kp-owner-map.test.ts` 表驱动断言。**若改算法导致任一行 `result != ok`，该测试必须变红**；若 `ownerPackageId` 与表不符，也必须变红。
- **数据来源**：`content/*/*.lpkgset.zip`（用户实际导入的运行时数据，43 个包），非 `content/**/*.json`（构建中间产物，含未重写的短 id）。
- **不依赖应用代码**：本文件由离线脚本按内容包静态生成，`src/` 未改动。

## 列定义

| 列 | 说明 |
|---|---|
| `entryPackageId` | 学习入口包（`currentPackageId` 可能取到的包） |
| `entryPackageType` | 入口包的 `manifest.packageType` |
| `kpId` | 知识点 id（带 `::` 前缀） |
| `ownerPackageId` | 解析出的归属包 id；仅 `ok` 时非空 |
| `result` | `ok` / `zero` / `ambiguous` / `crossSubject` |

## 统计

- 去重后行数：**898**（表头之外的数据行）。
- 去重前组合数：1252，因同一 `(entryPackageId, kpId)` 重复出现而移除 **354** 行（重复来自「入口包 own units 与 deps units 都引用同一 kp」）。
- `result` 分布：`ok` = 898，`zero` = 0，`ambiguous` = 0，`crossSubject` = 0。
- **非 `ok` 行数：0**（若不为 0，说明裁决前提有漏洞）。

## 与「units 引用口径」的差异

若把 `own` 改为「该包自己的 units 里引用了 kpId」，同样这 898 个组合里：

- 结论不同的行：**452** 行（占 50.3%）。
  - 旧口径解析失败（`ambiguous`/`zero`/`crossSubject`）：**452** 行
  - 旧口径也 `ok` 但归属包不同：**0** 行
- 受影响入口包：31 个（共 43 个）。

原因：term / sprint / special / daily 的 `units` 是从 unit 包复制/聚合来的，所以同一 kpId 在这些包里也会「被引用」，从而产生 3–5 个候选。

## ⚠️ 一个使用前提（勿用本表断言「可达性」）

898 行里有 **42 行**（`unit-english-7-up-rjb-p2`~`p7` 各 7 行）的 `ownerPackageId` ≠ `entryPackageId`，原因是这 6 个单元包的 `units` 引用了**上游单元**的 KP（链式依赖 `p2 deps=[p1]` … `p7 deps=[p6]`）。

- D2 修复后（own 优先、仅当 own 为空才聚合 deps），这 42 个 `(入口包, kpId)` 组合在 UI 上**不再可达**。
- 因此本表只用于断言**归属解析的纯函数语义**（给定 `(entry, kp)` → owner），**不要**用它断言"Review 列表里应出现这 42 条"或"p3 的单元列表含 p2 的单元"——那正是要被 D2 删掉的行为。
- 其余 856 行（含 term / sprint / special / daily 的聚合入口）在 D2 修复后仍可达。

## 建议的测试用法

```ts
// tests/kp-owner-map.test.ts（示意，勿直接复制实现）
// 1. 读 CSV（跳过表头），对每行调用 resolveOwnerPackage(entryPackageId, kpId)
// 2. 断言 result 与 ownerPackageId 与 CSV 完全一致
// 3. 另加一条「口径回归」：用 units 引用口径重算，断言与本题 898 行中
//    452 行不同 —— 防止有人把口径悄悄改回 units 引用而不自知
```

> 注：CSV 为纯数据（表头 + 数据行，无 `#` 注释），便于 `papaparse` / `csv-parse` 直接读取；元数据放在本文件。
