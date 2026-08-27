import { Marked } from 'marked'
import DOMPurify from 'dompurify'

/**
 * Shared Marked instance — configured with GFM + breaks,
 * same settings as the former AgentMessageBlock.vue local instance.
 * Custom renderer: codespan → inline-code class, code block → code-block class.
 */
const markedInstance = new Marked({
  breaks: true,
  gfm: true
})

/**
 * 自定义 renderer 绕过了 marked 默认的 HTML 转义，代码文本需自行转义，
 * 否则代码块里的 <div> 等白名单标签会被 DOMPurify 放行后当成真实 DOM 渲染。
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

markedInstance.use({
  renderer: {
    codespan({ text }: { text: string }): string {
      return `<code class="inline-code">${escapeHtml(text)}</code>`
    },
    code({ text }: { text: string; lang?: string }): string {
      return `<pre class="code-block"><code>${escapeHtml(text.trimEnd())}</code></pre>`
    }
  }
})

/**
 * DOMPurify configuration — whitelist covers all Markdown output tags.
 * ADD_ATTR allows `target` + `rel` for safe external links.
 */
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'strong', 'em', 'del', 'ins',
    'a',
    'ul', 'ol', 'li',
    'blockquote',
    'pre', 'code',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img',
    'span', 'div'
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id'],
  ADD_ATTR: ['target', 'rel'],
  ALLOW_DATA_ATTR: false
}

/**
 * Composable that provides a unified markdown→HTML renderer with DOMPurify sanitization.
 * Replaces both the regex-based renderer in ChatMessageList.vue
 * and the local markedInstance + DOMParser sanitize in AgentMessageBlock.vue.
 */
export function useMarkdownRenderer() {
  /**
   * Render markdown text to sanitized HTML.
   * 1. Parse markdown via the shared Marked instance
   * 2. Sanitize HTML via DOMPurify (removes XSS, ensures safe output)
   */
  function renderMarkdown(text: string): string {
    if (!text) return ''
    const rawHtml = markedInstance.parse(text) as string
    // DOMPurify.sanitize returns string by default; sanitizes and enforces safe link behavior
    return DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG)
  }

  return { renderMarkdown }
}
