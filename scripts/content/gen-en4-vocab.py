#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
四上英语（人教 PEP）「单词句型 + 语法」专项包。

## 数据来源

- `content/资料/26新四年级上册英语【单词句型默写单】人教P.pdf`（12 页，**零文本扫描件**）
  p01–p06 是「中译英」题目页，p07–p12 是同一份材料的「英译中」页 ——
  后者直接给出了全部英文单词与句型，等于自带答案页。中英两版逐条对齐后取用。
- `content/资料/四年级（上）英语语法【周末练习】.pdf`（6 页，同样零文本）
  全是语法练习，**没有答案**，答案由本脚本显式给出（There be、be/have、名词所有格等，
  都是唯一解）。

## 题型怎么分

单词与句型都用 `blank`（手打英文，练拼写）。查过 `@core/quiz/blank` 的判分路径后确认：
**单空填空走的是严格相等**（`normalizeBlank` 只做小写化、去空格、全半角标点统一），
`partsMatch` 的子串容错只作用于「多空」和「斜杠备选」两条路径 —— 所以 `PE` / `Ms` / `his`
这类短词做填空**不会**被 `type`、`this` 蒙对，可以放心统一用填空。
（多空题如 `driver, drives` 才会进 `partsMatch`，故那几题的每段答案都取得比较长。）

## 原包怎么处理

原 `special-english-4-up-vocab.json` 的 128 个知识点是**沪教版**词表（city / building / flat…），
与这份人教 PEP 资料完全不重合，且 `edition` 也标成「沪教版」—— 故整包重建为 PEP 6 单元。

用法：
    python scripts/content/gen-en4-vocab.py
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "content" / "english-4-up-vocab" / "special-english-4-up-vocab.json"

# 单元词表：(中文释义, 英文单词)
UNITS = [
    ("Unit 1", "Helping at home", "在家帮忙", [
        ("体育(课)", "PE"), ("工作；职业", "job"), ("医生", "doctor"), ("农场主；农民", "farmer"),
        ("护士", "nurse"), ("公司职员", "office worker"), ("工厂工人", "factory worker"),
        ("忙碌的", "busy"), ("疲倦的", "tired"), ("家庭杂务", "chore"), ("烹饪；煮", "cook"),
        ("打扫；干净的", "clean"), ("房间", "room"), ("照顾", "look after"), ("扫", "sweep"),
        ("地板；地面", "floor"), ("在一起；共同", "together"), ("人；人们", "people"),
        ("儿童；小孩", "child"),
    ]),
    ("Unit 2", "My friends", "我的朋友", [
        ("他的", "his"), ("强壮的", "strong"), ("头发", "hair"), ("也", "also"),
        ("友好的", "kind"), ("文静的", "quiet"), ("最好的", "best"), ("阅读", "read"),
        ("玩耍", "play"), ("中文；中国人；中国的", "Chinese"), ("游戏", "game"),
        ("足球运动", "football"), ("篮球运动", "basketball"), ("总是", "always"),
    ]),
    ("Unit 3", "Places we live in", "我们居住的地方", [
        ("下午", "afternoon"), ("（表示存在）有", "there"), ("游乐场；操场", "playground"),
        ("公园", "park"), ("在……", "over"), ("医院", "hospital"), ("商店", "shop"),
        ("厕所；卫生间", "toilet"), ("公共汽车站", "bus stop"), ("图书馆", "library"),
        ("体育运动", "sport"), ("散步；行走", "walk"), ("社区", "community"),
        ("最喜欢的", "favourite"), ("地方；场所", "place"), ("照片", "photo"),
        ("故事", "story"), ("购买", "buy"),
    ]),
    ("Unit 4", "Helping in the community", "在社区帮忙", [
        ("消防队员", "firefighter"), ("为什么", "why"), ("司机", "driver"),
        ("清洁工", "cleaner"), ("厨师", "cook"), ("快递员", "delivery worker"),
        ("警察；警员", "police officer"), ("大量；许多", "a lot of"), ("现在", "now"),
        ("过去的；年纪大的；老的", "old"), ("讲述；告诉", "tell"), ("每人", "everyone"),
        ("女士", "Ms"),
    ]),
    ("Unit 5", "The weather and us", "天气与我们", [
        ("说话；发言", "speak"), ("天气", "weather"), ("阳光充足的", "sunny"), ("热的", "hot"),
        ("令人不快的；坏的", "bad"), ("冷的", "cold"), ("多风的", "windy"),
        ("多云的", "cloudy"), ("阴雨的", "rainy"), ("多雪的", "snowy"), ("凉爽的", "cool"),
        ("温暖的", "warm"), ("在明天", "tomorrow"), ("下雨；雨", "rain"),
        ("关闭的", "closed"), ("电影", "film"), ("想法；主意", "idea"),
        ("操纵（飞行器等）；飞", "fly"), ("风筝", "kite"), ("雪人", "snowman"),
        ("享乐；乐趣", "fun"), ("游泳", "swim"), ("悉尼", "Sydney"),
        ("他们的；她们的；它们的", "their"),
    ]),
    ("Unit 6", "Changing for the seasons", "随季节而变化", [
        ("谁的", "whose"), ("毛衣", "sweater"), ("短袜", "sock"), ("我的", "mine"),
        ("穿；戴", "wear"), ("衬衫", "shirt"), ("大衣；外套", "coat"), ("连衣裙", "dress"),
        ("哪一个；哪些", "which"), ("季节", "season"), ("冬天", "winter"),
        ("下雪；雪", "snow"), ("聚会", "get together"), ("春天", "spring"),
        ("夏天", "summer"), ("秋天", "autumn"), ("T恤衫", "T-shirt"), ("落下", "fall"),
        ("叶", "leaf"), ("手套", "glove"), ("然后；那时", "then"),
    ]),
]

# 句型：挖空位置只选 ≥4 字母的词（见文件头的短答案规避说明）
PATTERNS = {
    1: [
        ("— What's your mother's job? — She's a ____ .", "doctor", "她是医生。"),
        ("Mum and Dad are ____ and tired.", "busy", "爸爸妈妈又忙又累。"),
        ("We can do some ____ .", "chores", "我们可以做一些家务活。"),
        ("He is a factory ____ .", "worker", "他是工厂工人。"),
    ],
    2: [
        ("He's tall and ____ .", "strong", "他又高又壮。"),
        ("He's also ____ . He often helps me.", "kind", "他也很友善，他经常帮助我。"),
        ("— Who's your ____ friend? — Chen Jie.", "best", "谁是你最好的朋友？"),
        ("She often makes me ____ .", "smile", "她经常让我开心。"),
    ],
    3: [
        ("There is a ____ . We often play there.", "playground", "那里有个游乐场，我们经常在那里玩儿。"),
        ("My favourite ____ is the museum.", "place", "我最喜欢的地方是博物馆。"),
        ("Great! Let's do some ____ .", "sports", "太棒了！我们一起做运动吧。"),
        ("We can go to the ____ .", "library", "我们可以去图书馆。"),
    ],
    4: [
        ("Our neighbour is a ____ . He often helps people.", "firefighter", "我们的邻居是消防员，他经常帮助别人。"),
        ("He's a school bus ____ . He takes us to school every day.", "driver", "他是校车司机，他每天送我们去学校。"),
        ("That's an ____ job too.", "important", "那个工作也很重要！"),
        ("Chen Jie is ____ the bed.", "making", "陈杰正在铺床。"),
    ],
    5: [
        ("What's the ____ like in Sydney?", "weather", "悉尼的天气怎么样？"),
        ("It's only two ____ in Beijing.", "degrees", "北京只有两度。"),
        ("It's ____ now.", "raining", "现在下雨了。"),
        ("Their children swim in the ____ .", "pool", "他们的孩子在泳池里游泳。"),
    ],
    6: [
        ("— ____ sweater is this, Mum? — It's your dad's.", "Whose", "这是谁的毛衣，妈妈？"),
        ("— ____ season do you like? — Winter.", "Which", "你喜欢哪个季节？"),
        ("Then ____ comes again.", "spring", "接着春天又来了。"),
        ("Yes, but wear a ____ too.", "coat", "可以，但是再穿一件外套吧。"),
    ],
}

# 语法：每项是 (题型, 题干, 答案/options)
# blank 用于 ≥4 字母答案；single 用于短答案（含原卷自带三选项的题）
GRAMMAR = {
    "There be 句型": [
        ("single", "There ____ some oranges on the tree.",
         ["A. is", "B. are", "C. has"], "B", "oranges 是复数，There be 用 are。"),
        ("single", "There is some ____ on the plate.",
         ["A. apple", "B. bread", "C. bananas"], "B",
         "is 后面跟不可数名词；bread 不可数，apple 和 bananas 都要用复数形式配 are。"),
        ("single", "He ____ some cool shoes.",
         ["A. are", "B. has", "C. is"], "B", "主语 He 是第三人称单数，用 has。"),
        ("single", "____ some trees on both sides of the street.",
         ["A. Are there", "B. There is", "C. There are"], "C",
         "trees 是复数，用 There are；陈述句不用倒装 Are there。"),
        ("single", "There ____ a bed, two chairs, three toys and four books in the bedroom.",
         ["A. Has", "B. is", "C. are"], "B",
         "There be 的「就近原则」：看离 be 最近的名词 a bed（单数），所以用 is。"),
        ("single", "There ____ two birds and a monkey in the tree.",
         ["A. is", "B. are", "C. be"], "B", "离 be 最近的是 two birds（复数），用 are。"),
        ("single", "There ____ a pencil, some books and a ruler in my bag.",
         ["A. is", "B. are", "C. have"], "A", "就近的是 a pencil（单数），用 is。"),
        ("single", "There aren't ____ apples in the basket.",
         ["A. some", "B. any", "C. a"], "B", "否定句里用 any，不用 some。"),
        ("single", "There isn't ____ water in the glass.",
         ["A. some", "B. any", "C. many"], "B", "否定句用 any；water 不可数，也不能用 many。"),
    ],
    "be 动词与 have / has": [
        ("single", "Amy ____ a small mouth.",
         ["A. have", "B. has", "C. is"], "B", "Amy 是第三人称单数，用 has。"),
        ("single", "I ____ fine, thank you.",
         ["A. am", "B. is", "C. are"], "A", "主语 I 配 am。"),
        ("single", "— What do you ____ ? — We ____ six oranges.",
         ["A. have; have", "B. has; have", "C. have; has"], "A",
         "do 后面用动词原形 have；We 是复数主语，也用 have。"),
        ("single", "I ____ a lovely cat. It ____ a long tail.",
         ["A. have; has", "B. has; have", "C. have; have"], "A",
         "I 用 have；It 是第三人称单数用 has。"),
        ("single", "Little Peter ____ two toy pandas. They ____ black and white.",
         ["A. has; are", "B. have; is", "C. has; is"], "A",
         "Peter 单数用 has；They 复数用 are。"),
    ],
    "名词所有格": [
        ("single", "— Is that ____ cap? — Yes, it is.",
         ["A. your", "B. yours", "C. you"], "A",
         "cap 是名词，前面要用形容词性物主代词 your；yours 后面不能再跟名词。"),
        ("single", "____ Mike, ____ eyes are big.",
         ["A. He's; Her", "B. His; He's", "C. He's; His"], "C",
         "句首要主语 He's（He is）；eyes 前用形容词性物主代词 His。"),
        ("single", "This is ____ sister. ____ name is Lisa.",
         ["A. mine; Her", "B. my; She's", "C. my; Her"], "C",
         "sister 前用 my；name 前用 Her。"),
        ("single", "— Is this ____ toy? — No, it's not ____ .",
         ["A. your; my", "B. your; mine", "C. yours; mine"], "B",
         "toy 前用 your；句末不跟名词时用名词性物主代词 mine。"),
        ("single", "Kate: Is this ____ schoolbag, Chen Jie?",
         ["A. your", "B. yours", "C. you"], "A", "schoolbag 是名词，用 your。"),
        ("single", "Chen Jie: No. Amy has a panda schoolbag. Maybe it's ____ .",
         ["A. her", "B. hers", "C. she"], "B", "句末独立使用，用名词性物主代词 hers。"),
        ("single", "Kate: Hello, Amy. Is this ____ ?",
         ["A. your", "B. yours", "C. you"], "B", "后面没有名词，用名词性物主代词 yours。"),
        ("single", "Amy: Yes, it's ____ . Thank you.",
         ["A. my", "B. mine", "C. me"], "B", "句末独立使用，用 mine。"),
        ("single", "This is ____ classroom.", ["A. John", "B. John's", "C. Johns"], "B",
         "表示「约翰的」，名词后加 's。"),
        ("single", "Look at this photo ____ my family.", ["A. of", "B. on", "C. in"], "A",
         "「一张我家的照片」用 a photo of my family。"),
        ("single", "Is that your ____ bird?", ["A. brother", "B. brother's", "C. brothers"], "B",
         "鸟是哥哥的，要用所有格 brother's。"),
    ],
    "形容词构词与词类": [
        ("blank", "名词 + y 构成形容词：wind → windy，Sun → ____", "sunny", "sun + n + y → sunny（双写 n 再加 y）。"),
        ("blank", "名词 + y 构成形容词：wind → windy，rain → ____", "rainy", "rain + y → rainy。"),
        ("blank", "名词 + ful 构成形容词：colour → colourful，help → ____", "helpful", "help + ful → helpful。"),
        ("blank", "名词 + ful 构成形容词：colour → colourful，care → ____", "careful", "care + ful → careful。"),
        ("blank", "名词 + ly 构成形容词：year → yearly，friend → ____", "friendly", "friend + ly → friendly。"),
        ("blank", "名词 + ly 构成形容词：year → yearly，love → ____", "lovely", "love + ly → lovely。"),
        ("single", "选出不同类的一项：", ["A. rain", "B. sunny", "C. windy"], "A",
         "rain 可作名词/动词，sunny 和 windy 都是形容词。"),
        ("single", "选出不同类的一项：", ["A. snowy", "B. snowman", "C. cloudy"], "B",
         "snowman 是名词（雪人），其余两个是形容词。"),
        ("single", "选出不同类的一项：", ["A. red", "B. blue", "C. colour"], "C",
         "red、blue 是具体的颜色，colour 是「颜色」这个总称。"),
        ("single", "选出不同类的一项：", ["A. friendly", "B. helpful", "C. friend"], "C",
         "friend 是名词，其余两个是形容词。"),
        ("single", "选出不同类的一项：", ["A. hungry", "B. hurry", "C. happy"], "B",
         "hurry 是动词，hungry 和 happy 是形容词。"),
        ("single", "It is ____ and ____ . Children are having fun in the snow.",
         ["A. cold; snowy", "B. cold; snow", "C. cool; snow"], "A",
         "and 连接两个形容词；snow 是名词/动词，这里要用形容词 snowy。"),
        ("single", "It is -5℃. It's ____ in Beijing now.", ["A. hot", "B. cold", "C. warm"], "B",
         "零下五度，只能是 cold。"),
        ("single", "____ warm and cloudy today.", ["A. It's", "B. They're", "C. There's"], "A",
         "说天气用 It 作主语：It's warm and cloudy."),
        ("single", "— Mike, it's ____ now. — Oh no! We can't play basketball in the park.",
         ["A. rain", "B. raining", "C. rains"], "B",
         "It's + 动词-ing 表示「正在下雨」：It's raining now."),
        ("single", "It's ____ here. It's fun to play football in the park.",
         ["A. sunny", "B. snowy", "C. rainy"], "A",
         "能在公园踢足球，说明天气晴好，选 sunny。"),
    ],
    "职业词汇与词形变化": [
        # 原卷是「从方框 A–F 选词填空」，把方框贴进每道题干会变成一长串噪声，
        # 这里改成四选一：正确项来自原题，干扰项也只取原方框里的词。
        ("single", "Mr Green ____ English in a primary school.",
         ["A. teaches", "B. doctor", "C. farmer", "D. dancer"], "A",
         "Mr Green 是第三人称单数，teach 加 -es → teaches。"),
        ("single", "Mike is ill. His father takes him to see the ____ .",
         ["A. uncle", "B. doctor", "C. dancer", "D. farmer"], "B", "生病了去看医生 doctor。"),
        ("single", "My ____ is a good writer. I like his stories.",
         ["A. doctor", "B. uncle", "C. farmer", "D. teaches"], "B",
         "「我的叔叔是一位好作家」，选 uncle。"),
        ("single", "What's your ____ job? Is he a worker?",
         ["A. uncle", "B. farmer", "C. father's", "D. doctor"], "C",
         "「你爸爸的工作是什么」，名词所有格 father's。"),
        ("single", "She is a ____ . She grows fruit and feeds animals.",
         ["A. dancer", "B. doctor", "C. uncle", "D. farmer"], "D",
         "种水果、养牲口的是农民 farmer。"),
        ("single", "Yang Liping is a ____ . She is good at Chinese folk dance.",
         ["A. farmer", "B. teaches", "C. dancer", "D. father's"], "C",
         "擅长中国民族舞的是舞蹈家 dancer。"),
        ("blank", "My father is a ____ . He ____ a taxi.（drive）", "driver, drives",
         "「司机」是 driver；第三人称单数 drive → drives。两空用逗号隔开。"),
        ("blank", "Susan likes ____ . She wants to be a ____ in the future.（cook）", "cooking, cook",
         "like doing sth → cooking；「厨师」是 cook。两空用逗号隔开。"),
        ("blank", "There are some ____ on the street. They usually ____ the streets in the early morning.（clean）", "cleaners, clean",
         "「清洁工」是 cleaner，some 后用复数 cleaners；they 后接动词原形 clean。"),
        ("blank", "There is a fire in the school. The ____ go there and help.（firefighter）", "firefighters",
         "「消防队员」firefighter，The ... go 说明是复数 firefighters。"),
    ],
}


def blank(qid, question, answer, explanation, kp, diff="基础", title=None):
    return {
        "id": qid, "type": "blank", "question": question, "answer": answer,
        "explanation": explanation, "knowledgePointIds": [kp],
        "metadata": {"difficulty": diff, **({"title": title} if title else {})},
    }


def single(qid, question, options, answer, explanation, kp, diff="基础", title=None):
    return {
        "id": qid, "type": "single", "question": question, "options": options,
        "answer": answer, "explanation": explanation, "knowledgePointIds": [kp],
        "metadata": {"difficulty": diff, **({"title": title} if title else {})},
    }


def main() -> int:
    units, kps, all_ex = [], [], []

    # ---- 6 个词汇单元 ----
    for ui, (code, en, cn, words) in enumerate(UNITS, 1):
        word_kps, ex_words, ex_pat = [], [], []
        for wi, (zh, en_w) in enumerate(words, 1):
            kp_id = f"kp-en4-u{ui}-w{wi:02d}"
            word_kps.append({
                "id": kp_id, "type": "word", "title": en_w, "content": zh,
                "metadata": {"word": en_w, "meaning": zh},
            })
            ex_words.append(blank(
                f"en4-u{ui}-w{wi:02d}",
                f"【单词默写】{zh} → （　）",
                en_w,
                f"{zh} → {en_w}",
                kp_id,
                "基础" if len(en_w.split()) == 1 else "进阶",
                en_w,
            ))

        kp_pat = f"kp-en4-u{ui}-pat"
        for pi, (sent, ans, zh) in enumerate(PATTERNS.get(ui, []), 1):
            ex_pat.append(blank(
                f"en4-u{ui}-p{pi:02d}",
                f"【句型】{zh}\n{sent}",
                ans,
                f"{zh} →「{sent.replace('____', ans)}」",
                kp_pat, "进阶", ans,
            ))

        topics = [{
            "id": f"en4-u{ui}-t1", "title": f"单词默写（{len(ex_words)} 个）",
            "desc": f"{cn} · {en}", "board": "单词",
            "knowledgePointIds": [k["id"] for k in word_kps],
            "modules": [{"id": f"en4-u{ui}-m1", "type": "english.vocab",
                         "title": f"{code} 词汇", "knowledgePointIds": [k["id"] for k in word_kps]}],
            "exercises": ex_words,
        }]
        if ex_pat:
            kps.append({
                "id": kp_pat, "type": "skill",
                "title": f"{code} 常用句型",
                "content": "把句型读熟，再替换关键词造句。注意 be 动词和主语要一致。",
                "prerequisites": [],
            })
            topics.append({
                "id": f"en4-u{ui}-t2", "title": f"常用句型（{len(ex_pat)} 题）",
                "desc": "补全句子里的关键词", "board": "句型",
                "knowledgePointIds": [kp_pat],
                "modules": [{"id": f"en4-u{ui}-m2", "type": "english.sentence",
                             "title": f"{code} 句型", "knowledgePointIds": [kp_pat]}],
                "exercises": ex_pat,
            })

        kps.extend(word_kps)
        all_ex.extend(ex_words + ex_pat)
        units.append({
            "id": f"en4-u{ui}", "name": f"{code}", "title": f"{code} · {en}",
            "desc": f"{cn} · {len(words)} 个单词 + {len(ex_pat)} 个句型",
            "topics": topics,
        })

    # ---- 语法专项单元 ----
    g_topics = []
    for gi, (gname, items) in enumerate(GRAMMAR.items(), 1):
        kp_id = f"kp-en4-g{gi}"
        kps.append({
            "id": kp_id, "type": "skill", "title": f"语法 · {gname}",
            "content": GRAMMAR_NOTE.get(gname, ""),
            "prerequisites": [],
        })
        exs = []
        for ii, item in enumerate(items, 1):
            if item[0] == "single":
                _, q, opts, ans, expl = item
                exs.append(single(f"en4-g{gi}-{ii:02d}", q, opts, ans, expl, kp_id,
                                  "基础" if ii <= 3 else "进阶"))
            else:
                _, q, ans, expl = item
                exs.append(blank(f"en4-g{gi}-{ii:02d}", q, ans, expl, kp_id, "进阶", ans))
        g_topics.append({
            "id": f"en4-g{gi}-t", "title": f"{gname}（{len(exs)} 题）",
            "desc": "语法专项练习", "board": "语法",
            "knowledgePointIds": [kp_id],
            "modules": [{"id": f"en4-g{gi}-m", "type": "english.grammar",
                         "title": gname, "knowledgePointIds": [kp_id]}],
            "exercises": exs,
        })
        all_ex.extend(exs)

    units.append({
        "id": "en4-grammar", "name": "语法专项", "title": "语法专项 · 周末练习",
        "desc": "There be、be/have、名词所有格、形容词构词、词形变化",
        "topics": g_topics,
    })

    # 唯一性自检
    ids = [e["id"] for e in all_ex]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise SystemExit(f"题目 id 重复: {sorted(dup)[:10]}")
    for e in all_ex:
        if not str(e["answer"]).strip():
            raise SystemExit(f"{e['id']} 答案为空")
        if e["type"] == "single":
            letters = [o.strip()[:1] for o in e["options"]]
            if e["answer"] not in letters:
                raise SystemExit(f"{e['id']} 答案 {e['answer']} 不在选项 {letters} 内")
        if e["type"] == "blank":
            segs = [s.strip() for s in str(e["answer"]).replace("，", ",").split(",")]
            if not segs or any(not s for s in segs):
                raise SystemExit(f"{e['id']} 填空答案有空段：{e['answer']}")

    pkg = {
        "manifest": {
            "schemaVersion": "1.0",
            "packageId": "special-english-4-up-vocab",
            "type": "special",
            "packageType": "special",
            "isInternal": False,
            "examMode": False,
            "subject": "english",
            "templateId": "english.primary.v1",
            "grade": 4,
            "term": "up",
            "edition": "人教版",
            "title": "四上英语 · 单词句型 + 语法（PEP 6 单元）",
            "dependencies": [],
        },
        "knowledgePoints": kps,
        "exercises": [],
        "units": units,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    stat = Counter(e["type"] for e in all_ex)
    print(f"✓ {OUT.name}  {len(all_ex)} 题  " + "  ".join(f"{k}={v}" for k, v in sorted(stat.items())))
    print(f"   知识点 {len(kps)}（单词 {sum(1 for k in kps if k['type']=='word')}）")
    for u in units:
        n = sum(len(t["exercises"]) for t in u["topics"])
        print(f"    {u['id']} {u['name']}: {n} 题")
    return 0


GRAMMAR_NOTE = {
    "There be 句型": "There be 表示「某处有某物」，be 动词跟**离它最近的那个名词**一致（就近原则）："
                     "There is a book and two pens. / There are two pens and a book. "
                     "否定句和疑问句里 some 要变 any。",
    "be 动词与 have / has": "am 配 I，is 配第三人称单数，are 配 you/we/they 和复数。"
                            "have 配 I/you/we/they，has 配第三人称单数（he/she/it/Amy）。",
    "名词所有格": "表示「谁的」：名词后加 's（John's classroom）。"
                 "形容词性物主代词（my/your/her/his）后面**必须跟名词**；"
                 "名词性物主代词（mine/yours/hers）**单独使用**，后面不再跟名词。",
    "形容词构词与词类": "常见构词：名词 + y（rain→rainy）、名词 + ful（help→helpful）、"
                       "名词 + ly（friend→friendly）。注意 snow 是名词/动词，snowy 才是形容词。",
    "职业词汇与词形变化": "职业词：doctor / nurse / farmer / driver / cleaner / cook / firefighter / "
                         "police officer / delivery worker。第三人称单数动词加 -s/-es；"
                         "表示一类人时名词要用复数（cleaners, firefighters）。",
}

if __name__ == "__main__":
    sys.exit(main())
