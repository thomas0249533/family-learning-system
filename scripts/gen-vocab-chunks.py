#!/usr/bin/env python3
# V3.1.7 · 为词汇包的知识点的 metadata 生成「拼字块」chunks。
# 汉字：常用合体字按偏旁部首拆（内置高频表），拆不到的整字为一块。
# 英语：按常见前缀/后缀/词根切，短词按音节粗切，单音节短词不生成（UI 会跳过）。
# 幂等：只写 metadata.chunks；已有且合法的不覆盖。改内容必须升 manifest.version。
import json, os, re

FILES = [
    'content/chinese-4-up-rjb/special-chinese-4-up-vocab.json',
    'content/english-4-up-vocab/special-english-4-up-vocab.json',
    'content/english-4-down-vocab/special-english-4-down-vocab.json',
]

# 常用合体字 → 偏旁/部件拆分（覆盖小学语文高频字；不追求全，拆不到就整字一块）
HANZI_PARTS = {
    '奇': ['大', '可'], '观': ['又', '见'], '据': ['扌', '居'], '说': ['讠', '兑'],
    '顿': ['屯', '页'], '时': ['日', '寸'], '渐': ['氵', '斩'], '霎': ['雨', '妾'],
    '余': ['人', '于'], '波': ['氵', '皮'], '繁': ['敏', '糸'], '星': ['日', '生'],
    '堵': ['土', '者'], '车': ['车'], '忘': ['亡', '心'], '记': ['讠', '己'],
    '谈': ['讠', '炎'], '糊': ['米', '胡'], '围': ['囗', '韦'], '舞': ['舛', '無'],
    '柔': ['矛', '木'], '幻': ['幺', '刁'], '墙': ['土', '啬'], '壁': ['辟', '土'],
    '怀': ['忄', '不'], '抱': ['扌', '包'], '寂': ['宀', '叔'], '静': ['青', '争'],
    '熟': ['孰', '灬'], '悉': ['釆', '心'], '躺': ['身', '尚'], '沉': ['氵', '冗'],
    '睡': ['目', '垂'], '随': ['阝', '隋'], '河': ['氵', '可'], '堤': ['土', '是'],
    '崩': ['山', '朋'], '裂': ['列', '衣'], '密': ['宀', '必'], '麻': ['广', '林'],
    '舒': ['舍', '予'], '适': ['舌', '辶'], '揭': ['扌', '曷'], '晓': ['日', '尧'],
    '份': ['亻', '分'], '暖': ['日', '爰'], '和': ['禾', '口'], '的': ['白', '勺'],
    '确': ['石', '角'], '曾': ['丷', '日'], '经': ['纟', '巠'], '打': ['扌', '丁'],
    '滚': ['氵', '衮'], '沟': ['氵', '勾'], '注': ['氵', '主'], '视': ['礻', '见'],
    '蚊': ['虫', '文'], '湖': ['氵', '胡'], '瞧': ['目', '焦'], '鹅': ['我', '鸟'],
    '卵': ['卩', '丶'], '坑': ['土', '亢'], '填': ['土', '真'], '庄': ['广', '土'],
    '稼': ['禾', '家'], '葡': ['艹', '匍'], '萄': ['艹', '匋'], '稻': ['禾', '舀'],
    '熟': ['孰', '灬'], '豌': ['豆', '宛'], '按': ['扌', '安'], '照': ['昭', '灬'],
    '枪': ['木', '仓'], '探': ['扌', '罙'], '愉': ['忄', '俞'], '快': ['忄', '夬'],
    '曾': ['丷', '日'], '经': ['纟', '巠'], '洋': ['氵', '羊'], '溢': ['氵', '益'],
    '聪': ['耳', '总'], '明': ['日', '月'], '朋': ['月', '月'], '林': ['木', '木'],
    '森': ['木', '木', '木'], '从': ['人', '人'], '众': ['人', '人', '人'],
    '鲜': ['鱼', '羊'], '鸣': ['口', '鸟'], '休': ['亻', '木'], '信': ['亻', '言'],
    '问': ['门', '口'], '闪': ['门', '人'], '闷': ['门', '心'], '闻': ['门', '耳'],
    '花': ['艹', '化'], '草': ['艹', '早'], '芽': ['艹', '牙'], '苹': ['艹', '平'],
    '思': ['田', '心'], '想': ['相', '心'], '念': ['今', '心'], '忘': ['亡', '心'],
    '把': ['扌', '巴'], '拉': ['扌', '立'], '推': ['扌', '隹'], '拍': ['扌', '白'],
    '跑': ['足', '包'], '跳': ['足', '兆'], '路': ['足', '各'], '跟': ['足', '艮'],
    '话': ['讠', '舌'], '语': ['讠', '吾'], '读': ['讠', '卖'], '课': ['讠', '果'],
    '妈': ['女', '马'], '姐': ['女', '且'], '妹': ['女', '未'], '好': ['女', '子'],
    '地': ['土', '也'], '场': ['土', '昜'], '块': ['土', '夬'], '坏': ['土', '不'],
    '晴': ['日', '青'], '清': ['氵', '青'], '请': ['讠', '青'], '情': ['忄', '青'],
    '睛': ['目', '青'], '灯': ['火', '丁'], '烧': ['火', '尧'], '炒': ['火', '少'],
    '冷': ['冫', '令'], '冰': ['冫', '水'], '冻': ['冫', '东'], '净': ['冫', '争'],
    '们': ['亻', '门'], '你': ['亻', '尔'], '他': ['亻', '也'], '体': ['亻', '本'],
    '村': ['木', '寸'], '树': ['木', '对'], '桥': ['木', '乔'], '校': ['木', '交'],
    '秋': ['禾', '火'], '种': ['禾', '中'], '科': ['禾', '斗'], '秒': ['禾', '少'],
}

EN_SUFFIX = ['tion', 'sion', 'ment', 'ness', 'fully', 'less', 'ing', 'ers', 'est', 'ful', 'ous', 'able', 'ive', 'er', 'ed', 'es', 'ly', 'ty', 'al']
EN_PREFIX = ['under', 'over', 'non', 'mis', 'pre', 'dis', 'un', 're', 'in', 'im']
COMPOUNDS = ['class', 'play', 'school', 'home', 'book', 'note', 'sun', 'rain', 'bed', 'black', 'board', 'foot', 'ball', 'basket', 'birth', 'day', 'every', 'some', 'any', 'thing', 'where', 'there', 'honey', 'bee', 'super', 'market', 'after', 'noon', 'break', 'fast']

def vowel_groups(w: str):
    vowels = set('aeiouy')
    groups = []
    i = 0
    while i < len(w):
        if w[i] in vowels:
            j = i
            while j < len(w) and w[j] in vowels:
                j += 1
            groups.append((i, j))
            i = j
        else:
            i += 1
    return groups

def syllable_boundary(w: str):
    """多音节词按音节边界切（city -> ci|ty, country -> coun|try）。
    单音节词（farm/street）与 magic-e 词（safe/hive/live，词尾 e 不发音）**不拆**：
    劈成 sa|fe 会与自然拼读教学冲突，UI 自动跳过这些词。"""
    # magic-e：结尾 e 不发音，不作为独立音节（safe / hive / place / house）
    core = w[:-1] if len(w) > 3 and w.endswith('e') and w[-2] not in 'aeiouy' else w
    groups = vowel_groups(core)
    if len(groups) < 2:
        return None
    # 切在两组之间辅音串的中点偏后，让前一音节带上该辅音（coun|try 而非 cou|ntry）
    a_end, b_start = groups[0][1], groups[1][0]
    gap = b_start - a_end
    cut = a_end + max(0, (gap + 1) // 2) if gap > 0 else a_end
    if cut < 2 or len(core) - cut < 2:
        return None
    return cut

def en_chunks(w: str):
    w = w.strip().lower()
    if not w.isalpha() or len(w) < 4:
        return None
    # 1) 词根 + 后缀（最贴合"词根"诉求）
    for s in EN_SUFFIX:
        if len(w) > len(s) + 2 and w.endswith(s):
            return [w[:-len(s)], w[-len(s):]]
    # 2) 前缀 + 词根
    for p in EN_PREFIX:
        if len(w) > len(p) + 2 and w.startswith(p):
            return [w[:len(p)], w[len(p):]]
    # 3) 复合词
    for c in sorted(COMPOUNDS, key=len, reverse=True):
        if w.startswith(c) and len(w) > len(c) + 1:
            return [c, w[len(c):]]
    # 4) 自然拼读：按音节边界切，而不是机械对半
    cut = syllable_boundary(w)
    if cut:
        return [w[:cut], w[cut:]]
    return None

def zh_chunks(w: str):
    """一致性优先：一个词里所有字都能拆偏旁才用偏旁，否则整词按单字拆。
    避免「逐渐」拆成 逐/氵/斩 这种半字半偏旁的混搭。"""
    if not all('\u4e00' <= ch <= '\u9fff' for ch in w):
        return None
    if all(ch in HANZI_PARTS for ch in w):
        parts = []
        for ch in w:
            parts.extend(HANZI_PARTS[ch])
        return parts if len(parts) >= 2 else None
    return list(w) if len(w) >= 2 else None

for path in FILES:
    if not os.path.exists(path):
        print('SKIP (missing)', path); continue
    d = json.load(open(path, encoding='utf-8'))
    kps = d.get('knowledgePoints', [])
    total = made = 0
    for kp in kps:
        if kp.get('type') != 'word': continue
        w = (kp.get('metadata') or {}).get('word') or kp.get('title')
        if not w: continue
        total += 1
        lang = 'zh' if 'chinese' in path else 'en'
        chunks = zh_chunks(w) if lang == 'zh' else en_chunks(w)
        # 规则迭代后强制重算：规则变了的词要清掉旧 chunks，不留在包里当脏数据
        if not chunks:
            kp.get('metadata', {}).pop('chunks', None)
            continue
        # 汉字按偏旁拆开后拼回来是「氵可」而非「河」，**不做**拼接还原校验
        # （判分走块序列比较，见 core/quiz/wordChunks.ts）。
        # 英语是字母切分，必须能拼回原词，否则是切分 bug。
        if lang == 'en' and ''.join(chunks) != w: continue
        kp.setdefault('metadata', {})['chunks'] = chunks
        made += 1
    rate = (made / total * 100) if total else 0
    print(f"{os.path.basename(path):48} {made}/{total} ({rate:.0f}%)")
    json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
