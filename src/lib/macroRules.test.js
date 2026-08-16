import { describe, it, expect } from 'vitest'
import {
  COMPILERS, IDENTITY_MACROS, CRITERIA,
  evaluateExpr, decodeVersion, CORTEX_PROFILES,
} from './macroRules.js'

describe('宏真值表（与笔记一致）', () => {
  const has = (c, m) => m in COMPILERS[c].macros
  it('__CC_ARM 仅 AC5', () => {
    expect(has('armcc5', '__CC_ARM')).toBe(true)
    expect(has('armclang6', '__CC_ARM')).toBe(false)
  })
  it('__ARMCC_VERSION 两代都有', () => {
    expect(has('armcc5', '__ARMCC_VERSION')).toBe(true)
    expect(has('armclang6', '__ARMCC_VERSION')).toBe(true)
  })
  it('__ARMCOMPILER_VERSION 仅 AC6', () => {
    expect(has('armcc5', '__ARMCOMPILER_VERSION')).toBe(false)
    expect(has('armclang6', '__ARMCOMPILER_VERSION')).toBe(true)
  })
  it('__clang__ AC6 有、AC5 无', () => {
    expect(has('armcc5', '__clang__')).toBe(false)
    expect(has('armclang6', '__clang__')).toBe(true)
  })
  it('__GNUC__ AC6 有（兼容宏）、AC5 无', () => {
    expect(has('armcc5', '__GNUC__')).toBe(false)
    expect(has('armclang6', '__GNUC__')).toBe(true)
  })
})

describe('evaluateExpr', () => {
  it('defined(__CC_ARM)', () => {
    expect(evaluateExpr('defined(__CC_ARM)', COMPILERS.armcc5.macros)).toBe(true)
    expect(evaluateExpr('defined(__CC_ARM)', COMPILERS.armclang6.macros)).toBe(false)
  })
  it('defined(__ARMCC_VERSION) && (__ARMCC_VERSION >= 6000000) 只命中 AC6', () => {
    const expr = 'defined(__ARMCC_VERSION) && (__ARMCC_VERSION >= 6000000)'
    expect(evaluateExpr(expr, COMPILERS.armcc5.macros)).toBe(false)
    expect(evaluateExpr(expr, COMPILERS.armclang6.macros)).toBe(true)
  })
})

describe('CRITERIA 判据表', () => {
  it('每条判据的 matches 与实际求值一致', () => {
    for (const c of CRITERIA) {
      const hit = Object.keys(COMPILERS).filter((id) => evaluateExpr(c.code, COMPILERS[id].macros))
      expect(hit.sort()).toEqual([...c.matches].sort())
    }
  })
  it('包含笔记全部 5 条判据', () => {
    expect(CRITERIA).toHaveLength(5)
  })
})

describe('decodeVersion', () => {
  it('5060960 → AC5 5.06', () => {
    const r = decodeVersion(5060960)
    expect(r).toMatchObject({ family: 'AC5', major: 5, minor: 6, isAc6: false })
  })
  it('6000000 是 AC6 分界值（含等于）', () => {
    expect(decodeVersion(6000000).isAc6).toBe(true)
    expect(decodeVersion(5999999).isAc6).toBe(false)
  })
  it('6190000 → AC6 6.19（Mmmuuxx）', () => {
    const r = decodeVersion(6190000)
    expect(r).toMatchObject({ family: 'AC6', major: 6, minor: 19, isAc6: true })
  })
})

describe('CORTEX_PROFILES（ACLE）', () => {
  it('M0 无 DSP/非对齐支持，arch 6', () => {
    const p = CORTEX_PROFILES['cortex-m0']
    expect(p).toMatchObject({ arch: 6, dsp: 0, unaligned: 0, idiv: 0 })
  })
  it('M4 有 DSP/SIMD32/硬件除法', () => {
    const p = CORTEX_PROFILES['cortex-m4']
    expect(p).toMatchObject({ arch: 7, dsp: 1, simd32: 1, idiv: 1 })
  })
  it('M33 是 arch 8', () => {
    expect(CORTEX_PROFILES['cortex-m33'].arch).toBe(8)
  })
  it('全部 profile 都是 M 系列', () => {
    expect(Object.values(CORTEX_PROFILES).every((p) => p.profile === 'M')).toBe(true)
  })
})
