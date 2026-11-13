#!/usr/bin/env python3
"""生成《KET 58 天打卡 · PU3 单词与句型》学习包。

数据源（本目录 source/，可审计、可重跑）：
  words.tsv     Day  Word  Meaning     —— 618+ 条，来自《KET学习规划表（PU3+PU4＋冲刺）.pdf》Day 1-58
  patterns.tsv  Day  Pattern  Meaning —— 88 条句型，已剔除 PDF 里的中文教学说明

产物：
  daily-english-ket-pu3.json   （包体）
  _set.json                    （包集合，供 validate:set / build:lpkgset）

用法：python content/ket-pu3-58d/build.py
"""
from __future__ import annotations

import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source')
PKG_ID = 'daily-english-ket-pu3'
# 内容版本：每次改内容必须升（content-dist 目录比对只认它）
VERSION = '1.0.1'

# 天 → (单元, 课本页码)。页码取 PDF 每天表格里的「学生书 Unit N – page X」，已核过：
# 表内残值（`16-`、Day44 错行 76-77）按单元页序修正；复习日无新增页，留空。
DAY_META = {
    1: ('0', '4-5'),
    2: ('1', '6-7'), 3: ('1', '8-9'), 4: ('1', '10-11'), 5: ('1', '12-13'),
    6: ('1', '14-15'), 7: ('1', '16-17'),
    8: ('2', '18-19'), 9: ('2', '20-21'), 10: ('2', '22-23'), 11: ('2', '24-25'),
    12: ('2', '26-27'), 13: ('2', '28-29'),
    14: ('3', '30-31'), 15: ('3', '32-33'), 16: ('3', '34-35'), 17: ('3', '36-37'),
    18: ('3', '38-39'), 19: ('3', '40-41'), 20: ('3', ''),
    21: ('4', '44-45'), 22: ('4', '46-47'), 23: ('4', '48-49'), 24: ('4', '50-51'),
    25: ('4', '52-53'), 26: ('4', '54-55'),
    27: ('5', '56-57'), 28: ('5', '58-59'), 29: ('5', '60-61'), 30: ('5', '62-63'),
    31: ('5', '64-65'), 32: ('5', '66-67'),
    33: ('6', '68-69'), 34: ('6', '70-71'), 35: ('6', '72-73'), 36: ('6', '74-75'),
    37: ('6', '76-77'), 38: ('6', '78-79'), 39: ('6', ''),
    40: ('7', '82-83'), 41: ('7', '84-85'), 42: ('7', '86-87'), 43: ('7', '88-89'),
    44: ('7', '90-91'),
    45: ('8', '92-93'), 46: ('8', '94-95'), 47: ('8', '96-97'), 48: ('8', '98-99'),
    49: ('8', '100-101'), 50: ('8', '102-103'), 51: ('8', '104-105'),
    52: ('9', '106-107'), 53: ('9', '108-109'), 54: ('9', '110-111'),
    55: ('9', '112-113'), 56: ('9', '114-115'), 57: ('9', '116-117'), 58: ('9', '118-119'),
}

# 复习日：没有新词，从紧邻的三个单元抽 10 个词做混听写（确定性抽样，不随机）
REVIEW_DAYS = {20: ['1', '2', '3'], 38: ['6'], 39: ['4', '5', '6'], 58: ['7', '8', '9']}

# 词条里带箭头/斜杠的，默写题要换问法，否则「答案」是整串符号
SPECIAL_WORDS = {
    'find → found': ('【动词变形】写出 find 的过去式', 'found'),
    'leave → left': ('【动词变形】写出 leave 的过去式', 'left'),
    'fly / flies': ('【词形变化】写出 fly 的第三人称单数', 'flies'),
}


def read_tsv(name: str):
    path = os.path.join(SRC, name)
    rows = []
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.rstrip('\n')
            if not line.strip() or line.startswith('#'):
                continue
            rows.append(line.split('\t'))
    return rows


def load():
    words, patterns = {}, {}
    for day, word, meaning in read_tsv('words.tsv'):
        words.setdefault(int(day), []).append((word, meaning))
    for day, en, zh in read_tsv('patterns.tsv'):
        patterns.setdefault(int(day), []).append((en, zh))
    return words, patterns


def build():
    words, patterns = load()
    kps, units = [], []
    all_pattern_zh = [zh for v in patterns.values() for _, zh in v]

    for day in range(1, 59):
        unit_no, pages = DAY_META[day]
        dtag = f'd{day:02d}'
        uid = f'ket-{dtag}'
        day_words = words.get(day, [])
        day_pats = patterns.get(day, [])

        # ---- 知识点：单词 ----
        day_kps = []
        for i, (word, meaning) in enumerate(day_words, 1):
            kid = f'kp-{dtag}-w{i:02d}'
            kps.append({
                'id': kid,
                'type': 'word',
                'title': word,
                'content': meaning,
                'metadata': {'word': word, 'meaning': meaning},
            })
            day_kps.append(kid)

        # ---- 知识点：句型 ----
        pat_kps = []
        for i, (en, zh) in enumerate(day_pats, 1):
            kid = f'kp-{dtag}-p{i:02d}'
            kps.append({
                'id': kid,
                'type': 'grammar',
                'title': en,
                'content': zh,
                'metadata': {'pattern': en, 'meaning': zh},
            })
            pat_kps.append(kid)

        topics = []

        # ---- 板块一：单词默写 ----
        if day_words:
            exs = []
            for i, (word, meaning) in enumerate(day_words, 1):
                kid = f'kp-{dtag}-w{i:02d}'
                if word in SPECIAL_WORDS:
                    stem, answer = SPECIAL_WORDS[word]
                    stem = f'{stem} → （　）'
                else:
                    stem = f'【单词默写】{meaning} → （　）'
                    answer = word
                exs.append({
                    'id': f'{dtag}-w{i:02d}',
                    'type': 'blank',
                    'question': stem,
                    'answer': answer,
                    'explanation': f'{meaning} → {word}',
                    'knowledgePointIds': [kid],
                    'metadata': {'difficulty': '基础', 'title': word},
                })
            topics.append({
                'id': f'{uid}-t1',
                'title': f'单词默写（{len(day_words)} 个）',
                'desc': '看中文写英文，写完对照订正',
                'board': '单词',
                'knowledgePointIds': day_kps,
                'modules': [{
                    'id': f'{uid}-t1-m1',
                    'type': 'english.vocab',
                    'title': '词汇',
                    'knowledgePointIds': day_kps,
                }],
                'exercises': exs,
            })

        # ---- 板块二：句型 ----
        if day_pats:
            exs = []
            for i, (en, zh) in enumerate(day_pats, 1):
                kid = f'kp-{dtag}-p{i:02d}'
                eid = f'{dtag}-p{i:02d}'
                if '...' in en or '/' in en:
                    # 带省略号/斜杠的是「句型模板」，照抄一遍没有意义（斜杠还会被判分内核
                    # 当作备选答案），所以改成「选出它的意思」
                    pool = [z for _, z in day_pats if z != zh]
                    pool += [z for z in all_pattern_zh if z != zh and z not in pool]
                    distract = pool[:3]
                    while len(distract) < 3:  # 极端兜底，正常不会走到
                        distract.append(f'（干扰项 {len(distract) + 1}）')
                    opts = [zh] + distract
                    pos = i % 4                     # 正确答案位置随题号轮换
                    opts.insert(pos, opts.pop(0))
                    letters = ['A', 'B', 'C', 'D']
                    exs.append({
                        'id': eid,
                        'type': 'single',
                        'question': f'句型「{en}」的意思是（　）',
                        'options': [f'{letters[j]}. {o}' for j, o in enumerate(opts)],
                        'answer': letters[pos],
                        'explanation': f'{en} —— {zh}',
                        'knowledgePointIds': [kid],
                        'metadata': {'difficulty': '进阶', 'title': en},
                    })
                else:
                    exs.append({
                        'id': eid,
                        'type': 'blank',
                        'question': f'【句型翻译】{zh} → （　）',
                        'answer': en,
                        'explanation': f'{zh} → {en}',
                        'knowledgePointIds': [kid],
                        'metadata': {'difficulty': '进阶', 'title': en},
                    })
            topics.append({
                'id': f'{uid}-t2',
                'title': f'句型（{len(day_pats)} 个）',
                'desc': '先读会，再做题',
                'board': '句型',
                'knowledgePointIds': pat_kps,
                'modules': [{
                    'id': f'{uid}-t2-m1',
                    'type': 'english.grammar',
                    'title': '句型',
                    'knowledgePointIds': pat_kps,
                }],
                'exercises': exs,
            })

        # ---- 板块三：复习日混听写 ----
        if day in REVIEW_DAYS:
            pool = []
            for u in REVIEW_DAYS[day]:
                pool += [(d, w, m) for d, v in words.items()
                         if DAY_META[d][0] == u for w, m in v]
            step = max(1, len(pool) // 10)
            picked = pool[::step][:10]
            exs, kids = [], []
            for i, (d, word, meaning) in enumerate(picked, 1):
                kid = f'kp-{dtag}-r{i:02d}'
                kps.append({
                    'id': kid,
                    'type': 'word',
                    'title': word,
                    'content': meaning,
                    'metadata': {'word': word, 'meaning': meaning, 'fromDay': d},
                })
                kids.append(kid)
                exs.append({
                    'id': f'{dtag}-r{i:02d}',
                    'type': 'blank',
                    'question': f'【复习听写】{meaning} → （　）',
                    'answer': word,
                    'explanation': f'{meaning} → {word}（Day {d}）',
                    'knowledgePointIds': [kid],
                    'metadata': {'difficulty': '基础', 'title': word},
                })
            topics.append({
                'id': f'{uid}-t3',
                'title': f'复习听写（{len(exs)} 个）',
                'desc': '从前几个单元里抽的词，混着听写',
                'board': '复习',
                'knowledgePointIds': kids,
                'modules': [{
                    'id': f'{uid}-t3-m1',
                    'type': 'english.vocab',
                    'title': '复习词汇',
                    'knowledgePointIds': kids,
                }],
                'exercises': exs,
            })

        if not topics:
            raise SystemExit(f'Day {day} 没有任何板块，检查 source/')

        unit_disp = 'Unit 0（Hello）' if unit_no == '0' else f'Unit {unit_no}'
        title = f'Day {day} · {unit_disp}'
        if pages:
            title += f'（P{pages}）'
        else:
            title += '（复习）'
        bits = []
        if day_words:
            bits.append(f'{len(day_words)} 个单词')
        if day_pats:
            bits.append(f'{len(day_pats)} 个句型')
        desc = ' · '.join(bits) if bits else '复习日'

        units.append({
            'id': uid,
            'name': f'Day {day}',
            'title': title,
            'desc': desc,
            'knowledgePointIds': day_kps + pat_kps,
            'topics': topics,
        })

    pkg = {
        'manifest': {
            'schemaVersion': '1.0',
            'packageId': PKG_ID,
            'type': 'daily',
            'packageType': 'daily',
            'isInternal': False,
            'examMode': False,
            'subject': 'english',
            'templateId': 'english.primary.v1',
            'grade': 5,
            'term': 'up',
            'edition': '剑桥 Power Up Level 3',
            'title': 'KET 58 天打卡 · PU3 单词与句型',
            'subtitle': '按《KET学习规划表》Day 1-58 逐日整理：每天一组单词 + 一组句型',
            'author': '家庭学习系统',
            'language': 'en',
            'dependencies': [],
            'version': VERSION,
        },
        'knowledgePoints': kps,
        'units': units,
    }
    return pkg


def main():
    pkg = build()
    out = os.path.join(HERE, f'{PKG_ID}.json')
    with open(out, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(pkg, fh, ensure_ascii=False, indent=1)
        fh.write('\n')

    n_words = sum(1 for k in pkg['knowledgePoints'] if k['type'] == 'word')
    n_pats = sum(1 for k in pkg['knowledgePoints'] if k['type'] == 'grammar')
    n_ex = sum(len(t['exercises']) for u in pkg['units'] for t in u['topics'])
    print(f'✓ {os.path.basename(out)}')
    print(f'  {len(pkg["units"])} 天 · {n_words} 个单词 · {n_pats} 个句型 · {n_ex} 道题')

    set_cfg = {
        'setId': 'ket-pu3-58d-set',
        'title': 'KET 备考 · PU3 58 天打卡（单词 + 句型）',
        'subject': 'english',
        'grade': 5,
        'term': 'up',
        'edition': '剑桥 Power Up Level 3',
        'importOrder': [PKG_ID],
        'packages': [{
            'file': f'{PKG_ID}.json',
            'packageId': PKG_ID,
            'type': 'daily',
            'visible': True,
            'examMode': False,
            'dependencies': [],
        }],
    }
    with open(os.path.join(HERE, '_set.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(set_cfg, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print('✓ _set.json')


if __name__ == '__main__':
    main()
