import { useState } from 'react'
import {
  Map, MemoryStick, ScanSearch, Grid3x3, Terminal, Route, Printer, FlaskConical,
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
  const current = MODULES.find((m) => m.id === active) ?? MODULES[0]
  const View = current.view
  return (
    <div className="min-h-screen bg-bg text-ink">
      <aside className="fixed inset-y-0 left-0 z-10 flex w-60 flex-col border-r border-line bg-panel">
        <div className="border-b border-line px-4 py-5">
          <div className="flex items-center gap-2">
            <FlaskConical size={20} className="text-accent" />
            <h1 className="text-base font-bold">Keil 交互实验室</h1>
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
                onClick={() => setActive(m.id)}
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
      <main className="ml-60">
        <View onNavigate={setActive} />
      </main>
    </div>
  )
}
