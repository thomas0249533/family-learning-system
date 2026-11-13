import type { Directive, DirectiveBinding } from 'vue'

/**
 * v-clickable · 让「非 button 容器」真正能用键盘操作（V4.0 · D5）
 *
 * ## 为什么需要这条指令
 * 首页今日卡、学习包卡、专题卡、单元卡、搜索结果行……这些本来都是 `div + @click`。
 * 鼠标能点，键盘完全进不去：没有 `tabindex` 就 Tab 不到，没有 `role` 读屏也不说
 * 「这是一个可操作的按钮」。
 *
 * 手写一遍是三行（`role` / `tabindex` / `@keydown`），八个地方各写一遍必然漏 ——
 * 事实上之前就是八处全裸。收敛成一条指令，新增卡片只要写 `v-clickable` 就不会忘。
 *
 * ## 两种语义，别混用
 * - `v-clickable`（默认）→ `role="button"`：**触发动作**，Enter **和** Space 都激活
 *   （Space 要 `preventDefault`，否则会滚动页面）。例：翻面卡、展开/收起。
 * - `v-clickable:link` → `role="link"`：**跳转到别处**，只有 Enter 激活。
 *   读屏会念「链接」而不是「按钮」，与真实行为一致 —— 卡片点开是去下一层，不是执行命令。
 *
 * ## 为什么用 `el.click()` 而不是自己调回调
 * 复用元素上已有的 `@click`。指令不持有业务逻辑，只负责「键盘能触发它」，
 * 这样 `@click` 里改了什么，键盘路径自动跟上，不会出现两套入口行为不一致。
 *
 * ## 与全局焦点环的关系
 * 指令只补语义与键盘，**不写样式**。焦点环由 `components.scss` 的全局
 * `:focus-visible` 统一给，颜色/宽度/偏移都走 token —— 这里再写一份就又多一个漂移源。
 */
function activate(el: HTMLElement): void {
  // 作者显式标记禁用时不响应（与原生 button:disabled 的语义保持一致）
  if (el.getAttribute('aria-disabled') === 'true') return
  el.click()
}

/** 按键意图：要不要激活、要不要 `preventDefault` */
export interface KeyAction {
  activate: boolean
  preventDefault: boolean
}

const IGNORE: KeyAction = { activate: false, preventDefault: false }

/**
 * 纯函数：给定 role 与按键，算出该做什么。
 *
 * 抽出来是为了能被单测覆盖 —— 指令本身要 DOM 才能跑，而"Enter 激活 / Space 滚动"
 * 这类语义差异恰恰是最容易写反的地方（链接按 Space 是翻页，不是点击）。
 *
 * | role | Enter | Space |
 * |------|-------|-------|
 * | link | 激活  | 滚动页面（不激活） |
 * | button | 激活 | 激活（并阻止滚动） |
 */
export function resolveKeyAction(role: string | null, key: string): KeyAction {
  const isLink = role === 'link'
  if (key === 'Enter') return { activate: true, preventDefault: isLink }
  if (key === ' ' || key === 'Spacebar') {
    return isLink ? IGNORE : { activate: true, preventDefault: true }
  }
  return IGNORE
}

function onKeydown(e: KeyboardEvent): void {
  const el = e.currentTarget as HTMLElement | null
  if (!el) return
  const action = resolveKeyAction(el.getAttribute('role'), e.key)
  if (!action.activate && !action.preventDefault) return
  if (action.preventDefault) e.preventDefault()
  if (action.activate) activate(el)
}

/** 同一元素重复挂载时不要重复绑监听（v-if 反复切换的场景） */
const BOUND = new WeakSet<HTMLElement>()

/**
 * 纯函数：该补什么 role。
 * 作者已显式声明 role 时尊重作者（例如 `role="tab"`），只补键盘。
 */
export function resolveRole(arg: unknown, existing: string | null): string {
  if (existing) return existing
  return arg === 'link' ? 'link' : 'button'
}

function apply(el: HTMLElement, binding: DirectiveBinding): void {
  const role = resolveRole(binding.arg, el.getAttribute('role'))
  if (!el.hasAttribute('role')) el.setAttribute('role', role)
  if (!el.hasAttribute('tabindex')) {
    // 0 = 进入自然 Tab 顺序。用 0 而不是 -1：这些卡片就是主路径，必须能 Tab 到
    el.setAttribute('tabindex', '0')
  }
  // 供样式层 / 门禁 / e2e 识别，不参与视觉
  el.setAttribute('data-clickable', role)
}

export const vClickable: Directive<HTMLElement> = {
  mounted(el, binding) {
    apply(el, binding)
    if (!BOUND.has(el)) {
      el.addEventListener('keydown', onKeydown)
      BOUND.add(el)
    }
  },
  updated(el, binding) {
    apply(el, binding)
  },
  unmounted(el) {
    el.removeEventListener('keydown', onKeydown)
    BOUND.delete(el)
  },
}
