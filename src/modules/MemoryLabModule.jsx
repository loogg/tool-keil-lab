import { useEffect, useMemo, useRef, useState } from 'react'
import Workbench from '../components/workbench/Workbench'
import { Button, FieldRow, IconButton, SectionLabel, Segmented, Select, StatTile, TextInput } from '../components/workbench/controls'
import { DrawerTrigger, Principle, RefTable } from '../components/workbench/Principle'
import CodeBlock from '../components/CodeBlock'
import {
  createDefaultModel, createDualLoadModel, createUnionModel,
  addRegion, removeRegion, updateRegion,
  addItem, removeItem, placeItem,
  regionLayout, overflowDetail,
  validateModel,
  PACKEDFS_SECTIONS, selectSections,
} from '../lib/memoryMap'
import { generateScatter, parseScatter } from '../lib/scatterGen'
import { MAP_SAMPLE, MAP_NOTES, LINKER_SYNTAX, SYMBOL_EXAMPLE, atSnippet } from '../data/memoryLab'

// 地址十六进制：8 位补零大写
const hex = (n) => '0x' + n.toString(16).toUpperCase().padStart(8, '0')
const fmtSize = (n) => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n % 1024 ? 1 : 0)} KB`
const fmtKB = (n) => `${n / 1024} KB`

// 启动搬运步骤（单步调试模式）
const BOOT_STEPS = [
  { label: '上电：从向量表取初始 SP 与 Reset_Handler 地址', targets: [], regs: { SP: '0x20007000', PC: '0x08000004' } },
  { label: '复制 RW 数据：Flash（LMA）→ RAM（VMA）', targets: ['RW_IRAM1', 'RW_CCRAM'], regs: { SP: '0x20007000', PC: '0x08000100' } },
  { label: '清零 ZI 区域', targets: ['RW_IRAM1', 'RW_CCRAM'], regs: { SP: '0x20007000', PC: '0x08000200' } },
  { label: '跳过 UNINIT 区域', targets: ['RW_SDRAM_NOINIT'], regs: { SP: '0x20007000', PC: '0x08000300' } },
  { label: '跳转 main()', targets: [], regs: { SP: '0x20007000', PC: '0x08000400' } },
]

const SYNTAX_TABS = [
  { id: 'sct', label: LINKER_SYNTAX.sct.label },
  { id: 'ld', label: LINKER_SYNTAX.ld.label },
  { id: 'icf', label: LINKER_SYNTAX.icf.label },
]

const SCENES = [
  { id: 'default', label: '默认（GD32）', modelFn: createDefaultModel },
  { id: 'dual', label: 'Bootloader+App', modelFn: createDualLoadModel },
  { id: 'union', label: 'UNION 演示', modelFn: createUnionModel },
]

export default function MemoryLabModule() {
  // 核心状态
  const [scene, setScene] = useState('default')
  const [model, setModel] = useState(() => createDefaultModel())

  // 编辑状态
  const [scatterText, setScatterText] = useState(() => generateScatter(createDefaultModel()))
  const [scatterEditMode, setScatterEditMode] = useState(false)

  // 筛选器与 FIXED
  const [filter, setFilter] = useState('+RO')
  const [fixedAddr, setFixedAddr] = useState('0x080C0000')

  // 启动搬运（单步模式）
  const [bootStep, setBootStep] = useState(-1)
  const [bootPlaying, setBootPlaying] = useState(false)

  // 符号与语法
  const [symbolRegion, setSymbolRegion] = useState('ER_RODATA')
  const [syntaxTab, setSyntaxTab] = useState('sct')

  // map 与 at()
  const [addrText, setAddrText] = useState('0x080E0000')
  const [addr, setAddr] = useState('0x080E0000')
  const [addrErr, setAddrErr] = useState(false)

  // 场景切换
  const switchScene = (sceneId) => {
    const sceneObj = SCENES.find((s) => s.id === sceneId)
    if (!sceneObj) return
    setScene(sceneId)
    const newModel = sceneObj.modelFn()
    setModel(newModel)
    setScatterText(generateScatter(newModel))
    setBootStep(-1)
  }

  // 派生状态
  const regions = [...model.regions].sort((a, b) => a.base - b.base)
  const errors = useMemo(() => validateModel(model), [model])
  const hitSet = useMemo(() => new Set(selectSections(filter).map((s) => s.name)), [filter])
  const atSnippets = useMemo(() => atSnippet(addr), [addr])

  // scatter 文本变更 → 尝试解析
  const applyScatterText = () => {
    const result = parseScatter(scatterText)
    if (result.error) {
      alert(`解析失败：${result.error}`)
      return
    }
    // 重建 model
    const newModel = {
      regions: result.regions,
      items: result.items,
      loadRegions: result.loadRegions,
    }
    setModel(newModel)
    setScatterEditMode(false)
  }

  // 启动搬运自动播放（用 ref 避免 effect 内同步 setState）
  const bootStepRef = useRef(bootStep)
  useEffect(() => { bootStepRef.current = bootStep }, [bootStep])

  useEffect(() => {
    if (!bootPlaying) return
    if (bootStepRef.current >= BOOT_STEPS.length - 1) return
    const timer = setTimeout(() => setBootStep((s) => s + 1), 1200)
    return () => clearTimeout(timer)
  }, [bootPlaying, bootStep])

  // ---------- 实验① scatter 编辑器（树形面板 + 拖拽） ----------
  const [expandedRegions, setExpandedRegions] = useState(() => new Set(regions.map((r) => r.name)))
  const [dragItemId, setDragItemId] = useState(null)
  const [dragOverRegion, setDragOverRegion] = useState(null)

  const toggleRegion = (name) => {
    const next = new Set(expandedRegions)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setExpandedRegions(next)
  }

  const handleDragStart = (itemId) => {
    setDragItemId(itemId)
  }

  const handleDragOver = (e, regionName) => {
    e.preventDefault()
    setDragOverRegion(regionName)
  }

  const handleDragLeave = () => {
    setDragOverRegion(null)
  }

  const handleDrop = (regionName) => {
    if (dragItemId) {
      setModel(placeItem(model, dragItemId, regionName))
    }
    setDragItemId(null)
    setDragOverRegion(null)
  }

  const [addingInSection, setAddingInSection] = useState(null)
  const [newItemLabelInline, setNewItemLabelInline] = useState('')
  const [newItemSizeInline, setNewItemSizeInline] = useState('0x1000')

  const startAddSection = (regionName) => {
    setAddingInSection(regionName)
    setNewItemLabelInline('')
    setNewItemSizeInline('0x1000')
  }

  const confirmAddSection = (regionName) => {
    if (newItemLabelInline) {
      setModel(addItem(model, { label: newItemLabelInline, region: regionName, size: parseInt(newItemSizeInline, 16) || 0x1000 }))
    }
    setAddingInSection(null)
  }

  const [addingRegion, setAddingRegion] = useState(false)
  const [newRegionNameInline, setNewRegionNameInline] = useState('')
  const [newRegionBaseInline, setNewRegionBaseInline] = useState('0x20000000')
  const [newRegionSizeInline, setNewRegionSizeInline] = useState('0x10000')

  const startAddRegion = () => {
    setAddingRegion(true)
    setNewRegionNameInline('')
    setNewRegionBaseInline('0x20000000')
    setNewRegionSizeInline('0x10000')
  }

  const confirmAddRegion = () => {
    if (newRegionNameInline) {
      setModel(addRegion(model, { name: newRegionNameInline, base: parseInt(newRegionBaseInline, 16), maxSize: parseInt(newRegionSizeInline, 16) }))
    }
    setAddingRegion(false)
  }

  const scatterControl = (
    <div className="space-y-3">
      {/* 场景预设 */}
      <div>
        <SectionLabel className="mb-2">场景预设</SectionLabel>
        <Segmented
          options={SCENES.map((s) => ({ id: s.id, label: s.label }))}
          value={scene}
          onChange={switchScene}
          className="w-full"
        />
      </div>

      {/* 树形结构：Region → Sections */}
      <div className="space-y-1">
        {regions.map((region) => {
          const regionItems = model.items.filter((i) => i.region === region.name)
          const isExpanded = expandedRegions.has(region.name)
          const isDragOver = dragOverRegion === region.name

          return (
            <div key={region.name} className="rounded-lg border border-line bg-panel overflow-hidden">
              {/* Region 行 */}
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-panel-2 transition-colors"
                onClick={() => toggleRegion(region.name)}
                onDragOver={(e) => handleDragOver(e, region.name)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(region.name)}
              >
                <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                <span className="flex-1 font-mono text-sm font-semibold text-ink">{region.name}</span>
                <span className="text-xs text-muted">{fmtSize(region.maxSize)}</span>
                {region.attrs.fixed && <span className="text-[10px] px-1 rounded border border-warn/40 bg-warn/10 text-warn">FIXED</span>}
                {region.attrs.uninit && <span className="text-[10px] px-1 rounded border border-accent-2/40 bg-accent-2/10 text-accent-2">UNINIT</span>}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setModel(removeRegion(model, region.name)) }}
                  className="opacity-0 group-hover:opacity-100 text-danger hover:text-danger/80 transition-opacity"
                  title="删除 Region"
                >
                  ×
                </button>
              </div>

              {/* Sections 列表 */}
              {isExpanded && (
                <div className={`border-t border-line ${isDragOver ? 'bg-accent/5' : ''}`}>
                  {regionItems.map((item) => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => handleDragStart(item.id)}
                      className="group flex items-center gap-2 pl-8 pr-3 py-1.5 hover:bg-panel-2 cursor-move transition-colors"
                    >
                      <span className="text-xs text-muted">├</span>
                      <span className="flex-1 font-mono text-xs text-ink truncate">{item.label}</span>
                      <span className="text-xs text-muted">{fmtKB(item.size)}</span>
                      <button
                        type="button"
                        onClick={() => setModel(removeItem(model, item.id))}
                        className="opacity-0 group-hover:opacity-100 text-danger hover:text-danger/80 transition-opacity"
                        title="删除 Section"
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  {/* 行内添加 Section */}
                  {addingInSection === region.name ? (
                    <div className="pl-8 pr-3 py-2 bg-panel-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <TextInput
                          value={newItemLabelInline}
                          onChange={(e) => setNewItemLabelInline(e.target.value)}
                          placeholder="section 标签（如 .text, .data）"
                          className="flex-1 text-xs"
                          autoFocus
                        />
                        <TextInput
                          value={newItemSizeInline}
                          onChange={(e) => setNewItemSizeInline(e.target.value)}
                          placeholder="大小"
                          className="w-24 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => confirmAddSection(region.name)}
                          className="flex items-center justify-center w-8 h-8 rounded bg-accent text-white hover:bg-accent/90 transition-colors"
                          title="确认添加"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddingInSection(null)}
                          className="flex items-center justify-center w-8 h-8 rounded border border-line text-muted hover:text-ink transition-colors"
                          title="取消"
                        >
                          ×
                        </button>
                      </div>
                      {/* 预设选项 */}
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[10px] text-muted">预设:</span>
                        {[
                          { label: '.text', size: '0x4000' },
                          { label: '.rodata', size: '0x2000' },
                          { label: '.data', size: '0x1000' },
                          { label: '.bss', size: '0x2000' },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => {
                              setNewItemLabelInline(preset.label)
                              setNewItemSizeInline(preset.size)
                            }}
                            className="text-[10px] px-2 py-0.5 rounded border border-line bg-panel hover:border-accent hover:text-accent transition-colors"
                          >
                            {preset.label} ({preset.size})
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startAddSection(region.name)}
                      className="w-full text-left pl-8 pr-3 py-2 text-xs text-muted hover:text-accent hover:bg-panel-2 transition-colors border-b border-line/50"
                    >
                      + 添加 section...
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* 添加 Region */}
        {addingRegion ? (
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <TextInput value={newRegionNameInline} onChange={(e) => setNewRegionNameInline(e.target.value)} placeholder="名称" className="text-xs" autoFocus />
              <TextInput value={newRegionBaseInline} onChange={(e) => setNewRegionBaseInline(e.target.value)} placeholder="base" className="text-xs" />
              <TextInput value={newRegionSizeInline} onChange={(e) => setNewRegionSizeInline(e.target.value)} placeholder="size" className="text-xs" />
            </div>
            {/* 预设选项 */}
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] text-muted">预设:</span>
              {[
                { name: 'ER_FLASH', base: '0x08000000', size: '0x40000', note: '256KB Flash' },
                { name: 'RW_SRAM', base: '0x20000000', size: '0x10000', note: '64KB SRAM' },
                { name: 'RW_CCRAM', base: '0x10000000', size: '0x10000', note: '64KB CCRAM' },
                { name: 'RW_SDRAM', base: '0xC0000000', size: '0x100000', note: '1MB SDRAM' },
              ].map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => {
                    setNewRegionNameInline(preset.name)
                    setNewRegionBaseInline(preset.base)
                    setNewRegionSizeInline(preset.size)
                  }}
                  className="text-[10px] px-2 py-0.5 rounded border border-line bg-panel hover:border-accent hover:text-accent transition-colors"
                  title={preset.note}
                >
                  {preset.name} ({preset.note})
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmAddRegion}
                className="flex items-center justify-center gap-1 flex-1 h-8 rounded bg-accent text-white text-xs hover:bg-accent/90 transition-colors"
              >
                ✓ 确认添加
              </button>
              <button
                type="button"
                onClick={() => setAddingRegion(false)}
                className="flex items-center justify-center w-8 h-8 rounded border border-line text-muted hover:text-ink transition-colors"
              >
                ×
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={startAddRegion}
            className="w-full rounded-lg border border-dashed border-line bg-panel/50 py-2 text-xs text-muted hover:border-accent hover:text-accent transition-colors"
          >
            + 添加 Region
          </button>
        )}
      </div>
    </div>
  )

  const scatterCanvas = (
    <div className="space-y-4">
      {errors.length > 0 && (
        <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>scatter 文件</SectionLabel>
          <Button variant="ghost" onClick={() => setScatterEditMode(!scatterEditMode)}>
            {scatterEditMode ? '预览' : '编辑'}
          </Button>
        </div>
        {scatterEditMode ? (
          <div>
            <textarea
              value={scatterText}
              onChange={(e) => setScatterText(e.target.value)}
              className="w-full rounded border border-line bg-code p-2 font-mono text-xs text-ink"
              rows={12}
              spellCheck={false}
            />
            <div className="mt-2 flex gap-2">
              <Button variant="primary" onClick={applyScatterText}>应用</Button>
              <Button variant="ghost" onClick={() => { setScatterText(generateScatter(model)); setScatterEditMode(false) }}>重置</Button>
            </div>
          </div>
        ) : (
          <CodeBlock title="target.sct" code={scatterText} />
        )}
      </div>

      {/* Region 占用可视化（第二层：偏移 + 碎片） */}
      <div>
        <SectionLabel className="mb-2">Region 占用详情</SectionLabel>
        <div className="space-y-2">
          {regions.map((region) => {
            const layout = regionLayout(model, region.name)
            const overflow = overflowDetail(model, region.name)
            return (
              <div key={region.name} className="rounded border border-line bg-panel p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold text-ink">{region.name}</span>
                  <span className={`text-xs ${layout.overflow ? 'text-danger' : 'text-muted'}`}>
                    {fmtSize(layout.used)} / {fmtSize(layout.limit)}
                  </span>
                </div>
                {/* 偏移可视化条 */}
                <div className="relative h-6 overflow-hidden rounded bg-panel-2">
                  {layout.items.map((item, i) => (
                    <div
                      key={item.id}
                      className="absolute top-0 h-full border-r border-bg/50"
                      style={{
                        left: `${(item.offset / layout.limit) * 100}%`,
                        width: `${(item.size / layout.limit) * 100}%`,
                        background: i % 2 === 0 ? '#818cf8' : '#3b82f6',
                      }}
                      title={`${item.label} @ ${hex(item.offset)} (${fmtSize(item.size)})`}
                    />
                  ))}
                  {layout.gaps.map((gap, i) => (
                    <div
                      key={`gap-${i}`}
                      className="absolute top-0 h-full pad-stripes opacity-30"
                      style={{
                        left: `${(gap.start / layout.limit) * 100}%`,
                        width: `${(gap.size / layout.limit) * 100}%`,
                      }}
                      title={`碎片 @ ${hex(gap.start)} (${fmtSize(gap.size)})`}
                    />
                  ))}
                </div>
                {overflow && (
                  <div className="mt-1 text-xs text-danger">
                    ⚠ 溢出 {fmtSize(overflow.overflowBy)} 字节（从 {overflow.itemLabel} 开始）
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  // ---------- 实验② 筛选器与属性（增强 FIXED 地址输入） ----------
  const filterControl = (
    <div className="space-y-4">
      <div>
        <SectionLabel className="mb-2">Section Filter</SectionLabel>
        <Segmented
          options={[{ id: '+RO', label: '+RO' }, { id: '.rodata.*', label: '.rodata.*' }]}
          value={filter}
          onChange={setFilter}
          className="w-full"
        />
      </div>
      <div>
        <SectionLabel className="mb-2">FIXED 地址</SectionLabel>
        <FieldRow label="ER_RODATA @">
          <TextInput value={fixedAddr} onChange={(e) => {
            setFixedAddr(e.target.value)
            const parsed = parseInt(e.target.value, 16)
            if (!isNaN(parsed)) {
              setModel(updateRegion(model, 'ER_RODATA', { base: parsed, attrs: { ...model.regions.find(r => r.name === 'ER_RODATA')?.attrs, fixed: true } }))
            }
          }} className="w-32" />
        </FieldRow>
      </div>
      <div>
        <SectionLabel className="mb-2">UNION 演示</SectionLabel>
        <Button variant="ghost" onClick={() => switchScene('union')}>切换到 UNION 场景</Button>
      </div>
    </div>
  )

  const filterCanvas = (
    <div className="space-y-4">
      <div className="rounded border border-line bg-panel">
        {PACKEDFS_SECTIONS.map((s) => {
          const hit = hitSet.has(s.name)
          return (
            <div key={s.name} className={`flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 ${hit ? '' : 'opacity-40'}`}>
              <span className={`w-4 text-center font-mono text-xs ${hit ? 'text-accent' : 'text-muted'}`}>{hit ? '✓' : '–'}</span>
              <span className={`font-mono text-xs ${hit ? 'text-ink' : 'text-muted'}`}>{s.name}</span>
              <span className="ml-auto font-mono text-[11px] text-muted">{fmtSize(s.size)}</span>
            </div>
          )
        })}
      </div>
      <DrawerTrigger label="FIXED/UNINIT 原理" title="FIXED 与 UNINIT 属性">
        <p><strong>FIXED</strong>：钉死绝对地址，无论前面区域多大都不挪动。</p>
        <p><strong>UNINIT</strong>：链接器不初始化此区域，掉电前写入的内容上电后保持原样（适合大缓冲/帧缓存）。</p>
        <p><strong>UNION</strong>：两个执行区共享同一段地址空间（如 RAM_CODE 和 RAM_DATA 共用 CCRAM）。</p>
      </DrawerTrigger>
    </div>
  )

  // ---------- 实验③ 启动搬运（第三层：单步调试） ----------
  const bootControl = (
    <div className="space-y-3">
      <SectionLabel className="mb-2">启动序列（单步模式）</SectionLabel>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => { setBootStep(0); setBootPlaying(true) }} disabled={bootPlaying}>▶ 播放</Button>
        <Button variant="ghost" onClick={() => setBootStep((s) => Math.min(s + 1, BOOT_STEPS.length - 1))} disabled={bootStep >= BOOT_STEPS.length - 1}>单步 →</Button>
        <Button variant="ghost" onClick={() => { setBootStep(-1); setBootPlaying(false) }}>重置</Button>
      </div>
    </div>
  )

  const bootCanvas = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(bootStep >= 0 ? BOOT_STEPS[bootStep].regs : {}).map(([reg, val]) => (
          <StatTile key={reg} label={reg} value={val} tone="accent" />
        ))}
      </div>
      <ol className="space-y-2">
        {BOOT_STEPS.map((s, i) => {
          const phase = i === bootStep ? 'now' : i < bootStep ? 'done' : 'todo'
          return (
            <li key={s.label} className={`rounded border px-3 py-2 text-xs ${phase === 'now' ? 'border-accent bg-accent/10 text-ink' : phase === 'done' ? 'border-line bg-panel text-muted' : 'border-line bg-panel text-muted opacity-50'}`}>
              <span className={`mr-2 font-mono ${phase === 'now' ? 'text-accent' : 'text-muted'}`}>{i + 1}.</span>
              {s.label}
            </li>
          )
        })}
      </ol>
    </div>
  )

  // ---------- 实验④ 符号与语法 ----------
  const symbolControl = (
    <div className="space-y-4">
      <FieldRow label="区域">
        <Select value={symbolRegion} onChange={(e) => setSymbolRegion(e.target.value)}>
          {regions.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
        </Select>
      </FieldRow>
      <div>
        <SectionLabel className="mb-2">语法对照</SectionLabel>
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
      <p className="text-xs text-muted">符号：{`Image$$${symbolRegion}$$Base / $$Length`}</p>
      <CodeBlock title="linker_symbols.c" code={SYMBOL_EXAMPLE} />
      <CodeBlock title={LINKER_SYNTAX[syntaxTab].label} code={LINKER_SYNTAX[syntaxTab].code} />
    </div>
  )

  // ---------- 实验⑤ map 与 at() ----------
  const mapCanvas = (
    <div className="space-y-4">
      <CodeBlock title="project.map（摘录）" code={MAP_SAMPLE} />
      <div className="grid grid-cols-2 gap-2">
        {MAP_NOTES.map((n) => (
          <div key={n.key} className="rounded border border-line bg-panel px-3 py-2">
            <div className="font-mono text-xs font-semibold text-accent-2">{n.key}</div>
            <div className="mt-0.5 text-xs text-muted">{n.desc}</div>
          </div>
        ))}
      </div>
      <div className="rounded border border-line bg-panel p-3">
        <SectionLabel className="mb-2">指定地址生成器</SectionLabel>
        <FieldRow label="目标地址">
          <TextInput value={addrText} onChange={(e) => {
            setAddrText(e.target.value)
            const parsed = parseInt(e.target.value, 16)
            if (isNaN(parsed)) setAddrErr(true)
            else { setAddrErr(false); setAddr(hex(parsed)) }
          }} className={`w-32 ${addrErr ? '!border-danger' : ''}`} />
        </FieldRow>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <CodeBlock title="AC5" code={atSnippets.ac5} />
          <CodeBlock title="AC6" code={atSnippets.ac6} />
        </div>
      </div>
    </div>
  )

  // ---------- 实验⑥ Bootloader+App（第三层） ----------
  const blCanvas = (
    <div className="space-y-4">
      <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
        <strong>双加载区场景</strong>：Bootloader @ 0x08000000 (128KB) + App @ 0x08020000 (896KB)
      </div>
      <div className="space-y-2">
        {(model.loadRegions || []).map((lr) => (
          <div key={lr.name} className="rounded border border-line bg-panel p-3">
            <div className="mb-2 font-mono text-sm font-semibold text-ink">{lr.name}</div>
            <div className="text-xs text-muted">{lr.note}</div>
            <div className="mt-1 font-mono text-xs text-accent">{hex(lr.base)} – {hex(lr.base + lr.maxSize - 1)}</div>
          </div>
        ))}
      </div>
      <DrawerTrigger label="向量表重定向原理" title="Bootloader 向量表重定向">
        <p>App 的向量表不在 0x08000000，需要在 Bootloader 中设置 VTOR 寄存器指向 App 的向量表地址。</p>
        <CodeBlock title="VTOR 设置" code={`SCB->VTOR = 0x08020000;`} />
      </DrawerTrigger>
    </div>
  )

  return (
    <Workbench
      title="内存布局实验室"
      tagline="scatter 文件决定每段代码和数据落在哪块 Flash / RAM"
      experiments={[
        { id: 'scatter', label: 'scatter 编辑', control: scatterControl, canvas: scatterCanvas },
        { id: 'filter', label: '筛选器', control: filterControl, canvas: filterCanvas },
        { id: 'boot', label: '启动搬运', control: bootControl, canvas: bootCanvas },
        { id: 'symbol', label: '符号语法', control: symbolControl, canvas: symbolCanvas },
        { id: 'map', label: 'map/at()', control: <SectionLabel>map 解读与地址生成</SectionLabel>, canvas: mapCanvas },
        { id: 'bootloader', label: 'Bootloader', control: <SectionLabel>双加载区场景</SectionLabel>, canvas: blCanvas },
      ]}
    />
  )
}
