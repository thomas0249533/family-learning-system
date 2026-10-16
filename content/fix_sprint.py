# -*- coding: utf-8 -*-
"""
修复 sprint 冲刺包：
1. 从 all_exercises.json 中提取所有 sprint-ex-xxx 题目对象（容错，忽略坏结构）
2. 自动修正已知答案问题（Next -> next）
3. 组装成合法的 sprint-english-7-up-final.json
"""
import json
import re
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_FILE = os.path.join(BASE_DIR, "all_exercises.json")
OUTPUT_FILE = os.path.join(BASE_DIR, "sprint-english-7-up-final.json")

# ============ 49 个知识点 ID ============
KP_IDS = [
    "unit-english-7-up-rjb-p1::kp-word-001",
    "unit-english-7-up-rjb-p1::kp-sentence-001",
    "unit-english-7-up-rjb-p1::kp-grammar-001",
    "unit-english-7-up-rjb-p1::kp-grammar-002",
    "unit-english-7-up-rjb-p1::kp-phonetic-001",
    "unit-english-7-up-rjb-p1::kp-reading-001",
    "unit-english-7-up-rjb-p1::kp-writing-001",
    "unit-english-7-up-rjb-p2::kp-word-001",
    "unit-english-7-up-rjb-p2::kp-sentence-001",
    "unit-english-7-up-rjb-p2::kp-grammar-001",
    "unit-english-7-up-rjb-p2::kp-grammar-002",
    "unit-english-7-up-rjb-p2::kp-phonetic-001",
    "unit-english-7-up-rjb-p2::kp-reading-001",
    "unit-english-7-up-rjb-p2::kp-writing-001",
    "unit-english-7-up-rjb-p3::kp-word-001",
    "unit-english-7-up-rjb-p3::kp-sentence-001",
    "unit-english-7-up-rjb-p3::kp-grammar-001",
    "unit-english-7-up-rjb-p3::kp-grammar-002",
    "unit-english-7-up-rjb-p3::kp-phonetic-001",
    "unit-english-7-up-rjb-p3::kp-reading-001",
    "unit-english-7-up-rjb-p3::kp-writing-001",
    "unit-english-7-up-rjb-p4::kp-word-001",
    "unit-english-7-up-rjb-p4::kp-sentence-001",
    "unit-english-7-up-rjb-p4::kp-grammar-001",
    "unit-english-7-up-rjb-p4::kp-grammar-002",
    "unit-english-7-up-rjb-p4::kp-phonetic-001",
    "unit-english-7-up-rjb-p4::kp-reading-001",
    "unit-english-7-up-rjb-p4::kp-writing-001",
    "unit-english-7-up-rjb-p5::kp-word-001",
    "unit-english-7-up-rjb-p5::kp-sentence-001",
    "unit-english-7-up-rjb-p5::kp-grammar-001",
    "unit-english-7-up-rjb-p5::kp-phonetic-001",
    "unit-english-7-up-rjb-p5::kp-reading-001",
    "unit-english-7-up-rjb-p5::kp-writing-001",
    "unit-english-7-up-rjb-p6::kp-word-001",
    "unit-english-7-up-rjb-p6::kp-sentence-001",
    "unit-english-7-up-rjb-p6::kp-grammar-001",
    "unit-english-7-up-rjb-p6::kp-grammar-002",
    "unit-english-7-up-rjb-p6::kp-phonetic-001",
    "unit-english-7-up-rjb-p6::kp-reading-001",
    "unit-english-7-up-rjb-p6::kp-writing-001",
    "unit-english-7-up-rjb-p7::kp-word-001",
    "unit-english-7-up-rjb-p7::kp-sentence-001",
    "unit-english-7-up-rjb-p7::kp-grammar-001",
    "unit-english-7-up-rjb-p7::kp-grammar-002",
    "unit-english-7-up-rjb-p7::kp-phonetic-001",
    "unit-english-7-up-rjb-p7::kp-reading-001",
    "unit-english-7-up-rjb-p7::kp-writing-001",
]


def extract_exercise_blocks(text):
    """容错提取：扫描文本，找出所有 { "id": "sprint-ex-xxx", ... } 的平衡括号块。"""
    blocks = []
    i = 0
    n = len(text)
    marker = '"id": "sprint-ex-'
    while i < n:
        idx = text.find(marker, i)
        if idx == -1:
            break
        # 向左找到最近的 '{'
        start = text.rfind('{', 0, idx)
        if start == -1:
            i = idx + 1
            continue
        # 从 start 开始做括号平衡扫描
        depth = 0
        end = -1
        in_string = False
        escape = False
        for j in range(start, n):
            ch = text[j]
            if in_string:
                if escape:
                    escape = False
                elif ch == '\\':
                    escape = True
                elif ch == '"':
                    in_string = False
            else:
                if ch == '"':
                    in_string = True
                elif ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        end = j
                        break
        if end == -1:
            i = idx + 1
            continue
        blocks.append(text[start:end + 1])
        i = end + 1
    return blocks


def fix_exercise(ex):
    """对单题做已知修正。"""
    ex_id = ex.get("id", "")
    # sprint-ex-043：analysis 中 Next -> next
    if ex_id == "sprint-ex-043":
        if "analysis" in ex:
            ex["analysis"] = ex["analysis"].replace("(2)Next", "(2)next")
    # sprint-ex-074：answer 和 analysis 中 Next -> next
    if ex_id == "sprint-ex-074":
        if "answer" in ex and isinstance(ex["answer"], str):
            ex["answer"] = ex["answer"].replace("Next", "next")
        if "analysis" in ex:
            ex["analysis"] = ex["analysis"].replace("(2)Next", "(2)next")
    return ex


def main():
    if not os.path.exists(INPUT_FILE):
        print(f"[错误] 找不到输入文件：{INPUT_FILE}")
        sys.exit(1)

    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        raw = f.read()

    print(f"[信息] 已读取 {INPUT_FILE}，共 {len(raw)} 字符")

    blocks = extract_exercise_blocks(raw)
    print(f"[信息] 容错提取到 {len(blocks)} 个题目块")

    exercises = []
    seen_ids = set()
    for b in blocks:
        try:
            ex = json.loads(b)
        except json.JSONDecodeError as e:
            print(f"[跳过] 无法解析的题目块：{e}")
            continue
        ex_id = ex.get("id", "")
        if ex_id in seen_ids:
            print(f"[跳过] 重复 ID：{ex_id}")
            continue
        seen_ids.add(ex_id)
        exercises.append(fix_exercise(ex))

    # 按 ID 数字排序
    exercises.sort(key=lambda x: int(re.search(r"(\d+)$", x.get("id", "sprint-ex-000")).group(1)))

    print(f"[信息] 有效题目数：{len(exercises)}")
    if exercises:
        print(f"[信息] 首题：{exercises[0]['id']}  末题：{exercises[-1]['id']}")

    # 组装最终结构
    final = {
        "knowledgePoints": [],
        "exercises": [],
        "units": [
            {
                "id": "sprint-u1",
                "name": "期末冲刺",
                "title": "七年级上册期末模拟卷（太原平民中学适用）",
                "desc": "覆盖人教版2024新教材七年级上册全册重点的综合训练，难度适中偏上，含基础巩固、提高变式与挑战拔高题。",
                "topics": [
                    {
                        "id": "sprint-t1",
                        "title": "综合应用",
                        "knowledgePointIds": KP_IDS,
                        "modules": [],
                        "exercises": exercises,
                    }
                ],
            }
        ],
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(final, f, ensure_ascii=False, indent=2)

    print(f"[完成] 已生成 {OUTPUT_FILE}")
    print(f"[完成] 知识点数：{len(KP_IDS)}，题目数：{len(exercises)}")


if __name__ == "__main__":
    main()