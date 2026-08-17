// 「原理」按需层：解释性文字全部移出页面正文，挂到就近控件的 ? 触发器上。
// 浅层 = Principle 弹层；深层/表格 = Drawer 速查抽屉。见设计文档第 3.4 节。
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from './controls'

export function Principle({ title, children }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label={`原理：${title}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line-strong text-[10px] leading-none text-muted transition-colors hover:border-accent hover:text-accent"
      >
        ?
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-2 w-80 max-w-[78vw] rounded-lg border border-accent/30 bg-panel-2 p-3.5 shadow-[0_16px_40px_rgba(0,0,0,0.55)]">
            <div className="mb-1.5 text-xs font-semibold text-ink">{title}</div>
            <div className="text-xs leading-relaxed text-secondary">{children}</div>
          </div>
        </>
      )}
    </span>
  )
}

export function Drawer({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" aria-hidden="true" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-panel">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="rounded-md p-1 text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-xs leading-relaxed text-secondary">
          {children}
        </div>
      </aside>
    </>
  )
}

// 一键挂抽屉：label 是触发按钮文案，title/children 是抽屉内容
export function DrawerTrigger({ label, title, children, variant = 'ghost' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={title}>
        {children}
      </Drawer>
    </>
  )
}

// 抽屉里的速查表：[[单元格]] 二维数组，首行为表头
export function RefTable({ head, rows }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line bg-panel-2 text-[11px] text-muted">
            {head.map((h) => (
              <th key={h} className="px-2.5 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-b-0">
              {r.map((c, j) => (
                <td key={j} className={`px-2.5 py-2 align-top ${j === 0 ? 'font-mono text-ink' : 'text-muted'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
