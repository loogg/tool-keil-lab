// scatter 文件生成器与解析器（双向）
// 支持 UNION、多 LR、FIXED/UNINIT 属性

const HEX = (n, width = 8) => `0x${n.toString(16).toUpperCase().padStart(width, '0')}`

// item → scatter 行映射（保留原有缩进风格）
const ITEM_LINES = {
  reset: ['   *.o (RESET, +First)'],
  inroot: ['   *(InRoot$$Sections)'],
  anyro: ['   .ANY (+RO)'],
  webfs: ['    webserver_packedfs.o (.rodata.*)'],
  mongoose: ['    mongoose.o (+RO)'],
  op0715: ['    op0715_*.o (+RO)'],
  anyrw: ['   .ANY (+RW +ZI)'],
  ccram: ['    * (.bss.ccram)', '    * (.ccram)'],
  memp: ['    memp.o (+RW +ZI)'],
  sdram: ['    * (.bss.sdram.noinit)'],
}

// 自定义 item 的默认行模板
function customItemLines(item) {
  // 尝试从 label 推断 scatter 语法
  if (item.label.includes('.ANY')) return [`   ${item.label}`]
  if (item.label.startsWith('*')) return [`   ${item.label}`]
  if (item.label.includes('.o')) return [`    ${item.label}`]
  return [`    ${item.label}`]
}

// 生成 GCC 链接脚本 (.ld)
export function generateLd(model) {
  const lines = []
  const regions = [...model.regions].sort((a, b) => a.base - b.base)

  // MEMORY 块
  lines.push('MEMORY')
  lines.push('{')
  for (const region of regions) {
    // 权限位：flash = rx, ram = rwx
    const perm = region.kind === 'flash' ? 'rx' : 'rwx'
    const lenHex = `0x${region.maxSize.toString(16).toUpperCase()}`
    lines.push(`  ${region.name} (${perm}) : ORIGIN = ${HEX(region.base)}, LENGTH = ${lenHex}`)
  }
  lines.push('}')
  lines.push('')

  // SECTIONS 块
  lines.push('SECTIONS')
  lines.push('{')

  const lrGroups = {}
  for (const region of regions) {
    const lr = region.loadRegion || 'LR_DEFAULT'
    if (!lrGroups[lr]) lrGroups[lr] = []
    lrGroups[lr].push(region)
  }

  for (const [, lrRegions] of Object.entries(lrGroups)) {
    for (const region of lrRegions) {
      const items = model.items.filter((i) => i.region === region.name)
      if (items.length === 0) continue

      // 简化映射：section 名 → ld 段名
      const sectionName = region.name.toLowerCase().replace(/^(er_|rw_)/, '.')
      lines.push(`  ${sectionName} : {`)
      for (const item of items) {
        // 尝试从 label 推断 ld 语法
        if (item.label.includes('RESET')) {
          lines.push('    KEEP(*(.isr_vector))')
        } else if (item.label.includes('.ANY')) {
          if (item.label.includes('+RO')) lines.push('    *(.text*) *(.rodata*)')
          if (item.label.includes('+RW')) lines.push('    *(.data*)')
          if (item.label.includes('+ZI')) lines.push('    *(.bss*) *(COMMON)')
        } else if (item.label.includes('.o')) {
          // 提取 .o 文件名
          const match = item.label.match(/([\w.]+)\.o/)
          if (match) {
            const name = match[1].replace(/\*/g, '*')
            lines.push(`    KEEP(*(.text.${name}*))`)
          }
        } else if (item.label.startsWith('*')) {
          lines.push(`    ${item.label}`)
        } else {
          lines.push(`    *(.${item.label})`)
        }
      }
      lines.push(`  } > ${region.name}`)
      lines.push('')
    }
  }

  lines.push('}')
  return lines.join('\n')
}

// 生成 IAR 配置文件 (.icf)
export function generateIcf(model) {
  const lines = []
  const regions = [...model.regions].sort((a, b) => a.base - b.base)

  // define memory
  lines.push('define memory mem with size = 4G;')
  lines.push('')

  // define region
  for (const region of regions) {
    const sizeHex = `0x${region.maxSize.toString(16).toUpperCase()}`
    const attrs = []
    if (region.attrs.fixed) attrs.push('FIXED')
    if (region.attrs.uninit) attrs.push('UNINIT')
    const attrStr = attrs.length > 0 ? ` // ${attrs.join(', ')}` : ''
    lines.push(`define region ${region.name} = mem:[from ${HEX(region.base)} size ${sizeHex}];${attrStr}`)
  }
  lines.push('')

  // place in
  for (const region of regions) {
    const items = model.items.filter((i) => i.region === region.name)
    if (items.length === 0) {
      // 空 region 默认放置
      if (region.kind === 'flash') {
        lines.push(`place in ${region.name} { readonly };`)
      } else {
        lines.push(`place in ${region.name} { readwrite };`)
      }
    } else {
      const placements = []
      for (const item of items) {
        if (item.label.includes('RESET')) {
          placements.push('vector')
        } else if (item.label.includes('.ANY')) {
          if (item.label.includes('+RO')) placements.push('readonly')
          if (item.label.includes('+RW')) placements.push('readwrite')
          if (item.label.includes('+ZI')) placements.push('block ZI')
        } else if (item.label.includes('.o')) {
          // 提取 .o 文件名
          const match = item.label.match(/([\w.]+)\.o/)
          if (match) {
            placements.push(`section .text.${match[1]}*`)
          }
        } else if (item.label.startsWith('*')) {
          placements.push(`section ${item.label.replace('*', '').trim()}`)
        } else {
          placements.push(`section .${item.label}`)
        }
      }
      lines.push(`place in ${region.name} { ${placements.join(', ')} };`)
    }
  }

  // initialize / do not initialize
  const uninitRegions = regions.filter((r) => r.attrs.uninit)
  if (uninitRegions.length > 0) {
    lines.push('')
    for (const region of uninitRegions) {
      lines.push(`do not initialize { section .bss.${region.name.toLowerCase()}* };`)
    }
  }

  return lines.join('\n')
}

// 生成 scatter 文本（支持多 LR、UNION）
export function generateScatter(model) {
  const linesIn = (regionName) => model.items
    .filter((i) => i.region === regionName)
    .flatMap((i) => ITEM_LINES[i.id] ?? customItemLines(i))

  const lines = []
  const lrGroups = {} // lrName → [regions]

  // 按 loadRegion 分组
  for (const region of model.regions) {
    const lr = region.loadRegion || (model.loadRegions?.[0]?.name) || 'LR_DEFAULT'
    if (!lrGroups[lr]) lrGroups[lr] = []
    lrGroups[lr].push(region)
  }

  // 按 loadRegion base 排序
  const sortedLRs = Object.entries(lrGroups).sort(
    ([, ra], [, rb]) => ra[0].base - rb[0].base
  )

  for (const [lrName, regions] of sortedLRs) {
    const lr = (model.loadRegions || []).find((l) => l.name === lrName)
    const lrBase = lr?.base ?? regions[0].base
    const lrSize = lr?.maxSize ?? regions.reduce((s, r) => Math.max(s, r.base + r.maxSize - lrBase), 0)

    lines.push(`${lrName} ${HEX(lrBase)} ${HEX(lrSize)}  {    ; load region`)

    for (const region of regions) {
      const attrs = []
      if (region.attrs.fixed) attrs.push(`FIXED ${HEX(region.maxSize)}`)
      else if (region.attrs.block) attrs.push(`BLOCK(${HEX(region.maxSize)})`)
      else attrs.push(HEX(region.maxSize))
      if (region.attrs.uninit) attrs.push('UNINIT')
      if (region.attrs.pi) attrs.push('PI')
      if (region.attrs.overlay) attrs.push('OVERLAY')
      if (region.attrs.unionWith) attrs.push(`UNION ${region.attrs.unionWith}`)

      lines.push(`  ${region.name} ${HEX(region.base)} ${attrs.join(' ')}  {  ; ${region.note || region.kind}`)
      lines.push(...linesIn(region.name))
      lines.push('  }')
      lines.push('')
    }
    lines.push('}')
    lines.push('')
  }

  return lines.join('\n').trim()
}

// 简化版 scatter 解析器（覆盖常见语法）
// 返回 model 或 { error: string }
export function parseScatter(text) {
  try {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith(';'))
    const loadRegions = []
    const regions = []
    const items = []

    let currentLR = null
    let currentRegion = null
    let itemId = 0

    for (const line of lines) {
      // LR 行：LR_IROM1 0x08000000 0x00100000 {
      const lrMatch = line.match(/^(\w+)\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)\s*\{/)
      if (lrMatch && !currentRegion) {
        currentLR = { name: lrMatch[1], base: parseInt(lrMatch[2], 16), maxSize: parseInt(lrMatch[3], 16) }
        loadRegions.push(currentLR)
        continue
      }

      // Region 行：ER_IROM1 0x08000000 0x000C0000 { 或 ER_RODATA 0x080C0000 FIXED 0x00010000 {
      const regionMatch = line.match(/^(\w+)\s+(0x[0-9a-fA-F]+)\s+(FIXED\s+|BLOCK\()?(\s*0x[0-9a-fA-F]+\)?)(\s+UNINIT)?(\s+PI)?(\s+OVERLAY)?(\s+UNION\s+\w+)?\s*\{/)
      if (regionMatch && currentLR) {
        const attrs = {
          fixed: !!line.includes('FIXED'),
          uninit: !!line.includes('UNINIT'),
          block: !!line.includes('BLOCK'),
          pi: !!line.includes(' PI'),
          overlay: !!line.includes('OVERLAY'),
        }
        const unionMatch = line.match(/UNION\s+(\w+)/)
        currentRegion = {
          name: regionMatch[1],
          base: parseInt(regionMatch[2], 16),
          maxSize: parseInt(regionMatch[3].replace(/[^0-9a-fA-F]/g, ''), 16) || 0x10000,
          attrs,
          kind: 'ram', // 默认，后续可推断
          note: '',
          loadRegion: currentLR.name,
          unionWith: unionMatch ? unionMatch[1] : null,
        }
        regions.push(currentRegion)
        continue
      }

      // Item 行（在 region 内）
      if (currentRegion && line !== '}') {
        const label = line.trim()
        // 推断 size（简化：给默认值）
        items.push({
          id: `parsed_${itemId++}`,
          label,
          detail: '解析自 scatter',
          region: currentRegion.name,
          size: 0x1000, // 默认值
          custom: true,
        })
      }

      // 结束符
      if (line === '}') {
        if (currentRegion) {
          currentRegion = null
        } else if (currentLR) {
          currentLR = null
        }
      }
    }

    return { loadRegions, regions, items }
  } catch (e) {
    return { error: e.message }
  }
}

export { HEX as formatHex }
