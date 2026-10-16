# -*- coding: utf-8 -*-
"""
修复英语包字段，使其与单元包字段格式一致：
- stem -> question
- analysis -> explanation
- 顶层 difficulty 保留（App 兼容）
- phonetic 模块改成 vocab
"""
import json
import os

BASE = r"D:\study\content\english-7-up-rjb"


def fix_exercise(ex):
    """统一题目字段"""
    # stem -> question
    if "stem" in ex and "question" not in ex:
        ex["question"] = ex.pop("stem")
    # analysis -> explanation
    if "analysis" in ex and "explanation" not in ex:
        ex["explanation"] = ex.pop("analysis")
    return ex


def fix_module(mod):
    """把不支持的模块类型改成支持的类型"""
    if mod.get("type") == "english.phonetic":
        mod["type"] = "english.vocab"
        if "title" in mod:
            mod["title"] = mod["title"].replace("发音", "词汇").replace("语音", "词汇")
    return mod


def process_file(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    changed = False

    # 修复题目字段（含 units[].topics[].exercises 和顶层 exercises）
    def walk_exercises(obj):
        nonlocal changed
        if isinstance(obj, dict):
            if "id" in obj and ("type" in obj) and ("options" in obj or "answer" in obj):
                before = dict(obj)
                fix_exercise(obj)
                if before != obj:
                    changed = True
            for v in obj.values():
                walk_exercises(v)
        elif isinstance(obj, list):
            for x in obj:
                walk_exercises(x)

    walk_exercises(data)

    # 修复模块类型
    def walk_modules(obj):
        nonlocal changed
        if isinstance(obj, dict):
            if obj.get("type") == "english.phonetic":
                fix_module(obj)
                changed = True
            for v in obj.values():
                walk_modules(v)
        elif isinstance(obj, list):
            for x in obj:
                walk_modules(x)

    walk_modules(data)

    if changed:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"[已修] {os.path.basename(path)}")
    else:
        print(f"[跳过] {os.path.basename(path)}")


for fname in sorted(os.listdir(BASE)):
    if not fname.endswith(".json") or fname == "_set.json":
        continue
    process_file(os.path.join(BASE, fname))

print("\n全部完成。")