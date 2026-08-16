import { describe, it, expect } from 'vitest'
import { layoutStruct, PRIMITIVE_TYPES } from './structLayout.js'

const header = [
  { id: 'a', name: 'type', type: 'uint16_t' },
  { id: 'b', name: 'length', type: 'uint32_t' },
]

describe('layoutStruct', () => {
  it('普通 struct：offset 4，sizeof 8，align 4（笔记表格第 1 行）', () => {
    const r = layoutStruct(header)
    expect(r.members.map((m) => m.offset)).toEqual([0, 4])
    expect(r.sizeof).toBe(8)
    expect(r.alignment).toBe(4)
    expect(r.padding).toBe(2) // sizeof 8 − 成员 6 字节 = 2 字节 padding
  })

  it('packed：offset 2，sizeof 6，align 1（笔记第 2 行）', () => {
    const r = layoutStruct(header, { packed: true })
    expect(r.members.map((m) => m.offset)).toEqual([0, 2])
    expect(r.sizeof).toBe(6)
    expect(r.alignment).toBe(1)
    expect(r.padding).toBe(0)
  })

  it('packed + aligned(1)：同 packed，align 1（笔记第 3 行）', () => {
    const r = layoutStruct(header, { packed: true, aligned: 1 })
    expect(r.sizeof).toBe(6)
    expect(r.alignment).toBe(1)
  })

  it('packed + aligned(4)：offset 2，sizeof 8，align 4（笔记第 4 行）', () => {
    const r = layoutStruct(header, { packed: true, aligned: 4 })
    expect(r.members.map((m) => m.offset)).toEqual([0, 2])
    expect(r.sizeof).toBe(8)
    expect(r.alignment).toBe(4)
  })

  it('aligned(4) 只补尾部 padding，不挪动内部成员', () => {
    const r = layoutStruct(header, { packed: true, aligned: 4 })
    expect(r.members[1].offset).toBe(2) // length 不会从 2 挪到 4
    expect(r.bytes.filter((b) => b.kind === 'padding').length).toBe(2)
  })

  it('char 数组成员按 1 字节对齐', () => {
    const r = layoutStruct([
      { id: 'a', name: 'flags', type: 'uint8_t' },
      { id: 'b', name: 'tag', type: { array: 3 } },
      { id: 'c', name: 'id', type: 'uint32_t' },
    ])
    expect(r.members.map((m) => m.offset)).toEqual([0, 1, 4])
    expect(r.sizeof).toBe(8)
  })

  it('bytes 映射长度等于 sizeof 且覆盖每个字节', () => {
    const r = layoutStruct(header)
    expect(r.bytes).toHaveLength(8)
    expect(r.bytes[0].memberIndex).toBe(0)
    expect(r.bytes[2].kind).toBe('padding')
    expect(r.bytes[4].memberIndex).toBe(1)
  })

  it('空结构体 sizeof 为 0', () => {
    expect(layoutStruct([]).sizeof).toBe(0)
  })

  it('uint64_t 按 8 对齐', () => {
    expect(PRIMITIVE_TYPES.uint64_t.align).toBe(8)
    const r = layoutStruct([
      { id: 'a', name: 'c', type: 'uint8_t' },
      { id: 'b', name: 'v', type: 'uint64_t' },
    ])
    expect(r.members[1].offset).toBe(8)
  })
})
