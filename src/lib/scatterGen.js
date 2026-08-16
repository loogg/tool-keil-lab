const HEX = (n, width) => `0x${n.toString(16).toUpperCase().padStart(width, '0')}`

// 每个 item 的固定行模板（含原有缩进；ccram 为两行）。
// 行随 item 走：item 移到哪个 region，模板就出现在哪个 region 块内。
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

export function generateScatter(model) {
  // 块内顺序 = model.items 的规范顺序（createDefaultModel 保证：
  // ER_IROM1: reset→inroot→anyro；RW_IRAM1: mongoose→op0715→anyrw；
  // RW_CCRAM: ccram(两行)→memp；ER_RODATA: webfs；RW_SDRAM_NOINIT: sdram）
  const linesIn = (regionName) => model.items
    .filter((i) => i.region === regionName)
    .flatMap((i) => ITEM_LINES[i.id] ?? [])

  const lines = []
  lines.push('LR_IROM1 0x08000000 0x00100000  {    ; load region size_region')
  lines.push('  ER_IROM1 0x08000000 0x000C0000  {  ; load address = execution address')
  lines.push(...linesIn('ER_IROM1'))
  lines.push('  }')
  lines.push('')
  lines.push('  ER_RODATA 0x080C0000 FIXED 0x00010000 {')
  lines.push(...linesIn('ER_RODATA'))
  lines.push('  }')
  lines.push('')
  lines.push('  RW_IRAM1 0x20000000 0x00070000  {  ; RW data')
  lines.push(...linesIn('RW_IRAM1'))
  lines.push('  }')
  lines.push('')
  lines.push('  RW_CCRAM 0x10000000 0x10000 {')
  lines.push(...linesIn('RW_CCRAM'))
  lines.push('  }')
  lines.push('')
  lines.push('  RW_SDRAM_NOINIT 0xC0000000 UNINIT 0x2000000 {')
  lines.push(...linesIn('RW_SDRAM_NOINIT'))
  lines.push('  }')
  lines.push('}')
  return lines.join('\n')
}

export { HEX as formatHex }
