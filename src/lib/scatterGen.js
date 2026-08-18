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
        } else if (item.label.startsWith('.')) {
          lines.push(`    *(${item.label}*)`)
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
        } else if (item.label.startsWith('.')) {
          placements.push(`section ${item.label}*`)
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

// 按内容猜测链接脚本类型：'sct' | 'ld' | 'icf'
// 编辑框应用时兜底用：即使语法页签没切对，也能选到正确的解析器
export function detectLinkerSyntax(text) {
  if (/^\s*define\s+(memory|region)\b/m.test(text)) return 'icf'
  if (/^\s*MEMORY\b/m.test(text) || /^\s*SECTIONS\b/m.test(text) || /ORIGIN\s*=/.test(text)) return 'ld'
  return 'sct'
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
      // Region 行：ER_IROM1 0x08000000 0x000C0000 { 或 ER_RODATA 0x080C0000 FIXED 0x00010000 {
      // 如果已有 currentLR，尝试匹配 Region（无论是否有 FIXED/BLOCK）
      const regionMatch = line.match(/^(\w+)\s+(0x[0-9a-fA-F]+)\s+(FIXED\s+|BLOCK\()?(\s*0x[0-9a-fA-F]+\)?)(\s+UNINIT)?(\s+PI)?(\s+OVERLAY)?(\s+UNION\s+\w+)?\s*\{/)
      if (regionMatch && currentLR && !currentRegion) {
        // 区分 LR 和 Region：如果名字以 LR_ 开头或是第一个顶层块，可能是 LR
        // 否则视为 Region
        const isLikelyLR = line.startsWith('LR_') || loadRegions.length === 0
        if (!isLikelyLR || currentLR) {
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
            maxSize: parseInt(regionMatch[4].replace(/[^0-9a-fA-F]/g, ''), 16) || 0x10000,
            attrs,
            kind: 'ram',
            note: '',
            loadRegion: currentLR.name,
            unionWith: unionMatch ? unionMatch[1] : null,
          }
          regions.push(currentRegion)
          continue
        }
      }

      // LR 行：LR_IROM1 0x08000000 0x00100000 {
      // 只有在没有 currentRegion 时才匹配 LR（避免 Region 被误判）
      const lrMatch = line.match(/^(\w+)\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)\s*\{/)
      if (lrMatch && !currentRegion) {
        currentLR = { name: lrMatch[1], base: parseInt(lrMatch[2], 16), maxSize: parseInt(lrMatch[3], 16) }
        loadRegions.push(currentLR)
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

    if (loadRegions.length === 0 && regions.length === 0) {
      return { error: '未识别到加载区/执行区，请确认内容为 Keil scatter（.sct）语法' }
    }
    return { loadRegions, regions, items }
  } catch (e) {
    return { error: e.message }
  }
}

// ld 数值：0x 十六进制 / 十进制 / K、M 后缀；符号等无法求值时返回 null
function parseLdSize(value) {
  if (/^0x[0-9a-fA-F]+$/i.test(value)) return parseInt(value, 16)
  const m = value.match(/^(\d+)([KkMm])?$/)
  if (m) {
    const n = parseInt(m[1], 10)
    const unit = (m[2] || '').toLowerCase()
    if (unit === 'k') return n * 1024
    if (unit === 'm') return n * 1024 * 1024
    return n
  }
  return null
}

// 解析 GCC ld 语法
// 一个输出 section（.text/.data/... 块）映射为一个 item，挂在 "> REGION" 指定的 MEMORY 区域下
export function parseLd(text) {
  try {
    // 去掉 /* */ 与 // 注释，避免行尾注释干扰匹配
    const cleaned = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const lines = cleaned.split('\n')

    const regions = []
    const items = []
    let inMemory = false
    let inSections = false
    let depth = 0            // SECTIONS 块内的花括号深度
    let sectionName = null   // 正在解析的输出 section 名（不含开头的点）
    let sectionAttrs = ''    // NOLOAD / COPY 等类型标记
    let itemId = 0

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue

      // ---- MEMORY 块 ----
      if (!inSections && /^MEMORY\b/.test(line)) {
        inMemory = true
        continue
      }
      if (inMemory) {
        if (line.startsWith('}')) {
          inMemory = false
          continue
        }
        // 条目：NAME (rx) : ORIGIN = 0x80000000, LENGTH = 256K
        // 值支持十六进制 / 十进制 / K、M 后缀 / 符号（符号无法求值，走默认大小）
        const memMatch = line.match(/^([\w$]+)\s*(\(([^)]*)\))?\s*:\s*ORIGIN\s*=\s*([\w$]+)\s*,\s*LENGTH\s*=\s*([\w$]+)/i)
        if (memMatch) {
          const memAttrs = memMatch[3] || ''
          const size = parseLdSize(memMatch[5])
          regions.push({
            name: memMatch[1],
            base: parseLdSize(memMatch[4]) ?? 0,
            maxSize: size ?? 0x10000,
            attrs: { fixed: false, uninit: false },
            kind: memAttrs.includes('w') ? 'ram' : 'flash',
            note: size === null ? `LENGTH=${memMatch[5]}（符号，使用默认大小）` : '',
            loadRegion: 'LR_DEFAULT',
          })
        }
        continue
      }

      // ---- SECTIONS 块 ----
      if (!inSections && /^SECTIONS\b/.test(line)) {
        inSections = true
        depth = 0
      }
      if (!inSections) continue

      // SECTIONS 块内深度 1 处识别输出 section 头部行，兼容：
      //   .text : {                       （最简写法）
      //   .text ADDR : {                  （带地址表达式）
      //   .data : AT(LMA) {               （指定 LMA）
      //   .bss (NOLOAD) : {               （类型标记）
      //   .eh_frame :（{ 在下一行）
      if (depth === 1 && sectionName === null) {
        const hdr = line.match(/^\.([\w$./]+)\s*(\((?:NOLOAD|COPY|INFO|OVERLAY|DSECT)\))?/)
        if (hdr && line.includes(':')) {
          sectionName = hdr[1]
          sectionAttrs = hdr[2] ? hdr[2].replace(/[()]/g, '') : ''
        }
      }

      // 统计本行花括号，跟踪 section 体的进出
      let closedHere = false
      for (const ch of line) {
        if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          closedHere = true
        }
      }

      // section 体结束：} > REGION（或 } > VMA AT > LMA，取 VMA）
      if (closedHere && depth <= 1 && sectionName !== null) {
        depth = Math.max(depth, 1) // 仍处在 SECTIONS 块内
        const endMatch = line.match(/\}\s*>\s*([\w$]+)/)
        let region = null
        if (endMatch) {
          region = regions.find((r) => r.name === endMatch[1])
          if (!region) {
            region = {
              name: endMatch[1],
              base: 0,
              maxSize: 0x10000,
              attrs: { fixed: false, uninit: false },
              kind: 'ram',
              note: '未在 MEMORY 中定义，使用默认值',
              loadRegion: 'LR_DEFAULT',
            }
            regions.push(region)
          }
        }
        if (region) {
          items.push({
            id: `parsed_${itemId++}`,
            label: `.${sectionName}`,
            detail: sectionAttrs ? `解析自 ld（${sectionAttrs}）` : '解析自 ld',
            region: region.name,
            size: 0x1000,
            custom: true,
          })
        }
        sectionName = null
        sectionAttrs = ''
      }
    }

    if (regions.length === 0) {
      return { error: '未识别到 MEMORY 区域，请确认内容为 GCC 链接脚本（.ld）' }
    }

    // 加载区：覆盖全部 region 的地址范围
    const minBase = Math.min(...regions.map((r) => r.base))
    const maxEnd = Math.max(...regions.map((r) => r.base + r.maxSize))
    const loadRegions = [{
      name: 'LR_DEFAULT',
      base: minBase,
      maxSize: Math.max(maxEnd - minBase, 1),
      note: '默认加载区',
    }]

    return { loadRegions, regions, items }
  } catch (e) {
    return { error: e.message }
  }
}

// 解析 IAR icf 语法
export function parseIcf(text) {
  try {
    const lines = text.split('\n')
    const regions = []
    const items = []
    const loadRegions = [{ name: 'LR_DEFAULT', base: 0, maxSize: 0xFFFFFFFF, note: '默认加载区' }]
    let itemId = 0

    // 第一遍：解析 define region
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || !trimmed) continue

      // define region ER_IROM1 = mem:[from 0x08000000 size 0xC0000];
      const regionMatch = trimmed.match(/define\s+region\s+(\w+)\s*=\s*mem:\[from\s+(0x[0-9a-fA-F]+)\s+size\s+(0x[0-9a-fA-F]+)\]/)
      if (regionMatch) {
        regions.push({
          name: regionMatch[1],
          base: parseInt(regionMatch[2], 16),
          maxSize: parseInt(regionMatch[3], 16),
          attrs: { fixed: false, uninit: false },
          kind: 'ram',
          note: '',
          loadRegion: 'LR_DEFAULT',
        })
      }
    }

    // 第二遍：解析 place in
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || !trimmed) continue

      // place in ER_IROM1 { readonly };
      const placeMatch = trimmed.match(/place\s+in\s+(\w+)\s*\{([^}]*)\}/)
      if (placeMatch) {
        const regionName = placeMatch[1]
        const placements = placeMatch[2].split(',').map(s => s.trim())

        const region = regions.find(r => r.name === regionName)
        if (region) {
          for (const placement of placements) {
            if (placement === 'readonly' || placement === 'readwrite' || placement === 'block ZI' || placement === 'vector') {
              items.push({
                id: `parsed_${itemId++}`,
                label: placement === 'readonly' ? '.ANY (+RO)' : placement === 'readwrite' ? '.ANY (+RW)' : placement === 'block ZI' ? '.ANY (+ZI)' : '*.o (RESET, +First)',
                detail: '解析自 icf',
                region: regionName,
                size: 0x1000,
                custom: true,
              })
            } else if (placement.startsWith('section')) {
              const sectionName = placement.replace('section', '').trim()
              items.push({
                id: `parsed_${itemId++}`,
                label: sectionName.includes('*') ? sectionName : `* (${sectionName})`,
                detail: '解析自 icf',
                region: regionName,
                size: 0x1000,
                custom: true,
              })
            }
          }
        }
      }

      // do not initialize { section .bss.sdram.noinit };
      const noInitMatch = trimmed.match(/do\s+not\s+initialize\s*\{\s*section\s+([^}]+)\}/)
      if (noInitMatch) {
        const sectionName = noInitMatch[1].trim()
        // 找到包含该 section 的 region 并标记 UNINIT
        for (const region of regions) {
          const regionItems = items.filter(i => i.region === region.name)
          if (regionItems.some(i => i.label.includes(sectionName.replace('.bss.', '').replace('*', '')))) {
            region.attrs.uninit = true
          }
        }
      }
    }

    if (regions.length === 0) {
      return { error: '未识别到 define region，请确认内容为 IAR 配置（.icf）语法' }
    }
    return { loadRegions, regions, items }
  } catch (e) {
    return { error: e.message }
  }
}

export { HEX as formatHex }
