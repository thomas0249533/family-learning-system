import { registerModule } from './moduleRegistry'

// Math
import MathFormula from '@modules/math/MathFormula.vue'
import MathConcept from '@modules/math/MathConcept.vue'
import MathLife from '@modules/math/MathLife.vue'

// Chinese
import ChinesePoem from '@modules/chinese/ChinesePoem.vue'
import ChineseText from '@modules/chinese/ChineseText.vue'
import ChineseWords from '@modules/chinese/ChineseWords.vue'
import ChineseWriting from '@modules/chinese/ChineseWriting.vue'

// English
import EnglishVocab from '@modules/english/EnglishVocab.vue'
import EnglishSentence from '@modules/english/EnglishSentence.vue'
import EnglishGrammar from '@modules/english/EnglishGrammar.vue'
import EnglishReading from '@modules/english/EnglishReading.vue'
import EnglishWriting from '@modules/english/EnglishWriting.vue'

let registered = false

export function registerAllModules() {
  if (registered) return
  registered = true

  // 数学
  registerModule('math.formula', MathFormula)
  registerModule('math.concept', MathConcept)
  registerModule('math.life', MathLife)

  // 语文
  registerModule('chinese.poem', ChinesePoem)
  registerModule('chinese.text', ChineseText)
  registerModule('chinese.words', ChineseWords)
  registerModule('chinese.writing', ChineseWriting)

  // 英语
  registerModule('english.vocab', EnglishVocab)
  registerModule('english.sentence', EnglishSentence)
  registerModule('english.grammar', EnglishGrammar)
  registerModule('english.reading', EnglishReading)
  registerModule('english.writing', EnglishWriting)

  console.log('[ModuleRegistry] 已注册模块:', 13)
}