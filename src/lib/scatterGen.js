const HEX = (n, width) => `0x${n.toString(16).toUpperCase().padStart(width, '0')}`

export function generateScatter(model) {
  const has = (region, itemId) => model.items.some((i) => i.region === region && i.id === itemId)
  const lines = []
  lines.push('LR_IROM1 0x08000000 0x00100000  {    ; load region size_region')
  lines.push('  ER_IROM1 0x08000000 0x000C0000  {  ; load address = execution address')
  if (has('ER_IROM1', 'reset')) lines.push('   *.o (RESET, +First)')
  if (has('ER_IROM1', 'inroot')) lines.push('   *(InRoot$$Sections)')
  if (has('ER_IROM1', 'anyro')) lines.push('   .ANY (+RO)')
  lines.push('  }')
  lines.push('')
  lines.push('  ER_RODATA 0x080C0000 FIXED 0x00010000 {')
  if (has('ER_RODATA', 'webfs')) lines.push('    webserver_packedfs.o (.rodata.*)')
  lines.push('  }')
  lines.push('')
  lines.push('  RW_IRAM1 0x20000000 0x00070000  {  ; RW data')
  if (has('RW_IRAM1', 'mongoose')) lines.push('    mongoose.o (+RO)')
  if (has('RW_IRAM1', 'op0715')) lines.push('    op0715_*.o (+RO)')
  if (has('RW_IRAM1', 'anyrw')) lines.push('   .ANY (+RW +ZI)')
  lines.push('  }')
  lines.push('')
  lines.push('  RW_CCRAM 0x10000000 0x10000 {')
  if (has('RW_CCRAM', 'ccram')) {
    lines.push('    * (.bss.ccram)')
    lines.push('    * (.ccram)')
  }
  if (has('RW_CCRAM', 'memp')) lines.push('    memp.o (+RW +ZI)')
  lines.push('  }')
  lines.push('')
  lines.push('  RW_SDRAM_NOINIT 0xC0000000 UNINIT 0x2000000 {')
  if (has('RW_SDRAM_NOINIT', 'sdram')) lines.push('    * (.bss.sdram.noinit)')
  lines.push('  }')
  lines.push('}')
  return lines.join('\n')
}

export { HEX as formatHex }
