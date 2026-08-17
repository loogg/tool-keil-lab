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
import { generateScatter, generateLd, generateIcf, parseScatter, parseLd, parseIcf } from '../lib/scatterGen'
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

// Region 属性详细说明
const REGION_ATTR_DETAILS = {
  fixed: {
    title: 'FIXED - 固定绝对地址',
    content: '将执行区固定在指定地址，链接器不会因前方区域大小变化而调整其位置。',
    usage: ['Bootloader 向量表 (0x08000000)', 'Flash 配置参数区', '需要绝对地址访问的硬件寄存器映射'],
    syntax: 'ER_NAME 0x08000000 FIXED 0x10000 { ... }',
  },
  uninit: {
    title: 'UNINIT - 不初始化',
    content: '链接器不为该区域生成初始化代码，保留掉电前的内容。适用于需要保持状态的 RAM 区域。',
    usage: ['RTC 备份寄存器', '快速启动时跳过清零', '掉电保持数据'],
    syntax: 'RW_SDRAM_NOINIT 0xC0000000 UNINIT 0x2000000 { ... }',
  },
  block: {
    title: 'BLOCK - 限制大小',
    content: '限制该 region 的最大大小，防止链接器将其他内容放入。超出限制会产生链接错误。',
    usage: ['严格控制代码大小', '防止意外溢出到其他区域', '模块化分区'],
    syntax: 'ER_CODE 0x00020000 BLOCK(0x00040000) { ... }',
  },
  pi: {
    title: 'PI - 位置无关代码',
    content: '标记该加载区包含位置无关代码（PIC），可在任意地址运行。常用于 Bootloader 或 OTA 升级场景。',
    usage: ['Bootloader 自身', 'OTA 升级固件', '可在 RAM 中运行的代码'],
    syntax: 'LR_APP 0x08020000 0x000E0000 PI { ... }',
  },
  overlay: {
    title: 'OVERLAY - 覆盖区',
    content: '多个加载区共享同一段物理地址，通过软件切换加载不同内容。用于内存极度受限的场景。',
    usage: ['多固件镜像切换', 'Bank 切换', '共享 RAM 的不同用途'],
    syntax: 'LR_OVERLAY1 0x20000000 0x10000 OVERLAY { ... }',
  },
}

// Section 属性详细说明
const SECTION_ATTR_DETAILS = {
  '+RO': { title: '+RO - 只读属性', content: '包含代码和只读数据（.text, .rodata）。放置在 Flash 中。' },
  '+RW': { title: '+RW - 读写属性', content: '包含有初值的全局/静态变量（.data）。启动时从 Flash 复制到 RAM。' },
  '+ZI': { title: '+ZI - 零初始化', content: '包含未初始化或零初始化的变量（.bss）。启动时清零，不占 Flash 空间。' },
  'RESET': { title: 'RESET - 复位向量', content: '包含中断向量表。必须放在 Flash 起始地址 (0x08000000)。' },
  '+First': { title: '+First - 最前放置', content: '强制该 section 放在 region 的最开头。常用于向量表或启动代码。' },
}

// 属性按钮组件（带详细说明弹层）
function RegionAttrButton({ attr, selected, onClick }) {
  const [showDetail, setShowDetail] = useState(false)
  const detail = REGION_ATTR_DETAILS[attr.id]

  return (
    <>
      <button
        type="button"
        onClick={() => { onClick(); setShowDetail(false) }}
        onDoubleClick={() => setShowDetail(!showDetail)}
        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
          selected
            ? attr.id === 'fixed'
              ? 'border-warn bg-warn/20 text-warn'
              : attr.id === 'uninit'
              ? 'border-accent-2 bg-accent-2/20 text-accent-2'
              : attr.id === 'block'
              ? 'border-amber-400 bg-amber-400/20 text-amber-400'
              : 'border-emerald-400 bg-emerald-400/20 text-emerald-400'
            : 'border-line bg-panel hover:border-accent hover:text-accent'
        }`}
        title={attr.desc}
      >
        {selected ? '✓ ' : ''}{attr.label}
        <span className="ml-0.5 opacity-50">ⓘ</span>
      </button>
      {showDetail && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowDetail(false)}>
          <div className="rounded-lg border border-line bg-panel p-4 max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-ink mb-2">{detail.title}</h3>
            <p className="text-xs text-muted mb-3">{detail.content}</p>
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-accent">典型用途:</p>
              <ul className="text-xs text-muted list-disc list-inside space-y-0.5">
                {detail.usage.map((u, i) => <li key={i}>{u}</li>)}
              </ul>
              <p className="text-[10px] font-semibold text-accent mt-2">语法示例:</p>
              <pre className="text-[11px] text-ink bg-code rounded p-2 overflow-x-auto">{detail.syntax}</pre>
            </div>
            <button className="mt-3 w-full rounded bg-accent/20 text-accent text-xs py-1.5" onClick={() => setShowDetail(false)}>关闭</button>
          </div>
        </div>
      )}
    </>
  )
}

// Section 属性按钮组件（带详细说明弹层）
function SectionAttrButton({ attr, selected, onClick }) {
  const [showDetail, setShowDetail] = useState(false)
  const detail = SECTION_ATTR_DETAILS[attr.id]

  return (
    <>
      <button
        type="button"
        onClick={() => { onClick(); setShowDetail(false) }}
        onDoubleClick={() => setShowDetail(!showDetail)}
        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
          selected
            ? 'border-accent bg-accent/20 text-accent'
            : 'border-line bg-panel hover:border-accent hover:text-accent'
        }`}
        title={attr.desc}
      >
        {selected ? '✓ ' : ''}{attr.label}
        <span className="ml-0.5 opacity-50">ⓘ</span>
      </button>
      {showDetail && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowDetail(false)}>
          <div className="rounded-lg border border-line bg-panel p-4 max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-ink mb-2">{detail.title}</h3>
            <p className="text-xs text-muted">{detail.content}</p>
            <button className="mt-3 w-full rounded bg-accent/20 text-accent text-xs py-1.5" onClick={() => setShowDetail(false)}>关闭</button>
          </div>
        </div>
      )}
    </>
  )
}

export default function MemoryLabModule() {
  // 核心状态
  const [scene, setScene] = useState('default')
  const [model, setModel] = useState(() => createDefaultModel())

  // 编辑状态
  const [scatterEditMode, setScatterEditMode] = useState(false)
  const [manualScatterText, setManualScatterText] = useState('')

  // scatter 文本：非编辑模式时自动生成
  const generatedScatterText = useMemo(() => generateScatter(model), [model])
  const scatterText = scatterEditMode ? manualScatterText : generatedScatterText

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

  // 左右联动高亮：点击左侧 region/section → 右侧对应区域高亮
  const [hlRegion, setHlRegion] = useState(null)   // 当前高亮的 region name
  const [hlItem, setHlItem] = useState(null)       // 当前高亮的 section item id

  // 场景切换
  const switchScene = (sceneId) => {
    const sceneObj = SCENES.find((s) => s.id === sceneId)
    if (!sceneObj) return
    setScene(sceneId)
    setModel(sceneObj.modelFn())
    setManualScatterText('')
    setScatterEditMode(false)
    setBootStep(-1)
  }

  // 派生状态
  const regions = [...model.regions].sort((a, b) => a.base - b.base)
  const errors = useMemo(() => validateModel(model), [model])
  const hitSet = useMemo(() => new Set(selectSections(filter).map((s) => s.name)), [filter])
  const atSnippets = useMemo(() => atSnippet(addr), [addr])

  // scatter 文本变更 → 尝试解析（根据当前语法调用对应解析器）
  const applyScatterText = () => {
    const parser = syntaxTab === 'ld' ? parseLd : syntaxTab === 'icf' ? parseIcf : parseScatter
    const result = parser(manualScatterText)
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
  const [newItemAttrsInline, setNewItemAttrsInline] = useState([])

  const SECTION_ATTRS = [
    { id: '+RO', label: '+RO', desc: '只读' },
    { id: '+RW', label: '+RW', desc: '读写' },
    { id: '+ZI', label: '+ZI', desc: '零初始化' },
    { id: 'RESET', label: 'RESET', desc: '复位向量' },
    { id: '+First', label: '+First', desc: '放在最前' },
  ]

  const startAddSection = (regionName) => {
    setAddingInSection(regionName)
    setNewItemLabelInline('')
    setNewItemSizeInline('0x1000')
    setNewItemAttrsInline([])
  }

  const toggleSectionAttr = (attr) => {
    setNewItemAttrsInline((prev) =>
      prev.includes(attr) ? prev.filter((a) => a !== attr) : [...prev, attr]
    )
  }

  const confirmAddSection = (regionName) => {
    if (newItemLabelInline) {
      const attrStr = newItemAttrsInline.length > 0 ? ` (${newItemAttrsInline.join(', ')})` : ''
      setModel(addItem(model, { label: newItemLabelInline + attrStr, region: regionName, size: parseInt(newItemSizeInline, 16) || 0x1000 }))
    }
    setAddingInSection(null)
  }

  const [addingRegion, setAddingRegion] = useState(false)
  const [newRegionNameInline, setNewRegionNameInline] = useState('')
  const [newRegionBaseInline, setNewRegionBaseInline] = useState('0x20000000')
  const [newRegionSizeInline, setNewRegionSizeInline] = useState('0x10000')
  const [newRegionAttrsInline, setNewRegionAttrsInline] = useState({ fixed: false, uninit: false })

  const REGION_ATTRS = [
    { id: 'fixed', label: 'FIXED', desc: '固定绝对地址，不随链接器调整' },
    { id: 'uninit', label: 'UNINIT', desc: '不初始化（保留掉电前内容）' },
    { id: 'block', label: 'BLOCK', desc: '限制 region 最大大小' },
    { id: 'pi', label: 'PI', desc: '位置无关代码（Load Region 用）' },
    { id: 'overlay', label: 'OVERLAY', desc: '多加载区共享地址空间' },
  ]

  const startAddRegion = () => {
    setAddingRegion(true)
    setNewRegionNameInline('')
    setNewRegionBaseInline('0x20000000')
    setNewRegionSizeInline('0x10000')
    setNewRegionAttrsInline({ fixed: false, uninit: false })
  }

  const toggleRegionAttr = (attr) => {
    setNewRegionAttrsInline((prev) => ({ ...prev, [attr]: !prev[attr] }))
  }

  const confirmAddRegion = () => {
    if (newRegionNameInline) {
      setModel(addRegion(model, {
        name: newRegionNameInline,
        base: parseInt(newRegionBaseInline, 16),
        maxSize: parseInt(newRegionSizeInline, 16),
        attrs: newRegionAttrsInline,
      }))
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
                className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                  hlRegion === region.name
                    ? 'bg-accent/10 border-l-2 border-l-accent'
                    : 'hover:bg-panel-2 border-l-2 border-l-transparent'
                }`}
                onClick={() => { toggleRegion(region.name); setHlRegion(hlRegion === region.name ? null : region.name); setHlItem(null) }}
                onDragOver={(e) => handleDragOver(e, region.name)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(region.name)}
              >
                <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                <span className="flex-1 font-mono text-sm font-semibold text-ink">{region.name}</span>
                <span className="text-xs text-muted">{fmtSize(region.maxSize)}</span>
                {region.attrs.fixed && <span className="text-[10px] px-1 rounded border border-warn/40 bg-warn/10 text-warn">FIXED</span>}
                {region.attrs.uninit && <span className="text-[10px] px-1 rounded border border-accent-2/40 bg-accent-2/10 text-accent-2">UNINIT</span>}
                {region.attrs.block && <span className="text-[10px] px-1 rounded border border-amber-400/40 bg-amber-400/10 text-amber-400">BLOCK</span>}
                {region.attrs.pi && <span className="text-[10px] px-1 rounded border border-emerald-400/40 bg-emerald-400/10 text-emerald-400">PI</span>}
                {region.attrs.overlay && <span className="text-[10px] px-1 rounded border border-emerald-400/40 bg-emerald-400/10 text-emerald-400">OVERLAY</span>}
                {region.attrs.unionWith && <span className="text-[10px] px-1 rounded border border-purple-400/40 bg-purple-400/10 text-purple-300">UNION {region.attrs.unionWith}</span>}
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
                      className={`group flex items-center gap-2 pl-8 pr-3 py-1.5 cursor-move transition-colors ${
                        hlItem === item.id
                          ? 'bg-accent/10 border-l-2 border-l-accent'
                          : 'hover:bg-panel-2 border-l-2 border-l-transparent'
                      }`}
                      onClick={() => { setHlItem(hlItem === item.id ? null : item.id); setHlRegion(region.name) }}
                    >
                      <span className="text-xs text-muted">├</span>
                      <span className="flex-1 font-mono text-xs text-ink truncate">{item.label}</span>
                      <span className="text-xs text-muted">{fmtKB(item.size)}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setModel(removeItem(model, item.id)) }}
                        className="opacity-0 group-hover:opacity-100 text-danger hover:text-danger/80 transition-opacity"
                        title="删除 Section"
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  {/* 行内添加 Section */}
                  {addingInSection === region.name ? (
                    <div className="pl-8 pr-3 py-2 bg-panel-2">
                      {/* 第一行：输入框 + 确认 */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <TextInput
                          value={newItemLabelInline}
                          onChange={(e) => setNewItemLabelInline(e.target.value)}
                          placeholder="section 标签（如 .text, .data）"
                          className="flex-1 min-w-[80px] text-xs"
                          autoFocus
                        />
                        <TextInput
                          value={newItemSizeInline}
                          onChange={(e) => setNewItemSizeInline(e.target.value)}
                          placeholder="大小"
                          className="w-1/4 min-w-[60px] text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => confirmAddSection(region.name)}
                          disabled={!newItemLabelInline}
                          className="flex items-center justify-center w-7 h-7 shrink-0 rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="确认添加"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddingInSection(null)}
                          className="flex items-center justify-center w-7 h-7 shrink-0 rounded border border-line text-muted hover:text-ink transition-colors"
                          title="取消"
                        >
                          ×
                        </button>
                      </div>
                      {/* 第二行：属性选择（带详细说明弹层） */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted">属性:</span>
                        {SECTION_ATTRS.map((attr) => (
                          <SectionAttrButton
                            key={attr.id}
                            attr={attr}
                            selected={newItemAttrsInline.includes(attr.id)}
                            onClick={() => toggleSectionAttr(attr.id)}
                          />
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
            {/* 属性选择（带详细说明弹层） */}
            <div className="flex flex-wrap gap-2">
              <span className="text-[10px] text-muted">属性:</span>
              {REGION_ATTRS.map((attr) => (
                <RegionAttrButton
                  key={attr.id}
                  attr={attr}
                  selected={newRegionAttrsInline[attr.id]}
                  onClick={() => toggleRegionAttr(attr.id)}
                />
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

      {/* Scatter 交互式查看器（联动高亮 + 语法切换） */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>scatter 文件</SectionLabel>
          <div className="flex items-center gap-2">
            <Segmented
              options={[
                { id: 'sct', label: 'Keil (.sct)' },
                { id: 'ld', label: 'GCC (.ld)' },
                { id: 'icf', label: 'IAR (.icf)' },
              ]}
              value={syntaxTab}
              onChange={setSyntaxTab}
            />
            <Button variant="ghost" onClick={() => setScatterEditMode(!scatterEditMode)}>
              {scatterEditMode ? '预览' : '编辑'}
            </Button>
          </div>
        </div>
        {scatterEditMode ? (
          <div>
            <textarea
              value={scatterText}
              onChange={(e) => setManualScatterText(e.target.value)}
              className="w-full rounded border border-line bg-code p-2 font-mono text-xs text-ink"
              rows={12}
              spellCheck={false}
            />
            <div className="mt-2 flex gap-2">
              <Button variant="primary" onClick={applyScatterText}>应用</Button>
              <Button variant="ghost" onClick={() => setScatterEditMode(false)}>重置</Button>
            </div>
          </div>
        ) : syntaxTab === 'sct' ? (
          <div className="rounded-lg border border-line bg-code p-3 font-mono text-xs space-y-3">
            {/* Load Region 级别 */}
            {(() => {
              const lrGroups = {}
              for (const region of regions) {
                const lr = region.loadRegion || 'LR_DEFAULT'
                if (!lrGroups[lr]) lrGroups[lr] = []
                lrGroups[lr].push(region)
              }
              return Object.entries(lrGroups).sort((a, b) => a[0].localeCompare(b[0])).map(([lrName, lrRegions]) => {
                const lr = (model.loadRegions || []).find((l) => l.name === lrName)
                return (
                  <div key={lrName} className="space-y-1">
                    <div className="text-ink/60">{lrName} {lr ? hex(lr.base) + ' ' + hex(lr.maxSize) : ''} {'{'}</div>
                    {lrRegions.map((region) => {
                      const isHl = hlRegion === region.name
                      const regionItems = model.items.filter((i) => i.region === region.name)
                      // UNION 高亮：如果 region 有 unionWith 属性，用特殊颜色
                      const isUnion = !!region.attrs.unionWith || regions.some(r => r.attrs.unionWith === region.name)
                      return (
                        <div key={region.name}>
                          <div
                            className={`cursor-pointer rounded px-2 py-1 transition-colors ${
                              isHl ? 'bg-accent/20 text-accent' :
                              isUnion ? 'bg-purple-500/10 text-purple-300 hover:bg-purple-500/20' :
                              'text-ink hover:bg-panel-2'
                            }`}
                            onClick={() => { setHlRegion(isHl ? null : region.name); setHlItem(null) }}
                          >
                            {'  '}{region.name} {hex(region.base)}
                            {region.attrs.fixed ? ` FIXED ${hex(region.maxSize)}` : ` ${hex(region.maxSize)}`}
                            {region.attrs.uninit ? ' UNINIT' : ''}
                            {region.attrs.block ? ` BLOCK(${hex(region.maxSize)})` : ''}
                            {region.attrs.pi ? ' PI' : ''}
                            {region.attrs.overlay ? ' OVERLAY' : ''}
                            {region.attrs.unionWith ? ` UNION ${region.attrs.unionWith}` : ''}
                            {' {'}
                            <span className="text-ink/40">  ; {region.note || region.kind}</span>
                          </div>
                          {regionItems.map((item) => {
                            const itemHl = hlItem === item.id
                            return (
                              <div
                                key={item.id}
                                className={`cursor-pointer rounded px-2 py-0.5 transition-colors ${itemHl ? 'bg-accent/20 text-accent' : isUnion ? 'text-purple-200/80 hover:bg-purple-500/10' : 'text-ink/80 hover:bg-panel-2'}`}
                                style={{ paddingLeft: '2.5rem' }}
                                onClick={() => { setHlItem(itemHl ? null : item.id); setHlRegion(region.name) }}
                              >
                                {item.label.includes('.o') ? '    ' : '   '}{item.label}
                              </div>
                            )
                          })}
                          <div className="text-ink/60">{'  }'}</div>
                        </div>
                      )
                    })}
                    <div className="text-ink/60">{'}'}</div>
                  </div>
                )
              })
            })()}
          </div>
        ) : (
          <CodeBlock
            title={syntaxTab === 'ld' ? 'GCC 链接脚本 (.ld)' : 'IAR 配置 (.icf)'}
            code={syntaxTab === 'ld' ? generateLd(model) : generateIcf(model)}
          />
        )}
      </div>

      {/* Region 占用详情（联动高亮） */}
      <div>
        <SectionLabel className="mb-2">Region 占用详情</SectionLabel>
        <div className="space-y-2">
          {regions.map((region) => {
            const layout = regionLayout(model, region.name)
            const overflow = overflowDetail(model, region.name)
            const isHl = hlRegion === region.name
            return (
              <div
                key={region.name}
                className={`rounded border bg-panel p-3 cursor-pointer transition-all ${isHl ? 'border-accent ring-1 ring-accent/30' : 'border-line'}`}
                onClick={() => { setHlRegion(isHl ? null : region.name); setHlItem(null) }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold text-ink">{region.name}</span>
                  <span className={`text-xs ${layout.overflow ? 'text-danger' : 'text-muted'}`}>
                    {fmtSize(layout.used)} / {fmtSize(layout.limit)}
                  </span>
                </div>
                {/* 偏移可视化条 */}
                <div className="relative h-6 overflow-hidden rounded bg-panel-2">
                  {layout.items.map((item, i) => {
                    const itemHl = hlItem === item.id
                    return (
                      <div
                        key={item.id}
                        className={`absolute top-0 h-full border-r border-bg/50 transition-all ${itemHl ? 'z-10 ring-2 ring-accent' : ''}`}
                        style={{
                          left: `${(item.offset / layout.limit) * 100}%`,
                          width: `${(item.size / layout.limit) * 100}%`,
                          background: itemHl ? '#818cf8' : (i % 2 === 0 ? '#3b82f6' : '#6366f1'),
                          opacity: hlItem && !itemHl ? 0.3 : 1,
                        }}
                        title={`${item.label} @ ${hex(item.offset)} (${fmtSize(item.size)})`}
                        onClick={(e) => { e.stopPropagation(); setHlItem(itemHl ? null : item.id); setHlRegion(region.name) }}
                      />
                    )
                  })}
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
      <CodeBlock
        title={LINKER_SYNTAX[syntaxTab].label}
        code={
          syntaxTab === 'sct'
            ? scatterText
            : syntaxTab === 'ld'
            ? generateLd(model)
            : generateIcf(model)
        }
      />
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
