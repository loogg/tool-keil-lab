// 取值含义：armcc5 的 __ARMCC_VERSION 取 5.06 update 9 示例值；
// armclang6 取 6.19 示例值（Mmmuuxx 格式）。__GNUC__ 为兼容值示意。
export const COMPILERS = {
  armcc5: {
    label: 'Arm Compiler 5（armcc）',
    macros: { __CC_ARM: 1, __ARMCC_VERSION: 5060960 },
  },
  armclang6: {
    label: 'Arm Compiler 6（armclang）',
    macros: { __ARMCC_VERSION: 6190000, __ARMCOMPILER_VERSION: 6190000, __clang__: 1, __GNUC__: 4 },
  },
  gcc: {
    label: 'GCC（arm-none-eabi）',
    macros: { __GNUC__: 10 },
  },
  clang: {
    label: '原生 Clang（桌面）',
    macros: { __clang__: 1, __GNUC__: 4 },
  },
}

export const IDENTITY_MACROS = ['__CC_ARM', '__ARMCC_VERSION', '__ARMCOMPILER_VERSION', '__clang__', '__GNUC__']

export const CRITERIA = [
  { purpose: 'Arm Compiler 5 / armcc', code: 'defined(__CC_ARM)', matches: ['armcc5'] },
  { purpose: 'Arm Compiler 6 / armclang（推荐）', code: 'defined(__ARMCOMPILER_VERSION)', matches: ['armclang6'] },
  { purpose: '按 __ARMCC_VERSION 区分 AC6', code: 'defined(__ARMCC_VERSION) && (__ARMCC_VERSION >= 6000000)', matches: ['armclang6'] },
  { purpose: 'Arm Compiler（AC5/AC6，不分代）', code: 'defined(__ARMCC_VERSION)', matches: ['armcc5', 'armclang6'] },
  { purpose: 'Clang 前端', code: 'defined(__clang__)', matches: ['armclang6', 'clang'] },
]

// 受限表达式求值：仅支持 defined(X)、X >= N、&& 连接（判据场景够用）
export function evaluateExpr(expr, macros) {
  return expr.split('&&').map((s) => s.trim()).every((part) => {
    let m = part.match(/^defined\((\w+)\)$/)
    if (m) return m[1] in macros
    m = part.match(/^\(?(\w+)\s*>=\s*(\d+)\)?$/)
    if (m) return (macros[m[1]] ?? -1) >= Number(m[2])
    throw new Error(`unsupported expr: ${part}`)
  })
}

// Mmmuuxx（AC6）/ Mmmubbb（AC5）统一拆解；6000000 为 AC6 分界值
export function decodeVersion(value) {
  if (!Number.isFinite(value) || value <= 0) return { family: 'unknown', major: 0, minor: 0, tail: 0, isAc6: false }
  const isAc6 = value >= 6000000
  const major = Math.floor(value / 1000000)
  const minor = Math.floor((value % 1000000) / 10000)
  const tail = value % 10000
  return { family: isAc6 ? 'AC6' : 'AC5', major, minor, tail, isAc6 }
}

// ACLE 常用宏按目标内核的取值（0/1 或数值）
export const CORTEX_PROFILES = {
  'cortex-m0': { arch: 6, profile: 'M', isaThumb: 1, idiv: 0, dsp: 0, simd32: 0, clz: 0, unaligned: 0, fp: 0 },
  'cortex-m0plus': { arch: 6, profile: 'M', isaThumb: 1, idiv: 0, dsp: 0, simd32: 0, clz: 0, unaligned: 0, fp: 0 },
  'cortex-m3': { arch: 7, profile: 'M', isaThumb: 2, idiv: 1, dsp: 0, simd32: 0, clz: 1, unaligned: 1, fp: 0 },
  'cortex-m4': { arch: 7, profile: 'M', isaThumb: 2, idiv: 1, dsp: 1, simd32: 1, clz: 1, unaligned: 1, fp: 4 },
  'cortex-m7': { arch: 7, profile: 'M', isaThumb: 2, idiv: 1, dsp: 1, simd32: 1, clz: 1, unaligned: 1, fp: 12 },
  'cortex-m33': { arch: 8, profile: 'M', isaThumb: 2, idiv: 1, dsp: 1, simd32: 1, clz: 1, unaligned: 1, fp: 4 },
}

export const ACLE_ROWS = [
  { macro: '__ARM_ARCH', field: 'arch', desc: '架构版本（6/7/8）' },
  { macro: '__ARM_ARCH_PROFILE', field: 'profile', desc: '架构 Profile（A/R/M）' },
  { macro: '__ARM_ARCH_ISA_THUMB', field: 'isaThumb', desc: 'Thumb ISA 级别' },
  { macro: '__ARM_ARCH_EXT_IDIV__', field: 'idiv', desc: '硬件整数除法 SDIV/UDIV' },
  { macro: '__ARM_FEATURE_DSP', field: 'dsp', desc: 'DSP 扩展' },
  { macro: '__ARM_FEATURE_SIMD32', field: 'simd32', desc: '32 位 SIMD' },
  { macro: '__ARM_FEATURE_CLZ', field: 'clz', desc: '前导零计数指令' },
  { macro: '__ARM_FEATURE_UNALIGNED', field: 'unaligned', desc: '非对齐访问支持' },
  { macro: '__ARM_FP', field: 'fp', desc: 'FPU 位掩码（4=单精度，12=单+双）' },
]
