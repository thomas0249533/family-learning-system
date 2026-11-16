#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「四上语文 · 词语表默写（新版 · 按课次）」学习包。

数据源：source/words.tsv（课 / 词 / 拼音 / 旧包音频路径），由《语文》四年级上册（新版）
词语表第 127-129 页逐字录入，共 220 词，与末页「共220个词」一致。

结构决策（有实测依据，勿随意改）：
- **课次 = unit**，不是 topic。`ChineseWords.vue:11` 的「词语表」下拉条件是 `units.length > 1`；
  更硬的一条是 `ChineseWords.vue:91-96` 的 selectedKpIds 优先取 `deriveUnitKnowledgePointIds(unit)`，
  若课次做成 topic（全包 1 个 unit），进任何一课都会拿到整包 220 词。
- 每个 unit 一个 topic（看拼音写词语），与旧包 `special-chinese-4-up-vocab` 的 units/topics 形状同构。
- ID 加 `v2` 前缀，和旧包 `kp-cn4-u1-w01` 在字符串层就不可能混淆（进度归属规范化靠 id 推断）。

重跑安全：本脚本幂等，改词只改 source/words.tsv，改完重跑即可。
"""
import json
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(HERE, 'source', 'words.tsv')
OLD_PKG = os.path.join(REPO, 'content', 'chinese-4-up-rjb',
                       'special-chinese-4-up-vocab.json')
PKG_ID = 'special-chinese-4-up-vocab-2026'
PKG_FILE = os.path.join(HERE, 'special-chinese-4-up-vocab-2026.json')
ASSETS = os.path.join(HERE, 'assets')
# 内容版本：改内容必须升（content-dist 的更新比对只认 version）
VERSION = '1.0.0'

CN_NUM = {1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六',
          7: '七', 8: '八', 9: '九', 10: '十'}


def load_rows():
    rows = []
    with open(SRC, encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if not line.strip() or line.startswith('#'):
                continue
            parts = line.split('\t')
            if len(parts) < 3:
                raise SystemExit(f'源表行格式错误（应为 课\\t词\\t拼音[\\t音频]）：{line}')
            lesson, word, pinyin = parts[0], parts[1], parts[2]
            audio = parts[3] if len(parts) > 3 else ''
            rows.append((lesson, word, pinyin, audio))
    return rows


def old_chunks():
    """旧包同词的部件拆分（可选增强，取不到就不写，chunksOf 会退回按单字拆）。"""
    out = {}
    if not os.path.exists(OLD_PKG):
        return out
    with open(OLD_PKG, encoding='utf-8') as f:
        d = json.load(f)
    for kp in d.get('knowledgePoints', []):
        md = kp.get('metadata') or {}
        w, ch = md.get('word') or kp.get('title'), md.get('chunks')
        if w and isinstance(ch, list) and len(ch) >= 2:
            out.setdefault(w, ch)
    return out


def main():
    rows = load_rows()
    chunks = old_chunks()

    # 按出现顺序分组（源表顺序 = 教材顺序）
    order, groups = [], {}
    for lesson, word, pinyin, audio in rows:
        if lesson not in groups:
            order.append(lesson)
            groups[lesson] = []
        groups[lesson].append((word, pinyin, audio))

    os.makedirs(ASSETS, exist_ok=True)
    units, kps = [], []
    copied = missing_audio = 0

    for idx, lesson in enumerate(order, 1):
        is_garden = lesson.startswith('Y')
        if is_garden:
            g_no = int(lesson[1:])
            unit_id = f'cn4v2-g{g_no:02d}'
            unit_name = f'语文园地{CN_NUM.get(g_no, g_no)}'
        else:
            unit_id = f'cn4v2-l{int(lesson):02d}'
            unit_name = f'第 {int(lesson)} 课'

        topic_kp_ids, exercises = [], []
        for n, (word, pinyin, audio_src) in enumerate(groups[lesson], 1):
            kp_id = f'kp-{unit_id}-w{n:02d}'
            ex_id = f'{unit_id}-w{n:02d}'
            md = {'word': word, 'pinyin': pinyin}
            if word in chunks:
                md['chunks'] = chunks[word]

            # 音频：旧包按 kp id 命名，这里复制并改成新 id
            if audio_src:
                src = os.path.join(REPO, 'content', 'chinese-4-up-rjb', audio_src)
                dst_name = f'{kp_id}.mp3'
                if os.path.exists(src):
                    shutil.copyfile(src, os.path.join(ASSETS, dst_name))
                    md['audio'] = f'assets/{dst_name}'
                    copied += 1
                else:
                    missing_audio += 1

            kps.append({'id': kp_id, 'type': 'word', 'title': word,
                        'content': word, 'metadata': md})
            topic_kp_ids.append(kp_id)
            exercises.append({
                'id': ex_id,
                'type': 'blank',
                'question': f'【看拼音写词语】{pinyin} → （　）',
                'answer': word,
                'explanation': f'{pinyin} → {word}',
                'knowledgePointIds': [kp_id],
                'metadata': {'difficulty': '基础', 'title': word},
            })

        # 课次号必须随包走：UnitList 的角标是 idx+1，而词语表的课次有断档（1,2,4,5,6,9…），
        # 直接用序号会让「第 4 课」显示成「第 3 课」。园地没有课次号，用 isGarden 标记。
        lesson_no = None if is_garden else int(lesson)

        units.append({
            'id': unit_id,
            'name': unit_name,
            'title': f'{unit_name} · {len(groups[lesson])} 个词语',
            'desc': f'{len(groups[lesson])} 个词语 · {len(exercises)} 题',
            **({'isGarden': True} if is_garden else {'lessonNo': lesson_no}),
            'topics': [{
                'id': f'{unit_id}-t1',
                'title': f'看拼音写词语（{len(groups[lesson])} 词）',
                'desc': unit_name,
                'board': '默写',
                'knowledgePointIds': topic_kp_ids,
                'modules': [{
                    'id': f'{unit_id}-m1',
                    'type': 'chinese.words',
                    'title': '本课词语表',
                    'knowledgePointIds': topic_kp_ids,
                }],
                'exercises': exercises,
            }],
        })

    pkg = {
        'manifest': {
            'schemaVersion': '1.0',
            'packageId': PKG_ID,
            'type': 'unit',
            'packageType': 'unit',
            'isInternal': False,
            'examMode': False,
            'subject': 'chinese',
            'templateId': 'chinese.primary.v1',
            'grade': 4,
            'term': 'up',
            'edition': '人教版',
            'title': '四上语文 · 词语表默写（新版 · 按课次）',
            'subtitle': f'{sum(1 for l in order if not l.startswith("Y"))} 课 + 4 个语文园地 · 共 {len(rows)} 词',
            'dependencies': [],
            'version': VERSION,
        },
        'knowledgePoints': kps,
        'units': units,
    }
    with open(PKG_FILE, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(pkg, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print(f'包已生成：{os.path.basename(PKG_FILE)}')
    print(f'  units={len(units)}  kp={len(kps)}  题={sum(len(u["topics"][0]["exercises"]) for u in units)}')
    print(f'  音频复制={copied}  缺音频={missing_audio}')


if __name__ == '__main__':
    main()
