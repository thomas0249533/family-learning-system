# 学习包错误码字典

## 错误码 (E)

| Code | 含义 | 修复方向 |
|---|---|---|
| E001 | 学习包不是有效 JSON 对象 | 确认顶层是 `{}` |
| E002 | 缺少 manifest | 补 manifest 元数据 |
| E003 | 缺少 manifest.packageId | 补 packageId，如 `math-4-up-rjb` |
| E004 | 知识点 id 重复 | 保证每个知识点 id 唯一 |
| E005 | 题目缺少 id | 每道题加唯一 id |
| E006 | 题目缺少 type | type 应为 single/blank/multiple/... |
| E007 | 题目缺少 answer | 补标准答案 |
| E008 | 题目无知识点关联 | 在题目或 topic 提供 knowledgePointIds |
| E009 | 题目引用了不存在的知识点 | 检查 knowledgePoints 是否包含该 id |
| E010 | JSON 语法错误 | VSCode 打开，修复红色波浪线 |

## 警告码 (W)

| Code | 含义 | 建议 |
|---|---|---|
| W001 | 知识点缺少 id | 建议语义化命名，如 `math-formula-001` |
| W002 | 题目 id 重复 | 保证唯一，否则错题本混乱 |