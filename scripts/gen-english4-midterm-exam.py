#!/usr/bin/env python3
# 七年级英语期中卷（笔试部分）→ 四年级英语区 考试卷包
# 说明：用户确认目录虽名"4年级英语考试"实为七年级卷，孩子能做，故放四年级英语区(grade=4)。
#      跳过听力(1-20)，只做笔试：阅读(21-40)/完形(41-55)/词汇(56-70)/补全对话(71-75)/书面表达。
#      答案由试卷文本推导；词汇第一节(选词+变形)无答案页，建议用原卷核对。
import json, os

OUT = 'content/english-4-up-rjb/exam-english-4-up-midterm.json'

P_A = ("The school pickleball court will be open to the public (公众) from November 1st. "
       "Come to the pickleball court!\n"
       "Daytime: 14:30—15:30 & 16:00—17:00 (Open from November 1st)\n"
       "Price: 10 yuan for school teachers and students; 13 yuan for children; 20 yuan for people from outside the school\n"
       "Night-time: 18:00—19:00 & 19:30—20:30 (Open from November 5th)\n"
       "Price: 15 yuan for all\n"
       "A pickleball club will begin on November 15th. If you are interested in the pickleball club class, "
       "please call Mr Zhang at 0392-3333512. Children must come with at least one adult (成年人).")
P_B = ("Amy is a girl. She is 13. She is tidy but careless (粗心的). Now she is not happy. "
       "She can't find her favourite pen! She looks for it all over the house — under the bed, in her desk, "
       "in the bookcase and in her schoolbag. But she can't find it. Amy is really sad. She cries to her mother, "
       "'Mum, my pen is lost!' Mum says, 'Don't cry. I will help you look for it.' When Mum goes downstairs, she laughs. "
       "'Why are you laughing, Mum?' Amy asks. Mum says, 'Look for it behind your ear.' Amy looks behind her ear, "
       "and she finds her pen. She put it there earlier. Now she is happy.")
P_C = ("Jessie is an eleven-year-old student in Star Primary School. It is a big school with many trees and flowers. "
       "There are 3,000 students and 220 teachers in it. There are sixty classrooms in the classroom building. "
       "And every class has 50 students. Here is a map of her school:\n"
       "① Gym  ② Science building (science labs and computer rooms)  ③ library  ④ Classroom building  "
       "⑤ Office building  ⑥ Art and music building  ⑦ Sports field  ⑧ Dining hall\n"
       "Jessie likes her school very much. But she likes the music classroom best because it is very special. "
       "There are some desks in it, but there aren't any chairs. They sit on yoga balls — red, orange, blue and green, "
       "for students. Sitting on yoga balls is so fun. There are many pictures on the wall and many flowers in the front "
       "of the classroom. They make her classroom very good-looking.")
P_D = ("A tidy desk helps you find things easily and do things well. (36) Doing these can help you with it.\n"
       "First, (37) For old books, you can put them in the bookcase. Get a box for small things you don't need every day, "
       "and you can put your pens and pencils in a pencil box.\n"
       "Second, don't put food or drinks on your desk, because they can make your desk dirty. (38)\n"
       "Third, put important things next to you. (39) If you have a drawer under your desk, you can put things there every day.\n"
       "Fourth, (40) If you do it every day, you can have a new day with a tidy room the next morning.\n"
       "选项：A. Go to the kitchen when you want to eat.  B. It is also helpful for your study.  "
       "C. Only put things you need on your desk.  D. Clean your desk every day.  E. Don't put things on your desk.")

CLOZE = ("My aunt has a big farm. She is a (41)_____. She is fifty-five years old. She (42)_____ on her farm. "
         "She has a lot (43)_____ apple trees. She (44)_____ pick all the apples. Every year my parents and I go to her "
         "(45)_____ to help her. Today is Sunday, so my parents don't go to (46)_____ and I don't go to school. "
         "We are (47)_____. So we go to her farm to help her. We get up at about nine o'clock (48)_____ the morning. "
         "We have breakfast at home. My father has rice with some vegetables and (49)_____ orange juice. My mother has "
         "an egg, two hamburgers and two (50)_____ of milk. I (51)_____ apple juice, rice and fish. My aunt likes fish "
         "(52)_____ chicken. We go to buy fish and chicken for her in a (53)_____ shop. (54)_____ hour later we get to "
         "her farm. When we meet her, we are very happy. We work on her farm for two hours. My father and mother pick "
         "many (55)_____. I carry apples.")

VOCAB1 = ("Hello, everyone. My name is Jim. I'm in Class 8, Grade 7. (56)_____ classroom is big and nice. "
          "There are some pictures (57)_____ the wall. We have thirty desks and (58)_____ in the room. "
          "We can (59)_____ our things in the desk drawers. There is also a (60)_____ desk in front of the blackboard. "
          "There is a (61)_____ whiteboard next to the blackboard. It is very special. There are some (62)_____ on the "
          "shelf（架子）at the reading corner. We often read books there. We (63)_____ four lessons in the morning and "
          "three in the afternoon. I have a (64)_____. I often study on it. I like English best. I'm good at it. But my "
          "good friend Millie's English is not very good. So I often help her with it. We spend a lot of time (65)_____ "
          "together.\n方框选词：teacher / computer / chair / smart / put / plant / have / study / on（共 9 词，每词限用一次，用正确形式填空）")

VOCAB2 = ("Han Lin's uncle (66)_____ a big farm. He has many (67)_____ of animals. Look at the cows. "
          "They are black (68)_____ white. How many (69)_____ do you see? I see seven cows. Look (70)_____ the sheep. "
          "What colour are they? They are white.")

DIALOGUE = ("A: Hey, Rose! (71)_____?  B: I'm fine, thanks. Can I ask you some questions?\n"
            "A: Yes, you can ask anything you like.\n"
            "B: OK. Thank you. (72)_____?  A: My favourite sport is playing ping-pong.\n"
            "B: Oh, I like it, too. (73)_____?  A: It is my ping-pong bat.\n"
            "B: Well, it's Saturday tomorrow. What about playing ping-pong together?\n"
            "A: (74)_____! Let's meet on the sports field tomorrow.\n"
            "B: OK. See you tomorrow.\nA: (75)_____.")

def single(eid, num, passage, q, opts, ans, kp=None):
    e = {
        "id": f"ex-{eid}", "type": "single", "difficulty": "基础",
        "question": (f"【阅读】{passage}\n\n{num}. {q}" if passage else f"{num}. {q}"),
        "options": opts, "answer": ans,
        "metadata": {"difficulty": "基础", "order": num},
    }
    if kp: e["knowledgePointIds"] = kp
    return e

def blank(eid, num, passage, q, ans, kp=None):
    e = {
        "id": f"ex-{eid}", "type": "blank", "difficulty": "基础",
        "question": (f"【填空】{passage}\n\n{num}. {q}" if passage else f"{num}. {q}"),
        "answer": ans,
        "metadata": {"difficulty": "基础", "order": num},
    }
    if kp: e["knowledgePointIds"] = kp
    return e

# ---------- 阅读理解 21-40 ----------
reading = []
# A 篇 21-25
reading.append(single("r21", 21, P_A, "When can you go to play pickleball?",
    ["A. 10:30—11:30 on November 1st.", "B. 16:00—17:00 on November 3rd.",
     "C. 18:00—19:00 on November 3rd.", "D. 17:00—18:00 on November 5th."], "B"))
reading.append(single("r22", 22, P_A, "Who can NOT play pickleball on the court?",
    ["A. School teachers.", "B. Only adults.", "C. Children with parents.", "D. Only children."], "D"))
reading.append(single("r23", 23, P_A, "If Li Hua and you are students of the school and want to play at 18:00, how much do you need to pay?",
    ["A. 20 yuan.", "B. 30 yuan.", "C. 26 yuan.", "D. 40 yuan."], "B"))
reading.append(single("r24", 24, P_A, "How can you know more about the pickleball club?",
    ["A. Call Mr Zhang.", "B. Send an email to Mr Zhang.", "C. Write a letter to Mr Zhang.",
     "D. Find Mr Zhang and talk with him."], "A"))
reading.append(single("r25", 25, P_A, "Where is the text probably from?",
    ["A. A history book.", "B. A story website.", "C. A sports newspaper.", "D. A science research."], "C"))
# B 篇 26-30
reading.append(single("r26", 26, P_B, "Why is Amy not happy?",
    ["A. Because she is not tidy.", "B. Because her mum doesn't help her.",
     "C. Because she can't find her pen.", "D. Because her mum laughs."], "C"))
reading.append(single("r27", 27, P_B, "Where is Amy's pen?",
    ["A. In her desk.", "B. In the bookcase.", "C. Behind her ear.", "D. In her schoolbag."], "C"))
reading.append(single("r28", 28, P_B, "Where did Amy look for her pen before she cried to her mother?",
    ["A. In the kitchen, in the bookcase and under the chair.",
     "B. Behind her ear, under the bed and in her schoolbag.",
     "C. Under the bed, in her desk, in the bookcase and in her schoolbag.",
     "D. In her desk, on the table and behind the door."], "C"))
reading.append(single("r29", 29, P_B, "Which is the right order of the following? ①Amy can't find the pen. ②Amy finds her pen. ③Amy cries to her mum. ④Mum goes downstairs.",
    ["A. ①②③④", "B. ①③②④", "C. ①③④②", "D. ①④③②"], "C"))
reading.append(single("r30", 30, P_B, "What's the best title for the text?",
    ["A. Careless Amy", "B. Happy Amy", "C. Amy's favourite pen", "D. Amy's tidy mum"], "A"))
# C 篇 31-35
reading.append(single("r31", 31, P_C, "How many dining halls are there in Jessie's school?",
    ["A. One.", "B. Two.", "C. Three.", "D. Four."], "A"))
reading.append(single("r32", 32, P_C, "Where are the computer rooms?",
    ["A. In the library.", "B. In the science building.", "C. In the office building.", "D. In the classroom building."], "B"))
reading.append(single("r33", 33, P_C, "What is between the office building and the sports field?",
    ["A. The gym.", "B. The science lab.", "C. The school gate.", "D. The art and music building."], "D"))
reading.append(single("r34", 34, P_C, "Why is Jessie's music classroom special?",
    ["A. Because there are no flowers in it.", "B. Because there aren't any chairs in it.",
     "C. Because there are many maps in it.", "D. Because there are many computers in it."], "B"))
reading.append(single("r35", 35, P_C, "What can we know from the text?",
    ["A. Jessie likes the dining hall best.", "B. There are 300 students in the school.",
     "C. Jessie's school is big and nice.", "D. Students sit on the desk in the music classroom."], "C"))
# D 篇 七选五 36-40
reading.append(single("r36", 36, P_D, "Choose the best sentence for (36).",
    ["A. Go to the kitchen when you want to eat.", "B. It is also helpful for your study.",
     "C. Only put things you need on your desk.", "D. Clean your desk every day.", "E. Don't put things on your desk."], "B"))
reading.append(single("r37", 37, P_D, "Choose the best sentence for (37).",
    ["A. Go to the kitchen when you want to eat.", "B. It is also helpful for your study.",
     "C. Only put things you need on your desk.", "D. Clean your desk every day.", "E. Don't put things on your desk."], "C"))
reading.append(single("r38", 38, P_D, "Choose the best sentence for (38).",
    ["A. Go to the kitchen when you want to eat.", "B. It is also helpful for your study.",
     "C. Only put things you need on your desk.", "D. Clean your desk every day.", "E. Don't put things on your desk."], "A"))
reading.append(single("r39", 39, P_D, "Choose the best sentence for (39).",
    ["A. Go to the kitchen when you want to eat.", "B. It is also helpful for your study.",
     "C. Only put things you need on your desk.", "D. Clean your desk every day.", "E. Don't put things on your desk."], "E"))
reading.append(single("r40", 40, P_D, "Choose the best sentence for (40).",
    ["A. Go to the kitchen when you want to eat.", "B. It is also helpful for your study.",
     "C. Only put things you need on your desk.", "D. Clean your desk every day.", "E. Don't put things on your desk."], "D"))

# ---------- 完形填空 41-55 ----------
def cloze(num, q, opts, ans):
    return single(f"c{num}", num, None, f"(41-55) {CLOZE}\n\n{num}. {q}", opts, ans)
cloze_ex = [
    cloze(41, "She is a ___.", ["A. doctor", "B. driver", "C. farmer", "D. cook"], "C"),
    cloze(42, "She ___ on her farm.", ["A. takes", "B. comes", "C. lives", "D. goes"], "C"),
    cloze(43, "She has a lot ___ apple trees.", ["A. to", "B. of", "C. on", "D. in"], "B"),
    cloze(44, "She ___ pick all the apples.", ["A. does", "B. doesn't", "C. can", "D. can't"], "D"),
    cloze(45, "Every year my parents and I go to her ___ to help her.", ["A. farm", "B. school", "C. shop", "D. restaurant"], "A"),
    cloze(46, "my parents don't go to ___ and I don't go to school.", ["A. sing", "B. fly", "C. work", "D. say"], "C"),
    cloze(47, "We are ___.", ["A. sure", "B. free", "C. old", "D. new"], "B"),
    cloze(48, "at about nine o'clock ___ the morning.", ["A. at", "B. from", "C. on", "D. in"], "D"),
    cloze(49, "some ___ orange juice.", ["A. some", "B. any", "C. something", "D. anything"], "A"),
    cloze(50, "two ___ of milk.", ["A. hard", "B. hands", "C. glass", "D. glasses"], "D"),
    cloze(51, "I ___ apple juice, rice and fish.", ["A. drink", "B. eat", "C. have", "D. has"], "C"),
    cloze(52, "My aunt likes fish ___ chicken.", ["A. but", "B. and", "C. from", "D. with"], "B"),
    cloze(53, "in a ___ shop.", ["A. book", "B. clothes", "C. toy", "D. food"], "D"),
    cloze(54, "___ hour later we get to her farm.", ["A. A", "B. An", "C. Two", "D. Three"], "B"),
    cloze(55, "My father and mother pick many ___.", ["A. pears", "B. apples", "C. bananas", "D. oranges"], "B"),
]

# ---------- 词汇填空 56-70 ----------
vocab_ex = [
    # 方框 9 词对应 57-65 九空；56 空填物主代词（原卷方框疑似漏印一词）
    blank("v56", 56, VOCAB1, "(56) ___ classroom is big and nice.（填物主代词）", "My / Our"),
    blank("v57", 57, VOCAB1, "(57) There are some pictures ___ the wall.", "on"),
    blank("v58", 58, VOCAB1, "(58) We have thirty desks and ___ in the room.", "chairs / chair"),
    blank("v59", 59, VOCAB1, "(59) We can ___ our things in the desk drawers.", "put"),
    blank("v60", 60, VOCAB1, "(60) There is also a ___ desk in front of the blackboard.", "teacher's / teachers'"),
    blank("v61", 61, VOCAB1, "(61) There is a ___ whiteboard next to the blackboard.", "smart"),
    blank("v62", 62, VOCAB1, "(62) There are some ___ on the shelf at the reading corner.", "plants / plant"),
    blank("v63", 63, VOCAB1, "(63) We ___ four lessons in the morning.", "have"),
    blank("v64", 64, VOCAB1, "(64) I have a ___. I often study on it.", "computer"),
    blank("v65", 65, VOCAB1, "(65) We spend a lot of time ___ together.", "studying / study"),
    blank("v66", 66, VOCAB2, "(66) Han Lin's uncle ___ a big farm.", "has"),
    blank("v67", 67, VOCAB2, "(67) He has many ___ of animals.", "kinds"),
    blank("v68", 68, VOCAB2, "(68) They are black ___ white.", "and"),
    blank("v69", 69, VOCAB2, "(69) How many ___ do you see?", "cows"),
    blank("v70", 70, VOCAB2, "(70) Look ___ the sheep.", "at"),
]

# ---------- 补全对话 71-75 ----------
# 开放句子用「斜杠备选」(两侧必须有空白) 承接常见写法，避免"写对被判错"。
dialogue_ex = [
    blank("d71", 71, DIALOGUE, "(71) A 的问句（B 回答 I'm fine, thanks.）",
          "How are you / How are you doing / How do you do / How is everything"),
    blank("d72", 72, DIALOGUE, "(72) B 的问句（A 回答 My favourite sport is playing ping-pong.）",
          "What's your favourite sport / What is your favourite sport / What's your favorite sport / What sport do you like best / What sport do you like"),
    blank("d73", 73, DIALOGUE, "(73) B 的问句（A 回答 It is my ping-pong bat.）",
          "What's this / What is this / What's that / What is that / What is it / Whose bat is it"),
    blank("d74", 74, DIALOGUE, "(74) A 的回应（赞同明天一起打球，感叹句）",
          "Good idea / Great / Sounds great / That's a good idea / Sounds good / Wonderful"),
    blank("d75", 75, DIALOGUE, "(75) A 的结束语（B 说 See you tomorrow.）",
          "See you / See you tomorrow / See you then / Bye / Goodbye"),
]

# ---------- 书面表达 ----------
writing_ex = [{
    "id": "ex-write", "type": "essay", "difficulty": "提高",
    "question": ("六、书面表达（20分）\n进入初中以后，你肯定认识了不少新朋友吧？请根据下面的表格信息，"
                 "将你的一位朋友介绍给大家吧！\n表格 My Friend：英文名 / 年龄 / 外貌 / 性格 / 喜欢的颜色 / "
                 "喜欢的食物 / 喜欢的运动 ……\n要求：1. 包含表格信息，可适当增加细节；2. 文中不得出现真实校名和姓名；"
                 "3. 词数约 80 词（开头已给，不计入总词数）。\n"
                 "My Friend\nThis term is so great. I meet a very good friend. ________________________"),
    # 孩子用英文作答，得分点必须是英文词（含 / 同义备选）；否则中文要点永不命中。
    "keyPoints": [
        "English name / name / called",
        "years old / year old / old / age",
        "tall / short / thin / hair / eyes / wears",
        "kind / friendly / helpful / clever / funny",
        "favourite / favorite / likes / like / loves",
        "colour / color / food / sport / ping-pong / basketball",
    ],
    "answer": ("This term is so great. I meet a very good friend. His English name is Tom and he is twelve "
               "years old. He is tall and thin, with short black hair and big eyes. He is kind and friendly, "
               "so everyone in our class likes him. His favourite colour is blue. He likes noodles and beef "
               "best. His favourite sport is ping-pong, and we often play it together after school. I am "
               "very happy to have such a good friend."),
    "metadata": {"difficulty": "提高", "order": 76},
}]

# 包内知识点：题目通过 topic.knowledgePointIds 继承（E008/E009 要求）。
# 裸 id 会被 rewriteIdsInPackage 与 kp.id 同步重写成 `pkgId::kp-xxx`，不会悬空。
knowledgePoints = [
    {"id": "kp-read", "type": "concept", "title": "阅读理解",
     "content": "细节理解、推理判断、词义猜测、篇章顺序与主旨标题；广告/故事/校园说明/说明文四类材料。",
     "prerequisites": [], "metadata": {"difficulty": "基础", "estimatedMinutes": 25, "cognitiveLevel": "理解", "ability": "阅读能力"}},
    {"id": "kp-cloze", "type": "concept", "title": "完形填空",
     "content": "在语篇中运用名词、动词、介词、冠词、量词、连词与固定搭配，结合上下文逻辑选词。",
     "prerequisites": [], "metadata": {"difficulty": "基础", "estimatedMinutes": 15, "cognitiveLevel": "应用", "ability": "语篇理解"}},
    {"id": "kp-vocab", "type": "concept", "title": "词汇运用",
     "content": "方框选词并用正确形式填空（名词复数、动词时态/动名词），以及根据语境填介词、连词、名词等。",
     "prerequisites": [], "metadata": {"difficulty": "基础", "estimatedMinutes": 15, "cognitiveLevel": "应用", "ability": "词汇语法"}},
    {"id": "kp-dialog", "type": "concept", "title": "情景交际",
     "content": "根据上下文补全对话：问候、询问喜好、询问物品、赞同建议、道别等日常功能句。",
     "prerequisites": [], "metadata": {"difficulty": "基础", "estimatedMinutes": 8, "cognitiveLevel": "应用", "ability": "交际能力"}},
    {"id": "kp-write", "type": "concept", "title": "书面表达",
     "content": "按表格要点介绍一位朋友：英文名、年龄、外貌、性格、喜好，语句连贯、约 80 词。",
     "prerequisites": [], "metadata": {"difficulty": "提高", "estimatedMinutes": 20, "cognitiveLevel": "创造", "ability": "写作表达"}},
]

units = [{
    "id": "exam-eng4-u1",
    "name": "exam-eng4-u1",
    "title": "英语期中笔试模拟卷（七年级难度·四年级挑战）",
    "desc": "笔试部分：阅读理解 / 完形填空 / 词汇填空 / 补全对话 / 书面表达。听力已省略。",
    "topics": [
        {"id": "tp-read", "title": "二、阅读理解（20小题）", "board": "选择", "knowledgePointIds": ["kp-read"], "exercises": reading},
        {"id": "tp-cloze", "title": "三、完形填空（15小题）", "board": "选择", "knowledgePointIds": ["kp-cloze"], "exercises": cloze_ex},
        {"id": "tp-vocab", "title": "四、词汇填空（15小题）", "board": "填空", "knowledgePointIds": ["kp-vocab"], "exercises": vocab_ex},
        {"id": "tp-dialog", "title": "五、补全对话（5小题）", "board": "填空", "knowledgePointIds": ["kp-dialog"], "exercises": dialogue_ex},
        {"id": "tp-write", "title": "六、书面表达（20分）", "board": "写作", "knowledgePointIds": ["kp-write"], "exercises": writing_ex},
    ],
}]

pkg = {
    "manifest": {
        "packageId": "exam-english-4-up-midterm",
        "type": "special",
        "title": "英语期中笔试模拟卷（四年级·挑战）",
        "subject": "english",
        "grade": 4,
        "term": "up",
        "edition": "人教版（七年级期中卷，作四年级挑战）",
        "examMode": True,
        "isInternal": False,
        "schemaVersion": "1.0",
        "version": "1.0.1",
        "dependencies": [],
        "notes": "源为七年级英语期中卷笔试部分(21-75+书面表达)，用户确认作四年级挑战使用；听力1-20已省略。"
                 "方框词经原图放大核对为 teacher/computer/chair/smart/put/plant/have/study/on 共9词，"
                 "对应57-65九空；56空填物主代词(原卷方框疑似漏印一词)。开放句子题用斜杠备选承接常见写法。",
    },
    "knowledgePoints": knowledgePoints,
    "units": units,
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(pkg, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print("wrote", OUT)
print("reading", len(reading), "cloze", len(cloze_ex), "vocab", len(vocab_ex),
      "dialogue", len(dialogue_ex), "writing", len(writing_ex))
