# -*- coding: utf-8 -*-
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))

# ====== 1. 修复 p2 / p3 的自引用 ======
for fname in ["unit-english-7-up-rjb-p2.json", "unit-english-7-up-rjb-p3.json"]:
    path = os.path.join(BASE, fname)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    changed = False
    for kp in data.get("knowledgePoints", []):
        if kp.get("id") == "kp-grammar-001":
            prereq = kp.get("prerequisites", [])
            if "kp-grammar-001" in prereq:
                kp["prerequisites"] = [p for p in prereq if p != "kp-grammar-001"]
                changed = True

    if changed:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"[修复] {fname} 已移除 kp-grammar-001 的自引用")
    else:
        print(f"[跳过] {fname} 无需修复")

# ====== 2. 修复 family 专项的 ID ======
FAMILY_MAP = {
    "unit-english-7-up-rjb-p1::kp-grammar-003": "unit-english-7-up-rjb-p2::kp-grammar-001",
    "unit-english-7-up-rjb-p1::kp-grammar-004": "unit-english-7-up-rjb-p2::kp-grammar-002",
    "unit-english-7-up-rjb-p1::kp-sentence-002": "unit-english-7-up-rjb-p2::kp-sentence-001",
    "unit-english-7-up-rjb-p1::kp-reading-002": "unit-english-7-up-rjb-p2::kp-reading-001",
}

# ====== 3. 修复 school 专项的 ID ======
SCHOOL_MAP = {
    "unit-english-7-up-rjb-p1::kp-grammar-005": "unit-english-7-up-rjb-p3::kp-grammar-001",
    "unit-english-7-up-rjb-p1::kp-grammar-006": "unit-english-7-up-rjb-p3::kp-grammar-002",
    "unit-english-7-up-rjb-p1::kp-sentence-003": "unit-english-7-up-rjb-p3::kp-sentence-001",
    "unit-english-7-up-rjb-p1::kp-reading-003": "unit-english-7-up-rjb-p3::kp-reading-001",
}


def replace_ids(obj, mapping):
    """递归替换 obj 中所有字符串里的 ID 映射"""
    if isinstance(obj, dict):
        for k, v in obj.items():
            obj[k] = replace_ids(v, mapping)
    elif isinstance(obj, list):
        return [replace_ids(x, mapping) for x in obj]
    elif isinstance(obj, str):
        for old, new in mapping.items():
            if obj == old:
                return new
        return obj
    return obj


for fname, mapping in [
    ("special-english-7-up-family.json", FAMILY_MAP),
    ("special-english-7-up-school.json", SCHOOL_MAP),
]:
    path = os.path.join(BASE, fname)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    data = replace_ids(data, mapping)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[修复] {fname} 已替换 {len(mapping)} 组 ID")

print("\n全部修复完成，请重新运行：")
print("  npm run validate:set -- content/english-7-up-rjb")