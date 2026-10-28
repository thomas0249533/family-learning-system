/**
 * gen-movers-pack.mjs —— 剑桥少儿英语 Movers 阅读写作 · 学习包生成器
 * =====================================================================
 * 素材来源：`content/资料/` 下三个压缩包（Cambridge University Press & UCLES 2018，
 * Photocopiable）。**仅限家庭自用**，不对外分发。
 *
 * ## 为什么只收 Reading & Writing
 * 原始素材里 Listening 部分带 mp3：`packageAssets` 的 MIME 白名单只有图片
 * （png/jpg/jpeg/webp/gif/svg），单张上限 2MB、单包 8MB，而一个听力音频 7MB 起。
 * 硬塞音频要么撑爆限额，要么得改内核资产层 —— 后者不是做内容该做的事。
 * Speaking 部分本来就是师生对话脚本，无法在自学场景判分。
 * 于是三件事只留一件：**Reading & Writing**，它是唯一能靠文字自洽判分的部分。
 *
 * ## 「适度精简」的具体口径
 *   · 保留能靠**文本自身**作答的题（选词填空、看释义选词、故事细节填空、短文问答）；
 *   · 看图题只在**能把图完整取出来**时才收（U1 的沙滩图、模拟卷 Part 6 的海盗图）；
 *   · 自由写作（Part 7「写 20 个词以上」、Part 6 最后两句）不收 —— 得分点无法客观定；
 *   · 每道题的答案与解析都回到原文句子，孩子答错时能看到为什么。
 *
 * ## 答案写法约定（与判分内核一致，改之前先读 src/core/quiz/blank.ts）
 *   · `normalizeBlank` 会**删掉所有空格并转小写**，所以 `the basement` 与
 *     `thebasement` 等价；但 `basement` ≠ `thebasement`（备选是精确匹配，不走子串）。
 *   · 一个空的多种正确写法用 **斜杠 + 两侧空格** 并列：`the basement / basement`。
 *   · 多空（逗号分隔）的题本集合里没有 —— 全是单空。
 *
 * 用法：`node scripts/content/gen-movers-pack.mjs`
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = resolve(process.cwd())
const OUT = join(ROOT, 'content', 'english-movers-cep')
const IMG = join(ROOT, '.tmp-l3', 'img')

const GRID = { grade: 4, term: 'up', edition: '剑桥少儿英语' }

// ---------------------------------------------------------------------------
// 小工具：收敛重复字段，避免手写字面量时把 options 的字母写错
// ---------------------------------------------------------------------------

/** 单选题：opts 三选一，correct 是选项序号（0/1/2），自动生成 `A. …` 与答案字母 */
function choice(id, type, question, opts, correct, explanation, kp, diff = '基础', extra = {}) {
  const letters = ['A', 'B', 'C', 'D']
  return {
    id,
    type,
    question,
    options: opts.map((o, i) => `${letters[i]}. ${o}`),
    answer: letters[correct],
    explanation,
    knowledgePointIds: [kp],
    metadata: { difficulty: diff },
    ...extra,
  }
}

/** 填空题：`answer` 里可以写 `正解A / 正解B`（斜杠两侧必须有空格） */
function blank(id, question, answer, explanation, kp, diff = '基础') {
  return {
    id,
    type: 'blank',
    question,
    answer,
    explanation,
    knowledgePointIds: [kp],
    metadata: { difficulty: diff },
  }
}

/** 阅读正文（挂 english.reading，渲染在题目上方，孩子先读再答） */
function passageKp(id, title, content, wordCount, translation) {
  return {
    id,
    type: 'skill',
    title,
    content,
    prerequisites: [],
    metadata: { wordCount, translation },
  }
}

function skillKp(id, title, content) {
  return { id, type: 'skill', title, content, prerequisites: [] }
}

/**
 * 知识点索引：`topic()` 要用它决定「这个 topic 该挂哪几个 module」。
 * 规则只有一条 —— **有 wordCount 的是阅读正文，其余是做题要点**，
 * 正文用 english.reading（原样保留换行），要点用 english.grammar（走 markdown）。
 */
const KP_INDEX = new Map()
/** 建立索引。也顺手查重：同一 id 出现两次会让 module 里挂错内容 */
function registerKps(list) {
  for (const kp of list) {
    if (KP_INDEX.has(kp.id)) throw new Error(`知识点 id 重复：${kp.id}`)
    KP_INDEX.set(kp.id, kp)
  }
  return list
}

/**
 * 组一个 topic。modules 不再手写 —— 由 kpIds 自动推导：
 * 先「读一读」（阅读正文），再「做题要点」（技巧/词汇讲解）。
 * 手写 modules 很容易漏（W031 ×7 就是这么来的），推导则不可能漏。
 */
function topic(id, title, kpIds, _modules, exercises) {
  const reading = []
  const notes = []
  for (const kid of kpIds) {
    const kp = KP_INDEX.get(kid)
    if (!kp) throw new Error(`topic ${id} 引用了未注册的知识点：${kid}`)
    if (kp.metadata?.wordCount) reading.push(kid)
    else notes.push(kid)
  }
  const modules = []
  if (reading.length) {
    modules.push({ id: `${id}-m-read`, type: 'english.reading', title: '读一读', knowledgePointIds: reading })
  }
  if (notes.length) {
    modules.push({ id: `${id}-m-note`, type: 'english.grammar', title: '做题要点', knowledgePointIds: notes })
  }
  return {
    id,
    title,
    desc: '',
    board: '',
    knowledgePointIds: kpIds,
    modules,
    exercises,
  }
}

// ---------------------------------------------------------------------------
// 包 1 · 单元精练（Movers R&W Part 4 / 5 / 6 + Flyers R&W Part 1）
// ---------------------------------------------------------------------------

const unitKps = [
  skillKp(
    'kp-enmv-u1-pic',
    '看图回答：先找位置，再找颜色',
    [
      '这类题（Movers R&W Part 6）只考一件事：**把画面看准**。三个固定动作，按顺序做就不会错：',
      '① 先定位「谁/什么」——题目里的名词在图上哪个角落；',
      '② 再看「相对位置」——in / on / under / behind / next to / in front of。题目问 behind，就找谁挡在它前面；',
      '③ 最后看「颜色与衣物」——问 wearing 时只答衣物或颜色，不要答动作。',
      '常见坑：图上有两个女孩（一个在水里、一个站在浅水里），问 in the water 的那个，别答成另一个。',
    ].join('\n'),
  ),
  skillKp(
    'kp-enmv-u3-lion',
    '一般现在时 + every day + 宾格代词',
    [
      '这篇短文全是一般现在时（讲狮子这类动物的事实），所以动词要跟主语一致：',
      '· lions（复数）→ eat / like / play，不加 s；it / he / she（单数第三人称）→ 加 s。',
      '· 情态动词 must 后面永远跟动词原形：must drink（不是 must drinks）。',
      '· 频度：every day / every week（每天/每周）；any 只用在否定句和疑问句里。',
      '· 宾格：see **them**（lions 是复数，不能用 it / him）。',
      '判断口诀：先看主语单复数，再看空前有没有 must / do / can。',
    ].join('\n'),
  ),
  skillKp(
    'kp-enmv-u4-story',
    '故事填空：时间、人物、地点三把钥匙',
    [
      'Part 5 的填空答案全部能在原文里找到，只是换了说法。做题顺序：',
      '① 先读题目句子，圈出疑问词/关键词（when → 找时间；who → 找人物；where → 找地点）；',
      '② 回原文找同义句：题目 "liked ___ best" ↔ 原文 "their favourite hobby was dancing"；',
      '③ 抄词时**只写 1–3 个词**，不要整句照搬；动词注意原形/ing。',
      '本题四个高频考点：favourite hobby → dancing；On Saturdays → Saturdays；talked to her dad → dad；at the market on Wednesday → Wednesday。',
    ].join('\n'),
  ),
  {
    id: 'kp-enmv-u7-def',
    type: 'word',
    title: '看英文释义选词：抓住「类别词 + 特征」',
    content: [
      '英文释义题的骨架永远是「类别词 + 特征」：',
      '· "This is a **building** where …" → 答案是建筑物（airport / hotel / castle / bank）；',
      '· "These **insects** have …" → 答案是昆虫（butterflies）；',
      '· "This **animal** has eight legs …" → 答案是动物（octopus / camel）。',
      '先认类别词，再对特征，最后才看拼写。本组 13 个词按类别分：',
      '建筑地点：an airport, hotels, banks, castles, a bus stop；食物：salt, jam, cereal, a pizza, biscuits；动物：butterflies, swans, an octopus, camels。',
    ].join('\n'),
    prerequisites: [],
  },
]

const u1q = [
  choice(
    'mv-u1-01',
    'single',
    'The whale is in the sea behind ____.（图：鲸鱼在大海里，前面挡着什么？）',
    ['a big rock', 'the island', 'a ship'],
    0,
    '鲸鱼在海水里，它前方挡着一块灰色的大石头（the big rock）。岛在鲸鱼左边远处，船在更左边，都不是「鲸鱼身后/前面的遮挡物」。',
    'kp-enmv-u1-pic',
  ),
  choice(
    'mv-u1-02',
    'single',
    'There are four trees on ____.（图：四棵树长在哪里？）',
    ['the island', 'the beach', 'the rock'],
    0,
    '海里那个小岛上有四棵椰子树（four trees on the island）。沙滩上只有一棵大树，石头上什么都没有。',
    'kp-enmv-u1-pic',
  ),
  choice(
    'mv-u1-03',
    'single',
    'What is next to the ball?（图：球旁边是谁？）',
    ['A toy kangaroo.', 'A toy rabbit.', 'A bag.'],
    0,
    '球在沙滩左下角，紧挨着它的是一只玩具袋鼠（a toy kangaroo）。包（bag）在毛巾旁边，不挨着球。',
    'kp-enmv-u1-pic',
  ),
  choice(
    'mv-u1-04',
    'single',
    'What is the girl who is sitting in the water wearing?（图：坐在水里的女孩穿什么？）',
    ['A purple swimsuit.', 'A pink swimsuit.', 'A blue T-shirt.'],
    0,
    '水里有两个人：坐/蹲在水里的女孩穿**紫色**泳衣；站着扶游泳圈的女孩穿**粉色**泳衣。题目问 in the water 的那位 → purple。',
    'kp-enmv-u1-pic',
  ),
]

const u3q = [
  choice(
    'mv-u3-01',
    'single',
    'They have very big teeth because they only (1) ____ meat.',
    ['eat', 'eating', 'ate'],
    0,
    '主语 they（狮子）讲的是一般事实，用一般现在时；only 后面的动词用原形 eat。eating 需要 be 动词，ate 是过去时（这里没有过去的时间）。',
    'kp-enmv-u3-lion',
  ),
  choice(
    'mv-u3-02',
    'single',
    'Lions like sitting on the ground or on rocks, and (2) ____ in the sun.',
    ['sleeping', 'sleeps', 'slept'],
    0,
    'and 连接两个并列动作，前面是 like sitting，后面必须同样是 -ing：like sleeping。like 后面跟 doing 表示「喜欢做某事」。',
    'kp-enmv-u3-lion',
  ),
  choice(
    'mv-u3-03',
    'single',
    'Because lions must drink water (3) ____ day, you can sometimes see them next to a river.',
    ['every', 'any', 'another'],
    0,
    '「每一天」是 every day。any 只用于否定句和疑问句（not any / Do you have any…），another 后面接单数名词表示「另一个」，不能跟 day 表频率。',
    'kp-enmv-u3-lion',
  ),
  choice(
    'mv-u3-04',
    'single',
    'You can sometimes see (4) ____ next to a river.',
    ['them', 'it', 'him'],
    0,
    '前面说的是 lions（复数动物），代词要用宾格复数 them。it 指单数物，him 指单数男性。',
    'kp-enmv-u3-lion',
  ),
  choice(
    'mv-u3-05',
    'single',
    'Smaller cats (5) ____ not like being in water.',
    ['do', 'have', 'are'],
    0,
    '一般现在时的否定：主语是复数 cats，用 do not + 动词原形（do not like）。have not like / are not like 都不成立。',
    'kp-enmv-u3-lion',
  ),
]

const u4passage = `Sally had a best friend and her name was Lucy. The girls both liked playing tennis but their favourite hobby was dancing and they had lots of great CDs. On Saturdays, they often went to the shops in town with Sally's big sister. Sometimes they bought new jeans or T-shirts there.

One morning, Sally said to her dad, 'It's Lucy's birthday this week. Her party is on Sunday. Can I have a new dress to wear for it?'
'Yes!' he said. 'But you never wear dresses, Sally!'
'Well, it's easier to dance in jeans,' she answered. 'But I'd like a dress for the party.'
'There's a market,' he said. 'We can go and find you a dress there.'
And they did. Sally's dad bought her a beautiful white one.

On Sunday afternoon, she went to the party at Lucy's house in her new dress. Lucy saw Sally and Sally saw Lucy and they both started to laugh. 'We always wear jeans and T-shirts!' Sally said. 'But today we're both wearing dresses! Where did you buy yours?' 'At the market on Wednesday,' Lucy answered. 'And you?' 'At the market on Wednesday, like you!' laughed Sally. 'And I bought this for you there too.'
'Oh great! A CD! Thanks!' said Lucy.`

const u4q = [
  blank(
    'mv-u4-01',
    'Sally and Lucy liked ____ best.（填 1–3 个词）',
    'dancing',
    '原文 "their favourite hobby was dancing" —— favourite hobby 就是 like … best，所以填 dancing（注意 -ing）。',
    'kp-enmv-u4-story',
  ),
  blank(
    'mv-u4-02',
    'The girls often went shopping on ____ .',
    'Saturdays / Saturday',
    '原文 "On Saturdays, they often went to the shops in town" —— 题目问的是星期几，答案是 Saturdays（每个周六）。',
    'kp-enmv-u4-story',
  ),
  blank(
    'mv-u4-03',
    "Sally talked to ____ about the party at Lucy's.",
    'her dad / dad / her father / father / daddy',
    '原文 "One morning, Sally said to her dad" —— 跟她说话的是爸爸。写 her dad 或 dad 都对。',
    'kp-enmv-u4-story',
  ),
  blank(
    'mv-u4-04',
    'Sally wanted to wear a ____ to the party.',
    'dress / a dress / new dress / a new dress',
    '原文 "Can I have a new dress to wear for it?" —— 她想穿连衣裙去派对。冠词写不写都对。',
    'kp-enmv-u4-story',
  ),
  blank(
    'mv-u4-05',
    "It was Dad's idea to go shopping at the ____ that day.",
    'market / a market / the market',
    '原文是爸爸提议 "There is a market. We can go and find you a dress there." —— 去的是集市（market）。',
    'kp-enmv-u4-story',
  ),
  blank(
    'mv-u4-06',
    'Both girls bought their party clothes on ____ from the market.',
    'Wednesday / on Wednesday',
    '原文两个人异口同声 "At the market on Wednesday" —— 都是周三在集市买的。星期名首字母要大写。',
    'kp-enmv-u4-story',
  ),
  blank(
    'mv-u4-07',
    'Sally gave Lucy ____ for her birthday.',
    'a CD / CD / the CD',
    '礼物是 CD：Lucy 说 "Oh great! A CD! Thanks!" —— 答案写 a CD 或 CD 都行。',
    'kp-enmv-u4-story',
  ),
]

const u7q = [
  choice(
    'mv-u7-01',
    'single',
    'This is a building where you can go if you want to catch a plane.',
    ['an airport', 'a bus stop', 'a hotel'],
    0,
    'catch a plane（坐飞机）的地方是机场 an airport。a bus stop 是等公交的地方，a hotel 是住的地方。',
    'kp-enmv-u7-def',
  ),
  choice(
    'mv-u7-02',
    'single',
    "You find these in most towns, and people stay in them when they're away from home.",
    ['hotels', 'banks', 'castles'],
    0,
    '「离家在外时住在那里」→ 旅馆 hotels。banks 是取钱的银行，castles 是城堡（不住客）。',
    'kp-enmv-u7-def',
  ),
  choice(
    'mv-u7-03',
    'single',
    'People often put this on their food. It is white and you get it from the sea.',
    ['salt', 'jam', 'cereal'],
    0,
    '白白的、从海里来的、放在食物上的 → 盐 salt。jam 是果酱（甜、水果做），cereal 是麦片（早餐）。',
    'kp-enmv-u7-def',
  ),
  choice(
    'mv-u7-04',
    'single',
    'These insects have beautiful wings and fly from flower to flower.',
    ['butterflies', 'swans', 'camels'],
    0,
    'insects（昆虫）+ 花间飞 → 蝴蝶 butterflies。swans 是天鹅（鸟），camels 是骆驼（哺乳动物）。',
    'kp-enmv-u7-def',
  ),
  choice(
    'mv-u7-05',
    'single',
    'This is made from sugar and different kinds of fruit. People often put it on bread.',
    ['jam', 'a pizza', 'biscuits'],
    0,
    '糖 + 水果做的、涂在面包上 → 果酱 jam。a pizza 是烤的咸食，biscuits 是饼干。',
    'kp-enmv-u7-def',
  ),
  choice(
    'mv-u7-06',
    'single',
    'This animal has eight legs and lives near rocks in the sea.',
    ['an octopus', 'a snail', 'a swan'],
    0,
    '八条腿 + 海里的石头旁 → 章鱼 an octopus。a snail 是蜗牛（陆生，壳），a swan 是水上的天鹅（两条腿）。',
    'kp-enmv-u7-def',
  ),
  choice(
    'mv-u7-07',
    'single',
    'Towns and cities usually have a lot of these and you go to them to get money.',
    ['banks', 'castles', 'hotels'],
    0,
    '去那里取钱 → 银行 banks。castles 是古迹，hotels 是住宿。',
    'kp-enmv-u7-def',
  ),
  choice(
    'mv-u7-08',
    'single',
    'In story books for young children these are usually the homes of kings and queens.',
    ['castles', 'banks', 'bus stops'],
    0,
    '国王和王后的家 → 城堡 castles（童话里的固定设定）。',
    'kp-enmv-u7-def',
  ),
  choice(
    'mv-u7-09',
    'single',
    'You cook this in an oven. It usually has cheese and tomatoes on the top.',
    ['a pizza', 'jam', 'cereal'],
    0,
    '烤箱 + 上面有奶酪和番茄 → 披萨 a pizza。jam 不烤，cereal 是冷食冲牛奶。',
    'kp-enmv-u7-def',
  ),
  choice(
    'mv-u7-10',
    'single',
    'Some people ride these animals when they need to travel across hot, dry places like deserts.',
    ['camels', 'swans', 'butterflies'],
    0,
    '沙漠里骑的动物 → 骆驼 camels（驼峰储脂肪，能走很久不喝水）。',
    'kp-enmv-u7-def',
  ),
]

// 阅读正文单独建 kp（挂 english.reading，孩子先读再答）。
// 必须在 packUnit 之前注册：topic() 靠 KP_INDEX 决定挂哪个 module。
const unitPassages = registerKps([
  passageKp(
    'kp-enmv-u3-passage',
    'Lions',
    `Lions are a kind of big cat. They live in hot places. They are very strong animals and they can run very quickly. They have very big teeth because they only eat meat.

Lions like sitting on the ground or on rocks, and sleeping in the sun. But because lions must drink water every day, you can sometimes see them next to a river. Smaller cats do not like being in water, but lions often play or go swimming in it.`,
    62,
    '狮子是一种大型猫科动物。它们住在炎热的地方，很强壮，跑得很快。它们的牙齿很大，因为它们只吃肉。狮子喜欢坐在地上或岩石上，在太阳下睡觉。因为狮子必须每天喝水，所以有时你能在河边看到它们。小型猫科动物不喜欢待在水里，但狮子常常在水里玩耍或游泳。',
  ),
  passageKp(
    'kp-enmv-u4-passage',
    'Sally and Lucy',
    u4passage,
    208,
    'Sally 最好的朋友叫 Lucy。两个女孩都喜欢打网球，但她们最喜欢的爱好是跳舞，也有很多好听的 CD。周六她们常常和 Sally 的姐姐一起去城里的商店，有时会买新牛仔裤或 T 恤。\n\n一天早上，Sally 对爸爸说：「这周是 Lucy 的生日，她的派对在周日。我能买一条新连衣裙穿去吗？」「可以！」爸爸说，「可你从来不穿裙子呀，Sally！」「穿牛仔裤跳舞更方便，」她回答，「但派对那天我想穿裙子。」「有个集市，」爸爸说，「我们可以去那儿给你找一条。」他们真的去了，爸爸给她买了一条漂亮的白裙子。\n\n周日下午，她穿着新裙子去 Lucy 家参加派对。两人一见对方就都笑了。「我们平时总穿牛仔裤和 T 恤！」Sally 说，「可今天我们俩都穿了裙子！你的在哪里买的？」「周三在集市上，」Lucy 回答，「你呢？」「也是周三，在集市上，跟你一样！」Sally 笑着说，「我还在那儿给你买了这个。」「太好了！一张 CD！谢谢！」Lucy 说。',
  ),
])
registerKps(unitKps)

const packUnit = {
  schemaVersion: '1.0',
  manifest: {
    schemaVersion: '1.0',
    packageId: 'special-english-movers-unit',
    packageType: 'special',
    isInternal: false,
    examMode: false,
    subject: 'english',
    templateId: 'english.primary.v1',
    grade: GRID.grade,
    term: GRID.term,
    edition: GRID.edition,
    title: '剑桥 Movers · 单元阅读写作精练',
    dependencies: [],
  },
  knowledgePoints: [...unitKps, ...unitPassages],
  units: [
    {
      id: 'mv-u1',
      name: 'Unit 1 看图回答',
      title: '看图回答：沙滩上的十件事',
      desc: 'Movers Reading & Writing Part 6 真题：看图补全句子、回答关于画面的问题。',
      topics: [
        topic(
          'mv-u1-t1',
          '看图回答问题',
          ['kp-enmv-u1-pic'],
          [],
          u1q.map((q) => ({
            ...q,
            image: 'assets/beach-scene.jpeg',
            imageAlt:
              '海滩场景：一个女人躺在沙滩椅上看书，两个玻璃杯和一条毛巾在地上，左边有个彩球和玩具袋鼠，海里有鲸鱼、船、小岛，一个女孩在水里、一个女孩扶着游泳圈',
          })),
        ),
      ],
    },
    {
      id: 'mv-u3',
      name: 'Unit 3 狮子短文',
      title: '狮子短文选词（一般现在时）',
      desc: 'Movers R&W Part 4：一空三选，考时态、频度与代词。',
      topics: [
        topic(
          'mv-u3-t1',
          'Lions · 狮子',
          ['kp-enmv-u3-lion', 'kp-enmv-u3-passage'],
          [],
          u3q,
        ),
      ],
    },
    {
      id: 'mv-u4',
      name: 'Unit 4 故事填空',
      title: '两个好朋友的故事',
      desc: 'Movers R&W Part 5：读故事，用 1–3 个词补全句子。',
      topics: [
        topic(
          'mv-u4-t1',
          'Sally and Lucy',
          ['kp-enmv-u4-story', 'kp-enmv-u4-passage'],
          [],
          u4q,
        ),
      ],
    },
    {
      id: 'mv-u7',
      name: 'Unit 7 看释义写词',
      title: '看英文释义选词（13 个核心词）',
      desc: 'Flyers R&W Part 1：先认类别词，再对特征，最后看拼写。',
      topics: [topic('mv-u7-t1', '看释义选词', ['kp-enmv-u7-def'], [], u7q)],
    },
  ],
}

// ---------------------------------------------------------------------------
// 包 2 · 复习测试（Level 3 Review Units 1–3 / 4–6 / 7–9 · Standard）
// ---------------------------------------------------------------------------

const reviewKps = [
  skillKp(
    'kp-enmv-r1-cmp',
    '比较级与最高级：三句话定胜负',
    [
      '① **两者相比** → 比较级 + than：taller than, funnier than, better than。',
      '② **三者以上比出第一名** → the + 最高级：the tallest, the funniest, the fastest。',
      '③ **一样高** → as + 原级 + as：as tall as（不能用 than）。',
      '特殊变化要背：good/well → better → best；bad → worse → worst；many/much → more → most。',
      '本题陷阱：`as tall ___ our teacher` 只能是 as（as…as 固定搭配）；`he is ___ than the teacher` 只能是 better（有 than 就不能用最高级）。',
    ].join('\n'),
  ),
  skillKp(
    'kp-enmv-r1-read',
    '读短文回答问题：答案在原文里',
    [
      '这类题（Review Test Part 3）判分只认原文里的**词**，所以：',
      '① 先看问句的疑问词：What sport → 运动名；When → 时间；Who → 人；Where → 地点；What did he hurt → 身体部位；',
      '② 回原文找同一信息，抄 1–4 个词即可，不必写完整句；',
      '③ 注意时间：故事讲过去的事（went / fell / called / drove），回答时名词照抄就行，不必自己变时态。',
      '本题原文关键句：played basketball / the match the following Saturday / John fell / hurt his knee / Jane called their father / drove them to the hospital。',
    ].join('\n'),
  ),
  {
    id: 'kp-enmv-r2-mat',
    type: 'word',
    title: '材料词汇：paper / plastic / metal / wood / brick / glass',
    content: [
      '这六个词是「这个东西用什么做的」这类谜语题的答案池：',
      '· paper 纸 → 书、报纸、本子（made of paper）',
      '· plastic 塑料 → 杯子、玩具、瓶子（轻、不碎）',
      '· metal 金属 → 滑梯、栏杆、钥匙（硬、凉、会生锈）',
      '· wood 木头 → 椅子、桌子（有木纹）',
      '· brick 砖 → 墙、花园围墙（一块块砌起来）',
      '· glass 玻璃 → 镜子、窗户、玻璃杯（透明、会碎）',
      '做题时先判断「东西是什么」，再想它一般用什么材料做 —— 题目常给出首字母（p / m / b / g）当提示。',
    ].join('\n'),
    prerequisites: [],
  },
  skillKp(
    'kp-enmv-r2-modal',
    'must / Shall we / Let\'s：提议与必须',
    [
      '· **must** 必须（规则、要求）：You must choose your avatar first.',
      '· **Shall we …?** 提建议并征求同意，句末是问号：Shall we play?',
      "· **Let's** = Let us，一起做某事：Let's start!（后面直接跟动词原形）",
      '· 副词位置：动词后面放方式副词 —— cross the river **carefully**（小心地过河）、shout **loudly**（大声喊）。',
      '判断口诀：句末有问号且是「我们一起…好吗」→ Shall；句首空且后面直接跟动词原形 → Let\'s；「必须」→ must。',
    ].join('\n'),
  ),
  {
    id: 'kp-enmv-r3-adj',
    type: 'word',
    title: '性格形容词：从行为反推品质',
    content: [
      '这类题给的是「行为描述」，要反推人格词：',
      '· 爱交朋友、爱跟人说话 → **friendly** 友好的',
      '· 学习好、分数高 → **clever** 聪明的',
      '· 不容易害怕 → **brave** 勇敢的',
      '· 喜欢帮助别人 → **kind** 善良的',
      '· 起得晚、整天坐沙发 → **lazy** 懒的',
      '· 知道很多事、有很多故事 → **interesting** 有趣的',
      '记忆线索：behaviour → personality。看到 like doing / good at / not afraid 这类描述，先想「这是哪种性格的人」。',
    ].join('\n'),
    prerequisites: [],
  },
]

const r1passage = `Last Sunday, John and Jane went to the sports centre to play basketball with their friends. They all wanted to practise for the match the following Saturday. John ran and jumped to catch the ball but he fell and hurt his knee.

'Ouch!' said John. 'What's the matter?' Jane asked. 'My knee hurts a lot,' said John. 'Let's call Dad.'

Jane called their father who drove them to the hospital. The doctor saw them immediately. He took John's temperature and examined his knee. Then he put a bandage on John's knee and said, 'You need to stay at home and rest.'

'I want to play with my team on Saturday. Can I?' asked John.
'No, I'm sorry,' said the doctor. 'You need to rest for a week.'`

const r1photo = `Look at this photo. These are the children who are in my class. Mia is the (1) ____ in the class. She's as tall (2) ____ our teacher, Mrs Green. Jake is the (3) ____ . He loves to make people laugh. He's standing next to Mia. Mary is the smallest but she's the (4) ____ runner. Melanie has got the longest hair and Kim has got the (5) ____ hair. Josh is the tallest boy and he's the best at maths. Sometimes I think he's (6) ____ than the teacher! Nathan is the quietest boy. He's standing between Kim and Melanie.`

const r2dialog = `Sam: What are you playing?
Kim: This is a new game called Lost Island. You (1) ____ go through the different places to find the treasure.
Sam: Sounds great. (2) ____ we play?
Kim: OK. So, this is the island. You (3) ____ first choose your avatar. Do you want to wear bright clothes or dark clothes?
Sam: Bright clothes with spots and stripes.
Kim: OK! (4) ____ start. You have to walk through the jungle slowly because there are snakes and insects. Then you must cross the river (5) ____ to get to the waterfall. The river is dangerous because the water moves very fast. Then you must climb the mountain quickly because there are bears.`

const reviewPassages = registerKps([
  passageKp('kp-enmv-r1-photo', 'A photo of my class', r1photo, 96, '看看这张照片。这些是我班上的同学。Mia 是班上最高的，她跟我们老师 Green 太太一样高。Jake 是最滑稽的，他爱逗人笑，站在 Mia 旁边。Mary 最矮，但她是跑得最快的。Melanie 的头发最长，Kim 的头发最卷。Josh 是男生里最高的，数学最好。有时我觉得他比老师还厉害！Nathan 是最安静的男孩，他站在 Kim 和 Melanie 之间。'),
  passageKp('kp-enmv-r1-story', 'John and Jane', r1passage, 129, '上周日，John 和 Jane 去体育中心和朋友们打篮球，他们都在为下周六的比赛练习。John 跑着跳起来接球，却摔倒了，伤到了膝盖。\n「哎哟！」John 说。「怎么了？」Jane 问。「我的膝盖很疼，」John 说，「我们给爸爸打电话吧。」\nJane 打给爸爸，爸爸开车送他们去医院。医生马上给他们看了，量了 John 的体温，检查了膝盖，然后给他缠上绷带，说：「你需要在家休息。」\n「我想周六和队里一起打球，可以吗？」John 问。「不行，对不起，」医生说，「你需要休息一周。」'),
  passageKp('kp-enmv-r2-dialog', 'Lost Island · 一个游戏', r2dialog, 118, 'Sam：你在玩什么？\nKim：一个叫「迷失岛」的新游戏。你要穿过不同的地方去找宝藏。\nSam：听起来很棒。我们玩吧？\nKim：好。这就是那座岛。你要先选一个头像。你想穿亮色衣服还是深色衣服？\nSam：带圆点和条纹的亮色衣服。\nKim：好！开始吧。你要慢慢穿过丛林，因为那里有蛇和昆虫。然后你必须小心地过河，才能到瀑布。那条河很危险，水流得很快。然后你必须快速爬山，因为那里有熊。')
])
registerKps(reviewKps)

const packReview = {
  schemaVersion: '1.0',
  manifest: {
    schemaVersion: '1.0',
    packageId: 'special-english-movers-review',
    packageType: 'special',
    isInternal: false,
    examMode: false,
    subject: 'english',
    templateId: 'english.primary.v1',
    grade: GRID.grade,
    term: GRID.term,
    edition: GRID.edition,
    title: '剑桥 Movers · 三套复习测试（阅读写作）',
    dependencies: [],
  },
  knowledgePoints: [...reviewKps, ...reviewPassages],
  units: [
    {
      id: 'mv-r1',
      name: 'Review 1 比较级与短文',
      title: 'Review Units 1–3',
      desc: '比较级/最高级 6 题 + 读故事回答 6 题。',
      topics: [
        topic(
          'mv-r1-t1',
          '比较级与最高级',
          ['kp-enmv-r1-cmp', 'kp-enmv-r1-photo'],
          [],
          [
            choice('mv-r1-01', 'single', 'Mia is the (1) ____ in the class.', ['tallest', 'taller', 'tall'], 0, '班上一群人里比出第一名 → the + 最高级 the tallest。taller 要跟 than 搭配，这里没有 than。', 'kp-enmv-r1-cmp'),
            choice('mv-r1-02', 'single', "She's as tall (2) ____ our teacher, Mrs Green.", ['as', 'than', 'like'], 0, 'as + 原级 + as 是固定搭配：as tall as our teacher（和老师一样高）。', 'kp-enmv-r1-cmp'),
            choice('mv-r1-03', 'single', 'Jake is the (3) ____ . He loves to make people laugh.', ['funniest', 'funnier', 'funny'], 0, '全班里最滑稽的那一个 → the funniest。funnier 后面必须跟 than。', 'kp-enmv-r1-cmp'),
            choice('mv-r1-04', 'single', "Mary is the smallest but she's the (4) ____ runner.", ['fastest', 'faster', 'fast'], 0, '「最矮但跑得最快」—— 全班范围比出第一名 → the fastest runner。', 'kp-enmv-r1-cmp'),
            choice('mv-r1-05', 'single', 'Melanie has got the longest hair and Kim has got the (5) ____ hair.', ['curliest', 'curlier', 'curly'], 0, '前半句用的是 the longest（最高级），后半句并列，同样用 the curliest。', 'kp-enmv-r1-cmp'),
            choice('mv-r1-06', 'single', "Sometimes I think he's (6) ____ than the teacher!", ['better', 'best', 'good'], 0, '有 than 就一定是比较级；good 的比较级是 better（不规则变化）。', 'kp-enmv-r1-cmp'),
          ],
        ),
        topic(
          'mv-r1-t2',
          '读故事回答问题',
          ['kp-enmv-r1-read', 'kp-enmv-r1-story'],
          [],
          [
            blank('mv-r1-11', 'What sport did they play with their friends?（They played ____ .）', 'basketball', '原文第一句 "went to the sports centre to play basketball with their friends"。', 'kp-enmv-r1-read'),
            blank('mv-r1-12', 'When was the match?', 'Saturday / the following Saturday / next Saturday / following Saturday', '原文 "practise for the match the following Saturday" —— 比赛在「接下来的那个周六」。', 'kp-enmv-r1-read'),
            blank('mv-r1-13', 'Who fell?', 'John', '原文 "John ran and jumped to catch the ball but he fell" —— 摔倒的是 John。', 'kp-enmv-r1-read'),
            blank('mv-r1-14', 'What did he hurt?', 'his knee / knee / the knee', '原文 "he fell and hurt his knee"；后面 John 自己也说 "My knee hurts a lot"。', 'kp-enmv-r1-read'),
            blank('mv-r1-15', 'Who did Jane call?', 'their dad / dad / their father / father / her father', '原文 "Jane called their father who drove them to the hospital"，也可以说 dad。', 'kp-enmv-r1-read'),
            blank('mv-r1-16', 'Where did they see the doctor?', 'at the hospital / the hospital / hospital', '原文 "drove them to the hospital. The doctor saw them immediately" —— 在医院看医生。', 'kp-enmv-r1-read'),
          ],
        ),
      ],
    },
    {
      id: 'mv-r2',
      name: 'Review 2 材料与提议',
      title: 'Review Units 4–6',
      desc: '材料谜语 6 题 + must / Shall / Let\'s 6 题。',
      topics: [
        topic('mv-r2-t1', '材料谜语', ['kp-enmv-r2-mat'], [], [
          blank('mv-r2-01', "This is something you read. It's got a lot of pages and gives us information about what's happening in the world. It's made of ____ .", 'paper', '很多页、告诉我们世界上发生的事 → 报纸/书，材料是纸 paper。', 'kp-enmv-r2-mat'),
          blank('mv-r2-02', "This is something you drink from. It's made of p____ and doesn't break.", 'plastic', '能喝东西、不会碎 → 塑料杯，材料是 plastic，题目已给首字母 p。', 'kp-enmv-r2-mat'),
          blank('mv-r2-03', "This is something you find in the playground. It's fun to play on it. It's made of m____ .", 'metal', '操场上好玩的东西（滑梯、攀爬架）→ 金属 metal，首字母 m。', 'kp-enmv-r2-mat'),
          blank('mv-r2-04', "This is something you sit on. It's got four legs and a back. It's often made of w____ .", 'wood', '四条腿、有靠背、坐着 → 椅子，常常是木头 wood，首字母 w。', 'kp-enmv-r2-mat'),
          blank('mv-r2-05', "This is something you find at the end of a garden. It shows you where the garden finishes. It's made of b____ .", 'brick', '花园尽头、标示边界的墙 → 砖墙 brick，首字母 b。', 'kp-enmv-r2-mat'),
          blank('mv-r2-06', "This is something you can look in to see your face. It's usually on the wall. It's made of g____ .", 'glass', '能照见自己、挂在墙上 → 镜子，材料是玻璃 glass，首字母 g。', 'kp-enmv-r2-mat'),
        ]),
        topic(
          'mv-r2-t2',
          'Lost Island 对话填空',
          ['kp-enmv-r2-modal', 'kp-enmv-r2-dialog'],
          [],
          [
            choice('mv-r2-11', 'single', 'You (1) ____ go through the different places to find the treasure.', ['must', 'Shall', "Let's"], 0, '游戏规则、必须做的事 → must。后半句 "You have to walk…" 也在提示这是「必须」。', 'kp-enmv-r2-modal'),
            choice('mv-r2-12', 'single', 'Sounds great. (2) ____ we play?', ['Shall', 'must', "Let's"], 0, '句末是问号、意思是「我们玩吧，好吗」→ Shall we play?', 'kp-enmv-r2-modal'),
            choice('mv-r2-13', 'single', 'You (3) ____ first choose your avatar.', ['must', 'Shall', 'carefully'], 0, '必须先做的事 → must choose（must 后面动词原形）。', 'kp-enmv-r2-modal'),
            choice('mv-r2-14', 'single', 'OK! (4) ____ start.', ["Let's", 'Shall', 'must'], 0, "「我们一起开始吧」→ Let's start!（Let's = Let us，后跟动词原形）。", 'kp-enmv-r2-modal'),
            choice('mv-r2-15', 'single', 'Then you must cross the river (5) ____ to get to the waterfall.', ['carefully', 'loudly', 'must'], 0, '过河要「小心地」，用方式副词 carefully；loudly 是大声地，跟过河不搭。', 'kp-enmv-r2-modal'),
            choice('mv-r2-16', 'single', 'Shout (6) ____ at the bear and then run as fast as you can!', ['loudly', 'carefully', 'Shall'], 0, '对熊要「大声喊」→ shout loudly。', 'kp-enmv-r2-modal'),
          ],
        ),
      ],
    },
    {
      id: 'mv-r3',
      name: 'Review 3 性格形容词',
      title: 'Review Units 7–9',
      desc: '从行为描述反推性格词 6 题。',
      topics: [
        topic('mv-r3-t1', '性格形容词', ['kp-enmv-r3-adj'], [], [
          blank('mv-r3-01', 'If you like talking to your friends and meeting new people, you are a ____ person.', 'friendly', '爱跟朋友说话、爱认识新朋友 → friendly 友好的。题目里已把这个词当例句给出，注意拼写。', 'kp-enmv-r3-adj'),
          blank('mv-r3-02', 'If you are good at school and get good marks, you are a ____ person.', 'clever', '在学校表现好、分数高 → clever 聪明的。', 'kp-enmv-r3-adj'),
          blank('mv-r3-03', "If you don't get scared easily, you are a ____ person.", 'brave', '不容易被吓到 → brave 勇敢的。', 'kp-enmv-r3-adj'),
          blank('mv-r3-04', 'If you like helping people, you are a ____ person.', 'kind', '喜欢帮助别人 → kind 善良的。', 'kp-enmv-r3-adj'),
          blank('mv-r3-05', 'If you like getting up late and sitting on the sofa all day, you are a ____ person.', 'lazy', '起得晚、整天坐沙发 → lazy 懒的。', 'kp-enmv-r3-adj'),
          blank('mv-r3-06', 'If you know a lot of things and have a lot of stories to tell, you are an ____ person.', 'interesting', '知道很多事、有很多故事 → interesting 有趣的（前面用 an，因为 interesting 以元音音素开头）。', 'kp-enmv-r3-adj'),
        ]),
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// 包 3 · 全真模拟（A1 Movers Practice Test · Reading & Writing Part 1–6）
// ---------------------------------------------------------------------------

const mockKps = [
  {
    id: 'kp-enmv-m-p1',
    type: 'word',
    title: 'Part 1 看释义选词：先认「这是什么东西」',
    content: [
      'Part 1 给 8 个词、5 段释义，每段只描述一样东西。抓三类线索：',
      '· **类别词**：place / animal / people / thing —— 决定答案的大类；',
      '· **功能**：you go there to… / you need this to… —— 决定具体是哪一个；',
      '· **细节**：white、eight legs、in the country —— 排除同类里的其他选项。',
      '本组答案：a café（吃饭聊天的地方）、a bat（夜里飞的动物）、hospitals（生病的人去的地方）、a toothbrush（刷牙用的）、fields（乡下有动物的田地）。',
    ].join('\n'),
    prerequisites: [],
  },
  skillKp(
    'kp-enmv-m-p2',
    'Part 2 情景问答：答语必须回答问题',
    [
      '这类题（Movers R&W Part 2）不是考语法，是考「这句话问的是什么」。',
      '三步：① 看问句的疑问词（Where / Why / Which / How often / What kind / Can I…）；② 三个选项中只有一个是**直接回答**；③ 其余两个通常「答非所问」或「语法对但意思不搭」。',
      '例：问 Why didn\'t you go home? 只能答 Because…；问 How often…? 只能答频率（Every Tuesday）；问 Which aunt…? 要指出具体哪一位（The aunt who lives opposite the market）。',
    ].join('\n'),
  ),
  skillKp(
    'kp-enmv-m-p3',
    'Part 3 故事填空：跟着时间线走',
    [
      'Part 3 是一段小故事挖 5 个空，考的是「这个故事这时候发生了什么」。',
      '· 先通读一遍抓时间线（first day at school → outside the classroom → lunch → outside → evening）；',
      '· 每个空看前后句的**情绪与动作**：did not want to go → sad；did not want to go + 妈妈安慰 → started to cry；',
      '· 第 6 题问「给故事选标题」，标题要能概括**整件事**（Fred starts school），不能只讲其中一幕。',
    ].join('\n'),
  ),
  skillKp(
    'kp-enmv-m-p4',
    'Part 4 短文选词：be 动词、介词、-ing、which、连词',
    [
      'Part 4 的五种高频考点，几乎每套都这样配：',
      '· **There is/are**：There **is** often a lot of snow（a lot of snow 视为一个整体，用 is）；',
      '· **介词**：with snow **on** the ground（雪在地面上）；',
      '· **like + doing**：Children like **playing** outside；',
      '· **关系代词**：balls of snow, **which** they throw（which 指物，who 指人）；',
      '· **连词**：…scarves, **because** it is very cold（表原因）；but 表转折，then 表顺序。',
    ].join('\n'),
  ),
  skillKp(
    'kp-enmv-m-p5',
    'Part 5 故事细节填空：同义替换是唯一难点',
    [
      'Part 5 的答案一定在原文里，难在**题目换了说法**：',
      '· 「Vicky\'s ___ didn\'t like going outside」↔ 原文 "a fat, grey cat that never wanted to go outside"；',
      '· 「could not ___」↔ 原文 "It can\'t hop because its leg hurts"；',
      '· 「put the rabbit in ___」↔ 原文 "took the rabbit to the basement"。',
      '做题顺序：读题目 → 找原文同义句 → 抄 1–3 个词（保留冠词更稳）。',
    ].join('\n'),
  ),
  skillKp(
    'kp-enmv-m-p6',
    'Part 6 看图回答：位置 + 动作 + 衣物',
    [
      'Part 6 的四个空分两类：',
      '· **补全句子**（There is a parrot on the pirate\'s ___）：找「谁身上的哪个部位」，答案通常是身体部位或名词（shoulder）；',
      '· **回答 What is … doing?**：答案必须是**动作**（making a film / holding a camera），不能答人物身份；问 holding 就要答物品（a map）。',
      '看图顺序：先看整体场景（瀑布、船、宝箱），再按题目逐个定位人物。',
    ].join('\n'),
  ),
]

const mP3story = `Fred and his mother went out of their apartment and walked down the road. Fred was very (1) ____ . It was his first day at school and he did not want to go.

Outside the classroom Fred started to (2) ____ . 'Look!' said his mother. 'Here's your teacher.'

A young woman with black, (3) ____ hair smiled at Fred. 'Hello Fred,' she said, 'my name is Miss Hill. Let's go to your table.' On the table there were some pencils and lots of toys. He played with the toy cars and then he drew a picture. 'That's good!' said the teacher. 'Now we can have lunch.'

Fred had a (4) ____ and a bottle of juice for his lunch. After that, all of the children went outside and ran and shouted in the (5) ____ . In the evening, Fred said to his mother, 'I like school now.'`

const mP4text = `**Snow**

You can see snow in *some* places in cold weather. It is white and very beautiful.

There (1) ____ often a lot of snow in the mountains. It is difficult for birds and animals to find food with snow (2) ____ the ground. Children often like (3) ____ outside in the snow. They make balls of snow, (4) ____ they throw at their friends. They need to wear hats, coats and scarves, (5) ____ it is very cold. Sometimes it snows a lot and children can't go to school.`

const mP5story = `**The Brown Rabbit**

Charlie wanted a pet. Every child in Charlie's class had one. Jim had one big dog and one small dog. He liked playing with his dogs on the beach. Vicky had a fat, grey cat that never wanted to go outside. And Mary had an exciting pet. It was a beautiful lizard.

One Friday, Charlie looked out of his bedroom window and saw something on the grass. It was a small brown rabbit with a white tail. Charlie ran outside to look at it. The rabbit looked sad. Charlie said to his father, 'What's the matter with it?' 'It can't hop because its leg hurts,' said his father. He picked it up carefully and carried it inside the house.

They took the rabbit to the basement because it was quiet there. The rabbit was tired and slept all night. On Saturday morning, the rabbit's leg was fine. 'I've got a pet now,' Charlie said. 'No, this rabbit lives outside,' his father said. They went to the countryside, put the rabbit down and watched it run quickly to the trees.

'Would you like to go to the pet shop now?' said Charlie's father. 'Yes please!' Charlie shouted.`

const mockPassages = registerKps([
  passageKp('kp-enmv-m-p3-passage', 'Fred starts school', mP3story, 118, 'Fred 和妈妈走出公寓，沿路走着。Fred 心里很难过——这是他第一天上学，他不想去。\n在教室外面，Fred 开始哭了。「看！」妈妈说，「你的老师来了。」\n一位黑卷发的年轻女士对 Fred 微笑。「你好 Fred，」她说，「我叫 Hill 小姐，我们去你的桌子那儿吧。」桌上有铅笔和很多玩具。他玩了玩具车，然后画了一幅画。「画得好！」老师说，「现在我们可以吃午饭了。」\nFred 午餐吃了一个三明治和一瓶果汁。之后所有孩子都到外面，在操场上又跑又叫。晚上，Fred 对妈妈说：「我现在喜欢上学了。」'),
  passageKp('kp-enmv-m-p4-passage', 'Snow', mP4text, 87, '雪\n\n在寒冷天气里的一些地方你能看到雪。它是白色的，非常美。\n山上常常有很多雪。雪盖在地上时，鸟和动物很难找到食物。孩子们常常喜欢在雪地里玩。他们把雪团成球，然后朝朋友扔过去。他们需要戴帽子、穿外套、围围巾，因为天气很冷。有时雪下得很大，孩子们就不能去上学了。'),
  passageKp('kp-enmv-m-p5-passage', 'The Brown Rabbit', mP5story, 205, '棕色的兔子\n\nCharlie 想要一只宠物。他班上的每个孩子都有一只。Jim 有一只大狗和一只小狗，他喜欢带狗在海滩上玩。Vicky 有一只胖胖的灰猫，它从不想出门。Mary 有一只很刺激的宠物，是一只漂亮的蜥蜴。\n一个星期五，Charlie 从卧室窗户往外看，看到草地上有个东西。那是一只尾巴白色的小棕兔。Charlie 跑出去看它。兔子看起来很伤心。Charlie 问爸爸：「它怎么了？」「它的腿受伤了，所以跳不了，」爸爸说。他小心地把它抱起来，带进屋里。\n他们把兔子带到地下室，因为那里很安静。兔子累了，睡了一整夜。星期六早上，兔子的腿好了。「我现在有宠物了，」Charlie 说。「不行，这只兔子住在外面，」爸爸说。他们去了乡下，把兔子放下，看着它飞快地跑向树林。\n「你现在想去宠物店吗？」Charlie 的爸爸说。「想！」Charlie 喊道。')
])
registerKps(mockKps)

const packMock = {
  schemaVersion: '1.0',
  manifest: {
    schemaVersion: '1.0',
    packageId: 'special-english-movers-mock',
    packageType: 'special',
    isInternal: false,
    examMode: false,
    subject: 'english',
    templateId: 'english.primary.v1',
    grade: GRID.grade,
    term: GRID.term,
    edition: GRID.edition,
    title: '剑桥 Movers · 全真模拟（阅读写作 33 题）',
    dependencies: [],
  },
  knowledgePoints: [...mockKps, ...mockPassages],
  units: [
    {
      id: 'mv-mock',
      name: 'Reading & Writing 全真模拟',
      title: 'A1 Movers Practice Test · Reading & Writing',
      desc: '一套完整的 Movers 阅读写作（Part 1–6），共 33 题。听力与口语部分不在包内。',
      topics: [
        topic('mv-mock-t1', 'Part 1 看释义选词', ['kp-enmv-m-p1'], [], [
          choice('mv-m-01', 'single', 'People go to this place to eat, drink and talk to their friends.', ['a café', 'a towel', 'a blanket'], 0, '吃饭、喝东西、和朋友聊天的地方 → 咖啡馆 a café。a towel 是毛巾，a blanket 是毯子。', 'kp-enmv-m-p1'),
          choice('mv-m-02', 'single', 'This animal flies at night and sleeps in the day.', ['a bat', 'a snail', 'a blanket'], 0, '夜里飞、白天睡 → 蝙蝠 a bat。a snail 是蜗牛（爬得很慢，不飞）。', 'kp-enmv-m-p1'),
          choice('mv-m-03', 'single', 'People who are ill go to these places.', ['hospitals', 'fields', 'cafés'], 0, '生病的人去的地方 → 医院 hospitals（复数，因为 these places）。', 'kp-enmv-m-p1'),
          choice('mv-m-04', 'single', 'You need this to clean your teeth after you eat.', ['a toothbrush', 'a towel', 'a blanket'], 0, '刷牙用的 → 牙刷 a toothbrush。', 'kp-enmv-m-p1'),
          choice('mv-m-05', 'single', 'You find these in the country and they often have animals in them.', ['fields', 'hospitals', 'cafés'], 0, '乡下、里面有动物 → 田地 fields。', 'kp-enmv-m-p1'),
        ]),
        topic('mv-mock-t2', 'Part 2 情景问答', ['kp-enmv-m-p2'], [], [
          choice('mv-m-06', 'single', 'Paul: Why didn\'t you go home yesterday?\nDaisy: ____', ['Because my mother was at work.', 'Because my mother can work.', 'Because my mother would like to work.'], 0, 'Why 问原因，要用 Because + 一件过去发生的事（was at work）。B、C 语法没错，但都不是「昨天没回家」的理由。', 'kp-enmv-m-p2'),
          choice('mv-m-07', 'single', 'Paul: Which aunt did you see?\nDaisy: ____', ['The aunt who lives opposite the market.', 'She is my aunt.', 'I know your aunt well.'], 0, 'Which 问「哪一位」，要指出具体的人（住在市场对面的那位）。只说「她是我阿姨」并没有回答「哪一位」。', 'kp-enmv-m-p2'),
          choice('mv-m-08', 'single', 'Paul: How often do you go to see your aunt?\nDaisy: ____', ['Every Tuesday.', 'I take a bus there.', 'She\'s never here.'], 0, 'How often 问频率 → Every Tuesday（每周二）。I take a bus there 回答的是 How（怎么去）。', 'kp-enmv-m-p2'),
          choice('mv-m-09', 'single', 'Paul: Do you enjoy going to see your aunt?\nDaisy: ____', ['Yes, I do.', 'Yes, that\'s better.', 'Yes, I know.'], 0, 'Do you…? 的答语用 Yes, I do. —— 助动词必须跟问句一致。', 'kp-enmv-m-p2'),
          choice('mv-m-10', 'single', 'Paul: What kind of games do you play at your aunt\'s house?\nDaisy: ____', ['Soccer and tennis.', 'It\'s in the garden.', 'Three or four.'], 0, 'What kind of games 问种类 → 具体说出运动名 Soccer and tennis。It\'s in the garden 回答 Where。', 'kp-enmv-m-p2'),
          choice('mv-m-11', 'single', 'Paul: Can I come with you this week?\nDaisy: ____', ['All right.', 'I didn\'t know.', 'You\'re happy.'], 0, 'Can I…? 是请求许可，答语要表态 → All right.（好啊）。', 'kp-enmv-m-p2'),
        ]),
        topic(
          'mv-mock-t3',
          'Part 3 故事填空',
          ['kp-enmv-m-p3', 'kp-enmv-m-p3-passage'],
          [],
          [
            choice('mv-m-12', 'single', 'Fred was very (1) ____ . It was his first day at school and he did not want to go.', ['sad', 'happy', 'hungry'], 0, '下文说"他不想去上学"，所以心里是难过的 sad。', 'kp-enmv-m-p3'),
            choice('mv-m-13', 'single', 'Outside the classroom Fred started to (2) ____ .', ['cry', 'laugh', 'run'], 0, '不想上学 + 站在教室外面 → 开始哭 cry。', 'kp-enmv-m-p3'),
            choice('mv-m-14', 'single', 'A young woman with black, (3) ____ hair smiled at Fred.', ['curly', 'straight', 'short'], 0, '形容头发形状的词；故事里老师是一头黑色卷发 → curly。', 'kp-enmv-m-p3'),
            choice('mv-m-15', 'single', 'Fred had a (4) ____ and a bottle of juice for his lunch.', ['sandwich', 'candle', 'pillow'], 0, '午餐吃的 + 一瓶果汁 → 三明治 sandwich。', 'kp-enmv-m-p3'),
            choice('mv-m-16', 'single', 'All of the children went outside and ran and shouted in the (5) ____ .', ['playground', 'bedroom', 'kitchen'], 0, '孩子跑着喊叫的地方（教室外面）→ 操场 playground。', 'kp-enmv-m-p3'),
            choice('mv-m-17', 'single', 'Now choose the best name for the story.', ['Fred starts school', "Fred's new bicycle", 'A day at the beach'], 0, '整篇讲 Fred 第一天上学从难过到喜欢的过程，最能概括全篇的是 Fred starts school。', 'kp-enmv-m-p3', '进阶'),
          ],
        ),
        topic(
          'mv-mock-t4',
          'Part 4 短文选词',
          ['kp-enmv-m-p4', 'kp-enmv-m-p4-passage'],
          [],
          [
            choice('mv-m-18', 'single', 'There (1) ____ often a lot of snow in the mountains.', ['is', 'are', 'be'], 0, 'there be 句型看后面的名词：a lot of snow 是不可数名词，用 is。', 'kp-enmv-m-p4'),
            choice('mv-m-19', 'single', 'It is difficult for birds and animals to find food with snow (2) ____ the ground.', ['on', 'by', 'for'], 0, '雪「在地面上」→ on the ground。', 'kp-enmv-m-p4'),
            choice('mv-m-20', 'single', 'Children often like (3) ____ outside in the snow.', ['playing', 'played', 'play'], 0, 'like 后面接 -ing：like playing（喜欢在雪里玩）。', 'kp-enmv-m-p4'),
            choice('mv-m-21', 'single', 'They make balls of snow, (4) ____ they throw at their friends.', ['which', 'who', 'what'], 0, '指物（雪球）用 which；who 只能指人。', 'kp-enmv-m-p4'),
            choice('mv-m-22', 'single', 'They need to wear hats, coats and scarves, (5) ____ it is very cold.', ['because', 'then', 'but'], 0, '前后是因果关系（因为很冷，所以要戴帽子围巾）→ because。', 'kp-enmv-m-p4'),
          ],
        ),
        topic(
          'mv-mock-t5',
          'Part 5 故事细节填空',
          ['kp-enmv-m-p5', 'kp-enmv-m-p5-passage'],
          [],
          [
            blank('mv-m-23', "Vicky's ____ didn't like going outside.（1–3 个词）", 'fat grey cat / grey cat / cat', '原文 "Vicky had a fat, grey cat that never wanted to go outside" —— never wanted to go outside 就是 didn\'t like going outside。', 'kp-enmv-m-p5'),
            blank('mv-m-24', "Mary's exciting pet was a ____ .", 'beautiful lizard / lizard', '原文 "Mary had an exciting pet. It was a beautiful lizard."', 'kp-enmv-m-p5'),
            blank('mv-m-25', 'Charlie saw a rabbit on the ____ outside his house.', 'grass', '原文 "saw something on the grass. It was a small brown rabbit" —— 在草地上。', 'kp-enmv-m-p5'),
            blank('mv-m-26', "Charlie's dad took the rabbit inside because it could not ____ .", 'hop / walk', '原文 "It can\'t hop because its leg hurts" —— 腿疼所以跳不了。', 'kp-enmv-m-p5'),
            blank('mv-m-27', 'In the house, they put the rabbit in ____ and it got better.', 'the basement / basement', '原文 "They took the rabbit to the basement because it was quiet there"，第二天腿就好了。', 'kp-enmv-m-p5'),
            blank('mv-m-28', 'They took the rabbit to the countryside and it ran to some ____ .', 'trees / the trees', '原文 "watched it run quickly to the trees"。', 'kp-enmv-m-p5'),
            blank('mv-m-29', 'Then Dad asked Charlie to go to the ____ with him.', 'pet shop / the pet shop / a pet shop', '原文 "Would you like to go to the pet shop now?" —— 宠物店。', 'kp-enmv-m-p5'),
          ],
        ),
        topic('mv-mock-t6', 'Part 6 看图回答', ['kp-enmv-m-p6'], [], [
          {
            ...choice('mv-m-30', 'single', "There is a parrot on the pirate's ____ .", ['shoulder', 'head', 'hand'], 0, '右后方那个海盗的肩膀上站着一只绿色鹦鹉 → shoulder（肩膀）。', 'kp-enmv-m-p6'),
            image: 'assets/pirate-scene.png',
            imageAlt: '丛林瀑布场景：左边一个戴黄帽子的女孩在用摄像机拍摄，两个猴子坐在救生圈上，中间的独眼海盗举着一张藏宝图，右边两个海盗在开宝箱，前方箱子里装着水果，天上一朵云',
          },
          {
            ...choice('mv-m-31', 'single', 'The only ____ in the sky is above the waterfall.', ['cloud', 'bird', 'plane'], 0, '天空里只有一个白色的东西，就在瀑布上方 → cloud（云）。', 'kp-enmv-m-p6'),
            image: 'assets/pirate-scene.png',
            imageAlt: '丛林瀑布场景：左边一个戴黄帽子的女孩在用摄像机拍摄，两个猴子坐在救生圈上，中间的独眼海盗举着一张藏宝图，右边两个海盗在开宝箱，前方箱子里装着水果，天上一朵云',
          },
          {
            ...choice('mv-m-32', 'single', 'What is the pirate with the hat holding?', ['A map.', 'A camera.', 'A box.'], 0, '戴帽子的那个海盗高高举着的是一张藏宝图 → a map。摄像机在左边女孩手里。', 'kp-enmv-m-p6'),
            image: 'assets/pirate-scene.png',
            imageAlt: '丛林瀑布场景：左边一个戴黄帽子的女孩在用摄像机拍摄，两个猴子坐在救生圈上，中间的独眼海盗举着一张藏宝图，右边两个海盗在开宝箱，前方箱子里装着水果，天上一朵云',
          },
          {
            ...choice('mv-m-33', 'single', 'What is the girl with the yellow hat doing?', ['Making a film.', 'Reading a book.', 'Swimming.'], 0, '戴黄帽子的女孩正扛着摄像机对着瀑布拍摄 → making a film（也可说 holding a camera）。', 'kp-enmv-m-p6'),
            image: 'assets/pirate-scene.png',
            imageAlt: '丛林瀑布场景：左边一个戴黄帽子的女孩在用摄像机拍摄，两个猴子坐在救生圈上，中间的独眼海盗举着一张藏宝图，右边两个海盗在开宝箱，前方箱子里装着水果，天上一朵云',
          },
        ]),
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// 写盘
// ---------------------------------------------------------------------------
const setConfig = {
  setId: 'english-movers-cep-set',
  title: '剑桥少儿英语 Movers · 阅读写作（课外）',
  subject: 'english',
  grade: GRID.grade,
  term: GRID.term,
  edition: GRID.edition,
  importOrder: [
    'special-english-movers-unit',
    'special-english-movers-review',
    'special-english-movers-mock',
  ],
  packages: [
    {
      file: 'special-english-movers-unit.json',
      packageId: 'special-english-movers-unit',
      type: 'special',
      visible: true,
      examMode: false,
      dependencies: [],
    },
    {
      file: 'special-english-movers-review.json',
      packageId: 'special-english-movers-review',
      type: 'special',
      visible: true,
      examMode: false,
      dependencies: [],
    },
    {
      file: 'special-english-movers-mock.json',
      packageId: 'special-english-movers-mock',
      type: 'special',
      visible: true,
      examMode: false,
      dependencies: [],
    },
  ],
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, '_set.json'), JSON.stringify(setConfig, null, 2) + '\n')
writeFileSync(join(OUT, 'special-english-movers-unit.json'), JSON.stringify(packUnit, null, 2) + '\n')
writeFileSync(join(OUT, 'special-english-movers-review.json'), JSON.stringify(packReview, null, 2) + '\n')
writeFileSync(join(OUT, 'special-english-movers-mock.json'), JSON.stringify(packMock, null, 2) + '\n')

// 图片资产：源目录约定 content/<集合>/assets/<packageId>/<文件名>
const assetMap = [
  ['special-english-movers-unit', 'beach-scene.jpeg', join(IMG, 'u1_p1_26.jpeg')],
  ['special-english-movers-mock', 'pirate-scene.png', join(IMG, 'mock_p6_scene.png')],
]
for (const [pkgId, name, src] of assetMap) {
  const dir = join(OUT, 'assets', pkgId)
  mkdirSync(dir, { recursive: true })
  if (!existsSync(src)) {
    console.error(`❌ 缺少图片源文件：${src}（先跑 scripts/content/extract-movers-img.py）`)
    process.exit(1)
  }
  copyFileSync(src, join(dir, name))
}

const count = (p) => p.units.reduce((n, u) => n + u.topics.reduce((m, t) => m + t.exercises.length, 0), 0)
console.log('✅ 已生成：')
for (const p of [packUnit, packReview, packMock]) {
  console.log(`   ${p.manifest.packageId}  ${count(p)} 题 / ${p.knowledgePoints.length} 知识点`)
}
console.log(`   合计 ${count(packUnit) + count(packReview) + count(packMock)} 题 → ${OUT}`)
