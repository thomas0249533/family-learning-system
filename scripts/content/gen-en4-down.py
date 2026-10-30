#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
四年级下册英语（人教 PEP）· 词汇默写 + 句型 + 语法 + 拔高

## 与四上词汇包（special-english-4-up-vocab）结构逐字对齐
单元 = 一个 PEP Unit；每个单元两个 topic（`单词默写` / `常用句型`），
每个单词是一个 `type: "word"` 的知识点，题目的 `id` 直接沿用知识点 id ——
这样「词汇背记」（VocabDrill）拿 kp 列表就能同时当"词表"和"题源"用。
最后两个单元是 `语法专项` 与 `拔高`，延续四上包的结构。

## 为什么 `examMode: false`
这是**背记包**，不是考试包。开着考试模式就没有逐题反馈，孩子写错了不知道错在哪；
而且 ExamPanel 不渲染 `topic.modules`，词汇卡片会整块消失（V2.12.x 踩过）。

## 答案的边界
单词、句型都取自 PEP 四下教材的单元词表与核心句型；填空只挖**一个词**，
避免"一题多解"在精确匹配下被判错。答案里的撇号一律用英文半角 `'`。

用法：python scripts/content/gen-en4-down.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PKG_ID = "special-english-4-down-vocab"
CONTENT_DIR = ROOT / "content" / "english-4-down-vocab"
OUT_JSON = CONTENT_DIR / f"{PKG_ID}.json"
SET_ID = "english-4-down-vocab-set"

# ---------------------------------------------------------------------------
# 词表：(英文, 中文)  —— 取自 PEP 四下各单元词表，按单元归组
# ---------------------------------------------------------------------------
UNITS = [
    {
        "id": "en4d-u1",
        "name": "Unit 1",
        "title": "Unit 1 · My school",
        "desc": "学校场所与楼层，会用 Is this…? / Where is…? 问位置。",
        "words": [
            ("first floor", "一楼"),
            ("second floor", "二楼"),
            ("teachers' office", "教师办公室"),
            ("library", "图书馆"),
            ("playground", "操场"),
            ("garden", "花园"),
            ("art room", "美术室"),
            ("computer room", "计算机房"),
            ("music room", "音乐室"),
            ("gym", "体育馆"),
            ("next to", "在……旁边"),
            ("homework", "作业"),
            ("class", "班级；课"),
            ("forty", "四十"),
        ],
        "patterns": [
            ("图书馆在二楼。", "The library is on the ____ floor.", "second"),
            ("让我们去操场吧。", "Let's go to the ____ .", "playground"),
            ("美术室在音乐室旁边。", "The art room is ____ to the music room.", "next"),
            ("你的作业做完了吗？", "Did you finish your ____ ?", "homework"),
            ("我们班有四十名学生。", "There are ____ students in our class.", "forty"),
        ],
    },
    {
        "id": "en4d-u2",
        "name": "Unit 2",
        "title": "Unit 2 · What time is it?",
        "desc": "时间与日常作息，会用 What time is it? / It's time for… 表达。",
        "words": [
            ("breakfast", "早餐"),
            ("lunch", "午餐"),
            ("dinner", "晚餐"),
            ("English class", "英语课"),
            ("music class", "音乐课"),
            ("PE class", "体育课"),
            ("get up", "起床"),
            ("go to school", "去上学"),
            ("go home", "回家"),
            ("go to bed", "上床睡觉"),
            ("o'clock", "……点钟"),
            ("time", "时间"),
            ("kid", "小孩"),
            ("hurry", "赶快"),
            ("now", "现在"),
        ],
        "patterns": [
            ("现在几点了？", "What ____ is it now?", "time"),
            ("该吃早饭了。", "It's time for ____ .", "breakfast"),
            ("我六点起床。", "I ____ up at six o'clock.", "get"),
            ("我们七点去上学。", "We go to ____ at seven o'clock.", "school"),
            ("该上床睡觉了。", "It's time to go to ____ .", "bed"),
        ],
    },
    {
        "id": "en4d-u3",
        "name": "Unit 3",
        "title": "Unit 3 · Weather",
        "desc": "天气与温度，会用 What's the weather like…? 询问天气。",
        "words": [
            ("cold", "寒冷的"),
            ("cool", "凉爽的"),
            ("warm", "温暖的"),
            ("hot", "炎热的"),
            ("sunny", "晴朗的"),
            ("windy", "有风的"),
            ("cloudy", "多云的"),
            ("snowy", "下雪的"),
            ("rainy", "下雨的"),
            ("weather", "天气"),
            ("degree", "度；度数"),
            ("outside", "在外面"),
        ],
        "patterns": [
            ("今天北京天气怎么样？", "What's the ____ like in Beijing?", "weather"),
            ("今天是雨天。", "It's ____ today.", "rainy"),
            ("外面很冷。", "It's cold ____ .", "outside"),
            ("今天有风。", "It's ____ today.", "windy"),
            ("现在 26 度。", "It's 26 ____ now.", "degrees"),
        ],
    },
    {
        "id": "en4d-u4",
        "name": "Unit 4",
        "title": "Unit 4 · At the farm",
        "desc": "农场动物与蔬菜，会用 these/those 与 Are these…? 提问。",
        "words": [
            ("tomato", "西红柿"),
            ("potato", "土豆"),
            ("green beans", "青豆"),
            ("carrot", "胡萝卜"),
            ("horse", "马"),
            ("cow", "奶牛"),
            ("sheep", "绵羊"),
            ("hen", "母鸡"),
            ("farm", "农场"),
            ("these", "这些"),
            ("those", "那些"),
            ("yellow", "黄色的"),
        ],
        "patterns": [
            ("这些是什么？", "What are ____ ? They're tomatoes.", "these"),
            ("那些是马吗？", "Are ____ horses? No, they aren't.", "those"),
            ("农场上有十只母鸡。", "There are ten ____ on the farm.", "hens"),
            ("我喜欢胡萝卜。", "I like ____ .", "carrots"),
            ("看那些奶牛。", "Look at those ____ .", "cows"),
        ],
    },
    {
        "id": "en4d-u5",
        "name": "Unit 5",
        "title": "Unit 5 · My clothes",
        "desc": "衣物与所属，会用 Whose…is this? / It's mine. 表达归属。",
        "words": [
            ("clothes", "衣服"),
            ("pants", "裤子"),
            ("socks", "袜子"),
            ("shoes", "鞋"),
            ("jacket", "夹克衫"),
            ("shirt", "衬衫"),
            ("skirt", "短裙"),
            ("dress", "连衣裙"),
            ("sweater", "毛衣"),
            ("hat", "帽子"),
            ("whose", "谁的"),
            ("mine", "我的"),
            ("yours", "你的"),
            ("colourful", "色彩丰富的"),
            ("pretty", "漂亮的"),
        ],
        "patterns": [
            ("这是谁的短裙？", "____ skirt is this?", "Whose"),
            ("这是我的。", "It's ____ .", "mine"),
            ("这些是我的裤子。", "These are my ____ .", "pants"),
            ("那件连衣裙很漂亮。", "That ____ is very pretty.", "dress"),
            ("你的袜子在哪里？", "Where are your ____ ?", "socks"),
        ],
    },
    {
        "id": "en4d-u6",
        "name": "Unit 6",
        "title": "Unit 6 · Shopping",
        "desc": "购物与价格，会用 How much…? / Can I help you? 交流。",
        "words": [
            ("gloves", "手套"),
            ("scarf", "围巾"),
            ("umbrella", "雨伞"),
            ("sunglasses", "太阳镜"),
            ("big", "大的"),
            ("small", "小的"),
            ("expensive", "昂贵的"),
            ("cheap", "便宜的"),
            ("nice", "好的；漂亮的"),
            ("size", "尺码"),
            ("eighty", "八十"),
            ("dollar", "美元"),
        ],
        "patterns": [
            ("这条短裙多少钱？", "____ much is this skirt?", "How"),
            ("太贵了。", "They're too ____ .", "expensive"),
            ("我可以试穿吗？", "Can I ____ them on?", "try"),
            ("你想要什么尺码？", "What ____ do you want?", "size"),
            ("这双手套很便宜。", "These ____ are very cheap.", "gloves"),
        ],
    },
]


# ---------------------------------------------------------------------------
# 语法专项（第 7 单元）：四下核心语法点，单点挖空，判分无歧义
# ---------------------------------------------------------------------------
GRAMMAR = {
    "id": "en4d-grammar",
    "name": "语法专项",
    "title": "语法专项 · be 动词、单复数与疑问句",
    "desc": "把四下最常错的语法点单独练一遍：be 动词搭配、名词复数、一般疑问句。",
    "topics": [
        {
            "t": "en4d-g-t1",
            "title": "语法专项（6 题）",
            "board": "语法",
            "kp": ("kp-en4d-g01", "be 动词与人称搭配", "I 用 am；he / she / it 和单数名词用 is；you / we / they 和复数名词用 are。"),
            "qs": [
                ("【be 动词】我是一名学生。", "I ____ a student.", "am", "I 后面用 am：I am a student."),
                ("【be 动词】她是我的老师。", "She ____ my teacher.", "is", "she 是第三人称单数，用 is。"),
                ("【be 动词】他们是我的朋友。", "They ____ my friends.", "are", "they 是复数，用 are。"),
                ("【指示代词】这些是我的书。", "____ are my books.", "These", "指近处的复数用 These，句首大写。"),
                ("【名词复数】一个西红柿，两个西红柿", "one tomato, two ____", "tomatoes", "以 o 结尾的 tomato 变复数加 -es。"),
                ("【一般疑问句】这是你的钢笔吗？", "____ this your pen?", "Is", "含 be 动词的句子变一般疑问句，把 is 提到句首。"),
            ],
        },
    ],
}


# ---------------------------------------------------------------------------
# 拔高（第 8 单元）：正误形式唯一，避免精确匹配误判
# ---------------------------------------------------------------------------
ADVANCED = {
    "id": "en4d-advanced",
    "name": "拔高 · 句型转换与阅读",
    "title": "拔高 · 句型转换与阅读理解",
    "desc": "四下内容的提高档：句型转换、情景应答、短文阅读。答案唯一，不做开放题。",
    "topics": [
        {
            "t": "en4d-a-t1",
            "title": "句型转换（4 题）",
            "board": "拔高",
            "kp": ("kp-en4d-a01", "句型转换：一般疑问句与单复数互换",
                   "含 be 动词的句子变一般疑问句：把 am / is / are 提到句首，第一人称 my 要改成第二人称 your。\n"
                   "复数句变单数句：these / those → this / that，are → is，名词去 -s，并补上冠词 a / an。"),
            "qs_choice": [
                ("【句型转换】This is my skirt.（改为一般疑问句）",
                 ["A. Is this your skirt?", "B. This is your skirt?", "C. Is this my skirt?", "D. Are these your skirts?"],
                 "A",
                 "把 is 提到句首；问别人时 my 要改成 your，所以是 Is this your skirt?"),
                ("【句型转换】These are tomatoes.（改为单数句）",
                 ["A. This is a tomato.", "B. This is tomato.", "C. These is a tomato.", "D. That are tomatoes."],
                 "A",
                 "these → this，are → is，tomatoes 去 -es 并补冠词：This is a tomato."),
                ("【句型转换】They're cows.（改为一般疑问句）",
                 ["A. Are they cows?", "B. They are cows?", "C. Is they cows?", "D. Do they cows?"],
                 "A",
                 "含 be 动词的句子，把 are 提到 they 前面即可。"),
                ("【情景应答】别人问 How much is it? 你应该回答：",
                 ["A. It's 20 yuan.", "B. They're 20 yuan.", "C. Yes, it is.", "D. It's on the desk."],
                 "A",
                 "问的是 it（单数），所以答语也用 it；金额用 It's … yuan 表达。"),
            ],
        },
        {
            "t": "en4d-a-t2",
            "title": "短文阅读（4 题）",
            "board": "拔高",
            "kp": ("kp-en4d-a02", "短文阅读：先在文中找关键词",
                   "做阅读题不要凭印象：先读题干圈出关键词（地点、数量、爱好），再回短文里找同一句话。\n"
                   "注意 on the second floor（在二楼）与 forty（四十）这类数字、楼层信息，是四年级最常考的两类细节。"),
            "qs_read": [
                ("Hello! I'm Amy. I'm from the UK. This is my school. It's big and beautiful. "
                 "The library is on the second floor. There are forty classrooms in my school. "
                 "I like the playground best. After school, I often play games there with my friends."),
                ("【阅读】Where is the library?",
                 ["A. On the first floor.", "B. On the second floor.", "C. In the classroom.", "D. On the playground."],
                 "B",
                 "短文原句：The library is on the second floor."),
                ("【阅读】How many classrooms are there in Amy's school?",
                 ["A. Fourteen.", "B. Forty.", "C. Fifty.", "D. Thirty."],
                 "B",
                 "短文原句：There are forty classrooms in my school. 注意 forty（四十）与 fourteen（十四）别混。"),
                ("【阅读】Amy likes the ____ best.",
                 None, "playground",
                 "短文原句：I like the playground best."),
                ("【阅读】Amy often plays games ____ after school.",
                 ["A. in the library", "B. in the classroom", "C. on the playground", "D. in the gym"],
                 "C",
                 "短文说 I like the playground best. After school, I often play games there…，there 指的就是操场。"),
            ],
        },
    ],
}


def word_kp(kid, en, zh):
    return {
        "id": kid,
        "type": "word",
        "title": en,
        "content": zh,
        "metadata": {"word": en, "meaning": zh},
    }


def word_ex(kid, en, zh):
    return {
        "id": kid,
        "type": "blank",
        "question": f"【单词默写】{zh} → （　）",
        "answer": en,
        "explanation": f"{zh} → {en}",
        "knowledgePointIds": [kid],
        "metadata": {"difficulty": "基础", "title": en},
    }


def pattern_ex(eid, zh, sent, ans, kp_id):
    return {
        "id": eid,
        "type": "blank",
        "question": f"【句型】{zh}\n{sent}",
        "answer": ans,
        "explanation": f"{zh} →「{sent.replace('____', ans)}」",
        "knowledgePointIds": [kp_id],
        "metadata": {"difficulty": "进阶", "title": ans},
    }


def choice_ex(eid, question, options, ans, expl, kp_id, diff="提高"):
    return {
        "id": eid,
        "type": "single",
        "question": question,
        "options": options,
        "answer": ans,
        "explanation": expl,
        "knowledgePointIds": [kp_id],
        "metadata": {"difficulty": diff},
    }


def build():
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    kps: list[dict] = []
    units: list[dict] = []

    for u in UNITS:
        topics = []
        # --- topic 1：单词默写 ---
        w_ids = []
        w_ex = []
        for i, (en, zh) in enumerate(u["words"], start=1):
            kid = f"kp-{u['id']}-w{i:02d}"
            w_ids.append(kid)
            kps.append(word_kp(kid, en, zh))
            w_ex.append(word_ex(kid, en, zh))
        topics.append({
            "id": f"{u['id']}-t1",
            "title": f"单词默写（{len(u['words'])} 个）",
            "desc": u["desc"],
            "board": "单词",
            "knowledgePointIds": w_ids,
            "modules": [{
                "id": f"{u['id']}-m1",
                "type": "english.vocab",
                "title": f"{u['name']} 词汇",
                "knowledgePointIds": w_ids,
            }],
            "exercises": w_ex,
        })

        # --- topic 2：常用句型 ---
        pat_id = f"kp-{u['id']}-pat"
        kps.append({
            "id": pat_id,
            "type": "skill",
            "title": f"{u['name']} 常用句型",
            "content": "把句型读熟，再替换关键词造句。注意 be 动词要和主语一致（I 用 am，单数用 is，复数用 are）。",
            "prerequisites": [],
        })
        p_ex = [pattern_ex(f"{u['id']}-p{i:02d}", zh, sent, ans, pat_id)
                for i, (zh, sent, ans) in enumerate(u["patterns"], start=1)]
        topics.append({
            "id": f"{u['id']}-t2",
            "title": f"常用句型（{len(u['patterns'])} 题）",
            "desc": u["desc"],
            "board": "句型",
            "knowledgePointIds": [pat_id],
            "modules": [{
                "id": f"{u['id']}-m2",
                "type": "english.sentence",
                "title": f"{u['name']} 句型",
                "knowledgePointIds": [pat_id],
            }],
            "exercises": p_ex,
        })

        units.append({
            "id": u["id"],
            "name": u["name"],
            "title": u["title"],
            "desc": u["desc"],
            "topics": topics,
        })

    # --- 语法专项 ---
    g = GRAMMAR
    g_topics = []
    for t in g["topics"]:
        kid, title, content = t["kp"]
        kps.append({"id": kid, "type": "grammar", "title": title,
                    "content": content, "prerequisites": []})
        ex = [pattern_ex(f"{t['t']}-q{i:02d}", zh, sent, ans, kid)
              for i, (zh, sent, ans, _note) in enumerate(t["qs"], start=1)]
        # 语法题的解析要写"为什么"，不是简单复述
        for e, item in zip(ex, t["qs"]):
            e["explanation"] = item[3]
        g_topics.append({
            "id": t["t"],
            "title": t["title"],
            "board": t["board"],
            "knowledgePointIds": [kid],
            "modules": [{"id": f"{t['t']}-m1", "type": "english.grammar",
                         "title": title, "knowledgePointIds": [kid]}],
            "exercises": ex,
        })
    units.append({"id": g["id"], "name": g["name"], "title": g["title"],
                  "desc": g["desc"], "topics": g_topics})

    # --- 拔高 ---
    a = ADVANCED
    a_topics = []
    a_t1, a_t2 = a["topics"]
    k1, t1c = a_t1["kp"][0], a_t1["kp"][2]
    kps.append({"id": k1, "type": "grammar", "title": a_t1["kp"][1],
                "content": t1c, "prerequisites": []})
    a_topics.append({
        "id": a_t1["t"],
        "title": a_t1["title"],
        "board": a_t1["board"],
        "knowledgePointIds": [k1],
        "modules": [{"id": f"{a_t1['t']}-m1", "type": "english.grammar",
                     "title": a_t1["kp"][1], "knowledgePointIds": [k1]}],
        "exercises": [choice_ex(f"{a_t1['t']}-q{i:02d}", q, opts, ans, expl, k1)
                      for i, (q, opts, ans, expl) in enumerate(a_t1["qs_choice"], start=1)],
    })

    k2, t2c = a_t2["kp"][0], a_t2["kp"][2]
    kps.append({"id": k2, "type": "reading", "title": a_t2["kp"][1],
                "content": t2c, "prerequisites": []})
    passage, items = a_t2["qs_read"][0], a_t2["qs_read"][1:]
    read_ex = []
    for i, (q, opts, ans, expl) in enumerate(items, start=1):
        # 短文整段嵌进题干：单题渲染时也能独立读懂，不依赖上一题的上下文
        full_q = f"【短文】{passage}\n\n{q}"
        if opts is None:
            read_ex.append({
                "id": f"{a_t2['t']}-q{i:02d}",
                "type": "blank",
                "question": full_q,
                "answer": ans,
                "explanation": expl,
                "knowledgePointIds": [k2],
                "metadata": {"difficulty": "挑战"},
            })
        else:
            read_ex.append(choice_ex(f"{a_t2['t']}-q{i:02d}", full_q, opts, ans, expl,
                                     k2, diff="挑战"))
    a_topics.append({
        "id": a_t2["t"],
        "title": a_t2["title"],
        "board": a_t2["board"],
        "knowledgePointIds": [k2],
        "modules": [{"id": f"{a_t2['t']}-m1", "type": "english.reading",
                     "title": a_t2["kp"][1], "knowledgePointIds": [k2]}],
        "exercises": read_ex,
    })
    units.append({"id": a["id"], "name": a["name"], "title": a["title"],
                  "desc": a["desc"], "topics": a_topics})

    # --- 自检：题目引用的知识点必须存在；id 全局唯一 ---
    kp_ids = {k["id"] for k in kps}
    assert len(kp_ids) == len(kps), "知识点 id 有重复"
    all_ids = []
    for u in units:
        for t in u["topics"]:
            for kid in t["knowledgePointIds"]:
                assert kid in kp_ids, f"{t['id']} 引用了不存在的知识点 {kid}"
            for e in t["exercises"]:
                all_ids.append(e["id"])
                for kid in e["knowledgePointIds"]:
                    assert kid in kp_ids, f"题目 {e['id']} 引用了不存在的知识点 {kid}"
    assert len(all_ids) == len(set(all_ids)), "题目 id 有重复"

    pkg = {
        "manifest": {
            "schemaVersion": "1.0",
            "packageId": PKG_ID,
            "type": "special",
            "packageType": "special",
            "isInternal": False,
            # 背记包：必须关考试模式，否则没有逐题反馈、词汇卡片也不渲染
            "examMode": False,
            "subject": "english",
            "templateId": "english.primary.v1",
            "grade": 4,
            "term": "down",
            "edition": "人教版",
            "title": "四下英语 · 词汇·单词句型语法（PEP 6 单元）",
            "dependencies": [],
        },
        "knowledgePoints": kps,
        "units": units,
        # 顶层留空：normalizePackage 会把 topic 里的题收进 pkg.exercises
        "exercises": [],
    }

    OUT_JSON.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    set_cfg = {
        "setId": SET_ID,
        "title": "四年级英语下（人教 PEP）",
        "subject": "english",
        "grade": 4,
        "term": "down",
        "edition": "人教版",
        "importOrder": [PKG_ID],
        "packages": [{
            "file": f"{PKG_ID}.json",
            "packageId": PKG_ID,
            "type": "special",
            "visible": True,
            "examMode": False,
            "dependencies": [],
        }],
    }
    (CONTENT_DIR / "_set.json").write_text(
        json.dumps(set_cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    n_words = sum(len(u["words"]) for u in UNITS)
    n_ex = sum(len(t["exercises"]) for u in units for t in u["topics"])
    print(f"✅ {PKG_ID}: {len(units)} 单元 / {len(kps)} 知识点 / {n_ex} 题（单词 {n_words} 个）")
    for u in units:
        print(f"   {u['name']}: {len(u['topics'])} 主题 / "
              f"{sum(len(t['exercises']) for t in u['topics'])} 题 — {u['title']}")
    return 0


if __name__ == "__main__":
    sys.exit(build())
