import { useState } from 'react'
import Workbench from '../components/workbench/Workbench'
import { Button, FieldRow, IconButton, SectionLabel, Segmented, StatTile, TextInput } from '../components/workbench/controls'
import { DrawerTrigger, Principle, RefTable } from '../components/workbench/Principle'
import CodeBlock from '../components/CodeBlock'
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
            className={`rounded border px-2 py-1 text-xs transition-colors ${hit ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel text-muted opacity-50'}`}
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
  // 宏矩阵
  const [compiler, setCompiler] = useState('armclang6')

  // 判据助手
  const [critIdx, setCritIdx] = useState(0)
  const [exprText, setExprText] = useState('')
  const [evalResult, setEvalResult] = useState(null)

  // 版本解码器
  const [ver, setVer] = useState(6190000)

  // ACLE 目标芯片
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

  // ---- 实验① 识别宏矩阵 ----
  const matrixControl = (
    <div className="space-y-3">
      <SectionLabel className="mb-2">Compiler · 编译器</SectionLabel>
      <Segmented
        options={Object.entries(COMPILERS).map(([id, c]) => ({ id, label: c.label }))}
        value={compiler}
        onChange={setCompiler}
        className="w-full"
      />
    </div>
  )

  const matrixCanvas = (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-muted">
              <th className="px-3 py-2 font-semibold">宏  编译器</th>
              {COMPILER_IDS.map((id) => (
                <th key={id} className={`px-3 py-2 font-semibold ${id === compiler ? 'bg-accent/10 text-accent' : ''}`}>
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
                    <td key={id} className={`px-3 py-2 font-mono text-xs ${id === compiler ? 'bg-accent/10' : ''}`}>
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
      <p className="text-xs text-muted">
        点亮 = 该编译器下此宏已预定义。armclang6 的 <code className="font-mono">__GNUC__</code> 是 GCC 兼容宏，不代表在用 GCC。
      </p>
    </div>
  )

  // ---- 实验② 判据助手 ----
  const criteriaControl = (
    <div className="space-y-5">
      <div>
        <SectionLabel className="mb-2">正向 · 选目的</SectionLabel>
        <FieldRow label="我要识别">
          <select
            value={critIdx}
            onChange={(e) => setCritIdx(Number(e.target.value))}
            className="w-64"
          >
            {CRITERIA.map((c, i) => (
              <option key={c.purpose} value={i}>{c.purpose}</option>
            ))}
          </select>
        </FieldRow>
      </div>
      <div>
        <SectionLabel className="mb-2">反向 · 键入表达式</SectionLabel>
        <div className="flex items-center gap-2">
          <TextInput
            value={exprText}
            onChange={(e) => setExprText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runEvaluate() }}
            placeholder="defined(__CC_ARM)"
            className="flex-1"
          />
          <Button variant="primary" onClick={runEvaluate}>求值</Button>
        </div>
      </div>
    </div>
  )

  const criteriaCanvas = (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-panel p-4">
        <p className="mb-2 text-xs text-muted">正向判据</p>
        <CodeBlock title="识别判据" code={'#if ' + crit.code} />
        <p className="mb-2 mt-3 text-xs text-muted">命中编译器</p>
        <CompilerBadges hitIds={crit.matches} />
        <p className="mt-2 text-xs leading-relaxed text-muted">
          命中：{crit.matches.map((id) => COMPILERS[id].label).join('、')}
        </p>
      </div>
      <div className="rounded-lg border border-line bg-panel p-4">
        <p className="mb-2 text-xs text-muted">反向求值结果</p>
        {evalResult === null ? (
          <p className="text-xs leading-relaxed text-muted">点击"求值"后，表达式会对四个编译器的预定义宏集合逐一求值，命中的编译器点亮徽标</p>
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
  )

  // ---- 实验③ 版本解码器 ----
  const decoderCanvas = (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-panel p-4">
        <div className="flex items-center justify-between font-mono text-xs text-muted">
          <span>__ARMCC_VERSION</span>
          <span className="text-ink">{ver}</span>
        </div>
        <div className="relative mt-3">
          <div className="pointer-events-none absolute -inset-y-1 w-px bg-warn/70" style={{ left: `${boundaryPct}%` }} />
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
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="family" value={decoded.family} tone={decoded.family === 'unknown' ? 'default' : decoded.family === 'AC6' ? 'ok' : 'accent'} sub={decoded.isAc6 ? 'AC6 分支' : 'AC5 分支'} />
        <StatTile label="version" value={`${decoded.major}.${decoded.minor}`} tone="accent" sub={`__ARMCC_VERSION = ${ver}`} />
        <StatTile label="build tail" value={decoded.tail} tone="default" />
      </div>
      <p className="text-xs leading-relaxed text-muted">
        6000000 是 AC6 的版本分界值，不是说 AC6 的 __ARMCC_VERSION 固定等于 6000000。
      </p>
    </div>
  )

  // ---- 实验 ACLE 宏 ----
  const acleControl = (
    <div className="space-y-3">
      <SectionLabel className="mb-2">Target CPU · 目标内核</SectionLabel>
      <Segmented
        options={Object.keys(CORTEX_PROFILES).map((key) => ({ id: key, label: cpuLabel(key) }))}
        value={cpu}
        onChange={setCPU}
        className="w-full"
      />
    </div>
  )

  const acleCanvas = (
    <div className="space-y-4">
      <RefTable
        head={['宏', `值（${cpuLabel(cpu)}）`, '说明']}
        rows={ACLE_ROWS.map((row) => {
          const v = CORTEX_PROFILES[cpu][row.field]
          return [row.macro, row.field === 'profile' ? profileText(v) : String(v), row.desc]
        })}
      />
      <p className="text-xs leading-relaxed text-muted">
        这些 <code className="font-mono">__ARM_*</code> 宏由 ACLE 规范定义，armclang/GCC/Clang 通用 —— 写跨工具链代码优先用它们。
      </p>
    </div>
  )

  // ---- 实验⑤ 实用命令 ----
  const tipsCanvas = (
    <div className="space-y-4">
      <CodeBlock title="导出当前编译器全部预定义宏" code={DUMP_COMMANDS} />
      <div className="space-y-3">
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs leading-relaxed">
          <strong className="text-warn">__ARMCLANG_VERSION 不是官方宏</strong>
          <p className="mt-1 text-ink/85">拼写接近但非标准，不建议使用。</p>
        </div>
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs leading-relaxed">
          <strong className="text-warn">__GNUC__ 会误判</strong>
          <p className="mt-1 text-ink/85">AC6 下 __GNUC__ 已定义，但它只是兼容宏 —— 用 defined(__GNUC__) 判断 GCC 会误判 armclang。</p>
        </div>
        <div className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-xs leading-relaxed">
          <strong className="text-ok">AC5 专用宏已废弃</strong>
          <p className="mt-1 text-ink/85">AC5 时代的 <code className="font-mono">__TARGET_CPU_CORTEX_M4</code> 之类宏在 AC6 已废弃，改用 <code className="font-mono">__ARM_ARCH</code> / <code className="font-mono">__ARM_FEATURE_*</code>。</p>
        </div>
      </div>
    </div>
  )

  return (
    <Workbench
      title="宏探测站"
      tagline="代码怎么知道自己在被哪个编译器构建？靠预定义宏"
      experiments={[
        { id: 'matrix', label: '识别宏矩阵', control: matrixControl, canvas: matrixCanvas },
        { id: 'criteria', label: '判据助手', control: criteriaControl, canvas: criteriaCanvas },
        { id: 'decoder', label: '版本解码器', control: <SectionLabel>__ARMCC_VERSION 解码</SectionLabel>, canvas: decoderCanvas },
        { id: 'acle', label: 'ACLE 宏', control: acleControl, canvas: acleCanvas },
        { id: 'tips', label: '实用命令', control: <SectionLabel>实用命令与常见陷阱</SectionLabel>, canvas: tipsCanvas },
      ]}
    />
  )
}
