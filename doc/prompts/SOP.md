# 内容生产 SOP

## 三个引擎的职责

```
┌──────────────────────┐
│ 引擎一：内容生成      │  ← K12 特级教师角色
│  ─ Content IR JSON    │
└──────────────────────┘
          ↓
┌──────────────────────┐
│ 引擎二：包结构包装    │  ← 包结构包装器角色
│  ─ 加 manifest 的包   │
└──────────────────────┘
          ↓
┌──────────────────────┐
│ 手动：写 term + _set  │
└──────────────────────┘
          ↓
┌──────────────────────┐
│ 校验 + 打包           │
│  ─ validate:set       │
│  ─ build:lpkgset      │
└──────────────────────┘
```

---

## 完整工作流

### Step 1：生成单元内容

1. 打开 AI 对话 A
2. 粘贴 `engine1-content.md` 的提示词
3. 附上输入模板：

```
【集合信息】
学科：语文 / 年级：4 / 学期：up / 版本：人教版
集合 ID：chinese-4-up-rjb

【当前单元】
单元包序号：u1
建议 packageId：unit-chinese-4-up-rjb-u1
依赖：无

【本章内容】
（粘贴教材章节）
```

4. AI 输出 Content IR → 保存为临时文件

### Step 2：包装为学习包

1. 打开 AI 对话 B（或同一个对话继续）
2. 粘贴 `engine2-package.md` 提示词
3. 附上 Step 1 的 Content IR
4. 告诉它：packageId / subject / grade / term / edition
5. AI 输出带 manifest 的包 → 保存为 `content/chinese-4-up-rjb/unit-chinese-4-up-rjb-u1.json`

### Step 3：手写 term 包和 _set.json

用 `engine2-package.md` 的第五节和第六节模板：

- `term-chinese-4-up-rjb.json`
- `_set.json`（含 packages 数组）

### Step 4：预检

```bash
npm run validate:set -- content/chinese-4-up-rjb
```

**期望**：无 error。有 W030/W031 时可选优化。

### Step 5：打包 ZIP

```bash
npm run build:lpkgset -- content/chinese-4-up-rjb
```

### Step 6：导入 App

设置 → 导入学习包 → 选 `.lpkgset.zip`

### Step 7：验证

- 学习页显示 3 个分组
- 点学期包 → 8 个单元
- 点单元 → 主题列表
- 点主题 → 知识卡片 + 练习

---

## 常见错误速查

| 现象 | 原因 | 修复 |
|---|---|---|
| 校验报 E008 | 题没关联知识点 | 题必须写 knowledgePointIds |
| 校验报 E009 | 引用了不存在的 kp | 检查知识点池 |
| 校验报 E013 | prerequisites 找不到 | 检查前置引用 |
| 导入后学习页只有 1 个包 | packageType 字段不对 | 检查 manifest.packageType |
| 主题内容为空 | topic.modules 空 + 题在顶层 | 用 engine1 重新生成 |
| W030 | 题在顶层 exercises | 移到 topic.exercises |
| W031 | topic 没有 modules | 加至少 1 个 module |

---

## 特别说明

### 为什么不要 base 包

早期设计里有 base 层，实践证明制造碎片、增加复杂度，且没有实际收益。**现在只用 unit / term / special / sprint 四种类型**。

### 为什么 term 包 units 为空

term 包只声明依赖，不内联内容。前端通过 `resolvePackageUnits` 从依赖的 unit 包动态聚合。

### 为什么 ID 不带前缀

前缀由 `scripts/lib/idRewrite.ts` 自动加。AI 手写前缀容易出现前后不一致，导致 E108 冲突。

---

## 目录结构

```
content/
└── chinese-4-up-rjb/
    ├── _set.json
    ├── unit-chinese-4-up-rjb-u1.json     ← 引擎一 + 引擎二产出
    ├── unit-chinese-4-up-rjb-u2.json
    ├── ...
    ├── term-chinese-4-up-rjb.json        ← 手写
    ├── special-chinese-4-up-xxx.json     ← 引擎一 + 引擎二产出
    └── sprint-chinese-4-up-final.json
```