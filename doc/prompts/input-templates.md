# 输入模板速查

> 复制下方模板 → 填入你的实际内容 → 连同 `engine1-content.md` 提示词一起发给 AI。

---

## 使用前必读

每次生成内容时，你向 AI 提供两样东西：
1. **提示词**：`engine1-content.md` 全文 + `engine2-package.md` 全文
2. **输入模板**：下方 3 选 1，填好内容

---

# 模板 1：单元包

```
【集合信息】
学科：数学
年级：4
学期：up
版本：人教版（rjb）
集合 ID：math-4-up-rjb

【当前单元】
单元包序号：u1
建议 packageId：unit-math-4-up-rjb-u1
依赖：[]（或 ["unit-math-4-up-rjb-u0"]）
单元标题：第一单元 xxx

【本章内容】
（粘贴教材原文，或教材目录）
```

## AI 输出后必查 4 项

- [ ] `manifest.isInternal` = `true`
- [ ] `manifest.packageType` = `"unit"`
- [ ] **无** `manifest.examMode` 字段
- [ ] **无** `manifest.sourceUnitIds` 字段

---

# 模板 2：专项包

> 前置条件：来源单元包**已导入 App**，能查到知识点完整 ID 列表。

```
【集合信息】
学科：数学
年级：4
学期：up
版本：人教版（rjb）
集合 ID：math-4-up-rjb

【模式】
专项测验（高难度变式）

【目标单元】
来源单元包：unit-math-4-up-rjb-p4
来源单元 ID：unit-math-4-up-rjb-p4::u5
主题：运算律

【专项包】
建议 packageId：special-math-4-up-yunsuanlv
主题简写：yunsuanlv
目标题数：10 题

【知识点完整 ID 列表】
- unit-math-4-up-rjb-p4::kp-formula-001 加法交换律与结合律
- unit-math-4-up-rjb-p4::kp-formula-002 乘法交换律与结合律
- unit-math-4-up-rjb-p4::kp-formula-003 乘法分配律

【已有题目】（可选）
（把原单元的题粘进来，让 AI 避免重复）
```

## AI 输出后必查 5 项

- [ ] `manifest.packageType` = `"special"`
- [ ] **`manifest.examMode` = `true`** ⚠️ 最关键
- [ ] **`manifest.sourceUnitIds` = `["unit-...::u5"]`** ⚠️ 最关键
- [ ] `manifest.dependencies` = `["unit-math-4-up-rjb-p4"]`
- [ ] `manifest.isInternal` = `false`

**任何一项缺失，就是废包，让 AI 重新输出。**

---

# 模板 3：冲刺包

> 前置条件：**整个学期的所有单元包已导入 App**。

```
【集合信息】
学科：数学
年级：4
学期：up
版本：人教版（rjb）
集合 ID：math-4-up-rjb

【模式】
期末冲刺模拟（覆盖全册）

【覆盖单元】
全部 6 个单元：unit-math-4-up-rjb-p1 ~ p6

【冲刺包】
建议 packageId：sprint-math-4-up-final
目标题数：20 题
难度分布：基础 40% / 提高 40% / 挑战 20%

【知识点完整 ID 列表】
- unit-math-4-up-rjb-p1::kp-num-001 大数的读写
- ...
（完整列出）
```

## AI 输出后必查 5 项

- [ ] `manifest.packageType` = `"sprint"`
- [ ] **`manifest.examMode` = `true`** ⚠️ 最关键
- [ ] **`manifest.sourceUnitIds`** 列出所有覆盖单元
- [ ] `manifest.dependencies` 列出所有覆盖单元包
- [ ] `manifest.isInternal` = `false`

---

# 附：查询知识点完整 ID 列表

在 App 浏览器 Console 里运行：

## A. 查单个单元（专项包用）

```js
const db = (await import('/src/db/index.ts')).db;
const pkgId = 'unit-chinese-4-up-rjb-u4';   // ← 改这里
const pkg = await db.packages.get(pkgId);
console.log(`=== ${pkgId} ===`);
pkg.knowledgePoints.forEach(kp => {
  console.log(`- ${kp.id} ${kp.title}`);
});
```

## B. 查整个学期（冲刺包用）

```js
const db = (await import('/src/db/index.ts')).db;
const subject = 'chinese';   // ← 改这里
const allPkgs = await db.packages
  .filter(p => (p.manifest.packageType ?? p.manifest.type) === 'unit')
  .filter(p => p.manifest.subject === subject)
  .toArray();

for (const p of allPkgs) {
  console.log(`\n【${p.packageId}】`);
  p.knowledgePoints.forEach(kp => {
    console.log(`- ${kp.id} ${kp.title}`);
  });
}
```

---

# 附：`_set.json` 追加片段

## 单元包

```json
{
  "file": "unit-{学科}-{年级}-{学期}-{版本}-u{N}.json",
  "packageId": "unit-{学科}-{年级}-{学期}-{版本}-u{N}",
  "type": "unit",
  "visible": false,
  "dependencies": ["unit-{学科}-{年级}-{学期}-{版本}-u{N-1}"]
}
```

u1 的 `dependencies` 写 `[]`。

## 专项包

```json
{
  "file": "special-{学科}-{年级}-{学期}-{主题}.json",
  "packageId": "special-{学科}-{年级}-{学期}-{主题}",
  "type": "special",
  "visible": true,
  "examMode": true,
  "sourceUnitIds": ["unit-{学科}-{年级}-{学期}-{版本}-u{N}::u{N}"],
  "dependencies": ["unit-{学科}-{年级}-{学期}-{版本}-u{N}"]
}
```

## 冲刺包

```json
{
  "file": "sprint-{学科}-{年级}-{学期}-final.json",
  "packageId": "sprint-{学科}-{年级}-{学期}-final",
  "type": "sprint",
  "visible": true,
  "examMode": true,
  "sourceUnitIds": [
    "unit-{学科}-{年级}-{学期}-{版本}-u1::u1",
    "...",
    "unit-{学科}-{年级}-{学期}-{版本}-u8::u8"
  ],
  "dependencies": [
    "unit-{学科}-{年级}-{学期}-{版本}-u1",
    "...",
    "unit-{学科}-{年级}-{学期}-{版本}-u8"
  ]
}
```

---

# 附：`importOrder` 追加规则

顺序必须是：**所有 unit → term → special → sprint**

```json
"importOrder": [
  "unit-...-u1",
  "...",
  "unit-...-u8",
  "term-...",
  "special-...",
  "sprint-..."
]
```

**顺序错会报 E022**（包依赖循环）。

---

# 附：完整流程对照表

| 步骤 | 做什么 | 涉及文件 |
|---|---|---|
| 1 | 打开 AI，粘贴 `engine1-content.md` + `engine2-package.md` | 提示词 |
| 2 | 附上对应输入模板 | 本文档 |
| 3 | AI 输出带 manifest 的包 | 保存为 `content/xxx/xxx.json` |
| 4 | **按"必查清单"逐项验收** | 本文档 |
| 5 | 手动更新 `_set.json` | 追加 packages + importOrder |
| 6 | 预检 | `npm run validate:set` |
| 7 | 打包 | `npm run build:lpkgset` |
| 8 | 导入 App | 设置 → 导入 ZIP |
| 9 | 验证 | 学习页 3 分组 / 题号导航条 |

---

# 常见错误速查

| 现象 | 原因 | 修复 |
|---|---|---|
| **专项包进入是浏览模式** | **`examMode` 没写** | **manifest 和 `_set.json` 都补** |
| 学习页"基于 0 个单元" | `sourceUnitIds` 没写 | `_set.json` 补 |
| E009 引用了不存在的知识点 | AI 写裸 ID 引用其他包 | 强制 AI 写完整 ID |
| W021 依赖包未找到 | `_set.json` 没写 dependencies | 补上 |
| E022 包依赖循环 | importOrder 顺序错 | special/sprint 放最后 |
| unit 包出现在"📚 教材" | `isInternal` 没写或为 false | 改成 true |