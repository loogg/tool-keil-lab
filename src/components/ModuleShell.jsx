export default function ModuleShell({ kicker, title, subtitle, children }) {
  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-accent">{kicker}</p>
      <h2 className="text-2xl font-bold text-ink">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{subtitle}</p>
      <div className="mt-8 space-y-10">{children}</div>
    </section>
  )
}
