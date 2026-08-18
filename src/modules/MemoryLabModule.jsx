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
import {
  generateScatter, generateLd, generateIcf,
  parseScatter, parseLd, parseIcf, detectLinkerSyntax,
  ldItemLines, icfItemPlacements,
} from '../lib/scatterGen'
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

// Region 语义属性（依据官方文档，三种链接脚本各自的写法）
// Keil: armlink User Guide「Execution region attributes」（FIXED/UNINIT 等）
// GCC:  binutils ld 手册 MEMORY / Output Section Type（NOLOAD）
// IAR:  docs.iar.com linker configuration file（define region / do not initialize）
const REGION_ATTR_DETAILS = {
  fixed: {
    title: '固定绝对地址',
    content: '将该区域钉在指定绝对地址，不随其它区域大小变化而移动。典型用途：Bootloader 向量表、Flash 参数区、寄存器映射。',
    formats: [
      ['Keil .sct', 'ER_NAME 0x08000000 FIXED 0x10000 { ... }'],
      ['GCC .ld', 'MEMORY 区本身就是绝对地址（无对应关键字，生成时以 /* FIXED */ 注释标注）'],
      ['IAR .icf', 'define region 本身即显式地址；需要钉住某个段时用 place at address mem:0x... { ... }'],
    ],
  },
  uninit: {
    title: '不初始化',
    content: '启动代码不初始化该区域，保留掉电前的内容。典型用途：帧缓存、掉电保持数据、快速启动跳过清零。',
    formats: [
      ['Keil .sct', 'RW_XXX 0xC0000000 UNINIT 0x2000000 { ... }'],
      ['GCC .ld', '输出段标记 (NOLOAD)：.xxx (NOLOAD) : { ... }'],
      ['IAR .icf', 'do not initialize { section .xxx };'],
    ],
  },
}

// Section 语义类型：左侧添加一次，sct / ld / icf 各自生成官方语法
const SECTION_KINDS = [
  { id: 'ro', label: '只读', desc: '代码 + 只读数据' },
  { id: 'rw', label: '读写', desc: '有初值数据，启动时复制到 RAM' },
  { id: 'zi', label: '零初始化', desc: '启动时清零，不占 Flash' },
  { id: 'vector', label: '向量表', desc: '放在区域开头（RESET）' },
  { id: 'raw', label: '自定义', desc: '选择器原样写入' },
]

const SECTION_KIND_DETAILS = {
  ro: {
    title: '只读（代码 + RO 数据）',
    content: '对应 .text / .rodata：指令与常量，放在 Flash。',
    formats: [
      ['Keil .sct', '通配 .ANY (+RO)；具名 * (.name)'],
      ['GCC .ld', '通配 *(.text*) *(.rodata*)；具名 *(.name*)'],
      ['IAR .icf', '通配 readonly；具名 section .name'],
    ],
  },
  rw: {
    title: '读写数据（有初值）',
    content: '对应 .data：有初值的全局/静态变量，存 Flash、启动时复制到 RAM。',
    formats: [
      ['Keil .sct', '通配 .ANY (+RW)；具名 * (.name)'],
      ['GCC .ld', '通配 *(.data*)；具名 *(.name*)'],
      ['IAR .icf', 'readwrite（配合 initialize by copy 在启动时复制）'],
    ],
  },
  zi: {
    title: '零初始化数据',
    content: '对应 .bss：零初值变量，只占 RAM、不占 Flash，启动时清零。',
    formats: [
      ['Keil .sct', '通配 .ANY (+ZI)；具名 * (.name)'],
      ['GCC .ld', '通配 *(.bss*) *(COMMON)；具名 *(.name*)'],
      ['IAR .icf', 'readwrite（官方：零初始化段不受 initialize 指令影响，启动自动清零）'],
    ],
  },
  vector: {
    title: '向量表（区域开头）',
    content: '中断向量表，必须放在区域最开头（RESET 入口在此）。',
    formats: [
      ['Keil .sct', '*.o (RESET, +First)'],
      ['GCC .ld', 'KEEP(*(.isr_vector))'],
      ['IAR .icf', 'place at start of <region> { readonly section .intvec }'],
    ],
  },
  raw: {
    title: '自定义选择器',
    content: '输入内容原样写入文件，用于模块选择器等高级写法（如 mongoose.o (+RO)）。',
    formats: [
      ['Keil .sct', '原样写入'],
      ['GCC .ld', '原样写入（或以 *(name*) 包裹）'],
      ['IAR .icf', '原样写入（或以 section name 包裹）'],
    ],
  },
}

// 三种链接脚本写法对照表（弹层内展示，依据官方文档）
function FormatTable({ formats }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-accent">三种链接脚本的官方写法:</p>
      {formats.map(([fmt, syn]) => (
        <div key={fmt}>
          <p className="text-[10px] text-muted">{fmt}</p>
          <pre className="text-[11px] text-ink bg-code rounded p-2 overflow-x-auto whitespace-pre-wrap">{syn}</pre>
        </div>
      ))}
    </div>
  )
}

// Region 语义属性按钮（带三格式写法弹层）
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
              : 'border-accent-2 bg-accent-2/20 text-accent-2'
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
            <FormatTable formats={detail.formats} />
            <button className="mt-3 w-full rounded bg-accent/20 text-accent text-xs py-1.5" onClick={() => setShowDetail(false)}>关闭</button>
          </div>
        </div>
      )}
    </>
  )
}

// Section 语义类型按钮（单选；带三格式写法弹层）
function SectionKindButton({ kind, selected, onClick }) {
  const [showDetail, setShowDetail] = useState(false)
  const detail = SECTION_KIND_DETAILS[kind.id]

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
        title={kind.desc}
      >
        {selected ? '✓ ' : ''}{kind.label}
        <span className="ml-0.5 opacity-50">ⓘ</span>
      </button>
      {showDetail && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowDetail(false)}>
          <div className="rounded-lg border border-line bg-panel p-4 max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-ink mb-2">{detail.title}</h3>
            <p className="text-xs text-muted mb-3">{detail.content}</p>
            <FormatTable formats={detail.formats} />
            <button className="mt-3 w-full rounded bg-accent/20 text-accent text-xs py-1.5" onClick={() => setShowDetail(false)}>关闭</button>
          </div>
        </div>
      )}
    </>
  )
}

// GCC .ld 交互视图：MEMORY/SECTIONS 逐行点击，与左侧树 / Region 占用联动高亮
// 行内容与 generateLd 一致（含 region 行、item 行），仅额外提供点击高亮
function LdInteractiveView({ model, regions, hlRegion, hlItem, setHlRegion, setHlItem }) {
  const clickRegion = (name) => { setHlRegion(hlRegion === name ? null : name); setHlItem(null) }
  const clickItem = (itemId, regionName) => { setHlItem(hlItem === itemId ? null : itemId); setHlRegion(regionName) }
  const regionClass = (name) =>
    `cursor-pointer rounded px-2 py-0.5 transition-colors ${
      hlRegion === name ? 'bg-accent/20 text-accent' : 'text-ink hover:bg-panel-2'
    }`

  // 与 generateLd 相同的分组与遍历顺序
  const lrGroups = {}
  for (const region of regions) {
    const lr = region.loadRegion || 'LR_DEFAULT'
    if (!lrGroups[lr]) lrGroups[lr] = []
    lrGroups[lr].push(region)
  }

  return (
    <div className="rounded-lg border border-line bg-code p-3 font-mono text-xs">
      <div className="text-ink/60">MEMORY</div>
      <div className="text-ink/60">{'{'}</div>
      {regions.map((region) => (
        <div key={region.name} className={regionClass(region.name)} onClick={() => clickRegion(region.name)}>
          {`  ${region.name} (${region.kind === 'flash' ? 'rx' : 'rwx'}) : ORIGIN = ${hex(region.base)}, LENGTH = 0x${region.maxSize.toString(16).toUpperCase()}${region.attrs.fixed ? '  /* FIXED */' : ''}`}
        </div>
      ))}
      <div className="text-ink/60">{'}'}</div>
      <div className="mt-3 text-ink/60">SECTIONS</div>
      <div className="text-ink/60">{'{'}</div>
      {Object.values(lrGroups).flatMap((lrRegions) =>
        lrRegions.map((region) => {
          const items = model.items.filter((i) => i.region === region.name)
          if (items.length === 0) return null
          const sectionName = region.name.toLowerCase().replace(/^(er_|rw_)/, '.')
          return (
            <div key={region.name} className="mt-1">
              <div className={regionClass(region.name)} onClick={() => clickRegion(region.name)}>
                {`  .${sectionName}${region.attrs.uninit ? ' (NOLOAD)' : ''} : {`}
              </div>
              {items.map((item) =>
                ldItemLines(item).map((line, li) => (
                  <div
                    key={`${item.id}-${li}`}
                    className={`cursor-pointer rounded px-2 py-0.5 transition-colors ${
                      hlItem === item.id ? 'bg-accent/20 text-accent' : 'text-ink/80 hover:bg-panel-2'
                    }`}
                    style={{ paddingLeft: '2.5rem' }}
                    onClick={() => clickItem(item.id, region.name)}
                  >
                    {line}
                  </div>
                ))
              )}
              <div className={regionClass(region.name)} onClick={() => clickRegion(region.name)}>
                {`  } > ${region.name}`}
              </div>
            </div>
          )
        })
      )}
      <div className="text-ink/60">{'}'}</div>
    </div>
  )
}

// IAR .icf 交互视图：define region / place in 行点击高亮，placement 按 section 粒度可点
function IcfInteractiveView({ model, regions, hlRegion, hlItem, setHlRegion, setHlItem }) {
  const clickRegion = (name) => { setHlRegion(hlRegion === name ? null : name); setHlItem(null) }
  const clickItem = (itemId, regionName) => { setHlItem(hlItem === itemId ? null : itemId); setHlRegion(regionName) }
  const regionClass = (name) =>
    `cursor-pointer rounded px-2 py-0.5 transition-colors ${
      hlRegion === name ? 'bg-accent/20 text-accent' : 'text-ink hover:bg-panel-2'
    }`

  const uninitRegions = regions.filter((r) => r.attrs.uninit)

  return (
    <div className="rounded-lg border border-line bg-code p-3 font-mono text-xs">
      <div className="text-ink/60">define memory mem with size = 4G;</div>
      <div className="mt-3">
        {regions.map((region) => {
          const attrs = []
          if (region.attrs.fixed) attrs.push('FIXED')
          if (region.attrs.uninit) attrs.push('UNINIT')
          const attrStr = attrs.length > 0 ? ` // ${attrs.join(', ')}` : ''
          return (
            <div key={region.name} className={regionClass(region.name)} onClick={() => clickRegion(region.name)}>
              {`define region ${region.name} = mem:[from ${hex(region.base)} size 0x${region.maxSize.toString(16).toUpperCase()}];${attrStr}`}
            </div>
          )
        })}
      </div>
      <div className="mt-3">
        {regions.map((region) => {
          const items = model.items.filter((i) => i.region === region.name)
          const vectorItems = items.filter((i) => i.kind === 'vector')
          const restItems = items.filter((i) => i.kind !== 'vector')
          const rows = []

          // 向量表：官方写法 place at start of 钉在区域开头（与 generateIcf 一致）
          for (const item of vectorItems) {
            const label = (item.label || '').trim()
            const sectionName = label && !label.includes('RESET') ? label : '.intvec'
            rows.push(
              <div
                key={`${region.name}-vector-${item.id}`}
                className={`rounded px-2 py-0.5 transition-colors ${hlRegion === region.name ? 'bg-accent/20' : 'hover:bg-panel-2'}`}
              >
                <span
                  className={`cursor-pointer ${hlRegion === region.name ? 'text-accent' : 'text-ink'}`}
                  onClick={() => clickRegion(region.name)}
                >
                  {`place at start of ${region.name} { readonly section `}
                </span>
                <span
                  className={`cursor-pointer rounded ${
                    hlItem === item.id ? 'bg-accent/20 text-accent' : 'text-ink/80 hover:text-accent'
                  }`}
                  onClick={() => clickItem(item.id, region.name)}
                >
                  {sectionName}
                </span>
                <span className={hlRegion === region.name ? 'text-accent' : 'text-ink'}>{' };'}</span>
              </div>
            )
          }

          if (restItems.length === 0 && vectorItems.length === 0) {
            rows.push(
              <div key={`${region.name}-default`} className={regionClass(region.name)} onClick={() => clickRegion(region.name)}>
                {`place in ${region.name} { ${region.kind === 'flash' ? 'readonly' : 'readwrite'} };`}
              </div>
            )
          } else if (restItems.length > 0) {
            rows.push(
              <div
                key={`${region.name}-place`}
                className={`rounded px-2 py-0.5 transition-colors ${hlRegion === region.name ? 'bg-accent/20' : 'hover:bg-panel-2'}`}
              >
                <span
                  className={`cursor-pointer ${hlRegion === region.name ? 'text-accent' : 'text-ink'}`}
                  onClick={() => clickRegion(region.name)}
                >
                  {`place in ${region.name} { `}
                </span>
                {restItems.map((item, idx) => (
                  <span key={item.id}>
                    <span
                      className={`cursor-pointer rounded ${
                        hlItem === item.id
                          ? 'bg-accent/20 text-accent'
                          : hlRegion === region.name
                          ? 'text-accent/80 hover:text-accent'
                          : 'text-ink/80 hover:text-accent'
                      }`}
                      onClick={() => clickItem(item.id, region.name)}
                    >
                      {icfItemPlacements(item).join(', ')}
                    </span>
                    {idx < restItems.length - 1 && <span className="text-ink/60">, </span>}
                  </span>
                ))}
                <span className={hlRegion === region.name ? 'text-accent' : 'text-ink'}>{' };'}</span>
              </div>
            )
          }
          return <div key={region.name}>{rows}</div>
        })}
      </div>
      {uninitRegions.length > 0 && (
        <div className="mt-3">
          {uninitRegions.map((region) => (
            <div key={region.name} className={regionClass(region.name)} onClick={() => clickRegion(region.name)}>
              {`do not initialize { section .bss.${region.name.toLowerCase()}* };`}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// 原文预览视图：应用用户粘贴的文本后，预览保留原文（注释/符号表达式原样），
// 解析出的 region/section 通过行号映射回原文行，点击与左侧树 / Region 占用联动高亮
function ManualTextView({ text, model, hlRegion, hlItem, setHlRegion, setHlItem }) {
  // lineIdx → 该行对应的解析实体（region 行 / item 行，icf 中一行可能挂多个 item）
  const lineEntries = new Map()
  const addEntry = (idx, entry) => {
    if (!Number.isInteger(idx) || idx < 0) return
    if (!lineEntries.has(idx)) lineEntries.set(idx, [])
    lineEntries.get(idx).push(entry)
  }
  for (const region of model.regions) addEntry(region.line, { type: 'region', region: region.name })
  for (const item of model.items) {
    if (Number.isInteger(item.lineStart) && Number.isInteger(item.lineEnd)) {
      for (let i = item.lineStart; i <= item.lineEnd; i++) {
        addEntry(i, { type: 'item', itemId: item.id, region: item.region })
      }
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-code p-3 font-mono text-xs">
      {text.split('\n').map((lineText, idx) => {
        const entries = lineEntries.get(idx) || []
        const regionEntry = entries.find((e) => e.type === 'region')
        const itemEntry = entries.find((e) => e.type === 'item')

        if (regionEntry) {
          const active = hlRegion === regionEntry.region
          return (
            <div
              key={idx}
              className={`cursor-pointer whitespace-pre rounded px-1 transition-colors ${
                active ? 'bg-accent/20 text-accent' : 'text-ink hover:bg-panel-2'
              }`}
              onClick={() => { setHlRegion(active ? null : regionEntry.region); setHlItem(null) }}
            >
              {lineText || ' '}
            </div>
          )
        }
        if (itemEntry) {
          const active = hlItem === itemEntry.itemId
          return (
            <div
              key={idx}
              className={`cursor-pointer whitespace-pre rounded px-1 transition-colors ${
                active ? 'bg-accent/20 text-accent' : 'text-ink/80 hover:bg-panel-2'
              }`}
              onClick={() => { setHlItem(active ? null : itemEntry.itemId); setHlRegion(itemEntry.region) }}
            >
              {lineText || ' '}
            </div>
          )
        }
        // 未参与解析的行（注释、符号赋值、PROVIDE、ASSERT 等）：原样弱化显示
        return (
          <div key={idx} className="whitespace-pre rounded px-1 text-ink/45">
            {lineText || ' '}
          </div>
        )
      })}
    </div>
  )
}

export default function MemoryLabModule() {
  // 核心状态
  const [scene, setScene] = useState('default')
  const [model, setModel] = useState(() => createDefaultModel())

  // 编辑状态
  const [scatterEditMode, setScatterEditMode] = useState(false)
  const [manualScatterText, setManualScatterText] = useState('')
  // 手动文本已被编辑/粘贴且尚未应用：为 true 时切换编辑/预览不得覆盖原文
  const [manualDirty, setManualDirty] = useState(false)
  // 原文预览模式：应用成功后预览直接展示用户粘贴的原文，解析结果映射回原文行做高亮
  const [manualApplied, setManualApplied] = useState(false)

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
    setManualDirty(false)
    setManualApplied(false)
    setScatterEditMode(false)
    setBootStep(-1)
  }

  // 派生状态
  const regions = [...model.regions].sort((a, b) => a.base - b.base)
  const errors = useMemo(() => validateModel(model), [model])
  const hitSet = useMemo(() => new Set(selectSections(filter).map((s) => s.name)), [filter])
  const atSnippets = useMemo(() => atSnippet(addr), [addr])

  // 当前语法页签对应的生成文本（编辑模式预填充 / 重置都用它）
  const currentGeneratedText = syntaxTab === 'ld'
    ? generateLd(model)
    : syntaxTab === 'icf'
    ? generateIcf(model)
    : generatedScatterText

  // 进入编辑模式：原文预览模式下保留原文；否则仅在没有未应用的手动文本时预填充（避免空白）。
  // 已粘贴/编辑过的文本在 编辑⇄预览 切换中保持原样，不会被覆盖
  const enterScatterEdit = () => {
    if (!manualDirty && !manualApplied) setManualScatterText(currentGeneratedText)
    setScatterEditMode(true)
  }

  // 用户改动模型（拖拽 / 增删 region、section / FIXED 地址）→ 退出原文预览，回到生成视图
  const changeModel = (newModel) => {
    setModel(newModel)
    setManualApplied(false)
  }

  // scatter 文本变更 → 尝试解析（按内容自动识别语法，页签没切对也能解析）
  const applyScatterText = () => {
    const syntax = detectLinkerSyntax(manualScatterText)
    const parser = syntax === 'ld' ? parseLd : syntax === 'icf' ? parseIcf : parseScatter
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
    setSyntaxTab(syntax) // 语法页签与粘贴内容保持一致
    // 保留原文：预览进入原文模式，解析出的 region/section 映射回原文行高亮
    setManualDirty(false)
    setManualApplied(true)
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

  // ---------- 实验① linker 编辑器（树形面板 + 拖拽） ----------
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
      changeModel(placeItem(model, dragItemId, regionName))
    }
    setDragItemId(null)
    setDragOverRegion(null)
  }

  const [addingInSection, setAddingInSection] = useState(null)
  const [newItemLabelInline, setNewItemLabelInline] = useState('')
  const [newItemSizeInline, setNewItemSizeInline] = useState('0x1000')
  // 语义类型（ro/rw/zi/vector/raw）：左侧添加一次，sct/ld/icf 各自生成官方语法
  const [newItemKindInline, setNewItemKindInline] = useState('ro')

  const startAddSection = (regionName) => {
    setAddingInSection(regionName)
    setNewItemLabelInline('')
    setNewItemSizeInline('0x1000')
    setNewItemKindInline('ro')
  }

  const confirmAddSection = (regionName) => {
    if (newItemKindInline === 'raw' && !newItemLabelInline.trim()) return
    changeModel(addItem(model, {
      label: newItemLabelInline.trim(),
      region: regionName,
      size: parseInt(newItemSizeInline, 16) || 0x1000,
      kind: newItemKindInline,
    }))
    setAddingInSection(null)
  }

  const [addingRegion, setAddingRegion] = useState(false)
  const [newRegionNameInline, setNewRegionNameInline] = useState('')
  const [newRegionBaseInline, setNewRegionBaseInline] = useState('0x20000000')
  const [newRegionSizeInline, setNewRegionSizeInline] = useState('0x10000')
  const [newRegionAttrsInline, setNewRegionAttrsInline] = useState({ fixed: false, uninit: false })

  // 官方 region 属性中只有 FIXED / UNINIT 在三种链接脚本里都有对应语义：
  // FIXED → sct FIXED（ld/icf 的内存区本就是绝对地址）；UNINIT → sct UNINIT / ld (NOLOAD) / icf do not initialize。
  // PI/OVERLAY 是 scatter 加载区属性、BLOCK 不是官方 region 属性，故不提供。
  const REGION_ATTRS = [
    { id: 'fixed', label: 'FIXED', desc: '固定绝对地址（sct FIXED；ld/icf 区域本就是绝对地址）' },
    { id: 'uninit', label: 'UNINIT', desc: '不初始化（sct UNINIT / ld (NOLOAD) / icf do not initialize）' },
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
      changeModel(addRegion(model, {
        name: newRegionNameInline,
        base: parseInt(newRegionBaseInline, 16),
        maxSize: parseInt(newRegionSizeInline, 16),
        attrs: newRegionAttrsInline,
      }))
      // 新 region 自动展开，方便继续添加 section
      setExpandedRegions(new Set([...expandedRegions, newRegionNameInline]))
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
                  onClick={(e) => { e.stopPropagation(); changeModel(removeRegion(model, region.name)) }}
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
                        onClick={(e) => { e.stopPropagation(); changeModel(removeItem(model, item.id)) }}
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
                          placeholder="名称（如 .ccram）；留空用该类型通配"
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
                          disabled={newItemKindInline === 'raw' && !newItemLabelInline.trim()}
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
                      {/* 第二行：语义类型（三种链接脚本各自生成官方写法，双击看对照） */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted">类型:</span>
                        {SECTION_KINDS.map((kind) => (
                          <SectionKindButton
                            key={kind.id}
                            kind={kind}
                            selected={newItemKindInline === kind.id}
                            onClick={() => setNewItemKindInline(kind.id)}
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
      {!scatterEditMode && manualApplied && manualScatterText && (
        <div className="flex items-center gap-2 rounded border border-accent-2/40 bg-accent-2/10 px-3 py-2 text-xs text-accent-2">
          <span className="flex-1">
            ⓘ 正在显示原文（识别 {model.regions.length} 个 region / {model.items.length} 个 section，点击行可联动高亮；section 大小默认 4KB，可在左侧树调整）
          </span>
          <button
            type="button"
            onClick={() => setManualApplied(false)}
            className="shrink-0 rounded border border-accent-2/40 px-2 py-0.5 transition-colors hover:bg-accent-2/20"
          >
            返回生成视图
          </button>
        </div>
      )}
      {errors.length > 0 && (
        <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
        </div>
      )}

      {/* Scatter 交互式查看器（联动高亮 + 语法切换） */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>linker 文件</SectionLabel>
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
            <Button variant="ghost" onClick={() => scatterEditMode ? setScatterEditMode(false) : enterScatterEdit()}>
              {scatterEditMode ? '预览' : '编辑'}
            </Button>
          </div>
        </div>
        {scatterEditMode ? (
          <div>
            <textarea
              value={scatterText}
              onChange={(e) => { setManualScatterText(e.target.value); setManualDirty(true) }}
              className="w-full rounded border border-line bg-code p-2 font-mono text-xs text-ink"
              rows={12}
              spellCheck={false}
            />
            <div className="mt-2 flex gap-2">
              <Button variant="primary" onClick={applyScatterText}>应用</Button>
              <Button variant="ghost" onClick={() => { setManualScatterText(currentGeneratedText); setManualDirty(false); setManualApplied(false) }} title="丢弃手动修改，恢复为当前模型的生成文本">重置</Button>
            </div>
          </div>
        ) : manualApplied && manualScatterText ? (
          <ManualTextView
            text={manualScatterText}
            model={model}
            hlRegion={hlRegion}
            hlItem={hlItem}
            setHlRegion={setHlRegion}
            setHlItem={setHlItem}
          />
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
        ) : syntaxTab === 'ld' ? (
          <LdInteractiveView
            model={model}
            regions={regions}
            hlRegion={hlRegion}
            hlItem={hlItem}
            setHlRegion={setHlRegion}
            setHlItem={setHlItem}
          />
        ) : (
          <IcfInteractiveView
            model={model}
            regions={regions}
            hlRegion={hlRegion}
            hlItem={hlItem}
            setHlRegion={setHlRegion}
            setHlItem={setHlItem}
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
              changeModel(updateRegion(model, 'ER_RODATA', { base: parsed, attrs: { ...model.regions.find(r => r.name === 'ER_RODATA')?.attrs, fixed: true } }))
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
      tagline="链接脚本决定每段代码和数据落在哪块 Flash / RAM"
      experiments={[
        { id: 'scatter', label: 'linker 编辑', control: scatterControl, canvas: scatterCanvas },
        { id: 'filter', label: '筛选器', control: filterControl, canvas: filterCanvas },
        { id: 'boot', label: '启动搬运', control: bootControl, canvas: bootCanvas },
        { id: 'symbol', label: '符号语法', control: symbolControl, canvas: symbolCanvas },
        { id: 'map', label: 'map/at()', control: <SectionLabel>map 解读与地址生成</SectionLabel>, canvas: mapCanvas },
        { id: 'bootloader', label: 'Bootloader', control: <SectionLabel>双加载区场景</SectionLabel>, canvas: blCanvas },
      ]}
    />
  )
}
