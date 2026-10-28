# -*- coding: utf-8 -*-
"""生成《二年级上册语文 · 字词默写专项》学习包。
数据来源：《26新二上语文1-8单元高频考点默写单（含答案16页）》第 9-16 页（答案页）。
已逐页核对方格内汉字；拼音按人教版教材标准标注（含变调）。
"""
import json, os, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PKG_ID = "special-chinese-2-up-vocab"
OUT = r"D:\study\content\chinese-2-up-rjb"

UNITS = [
    (1, "第一单元 识字与自然", "《小蝌蚪找妈妈》《我是什么》《植物妈妈有办法》", [
        ("liǎng tiáo", "两条"), ("nǎ lǐ", "哪里"), ("nà biān", "那边"), ("kuān guǎng", "宽广"),
        ("hái zi", "孩子"), ("mā ma", "妈妈"),
        ("tā men", "他们"), ("kàn jiàn", "看见"), ("wǒ men", "我们"), ("xuě bái", "雪白"),
        ("guò qù", "过去"), ("shén me", "什么"),
        ("liǎng gè", "两个"), ("kuān dà", "宽大"), ("duǎn xiǎo", "短小"), ("chéng zhǎng", "成长"),
        ("yì qǐ", "一起"), ("hǎi yáng", "海洋"),
        ("xǔ duō", "许多"), ("gōng zuò", "工作"), ("bàn fǎ", "办法"), ("tài yáng", "太阳"),
        ("tiān kōng", "天空"), ("dōng tiān", "冬天"),
        ("huā duǒ", "花朵"), ("chí zi", "池子"), ("jiāng hé", "江河"), ("tián dì", "田地"),
        ("nǐ men", "你们"), ("shàng shēng", "上升"),
        ("xiāng lián", "相连"), ("rú guǒ", "如果"), ("yǐ jīng", "已经"), ("gào bié", "告别"),
        ("chū fā", "出发"), ("shuǐ guǒ", "水果"),
        ("dǎn zi", "胆子"), ("dù zi", "肚子"), ("nà lǐ", "那里"), ("zhī shi", "知识"),
        ("zì jǐ", "自己"), ("dòng wù", "动物"),
        ("qīng qīng", "轻轻"), ("yīn zhuǎn qíng", "阴转晴"), ("yǔ jiā xuě", "雨夹雪"),
        ("sì hǎi wéi jiā", "四海为家"),
    ]),
    (2, "第二单元 识字（场景·树之歌·拍手歌）", "《场景歌》《树之歌》《拍手歌》《田家四季歌》", [
        ("huā yuán", "花园"), ("rén qún", "人群"), ("fēi niǎo", "飞鸟"), ("zhù chù", "住处"),
        ("tǔ kuài", "土块"), ("xīng zuò", "星座"),
        ("duì qí", "队旗"), ("yī lǐng", "衣领"), ("huān xiào", "欢笑"), ("zhī jiān", "之间"),
        ("yáng shù", "杨树"), ("shù yè", "树叶"),
        ("sōng bǎi", "松柏"), ("huà shí", "化石"), ("jīn guì", "金桂"), ("kāi huā", "开花"),
        ("pāi shǒu", "拍手"), ("shì jiè", "世界"),
        ("yún cai", "云彩"), ("cóng lín", "丛林"), ("zhú lín", "竹林"), ("xiū xi", "休息"),
        ("péng you", "朋友"), ("bǎo hù", "保护"),
        ("sì jì", "四季"), ("chūn fēng", "春风"), ("féi tián", "肥田"), ("huà féi", "化肥"),
        ("nóng shì", "农事"), ("yuè guāng", "月光"),
        ("wǔ gǔ", "五谷"), ("gǔ yǔ", "谷雨"), ("shēn tǐ", "身体"), ("xīn kǔ", "辛苦"),
        ("xīn lǐ", "心里"), ("nián chū", "年初"),
        ("guò nián", "过年"), ("dà jiā", "大家"), ("chū chǒu", "出丑"), ("chéng xīn", "诚心"),
        ("hóng lǐng jīn", "红领巾"),
    ]),
    (3, "第三单元 儿童生活", "《曹冲称象》《玲玲的画》《一封信》《妈妈睡了》", [
        ("tiān shàng", "天上"), ("měi lì", "美丽"), ("bà ba", "爸爸"), ("tí shēng", "提升"),
        ("xià lái", "下来"), ("hǎo ma", "好吗"),
        ("bú yòng", "不用"), ("gāo xìng", "高兴"), ("bàn yuán", "半圆"), ("gē ge", "哥哥"),
        ("qiū qiān", "秋千"), ("guà miàn", "挂面"),
        ("hǎo a", "好啊"), ("cǎi yún", "彩云"), ("bǎo bèi", "宝贝"), ("wán lè", "玩乐"),
        ("gàn huó", "干活"), ("huí lái", "回来"),
        ("yì xiē", "一些"), ("zǒng zhī", "总之"), ("fēn gěi", "分给"), ("tiān qì", "天气"),
        ("huān kuài", "欢快"), ("gào su", "告诉"),
        ("xiǎo qū", "小区"), ("míng zi", "名字"), ("chū mén", "出门"), ("xiāng qi", "香气"),
        ("xīng xing", "星星"), ("wǎn shang", "晚上"),
        ("wú shù", "无数"), ("nǎi nai", "奶奶"), ("nín hǎo", "您好"), ("zhōng jiān", "中间"),
        ("zǒng shì", "总是"), ("yé ye", "爷爷"),
        ("hěn hǎo", "很好"), ("běi biān", "北边"), ("biàn huà", "变化"), ("sháo zi", "勺子"),
        ("zhuǎn dòng", "转动"), ("zhè ge", "这个"),
        ("zhāng kāi", "张开"), ("hòu lái", "后来"), ("hàn zì", "汉字"), ("tú huà", "图画"),
        ("ní tǔ", "泥土"), ("tiě huán", "铁环"),
    ]),
    (4, "第四单元 家乡与祖国", "《古诗二首》《黄山奇石》《日月潭》《葡萄沟》", [
        ("yī cóng", "一丛"), ("qióng jìn", "穷尽"), ("yún céng", "云层"), ("rì zhào", "日照"),
        ("xiāng lú", "香炉"), ("yān huǒ", "烟火"),
        ("shān chuān", "山川"), ("zhí chǐ", "直尺"), ("yín hé", "银河"), ("nà xiē", "那些"),
        ("shān dǐng", "山顶"), ("shān tóu", "山头"),
        ("yún hǎi", "云海"), ("jù shí", "巨石"), ("fāng wèi", "方位"), ("xiān rén", "仙人"),
        ("qián fāng", "前方"), ("xiān nǚ", "仙女"),
        ("shǎn diàn", "闪电"), ("tiān gǒu", "天狗"), ("xíng zhuàng", "形状"), ("hú shuǐ", "湖水"),
        ("shān qū", "山区"), ("qún shān", "群山"),
        ("shù mù", "树木"), ("míng shèng", "名胜"), ("xiǎo dǎo", "小岛"), ("zhuǎn wān", "转弯"),
        ("dēng guāng", "灯光"), ("zhōng wǔ", "中午"),
        ("chū xiàn", "出现"), ("yǎn qián", "眼前"), ("xì yǔ", "细雨"), ("chéng jiù", "成就"),
        ("fēng guāng", "风光"), ("zhōng wài", "中外"),
        ("dì fang", "地方"), ("yuè fèn", "月份"), ("zhī yè", "枝叶"), ("hào kè", "好客"),
        ("lǎo xiāng", "老乡"), ("chéng shì", "城市"),
        ("xiǎo kǒng", "小孔"), ("kōng qì", "空气"), ("shuǐ fèn", "水分"), ("zhè lǐ", "这里"),
        ("wèi dào", "味道"), ("yǒu míng", "有名"),
    ]),
    (5, "第五单元 思维方法", "《坐井观天》《寒号鸟》《我要的是葫芦》", [
        ("nǎ lǐ", "哪里"), ("hǎo ya", "好呀"), ("huí dá", "回答"), ("dà huà", "大话"),
        ("bú guò", "不过"), ("nà me", "那么"),
        ("tái tóu", "抬头"), ("néng lì", "能力"), ("shū xìn", "书信"), ("dàng zuò", "当作"),
        ("qián miàn", "前面"), ("shàng zhèn", "上阵"),
        ("chū qù", "出去"), ("guò dōng", "过冬"), ("zhī dào", "知道"), ("gǎn kuài", "赶快"),
        ("zuò shì", "做事"), ("zhèng hǎo", "正好"),
        ("bīng dòng", "冰冻"), ("míng tiān", "明天"), ("qīng zǎo", "清早"), ("hǎo xiàng", "好像"),
        ("yí yàng", "一样"), ("bīng lěng", "冰冷"),
        ("tiān liàng", "天亮"), ("chū lái", "出来"), ("cóng qián", "从前"), ("zhòng tián", "种田"),
        ("yǐ hòu", "以后"), ("duō me", "多么"),
        ("nà ge", "那个"), ("yè zi", "叶子"), ("xīn xiǎng", "心想"), ("chóng zi", "虫子"),
        ("lín jū", "邻居"), ("hǎo ba", "好吧"),
        ("qí guài", "奇怪"), ("huò chē", "货车"), ("kē xué", "科学"), ("dì yī cì", "第一次"),
        ("miàn duì miàn", "面对面"),
        ("yì kē shù", "一棵树"), ("zuò jǐng guān tiān", "坐井观天"), ("zì yán zì yǔ", "自言自语"),
    ]),
    (6, "第六单元 伟人与革命", "《八角楼上》《朱德的扁担》《难忘的泼水节》《刘胡兰》", [
        ("nián dài", "年代"), ("chuān dài", "穿戴"), ("míng liàng", "明亮"), ("shì lì", "视力"),
        ("zhōng guó", "中国"), ("shèng lì", "胜利"),
        ("dào lù", "道路"), ("tóng zhì", "同志"), ("hóng jūn", "红军"), ("dí rén", "敌人"),
        ("shēng chǎn", "生产"), ("cháng cháng", "常常"),
        ("lái huí", "来回"), ("fēi cháng", "非常"), ("měi cì", "每次"), ("zhàn shì", "战士"),
        ("bái tiān", "白天"), ("nán wàng", "难忘"),
        ("huǒ hóng", "火红"), ("rén mín", "人民"), ("yīn wèi", "因为"), ("zǒng lǐ", "总理"),
        ("rén men", "人们"), ("wèi le", "为了"),
        ("cháng kù", "长裤"), ("rén qún", "人群"), ("huān lè", "欢乐"), ("kāi xīn", "开心"),
        ("xià lìng", "下令"), ("fǎn duì", "反对"),
        ("xiāng cūn", "乡村"), ("yóu yú", "由于"), ("nián qīng", "年轻"), ("bèi dòng", "被动"),
        ("xiàn zài", "现在"), ("dà shēng", "大声"),
        ("suì yuè", "岁月"), ("xiāo xi", "消息"), ("chāo shū", "抄书"), ("chǎo miàn", "炒面"),
        ("bā jiǎo lóu", "八角楼"),
        ("yí chuàn chuàn", "一串串"), ("yí kuàir", "一块儿"), ("yì diǎnr", "一点儿"),
        ("gòng chǎn dǎng", "共产党"),
    ]),
    (7, "第七单元 想象与观察", "《古诗二首》《雾在哪里》《雪孩子》", [
        ("miè jué", "灭绝"), ("xiǎo zhōu", "小舟"), ("dú zì", "独自"), ("yīn tiān", "阴天"),
        ("hǎo sì", "好似"), ("shì yě", "视野"),
        ("dī tóu", "低头"), ("yú shì", "于是"), ("wú lùn", "无论"), ("chuán zhī", "船只"),
        ("tóng shí", "同时"), ("xíng rén", "行人"),
        ("xiǎo māo", "小猫"), ("yí qiè", "一切"), ("shàng kōng", "上空"), ("yīng gāi", "应该"),
        ("kàn lái", "看来"), ("bù jiǔ", "不久"),
        ("lù shang", "路上"), ("chū xiàn", "出现"), ("sàn bù", "散步"), ("xiāo shī", "消失"),
        ("kuài yào", "快要"), ("kòng dì", "空地"),
        ("huǒ bàn", "伙伴"), ("chàng gē", "唱歌"), ("huí jiā", "回家"), ("guān bì", "关闭"),
        ("zháo huǒ", "着火"), ("huǒ xīng", "火星"),
        ("yì biān", "一边"), ("lián máng", "连忙"), ("shù lín", "树林"), ("shì shuí", "是谁"),
        ("shuǐ qì", "水汽"), ("bái yún", "白云"),
        ("jī è", "饥饿"), ("ān níng", "安宁"), ("chē kù", "车库"), ("pǎo de kuài", "跑得快"),
        ("kuài yí huìr", "快一会儿"),
    ]),
    (8, "第八单元 相处与友谊", "《狐假虎威》《纸船和风筝》《风娃娃》", [
        ("guǒ zi", "果子"), ("mù gōng", "木工"), ("shēn biān", "身边"), ("ná qǐ", "拿起"),
        ("zǐ xì", "仔细"), ("néng gàn", "能干"),
        ("běi jí", "北极"), ("sòng gěi", "送给"), ("yǐ zi", "椅子"), ("zěn me", "怎么"),
        ("lā shǒu", "拉手"), ("zì xìn", "自信"),
        ("jiē shōu", "接收"), ("zhè me", "这么"), ("zhǐ chuán", "纸船"), ("shàng miàn", "上面"),
        ("kuài lè", "快乐"), ("zhuā zhù", "抓住"),
        ("xiàn tiáo", "线条"), ("chǎo jià", "吵架"), ("nán guò", "难过"), ("dàn shì", "但是"),
        ("hé hǎo", "和好"), ("jiē shòu", "接受"),
        ("jù zi", "句子"), ("dà kū", "大哭"), ("yǎn lèi", "眼泪"), ("shuǐ huā", "水花"),
        ("qīng cǎo", "青草"), ("yóu xì", "游戏"),
        ("zhǐ yǒu", "只有"), ("kě ài", "可爱"), ("kě yǐ", "可以"), ("hǎo ne", "好呢"),
        ("duō shǎo", "多少"), ("tiào gāo", "跳高"),
        ("zán men", "咱们"), ("tián yě", "田野"), ("dà dì", "大地"), ("yuǎn fāng", "远方"),
        ("láng qún", "狼群"), ("qīng shé", "青蛇"),
    ]),
]

PLACE = '（　）'
kps, units = [], []
for no, name, src, words in UNITS:
    kid = f"kp-u{no}"
    kps.append({
        "id": kid, "type": "word", "title": f"{name} · 字词积累",
        "content": f"{src}。本单元重点词语共 {len(words)} 个，要求看拼音准确写出汉字。",
        "prerequisites": [f"kp-u{no-1}"] if no > 1 else [],
    })
    exs = []
    for i, (py, wd) in enumerate(words, 1):
        exs.append({
            "id": f"cn2-u{no}-{i:02d}",
            "type": "blank",
            "question": f"【看拼音写词语】{py} → {PLACE}",
            "answer": wd,
            "explanation": f"{py} → {wd}",
            "knowledgePointIds": [kid],
            "metadata": {"difficulty": "基础", "pinyin": py},
        })
    units.append({
        "id": f"u{no}",
        "name": f"第 {no} 单元",
        "title": name,
        "desc": f"{src}（{len(words)} 词）",
        "topics": [{
            "id": f"t{no}",
            "title": "看拼音写词语",
            "desc": f"{len(words)} 题 · 看拼音写出正确的词语",
            "board": "字词默写",
            "knowledgePointIds": [kid],
            "modules": [{
                "id": f"m{no}",
                "type": "chinese.vocab",
                "title": name,
                "knowledgePointIds": [kid],
            }],
            "exercises": exs,
        }],
    })

pkg = {
    "manifest": {
        "schemaVersion": "1.0",
        "packageId": PKG_ID,
        "packageType": "special",
        "type": "special",
        "isInternal": False,
        "examMode": False,
        "subject": "chinese",
        "templateId": "chinese.primary.v1",
        "grade": 2,
        "term": "up",
        "edition": "人教版",
        "title": "二上语文 · 字词默写专项（8 单元）",
        "dependencies": [],
    },
    "knowledgePoints": kps,
    "exercises": [],
    "units": units,
}

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, f"{PKG_ID}.json"), "w", encoding="utf-8") as f:
    json.dump(pkg, f, ensure_ascii=False, indent=2)

setjson = {
    "schemaVersion": "1.0",
    "setId": "chinese-2-up-rjb-set",
    "root": PKG_ID,
    "title": "二年级语文上（人教版）",
    "subject": "chinese",
    "grade": 2,
    "term": "up",
    "edition": "人教版",
    "importOrder": [PKG_ID],
    "packages": [{
        "file": f"{PKG_ID}.json", "packageId": PKG_ID, "type": "special",
        "visible": True, "examMode": False, "dependencies": [],
    }],
}
with open(os.path.join(OUT, "_set.json"), "w", encoding="utf-8") as f:
    json.dump(setjson, f, ensure_ascii=False, indent=2)

total = sum(len(t["exercises"]) for u in units for t in u["topics"])
print(f"✅ {PKG_ID}: {len(units)} 单元 / {total} 词 / {len(kps)} 知识点")
for u, (no, name, _, words) in zip(units, UNITS):
    print(f"  第{no}单元 {len(words):>2} 词  {name}")
