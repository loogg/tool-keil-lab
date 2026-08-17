import { useEffect, useMemo, useState } from 'react'
import Workbench from '../components/workbench/Workbench'
import { Button, FieldRow, SectionLabel, Segmented, StatTile, TextInput } from '../components/workbench/controls'
import { DrawerTrigger, Principle, RefTable } from '../components/workbench/Principle'
import CodeBlock from '../components/CodeBlock'
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
const IROM_USED_END = 0x00058a00
const RODATA_FIXED_ADDR = 0x080c0000
const RODATA_BLOCK_SIZE = 0x00010000
const rulerPct = (offset) => (offset / RULER_SPAN) * 100

export default function MemoryLabModule() {
  const [model, setModel] = useState(createDefaultModel)
  const [selected, setSelected] = useState(null)
  const [lastMoved, setLastMoved] = useState(null)

  const regions = [...model.regions].sort((a, b) => a.base - b.base)
  const scatterCode = generateScatter(model)

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

  // 扩展卡片状态
  const [filter, setFilter] = useState('+RO')
  const [fixedOn, setFixedOn] = useState(true)
  const [stepIdx, setStepIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [symbolRegion, setSymbolRegion] = useState('ER_RODATA')
  const [syntaxTab, setSyntaxTab] = useState('sct')
  const [addrText, setAddrText] = useState('0x080E0000')
  const [addr, setAddr] = useState('0x080E0000')
  const [addrErr, setAddrErr] = useState(false)

  const hitSet = useMemo(() => new Set(selectSections(filter).map((s) => s.name)), [filter])
  const atSnippets = useMemo(() => atSnippet(addr), [addr])

  // 播放启动：每 1200ms 步进一次，到末尾自动停止
  useEffect(() => {
    if (!playing) return undefined
    let step = 0
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
      return
    }
    setAddrErr(false)
    setAddr(hex(parsed))
  }

  // ---- 实验① scatter 编辑 ----
  const scatterControl = (
    <div className="space-y-3">
      <SectionLabel className="mb-2">Section List · 段清单</SectionLabel>
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        {model.items.map((item) => {
          const isSel = selected === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(isSel ? null : item.id)}
              className={`flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left transition-colors last:border-b-0 ${isSel ? 'bg-accent/10 ring-1 ring-inset ring-accent' : 'hover:bg-panel-2'}`}
            >
              <span className={`font-mono text-xs ${isSel ? 'text-accent' : 'text-ink'}`}>{item.label}</span>
              <span className="hidden truncate text-xs text-muted md:inline">{item.detail}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <span className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{item.region}</span>
                <span className="w-16 text-right font-mono text-[11px] text-muted">{fmtKB(item.size)}</span>
              </span>
            </button>
          )
        })}
      </div>
      <Button variant="ghost" onClick={reset} className="w-full">恢复默认布局</Button>
    </div>
  )

  const scatterCanvas = (
    <div className="space-y-4">
      <SectionLabel className="flex items-center gap-2">
        Memory Regions · 内存区域
        <Principle title="为什么网页资源放 Data Flash">GD32 的 Flash 分 Code 与 Data 两块，字库/网页这类大块只读数据不要求执行速度，放 Data Flash 能给代码腾地方。</Principle>
      </SectionLabel>
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
              className={`block w-full rounded-lg border bg-panel p-3 text-left transition-colors ${overflow ? 'border-danger/70' : 'border-line'} ${clickable ? 'cursor-pointer hover:border-accent' : 'cursor-default'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-ink">{region.name}</span>
                  {region.attrs.fixed && <span className="rounded border border-warn/40 bg-warn/10 px-1 text-[10px] font-semibold tracking-wide text-warn">FIXED</span>}
                  {region.attrs.uninit && <span className="rounded border border-accent-2/40 bg-accent-2/10 px-1 text-[10px] font-semibold tracking-wide text-accent-2">UNINIT</span>}
                  <span className="hidden truncate text-xs text-muted sm:inline">{region.note}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
                  <span>{hex(region.base)} – {hex(region.base + region.maxSize - 1)}</span>
                  {clickable && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">放入 →</span>}
                </div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-2">
                <div className={`h-full rounded-full ${overflow ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[11px]">
                <span className={overflow ? 'text-danger' : 'text-muted'}>{fmtSize(used)} / {fmtSize(limit)}（{pct.toFixed(1)}%）</span>
                {overflow && <span className="font-semibold text-danger">⚠ 超出 {used - limit} 字节</span>}
              </div>
            </button>
          )
        })}
      </div>
      <CodeBlock title="target.sct" code={scatterCode} highlightLines={highlightLines} />
    </div>
  )

  // ---- 实验② 筛选器与 FIXED/UNINIT ----
  const filterControl = (
    <div className="space-y-5">
      <div>
        <SectionLabel className="mb-2">Section Filter · 筛选器</SectionLabel>
        <Segmented
          options={[
            { id: '+RO', label: '+RO' },
            { id: '.rodata.*', label: '.rodata.*' },
          ]}
          value={filter}
          onChange={setFilter}
          className="w-full"
        />
      </div>
      <div>
        <SectionLabel className="mb-2">FIXED Demo · 固定地址</SectionLabel>
        <Button variant={fixedOn ? 'primary' : 'ghost'} onClick={() => setFixedOn(!fixedOn)}>
          FIXED: {fixedOn ? '开' : '关'}
        </Button>
      </div>
    </div>
  )

  const filterCanvas = (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-panel">
        {PACKEDFS_SECTIONS.map((s) => {
          const hit = hitSet.has(s.name)
          return (
            <div key={s.name} className={`flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 ${hit ? '' : 'opacity-40'}`}>
              <span className={`w-4 text-center font-mono text-xs ${hit ? 'text-accent' : 'text-muted'}`}>{hit ? '✓' : '–'}</span>
              <span className={`font-mono text-xs ${hit ? 'text-ink' : 'text-muted'}`}>{s.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{fmtSize(s.size)}</span>
            </div>
          )
        })}
      </div>
      <div className="rounded-lg border border-line bg-panel p-4">
        <p className="text-xs leading-relaxed text-muted">
          .rodata.* 按 section 名称筛选；+RO 按 section 属性筛选，范围更大。若只想把资源数据放到指定 Flash，优先使用 .rodata.* 或自定义专用 section。
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-panel p-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-ink">FIXED</span>
            <span className="rounded border border-warn/40 bg-warn/10 px-1 text-[10px] font-semibold tracking-wide text-warn">ER_RODATA</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {fixedOn ? 'ER_RODATA 固定在 0x080C0000，无论前面区域多大都不挪动' : '按顺序紧跟 ER_IROM1 之后排布，地址随前方占用变化'}
          </p>
          <div className="mt-4">
            <div className="relative h-9 overflow-hidden rounded border border-line bg-panel-2">
              <div className="absolute inset-y-0 w-px bg-line" style={{ left: `${rulerPct(RODATA_FIXED_ADDR - RULER_BASE)}%` }} />
              <div className="absolute inset-y-1 flex items-center overflow-hidden rounded bg-accent/40 px-1" style={{ left: 0, width: `${rulerPct(IROM_USED_END)}%` }}>
                <span className="truncate font-mono text-[9px] text-ink">ER_IROM1</span>
              </div>
              <div className="absolute inset-y-1 flex items-center overflow-hidden rounded bg-warn/50 px-1 transition-all duration-300" style={{ left: `${fixedOn ? rulerPct(RODATA_FIXED_ADDR - RULER_BASE) : rulerPct(IROM_USED_END)}%`, width: `${rulerPct(RODATA_BLOCK_SIZE)}%` }}>
                <span className="truncate font-mono text-[9px] text-ink">RODATA</span>
              </div>
            </div>
            <div className="relative mt-1 h-4 font-mono text-[10px] text-muted">
              <span className="absolute left-0">0x08000000</span>
              <span className="absolute -translate-x-1/2" style={{ left: `${rulerPct(RODATA_FIXED_ADDR - RULER_BASE)}%` }}>0x080C0000</span>
              <span className="absolute right-0">0x08100000</span>
            </div>
            <p className="mt-2 font-mono text-[11px] text-muted">
              {fixedOn ? 'ER_RODATA @ 0x080C0000（FIXED 钉死刻度）' : 'ER_RODATA @ 0x08058A00（紧跟 ER_IROM1 末端）'}
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-panel p-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-ink">UNINIT</span>
            <span className="rounded border border-accent-2/40 bg-accent-2/10 px-1 text-[10px] font-semibold tracking-wide text-accent-2">RW_SDRAM_NOINIT</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            链接器不会用零（或其它值）初始化这个区域 —— 掉电前写入的内容在上电后保持原样（取决于硬件），适合大缓冲/帧缓存。
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            RW = 有初值要搬运；ZI = 零初值只需清零；UNINIT = 连清零都不做。这就是三种区域属性的本质区别。
          </p>
        </div>
      </div>
    </div>
  )

  // ---- 实验③ 启动搬运动画 ----
  const bootControl = (
    <div className="space-y-3">
      <SectionLabel className="mb-2">Boot Sequence · 启动序列</SectionLabel>
      <div className="flex gap-2">
        <Button variant="primary" onClick={playBoot} disabled={playing}>▶ 播放启动</Button>
        <Button variant="ghost" onClick={resetBoot}>重置</Button>
      </div>
    </div>
  )

  const bootCanvas = (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ol className="space-y-2">
          {BOOT_STEPS.map((s, i) => {
            const phase = i === stepIdx ? 'now' : i < stepIdx ? 'done' : 'todo'
            return (
              <li key={s.label} className={`rounded-lg border px-3 py-2 text-xs leading-relaxed transition-colors ${phase === 'now' ? 'border-accent bg-accent/10 text-ink' : phase === 'done' ? 'border-line bg-panel text-muted' : 'border-line bg-panel text-muted opacity-50'}`}>
                <span className={`mr-2 font-mono ${phase === 'now' ? 'text-accent' : 'text-muted'}`}>{i + 1}.</span>
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
              <div key={region.name} className={`rounded-lg border bg-panel px-3 py-2 transition-all ${active ? 'border-accent ring-2 ring-accent' : 'border-line'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-ink">{region.name}</span>
                  <span className="flex items-center gap-2">
                    {skipped && <span className="rounded border border-accent-2/40 bg-accent-2/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent-2">跳过</span>}
                    <span className="font-mono text-[10px] text-muted">{hex(region.base)}</span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-2">
                  <div className={`h-full rounded-full ${region.kind === 'ram' ? 'bg-accent-2/60' : 'bg-accent/60'}`} style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  // ---- 实验④ 链接器符号与语法对照 ----
  const symbolControl = (
    <div className="space-y-5">
      <div>
        <SectionLabel className="mb-2">Region · 区域</SectionLabel>
        <FieldRow label="查看符号">
          <select value={symbolRegion} onChange={(e) => setSymbolRegion(e.target.value)} className="w-48">
            {regions.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
          </select>
        </FieldRow>
      </div>
      <div>
        <SectionLabel className="mb-2">Syntax · 语法</SectionLabel>
        <Segmented
          options={SYNTAX_TABS.map((t) => ({ id: t.id, label: t.label }))}
          value={syntaxTab}
          onChange={setSyntaxTab}
          className="w-full"
        />
      </div>
    </div>
  )

  const symbolCanvas = (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-panel p-4">
        <p className="mb-2 text-xs text-muted">对应符号：{`Image$$${symbolRegion}$$Base / $$Length`}</p>
        <CodeBlock title="linker_symbols.c" code={SYMBOL_EXAMPLE} />
        <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>· Image$$区域名$$Base/Limit/Length 由 armlink 自动生成</li>
          <li>· RW 区域还有 Image$$区域名$$ZI$$Base/Limit</li>
          <li>· C 中用 extern 声明后取地址使用，符号本身不占存储</li>
        </ul>
      </div>
      <CodeBlock title={LINKER_SYNTAX[syntaxTab].label} code={LINKER_SYNTAX[syntaxTab].code} />
      <p className="text-xs leading-relaxed text-muted">
        三种写法表达同一件事：哪段内容放哪块内存。Keil 用 LR/ER 区域，GCC 用 MEMORY+SECTIONS，IAR 用 define region + place。
      </p>
    </div>
  )

  // ---- 实验⑤ map 解读与 at() 生成器 ----
  const mapCanvas = (
    <div className="space-y-4">
      <SectionLabel className="mb-2">Map File · 链接 map 摘录</SectionLabel>
      <CodeBlock title="project.map（摘录）" code={MAP_SAMPLE} />
      <div className="grid gap-2 sm:grid-cols-2">
        {MAP_NOTES.map((n) => (
          <div key={n.key} className="rounded-lg border border-line bg-panel px-3 py-2">
            <div className="font-mono text-xs font-semibold text-accent-2">{n.key}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted">{n.desc}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-line bg-panel p-4">
        <SectionLabel className="mb-2">Address Generator · 指定地址生成器</SectionLabel>
        <FieldRow label="目标地址">
          <div className="flex items-center gap-2">
            <TextInput value={addrText} onChange={(e) => onAddrChange(e.target.value)} className={`w-44 ${addrErr ? '!border-danger' : ''}`} placeholder="0x080E0000" />
            {addrErr && <span className="text-xs text-danger">非法十六进制</span>}
          </div>
        </FieldRow>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <CodeBlock title="AC5（armcc）" code={atSnippets.ac5} />
          <CodeBlock title="AC6（armclang）" code={atSnippets.ac6} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          AC5 与 AC6 不一样：AC5 用 <code className="font-mono">__attribute__((at(...)))</code>，AC6 用 <code className="font-mono">section(".ARM.__at_...")</code>。跨版本代码要用 #if defined(__CC_ARM) 分开写。
        </p>
      </div>
    </div>
  )

  return (
    <Workbench
      title="内存布局实验室"
      tagline="scatter 文件决定每段代码和数据落在哪块 Flash / RAM"
      experiments={[
        { id: 'scatter', label: 'scatter 编辑', control: scatterControl, canvas: scatterCanvas },
        { id: 'filter', label: '筛选器与属性', control: filterControl, canvas: filterCanvas },
        { id: 'boot', label: '启动搬运', control: bootControl, canvas: bootCanvas },
        { id: 'symbol', label: '符号与语法', control: symbolControl, canvas: symbolCanvas },
        { id: 'map', label: 'map 与 at()', control: <SectionLabel>map 解读与地址生成器</SectionLabel>, canvas: mapCanvas },
      ]}
    />
  )
}
