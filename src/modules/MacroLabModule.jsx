import { useState } from 'react'
import ModuleShell from '../components/ModuleShell'
import CodeBlock from '../components/CodeBlock'
import Callout from '../components/Callout'
import {
  COMPILERS, IDENTITY_MACROS, CRITERIA, evaluateExpr, decodeVersion, CORTEX_PROFILES, ACLE_ROWS,
} from '../lib/macroRules'

const COMPILER_IDS = Object.keys(COMPILERS)

// 版本解码器滑块范围与 AC6 分界刻度
const VER_MIN = 4000000
const VER_MAX = 6250000
const AC6_BOUNDARY = 6000000
const boundaryPct = ((AC6_BOUNDARY - VER_MIN) / (VER_MAX - VER_MIN)) * 100

// 解码结果大字配色：AC6 绿 / AC5 蓝 / unknown 灰
const FAMILY_CLS = {
  AC6: 'text-emerald-400',
  AC5: 'text-accent-2',
  unknown: 'text-muted',
}

const cpuLabel = (key) => 'Cortex-' + key.slice('cortex-'.length).replace('m', 'M').replace('plus', '+')

// profile 字段显示为 0x4D ('M') 形式：字符 ASCII 的十六进制 + 字符本身
const profileText = (ch) => `0x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')} ('${ch}')`

const DUMP_COMMANDS = `armclang --target=arm-arm-none-eabi -mcpu=cortex-m4 -E -dM main.c
armcc --cpu=Cortex-M4 -E main.c`

// 四个编译器的命中徽标行：hitIds 内高亮，其余置灰
function CompilerBadges({ hitIds }) {
  return (
    <div className="flex flex-wrap gap-2">
      {COMPILER_IDS.map((id) => {
        const hit = hitIds.includes(id)
        return (
          <span
            key={id}
            className={[
              'rounded border px-2 py-1 text-xs transition-colors',
              hit ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel text-muted opacity-50',
            ].join(' ')}
          >
            {hit ? '✓ ' : ''}
            {COMPILERS[id].label}
          </span>
        )
      })}
    </div>
  )
}

export default function MacroLabModule() {
  // —— 宏矩阵 ——
  const [compiler, setCompiler] = useState('armclang6')

  // —— 判据助手（正向选目的 / 反向键入表达式）——
  const [critIdx, setCritIdx] = useState(0)
  const [exprText, setExprText] = useState('')
  const [evalResult, setEvalResult] = useState(null) // null=未求值；{ok:true,hits}；{ok:false}

  // —— 版本解码器 ——
  const [ver, setVer] = useState(6190000)

  // —— ACLE 目标芯片 ——
  const [cpu, setCPU] = useState('cortex-m4')

  const crit = CRITERIA[critIdx]
  const decoded = decodeVersion(ver)

  const runEvaluate = () => {
    try {
      const hits = COMPILER_IDS.filter((id) => evaluateExpr(exprText, COMPILERS[id].macros))
      setEvalResult({ ok: true, hits })
    } catch {
      setEvalResult({ ok: false })
    }
  }

  return (
    <ModuleShell
      kicker="Macros"
      title="宏探测站"
      subtitle="代码怎么知道自己在被哪个编译器构建？靠预定义宏。点亮识别宏真值表、双向查判据、解码 __ARMCC_VERSION，再对照目标芯片的 ACLE 宏。"
    >
      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">编译器识别宏矩阵</h3>
        <p className="mb-3 text-xs text-muted">选择一个编译器，看它的识别宏在哪一列点亮</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {Object.entries(COMPILERS).map(([id, c]) => (
            <button
              key={id}
              type="button"
              onClick={() => setCompiler(id)}
              className={[
                'rounded border px-3 py-1 text-xs transition-colors',
                compiler === id
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-panel text-muted hover:border-accent hover:text-ink',
              ].join(' ')}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-xs text-muted">
                <th className="px-3 py-2 font-semibold">宏 ＼ 编译器</th>
                {COMPILER_IDS.map((id) => (
                  <th
                    key={id}
                    className={`px-3 py-2 font-semibold ${id === compiler ? 'bg-accent/10 text-accent' : ''}`}
                  >
                    {COMPILERS[id].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {IDENTITY_MACROS.map((m) => (
                <tr key={m} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 font-mono text-xs text-ink">{m}</td>
                  {COMPILER_IDS.map((id) => {
                    const macros = COMPILERS[id].macros
                    return (
                      <td
                        key={id}
                        className={`px-3 py-2 font-mono text-xs ${id === compiler ? 'bg-accent/10' : ''}`}
                      >
                        {m in macros ? (
                          <span className="text-emerald-400">{macros[m]}</span>
                        ) : (
                          <span className="text-muted">✗ 未定义</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          点亮 = 该编译器下此宏已预定义。armclang6 的 __GNUC__ 是 GCC 兼容宏，不代表在用 GCC。
        </p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">判据助手（双向）</h3>
        <p className="mb-3 text-xs text-muted">
          正向：选目的得 #if 判据；反向：键入表达式，对四个编译器逐一求值
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-line bg-panel p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label htmlFor="criteria-purpose" className="text-xs text-muted">我要识别</label>
              <select
                id="criteria-purpose"
                value={critIdx}
                onChange={(e) => setCritIdx(Number(e.target.value))}
                className="rounded border border-line bg-panel px-2 py-1 text-xs text-ink outline-none transition-colors focus:border-accent"
              >
                {CRITERIA.map((c, i) => (
                  <option key={c.purpose} value={i}>{c.purpose}</option>
                ))}
              </select>
            </div>
            <CodeBlock title="识别判据" code={'#if ' + crit.code} />
            <p className="mb-2 mt-3 text-xs text-muted">命中编译器</p>
            <CompilerBadges hitIds={crit.matches} />
            <p className="mt-2 text-xs leading-relaxed text-muted">
              命中：{crit.matches.map((id) => COMPILERS[id].label).join('、')}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-panel p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label htmlFor="expr-input" className="text-xs text-muted">键入表达式</label>
              <input
                id="expr-input"
                type="text"
                value={exprText}
                onChange={(e) => setExprText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runEvaluate()
                }}
                placeholder="defined(__CC_ARM)"
                spellCheck={false}
                className="w-56 rounded border border-line bg-panel px-2 py-1 font-mono text-xs text-ink outline-none transition-colors focus:border-accent"
              />
              <button
                type="button"
                onClick={runEvaluate}
                className="rounded border border-accent bg-accent/15 px-3 py-1 text-xs text-accent transition-colors hover:bg-accent/25"
              >
                求值
              </button>
            </div>
            {evalResult === null ? (
              <p className="text-xs leading-relaxed text-muted">
                点击“求值”后，表达式会对四个编译器的预定义宏集合逐一求值，命中的编译器点亮徽标
              </p>
            ) : evalResult.ok ? (
              <>
                <p className="mb-2 text-xs text-muted">命中编译器</p>
                <CompilerBadges hitIds={evalResult.hits} />
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {evalResult.hits.length > 0
                    ? `命中：${evalResult.hits.map((id) => COMPILERS[id].label).join('、')}`
                    : '没有编译器命中'}
                </p>
              </>
            ) : (
              <p className="text-xs text-danger">
                不支持的写法：本工具只认 defined(X)、X &gt;= N 与 &amp;&amp; 组合
              </p>
            )}
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">__ARMCC_VERSION 解码器</h3>
        <p className="mb-3 text-xs text-muted">
          拖动滑块模拟不同的 __ARMCC_VERSION 取值，看它解码出哪一代
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-line bg-panel p-4">
            <div className="flex items-center justify-between font-mono text-xs text-muted">
              <span>__ARMCC_VERSION</span>
              <span className="text-ink">{ver}</span>
            </div>
            <div className="relative mt-3">
              <div
                className="pointer-events-none absolute -inset-y-1 w-px bg-warn/70"
                style={{ left: `${boundaryPct}%` }}
              />
              <input
                type="range"
                min={VER_MIN}
                max={VER_MAX}
                step={1000}
                value={ver}
                onChange={(e) => setVer(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>
            <div className="relative mt-1 h-5 font-mono text-[10px] text-muted">
              <span className="absolute left-0">{VER_MIN}</span>
              <span className="absolute -translate-x-1/2 text-warn" style={{ left: `${boundaryPct}%` }}>
                6000000 = AC6 分界
              </span>
              <span className="absolute right-0">{VER_MAX}</span>
            </div>
          </div>
          <div className="rounded-lg border border-line bg-panel p-4">
            <p className="text-xs text-muted">解码结果</p>
            <p className={`mt-2 font-mono text-3xl font-bold ${FAMILY_CLS[decoded.family]}`}>
              {decoded.family} {decoded.major}.{decoded.minor}
            </p>
            <p className="mt-2 font-mono text-xs text-muted">构建尾数 {decoded.tail}</p>
          </div>
        </div>
        <div className="mt-3">
          <Callout tone="tip" title="6000000 是分界值，不是固定值">
            6000000 是 AC6 的版本分界值，不是说 AC6 的 __ARMCC_VERSION 固定等于 6000000。
          </Callout>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">目标芯片 ACLE 宏</h3>
        <p className="mb-3 text-xs text-muted">
          选一个内核，看 ACLE 特性宏的取值 —— M0 与 M4 的差异全在这里
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {Object.keys(CORTEX_PROFILES).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setCPU(key)}
              className={[
                'rounded border px-3 py-1 font-mono text-xs transition-colors',
                cpu === key
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-panel text-muted hover:border-accent hover:text-ink',
              ].join(' ')}
            >
              {cpuLabel(key)}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-xs text-muted">
                <th className="px-3 py-2 font-semibold">宏</th>
                <th className="px-3 py-2 font-semibold">值（{cpuLabel(cpu)}）</th>
                <th className="px-3 py-2 font-semibold">说明</th>
              </tr>
            </thead>
            <tbody>
              {ACLE_ROWS.map((row) => {
                const v = CORTEX_PROFILES[cpu][row.field]
                return (
                  <tr key={row.macro} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs text-ink">{row.macro}</td>
                    <td className="px-3 py-2 font-mono text-xs text-emerald-400">
                      {row.field === 'profile' ? profileText(v) : v}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{row.desc}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          这些 __ARM_* 宏由 ACLE 规范定义，armclang/GCC/Clang 通用 —— 写跨工具链代码优先用它们。
        </p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">实用命令与常见陷阱</h3>
        <p className="mb-3 text-xs text-muted">
          真实工程里不必背表：导出全部预定义宏，直接查
        </p>
        <CodeBlock title="导出当前编译器全部预定义宏" code={DUMP_COMMANDS} />
        <div className="mt-3 space-y-3">
          <Callout tone="warn" title="__ARMCLANG_VERSION 不是官方宏">
            __ARMCLANG_VERSION 不是 Arm 官方识别宏，不建议使用（拼写接近但非标准）。
          </Callout>
          <Callout tone="warn" title="__GNUC__ 会误判">
            AC6 下 __GNUC__ 已定义，但它只是兼容宏 —— 用 defined(__GNUC__) 判断 GCC 会误判 armclang。
          </Callout>
          <Callout tone="tip" title="AC5 专用宏已废弃">
            AC5 时代的 __TARGET_CPU_CORTEX_M4 之类宏在 AC6 已废弃，改用 __ARM_ARCH / __ARM_FEATURE_*。
          </Callout>
        </div>
      </section>
    </ModuleShell>
  )
}
