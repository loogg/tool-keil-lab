import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import ModuleShell from '../components/ModuleShell'
import CodeBlock from '../components/CodeBlock'
import Callout from '../components/Callout'
import {
  EXPAND_STEPS, ARM_ERRNO_H, TASK_OVERRIDE, WRAPPER_ERRNO_H, LIBC_ERRNO_TABLE, INCLUDE_ORDER,
} from '../data/errnoData'

// 并发演示每一步的间隔（ms）
const STEP_INTERVAL = 700

// 结论卡片三条（笔记原文）
const CONCLUSIONS = [
  'Keil / ArmClang：保留 errno → __aeabi_errno_addr() 的 Arm ABI 机制。',
  '需要多任务隔离：让 __aeabi_errno_addr() 返回当前任务自己的 errno。',
  '移植 Zephyr 模块：自定义包装 errno.h 只补错误码，不另建一套 errno。',
]

// 按模式生成三步时间线：A 写 22 → B 写 5 → A 读
const buildRunSteps = (mode) => {
  if (mode === 'global') {
    return [
      { id: 'a-write', actor: 'A', op: 'write', value: 22, text: '任务 A 写 errno = EINVAL (22)' },
      { id: 'b-write', actor: 'B', op: 'write', value: 5, text: '任务 B 写 errno = EIO (5)，覆盖同一个全局存储格' },
      { id: 'a-read', actor: 'A', op: 'read', value: 5, verdict: 'bad', text: '任务 A 读 errno → 5（不是自己刚写的 22）' },
    ]
  }
  return [
    { id: 'a-write', actor: 'A', op: 'write', value: 22, text: '任务 A 写 errno = EINVAL (22) 到自己的存储格' },
    { id: 'b-write', actor: 'B', op: 'write', value: 5, text: '任务 B 写 errno = EIO (5) 到自己的存储格' },
    { id: 'a-read', actor: 'A', op: 'read', value: 22, verdict: 'ok', text: '任务 A 读 errno → 22（仍是自己写的值）' },
  ]
}

// 链式流程图节点配色：预处理指令 / wrapper / 普通节点
const chainNodeCls = (n) => {
  if (n.startsWith('#include')) return 'border-accent-2/40 bg-accent-2/10 text-accent-2'
  if (n.includes('wrapper')) return 'border-accent/40 bg-accent/10 text-accent'
  return 'border-line bg-panel-2 text-ink'
}

export default function ErrnoModule() {
  // —— 展开隧道 ——
  const [step, setStep] = useState(0)

  // —— 并发写入演示 ——
  const [mode, setMode] = useState('global')
  const [log, setLog] = useState([])
  const [running, setRunning] = useState(false)
  const timersRef = useRef([])

  // 卸载时清掉未执行完的 setTimeout
  useEffect(() => {
    const timers = timersRef.current
    return () => timers.forEach(clearTimeout)
  }, [])

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }

  const runDemo = () => {
    clearTimers()
    const steps = buildRunSteps(mode)
    setLog([])
    setRunning(true)
    steps.forEach((entry, i) => {
      const t = setTimeout(() => {
        setLog((prev) => [...prev, entry])
        if (i === steps.length - 1) setRunning(false)
      }, STEP_INTERVAL * (i + 1))
      timersRef.current.push(t)
    })
  }

  const switchMode = (m) => {
    if (m === mode) return
    clearTimers()
    setRunning(false)
    setLog([])
    setMode(m)
  }

  // 从时间线推导两个任务存储格的当前值
  const slots = useMemo(() => {
    let shared = null
    let a = null
    let b = null
    for (const e of log) {
      if (e.op !== 'write') continue
      if (mode === 'global') shared = e.value
      else if (e.actor === 'A') a = e.value
      else b = e.value
    }
    return mode === 'global' ? { A: shared, B: shared } : { A: a, B: b }
  }, [log, mode])

  const readEntry = log.find((e) => e.op === 'read')

  // —— include 搜索链 ——
  const [order, setOrder] = useState(() => INCLUDE_ORDER.map((d) => d.id))
  const dirById = useMemo(() => Object.fromEntries(INCLUDE_ORDER.map((d) => [d.id, d])), [])
  const wrapperHit = order.indexOf('wrapper') < order.indexOf('arm')

  const moveDir = (idx, dir) => {
    setOrder((prev) => {
      const j = idx + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }

  const chainNodes = wrapperHit
    ? ['#include <errno.h>', 'wrapper errno.h', '#include_next <errno.h>', '从当前目录之后继续搜索', 'Arm C Library errno.h']
    : ['#include <errno.h>', 'Arm C Library errno.h']

  return (
    <ModuleShell
      kicker="errno"
      title="errno 隧道"
      subtitle="写 errno 看似给全局变量赋值，实际是沿着宏展开的隧道走到一个 ABI 钩子函数。展开隧道、模拟并发覆盖、排布 include 搜索顺序，看清 Keil 工程里 errno 的存储与隔离。"
    >
      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">宏展开隧道</h3>
        <p className="mb-3 text-xs text-muted">
          用“上一步 / 下一步”逐步展开一句 errno 赋值，看它如何变成一次 ABI 钩子调用
        </p>
        <Callout tone="tip" title="errno 的真身">
          errno 表面上像全局变量，但为了支持线程隔离，libc 通常把它实现成"取得当前 errno 存储地址"的宏。
        </Callout>
        <div className="mt-3 rounded-lg border border-line bg-panel p-4">
          {step > 0 && (
            <ol className="mb-3 space-y-1 border-b border-line pb-3">
              {EXPAND_STEPS.slice(0, step).map((s, i) => (
                <li key={s.code} className="font-mono text-xs leading-relaxed text-muted opacity-70">
                  {i + 1}. {s.code} <span>—— {s.note}</span>
                </li>
              ))}
            </ol>
          )}
          <CodeBlock title={`第 ${step + 1} / ${EXPAND_STEPS.length} 步`} code={EXPAND_STEPS[step].code} />
          <p className="mt-2 text-base font-medium text-accent">{EXPAND_STEPS[step].note}</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="rounded border border-line bg-panel px-3 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← 上一步
            </button>
            <button
              type="button"
              disabled={step === EXPAND_STEPS.length - 1}
              onClick={() => setStep((s) => Math.min(EXPAND_STEPS.length - 1, s + 1))}
              className="rounded border border-accent bg-accent/15 px-3 py-1 text-xs text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一步 →
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <CodeBlock title="errno.h（Arm C Library / MicroLIB）" code={ARM_ERRNO_H} />
          <CodeBlock title="RTOS 工程里的钩子覆盖" code={TASK_OVERRIDE} />
        </div>
      </section>

      <section>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">并发写入演示</h3>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'global', label: 'global 模式' },
              { id: 'per-task', label: 'per-task 模式' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => switchMode(m.id)}
                className={[
                  'rounded border px-3 py-1 font-mono text-xs transition-colors',
                  mode === m.id
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-line bg-panel text-muted hover:border-accent hover:text-ink',
                ].join(' ')}
              >
                {m.label}
              </button>
            ))}
            <button
              type="button"
              onClick={runDemo}
              disabled={running}
              className="rounded border border-accent bg-accent/15 px-3 py-1 text-xs text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ▶ 运行两个任务并发写 errno
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted">
          任务 A 先写 EINVAL(22)，任务 B 再写 EIO(5)，最后 A 读回 errno：存储共享时错误码会串
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {['A', 'B'].map((who) => (
            <div key={who} className="rounded-lg border border-line bg-panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-ink">任务 {who}</span>
                <span className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  {mode === 'global' ? '同一个全局地址' : '&task->errno_value'}
                </span>
              </div>
              <p className="mt-3 text-xs text-muted">errno 存储格</p>
              <p className={`mt-1 font-mono text-3xl font-bold ${slots[who] === null ? 'text-muted' : 'text-ink'}`}>
                {slots[who] === null ? '—' : slots[who]}
              </p>
            </div>
          ))}
        </div>
        {readEntry && (
          <p className={`mt-3 text-sm font-semibold ${readEntry.verdict === 'bad' ? 'text-danger' : 'text-emerald-400'}`}>
            {readEntry.verdict === 'bad' ? '⚠ 错误码串了！' : '✓ 各读各的'}
          </p>
        )}
        <div className="mt-3 overflow-hidden rounded-lg border border-line bg-panel">
          {log.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted">点击“运行”，时间线将逐步出现</p>
          ) : (
            log.map((e) => (
              <div key={e.id} className="flex items-start gap-2 border-b border-line px-3 py-2 last:border-b-0">
                <span
                  className={[
                    'mt-0.5 shrink-0 rounded border px-1.5 font-mono text-[10px]',
                    e.actor === 'A' ? 'border-accent-2/40 bg-accent-2/10 text-accent-2' : 'border-warn/40 bg-warn/10 text-warn',
                  ].join(' ')}
                >
                  {e.actor}
                </span>
                <span
                  className={[
                    'text-xs leading-relaxed',
                    e.op === 'read'
                      ? e.verdict === 'bad'
                        ? 'font-semibold text-danger'
                        : 'font-semibold text-emerald-400'
                      : 'text-ink',
                  ].join(' ')}
                >
                  {e.text}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">include 搜索链</h3>
        <p className="mb-3 text-xs text-muted">
          编译器按目录顺序搜索同名头文件；用箭头调整顺序，看 wrapper 能否先命中
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="overflow-hidden rounded-lg border border-line bg-panel">
              {order.map((id, i) => (
                <div key={id} className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0">
                  <span className="w-5 shrink-0 text-center font-mono text-xs text-muted">{i + 1}</span>
                  <span className={`text-xs leading-relaxed ${id === 'wrapper' ? 'font-semibold text-accent' : 'text-ink'}`}>
                    {dirById[id].label}
                  </span>
                  <span className="ml-auto flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label={`上移：${dirById[id].label}`}
                      disabled={i === 0}
                      onClick={() => moveDir(i, -1)}
                      className="rounded border border-line bg-panel px-2 py-0.5 text-xs text-muted transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`下移：${dirById[id].label}`}
                      disabled={i === order.length - 1}
                      onClick={() => moveDir(i, 1)}
                      className="rounded border border-line bg-panel px-2 py-0.5 text-xs text-muted transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ↓
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className={`text-xs font-semibold ${wrapperHit ? 'text-emerald-400' : 'text-danger'}`}>
                {wrapperHit
                  ? '✓ #include <errno.h> 先命中 wrapper，再经 #include_next 接力到 Arm 头文件'
                  : '✗ 先命中 Arm 原版，wrapper 不生效'}
              </p>
              <button
                type="button"
                onClick={() => setOrder(INCLUDE_ORDER.map((d) => d.id))}
                className="rounded border border-line bg-panel px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-ink"
              >
                恢复默认顺序
              </button>
            </div>
          </div>
          <div className="rounded-lg border border-line bg-panel p-4">
            <p className="mb-3 text-xs text-muted">命中时的搜索链（wrapper 未命中时首节点直达 Arm）</p>
            <div className="flex flex-wrap items-center gap-2">
              {chainNodes.map((n, i) => (
                <Fragment key={n}>
                  {i > 0 && <span className="text-xs text-muted">→</span>}
                  <span className={`rounded border px-2 py-1 font-mono text-xs ${chainNodeCls(n)}`}>{n}</span>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4">
          <CodeBlock title="工程兼容层目录 / errno.h（wrapper）" code={WRAPPER_ERRNO_H} />
        </div>
        <div className="mt-3 space-y-3">
          <Callout tone="ok" title="推荐做法">
            推荐：自定义 errno.h 只做错误码兼容层，不重新定义 errno。这样切换 MicroLIB / 完整 Arm C Library 时，仍然与 Arm libc 内部使用同一个 __aeabi_errno_addr() 机制。
          </Callout>
          <Callout tone="tip" title="#include_next 的真正含义">
            #include_next 的含义是从当前头文件所在搜索目录之后，继续寻找下一个同名头文件，并不是固定指向编译器头文件。Keil RTE / CMSIS 只是额外加入 include 路径，不改变这条规则。
          </Callout>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">四种 libc 的 errno 对照</h3>
        <p className="mb-3 text-xs text-muted">同一个 errno 需求，四种存储与隔离方式</p>
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-xs text-muted">
                <th className="px-3 py-2 font-semibold">libc</th>
                <th className="px-3 py-2 font-semibold">errno 存储</th>
                <th className="px-3 py-2 font-semibold">线程隔离方式</th>
              </tr>
            </thead>
            <tbody>
              {LIBC_ERRNO_TABLE.map((r) => (
                <tr key={r.libc} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 text-xs font-semibold text-ink">{r.libc}</td>
                  <td className="px-3 py-2 font-mono text-xs text-accent-2">{r.storage}</td>
                  <td className="px-3 py-2 text-xs text-muted">{r.thread}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">结论</h3>
        <div className="rounded-lg border border-line bg-panel p-4">
          <ol className="space-y-2">
            {CONCLUSIONS.map((c, i) => (
              <li key={c} className="flex gap-2 text-sm leading-relaxed text-ink">
                <span className="h-5 shrink-0 rounded bg-accent/15 px-1.5 font-mono text-xs leading-5 text-accent">
                  {i + 1}
                </span>
                {c}
              </li>
            ))}
          </ol>
        </div>
      </section>
    </ModuleShell>
  )
}
