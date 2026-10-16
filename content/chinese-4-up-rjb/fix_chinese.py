# -*- coding: utf-8 -*-
"""
语文学习包修正脚本
将 8 个单元包 + 1 个 term 包改为与英语包一致的结构
"""
import json
import os
import shutil

BASE = r"D:\study\content\chinese-4-up-rjb"
BACKUP = BASE + ".bak"

# 备份一次
if not os.path.exists(BACKUP):
    shutil.copytree(BASE, BACKUP)
    print(f"[备份] {BACKUP}")


def fix_manifest(data):
    m = data.get("manifest", {})
    # 规则 1：packageType -> type
    if "packageType" in m:
        m["type"] = m.pop("packageType")
    # 单元包追加 isInternal
    if m.get("type") == "unit" and "isInternal" not in m:
        m["isInternal"] = True
    data["manifest"] = m
    return data


def fix_options(options):
    """规则 3：dict 数组 -> 字符串数组"""
    if not isinstance(options, list) or not options:
        return options
    if isinstance(options[0], dict):
        return [f"{o.get('key', '')}. {o.get('text', '')}" for o in options]
    return options


def fix_exercise(ex):
    """规则 2 + 3：单题字段重命名"""
    # stem -> question
    if "stem" in ex and "question" not in ex:
        ex["question"] = ex.pop("stem")
    # knowledgePoints -> knowledgePointIds
    if "knowledgePoints" in ex and "knowledgePointIds" not in ex:
        ex["knowledgePointIds"] = ex.pop("knowledgePoints")
    # options 格式
    if "options" in ex:
        ex["options"] = fix_options(ex["options"])
    return ex


def fix_module(mod):
    """规则 5"""
    if "knowledgePoints" in mod and "knowledgePointIds" not in mod:
        mod["knowledgePointIds"] = mod.pop("knowledgePoints")
    return mod


def fix_topic(topic):
    """规则 6 + 5"""
    if "knowledgePoints" in topic and "knowledgePointIds" not in topic:
        topic["knowledgePointIds"] = topic.pop("knowledgePoints")
    for m in topic.get("modules", []):
        fix_module(m)
    return topic


def fix_unit(unit):
    """规则 4：迁移 exercises 到第一个 topic"""
    # 先修 topic/module
    topics = unit.get("topics", [])
    for t in topics:
        fix_topic(t)

    # 取 unit 级 exercises
    unit_ex = unit.pop("exercises", [])
    for ex in unit_ex:
        fix_exercise(ex)

    # 迁移到第一个 topic
    if topics and unit_ex:
        first = topics[0]
        existing = first.get("exercises", [])
        first["exercises"] = existing + unit_ex

    return unit


def process_file(path):
    fname = os.path.basename(path)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    fix_manifest(data)

    # term 包没有 topics，跳过 exercises 迁移
    mtype = data.get("manifest", {}).get("type")
    if mtype == "term":
        print(f"[跳过迁移] {fname}  (term 包，仅修 manifest)")
    else:
        for unit in data.get("units", []):
            fix_unit(unit)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"[已修复] {fname}")


for fname in sorted(os.listdir(BASE)):
    if not fname.endswith(".json") or fname == "_set.json":
        continue
    process_file(os.path.join(BASE, fname))

print("\n全部完成，请重新打包。")