#!/usr/bin/env python3
# 修复 math-4-up-rjb 家族的两个问题：
# 1) manifest.subject 为 null -> 被 PackageList.vue 归为「其他」。补 subject/grade/edition/templateId。
# 2) 题干/选项里的 LaTeX `\times` 在纯文本渲染链路里不解析，显示为字面 `\times`。改为 Unicode 乘号 ×（项目约定）。
import json, os

BASE = 'content/math-4-up-rjb'
FILES = [
    'special-math-4-up-yunsuanlv.json',
    'sprint-math-4-up-final.json',
    'term-math-4-up-rjb.json',
    'unit-math-4-up-rjb-p1.json',
    'unit-math-4-up-rjb-p2.json',
    'unit-math-4-up-rjb-p3.json',
    'unit-math-4-up-rjb-p4.json',
    'unit-math-4-up-rjb-p5.json',
    'unit-math-4-up-rjb-p6.json',
]

def replace_times(obj):
    if isinstance(obj, str):
        return obj.replace('\\times', '×')
    if isinstance(obj, list):
        return [replace_times(x) for x in obj]
    if isinstance(obj, dict):
        return {k: replace_times(v) for k, v in obj.items()}
    return obj

for f in FILES:
    p = os.path.join(BASE, f)
    d = json.load(open(p, encoding='utf-8'))
    m = d.setdefault('manifest', {})
    if not m.get('subject'):
        m['subject'] = 'math'
    if not m.get('grade'):
        m['grade'] = 4
    if not m.get('edition'):
        m['edition'] = '人教版'
    if not m.get('templateId'):
        m['templateId'] = 'math.primary.v1'
    before = json.dumps(d, ensure_ascii=False).count('\\times')
    d = replace_times(d)
    after = json.dumps(d, ensure_ascii=False).count('\\times')
    json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f"{f:38} subject={m.get('subject')}  \\times {before}->{after}")
print('done')
