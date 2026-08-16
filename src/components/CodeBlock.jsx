import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export default function CodeBlock({ code, title = 'code', highlightLines = [], className = '' }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默（例如非 https 预览环境）
    }
  }
  const lines = code.split('\n')
  return (
    <div className={`overflow-hidden rounded-lg border border-line bg-code ${className}`}>
      <div className="flex items-center justify-between border-b border-line bg-panel-2 px-3 py-1.5">
        <span className="font-mono text-xs text-muted">{title}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted hover:bg-line/50 hover:text-ink"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-ink">
        {lines.map((ln, i) => (
          <div
            key={i}
            className={highlightLines.includes(i + 1) ? '-mx-3 bg-accent/15 px-3' : undefined}
          >
            {ln || ' '}
          </div>
        ))}
      </pre>
    </div>
  )
}
