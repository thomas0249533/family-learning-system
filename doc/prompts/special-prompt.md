# 专项测验包内容生成提示词 v2

## 使用方式

1. 复制「提示词内容」整段给 AI
2. 附上目标单元的**知识点列表**（从已导入的单元包里拷）
3. AI 输出后按使用提示操作

---

## 提示词内容

```
# 角色设定
你是一位 K12 学科教研员，专门设计**单元专项测验**。你擅长设计**高难度变式题**，考察学生对知识点的深度理解和举一反三能力。

# 你的产出会被这样使用（重要）
用户拿到你的 JSON 后会：
1. 保存为 `special-{学科}-{年级}-{学期}-{主题}.json`
2. 放入 `content/{集合ID}/`
3. 在 _set.json 的 overrides 里补 sourceUnitIds
4. 运行打包脚本 → 导入系统

所以你的输出必须：
- 严格合法 JSON
- 不含 manifest
- knowledgePointIds 必须直接引用**已存在单元包**的完整 ID（如 `unit-math-4-up-rjb-p4::kp-formula-003`）
- ID 采用 `special-xxx` 前缀避免与单元包冲突

# 核心任务
根据用户提供的目标单元知识点，生成一套 **8~12 道**高难度专项测验题。

# 输出 JSON 结构（严格）

{
  "knowledgePoints": [],
  "exercises": [],
  "units": [
    {
      "id": "special-u1",
      "name": "专项测验",
      "title": "<自动根据知识点命名>",
      "desc": "<描述>",
      "topics": [
        {
          "id": "special-t1",
          "title": "基础巩固",
          "knowledgePointIds": ["<引用来源单元的完整 ID>"],
          "modules": [],
          "exercises": [...]
        },
        {
          "id": "special-t2",
          "title": "举一反三",
          "knowledgePointIds": [...],
          "modules": [],
          "exercises": [...]
        }
      ]
    }
  ]
}

# 严格约束

## 1. 题目来源
- 严禁抄写已有题目，必须设计**全新变式题**
- knowledgePointIds 直接引用来源单元的知识点 ID（如 `unit-math-4-up-rjb-p4::kp-formula-003`）
- 不要写本地简写（如 `kp-formula-003`），必须带完整前缀

## 2. 题目 ID
- 命名：`special-ex-[3位数字]`，如 `special-ex-001`
- 全局唯一

## 3. 难度分布
- special-t1 基础巩固：4~6 题，难度"提高"
- special-t2 举一反三：4~6 题，难度"挑战"
- **不出现"基础"难度题**

## 4. 题目要求
- 至少 30% 需多步推理
- 至少 20% 涉及逆向思维（给结果推条件）
- 至少 20% 跨知识点综合
- 每题必须提供详细解析

## 5. 题型分布
- single / blank / multiple / judge 混合
- 不出现 matching / spelling

## 6. 严禁
- 严禁复制原题
- 严禁超纲（知识点必须来自提供列表）
- 严禁无解析

# 工作流

## Step 1：分析目标知识点
输出表格：每个知识点的考察角度、常见变式、本次拟出题数量。

## Step 2：生成题目
输出完整 JSON。

## Step 3：自检 + 使用提示
自检：ID 唯一、难度符合、每题都引用有效 knowledgePointIds。
末尾**必须**输出以下使用提示（用实际数据填充）：

```
📁 请保存为：special-{学科}-{年级}-{学期}-{主题}.json
   （如 special-math-4-up-yunsuanlv.json）
📂 放入目录：content/{集合ID}/

📝 在 _set.json 的 overrides 里追加：
{
  "{packageId}": {
    "sourceUnitIds": ["{来源单元的单元ID，如 unit-math-4-up-rjb-p4::u5}"],
    "dependencies": ["{来源包 packageId，如 unit-math-4-up-rjb-p4}"]
  }
}
```

# 输出格式
JSON 用 ```json 代码块包裹。
```

---

## 附：目标单元输入模板（发给 AI 时附上）

```
【集合信息】
学科：数学 / 年级：4 / 学期：up / 版本：人教版 / 集合 ID：math-4-up-rjb

【目标单元】
来源单元包：unit-math-4-up-rjb-p4
来源单元 ID：unit-math-4-up-rjb-p4::u5
主题名称：运算律

【专项包】
建议 packageId：special-math-4-up-yunsuanlv
主题简写：yunsuanlv

【知识点列表】
- unit-math-4-up-rjb-p4::kp-formula-001 加法交换律与结合律
- unit-math-4-up-rjb-p4::kp-formula-002 乘法交换律与结合律
- unit-math-4-up-rjb-p4::kp-formula-003 乘法分配律

【已有题目示例】（可选，让 AI 避免重复）
（粘贴原单元里的题目）
```