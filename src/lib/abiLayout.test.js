import { describe, it, expect } from 'vitest'
import { accessOutcome, ALIGN_CORES } from './abiLayout.js'

describe('accessOutcome', () => {
  it('对齐访问永远 ok', () => {
    expect(accessOutcome({ core: 'cortex-m0', accessSize: 4, offset: 4 }).result).toBe('ok')
  })
  it('M0 非对齐多字节访问 → fault（硬件不支持）', () => {
    const r = accessOutcome({ core: 'cortex-m0', accessSize: 4, offset: 2 })
    expect(r.result).toBe('fault')
    expect(r.reason).toContain('不支持')
  })
  it('M0+ 同样不支持', () => {
    expect(accessOutcome({ core: 'cortex-m0plus', accessSize: 2, offset: 1 }).result).toBe('fault')
  })
  it('M4 默认支持但较慢', () => {
    const r = accessOutcome({ core: 'cortex-m4', accessSize: 4, offset: 2 })
    expect(r.result).toBe('slow')
  })
  it('M4 开启 UNALIGN_TRP 后变 fault', () => {
    const r = accessOutcome({ core: 'cortex-m4', accessSize: 4, offset: 2, unalignTrap: true })
    expect(r.result).toBe('fault')
    expect(r.reason).toContain('UNALIGN_TRP')
  })
  it('单字节访问任何偏移都 ok', () => {
    expect(accessOutcome({ core: 'cortex-m0', accessSize: 1, offset: 3 }).result).toBe('ok')
  })
  it('支持的内核清单正确', () => {
    expect(ALIGN_CORES['cortex-m0'].unalignedSupport).toBe(false)
    expect(ALIGN_CORES['cortex-m3'].unalignedSupport).toBe(true)
    expect(ALIGN_CORES['cortex-m7'].unalignedSupport).toBe(true)
  })
})
