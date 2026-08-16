// GD32 实例：地址与容量取自 Notion 笔记的 scatter 文件
const REGIONS = [
  { name: 'ER_IROM1', base: 0x08000000, maxSize: 0x000c0000, attrs: { fixed: false, uninit: false }, kind: 'flash', note: '代码 + 默认只读数据' },
  { name: 'ER_RODATA', base: 0x080c0000, maxSize: 0x00010000, attrs: { fixed: true, uninit: false }, kind: 'flash', note: 'Data Flash，FIXED 绝对地址' },
  { name: 'RW_IRAM1', base: 0x20000000, maxSize: 0x00070000, attrs: { fixed: false, uninit: false }, kind: 'ram', note: '主 SRAM' },
  { name: 'RW_CCRAM', base: 0x10000000, maxSize: 0x00010000, attrs: { fixed: false, uninit: false }, kind: 'ram', note: '紧耦合 RAM' },
  { name: 'RW_SDRAM_NOINIT', base: 0xc0000000, maxSize: 0x02000000, attrs: { fixed: false, uninit: true }, kind: 'ram', note: '外部 SDRAM，UNINIT' },
]

// size 为示意值，用于占用率与超容演示
const ITEMS = [
  { id: 'reset', label: '*.o (RESET, +First)', detail: '向量表', region: 'ER_IROM1', size: 0x200 },
  { id: 'inroot', label: '*(InRoot$$Sections)', detail: '__main 等根段', region: 'ER_IROM1', size: 0x300 },
  { id: 'anyro', label: '.ANY (+RO)', detail: '其余代码与只读数据', region: 'ER_IROM1', size: 0x58000 },
  { id: 'webfs', label: 'webserver_packedfs.o (.rodata.*)', detail: '网页资源 36KB', region: 'ER_RODATA', size: 0x9000 },
  { id: 'mongoose', label: 'mongoose.o (+RO)', detail: '网络库只读部分 132KB', region: 'RW_IRAM1', size: 0x21000 },
  { id: 'op0715', label: 'op0715_*.o (+RO)', detail: '业务资源 32KB', region: 'RW_IRAM1', size: 0x8000 },
  { id: 'anyrw', label: '.ANY (+RW +ZI)', detail: '全局/静态变量', region: 'RW_IRAM1', size: 0x31200 },
  { id: 'ccram', label: '* (.bss.ccram) / * (.ccram)', detail: '指定 section 变量', region: 'RW_CCRAM', size: 0x1000 },
  { id: 'memp', label: 'memp.o (+RW +ZI)', detail: '内存池', region: 'RW_CCRAM', size: 0x2000 },
  { id: 'sdram', label: '* (.bss.sdram.noinit)', detail: '大缓冲，不初始化', region: 'RW_SDRAM_NOINIT', size: 0x100000 },
]

export function createDefaultModel() {
  return {
    regions: REGIONS.map((r) => ({ ...r, attrs: { ...r.attrs } })),
    items: ITEMS.map((i) => ({ ...i })),
  }
}

export function placeItem(model, itemId, regionName) {
  if (!model.regions.some((r) => r.name === regionName)) {
    throw new Error(`unknown region: ${regionName}`)
  }
  return {
    ...model,
    items: model.items.map((i) => (i.id === itemId ? { ...i, region: regionName } : i)),
  }
}

export function regionUsage(model, regionName) {
  const region = model.regions.find((r) => r.name === regionName)
  const used = model.items.filter((i) => i.region === regionName).reduce((s, i) => s + i.size, 0)
  return { used, limit: region.maxSize, overflow: used > region.maxSize }
}

// webserver_packedfs.o 内部的 section（演示按属性 vs 按名称筛选）
export const PACKEDFS_SECTIONS = [
  { name: '.rodata.webpages', size: 0x8000, rodataName: true },
  { name: '.rodata.index', size: 0x400, rodataName: true },
  { name: 'webfs_custom_table', size: 0xc00, rodataName: false },
]

export function selectSections(filter) {
  if (filter === '+RO') return PACKEDFS_SECTIONS // 按属性：所有只读段（含自定义名）
  if (filter === '.rodata.*') return PACKEDFS_SECTIONS.filter((s) => s.rodataName)
  throw new Error(`unknown filter: ${filter}`)
}
