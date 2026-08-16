const TONES = {
  tip: { icon: '💡', cls: 'border-sky-400/30 bg-sky-400/10' },
  warn: { icon: '⚠️', cls: 'border-warn/40 bg-warn/10' },
  ok: { icon: '✅', cls: 'border-emerald-400/30 bg-emerald-400/10' },
}

export default function Callout({ tone = 'tip', title, children }) {
  const t = TONES[tone]
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${t.cls}`}>
      <div className="font-semibold">
        <span className="mr-1.5">{t.icon}</span>
        {title}
      </div>
      <div className="mt-1 text-ink/85">{children}</div>
    </div>
  )
}
