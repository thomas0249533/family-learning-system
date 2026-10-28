# -*- coding: utf-8 -*-
"""从《26秋二年级上册人教版数学每日一练小纸条45天》生成 daily 学习包。
答案一律由程序计算（不采用 PDF 答案区——该区排版错乱，已验证）。
"""
import re, io, sys, json, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SRC = r"D:\study\tmp-pdf\26秋二年级上册人教版数学每日一练小纸条45天含答案.txt"
OUT_DIR = r"D:\study\content\math-2-up-rjb"
PKG_ID = "daily-math-2-up-rjb-45d"
GRADE, TERM, EDITION, SUBJECT = 2, "up", "人教版", "math"

# ---------- 板块 -> 知识点 ----------
BOARD_KP = [
    ("kp-m2-u1", "分类与整理", 1, 4),
    ("kp-m2-u2", "1-6 的乘法口诀", 5, 14),
    ("kp-m2-u3", "1-6 的表内除法", 15, 22),
    ("kp-m2-u4", "认识东南西北与地图方向", 23, 26),
    ("kp-m2-u5", "厘米和米", 27, 32),
    ("kp-m2-u6", "7-9 的乘除法与倍的认识", 33, 41),
    ("kp-m2-u7", "期末综合冲刺", 42, 45),
]
BOARD_DESC = {
    'kp-m2-u1': '按单一标准与多角度分类、逐层分类，体会“分类标准不同、总数不变”。',
    'kp-m2-u2': '乘法的意义（求几个几相加）、1-6 的乘法口诀、乘加乘减运算顺序。',
    'kp-m2-u3': '平均分的两种分法、除法算式含义、用乘法口诀求商、乘除互逆。',
    'kp-m2-u4': '辨认东南西北四个方向，掌握“上北下南、左西右东”的地图规则。',
    'kp-m2-u5': '厘米与米的认识、单位换算（1 米=100 厘米）、用尺量长度、画线段。',
    'kp-m2-u6': '7、8、9 的乘法口诀与求商，倍的认识（求几倍、求一个数的几倍）。',
    'kp-m2-u7': '全册核心素养综合运用：表内乘除、长度单位、方向位置、两步应用题。',
}

def kp_of(day):
    for kid, _, lo, hi in BOARD_KP:
        if lo <= day <= hi:
            return kid
    return 'kp-m2-u7'

# ---------- 文本切分 ----------
raw = open(SRC, encoding='utf-8').read()
raw = re.sub(r'第\d+ 页共\d+ 页', '', raw)
raw = re.sub(r'----- p\d+ -----', '', raw)
qpart = raw.split('参考答案与详细思维解析')[0]
days = [d for d in re.split(r'(?=Day\s*\d+)', qpart) if re.match(r'Day\s*\d+', d.strip())]
assert len(days) == 45, len(days)

def sectionize(t):
    i1, i2, i3, i4 = (t.find('一、口算'), t.find('二、列竖式'),
                      t.find('三、脱式'), t.find('四、'))
    return {
        'kou': t[i1:i2] if i1 >= 0 and i2 > i1 else '',
        'shu': t[i2:i3] if i2 >= 0 and i3 > i2 else '',
        'tuo': t[i3:i4] if i3 >= 0 and i4 > i3 else '',
        'si':  t[i4:] if i4 >= 0 else '',
    }

def merge_lines(text):
    out, buf = [], ''
    for ln in [x.strip() for x in text.split('\n') if x.strip()]:
        if re.match(r'^[一二三四]、', ln):
            continue
        ln = ln.strip()
        if not ln:
            continue
        buf += ln
        if '＝' in buf or buf.endswith('）'):
            out.append(buf)
            buf = ''
    if buf:
        out.append(buf)
    return out

# ---------- 计算 ----------
SAFE = re.compile(r'^[\d+\-*/().\s]+$')
def evaluate(expr):
    if not SAFE.match(expr):
        return None
    try:
        v = eval(expr, {'__builtins__': {}}, {})
    except Exception:
        return None
    if isinstance(v, float):
        return int(round(v)) if abs(v - round(v)) < 1e-9 else None
    return v if isinstance(v, int) else None

def to_expr(s):
    return (s.replace('×', '*').replace('÷', '/').replace('＋', '+')
             .replace('－', '-').replace('＝', '').strip())

BLANK = re.compile(r'\(\s*\)')
def solve_blank(line):
    t = (line.replace('（', '(').replace('）', ')').replace('＝', '=')
             .replace('＋', '+').replace('－', '-').replace('×', '*').replace('÷', '/')
             .replace(' ', ''))
    m = re.match(r'^\(\)([*/+\-])(\d+)=(\d+)$', t)
    if m:
        op, b, r = m.group(1), int(m.group(2)), int(m.group(3))
        return {'*': r // b if b and r % b == 0 else None,
                '/': b // r if r and b % r == 0 else None,
                '+': r - b, '-': b - r}[op]
    m = re.match(r'^(\d+)([+\-])\(\)=(\d+)$', t)
    if m:
        a, op, r = int(m.group(1)), m.group(2), int(m.group(3))
        return r - a if op == '+' else a - r
    m = re.match(r'^(\d+)([*/])\(\)=(\d+)$', t)
    if m:
        a, op, r = int(m.group(1)), m.group(2), int(m.group(3))
        if op == '*':
            return r // a if a and r % a == 0 else None
        return a // r if r and a % r == 0 else None
    return None

# ---------- 脱式分步 ----------
def step_process(expr):
    """把表达式按小学运算顺序逐层化简，返回 (过程串, 结果)。"""
    s = expr.replace('＝', '').strip()
    steps = [s]
    cur = s
    for _ in range(6):
        # 1. 最内层括号
        m = re.search(r'\(([^()]+)\)', cur)
        if m:
            inner = m.group(1)
            v = evaluate(to_expr(inner))
            if v is None:
                break
            cur = cur[:m.start()] + str(v) + cur[m.end():]
            steps.append(cur)
            continue
        # 2. 乘除优先
        m = re.search(r'(\d+)([×÷])(\d+)', cur)
        if m:
            v = evaluate(to_expr(m.group(0)))
            if v is None:
                break
            cur = cur[:m.start()] + str(v) + cur[m.end():]
            steps.append(cur)
            continue
        # 3. 加减从左到右
        m = re.search(r'(\d+)([＋－])(\d+)', cur)
        if m:
            v = evaluate(to_expr(m.group(0)))
            if v is None:
                break
            cur = cur[:m.start()] + str(v) + cur[m.end():]
            steps.append(cur)
            continue
        break
    return steps, (evaluate(to_expr(cur)) if re.fullmatch(r'-?\d+', cur.strip()) else None)

# ---------- 生成 ----------
PLACE = '（　）'
exercises_by_day = {}
problems = []
for d in days:
    day = int(re.match(r'Day\s*(\d+)', d.strip()).group(1))
    s = sectionize(d)
    items = {'kou': [], 'shu': [], 'tuo': []}
    for key, label, diff in (('kou', '口算', '基础'), ('shu', '竖式', '基础'), ('tuo', '脱式', '进阶')):
        for ln in merge_lines(s[key]):
            need_check = '★' in ln
            ln = ln.replace('★', '').strip()
            suffix = '（需验算）' if need_check else ''
            if BLANK.search(ln):
                ans = solve_blank(ln)
                qtext = re.sub(r'[（(]\s*[）)]', PLACE, ln) + suffix
                expl = re.sub(r'[（(]\s*[）)]', str(ans), ln) if ans is not None else ''
                items[key].append(('blank', qtext, str(ans), expl, diff))
            else:
                v = evaluate(to_expr(ln))
                if key == 'tuo':
                    steps, res = step_process(ln)
                    v = res if res is not None else v
                    expl = '＝'.join(steps)
                    if not expl.endswith(str(v)):
                        expl = expl + '＝' + str(v)
                else:
                    expl = f"{ln.rstrip('＝')}＝{v}"
                qtext = f"{ln.rstrip('＝')}＝{PLACE}{suffix}"
                items[key].append(('blank', qtext, str(v), expl, diff))
            if items[key][-1][2] == 'None':
                problems.append((day, key, ln))
    exercises_by_day[day] = items

print('生成失败:', len(problems))
for p in problems[:10]:
    print('  ', p)

# 组装 JSON
kps = [{
    "id": kid, "type": "concept", "title": name,
    "content": BOARD_DESC[kid], "prerequisites": []
} for kid, name, _, _ in BOARD_KP]

units = []
for d in days:
    day = int(re.match(r'Day\s*(\d+)', d.strip()).group(1))
    t = re.search(r'【(.+?)】', d.replace('\n', ''), re.S)
    full = t.group(1).replace('\n', '').strip() if t else f'Day {day}'
    # "第一单元：分类与整理· 分类的意义…" -> 保留全串但去掉单元前缀冗余
    title = f"Day {day:02d} · {full}"
    kid = kp_of(day)
    topics = []
    for key, label, desc in (
        ('kou', '口算', '20 题 · 直接写得数，建议 3 分钟'),
        ('shu', '列竖式', '8 题 · 列竖式计算，带★的需验算'),
        ('tuo', '脱式计算', '4 题 · 按运算顺序分步计算'),
    ):
        exs = []
        for i, (typ, q, a, expl, diff) in enumerate(exercises_by_day[day][key], 1):
            exs.append({
                "id": f"d2-{day:02d}-{key}-{i:02d}",
                "type": typ,
                "question": f"【{label}】{q}",
                "answer": a,
                "explanation": expl,
                "knowledgePointIds": [kid],
                "metadata": {"difficulty": diff},
            })
        if not exs:
            continue
        topics.append({
            "id": f"d2-{day:02d}-{key}",
            "title": label,
            "desc": desc,
            "board": label,
            "knowledgePointIds": [kid],
            "modules": [{
                "id": f"d2-{day:02d}-{key}-m",
                "type": "math.concept",
                "title": full,
                "knowledgePointIds": [kid],
            }],
            "exercises": exs,
        })
    units.append({
        "id": f"d2-u{day:02d}",
        "name": "每日一练",
        "title": title,
        "desc": f"{len(topics)} 个板块 · 32 题",
        "topics": topics,
    })

pkg = {
    "manifest": {
        "schemaVersion": "1.0",
        "packageId": PKG_ID,
        "type": "daily",
        "isInternal": False,
        "subject": SUBJECT,
        "templateId": "math.primary.v1",
        "grade": GRADE,
        "term": TERM,
        "edition": EDITION,
        "title": "数学每日一练 45 天（二年级上·人教版）",
        "dependencies": [],
    },
    "knowledgePoints": kps,
    "exercises": [],
    "units": units,
}

os.makedirs(OUT_DIR, exist_ok=True)
total = sum(len(t['exercises']) for u in units for t in u['topics'])
with open(os.path.join(OUT_DIR, f'{PKG_ID}.json'), 'w', encoding='utf-8') as f:
    json.dump(pkg, f, ensure_ascii=False, indent=2)

setjson = {
    "schemaVersion": "1.0",
    "setId": "math-2-up-rjb-set",
    "root": PKG_ID,
    "title": "二年级数学上（人教版）",
    "subject": "math",
    "grade": GRADE,
    "term": TERM,
    "edition": EDITION,
    "importOrder": [PKG_ID],
    "packages": [{
        "file": f"{PKG_ID}.json",
        "packageId": PKG_ID,
        "type": "daily",
        "visible": True,
        "dependencies": [],
    }],
}
with open(os.path.join(OUT_DIR, '_set.json'), 'w', encoding='utf-8') as f:
    json.dump(setjson, f, ensure_ascii=False, indent=2)

setmanifest = {
    "schemaVersion": "1.0",
    "setId": "math-2-up-rjb-set",
    "title": "二年级数学上（人教版）",
    "subject": SUBJECT,
    "grade": GRADE,
    "term": TERM,
    "edition": EDITION,
    "importOrder": [PKG_ID],
}
with open(os.path.join(OUT_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(setmanifest, f, ensure_ascii=False, indent=2)

print(f'\n✅ {PKG_ID}: {len(units)} 天 / {total} 题 / {len(kps)} 知识点')
print('样例:', json.dumps(units[0]['topics'][0]['exercises'][:2], ensure_ascii=False, indent=1))
print('脱式样例:', json.dumps(units[0]['topics'][2]['exercises'][:2], ensure_ascii=False, indent=1))
