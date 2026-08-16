export const PRIMITIVE_TYPES = {
  uint8_t: { size: 1, align: 1 },
  uint16_t: { size: 2, align: 2 },
  uint32_t: { size: 4, align: 4 },
  uint64_t: { size: 8, align: 8 },
}

function resolveType(type) {
  if (typeof type === 'string') return PRIMITIVE_TYPES[type]
  if (type && typeof type.array === 'number') return { size: type.array, align: 1 }
  throw new Error(`unknown member type: ${JSON.stringify(type)}`)
}

function alignUp(offset, align) {
  return Math.ceil(offset / align) * align
}

export function layoutStruct(members, { packed = false, aligned = null } = {}) {
  const placed = []
  let offset = 0
  let maxAlign = 1
  for (const m of members) {
    const t = resolveType(m.type)
    const align = packed ? 1 : t.align
    offset = alignUp(offset, align)
    placed.push({ name: m.name, type: m.type, offset, size: t.size, align })
    offset += t.size
    maxAlign = Math.max(maxAlign, align)
  }
  const alignment = aligned != null ? aligned : maxAlign
  const sizeof = alignUp(offset, alignment)
  const bytes = []
  for (let i = 0; i < sizeof; i++) {
    const owner = placed.findIndex((m) => i >= m.offset && i < m.offset + m.size)
    bytes.push(owner >= 0 ? { kind: 'member', memberIndex: owner } : { kind: 'padding', memberIndex: null })
  }
  const padding = sizeof - placed.reduce((s, m) => s + m.size, 0)
  return { members: placed, sizeof, alignment, padding, bytes }
}
