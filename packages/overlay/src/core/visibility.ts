import type { Comment, CommentScope, HandoffOptions } from './types'

export interface CommentVisibility {
  scopeActive: boolean
  anchorVisible: boolean
  visible: boolean
}

type ScopeHooks = Pick<HandoffOptions, 'isScopeActive'>

export function isElementVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return true
  }

  if (element.hidden) {
    return false
  }

  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
    return false
  }

  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return false
  }

  return element.getClientRects().length > 0
}

function safeQueryAll(selector: string): Element[] {
  if (!selector) return []
  try {
    return Array.from(document.querySelectorAll(selector))
  } catch {
    return []
  }
}

/**
 * ユーザー提供の判定関数なので、例外は握って「表示する」側に倒す。
 * ここで落ちてコメントが消えるより、誤って見えている方が実害が小さい。
 */
export function isScopeActive(scope: CommentScope | undefined, hooks: ScopeHooks): boolean {
  if (!scope) return true
  if (!hooks.isScopeActive) return true

  try {
    return hooks.isScopeActive(scope)
  } catch {
    return true
  }
}

export function getCommentVisibility(comment: Comment, hooks: ScopeHooks): CommentVisibility {
  const scopeActive = isScopeActive(comment.scope, hooks)
  const allMatches = safeQueryAll(comment.anchor.selector)
  // 要素が DOM から消えている → viewport フォールバックに任せるので表示扱い
  // 要素は存在するが全部非表示（非アクティブなタブ等） → ピンも隠す
  const anchorVisible = allMatches.length === 0 ? true : allMatches.some((el) => isElementVisible(el))

  return {
    scopeActive,
    anchorVisible,
    visible: scopeActive && anchorVisible,
  }
}

export function filterVisibleComments(comments: Comment[], hooks: ScopeHooks): Comment[] {
  return comments.filter((comment) => getCommentVisibility(comment, hooks).visible)
}
