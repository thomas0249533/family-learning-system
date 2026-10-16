# 内容生产 SOP（v1.0）

> 从「AI 生成内容」到「学习包进入 App」，一份完整的操作手册。

---

## 一、全景流程图

```
教材目录/章节
      ↓
【提示词 A/B/C】AI 生成裸 JSON（不含 manifest）
      ↓
放入 content/<集合名>/
      ↓
编写 _set.json
      ↓
npm run validate:set   ← 本地预检
      ↓
npm run build:lpkgset  ← 打包 ZIP
      ↓
App → 设置 → 导入 ZIP
      ↓
学习页验证
```

---

## 二、目录规范

每个"集合"（一学期一学科一个版本）对应一个目录：

```
content/
└── math-4-up-rjb/              ← 集合目录
    ├── _set.json               ← 集合配置（必填）
    ├── unit-math-4-up-rjb-p1.json
    ├── unit-math-4-up-rjb-p2.json
    ├── ...
    ├── term-math-4-up-rjb.json
    ├── special-math-4-up-xxx.json
    └── sprint-math-4-up-final.json
```

**命名规则**：

| 类型 | 文件名 | packageId |
|---|---|---|
| 单元包 | `unit-{学科}-{年级}-{学期}-{版本}-p{N}.json` | 同文件名 |
| 学期包 | `term-{学科}-{年级}-{学期}-{版本}.json` | 同文件名 |
| 专项包 | `special-{学科}-{年级}-{学期}-{主题}.json` | 同文件名 |
| 冲刺包 | `sprint-{学科}-{年级}-{学期}-final.json` | 同文件名 |

**学科代码**：`math` / `chinese` / `english`
**学期**：`up` / `down`
**版本**：`rjb`（人教版）/ `bsd`（北师大版）/ `sjb`（苏教版）...

---

## 三、_set.json 编写规范

```json
{
  "setId": "math-4-up-rjb-set",
  "title": "四年级数学上（人教版）",
  "subject": "math",
  "grade": 4,
  "term": "up",
  "edition": "人教版",
  "importOrder": ["...", "..."],
  "packages": [
    {
      "file": "unit-math-4-up-rjb-p1.json",
      "packageId": "unit-math-4-up-rjb-p1",
      "type": "unit",
      "visible": false,
      "dependencies": []
    },
    {
      "file": "term-math-4-up-rjb.json",
      "packageId": "term-math-4-up-rjb",
      "type": "term",
      "visible": true,
      "dependencies": ["unit-math-4-up-rjb-p1", "..."]
    },
    {
      "file": "special-math-4-up-yunsuanlv.json",
      "packageId": "special-math-4-up-yunsuanlv",
      "type": "special",
      "visible": true,
      "examMode": true,
      "sourceUnitIds": ["unit-math-4-up-rjb-p4::u5"],
      "dependencies": ["unit-math-4-up-rjb-p4"]
    }
  ]
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `visible` | ❌ | `false` = 内部包，学习页不显示（默认 `true`）|
| `examMode` | ❌ | `true` = 考试模式（专项/冲刺必填）|
| `sourceUnitIds` | 专项/冲刺必填 | 覆盖的单元 ID 列表，用于显示"基于 N 个单元" |
| `dependencies` | ❌ | 依赖的其他 packageId |

### 约定

- **单元包**：`visible: false`，作为内部包存在
- **学期包**：`visible: true`，聚合所有单元包
- **专项包**：`visible: true, examMode: true`，带独立题目
- **冲刺包**：`visible: true, examMode: true`，带独立综合题
- `importOrder` 必须按依赖顺序：p1 → p2 → ... → term → special → sprint

---

## 四、AI 生成流程

**提示词文件**：`docs/prompts/` 下的 3 个提示词

| 场景 | 提示词 | 产出 |
|---|---|---|
| 单元内容 | `unit-prompt.md` | 一个单元的 knowledgePoints + units + exercises |
| 专项测验 | `special-prompt.md` | 高难度变式题（10 题左右）|
| 冲刺模拟 | `sprint-prompt.md` | 综合模拟题（10~20 题）|

**操作步骤**：

1. 打开 AI 对话，粘贴对应提示词
2. 附上教材章节内容
3. AI 按 Step 1~4 分步输出 JSON
4. 把 JSON 保存为 `unit-xxx.json`（**不含 manifest**）
5. 完成后进行下一步

**关键约定**：
- AI 输出**不含 manifest**，打包脚本自动注入
- AI 输出的 ID 是**局部唯一**（`kp-num-001`），打包脚本自动加前缀
- AI 输出的 `prerequisites` 可以是同单元内的 ID，也可以是**已存在基础包**的 ID
- AI 禁止输出 `manifest.dependencies`

---

## 五、打包与校验

### 5.1 预检（推荐）

```bash
npm run validate:set -- content/math-4-up-rjb
```

输出：

```
📦 集合: 四年级数学上（人教版）
📋 检查 9 个包...

  ✅ unit-math-4-up-rjb-p1.json （知识点 3，题目 22）
  ✅ unit-math-4-up-rjb-p2.json （知识点 4，题目 22）
  ...
  ✅ special-math-4-up-yunsuanlv.json （知识点 0，题目 10）
  ✅ sprint-math-4-up-final.json （知识点 0，题目 10）

✅ 全部通过
   包数: 9
   总知识点: 24
   总题目: 156
```

**错误时报错退出**，不生成 ZIP。

### 5.2 打包

```bash
npm run build:lpkgset -- content/math-4-up-rjb
```

输出：

```
📦 输入目录: D:\study\content\math-4-up-rjb
📋 集合: 四年级数学上（人教版）（9 个包）
  ✅ unit-math-4-up-rjb-p1.json → unit-math-4-up-rjb-p1 [内部]
  ...
  ✅ term-math-4-up-rjb.json → term-math-4-up-rjb
  ✅ special-math-4-up-yunsuanlv.json → special-math-4-up-yunsuanlv [考试]
  ✅ sprint-math-4-up-final.json → sprint-math-4-up-final [考试]

✅ 已生成: content/math-4-up-rjb/math-4-up-rjb-set.lpkgset.zip
   大小: 45.3 KB
```

### 5.3 导入

App → 设置 → 📥 导入新的学习包 → 选择包集合 ZIP

### 5.4 验证

- 学习页应显示：
  - **📚 教材** → 学期包
  - **🎯 专项突破** → 专项包
  - **🏁 冲刺模拟** → 冲刺包
- 单元包不显示（`visible: false`）

---

## 六、错误码速查

| 码 | 含义 | 修复方向 |
|---|---|---|
| E001 | 顶层不是 JSON 对象 | 检查最外层 `{}` |
| E002 | 缺少 manifest | AI 不应输出 manifest，让打包脚本注入 |
| E003 | 缺少 packageId | `_set.json` 里补 `packageId` |
| E004 | 知识点 id 重复 | AI 输出时局部唯一 |
| E005 | 题目缺 id | AI 输出时补全 |
| E006 | 题型错误 | 只允许 single/blank/multiple/judge/matching/spelling |
| E007 | 缺 answer | AI 输出时补全 |
| E008 | 题目无知识点关联 | 题目或 topic 至少一处有 knowledgePointIds |
| E009 | 引用了不存在的知识点 | 检查跨包引用，先导入基础包 |
| E012 | 连线题字段不合法 | left/right/answer 三数组长度匹配 |
| E013 | 前置引用不存在 | 检查 prerequisites |
| E014 | 前置循环依赖 | 移除成环声明 |
| E020/E021 | 依赖项非法/自依赖 | 检查 dependencies |
| E022 | 包依赖循环 | 检查 `_set.json` 的 importOrder |
| W001 | 知识点缺 id | 建议补 |
| W002 | 题目 id 重复 | 建议唯一 |
| W021 | 依赖包未找到 | 先导入依赖包 |

---

## 七、FAQ

**Q1：AI 生成的 ID 冲突怎么办？**
A：无需处理，打包脚本自动加 `{packageId}::` 前缀。

**Q2：跨包 prerequisites 怎么写？**
A：如果引用同批次的其他包，写完整 ID：`unit-math-4-up-rjb-p1::kp-num-001`。
如果引用同单元内的知识点，写局部 ID：`kp-num-002`。

**Q3：专项包需要写 knowledgePoints 吗？**
A：不需要。题目直接引用来源单元的 knowledgePointIds 即可。
（如 `unit-math-4-up-rjb-p4::kp-formula-003`）

**Q4：_set.json 里的 importOrder 顺序错了会怎样？**
A：校验阶段会检测依赖顺序，出错的包会报 E022。

**Q5：一次导入 ZIP 会覆盖旧数据吗？**
A：会。相同 packageId 的包会被覆盖（事务保证全成功或全回滚）。

**Q6：专项/冲刺包的题目会进错题本吗？**
A：会，且归属于 `sourceUnitIds` 对应的单元包。

---

## 八、版本与变更

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0 | 2026-09-24 | 初版：支持单元/学期/专项/冲刺四类包 |