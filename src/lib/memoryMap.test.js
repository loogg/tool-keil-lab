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
})
