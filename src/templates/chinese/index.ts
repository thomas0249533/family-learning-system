import { registerTemplate } from '@/core/registry/templateRegistry'
import ChinesePoem from '@modules/chinese/ChinesePoem.vue'
import ChineseText from '@modules/chinese/ChineseText.vue'
import ChineseWords from '@modules/chinese/ChineseWords.vue'
import ChineseWriting from '@modules/chinese/ChineseWriting.vue'

export function registerChineseTemplate() {
  registerTemplate({
    id: 'chinese.primary.v1',
    subject: 'chinese',
    name: '小学语文模板 V1',
    moduleTypes: {
      'chinese.poem': ChinesePoem,
      'chinese.text': ChineseText,
      'chinese.words': ChineseWords,
      'chinese.writing': ChineseWriting
    }
  })
}