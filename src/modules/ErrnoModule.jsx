import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Workbench from '../components/workbench/Workbench'
import { Button, FieldRow, IconButton, SectionLabel, Segmented, StatTile } from '../components/workbench/controls'
import { DrawerTrigger, Principle, RefTable } from '../components/workbench/Principle'
import CodeBlock from '../components/CodeBlock'
import {
  EXPAND_STEPS, ARM_ERRNO_H, TASK_OVERRIDE, WRAPPER_ERRNO_H, LIBC_ERRNO_TABLE, INCLUDE_ORDER,
} from '../data/errnoData'

// 并发演示每一步的间隔（ms）
const STEP_INTERVAL = 700

// 结论卡片三条
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
  // 展开隧道
  const [step, setStep] = useState(0)

  // 并发演示
  const [mode, setMode] = useState('global')
  const [log, setLog] = useState([])
  const [running, setRunning] = useState(false)
  const timersRef = useRef([])

  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current.length = 0
  }, [])

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current.length = 0
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

  // include 搜索链
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

  // ---- 实验① 宏展开隧道 ----
  const expandControl = (
    <div className="space-y-3">
      <SectionLabel className="mb-2">Expansion Steps · 展开步数</SectionLabel>
      <div className="flex items-center gap-2">
        <IconButton disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} title="上一步">←</IconButton>
        <span className="font-mono text-xs text-muted">步骤 {step + 1} / {EXPAND_STEPS.length}</span>
        <IconButton disabled={step === EXPAND_STEPS.length - 1} onClick={() => setStep((s) => Math.min(EXPAND_STEPS.length - 1, s + 1))} title="下一步">→</IconButton>
      </div>
    </div>
  )

  const expandCanvas = (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-panel p-4">
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
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <CodeBlock title="errno.h（Arm C Library / MicroLIB）" code={ARM_ERRNO_H} />
        <CodeBlock title="RTOS 工程里的钩子覆盖" code={TASK_OVERRIDE} />
      </div>
    </div>
  )

  // ---- 实验② 并发演示 ----
  const concurrentControl = (
    <div className="space-y-5">
      <div>
        <SectionLabel className="mb-2">Storage Mode · 存储模式</SectionLabel>
        <Segmented
          options={[
            { id: 'global', label: 'global' },
            { id: 'per-task', label: 'per-task' },
          ]}
          value={mode}
          onChange={switchMode}
          className="w-full"
        />
      </div>
      <Button variant="primary" onClick={runDemo} disabled={running}>
        ▶ 运行两个任务并发写 errno
      </Button>
    </div>
  )

  const concurrentCanvas = (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {['A', 'B'].map((who) => (
          <StatTile
            key={who}
            label={`任务 ${who} 存储格`}
            value={slots[who] === null ? '—' : String(slots[who])}
            tone={slots[who] === null ? 'default' : 'accent'}
            sub={mode === 'global' ? '同一个全局地址' : '&task->errno_value'}
          />
        ))}
      </div>
      {readEntry && (
        <div className={`rounded-lg border px-4 py-3 text-sm font-semibold ${readEntry.verdict === 'bad' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-ok/40 bg-ok/10 text-ok'}`}>
          {readEntry.verdict === 'bad' ? '⚠ 错误码串了！' : '✓ 各读各的'}
        </div>
      )}
      <div className="rounded-lg border border-line bg-panel">
        {log.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted">点击"运行"，时间线将逐步出现</p>
        ) : (
          log.map((e) => (
            <div key={e.id} className="flex items-start gap-2 border-b border-line px-3 py-2 last:border-b-0">
              <span className={`mt-0.5 shrink-0 rounded border px-1.5 font-mono text-[10px] ${e.actor === 'A' ? 'border-accent-2/40 bg-accent-2/10 text-accent-2' : 'border-warn/40 bg-warn/10 text-warn'}`}>
                {e.actor}
              </span>
              <span className={`text-xs leading-relaxed ${e.op === 'read' ? (e.verdict === 'bad' ? 'font-semibold text-danger' : 'font-semibold text-emerald-400') : 'text-ink'}`}>
                {e.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )

  // ---- 实验 include 搜索链 ----
  const includeControl = (
    <div className="space-y-3">
      <SectionLabel className="mb-2">Directory Order · 目录顺序</SectionLabel>
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        {order.map((id, i) => (
          <div key={id} className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0">
            <span className="w-5 shrink-0 text-center font-mono text-xs text-muted">{i + 1}</span>
            <span className={`text-xs leading-relaxed ${id === 'wrapper' ? 'font-semibold text-accent' : 'text-ink'}`}>
              {dirById[id].label}
            </span>
            <span className="ml-auto flex shrink-0 gap-1">
              <IconButton disabled={i === 0} onClick={() => moveDir(i, -1)} title="上移">↑</IconButton>
              <IconButton disabled={i === order.length - 1} onClick={() => moveDir(i, 1)} title="下移">↓</IconButton>
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs font-semibold ${wrapperHit ? 'text-emerald-400' : 'text-danger'}`}>
          {wrapperHit ? '✓ wrapper 先命中' : '✗ Arm 原版先命中'}
        </p>
        <Button variant="ghost" onClick={() => setOrder(INCLUDE_ORDER.map((d) => d.id))}>恢复默认顺序</Button>
      </div>
    </div>
  )

  const includeCanvas = (
    <div className="space-y-4">
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
      <CodeBlock title="工程兼容层目录 / errno.h（wrapper）" code={WRAPPER_ERRNO_H} />
      <div className="space-y-2 text-xs leading-relaxed text-muted">
        <p>• #include_next 的含义是从当前头文件所在搜索目录之后，继续寻找下一个同名头文件，并不是固定指向编译器头文件。</p>
        <p>• 推荐：自定义 errno.h 只做错误码兼容层，不重新定义 errno。这样切换 MicroLIB / 完整 Arm C Library 时，仍然与 Arm libc 内部使用同一个 __aeabi_errno_addr() 机制。</p>
      </div>
    </div>
  )

  // ---- 实验④ libc 对照 ----
  const libcCanvas = (
    <div className="space-y-4">
      <RefTable
        head={['libc', 'errno 存储', '线程隔离方式']}
        rows={LIBC_ERRNO_TABLE.map((r) => [r.libc, r.storage, r.thread])}
      />
      <div className="rounded-lg border border-line bg-panel p-4">
        <SectionLabel className="mb-2">结论</SectionLabel>
        <ol className="space-y-2">
          {CONCLUSIONS.map((c, i) => (
            <li key={c} className="flex gap-2 text-sm leading-relaxed text-ink">
              <span className="h-5 shrink-0 rounded bg-accent/15 px-1.5 font-mono text-xs leading-5 text-accent">{i + 1}</span>
              {c}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )

  return (
    <Workbench
      title="errno 隧道"
      tagline="写 errno 看似给全局变量赋值，实际是沿着宏展开的隧道走到一个 ABI 钩子函数"
      experiments={[
        { id: 'expand', label: '宏展开', control: expandControl, canvas: expandCanvas },
        { id: 'concurrent', label: '并发演示', control: concurrentControl, canvas: concurrentCanvas },
        { id: 'include', label: 'include 链', control: includeControl, canvas: includeCanvas },
        { id: 'libc', label: 'libc 对照', control: <SectionLabel>四种 libc 的 errno 对照</SectionLabel>, canvas: libcCanvas },
      ]}
    />
  )
}
