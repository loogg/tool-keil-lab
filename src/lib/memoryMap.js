// 内存布局模型：支持可编辑 region/section、UNION、多 LR、碎片计算
// 向后兼容：现有 API（createDefaultModel/placeItem/regionUsage）保持不变

// ---------- 默认数据 ----------

const REGIONS = [
  { name: 'ER_IROM1', base: 0x08000000, maxSize: 0x000c0000, attrs: { fixed: false, uninit: false }, kind: 'flash', note: '代码 + 默认只读数据', loadRegion: 'LR_IROM1' },
  { name: 'ER_RODATA', base: 0x080c0000, maxSize: 0x00010000, attrs: { fixed: true, uninit: false }, kind: 'flash', note: 'Data Flash，FIXED 绝对地址', loadRegion: 'LR_IROM1' },
  { name: 'RW_IRAM1', base: 0x20000000, maxSize: 0x00070000, attrs: { fixed: false, uninit: false }, kind: 'ram', note: '主 SRAM', loadRegion: 'LR_IROM1' },
  { name: 'RW_CCRAM', base: 0x10000000, maxSize: 0x00010000, attrs: { fixed: false, uninit: false }, kind: 'ram', note: '紧耦合 RAM', loadRegion: 'LR_IROM1' },
  { name: 'RW_SDRAM_NOINIT', base: 0xc0000000, maxSize: 0x02000000, attrs: { fixed: false, uninit: true }, kind: 'ram', note: '外部 SDRAM，UNINIT', loadRegion: 'LR_IROM1' },
]

const ITEMS = [
  { id: 'reset', label: '*.o (RESET, +First)', detail: '向量表', region: 'ER_IROM1', size: 0x200, custom: false },
  { id: 'inroot', label: '*(InRoot$$Sections)', detail: '__main 等根段', region: 'ER_IROM1', size: 0x300, custom: false },
  { id: 'anyro', label: '.ANY (+RO)', detail: '其余代码与只读数据', region: 'ER_IROM1', size: 0x58000, custom: false },
  { id: 'webfs', label: 'webserver_packedfs.o (.rodata.*)', detail: '网页资源 36KB', region: 'ER_RODATA', size: 0x9000, custom: false },
  { id: 'mongoose', label: 'mongoose.o (+RO)', detail: '网络库只读部分 132KB', region: 'RW_IRAM1', size: 0x21000, custom: false },
  { id: 'op0715', label: 'op0715_*.o (+RO)', detail: '业务资源 32KB', region: 'RW_IRAM1', size: 0x8000, custom: false },
  { id: 'anyrw', label: '.ANY (+RW +ZI)', detail: '全局/静态变量', region: 'RW_IRAM1', size: 0x31200, custom: false },
  { id: 'ccram', label: '* (.bss.ccram) / * (.ccram)', detail: '指定 section 变量', region: 'RW_CCRAM', size: 0x1000, custom: false },
  { id: 'memp', label: 'memp.o (+RW +ZI)', detail: '内存池', region: 'RW_CCRAM', size: 0x2000, custom: false },
  { id: 'sdram', label: '* (.bss.sdram.noinit)', detail: '大缓冲，不初始化', region: 'RW_SDRAM_NOINIT', size: 0x100000, custom: false },
]

const LOAD_REGIONS = [
  { name: 'LR_IROM1', base: 0x08000000, maxSize: 0x00100000, note: '主加载区（Flash）' },
  { name: 'LR_SDRAM', base: 0xc0000000, maxSize: 0x02000000, note: 'SDRAM 加载区（可选，用于 XIP/快速启动）' },
]

// ---------- 工厂函数 ----------

export function createDefaultModel() {
  return {
    regions: REGIONS.map((r) => ({ ...r, attrs: { ...r.attrs } })),
    items: ITEMS.map((i) => ({ ...i })),
    loadRegions: LOAD_REGIONS.map((lr) => ({ ...lr })),
  }
}

// Bootloader + App 双区场景
export function createDualLoadModel() {
  const model = createDefaultModel()
  // 缩小 ER_IROM1 给 Bootloader 腾空间
  model.regions = model.regions.map((r) =>
    r.name === 'ER_IROM1' ? { ...r, base: 0x08020000, maxSize: 0x000a0000 } : r
  )
  // 添加 Bootloader region
  model.regions.unshift({
    name: 'ER_BL_IROM', base: 0x08000000, maxSize: 0x00020000,
    attrs: { fixed: true, uninit: false }, kind: 'flash',
    note: 'Bootloader 代码区', loadRegion: 'LR_BL',
  })
  // 添加 BL 的 items
  model.items.unshift(
    { id: 'bl_reset', label: '*.o (RESET, +First)', detail: 'BL 向量表', region: 'ER_BL_IROM', size: 0x200, custom: true },
    { id: 'bl_code', label: '.ANY (+RO)', detail: 'BL 代码', region: 'ER_BL_IROM', size: 0x10000, custom: true },
  )
  // 添加第二个加载区
  model.loadRegions = [
    { name: 'LR_BL', base: 0x08000000, maxSize: 0x00020000, note: 'Bootloader 加载区' },
    { name: 'LR_APP', base: 0x08020000, maxSize: 0x000e0000, note: 'App 加载区' },
  ]
  // 更新 App regions 的 loadRegion
  model.regions = model.regions.map((r) =>
    r.name !== 'ER_BL_IROM' ? { ...r, loadRegion: 'LR_APP' } : r
  )
  return model
}

// UNION 场景：RW_IRAM1 和 RW_CCRAM 共享地址空间（演示）
export function createUnionModel() {
  const model = createDefaultModel()
  // 让 CCRAM 与 IRAM1 的某段重叠（教学演示）
  model.regions = model.regions.map((r) =>
    r.name === 'RW_CCRAM' ? { ...r, unionWith: 'RW_IRAM1', note: '紧耦合 RAM（与 IRAM1 UNION 演示）' } : r
  )
  return model
}

// ---------- 区域编辑 ----------

export function updateRegion(model, regionName, patch) {
  return {
    ...model,
    regions: model.regions.map((r) =>
      r.name === regionName ? { ...r, ...patch, attrs: { ...r.attrs, ...(patch.attrs || {}) } } : r
    ),
  }
}

export function addRegion(model, template) {
  // template: { name, base, maxSize, attrs?, kind?, note?, loadRegion? }
  if (model.regions.some((r) => r.name === template.name)) {
    throw new Error(`region ${template.name} already exists`)
  }
  return {
    ...model,
    regions: [...model.regions, {
      name: template.name,
      base: template.base,
      maxSize: template.maxSize,
      attrs: { fixed: false, uninit: false, ...template.attrs },
      kind: template.kind || 'ram',
      note: template.note || '',
      loadRegion: template.loadRegion || (model.loadRegions[0]?.name),
    }],
  }
}

export function removeRegion(model, regionName) {
  const hasItems = model.items.some((i) => i.region === regionName)
  if (hasItems) {
    throw new Error(`cannot remove region ${regionName}: still has items assigned`)
  }
  return {
    ...model,
    regions: model.regions.filter((r) => r.name !== regionName),
  }
}

// ---------- Section 编辑 ----------

export function updateItem(model, itemId, patch) {
  return {
    ...model,
    items: model.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
  }
}

let _nextCustomId = 100
export function addItem(model, template) {
  // template: { label, detail, region, size }
  const id = `custom_${_nextCustomId++}`
  return {
    ...model,
    items: [...model.items, {
      id,
      label: template.label,
      detail: template.detail || '',
      region: template.region,
      size: template.size,
      custom: true,
    }],
  }
}

export function removeItem(model, itemId) {
  return {
    ...model,
    items: model.items.filter((i) => i.id !== itemId),
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

// ---------- 布局计算（第二层核心） ----------

// 计算 region 内 section 的实际偏移和碎片
// 返回：{ items: [{...item, offset, end}], used, limit, overflow, gaps: [{start, size}] }
export function regionLayout(model, regionName) {
  const region = model.regions.find((r) => r.name === regionName)
  if (!region) throw new Error(`unknown region: ${regionName}`)

  const items = model.items
    .filter((i) => i.region === regionName)
    .map((i) => ({ ...i }))

  // 按 size 降序排列（linker 通常先放大对象）
  items.sort((a, b) => b.size - a.size)

  let offset = 0
  const gaps = []
  const placed = []

  for (const item of items) {
    // 对齐：按 item size 的自然对齐（简化模型）
    const align = Math.min(item.size, 4)
    const alignedOffset = Math.ceil(offset / align) * align
    if (alignedOffset > offset) {
      gaps.push({ start: offset, size: alignedOffset - offset })
    }
    placed.push({
      ...item,
      offset: alignedOffset,
      end: alignedOffset + item.size,
    })
    offset = alignedOffset + item.size
  }

  const used = offset
  const limit = region.maxSize
  const overflow = used > limit

  return { items: placed, used, limit, overflow, gaps }
}

// ---------- 溢出精确定位（第二层） ----------

// 返回第一个导致溢出的 item 及其超出量
export function overflowDetail(model, regionName) {
  const layout = regionLayout(model, regionName)
  if (!layout.overflow) return null

  // 找出第一个超出 limit 的 item
  const firstOverflow = layout.items.find((i) => i.end > layout.limit)
  if (!firstOverflow) return null

  return {
    itemId: firstOverflow.id,
    itemLabel: firstOverflow.label,
    overflowAt: firstOverflow.offset,
    overflowBy: firstOverflow.end - layout.limit,
  }
}

// ---------- 现有 API（向后兼容） ----------

export function regionUsage(model, regionName) {
  const region = model.regions.find((r) => r.name === regionName)
  const used = model.items.filter((i) => i.region === regionName).reduce((s, i) => s + i.size, 0)
  return { used, limit: region.maxSize, overflow: used > region.maxSize }
}

// ---------- 加载区管理 ----------

export function updateLoadRegion(model, lrName, patch) {
  return {
    ...model,
    loadRegions: (model.loadRegions || []).map((lr) =>
      lr.name === lrName ? { ...lr, ...patch } : lr
    ),
  }
}

export function addLoadRegion(model, template) {
  if ((model.loadRegions || []).some((lr) => lr.name === template.name)) {
    throw new Error(`load region ${template.name} already exists`)
  }
  return {
    ...model,
    loadRegions: [...(model.loadRegions || []), template],
  }
}

// ---------- 验证 ----------

export function validateModel(model) {
  const errors = []
  // 检查 region 引用完整性
  for (const item of model.items) {
    if (!model.regions.some((r) => r.name === item.region)) {
      errors.push(`item ${item.id} references unknown region ${item.region}`)
    }
  }
  // 检查 UNION 完整性
  for (const region of model.regions) {
    if (region.unionWith && !model.regions.some((r) => r.name === region.unionWith)) {
      errors.push(`region ${region.name} unionWith unknown region ${region.unionWith}`)
    }
  }
  return errors
}

// webserver_packedfs.o 内部的 section（演示按属性 vs 按名称筛选）
export const PACKEDFS_SECTIONS = [
  { name: '.rodata.webpages', size: 0x8000, rodataName: true },
  { name: '.rodata.index', size: 0x400, rodataName: true },
  { name: 'webfs_custom_table', size: 0xc00, rodataName: false },
]

export function selectSections(filter) {
  if (filter === '+RO') return PACKEDFS_SECTIONS
  if (filter === '.rodata.*') return PACKEDFS_SECTIONS.filter((s) => s.rodataName)
  throw new Error(`unknown filter: ${filter}`)
}
