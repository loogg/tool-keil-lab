import { describe, it, expect } from 'vitest'
import { createDefaultModel } from './memoryMap.js'
import {
  generateScatter, generateLd, generateIcf,
  parseScatter, parseLd, parseIcf,
  detectLinkerSyntax, ldItemLines, icfItemPlacements,
} from './scatterGen.js'

// 真实 GCC 链接脚本的常见写法（参考 HPMicro SDK user_linker.ld）：
// 注释、K/k 后缀长度、符号长度、地址表达式、AT()、NOLOAD、{ 换行、ASSERT
const REAL_LD = `/*
 * Copyright (c) 2024 HPMicro
 * SPDX-License-Identifier: BSD-3-Clause
 */

ENTRY(_start)

STACK_SIZE = _stack_size;
HEAP_SIZE = _heap_size;

MEMORY
{
    XPI0 (rx) : ORIGIN = 0x80000000, LENGTH = _flash_size
    ILM (wx) : ORIGIN = 0x00000000, LENGTH = 256K
    DLM (w) : ORIGIN = 0x00080000, LENGTH = 256K
    AXI_SRAM (wx) : ORIGIN = 0x01080000, LENGTH = 512K    /* AXI SRAM0 */
    NONCACHEABLE_RAM (wx) : ORIGIN = 0x01100000, LENGTH = 256K    /* AXI SRAM1 */
    SHARE_RAM (w) : ORIGIN = 0x0117C000, LENGTH = 16K
    AHB_SRAM (w) : ORIGIN = 0xF0300000, LENGTH = 32k
    APB_SRAM (w): ORIGIN = 0xF40F0000, LENGTH = 8k
}

__nor_cfg_option_load_addr__ = ORIGIN(XPI0) + 0x400;

SECTIONS
{
    .nor_cfg_option __nor_cfg_option_load_addr__ : {
        KEEP(*(.nor_cfg_option))
    } > XPI0

    .start __app_load_addr__ : {
        . = ALIGN(8);
        KEEP(*(.start))
    } > XPI0

    .vectors ORIGIN(ILM) : AT(__vector_load_addr__) {
        . = ALIGN(8);
        KEEP(*(.vector_table))
    } > ILM

    .text (__vector_load_addr__ + SIZEOF(.vectors)) : {
        . = ALIGN(8);
        *(.text*)
        *(.rodata*)
    } > XPI0

    .eh_frame :
    {
        KEEP(*(.eh_frame))
    }  > XPI0

    PROVIDE (__etext = .);

    __data_load_addr__ = etext;
    .data : AT(__data_load_addr__) {
        . = ALIGN(8);
        *(.data*)
    } > AXI_SRAM

    .bss (NOLOAD) : {
        . = ALIGN(8);
        *(.bss*)
        *(COMMON)
    } > AXI_SRAM

    .sh_mem (NOLOAD) : {
        KEEP(*(.sh_mem))
    } > SHARE_RAM

    .heap (NOLOAD) : {
        . = ALIGN(8);
        . += HEAP_SIZE;
    } > DLM

    ASSERT(((__fw_size__ <= LENGTH(XPI0))), "XPI0 has not enough space")
}`

describe('parseLd（真实 GCC 链接脚本）', () => {
  const result = parseLd(REAL_LD)

  it('不报错，且 MEMORY 全部 region 都被识别（含 K 后缀与符号长度）', () => {
    expect(result.error).toBeUndefined()
    expect(result.regions).toHaveLength(8)

    const byName = Object.fromEntries(result.regions.map((r) => [r.name, r]))
    expect(byName.XPI0.base).toBe(0x80000000)
    expect(byName.XPI0.kind).toBe('flash') // rx，无 w
    expect(byName.ILM.maxSize).toBe(256 * 1024)
    expect(byName.ILM.kind).toBe('ram') // wx 含 w → RAM
    expect(byName.AXI_SRAM.maxSize).toBe(512 * 1024)
    expect(byName.AHB_SRAM.maxSize).toBe(32 * 1024) // 小写 k
    expect(byName.APB_SRAM.maxSize).toBe(8 * 1024) // 冒号前无空格
  })

  it('每个输出 section 是一个 item，且挂在 "> REGION" 指定的区域下', () => {
    const labels = result.items.map((i) => i.label)
    for (const name of ['.nor_cfg_option', '.start', '.vectors', '.text', '.eh_frame', '.data', '.bss', '.sh_mem', '.heap']) {
      expect(labels).toContain(name)
    }
    expect(result.items).toHaveLength(9)

    const regionOf = Object.fromEntries(result.items.map((i) => [i.label, i.region]))
    expect(regionOf['.text']).toBe('XPI0')
    expect(regionOf['.vectors']).toBe('ILM')
    expect(regionOf['.data']).toBe('AXI_SRAM')
    expect(regionOf['.bss']).toBe('AXI_SRAM')
    expect(regionOf['.sh_mem']).toBe('SHARE_RAM')
    expect(regionOf['.heap']).toBe('DLM')
    expect(regionOf['.eh_frame']).toBe('XPI0') // { 在下一行的写法
  })

  it('符号赋值 / PROVIDE / ASSERT / ALIGN 不会被当成 item', () => {
    for (const item of result.items) {
      expect(item.label).not.toMatch(/PROVIDE|ASSERT|ALIGN|=/)
      expect(item.label.startsWith('.')).toBe(true)
    }
  })

  it('所有 item 引用的 region 都存在（无悬空引用）', () => {
    const names = new Set(result.regions.map((r) => r.name))
    for (const item of result.items) {
      expect(names.has(item.region)).toBe(true)
    }
  })

  it('无法识别的内容返回 error 而不是静默空结果', () => {
    expect(parseLd('hello world').error).toBeTruthy()
    expect(parseLd('').error).toBeTruthy()
  })
})

describe('parseLd / parseScatter 往返', () => {
  it('generateLd 输出可被 parseLd 还原出相同 region', () => {
    const model = createDefaultModel()
    const parsed = parseLd(generateLd(model))
    expect(parsed.error).toBeUndefined()

    const byName = Object.fromEntries(parsed.regions.map((r) => [r.name, r]))
    for (const region of model.regions) {
      expect(byName[region.name]).toBeDefined()
      expect(byName[region.name].base).toBe(region.base)
      expect(byName[region.name].maxSize).toBe(region.maxSize)
    }
    for (const item of parsed.items) {
      expect(byName[item.region]).toBeDefined()
    }
  })

  it('generateScatter 输出仍可被 parseScatter 解析', () => {
    const parsed = parseScatter(generateScatter(createDefaultModel()))
    expect(parsed.error).toBeUndefined()
    expect(parsed.regions).toHaveLength(5)
    expect(parsed.items.length).toBeGreaterThan(0)
  })

  it('generateIcf 输出仍可被 parseIcf 解析', () => {
    const parsed = parseIcf(generateIcf(createDefaultModel()))
    expect(parsed.error).toBeUndefined()
    expect(parsed.regions.length).toBeGreaterThan(0)
  })
})

describe('解析失败时返回明确 error', () => {
  it('parseScatter 遇到无法识别的文本返回 error', () => {
    expect(parseScatter(REAL_LD).error).toBeTruthy()
    expect(parseScatter('随便一段文字').error).toBeTruthy()
  })

  it('parseIcf 遇到无法识别的文本返回 error', () => {
    expect(parseIcf('随便一段文字').error).toBeTruthy()
  })
})

describe('detectLinkerSyntax（按内容自动识别语法）', () => {
  it('识别 GCC ld / IAR icf / Keil scatter', () => {
    expect(detectLinkerSyntax(REAL_LD)).toBe('ld')
    expect(detectLinkerSyntax('define memory mem with size = 4G;\ndefine region IROM = mem:[from 0x08000000 size 768K];')).toBe('icf')
    expect(detectLinkerSyntax('LR_IROM1 0x08000000 0x00100000 {\n  ER_IROM1 0x08000000 0x000C0000 {\n  }\n}')).toBe('sct')
  })
})

describe('ld/icf item 行映射（生成器与交互视图共用）', () => {
  it('ldItemLines 按 label 类型展开', () => {
    expect(ldItemLines({ label: '*.o (RESET, +First)' })).toEqual(['KEEP(*(.isr_vector))'])
    expect(ldItemLines({ label: '.ANY (+RW +ZI)' })).toEqual(['*(.data*)', '*(.bss*) *(COMMON)'])
    expect(ldItemLines({ label: 'mongoose.o (+RO)' })).toEqual(['KEEP(*(.text.mongoose*))'])
    expect(ldItemLines({ label: '.text' })).toEqual(['*(.text*)'])
    expect(ldItemLines({ label: '* (.bss.ccram)' })).toEqual(['* (.bss.ccram)'])
  })

  it('icfItemPlacements 按 label 类型展开', () => {
    expect(icfItemPlacements({ label: '*.o (RESET, +First)' })).toEqual(['vector'])
    expect(icfItemPlacements({ label: '.ANY (+RO)' })).toEqual(['readonly'])
    expect(icfItemPlacements({ label: '.ANY (+RW +ZI)' })).toEqual(['readwrite', 'block ZI'])
    expect(icfItemPlacements({ label: '.text' })).toEqual(['section .text*'])
  })
})
