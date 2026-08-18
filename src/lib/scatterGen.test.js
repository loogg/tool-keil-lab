import { describe, it, expect } from 'vitest'
import { createDefaultModel, addItem, addRegion } from './memoryMap.js'
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

describe('解析结果的行号映射（原文预览用）', () => {
  const lines = REAL_LD.split('\n')

  it('parseLd：item 带 section 头..结束行区间，region 带 MEMORY 行号', () => {
    const r = parseLd(REAL_LD)
    const text = r.items.find((i) => i.label === '.text')
    expect(lines[text.lineStart].trim().startsWith('.text')).toBe(true)
    expect(lines[text.lineEnd].trim()).toMatch(/^\}\s*>\s*XPI0/)

    const xpi0 = r.regions.find((x) => x.name === 'XPI0')
    expect(lines[xpi0.line]).toMatch(/XPI0.*ORIGIN/)
  })

  it('多行注释被剥离后行号不错位', () => {
    // REAL_LD 开头是 5 行块注释，若剥离时丢行，所有行号都会偏移
    const r = parseLd(REAL_LD)
    const bss = r.items.find((i) => i.label === '.bss')
    expect(lines[bss.lineStart].trim().startsWith('.bss')).toBe(true)
    const vectors = r.items.find((i) => i.label === '.vectors')
    expect(lines[vectors.lineEnd].trim()).toMatch(/^\}\s*>\s*ILM/)
  })

  it('parseScatter / parseIcf：region 与 item 均带行号', () => {
    const sctSrc = generateScatter(createDefaultModel())
    const s = parseScatter(sctSrc)
    const sctLines = sctSrc.split('\n')
    expect(Number.isInteger(s.regions[0].line)).toBe(true)
    expect(sctLines[s.regions[0].line]).toContain(s.regions[0].name)
    expect(Number.isInteger(s.items[0].lineStart)).toBe(true)

    const icfSrc = generateIcf(createDefaultModel())
    const i = parseIcf(icfSrc)
    const icfLines = icfSrc.split('\n')
    expect(Number.isInteger(i.regions[0].line)).toBe(true)
    expect(icfLines[i.regions[0].line]).toContain(i.regions[0].name)
    expect(Number.isInteger(i.items[0].lineStart)).toBe(true)
    expect(icfLines[i.items[0].lineStart]).toMatch(/place\s+in/)
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
    // 官方 icf：向量用 readonly section .intvec（配合 place at start of），无独立 ZI placement
    expect(icfItemPlacements({ label: '*.o (RESET, +First)' })).toEqual(['readonly section .intvec'])
    expect(icfItemPlacements({ label: '.ANY (+RO)' })).toEqual(['readonly'])
    expect(icfItemPlacements({ label: '.ANY (+RW +ZI)' })).toEqual(['readwrite', 'readwrite'])
    expect(icfItemPlacements({ label: '.text' })).toEqual(['section .text*'])
  })
})

describe('语义 kind：左侧添加一次，三种格式各自生成官方语法', () => {
  const withItem = (template) => addItem(createDefaultModel(), template)

  it('ro 无名 → .ANY (+RO) / *(.text*) *(.rodata*) / readonly', () => {
    const m = withItem({ label: '', region: 'ER_IROM1', size: 0x100, kind: 'ro' })
    expect(generateScatter(m)).toContain('.ANY (+RO)')
    expect(generateLd(m)).toContain('*(.text*) *(.rodata*)')
    expect(generateIcf(m)).toContain('readonly')
  })

  it('zi 具名 .noinit_x → * (.noinit_x) / *(.noinit_x*) / section .noinit_x', () => {
    const m = withItem({ label: '.noinit_x', region: 'RW_IRAM1', size: 0x100, kind: 'zi' })
    expect(generateScatter(m)).toContain('* (.noinit_x)')
    expect(generateLd(m)).toContain('*(.noinit_x*)')
    expect(generateIcf(m)).toContain('section .noinit_x')
    // block ZI 不是官方 icf placement，不得出现
    expect(generateIcf(m)).not.toContain('block ZI')
  })

  it('vector → (RESET, +First) / KEEP(*(.isr_vector)) / place at start of', () => {
    const m = withItem({ label: '', region: 'ER_IROM1', size: 0x200, kind: 'vector' })
    expect(generateScatter(m)).toContain('*.o (RESET, +First)')
    expect(generateLd(m)).toContain('KEEP(*(.isr_vector))')
    expect(generateIcf(m)).toContain('place at start of ER_IROM1 { readonly section .intvec };')
  })

  it('uninit region → ld 输出段带官方 (NOLOAD) 类型', () => {
    expect(generateLd(createDefaultModel())).toMatch(/\.sdram_noinit \(NOLOAD\) : \{/)
  })

  it('无 er_/rw_ 前缀的 region：ld 段名带单个前导点且可解析回（真实文件区域名如 XPI0）', () => {
    let m = createDefaultModel()
    m = addRegion(m, { name: 'XPI0', base: 0x80000000, maxSize: 0x100000, kind: 'flash' })
    m = addItem(m, { label: '', region: 'XPI0', size: 0x100, kind: 'ro' })
    const text = generateLd(m)
    expect(text).toContain('.xpi0 : {')
    expect(text).not.toContain('..xpi0')
    const parsed = parseLd(text)
    expect(parsed.error).toBeUndefined()
    expect(parsed.items.some((i) => i.region === 'XPI0')).toBe(true)
  })

  it('round-trip：kind item 生成的 ld 合法且可被 parseLd 解析', () => {
    const m = withItem({ label: '.noinit_x', region: 'RW_IRAM1', size: 0x100, kind: 'zi' })
    const text = generateLd(m)
    expect(text).toContain('*(.noinit_x*)')
    const parsed = parseLd(text)
    expect(parsed.error).toBeUndefined()
    expect(parsed.regions.some((r) => r.name === 'RW_IRAM1')).toBe(true)
  })
})
