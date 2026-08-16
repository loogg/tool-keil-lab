import { useEffect, useState } from 'react'
import {
  Map, MemoryStick, ScanSearch, Grid3x3, Terminal, Route, Printer, FlaskConical, Menu, X,
} from 'lucide-react'
import IntroModule from './modules/IntroModule'
import MemoryLabModule from './modules/MemoryLabModule'
import MacroLabModule from './modules/MacroLabModule'
import StructLabModule from './modules/StructLabModule'
import DiagnosticModule from './modules/DiagnosticModule'
import ErrnoModule from './modules/ErrnoModule'
import PrintfModule from './modules/PrintfModule'

const MODULES = [
  { id: 'intro', label: '开篇导读', icon: Map, view: IntroModule },
  { id: 'memory', label: '内存布局实验室', icon: MemoryStick, view: MemoryLabModule },
  { id: 'macros', label: '宏探测站', icon: ScanSearch, view: MacroLabModule },
  { id: 'structs', label: '结构体布局实验室', icon: Grid3x3, view: StructLabModule },
  { id: 'diagnostics', label: '诊断控制台', icon: Terminal, view: DiagnosticModule },
  { id: 'errno', label: 'errno 隧道', icon: Route, view: ErrnoModule },
  { id: 'printf', label: 'printf 的旅程', icon: Printer, view: PrintfModule },
]

export default function App() {
  const [active, setActive] = useState('intro')
  const [navOpen, setNavOpen] = useState(false) // 移动端抽屉开关（lg+ 常驻显示，不受影响）
  const current = MODULES.find((m) => m.id === active) ?? MODULES[0]
  const View = current.view

  // 切换模块；移动端同时收起抽屉
  const navigate = (id) => {
    setActive(id)
    setNavOpen(false)
  }

  // Escape 关闭抽屉
  useEffect(() => {
    if (!navOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* 移动端顶部栏：hamburger + 应用名 + 版本号，外加一行可横滑的模块快捷标签 */}
      <header className="sticky top-0 z-20 border-b border-line bg-panel lg:hidden">
        <div className="flex h-14 items-center gap-2.5 px-3">
          <button
            type="button"
            aria-label="打开导航"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
            className="rounded-md p-2 text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            <Menu size={20} />
          </button>
          <FlaskConical size={18} className="shrink-0 text-accent" />
          <span className="truncate text-sm font-bold">Keil 交互实验室</span>
          <span className="ml-auto shrink-0 text-[11px] text-muted">v{import.meta.env.APP_VERSION}</span>
        </div>
        <nav aria-label="模块快捷导航" className="flex gap-1.5 overflow-x-auto px-3 pb-2">
          {MODULES.map((m) => {
            const Icon = m.icon
            const on = m.id === active
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => navigate(m.id)}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                  on
                    ? 'border-accent/40 bg-accent/15 text-accent'
                    : 'border-line bg-panel-2 text-muted hover:text-ink'
                }`}
              >
                <Icon size={14} />
                {m.label}
              </button>
            )
          })}
        </nav>
      </header>

      {/* 抽屉打开时的半透明 backdrop，点击关闭 */}
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          aria-hidden="true"
          onClick={() => setNavOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-panel transition-[transform,visibility] duration-200 ${
          navOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'
        } lg:visible lg:translate-x-0`}
      >
        <div className="border-b border-line px-4 py-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FlaskConical size={20} className="text-accent" />
              <h1 className="text-base font-bold">Keil 交互实验室</h1>
            </div>
            <button
              type="button"
              aria-label="关闭导航"
              onClick={() => setNavOpen(false)}
              className="-mr-1.5 rounded-md p-1.5 text-muted transition-colors hover:bg-panel-2 hover:text-ink lg:hidden"
            >
              <X size={18} />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            Arm 编译工具链交互课 · v{import.meta.env.APP_VERSION}
          </p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {MODULES.map((m) => {
            const Icon = m.icon
            const on = m.id === active
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => navigate(m.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  on ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-panel-2 hover:text-ink'
                }`}
              >
                <Icon size={16} />
                {m.label}
              </button>
            )
          })}
        </nav>
        <div className="border-t border-line px-4 py-3 text-[11px] text-muted">
          <a
            href="https://github.com/loogg/tool-keil-lab"
            target="_blank"
            rel="noreferrer"
            className="hover:text-accent"
          >
            GitHub 仓库 ↗
          </a>
        </div>
      </aside>
      <main className="min-w-0 lg:ml-60">
        <View onNavigate={navigate} />
      </main>
    </div>
  )
}
