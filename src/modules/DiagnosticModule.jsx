import { useState } from 'react'
import ModuleShell from '../components/ModuleShell'
import CodeBlock from '../components/CodeBlock'
import Callout from '../components/Callout'
import { WARNING_CASES, SUPPRESS_TEMPLATES, SYSTEM_HEADER } from '../data/diagnostics'

// 屏蔽代码生成器的两个切换维度：编译器 AC6/AC5 × 范围 全文件/局部
const COMPILER_TABS = [
  { id: 'ac6', label: 'AC6' },
  { id: 'ac5', label: 'AC5' },
]
const SCOPE_TABS = [
  { id: 'file', label: '全文件' },
  { id: 'local', label: '局部 push/pop' },
]

const PRAGMA_MESSAGE_CODE = `#pragma message("wrapper errno.h included")`

// 通用切换按钮：选中态描边高亮，未选中悬停提示
function TabButton({ active, mono = false, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded border px-3 py-1 text-xs transition-colors',
        mono ? 'font-mono' : '',
        active
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-line bg-panel text-muted hover:border-accent hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export default function DiagnosticModule() {
  // —— Warning 案例 ——
  const [caseId, setCaseId] = useState('wformat')

  // —— 屏蔽代码生成器 ——
  const [compiler, setCompiler] = useState('ac6')
  const [scope, setScope] = useState('file')

  const c = WARNING_CASES.find((w) => w.id === caseId)
  const compilerLabel = COMPILER_TABS.find((t) => t.id === compiler).label
  const scopeLabel = SCOPE_TABS.find((t) => t.id === scope).label

  return (
    <ModuleShell
      kicker="Diagnostics"
      title="诊断控制台"
      subtitle="Warning 该修还是该屏蔽？看真实案例、生成 AC5/AC6 屏蔽 pragma、弄懂 System Header 搜索链，再走一遍决策树。"
    >
      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">常见 Warning 案例</h3>
        <p className="mb-3 text-xs text-muted">两类高频警告：格式符不匹配与旧式函数声明，先看坏写法再对照修正</p>
        <Callout tone="warn" title="笔记原则">
          优先修正真实问题；只有第三方代码、兼容性代码或确认可接受的诊断才屏蔽 Warning。
        </Callout>
        <div className="mt-3 mb-3 flex flex-wrap gap-2">
          {WARNING_CASES.map((w) => (
            <TabButton
              key={w.id}
              mono
              active={caseId === w.id}
              onClick={() => setCaseId(w.id)}
            >
              {w.flag}
            </TabButton>
          ))}
        </div>
        <div className="rounded-lg border border-line bg-panel p-4">
          <p className="mb-3 text-sm leading-relaxed text-ink">
            <span className="font-mono text-accent">{c.flag}</span>
            <span className="mx-2 text-muted">·</span>
            {c.meaning}
          </p>
          <div className="space-y-3">
            <CodeBlock title="触发警告的写法" code={c.bad} className="border-l-2 border-l-danger" />
            <CodeBlock title="修正" code={c.good} className="border-l-2 border-l-emerald-400" />
          </div>
          <div className="mt-3">
            <Callout tone="tip" title="处理建议">{c.advice}</Callout>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">屏蔽代码生成器</h3>
        <p className="mb-3 text-xs text-muted">选择编译器与作用范围，直接复制可用的屏蔽 pragma 片段</p>
        <div className="rounded-lg border border-line bg-panel p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">编译器</span>
            {COMPILER_TABS.map((t) => (
              <TabButton key={t.id} active={compiler === t.id} onClick={() => setCompiler(t.id)}>
                {t.label}
              </TabButton>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">范围</span>
            {SCOPE_TABS.map((t) => (
              <TabButton key={t.id} active={scope === t.id} onClick={() => setScope(t.id)}>
                {t.label}
              </TabButton>
            ))}
          </div>
          <CodeBlock
            title={`屏蔽片段 · ${compilerLabel} · ${scopeLabel}`}
            code={SUPPRESS_TEMPLATES[compiler][scope]}
          />
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-muted">
            <li>
              AC6 不用 push/pop 时，#pragma 从书写位置生效到当前 translation unit 结束，不影响其他 .c 文件。
            </li>
            <li>AC5 用诊断号机制（如 1254），屏蔽时填的是诊断号而不是警告名称。</li>
          </ul>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">System Header 与 include 搜索链</h3>
        <p className="mb-3 text-xs text-muted">
          尖括号 include 按搜索链逐目录查找；落在 system 目录里的头文件，大部分诊断默认被抑制
        </p>
        <div className="rounded-lg border border-line bg-panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded border border-line bg-code px-3 py-2 font-mono text-xs text-ink">
              #include &lt;errno.h&gt;
            </div>
            <span className="text-muted">→</span>
            <div className="rounded border border-line bg-panel-2 px-3 py-2 text-xs text-muted">
              按 include 搜索链逐目录查找
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2">
              <p className="font-mono text-xs text-warn">-I 普通目录</p>
              <p className="mt-1 text-xs text-muted">警告照常报</p>
            </div>
            <div className="rounded border border-emerald-400/30 bg-emerald-400/10 px-3 py-2">
              <p className="font-mono text-xs text-emerald-400">-J / -isystem 系统目录</p>
              <p className="mt-1 text-xs text-muted">大部分警告被抑制</p>
            </div>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-xs text-muted">
                <th className="px-3 py-2 font-semibold">编译器</th>
                <th className="px-3 py-2 font-semibold">system include 目录开关</th>
                <th className="px-3 py-2 font-semibold">头文件内声明</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(SYSTEM_HEADER).map(([id, row]) => (
                <tr key={id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 text-xs font-semibold text-ink">{id.toUpperCase()}</td>
                  <td className="px-3 py-2 font-mono text-xs text-accent">{row.dirFlag}</td>
                  <td className="px-3 py-2 font-mono text-xs text-accent-2">{row.pragma}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-3">
          <Callout tone="tip" title="-I 与 system include 的区别">
            -I 是普通 include 目录，-J（AC5）/ -isystem（AC6）才是 system include。System Header
            内的大部分诊断默认不显示。不建议用它来隐藏自有代码问题。
          </Callout>
          <Callout tone="tip" title="Zephyr 实例">
            Zephyr 的 zephyr_system_include_directories(include)
            会把兼容头文件作为 system include 加入，因此 errno.h 中某些宏重定义即使 replacement
            不同，也可能看不到对应 Warning。
          </Callout>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">决策树与验证技巧</h3>
        <p className="mb-3 text-xs text-muted">
          拿到一条 Warning 先走决策树；--Werror 与 #pragma message 是两个工程实用技巧
        </p>
        <div className="rounded-lg border border-line bg-panel p-4">
          <p className="mb-2 text-sm font-semibold text-ink">要不要屏蔽这个警告？</p>
          <ul className="text-sm leading-relaxed text-ink">
            <li>
              是自有代码吗？
              <ul className="mt-1.5 ml-4 space-y-1.5 border-l border-line pl-4 text-xs text-muted">
                <li>→ 是：<span className="text-emerald-400">修正它，别屏蔽</span></li>
                <li>
                  → 否（第三方/生成代码）：确认过行为无风险吗？
                  <ul className="mt-1.5 ml-4 space-y-1.5 border-l border-line pl-4">
                    <li>→ 否：<span className="text-warn">先验证</span></li>
                    <li>→ 是：按最小范围屏蔽（局部 push/pop 优先于全文件）并记录原因</li>
                  </ul>
                </li>
              </ul>
            </li>
          </ul>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-line bg-panel p-4">
            <p className="mb-2 text-sm font-semibold text-ink">--Werror：把警告当错误</p>
            <p className="text-xs leading-relaxed text-muted">
              把警告当错误（armclang -Werror / armcc --remarks
              --errors）能在 CI 里强制清零新增警告，是大型工程的常见策略。
            </p>
          </div>
          <div className="rounded-lg border border-line bg-panel p-4">
            <p className="mb-2 text-sm font-semibold text-ink">#pragma message：验证 include 顺序</p>
            <CodeBlock title="wrapper errno.h 顶部" code={PRAGMA_MESSAGE_CODE} />
            <p className="mt-2 text-xs leading-relaxed text-muted">
              放在 wrapper 头文件顶部，编译输出里就能看到它是否真的被优先包含 —— 验证 include
              搜索顺序的技巧。
            </p>
          </div>
        </div>
      </section>
    </ModuleShell>
  )
}
