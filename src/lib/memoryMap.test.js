import { describe, it, expect } from 'vitest'
import {
  createDefaultModel, placeItem, regionUsage,
  PACKEDFS_SECTIONS, selectSections,
} from './memoryMap.js'
import { generateScatter } from './scatterGen.js'

const NOTE_SCATTER = `LR_IROM1 0x08000000 0x00100000  {    ; load region size_region
  ER_IROM1 0x08000000 0x000C0000  {  ; load address = execution address
   *.o (RESET, +First)
   *(InRoot$$Sections)
   .ANY (+RO)
  }

  ER_RODATA 0x080C0000 FIXED 0x00010000 {
    webserver_packedfs.o (.rodata.*)
  }

  RW_IRAM1 0x20000000 0x00070000  {  ; RW data
    mongoose.o (+RO)
    op0715_*.o (+RO)
   .ANY (+RW +ZI)
  }

  RW_CCRAM 0x10000000 0x10000 {
    * (.bss.ccram)
    * (.ccram)
    memp.o (+RW +ZI)
  }

  RW_SDRAM_NOINIT 0xC0000000 UNINIT 0x2000000 {
    * (.bss.sdram.noinit)
  }
}`

describe('memoryMap', () => {
  it('默认模型生成与笔记一致的 scatter 文本', () => {
    expect(generateScatter(createDefaultModel())).toBe(NOTE_SCATTER)
  })

  it('区域占用计算', () => {
    const m = createDefaultModel()
    const u = regionUsage(m, 'ER_RODATA')
    expect(u.used).toBe(0x9000)
    expect(u.limit).toBe(0x10000)
    expect(u.overflow).toBe(false)
  })

  it('移动 section 后占用实时更新', () => {
    let m = createDefaultModel()
    m = placeItem(m, 'webfs', 'RW_IRAM1')
    expect(regionUsage(m, 'ER_RODATA').used).toBe(0)
    expect(regionUsage(m, 'RW_IRAM1').used).toBe(0x21000 + 0x8000 + 0x31200 + 0x9000)
  })

  it('超容检测：mongoose.o 放入 64KB 的 CCRAM 会溢出', () => {
    let m = createDefaultModel()
    m = placeItem(m, 'mongoose', 'RW_CCRAM')
    expect(regionUsage(m, 'RW_CCRAM').overflow).toBe(true)
  })

  it('+RO 与 .rodata.* 的筛选差异', () => {
    expect(selectSections('+RO').map((s) => s.name)).toEqual([
      '.rodata.webpages', '.rodata.index', 'webfs_custom_table',
    ])
    expect(selectSections('.rodata.*').map((s) => s.name)).toEqual([
      '.rodata.webpages', '.rodata.index',
    ])
  })

  it('placeItem 不修改原模型', () => {
    const m = createDefaultModel()
    placeItem(m, 'webfs', 'RW_IRAM1')
    expect(m.items.find((i) => i.id === 'webfs').region).toBe('ER_RODATA')
  })

  // scatter 文本"行随 item 走"：行模板跟随 item 的当前 region 归属
  const block = (sc, region) => {
    const lines = sc.split('\n')
    const start = lines.findIndex((l) => l.trimStart().startsWith(region + ' '))
    const end = lines.indexOf('  }', start)
    return lines.slice(start, end).join('\n')
  }

  it('移动 webfs 到 RW_IRAM1 后，其行出现在 RW_IRAM1 块、ER_RODATA 块清空', () => {
    let m = createDefaultModel()
    m = placeItem(m, 'webfs', 'RW_IRAM1')
    const sc = generateScatter(m)
    expect(block(sc, 'RW_IRAM1')).toContain('webserver_packedfs.o (.rodata.*)')
    expect(block(sc, 'ER_RODATA')).not.toContain('webserver_packedfs.o')
    // ER_RODATA 块内没有 item 时只剩区域头与闭合括号
    const lines = sc.split('\n')
    const start = lines.findIndex((l) => l.trimStart().startsWith('ER_RODATA '))
    expect(lines[start + 1]).toBe('  }')
  })

  it('移动 mongoose 到 RW_CCRAM 后，其行出现在 RW_CCRAM 块内', () => {
    let m = createDefaultModel()
    m = placeItem(m, 'mongoose', 'RW_CCRAM')
    const sc = generateScatter(m)
    expect(block(sc, 'RW_CCRAM')).toContain('mongoose.o (+RO)')
    expect(block(sc, 'RW_IRAM1')).not.toContain('mongoose.o')
  })
})
