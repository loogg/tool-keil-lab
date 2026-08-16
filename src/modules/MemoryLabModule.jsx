import { useEffect, useMemo, useState } from 'react'
import ModuleShell from '../components/ModuleShell'
import CodeBlock from '../components/CodeBlock'
import Callout from '../components/Callout'
import { createDefaultModel, placeItem, regionUsage, PACKEDFS_SECTIONS, selectSections } from '../lib/memoryMap'
import { generateScatter } from '../lib/scatterGen'
import { MAP_SAMPLE, MAP_NOTES, LINKER_SYNTAX, SYMBOL_EXAMPLE, atSnippet } from '../data/memoryLab'

// 地址十六进制：8 位补零大写
const hex = (n) => '0x' + n.toString(16).toUpperCase().padStart(8, '0')

// 字节数自适应显示
const fmtSize = (n) => {
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  return `${kb % 1 === 0 ? kb : kb.toFixed(1)} KB`
}

// section 清单里的 size 统一按 KB 显示
const fmtKB = (n) => `${n / 1024} KB`

const ATTR_BADGE = {
  FIXED: 'border-warn/40 bg-warn/10 text-warn',
  UNINIT: 'border-accent-2/40 bg-accent-2/10 text-accent-2',
}

// 上电搬运动画：启动代码的执行步骤与涉及的内存区域
const BOOT_STEPS = [
  { label: '上电：从向量表取初始 SP 与 Reset_Handler 地址', targets: [] },
  { label: '复制 RW 数据：Flash（加载地址 LMA）→ RAM（运行地址 VMA）', targets: ['RW_IRAM1', 'RW_CCRAM'] },
  { label: '清零 ZI 区域', targets: ['RW_IRAM1', 'RW_CCRAM'] },
  { label: '跳过 UNINIT 区域，不做任何初始化', targets: ['RW_SDRAM_NOINIT'] },
  { label: '跳转 main()', targets: [] },
]

const SYNTAX_TABS = [
  { id: 'sct', label: LINKER_SYNTAX.sct.label },
  { id: 'ld', label: LINKER_SYNTAX.ld.label },
  { id: 'icf', label: LINKER_SYNTAX.icf.label },
]

// FIXED 演示用地址标尺（0x08000000 → 0x08100000），数值与 map 摘录一致
const RULER_BASE = 0x08000000
const RULER_SPAN = 0x08100000 - RULER_BASE
const IROM_USED_END = 0x00058a00 // ER_IROM1 占用末端；非 FIXED 时 ER_RODATA 紧随其后
const RODATA_FIXED_ADDR = 0x080c0000
const RODATA_BLOCK_SIZE = 0x00010000 // 标尺上的示意宽度
const rulerPct = (offset) => (offset / RULER_SPAN) * 100

export default function MemoryLabModule() {
  const [model, setModel] = useState(createDefaultModel)
  const [selected, setSelected] = useState(null) // 选中的 item id
  const [lastMoved, setLastMoved] = useState(null) // 上次移动目标区域名（用于 scatter 高亮）

  const regions = [...model.regions].sort((a, b) => a.base - b.base)
  const scatterCode = generateScatter(model)

  // 把上次移动的目标区域块（区域头 + 内容行）映射为 CodeBlock 高亮行号
  const highlightLines = useMemo(() => {
    if (!lastMoved) return []
    const hit = []
    let inside = false
    scatterCode.split('\n').forEach((ln, i) => {
      const t = ln.trim()
      if (inside) {
        if (t === '}') inside = false
        else hit.push(i + 1)
        return
      }
      if (t.startsWith(lastMoved + ' ')) {
        inside = true
        hit.push(i + 1)
      }
    })
    return hit
  }, [scatterCode, lastMoved])

  const place = (regionName) => {
    if (!selected) return
    setModel(placeItem(model, selected, regionName))
    setLastMoved(regionName)
  }

  const reset = () => {
    setModel(createDefaultModel())
    setSelected(null)
    setLastMoved(null)
  }

  // —— 扩展卡片状态 ——
  const [filter, setFilter] = useState('+RO')
  const [fixedOn, setFixedOn] = useState(true)
  const [stepIdx, setStepIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [symbolRegion, setSymbolRegion] = useState('ER_RODATA')
  const [syntaxTab, setSyntaxTab] = useState('sct')
  const [addrText, setAddrText] = useState('0x080E0000')
  const [addr, setAddr] = useState('0x080E0000') // 上次有效值
  const [addrErr, setAddrErr] = useState(false)

  const hitSet = useMemo(() => new Set(selectSections(filter).map((s) => s.name)), [filter])
  const atSnippets = useMemo(() => atSnippet(addr), [addr])

  // 播放启动：每 1200ms 步进一次，到末尾自动停止；effect cleanup 清理 interval
  useEffect(() => {
    if (!playing) return undefined
    let step = 0 // playBoot 总是从第 0 步开始
    const timer = setInterval(() => {
      step = Math.min(step + 1, BOOT_STEPS.length - 1)
      setStepIdx(step)
      if (step >= BOOT_STEPS.length - 1) {
        clearInterval(timer)
        setPlaying(false)
      }
    }, 1200)
    return () => clearInterval(timer)
  }, [playing])

  const playBoot = () => {
    setStepIdx(0)
    setPlaying(true)
  }

  const resetBoot = () => {
    setPlaying(false)
    setStepIdx(-1)
  }

  const onAddrChange = (v) => {
    setAddrText(v)
    const parsed = parseInt(v, 16)
    if (Number.isNaN(parsed)) {
      setAddrErr(true)
      return // 非法输入：沿用上次有效值
    }
    setAddrErr(false)
    setAddr(hex(parsed))
  }

  return (
    <ModuleShell
      kicker="Memory Layout"
      title="内存布局实验室"
      subtitle="scatter 文件决定每段代码和数据落在哪块 Flash / RAM。在清单里选中一个 section，点击目标内存条即可移动，下方 scatter 文件实时重写。"
    >
      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">芯片内存条</h3>
        <p className="mb-3 text-xs text-muted">
          {selected
            ? '已选中 section：点击下方目标内存条即可放入'
            : '按地址排列的执行区域。先在下方 section 清单里选中一行'}
        </p>
        <div className="space-y-2">
          {regions.map((region) => {
            const { used, limit, overflow } = regionUsage(model, region.name)
            const pct = (used / limit) * 100
            const clickable = Boolean(selected)
            return (
              <button
                key={region.name}
                type="button"
                disabled={!clickable}
                onClick={() => place(region.name)}
                className={[
                  'block w-full rounded-lg border bg-panel p-3 text-left transition-colors',
                  overflow ? 'border-danger/70' : 'border-line',
                  clickable ? 'cursor-pointer hover:border-accent' : 'cursor-default',
                ].join(' ')}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-ink">{region.name}</span>
                    {region.attrs.fixed && (
                      <span className={`rounded border px-1 text-[10px] font-semibold tracking-wide ${ATTR_BADGE.FIXED}`}>
                        FIXED
                      </span>
                    )}
                    {region.attrs.uninit && (
                      <span className={`rounded border px-1 text-[10px] font-semibold tracking-wide ${ATTR_BADGE.UNINIT}`}>
                        UNINIT
                      </span>
                    )}
                    <span className="hidden truncate text-xs text-muted sm:inline">{region.note}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
                    <span>
                      {hex(region.base)} – {hex(region.base + region.maxSize - 1)}
                    </span>
                    {clickable && (
                      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">放入 →</span>
                    )}
                  </div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-2">
                  <div
                    className={`h-full rounded-full ${overflow ? 'bg-danger' : 'bg-accent'}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[11px]">
                  <span className={overflow ? 'text-danger' : 'text-muted'}>
                    {fmtSize(used)} / {fmtSize(limit)}（{pct.toFixed(1)}%）
                  </span>
                  {overflow && (
                    <span className="font-semibold text-danger">⚠ 超出 {used - limit} 字节</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">section 清单</h3>
          <button
            type="button"
            onClick={reset}
            className="rounded border border-line bg-panel px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-ink"
          >
            恢复默认
          </button>
        </div>
        <p className="mb-3 text-xs text-muted">
          点击一行选中，再点击上方目标内存条即可移动；再次点击已选中的行取消选择。
        </p>
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          {model.items.map((item) => {
            const isSel = selected === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(isSel ? null : item.id)}
                className={[
                  'flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left transition-colors last:border-b-0',
                  isSel ? 'bg-accent/10 ring-1 ring-inset ring-accent' : 'hover:bg-panel-2',
                ].join(' ')}
              >
                <span className={`font-mono text-xs ${isSel ? 'text-accent' : 'text-ink'}`}>
                  {item.label}
                </span>
                <span className="hidden truncate text-xs text-muted md:inline">{item.detail}</span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <span className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                    {item.region}
                  </span>
                  <span className="w-16 text-right font-mono text-[11px] text-muted">
                    {fmtKB(item.size)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">scatter 实时回显</h3>
        <p className="mb-3 text-xs text-muted">
          移动 section 后这里实时重新生成；真实工程里这就是 armlink 的输入
        </p>
        <CodeBlock title="target.sct" code={scatterCode} highlightLines={highlightLines} />
      </section>

      <Callout tone="tip" title="为什么网页资源放 Data Flash">
        GD32 的 Flash 分 Code 与 Data 两块，字库/网页这类大块只读数据不要求执行速度，放 Data
        Flash 能给代码腾地方。
      </Callout>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">+RO vs .rodata.* 筛选器</h3>
        <p className="mb-3 text-xs text-muted">
          scatter 里目标文件后面跟的筛选器，决定哪些 section 进入该区域
        </p>
        <div className="mb-3 flex gap-2">
          {['+RO', '.rodata.*'].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={[
                'rounded border px-3 py-1 font-mono text-xs transition-colors',
                filter === f
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-panel text-muted hover:border-accent hover:text-ink',
              ].join(' ')}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          {PACKEDFS_SECTIONS.map((s) => {
            const hit = hitSet.has(s.name)
            return (
              <div
                key={s.name}
                className={`flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 ${hit ? '' : 'opacity-40'}`}
              >
                <span className={`w-4 text-center font-mono text-xs ${hit ? 'text-accent' : 'text-muted'}`}>
                  {hit ? '✓' : '–'}
                </span>
                <span className={`font-mono text-xs ${hit ? 'text-ink' : 'text-muted'}`}>{s.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{fmtSize(s.size)}</span>
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-muted">webserver_packedfs.o 内部的 section：命中打勾，未命中置灰</p>
        <div className="mt-3">
          <Callout tone="tip" title="结论：按名称还是按属性">
            .rodata.* 按 section 名称筛选；+RO 按 section 属性筛选，范围更大。若只想把资源数据放到指定 Flash，优先使用 .rodata.* 或自定义专用 section。
          </Callout>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">FIXED 与 UNINIT 属性</h3>
        <p className="mb-3 text-xs text-muted">
          scatter 区域头后面可以跟属性：FIXED 钉死绝对地址，UNINIT 让启动代码跳过初始化
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-line bg-panel p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-ink">FIXED</span>
                <span className={`rounded border px-1 text-[10px] font-semibold tracking-wide ${ATTR_BADGE.FIXED}`}>
                  ER_RODATA
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={fixedOn}
                onClick={() => setFixedOn(!fixedOn)}
                className="flex items-center gap-2 rounded border border-line bg-panel-2 px-2 py-1 transition-colors hover:border-accent"
              >
                <span className={`text-xs ${fixedOn ? 'text-accent' : 'text-muted'}`}>{fixedOn ? '开' : '关'}</span>
                <span className={`relative h-4 w-8 rounded-full transition-colors ${fixedOn ? 'bg-accent/60' : 'bg-line'}`}>
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-ink transition-all ${fixedOn ? 'left-[18px]' : 'left-0.5'}`}
                  />
                </span>
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {fixedOn
                ? 'ER_RODATA 固定在 0x080C0000，无论前面区域多大都不挪动'
                : '按顺序紧跟 ER_IROM1 之后排布，地址随前方占用变化'}
            </p>
            <div className="mt-4">
              <div className="relative h-9 overflow-hidden rounded border border-line bg-panel-2">
                <div
                  className="absolute inset-y-0 w-px bg-line"
                  style={{ left: `${rulerPct(RODATA_FIXED_ADDR - RULER_BASE)}%` }}
                />
                <div
                  className="absolute inset-y-1 flex items-center overflow-hidden rounded bg-accent/40 px-1"
                  style={{ left: 0, width: `${rulerPct(IROM_USED_END)}%` }}
                >
                  <span className="truncate font-mono text-[9px] text-ink">ER_IROM1</span>
                </div>
                <div
                  className="absolute inset-y-1 flex items-center overflow-hidden rounded bg-warn/50 px-1 transition-all duration-300"
                  style={{
                    left: `${fixedOn ? rulerPct(RODATA_FIXED_ADDR - RULER_BASE) : rulerPct(IROM_USED_END)}%`,
                    width: `${rulerPct(RODATA_BLOCK_SIZE)}%`,
                  }}
                >
                  <span className="truncate font-mono text-[9px] text-ink">RODATA</span>
                </div>
              </div>
              <div className="relative mt-1 h-4 font-mono text-[10px] text-muted">
                <span className="absolute left-0">0x08000000</span>
                <span
                  className="absolute -translate-x-1/2"
                  style={{ left: `${rulerPct(RODATA_FIXED_ADDR - RULER_BASE)}%` }}
                >
                  0x080C0000
                </span>
                <span className="absolute right-0">0x08100000</span>
              </div>
              <p className="mt-2 font-mono text-[11px] text-muted">
                {fixedOn
                  ? 'ER_RODATA @ 0x080C0000（FIXED 钉死刻度）'
                  : 'ER_RODATA @ 0x08058A00（紧跟 ER_IROM1 末端）'}
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-line bg-panel p-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-ink">UNINIT</span>
              <span className={`rounded border px-1 text-[10px] font-semibold tracking-wide ${ATTR_BADGE.UNINIT}`}>
                RW_SDRAM_NOINIT
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              链接器不会用零（或其它值）初始化这个区域 —— 掉电前写入的内容在上电后保持原样（取决于硬件），适合大缓冲/帧缓存。
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">上电搬运动画</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={playBoot}
              disabled={playing}
              className="rounded border border-line bg-panel px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              ▶ 播放启动
            </button>
            <button
              type="button"
              onClick={resetBoot}
              className="rounded border border-line bg-panel px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-ink"
            >
              重置
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted">
          启动代码依次完成 RW 复制、ZI 清零，并跳过 UNINIT 区域；当前步涉及的内存区会亮起光圈
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <ol className="space-y-2">
            {BOOT_STEPS.map((s, i) => {
              const phase = i === stepIdx ? 'now' : i < stepIdx ? 'done' : 'todo'
              return (
                <li
                  key={s.label}
                  className={[
                    'rounded-lg border px-3 py-2 text-xs leading-relaxed transition-colors',
                    phase === 'now' && 'border-accent bg-accent/10 text-ink',
                    phase === 'done' && 'border-line bg-panel text-muted',
                    phase === 'todo' && 'border-line bg-panel text-muted opacity-50',
                  ].filter(Boolean).join(' ')}
                >
                  <span className={`mr-2 font-mono ${phase === 'now' ? 'text-accent' : 'text-muted'}`}>
                    {i + 1}.
                  </span>
                  {s.label}
                </li>
              )
            })}
          </ol>
          <div className="space-y-2">
            {regions.map((region) => {
              const current = stepIdx >= 0 ? BOOT_STEPS[stepIdx] : null
              const active = current ? current.targets.includes(region.name) : false
              const skipped = active && region.name === 'RW_SDRAM_NOINIT'
              const { used, limit } = regionUsage(model, region.name)
              return (
                <div
                  key={region.name}
                  className={[
                    'rounded-lg border bg-panel px-3 py-2 transition-all',
                    active ? 'border-accent ring-2 ring-accent' : 'border-line',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-ink">{region.name}</span>
                    <span className="flex items-center gap-2">
                      {skipped && (
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${ATTR_BADGE.UNINIT}`}>
                          跳过
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-muted">{hex(region.base)}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-2">
                    <div
                      className={`h-full rounded-full ${region.kind === 'ram' ? 'bg-accent-2/60' : 'bg-accent/60'}`}
                      style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="mt-3">
          <Callout tone="tip" title="三种区域属性的本质">
            RW = 有初值要搬运；ZI = 零初值只需清零；UNINIT = 连清零都不做。这就是三种区域属性的本质区别。
          </Callout>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">链接器符号检查器</h3>
        <p className="mb-3 text-xs text-muted">
          armlink 会为每个区域生成边界符号，C 代码里 extern 声明后取地址，即可拿到区域起止
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="symbol-region" className="text-xs text-muted">区域</label>
          <select
            id="symbol-region"
            value={symbolRegion}
            onChange={(e) => setSymbolRegion(e.target.value)}
            className="rounded border border-line bg-panel px-2 py-1 font-mono text-xs text-ink"
          >
            {regions.map((r) => (
              <option key={r.name} value={r.name}>{r.name}</option>
            ))}
          </select>
          <span className="font-mono text-[11px] text-muted">
            对应符号：{`Image$$${symbolRegion}$$Base / $$Length`}
          </span>
        </div>
        <CodeBlock title="linker_symbols.c" code={SYMBOL_EXAMPLE} />
        <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>· Image$$区域名$$Base/Limit/Length 由 armlink 自动生成</li>
          <li>· RW 区域还有 Image$$区域名$$ZI$$Base/Limit</li>
          <li>· C 中用 extern 声明后取地址使用，符号本身不占存储</li>
        </ul>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">三工具链语法对照</h3>
        <p className="mb-3 text-xs text-muted">同一份内存布局，在 Keil / GCC / IAR 里的三种写法</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {SYNTAX_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSyntaxTab(t.id)}
              className={[
                'rounded border px-3 py-1 font-mono text-xs transition-colors',
                syntaxTab === t.id
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-panel text-muted hover:border-accent hover:text-ink',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <CodeBlock title={LINKER_SYNTAX[syntaxTab].label} code={LINKER_SYNTAX[syntaxTab].code} />
        <p className="mt-3 text-xs leading-relaxed text-muted">
          三种写法表达同一件事：哪段内容放哪块内存。Keil 用 LR/ER 区域，GCC 用 MEMORY+SECTIONS，IAR 用 define region + place
        </p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">map 文件解读</h3>
        <p className="mb-3 text-xs text-muted">
          链接完成后看 map 的 Grand Totals 与 Memory Map of the image，确认每段数据落点
        </p>
        <CodeBlock title="project.map（摘录）" code={MAP_SAMPLE} />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {MAP_NOTES.map((n) => (
            <div key={n.key} className="rounded-lg border border-line bg-panel px-3 py-2">
              <div className="font-mono text-xs font-semibold text-accent-2">{n.key}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted">{n.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">指定地址生成器</h3>
        <p className="mb-3 text-xs text-muted">
          输入十六进制目标地址，生成把变量钉到该地址的 AC5 / AC6 宏定义
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="at-addr" className="text-xs text-muted">目标地址</label>
          <input
            id="at-addr"
            type="text"
            value={addrText}
            onChange={(e) => onAddrChange(e.target.value)}
            spellCheck={false}
            className={`w-44 rounded border bg-panel px-2 py-1 font-mono text-sm text-ink outline-none transition-colors focus:border-accent ${addrErr ? 'border-danger' : 'border-line'}`}
          />
          {addrErr && (
            <span className="text-xs text-danger">非法十六进制，沿用上次有效值 {addr}</span>
          )}
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <CodeBlock title="AC5（armcc）" code={atSnippets.ac5} />
          <CodeBlock title="AC6（armclang）" code={atSnippets.ac6} />
        </div>
        <div className="mt-3">
          <Callout tone="warn" title="跨编译器版本要分开写">
            AC5 与 AC6 不一样：AC5 用 __attribute__((at(...)))，AC6 用 section(".ARM.__at_...")。跨版本代码要用 #if defined(__CC_ARM) 分开写。
          </Callout>
        </div>
      </section>
    </ModuleShell>
  )
}
