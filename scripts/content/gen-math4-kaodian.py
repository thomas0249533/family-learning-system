# -*- coding: utf-8 -*-
"""生成《四年级上册数学 · 43 个必背考点》填空包。
数据源：content/资料/四上数学【43个必背考点】.pdf（4 页，文本可提取）。
多空 ⇒ 每空一题：题面只留目标空为（　），其余空直接填答案，保留整条考点语境。
"""
import re, io, sys, json, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PKG_ID = "special-math-4-up-kaodian"
OUT = r"D:\study\content\math-4-up-rjb"
PLACE = '（　）'

raw = open(r'D:\study\tmp-43.txt', encoding='utf-8').read().replace('\r', '')
raw = re.sub(r'四年级数学上册43 个必背考点', '', raw)
parts = re.split(r'(?m)(?:^|\n)\s*(\d{1,2})、', '\n' + raw)
items = []
for i in range(1, len(parts) - 1, 2):
    items.append((int(parts[i]), parts[i + 1]))

# 一条考点内含多条独立公式时，换行要保留成分隔（否则会挤成一串）
MULTILINE = {10: '；', 23: '；'}
# 原文残缺/需重写语义的条目
REWRITE = {
    # 末句被截断，且"（数量大于等于2）"是适用条件而非空位
    43: '烙一面的时间×烙的数量=（总时间），数量大于等于 2 时用。',
}

FIXES = [
    ('测量士地的面积', '测量土地的面积'),
    ('把园平均分成360 份', '把圆平均分成 360 份'),
    ('这链条（射线）', '这两条（射线）'),
    ('经过两点可以面（一条）', '经过两点可以画（一条）'),
    ('再添上两个因数未尾的0', '再添上两个因数末尾的 0'),
    ('路程＋时间=（速度）', '路程÷时间=（速度）'),
    ('路程＋速度=（时间）', '路程÷速度=（时间）'),
    ('像个、十、百、千、万...亿等', '像 个、十、百、千、万……亿 等'),
    ('商也会（乘或者除以几', '商也会（乘或者除以几）'),
    ('x 数量', '×数量'), ('x 时间', '×时间'), ('x 烙', '×烙'),
]


def normalize(no, body):
    if no in REWRITE:
        return REWRITE[no]
    lines = [ln.strip() for ln in body.split('\n') if ln.strip()]
    body = (MULTILINE[no] if no in MULTILINE else '').join(lines)
    for a, b in FIXES:
        body = body.replace(a, b)
    return body


BODY = {no: normalize(no, body) for no, body in items}

BOARDS = [
    ("大数的认识", 1, 7, "自然数、计数单位与数位、十进制计数法、计算器与算盘。"),
    ("公顷与平方千米", 8, 10, "土地面积单位、平方米/公顷/平方千米之间的进率。"),
    ("角的度量", 11, 18, "线段射线直线的端点、角的组成、量角器、平角周角。"),
    ("三位数乘两位数", 19, 25, "积的位数、因数末尾有 0、单价数量总价、速度时间路程、积的变化规律。"),
    ("平行四边形和梯形", 26, 36, "平行与垂直、平行四边形与梯形的特征、四边形内角和、图形的拼组。"),
    ("除数是两位数的除法", 37, 41, "商的位数、试商与调商、商不变的规律。"),
    ("条形统计图与优化", 42, 43, "条形统计图的特点、烙饼问题的时间计算。"),
]

BR = re.compile(r'[（(]\s*([^（）()]*?)\s*[）)]')

kps, units = [], []
for bi, (name, lo, hi, desc) in enumerate(BOARDS, 1):
    kid = f"kp-kd{bi}"
    nos = [n for n in range(lo, hi + 1)]
    kps.append({"id": kid, "type": "concept",
                "title": f"{name}（考点 {lo}-{hi}）", "content": desc,
                "prerequisites": [f"kp-kd{bi-1}"] if bi > 1 else []})
    exs = []
    for no in nos:
        body = BODY[no]
        holes = BR.findall(body)
        if not holes:
            print(f"⚠️ 考点 {no} 无空位，跳过")
            continue
        for hi_i in range(len(holes)):
            cnt = [0]
            def repl(m, t=hi_i):
                j = cnt[0]; cnt[0] += 1
                return PLACE if j == t else holes[j]
            q = BR.sub(repl, body)
            exs.append({
                "id": f"kd4-{no:02d}-{hi_i+1}",
                "type": "blank",
                "question": q,
                "answer": holes[hi_i],
                "explanation": f"考点 {no}：{body}",
                "knowledgePointIds": [kid],
                "metadata": {"difficulty": "基础", "kaodian": no},
            })
    if not exs:
        continue
    units.append({
        "id": f"kd4-u{bi}",
        "name": f"第 {bi} 板块",
        "title": name,
        "desc": f"考点 {lo}-{hi}（{len(exs)} 题）",
        "topics": [{
            "id": f"kd4-t{bi}",
            "title": name,
            "desc": f"{len(exs)} 题 · 填出括号里的内容",
            "board": "必背考点",
            "knowledgePointIds": [kid],
            "modules": [{"id": f"kd4-m{bi}", "type": "math.concept",
                         "title": name, "knowledgePointIds": [kid]}],
            "exercises": exs,
        }],
    })

pkg = {
    "manifest": {
        "schemaVersion": "1.0",
        "packageId": PKG_ID,
        "type": "special",
        "packageType": "special",
        "isInternal": False,
        "examMode": True,
        "subject": "math",
        "templateId": "math.primary.v1",
        "grade": 4,
        "term": "up",
        "edition": "人教版",
        "title": "四上数学 · 43 个必背考点填空",
        "dependencies": [],
    },
    "knowledgePoints": kps,
    "exercises": [],
    "units": units,
}

p = os.path.join(OUT, f"{PKG_ID}.json")
json.dump(pkg, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

total = sum(len(t["exercises"]) for u in units for t in u["topics"])
print(f"✅ {PKG_ID}: {len(units)} 板块 / {total} 题 / {len(kps)} 知识点")
for no in (1, 2, 10, 23, 40, 43):
    for u in units:
        for t in u["topics"]:
            for e in t["exercises"]:
                if e["metadata"]["kaodian"] == no:
                    print(f"  [{no}] {e['question']}")
                    print(f"       → {e['answer']}")
