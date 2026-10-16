# -*- coding: utf-8 -*-
"""
按数学包的 manifest 结构，为英语包生成完整 manifest
"""
import json
import os

BASE = r"D:\study\content\english-7-up-rjb"

SUBJECT = "english"
GRADE = 7
TERM = "up"
EDITION = "人教版（2024新教材）"

with open(os.path.join(BASE, "_set.json"), "r", encoding="utf-8") as f:
    set_data = json.load(f)

pkg_map = {p["packageId"]: p for p in set_data.get("packages", [])}

for fname in sorted(os.listdir(BASE)):
    if not fname.endswith(".json") or fname == "_set.json":
        continue

    path = os.path.join(BASE, fname)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    package_id = fname[:-5]
    pkg = pkg_map.get(package_id, {})

    if "sprint" in package_id:
        pkg_type = "sprint"
    elif "special" in package_id:
        pkg_type = "special"
    elif "term" in package_id:
        pkg_type = "term"
    else:
        pkg_type = "unit"

    title = ""
    units = data.get("units", [])
    if units:
        title = units[0].get("title", "")
    if not title:
        title = pkg.get("title", package_id)

    # 构造 manifest
    manifest = {
        "packageId": package_id,
        "type": pkg_type,
        "title": title,
    }

    if pkg_type in ("unit", "term"):
        manifest["version"] = "1.0.0"

    manifest["dependencies"] = pkg.get("dependencies", [])
    manifest["schemaVersion"] = "1.0"
    manifest["subject"] = SUBJECT
    manifest["grade"] = GRADE
    manifest["term"] = TERM
    manifest["edition"] = EDITION

    if pkg_type == "unit":
        manifest["isInternal"] = True
    elif pkg_type in ("special", "sprint"):
        manifest["examMode"] = True
        source = pkg.get("sourceUnitIds", [])
        if source:
            manifest["sourceUnitIds"] = source

    data.pop("manifest", None)
    new_data = {"manifest": manifest}
    new_data.update(data)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(new_data, f, ensure_ascii=False, indent=2)

    print(f"[已加] {fname}  type={pkg_type}  version={'有' if 'version' in manifest else '无'}  title={title}")

print("\n全部完成，请重新打包。")