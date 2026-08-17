import { useState } from 'react'
import Workbench from '../components/workbench/Workbench'
import { Button, FieldRow, SectionLabel, Segmented } from '../components/workbench/controls'
import { DrawerTrigger, Principle, RefTable } from '../components/workbench/Principle'
import CodeBlock from '../components/CodeBlock'
import { WARNING_CASES, SUPPRESS_TEMPLATES, SYSTEM_HEADER } from '../data/diagnostics'

const PRAGMA_MESSAGE_CODE = `#pragma message("wrapper errno.h included")`

export default function DiagnosticModule() {
  const [caseId, setCaseId] = useState('wformat')
  const [compiler, setCompiler] = useState('ac6')
  const [scope, setScope] = useState('file')

  const c = WARNING_CASES.find((w) => w.id === caseId)
  const compilerLabel = compiler === 'ac6' ? 'AC6' : 'AC5'
  const scopeLabel = scope === 'file' ? '全文件' : '局部 push/pop'

  // ---- 实验 Warning 案例 ----
  const warningControl = (
    <div className="space-y-3">
      <SectionLabel className="mb-2">Case · 警告案例</SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {WARNING_CASES.map((w) => (
          <Button key={w.id} variant={caseId === w.id ? 'primary' : 'ghost'} onClick={() => setCaseId(w.id)} className="font-mono">
            {w.flag}
          </Button>
        ))}
      </div>
      <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs leading-relaxed">
        <strong className="text-warn">笔记原则</strong>
        <p className="mt-1 text-ink/85">优先修正真实问题；只有第三方代码、兼容性代码或确认可接受的诊断才屏蔽 Warning。</p>
      </div>
    </div>
  )

  const warningCanvas = (
    <div className="space-y-4">
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
        <div className="mt-3 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-xs leading-relaxed">
          <strong className="text-ok">处理建议</strong>
          <p className="mt-1 text-ink/85">{c.advice}</p>
        </div>
      </div>
    </div>
  )

  // ---- 实验② 屏蔽代码生成器 ----
  const pragmaControl = (
    <div className="space-y-5">
      <div>
        <SectionLabel className="mb-2">Compiler · 编译器</SectionLabel>
        <Segmented
          options={[
            { id: 'ac6', label: 'AC6' },
            { id: 'ac5', label: 'AC5' },
          ]}
          value={compiler}
          onChange={setCompiler}
          className="w-full"
        />
      </div>
      <div>
        <SectionLabel className="mb-2">Scope · 作用范围</SectionLabel>
        <Segmented
          options={[
            { id: 'file', label: '全文件' },
            { id: 'local', label: '局部 push/pop' },
          ]}
          value={scope}
          onChange={setScope}
          className="w-full"
        />
      </div>
    </div>
  )

  const pragmaCanvas = (
    <div className="space-y-4">
      <CodeBlock title={`屏蔽片段 · ${compilerLabel} · ${scopeLabel}`} code={SUPPRESS_TEMPLATES[compiler][scope]} />
      <div className="space-y-2 text-xs leading-relaxed text-muted">
        <p>• AC6 不用 push/pop 时，#pragma 从书写位置生效到当前 translation unit 结束，不影响其他 .c 文件。</p>
        <p>• AC5 用诊断号机制（如 1254），屏蔽时填的是诊断号而不是警告名称。</p>
      </div>
    </div>
  )

  // ---- 实验③ System Header 与搜索链 ----
  const systemHeaderCanvas = (
    <div className="space-y-4">
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
      <RefTable
        head={['编译器', 'system include 目录开关', '头文件内声明']}
        rows={Object.entries(SYSTEM_HEADER).map(([id, row]) => [id.toUpperCase(), row.dirFlag, row.pragma])}
      />
      <div className="space-y-2 text-xs leading-relaxed text-muted">
        <p>• -I 是普通 include 目录，-J（AC5）/ -isystem（AC6）才是 system include。</p>
        <p>• System Header 内的大部分诊断默认不显示。不建议用它来隐藏自有代码问题。</p>
        <p>• Zephyr 的 <code className="font-mono">zephyr_system_include_directories(include)</code> 会把兼容头文件作为 system include 加入。</p>
      </div>
    </div>
  )

  // ---- 实验④ 决策树 ----
  const decisionCanvas = (
    <div className="space-y-4">
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
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-panel p-4">
          <p className="mb-2 text-sm font-semibold text-ink">--Werror：把警告当错误</p>
          <p className="text-xs leading-relaxed text-muted">
            把警告当错误（armclang -Werror / armcc --remarks --errors）能在 CI 里强制清零新增警告，是大型工程的常见策略。
          </p>
        </div>
        <div className="rounded-lg border border-line bg-panel p-4">
          <p className="mb-2 text-sm font-semibold text-ink">#pragma message：验证 include 顺序</p>
          <CodeBlock title="wrapper errno.h 顶部" code={PRAGMA_MESSAGE_CODE} />
          <p className="mt-2 text-xs leading-relaxed text-muted">
            放在 wrapper 头文件顶部，编译输出里就能看到它是否真的被优先包含 —— 验证 include 搜索顺序的技巧。
          </p>
        </div>
      </div>
    </div>
  )

  return (
    <Workbench
      title="诊断控制台"
      tagline="Warning 该修还是该屏蔽？看真实案例、生成屏蔽 pragma、弄懂 System Header 搜索链，再走一遍决策树"
      experiments={[
        { id: 'warning', label: 'Warning 案例', control: warningControl, canvas: warningCanvas },
        { id: 'pragma', label: '屏蔽代码生成器', control: pragmaControl, canvas: pragmaCanvas },
        { id: 'system', label: 'System Header', control: <SectionLabel>搜索链与 system include</SectionLabel>, canvas: systemHeaderCanvas },
        { id: 'decision', label: '决策树', control: <SectionLabel>决策树与实用技巧</SectionLabel>, canvas: decisionCanvas },
      ]}
    />
  )
}
