/**
 * 体验激励 · 反馈文案
 *
 * 目标只有一个：**不打击**。
 *
 * 原来的文案是"❌ 哎呀，掉进陷阱啦！"——把答错渲染成"中招/被坑"，
 * 对一个四年级孩子的实际效果是"我做错了，我笨"。教育心理学里，
 * 失败归因应该落在"这道题/这个思路"上，而不是"我"身上。
 *
 * 所以规则是：
 *   1. 答错时只描述题目与下一步（"这个点容易踩坑，看一下正确思路"），
 *      不用"陷阱/坑/又错了/怎么又"这类带指责意味的词；
 *   2. 答对时变化表达，避免每次都同一句导致边际激励归零；
 *   3. 练习结束时按正确率给不同措辞，但**任何档位的措辞都不出现否定人格的词**。
 */

/** 答对时的鼓励语（轮换，避免边际激励衰减） */
const CORRECT_LINES = [
  '✅ 太棒了，回答正确！',
  '✅ 漂亮，这道题拿下了！',
  '✅ 答对啦，思路很清晰！',
  '✅ 稳稳的，继续保持！',
  '✅ 正确，这道题难不倒你。',
]

/** 答错时的引导语——只讲题目和下一步，不讲"你" */
const WRONG_LINES = [
  '🤔 差一点点，我们一起看看怎么想',
  '🔍 这个点容易踩坑，来看一下正确思路',
  '💡 没关系，看懂了就是收获',
  '🧭 这里拐个弯就对了，一起看看',
]

/** 稳定取一个下标：传 seed 时结果可复现（便于测试），不传则随机 */
function pickIndex(len: number, seed?: number): number {
  if (len <= 0) return 0
  if (seed === undefined) return Math.floor(Math.random() * len)
  return Math.abs(Math.floor(seed)) % len
}

export function correctFeedback(seed?: number): string {
  return CORRECT_LINES[pickIndex(CORRECT_LINES.length, seed)]
}

export function wrongFeedback(seed?: number): string {
  return WRONG_LINES[pickIndex(WRONG_LINES.length, seed)]
}

export interface FinishFeedback {
  type: 'success' | 'info' | 'warning'
  text: string
}

/**
 * 练习结束反馈。按正确率分档，但**每一档都是"往前看"的措辞**。
 * 注意这里刻意不给"正确率低"配上任何"你要加油/你不够好"的暗示。
 */
export function finishFeedback(
  correct: number,
  total: number
): FinishFeedback {
  if (total <= 0) return { type: 'info', text: '这次没有题目，换一个主题试试吧' }
  const rate = correct / total

  if (correct === total) {
    return { type: 'success', text: `🎉 全部答对！${total} 道题一个都没落下，这套你已经完全拿下了` }
  }
  if (rate >= 0.8) {
    return { type: 'success', text: `🎉 答对 ${correct} / ${total}，非常稳！这套题基本掌握了` }
  }
  if (rate >= 0.6) {
    return { type: 'info', text: `💪 答对 ${correct} / ${total}，大部分都对了，把剩下的挑出来看看就好` }
  }
  if (correct > 0) {
    return { type: 'info', text: `🌱 答对 ${correct} / ${total}，这套题有点挑战，我们一起看解析慢慢来` }
  }
  return { type: 'warning', text: `🤝 这套题整体偏难，先看解析理一理思路，下次会顺很多` }
}
