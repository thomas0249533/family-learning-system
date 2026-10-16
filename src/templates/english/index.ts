import { registerTemplate } from '@/core/registry/templateRegistry'
import EnglishVocab from '@modules/english/EnglishVocab.vue'
import EnglishSentence from '@modules/english/EnglishSentence.vue'
import EnglishGrammar from '@modules/english/EnglishGrammar.vue'
import EnglishReading from '@modules/english/EnglishReading.vue'
import EnglishWriting from '@modules/english/EnglishWriting.vue'

export function registerEnglishTemplate() {
  registerTemplate({
    id: 'english.primary.v1',
    subject: 'english',
    name: '小学英语模板 V1',
    moduleTypes: {
      'english.vocab': EnglishVocab,
      'english.sentence': EnglishSentence,
      'english.grammar': EnglishGrammar,
      'english.reading': EnglishReading,
      'english.writing': EnglishWriting
    }
  })
}