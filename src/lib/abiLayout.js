export const ALIGN_CORES = {
  'cortex-m0': { unalignedSupport: false },
  'cortex-m0plus': { unalignedSupport: false },
  'cortex-m3': { unalignedSupport: true },
  'cortex-m4': { unalignedSupport: true },
  'cortex-m7': { unalignedSupport: true },
  'cortex-m33': { unalignedSupport: true },
}

export function accessOutcome({ core, accessSize, offset, unalignTrap = false }) {
  if (accessSize === 1 || offset % accessSize === 0) {
    return { result: 'ok', reason: '地址自然对齐，单周期完成' }
  }
  const info = ALIGN_CORES[core]
  if (!info) throw new Error(`unknown core: ${core}`)
  if (!info.unalignedSupport) {
    return { result: 'fault', reason: '该内核硬件不支持非对齐多字节访问，触发 UsageFault/HardFault' }
  }
  if (unalignTrap) {
    return { result: 'fault', reason: 'CCR.UNALIGN_TRP 已使能，非对齐访问被捕获为 UsageFault' }
  }
  return { result: 'slow', reason: '硬件支持但需拆分多次总线访问，且跨缓存行/MPU 边界仍可能出错' }
}
