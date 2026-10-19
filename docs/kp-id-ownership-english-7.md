# english-7 知识点 ID 归属对照表（E-01 回归夹具）

> 只读解析 `content/english-7-up-rjb/*.lpkgset.zip` 与 `content/**/*.json` 生成，未修改任何应用代码。
> 用途：QA 回归夹具（§1）+ 「网络包 vs 裸 JSON 单文件」两条导入路径的差异证据（§2）。

## 0. 结论（先读）

1. **运行时真实数据（zip）里，english-7 没有任何 id 歧义**：全库 472 个被声明的 kpId，每个只被 **1 个包**声明；`::` 前缀完整，p1~p7 的 7 类知识点是 **7×7 个不同 id**（§1 共 48 行，缺失项来自 p5 未定义 `kp-grammar-002`）。
2. §1 可直接当断言夹具：任意两行的 `kpId` 必须两两不相等；`packageId + unitId` 必须与表一致。
3. **同名短 id 冲突只存在于 `content/english-7-up-rjb/*.json`（构建中间产物，共 49 行）**，也就是「用户手工导入裸 JSON 单文件」这条路径。zip 分发路径不受影响。
4. ⇒ 若产品支持单文件导入，必须在导入侧做 id 前缀重写（`scripts/lib/idRewrite.ts` 已有能力）；否则会出现「同名不同义」被进度合并串数据。

## 1. 运行时（zip）对照表

| kpId | 包 id | unitId | title | packageType |
|---|---|---|---|---|
| `unit-english-7-up-rjb-p1::kp-grammar-001` | `unit-english-7-up-rjb-p1` | `unit-english-7-up-rjb-p1::u1` | 语法：一般现在时 be 动词 (am, is, are) | unit |
| `unit-english-7-up-rjb-p1::kp-grammar-002` | `unit-english-7-up-rjb-p1` | `unit-english-7-up-rjb-p1::u1` | 语法：主格代词 (Subject Pronouns) | unit |
| `unit-english-7-up-rjb-p1::kp-phonetic-001` | `unit-english-7-up-rjb-p1` | `unit-english-7-up-rjb-p1::u1` | 语音：元音字母发音与缩略形式 | unit |
| `unit-english-7-up-rjb-p1::kp-reading-001` | `unit-english-7-up-rjb-p1` | `unit-english-7-up-rjb-p1::u1` | 阅读：寻找朋友的帖子 (Looking for Friends) | unit |
| `unit-english-7-up-rjb-p1::kp-sentence-001` | `unit-english-7-up-rjb-p1` | `unit-english-7-up-rjb-p1::u1` | 核心句型：自我介绍与问候 | unit |
| `unit-english-7-up-rjb-p1::kp-word-001` | `unit-english-7-up-rjb-p1` | `unit-english-7-up-rjb-p1::u1` | 核心词汇：结识新朋友 (Meeting New Friends) | unit |
| `unit-english-7-up-rjb-p1::kp-writing-001` | `unit-english-7-up-rjb-p1` | `unit-english-7-up-rjb-p1::u1` | 写作：制作个人档案与回复帖子 | unit |
| `unit-english-7-up-rjb-p2::kp-grammar-001` | `unit-english-7-up-rjb-p2` | `unit-english-7-up-rjb-p2::u2` | 语法：一般现在时实义动词 (Simple Present Tense: do/does) | unit |
| `unit-english-7-up-rjb-p2::kp-grammar-002` | `unit-english-7-up-rjb-p2` | `unit-english-7-up-rjb-p2::u2` | 语法：名词所有格 (Possessive 's) | unit |
| `unit-english-7-up-rjb-p2::kp-phonetic-001` | `unit-english-7-up-rjb-p2` | `unit-english-7-up-rjb-p2::u2` | 语音：/ɜ:/, /ə/, /ʌ/, /ɑ:/ 与单词重音 | unit |
| `unit-english-7-up-rjb-p2::kp-reading-001` | `unit-english-7-up-rjb-p2` | `unit-english-7-up-rjb-p2::u2` | 阅读：一张家庭照片的描述 (A Family Photo) | unit |
| `unit-english-7-up-rjb-p2::kp-sentence-001` | `unit-english-7-up-rjb-p2` | `unit-english-7-up-rjb-p2::u2` | 核心句型：询问与描述家庭 (Asking and Describing Family) | unit |
| `unit-english-7-up-rjb-p2::kp-word-001` | `unit-english-7-up-rjb-p2` | `unit-english-7-up-rjb-p2::u2` | 核心词汇：家庭成员与职业 (Family Members and Jobs) | unit |
| `unit-english-7-up-rjb-p2::kp-writing-001` | `unit-english-7-up-rjb-p2` | `unit-english-7-up-rjb-p2::u2` | 写作：用照片介绍你的家庭 (Introducing Your Family with a Photo) | unit |
| `unit-english-7-up-rjb-p3::kp-grammar-001` | `unit-english-7-up-rjb-p3` | `unit-english-7-up-rjb-p3::u3` | 语法：There be 结构 | unit |
| `unit-english-7-up-rjb-p3::kp-grammar-002` | `unit-english-7-up-rjb-p3` | `unit-english-7-up-rjb-p3::u3` | 语法：方位介词 (Prepositions of Position) | unit |
| `unit-english-7-up-rjb-p3::kp-phonetic-001` | `unit-english-7-up-rjb-p3` | `unit-english-7-up-rjb-p3::u3` | 语音：/ɔ:/, /ɒ/, /u:/, /ʊ/ 与单词重音 (2) | unit |
| `unit-english-7-up-rjb-p3::kp-reading-001` | `unit-english-7-up-rjb-p3` | `unit-english-7-up-rjb-p3::u3` | 阅读：一封关于新学校的电子邮件 (An Email About the New School) | unit |
| `unit-english-7-up-rjb-p3::kp-sentence-001` | `unit-english-7-up-rjb-p3` | `unit-english-7-up-rjb-p3::u3` | 核心句型：介绍学校与位置询问 (Introducing School and Asking for Locations) | unit |
| `unit-english-7-up-rjb-p3::kp-word-001` | `unit-english-7-up-rjb-p3` | `unit-english-7-up-rjb-p3::u3` | 核心词汇：学校场所与设施 (School Places and Facilities) | unit |
| `unit-english-7-up-rjb-p3::kp-writing-001` | `unit-english-7-up-rjb-p3` | `unit-english-7-up-rjb-p3::u3` | 写作：给朋友写邮件描述你的学校 (Emailing a Friend to Describe Your School) | unit |
| `unit-english-7-up-rjb-p4::kp-grammar-001` | `unit-english-7-up-rjb-p4` | `unit-english-7-up-rjb-p4::u4` | 语法：连词 and, but, because | unit |
| `unit-english-7-up-rjb-p4::kp-grammar-002` | `unit-english-7-up-rjb-p4` | `unit-english-7-up-rjb-p4::u4` | 语法：Wh- 特殊疑问句 (Wh- Questions) | unit |
| `unit-english-7-up-rjb-p4::kp-phonetic-001` | `unit-english-7-up-rjb-p4` | `unit-english-7-up-rjb-p4::u4` | 语音：双元音与连读 (Diphthongs and Linking) | unit |
| `unit-english-7-up-rjb-p4::kp-reading-001` | `unit-english-7-up-rjb-p4` | `unit-english-7-up-rjb-p4::u4` | 阅读：关于学校科目的帖子 (Posts about School Subjects) | unit |
| `unit-english-7-up-rjb-p4::kp-sentence-001` | `unit-english-7-up-rjb-p4` | `unit-english-7-up-rjb-p4::u4` | 核心句型：谈论喜欢的学科与原因 (Talking about Favourite Subjects and Reasons) | unit |
| `unit-english-7-up-rjb-p4::kp-word-001` | `unit-english-7-up-rjb-p4` | `unit-english-7-up-rjb-p4::u4` | 核心词汇：学科名称与描述词 (Subjects and Descriptive Words) | unit |
| `unit-english-7-up-rjb-p4::kp-writing-001` | `unit-english-7-up-rjb-p4` | `unit-english-7-up-rjb-p4::u4` | 写作：写一篇关于你学科的帖子 (Writing a Post about Your Subjects) | unit |
| `unit-english-7-up-rjb-p5::kp-grammar-001` | `unit-english-7-up-rjb-p5` | `unit-english-7-up-rjb-p5::u5` | 语法：情态动词 can (Modal Verb for Ability) | unit |
| `unit-english-7-up-rjb-p5::kp-phonetic-001` | `unit-english-7-up-rjb-p5` | `unit-english-7-up-rjb-p5::u5` | 语音：辅音与不完全爆破 (Consonants and Incomplete Plosion) | unit |
| `unit-english-7-up-rjb-p5::kp-reading-001` | `unit-english-7-up-rjb-p5` | `unit-english-7-up-rjb-p5::u5` | 阅读：学校社团招募广告 (School Club Ads) | unit |
| `unit-english-7-up-rjb-p5::kp-sentence-001` | `unit-english-7-up-rjb-p5` | `unit-english-7-up-rjb-p5::u5` | 核心句型：询问与表达加入社团的意愿 (Asking and Expressing Club Preferences) | unit |
| `unit-english-7-up-rjb-p5::kp-word-001` | `unit-english-7-up-rjb-p5` | `unit-english-7-up-rjb-p5::u5` | 核心词汇：俱乐部名称与活动 (Club Names and Activities) | unit |
| `unit-english-7-up-rjb-p5::kp-writing-001` | `unit-english-7-up-rjb-p5` | `unit-english-7-up-rjb-p5::u5` | 写作：写邮件申请加入俱乐部 (Emailing a Club Leader to Join the Club) | unit |
| `unit-english-7-up-rjb-p6::kp-grammar-001` | `unit-english-7-up-rjb-p6` | `unit-english-7-up-rjb-p6::u6` | 语法：时间表达法 (Time Expressions) | unit |
| `unit-english-7-up-rjb-p6::kp-grammar-002` | `unit-english-7-up-rjb-p6` | `unit-english-7-up-rjb-p6::u6` | 语法：Wh- 疑问句 (Wh- Questions: what time, when, what) | unit |
| `unit-english-7-up-rjb-p6::kp-phonetic-001` | `unit-english-7-up-rjb-p6` | `unit-english-7-up-rjb-p6::u6` | 语音：辅音音素与句子重音 (Consonants and Sentence Stress) | unit |
| `unit-english-7-up-rjb-p6::kp-reading-001` | `unit-english-7-up-rjb-p6` | `unit-english-7-up-rjb-p6::u6` | 阅读：一个芬兰男孩的学校日 (A School Day of a Boy from Finland) | unit |
| `unit-english-7-up-rjb-p6::kp-sentence-001` | `unit-english-7-up-rjb-p6` | `unit-english-7-up-rjb-p6::u6` | 核心句型：询问和描述日常作息 (Asking and Describing Daily Routines) | unit |
| `unit-english-7-up-rjb-p6::kp-word-001` | `unit-english-7-up-rjb-p6` | `unit-english-7-up-rjb-p6::u6` | 核心词汇：日常活动与时间表达 (Daily Activities and Time) | unit |
| `unit-english-7-up-rjb-p6::kp-writing-001` | `unit-english-7-up-rjb-p6` | `unit-english-7-up-rjb-p6::u6` | 写作：写一篇关于你的学校日的短文 (Writing about Your School Day) | unit |
| `unit-english-7-up-rjb-p7::kp-grammar-001` | `unit-english-7-up-rjb-p7` | `unit-english-7-up-rjb-p7::u7` | 语法：序数词 (Ordinal Numbers) | unit |
| `unit-english-7-up-rjb-p7::kp-grammar-002` | `unit-english-7-up-rjb-p7` | `unit-english-7-up-rjb-p7::u7` | 语法：Wh- 疑问句复习 (Wh- Questions Review) | unit |
| `unit-english-7-up-rjb-p7::kp-phonetic-001` | `unit-english-7-up-rjb-p7` | `unit-english-7-up-rjb-p7::u7` | 语音：辅音音素与语调 (Consonants and Intonation) | unit |
| `unit-english-7-up-rjb-p7::kp-reading-001` | `unit-english-7-up-rjb-p7` | `unit-english-7-up-rjb-p7::u7` | 阅读：关于生日的帖子 (Posts about Birthdays) | unit |
| `unit-english-7-up-rjb-p7::kp-sentence-001` | `unit-english-7-up-rjb-p7` | `unit-english-7-up-rjb-p7::u7` | 核心句型：询问生日与庆祝方式 (Asking about Birthdays and Celebrations) | unit |
| `unit-english-7-up-rjb-p7::kp-word-001` | `unit-english-7-up-rjb-p7` | `unit-english-7-up-rjb-p7::u7` | 核心词汇：生日与庆祝活动 (Birthdays and Celebrations) | unit |
| `unit-english-7-up-rjb-p7::kp-writing-001` | `unit-english-7-up-rjb-p7` | `unit-english-7-up-rjb-p7::u7` | 写作：写一篇关于你如何庆祝生日的帖子 (Writing a Post about How You Celebrate Your Birthday) | unit |

### 1.1 唯一性断言（QA 可直接用）

- §1 的 `kpId` 去重后行数必须仍为 48（即零重复）。
- 7 类短名的分布：
  - `kp-grammar-001` → 7 个唯一 id（跨 p1~p7）
  - `kp-grammar-002` → 6 个唯一 id（跨 p1~p7）
  - `kp-phonetic-001` → 7 个唯一 id（跨 p1~p7）
  - `kp-reading-001` → 7 个唯一 id（跨 p1~p7）
  - `kp-sentence-001` → 7 个唯一 id（跨 p1~p7）
  - `kp-word-001` → 7 个唯一 id（跨 p1~p7）
  - `kp-writing-001` → 7 个唯一 id（跨 p1~p7）

## 2. 裸 JSON（单文件导入）歧义清单

> 这些行的 `kpId` 是**短 id**，多个包复用同一字符串表示**不同知识点**。若直接导入，`(packageId, kpId)` 复合键仍能区分，但任何「按 kpId 去重 / stripPrefix 后比较」的逻辑都会串数据。

| kpId（短） | 包 id | unitId | title | packageType |
|---|---|---|---|---|
| `kp-grammar-001` | `unit-english-7-up-rjb-p1` | `u1` | 语法：一般现在时 be 动词 (am, is, are) | unit |
| `kp-grammar-001` | `unit-english-7-up-rjb-p2` | `u2` | 语法：一般现在时实义动词 (Simple Present Tense: do/does) | unit |
| `kp-grammar-001` | `unit-english-7-up-rjb-p3` | `u3` | 语法：There be 结构 | unit |
| `kp-grammar-001` | `unit-english-7-up-rjb-p4` | `u4` | 语法：连词 and, but, because | unit |
| `kp-grammar-001` | `unit-english-7-up-rjb-p5` | `u5` | 语法：情态动词 can (Modal Verb for Ability) | unit |
| `kp-grammar-001` | `unit-english-7-up-rjb-p6` | `u6` | 语法：时间表达法 (Time Expressions) | unit |
| `kp-grammar-001` | `unit-english-7-up-rjb-p7` | `u7` | 语法：序数词 (Ordinal Numbers) | unit |
| `kp-grammar-002` | `unit-english-7-up-rjb-p1` | `u1` | 语法：主格代词 (Subject Pronouns) | unit |
| `kp-grammar-002` | `unit-english-7-up-rjb-p2` | `u2` | 语法：名词所有格 (Possessive 's) | unit |
| `kp-grammar-002` | `unit-english-7-up-rjb-p3` | `u3` | 语法：方位介词 (Prepositions of Position) | unit |
| `kp-grammar-002` | `unit-english-7-up-rjb-p4` | `u4` | 语法：Wh- 特殊疑问句 (Wh- Questions) | unit |
| `kp-grammar-002` | `unit-english-7-up-rjb-p6` | `u6` | 语法：Wh- 疑问句 (Wh- Questions: what time, when, what) | unit |
| `kp-grammar-002` | `unit-english-7-up-rjb-p7` | `u7` | 语法：Wh- 疑问句复习 (Wh- Questions Review) | unit |
| `kp-phonetic-001` | `unit-english-7-up-rjb-p1` | `u1` | 语音：元音字母发音与缩略形式 | unit |
| `kp-phonetic-001` | `unit-english-7-up-rjb-p2` | `u2` | 语音：/ɜ:/, /ə/, /ʌ/, /ɑ:/ 与单词重音 | unit |
| `kp-phonetic-001` | `unit-english-7-up-rjb-p3` | `u3` | 语音：/ɔ:/, /ɒ/, /u:/, /ʊ/ 与单词重音 (2) | unit |
| `kp-phonetic-001` | `unit-english-7-up-rjb-p4` | `u4` | 语音：双元音与连读 (Diphthongs and Linking) | unit |
| `kp-phonetic-001` | `unit-english-7-up-rjb-p5` | `u5` | 语音：辅音与不完全爆破 (Consonants and Incomplete Plosion) | unit |
| `kp-phonetic-001` | `unit-english-7-up-rjb-p6` | `u6` | 语音：辅音音素与句子重音 (Consonants and Sentence Stress) | unit |
| `kp-phonetic-001` | `unit-english-7-up-rjb-p7` | `u7` | 语音：辅音音素与语调 (Consonants and Intonation) | unit |
| `kp-reading-001` | `special-chinese-4-up-reading` | `u1` | 梅雨潭 | special |
| `kp-reading-001` | `unit-english-7-up-rjb-p1` | `u1` | 阅读：寻找朋友的帖子 (Looking for Friends) | unit |
| `kp-reading-001` | `unit-english-7-up-rjb-p2` | `u2` | 阅读：一张家庭照片的描述 (A Family Photo) | unit |
| `kp-reading-001` | `unit-english-7-up-rjb-p3` | `u3` | 阅读：一封关于新学校的电子邮件 (An Email About the New School) | unit |
| `kp-reading-001` | `unit-english-7-up-rjb-p4` | `u4` | 阅读：关于学校科目的帖子 (Posts about School Subjects) | unit |
| `kp-reading-001` | `unit-english-7-up-rjb-p5` | `u5` | 阅读：学校社团招募广告 (School Club Ads) | unit |
| `kp-reading-001` | `unit-english-7-up-rjb-p6` | `u6` | 阅读：一个芬兰男孩的学校日 (A School Day of a Boy from Finland) | unit |
| `kp-reading-001` | `unit-english-7-up-rjb-p7` | `u7` | 阅读：关于生日的帖子 (Posts about Birthdays) | unit |
| `kp-sentence-001` | `unit-english-7-up-rjb-p1` | `u1` | 核心句型：自我介绍与问候 | unit |
| `kp-sentence-001` | `unit-english-7-up-rjb-p2` | `u2` | 核心句型：询问与描述家庭 (Asking and Describing Family) | unit |
| `kp-sentence-001` | `unit-english-7-up-rjb-p3` | `u3` | 核心句型：介绍学校与位置询问 (Introducing School and Asking for Locations) | unit |
| `kp-sentence-001` | `unit-english-7-up-rjb-p4` | `u4` | 核心句型：谈论喜欢的学科与原因 (Talking about Favourite Subjects and Reasons) | unit |
| `kp-sentence-001` | `unit-english-7-up-rjb-p5` | `u5` | 核心句型：询问与表达加入社团的意愿 (Asking and Expressing Club Preferences) | unit |
| `kp-sentence-001` | `unit-english-7-up-rjb-p6` | `u6` | 核心句型：询问和描述日常作息 (Asking and Describing Daily Routines) | unit |
| `kp-sentence-001` | `unit-english-7-up-rjb-p7` | `u7` | 核心句型：询问生日与庆祝方式 (Asking about Birthdays and Celebrations) | unit |
| `kp-word-001` | `unit-english-7-up-rjb-p1` | `u1` | 核心词汇：结识新朋友 (Meeting New Friends) | unit |
| `kp-word-001` | `unit-english-7-up-rjb-p2` | `u2` | 核心词汇：家庭成员与职业 (Family Members and Jobs) | unit |
| `kp-word-001` | `unit-english-7-up-rjb-p3` | `u3` | 核心词汇：学校场所与设施 (School Places and Facilities) | unit |
| `kp-word-001` | `unit-english-7-up-rjb-p4` | `u4` | 核心词汇：学科名称与描述词 (Subjects and Descriptive Words) | unit |
| `kp-word-001` | `unit-english-7-up-rjb-p5` | `u5` | 核心词汇：俱乐部名称与活动 (Club Names and Activities) | unit |
| `kp-word-001` | `unit-english-7-up-rjb-p6` | `u6` | 核心词汇：日常活动与时间表达 (Daily Activities and Time) | unit |
| `kp-word-001` | `unit-english-7-up-rjb-p7` | `u7` | 核心词汇：生日与庆祝活动 (Birthdays and Celebrations) | unit |
| `kp-writing-001` | `unit-english-7-up-rjb-p1` | `u1` | 写作：制作个人档案与回复帖子 | unit |
| `kp-writing-001` | `unit-english-7-up-rjb-p2` | `u2` | 写作：用照片介绍你的家庭 (Introducing Your Family with a Photo) | unit |
| `kp-writing-001` | `unit-english-7-up-rjb-p3` | `u3` | 写作：给朋友写邮件描述你的学校 (Emailing a Friend to Describe Your School) | unit |
| `kp-writing-001` | `unit-english-7-up-rjb-p4` | `u4` | 写作：写一篇关于你学科的帖子 (Writing a Post about Your Subjects) | unit |
| `kp-writing-001` | `unit-english-7-up-rjb-p5` | `u5` | 写作：写邮件申请加入俱乐部 (Emailing a Club Leader to Join the Club) | unit |
| `kp-writing-001` | `unit-english-7-up-rjb-p6` | `u6` | 写作：写一篇关于你的学校日的短文 (Writing about Your School Day) | unit |
| `kp-writing-001` | `unit-english-7-up-rjb-p7` | `u7` | 写作：写一篇关于你如何庆祝生日的帖子 (Writing a Post about How You Celebrate Your Birthday) | unit |

### 2.1 按短 id 汇总（同 id 不同义）

| 短 id | 复用包数 | 包列表 |
|---|---|---|
| `kp-grammar-001` | 7 | unit-english-7-up-rjb-p1, unit-english-7-up-rjb-p2, unit-english-7-up-rjb-p3, unit-english-7-up-rjb-p4, unit-english-7-up-rjb-p5, unit-english-7-up-rjb-p6, unit-english-7-up-rjb-p7 |
| `kp-grammar-002` | 6 | unit-english-7-up-rjb-p1, unit-english-7-up-rjb-p2, unit-english-7-up-rjb-p3, unit-english-7-up-rjb-p4, unit-english-7-up-rjb-p6, unit-english-7-up-rjb-p7 |
| `kp-phonetic-001` | 7 | unit-english-7-up-rjb-p1, unit-english-7-up-rjb-p2, unit-english-7-up-rjb-p3, unit-english-7-up-rjb-p4, unit-english-7-up-rjb-p5, unit-english-7-up-rjb-p6, unit-english-7-up-rjb-p7 |
| `kp-reading-001` | 8 | special-chinese-4-up-reading, unit-english-7-up-rjb-p1, unit-english-7-up-rjb-p2, unit-english-7-up-rjb-p3, unit-english-7-up-rjb-p4, unit-english-7-up-rjb-p5, unit-english-7-up-rjb-p6, unit-english-7-up-rjb-p7 |
| `kp-sentence-001` | 7 | unit-english-7-up-rjb-p1, unit-english-7-up-rjb-p2, unit-english-7-up-rjb-p3, unit-english-7-up-rjb-p4, unit-english-7-up-rjb-p5, unit-english-7-up-rjb-p6, unit-english-7-up-rjb-p7 |
| `kp-word-001` | 7 | unit-english-7-up-rjb-p1, unit-english-7-up-rjb-p2, unit-english-7-up-rjb-p3, unit-english-7-up-rjb-p4, unit-english-7-up-rjb-p5, unit-english-7-up-rjb-p6, unit-english-7-up-rjb-p7 |
| `kp-writing-001` | 7 | unit-english-7-up-rjb-p1, unit-english-7-up-rjb-p2, unit-english-7-up-rjb-p3, unit-english-7-up-rjb-p4, unit-english-7-up-rjb-p5, unit-english-7-up-rjb-p6, unit-english-7-up-rjb-p7 |

## 3. 与 `resolveOwnerPackage` 的关系

- 若「own」定义为「**该包自己的 units 里引用了 kpId**」：term / sprint / special / daily 的 units 是从 unit 包复制/聚合的，因此同一 kpId 会有 3–5 个候选 → 全库 (入口包, kpId) 组合只有 **49.7%** 能唯一解析（详见调研报告）。
- 若「own」定义为「**该包的 `knowledgePoints` 里声明了 kpId**」：全库 472 个 kpId 每个只有 1 个声明者 → (入口包, kpId) 组合 **100%** 唯一解析，零歧义。
- 代码里已存在这个正确语义：`src/views/learn/TopicDetail.vue:399-407` 的 `ownerPackageIdOf` 扫的就是 `pkg.knowledgePoints`。

