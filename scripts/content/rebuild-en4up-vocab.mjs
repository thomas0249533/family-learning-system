/**
 * 幂等重建：四上英语词汇包（special-english-4-up-vocab）→ 沪教版（牛津上海版 4A）
 *
 * 依据：用户提供的课本 Word list 实拍（上海教育出版社，主编 张春柏/施嘉平）
 *   - p.86 Unit 1–4；p.87 Unit 5–8；Proper nouns / Months；p.89 Cardinal / Ordinal numbers
 *
 * 规则：
 *   - 整体替换 Unit 1–8 的单词 kp 与默写题（旧 PEP 词表与课本不符）
 *   - 删除各单元 PEP 专属句型专题（句子属于人教版课文，沪教版没有）
 *   - 新增附录单元（专有名词 / 月份 / 基数词 / 序数词）
 *   - 保留语法专项（en4-grammar）与拔高（en4-advanced）单元及其 kp（课本无关的通用语法）
 *   - kp 全部换新前缀 kp-sh4en-（旧进度本就对应错误词表，作废是预期行为）
 *   - 重复执行结果一致（幂等）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FILE = join(ROOT, 'content', 'english-4-up-vocab', 'special-english-4-up-vocab.json')

/** @param {string} en @param {string} zh */
const w = (en, zh) => ({ en, zh })

/** Unit 1–8 词表（粗体核心词 + 无星普通词全收，与课本 Word list 一致） */
const UNITS = [
  {
    id: 'en4-u1',
    name: 'Unit 1',
    words: [
      w('city', '城市'), w('building', '建筑物；楼房'), w('flat', '公寓'),
      w('street', '大街；街道'), w('country', '乡村'), w('farm', '农场'),
      w('house', '房屋；房子'), w('people', '人；人们'), w('live', '住；居住'),
      w('many', '许多'), w('place', '地方'), w('quiet', '安静的'),
      w('all kinds of', '各种各样的'), w('a lot of', '许多'),
    ],
  },
  {
    id: 'en4-u2',
    name: 'Unit 2',
    words: [
      w('eagle', '老鹰'), w('owl', '猫头鹰'), w('honeybee', '蜜蜂'),
      w('nest', '巢穴'), w('their', '他的；她们的；它们的'), w('tree hole', '树洞'),
      w('safe', '安全的'), w('there', '那里；在那里'), w('snake', '蛇'),
      w('hive', '蜂巢'), w('under', '在……下面；小于；少于'), w('at night', '晚上'),
      w('make honey', '酿蜜'),
    ],
  },
  {
    id: 'en4-u3',
    name: 'Unit 3',
    words: [
      w('plus', '加；加号'), w('equal', '等于'), w('answer', '答案；回答'),
      w('minus', '减；减号'), w('odd numbers', '奇数'), w('even numbers', '偶数'),
      w('use', '使用'), w('help', '帮助'), w('count', '（按顺序）数数'),
      w('thing', '东西；事物'), w('say', '说'), w('every day', '每天'),
      w('how many', '（用于问数量）多少'),
    ],
  },
  {
    id: 'en4-u4',
    name: 'Unit 4',
    words: [
      w('supermarket', '超市'), w('a bag of rice', '一袋米'), w('a box of eggs', '一盒鸡蛋'),
      w('a bottle of juice', '一瓶果汁'), w('buy', '购买'), w('sell', '出售'),
      w('need', '需要'), w('shopping list', '购物单'), w('each', '每个'),
      w('team', '队；组'), w('faster', '更快的'), w('candy', '糖果；巧克力'),
      w('bread', '面包'), w('win', '获胜'), w('still', '还；仍然'),
    ],
  },
  {
    id: 'en4-u5',
    name: 'Unit 5',
    words: [
      w('spring', '春天'), w('warm', '温暖的'), w('summer', '夏天'),
      w('hot', '炎热的'), w('autumn', '秋天'), w('cool', '凉爽的'),
      w('winter', '冬天'), w('cold', '寒冷的'), w('parent', '父亲（或母亲）'),
      w('season', '季节'), w('year', '年'), w('grow', '（使）生长'),
      w('get', '变得'), w('usually', '通常'), w('after', '在……之后'),
      w('fall', '落下'), w('turn', '（使）变成'), w('often', '经常'),
      w('snow', '下雪；雪'), w('then', '然后'), w('begin', '开始'),
    ],
  },
  {
    id: 'en4-u6',
    name: 'Unit 6',
    words: [
      w('flower', '花'), w('fruit', '果实；水果'), w('leaf', '叶子'),
      w('share', '分享'), w('water', '水；给……浇水'), w('how much', '多少钱；多少'),
      w('a bar of chocolate', '一块巧克力'), w('Here they are', '它们在这里。'),
      w('All right', '好的。'), w('What would you like', '你想要什么？'),
      w('soil', '土壤'), w('sunflower', '向日葵'), w('seed', '种子'),
      w('put', '放'), w('plant', '植物'), w('root', '根'),
      w('tall', '高的'), w('round', '圆形的'), w('oil', '食用油'),
      w('amazing', '令人惊叹的'),
    ],
  },
  {
    id: 'en4-u7',
    name: 'Unit 7',
    words: [
      w('green light', '绿灯'), w('red light', '红灯'), w('wait', '等待'),
      w('cross', '穿越；越过'), w('Mr', '先生'), w('way', '路线；道路'),
      w('road', '路；马路'), w('should', '应该'), w('first', '首先'),
      w('left', '左边'), w('car', '小汽车'), w('right', '右边'),
      w('skate', '滑（滑板）'), w('sorry', '对不起'), w('kid', '小孩；孩子'),
      w('late', '迟到'), w('Good job', '做得好！'), w('Hurry up', '快点！'),
    ],
  },
  {
    id: 'en4-u8',
    name: 'Unit 8',
    words: [
      w('go shopping', '购物'), w('go for a walk', '去散步'), w('use the internet', '使用互联网'),
      w('do exercise', '锻炼'), w('do housework', '做家务'), w('do gardening', '做园艺'),
      w('grandparent', '祖父（母）；外祖父（母）'), w('week', '星期；周'), w('work', '工作'),
      w('always', '总是'), w('vlog', '视频博客'), w('watch', '看；观看'),
      w('do tai chi', '打太极拳'), w('tidy up', '收拾；整理'),
    ],
  },
]

/** 附录词表 */
const APPENDIX = [
  {
    id: 'en4-app-prop', title: '专有名词', desc: '课本出现过的地名与节日',
    words: [
      w('Shenzhen', '深圳'), w('Star Village', '星星村'), w('Green Farm', '绿色农场'),
      w('New York', '纽约市'), w('Singapore', '新加坡市'), w('the Double Ninth Festival', '重阳节'),
    ],
  },
  {
    id: 'en4-app-months', title: '月份', desc: '十二个月份',
    words: [
      w('January', '一月'), w('February', '二月'), w('March', '三月'),
      w('April', '四月'), w('May', '五月'), w('June', '六月'),
      w('July', '七月'), w('August', '八月'), w('September', '九月'),
      w('October', '十月'), w('November', '十一月'), w('December', '十二月'),
    ],
  },
  {
    id: 'en4-app-cardinal', title: '基数词', desc: 'one → one hundred',
    words: [
      w('one', '一'), w('two', '二'), w('three', '三'), w('four', '四'), w('five', '五'),
      w('six', '六'), w('seven', '七'), w('eight', '八'), w('nine', '九'), w('ten', '十'),
      w('eleven', '十一'), w('twelve', '十二'), w('thirteen', '十三'), w('fourteen', '十四'),
      w('fifteen', '十五'), w('sixteen', '十六'), w('seventeen', '十七'), w('eighteen', '十八'),
      w('nineteen', '十九'), w('twenty', '二十'), w('twenty-one', '二十一'),
      w('twenty-two', '二十二'), w('twenty-three', '二十三'), w('thirty', '三十'),
      w('forty', '四十'), w('fifty', '五十'), w('sixty', '六十'), w('seventy', '七十'),
      w('eighty', '八十'), w('ninety', '九十'), w('one hundred', '一百'),
    ],
  },
  {
    id: 'en4-app-ordinal', title: '序数词', desc: 'first → thirty-first',
    words: [
      w('first', '第一'), w('second', '第二'), w('third', '第三'), w('fourth', '第四'),
      w('fifth', '第五'), w('sixth', '第六'), w('seventh', '第七'), w('eighth', '第八'),
      w('ninth', '第九'), w('tenth', '第十'), w('eleventh', '第十一'), w('twelfth', '第十二'),
      w('thirteenth', '第十三'), w('fourteenth', '第十四'), w('fifteenth', '第十五'),
      w('sixteenth', '第十六'), w('seventeenth', '第十七'), w('eighteenth', '第十八'),
      w('nineteenth', '第十九'), w('twentieth', '第二十'), w('twenty-first', '第二十一'),
      w('twenty-second', '第二十二'), w('twenty-third', '第二十三'), w('twenty-fourth', '第二十四'),
      w('twenty-fifth', '第二十五'), w('twenty-sixth', '第二十六'), w('twenty-seventh', '第二十七'),
      w('twenty-eighth', '第二十八'), w('twenty-ninth', '第二十九'), w('thirtieth', '第三十'),
      w('thirty-first', '第三十一'),
    ],
  },
]

const old = JSON.parse(readFileSync(FILE, 'utf8'))

// ---- 保留语法/拔高 kp ----
const keptKps = (old.knowledgePoints ?? []).filter(
  (k) => k.id.startsWith('kp-en4-g') || k.id.startsWith('kp-en4-adv-'),
)

// ---- 造单词 kp + 默写题 ----
const kps = []
const units = []
const dup = new Set()
const addKp = (k) => {
  if (dup.has(k.id)) throw new Error(`kp id 重复: ${k.id}`)
  dup.add(k.id)
  kps.push(k)
}

/** 默写题答案剥句末标点（App 端 normalize 也会剥，双保险） */
const stripEnd = (s) => s.replace(/[.!?、。！？]+$/u, '')

const wordKp = (pid, idx, { en, zh }) => ({
  id: `kp-sh4en-${pid}-w${String(idx).padStart(2, '0')}`,
  type: 'word',
  title: en,
  content: zh,
  metadata: { word: en, meaning: zh },
})

const wordExercise = (exId, kpId, { en, zh }) => ({
  id: exId,
  type: 'blank',
  question: `【单词默写】${zh} → （　）`,
  answer: stripEnd(en),
  explanation: `${zh} → ${en}`,
  knowledgePointIds: [kpId],
  metadata: { difficulty: '基础', title: stripEnd(en) },
})

const buildVocabTopic = (unitId, seq, words) => {
  const topicId = `${unitId}-t${seq}`
  const kpIds = []
  const exercises = []
  words.forEach((word, i) => {
    const kp = wordKp(unitId.replace('en4-', ''), i + 1, word)
    addKp(kp)
    kpIds.push(kp.id)
    exercises.push(wordExercise(`${unitId}-w${String(i + 1).padStart(2, '0')}`, kp.id, word))
  })
  return {
    id: topicId,
    title: `单词默写（${words.length} 个）`,
    desc: '看中文写英文，写完对照订正',
    board: '单词',
    knowledgePointIds: kpIds,
    modules: [
      {
        id: `${topicId}-m1`,
        type: 'english.vocab',
        title: '词汇',
        knowledgePointIds: kpIds,
      },
    ],
    exercises,
  }
}

// ---- Unit 1–8 ----
for (const u of UNITS) {
  const topic = buildVocabTopic(u.id, 1, u.words)
  units.push({
    id: u.id,
    name: u.name,
    title: `${u.name} · 词汇`,
    desc: `${u.words.length} 个单词（沪教版 Word list）`,
    knowledgePointIds: [...topic.knowledgePointIds],
    topics: [topic],
  })
}

// ---- 附录单元 ----
{
  const unitId = 'en4-appendix'
  const topics = APPENDIX.map((sec, si) => {
    const topicId = `${unitId}-t${si + 1}`
    const kpIds = []
    const exercises = []
    sec.words.forEach((word, i) => {
      const kp = {
        ...wordKp('app' + si, i + 1, word),
        id: `kp-sh4en-app-${['prop', 'mon', 'card', 'ord'][si]}-w${String(i + 1).padStart(2, '0')}`,
      }
      addKp(kp)
      kpIds.push(kp.id)
      exercises.push(wordExercise(`${topicId}-e${String(i + 1).padStart(2, '0')}`, kp.id, word))
    })
    return {
      id: topicId,
      title: `${sec.title}（${sec.words.length} 个）`,
      desc: sec.desc,
      board: '附录',
      knowledgePointIds: kpIds,
      modules: [
        { id: `${topicId}-m1`, type: 'english.vocab', title: sec.title, knowledgePointIds: kpIds },
      ],
      exercises,
    }
  })
  const allKpIds = topics.flatMap((t) => t.knowledgePointIds)
  units.push({
    id: unitId,
    name: 'Appendix',
    title: '附录 · 数字、月份与专有名词',
    desc: '课本词表附录：专有名词 / 月份 / 基数词 / 序数词',
    knowledgePointIds: allKpIds,
    topics,
  })
}

// ---- 保留语法/拔高单元（原样）----
const keptUnits = (old.units ?? []).filter(
  (u) => u.id === 'en4-grammar' || u.id === 'en4-advanced',
)

const next = {
  manifest: {
    ...old.manifest,
    version: '1.1.1',
    edition: '沪教版',
    title: '四上英语 · 词汇（沪教版牛津上海 8 单元 + 附录）',
  },
  knowledgePoints: [...kps, ...keptKps],
  units: [...units, ...keptUnits],
}

// 无 exercises 顶层（原包如此，保持）
const out = { ...next }
delete out.exercises

writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n')

const totalWords = UNITS.reduce((s, u) => s + u.words.length, 0) + APPENDIX.reduce((s, a) => s + a.words.length, 0)
console.log(`✅ 重建完成：${UNITS.length} 个单元 + 附录（共 ${totalWords} 个词 / ${kps.length} 个新 kp + 保留 ${keptKps.length} 个语法 kp）`)
console.log(`   版本 → ${next.manifest.version}；单元题数：${units.map((u) => `${u.id}=${u.topics[0].exercises.length}`).join(' ')}`)
