import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import ModuleShell from '../components/ModuleShell'
import CodeBlock from '../components/CodeBlock'
import Callout from '../components/Callout'
import { layoutStruct } from '../lib/structLayout'
import { accessOutcome, ALIGN_CORES } from '../lib/abiLayout'

// 成员字节着色：成员数超过 4 时循环取色
const MEMBER_PALETTE = ['bg-sky-500/60', 'bg-emerald-500/60', 'bg-violet-500/60', 'bg-orange-500/60']

// 类型下拉选项：char[4] 映射为 {array: 4}
const TYPE_KEYS = ['uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'char[4]']
const toLayoutType = (key) => (key === 'char[4]' ? { array: 4 } : key)

// 四形态对照表的固定示例：struct header
const HEADER_EXAMPLE = [
  { name: 'type', type: 'uint16_t' },
  { name: 'length', type: 'uint32_t' },
]

const FORM_ROWS = [
  { label: '普通', opts: {} },
  { label: 'packed', opts: { packed: true } },
  { label: 'packed + aligned(1)', opts: { packed: true, aligned: 1 } },
  { label: 'packed + aligned(4)', opts: { packed: true, aligned: 4 } },
]

const CORE_LABELS = {
  'cortex-m0': 'Cortex-M0',
  'cortex-m0plus': 'Cortex-M0+',
  'cortex-m3': 'Cortex-M3',
  'cortex-m4': 'Cortex-M4',
  'cortex-m7': 'Cortex-M7',
  'cortex-m33': 'Cortex-M33',
}

// 三种 pack 写法（数据内联）
const PACK_ROWS = [
  {
    syntax: '#pragma pack(push, 1) / #pragma pack(pop)',
    scope: '区间',
    desc: '成对使用，影响区间内所有声明',
  },
  {
    syntax: '__attribute__((packed))',
    scope: '单个类型',
    desc: 'AC5/AC6/GCC 通用，跨版本推荐',
  },
  {
    syntax: '__packed（AC5 原生）',
    scope: '类型/指针',
    desc: '还可作非对齐访问修饰符（__packed uint32_t *p），语义更宽，勿与 attribute 混同',
  },
]

// AC5/AC6 weak 写法兼容矩阵
const WEAK_MATRIX = [
  { syntax: '__weak', ac5: '✓ 原生关键字', ac6: '✗ 不应依赖', note: 'AC5 专属写法' },
  { syntax: '__attribute__((weak))', ac5: '✓', ac6: '✓', note: '跨版本推荐' },
  { syntax: '__WEAK（CMSIS）', ac5: '✓', ac6: '✓', note: '用 CMSIS 时优先' },
]

// 访问结果大卡片配色
const RESULT_META = {
  ok: { icon: '✓', label: '访问安全', box: 'border-emerald-400/40 bg-emerald-400/10', text: 'text-emerald-400' },
  slow: { icon: '⚠', label: '能跑但有代价', box: 'border-warn/40 bg-warn/10', text: 'text-warn' },
  fault: { icon: '✗', label: '访问故障', box: 'border-danger/40 bg-danger/10', text: 'text-danger' },
}

// weak 符号三场景：两个 .o + 链接器 + 结果
const WEAK_SCENES = {
  both: {
    label: '强弱共存',
    objs: [
      { file: 'hal_uart.o', sym: 'weak: HAL_UART_RxCpltCallback', kind: 'weak' },
      { file: 'main.o', sym: 'strong: HAL_UART_RxCpltCallback', kind: 'strong' },
    ],
    linker: '强弱共存 → 选强符号',
    ok: true,
    result: '调用 main.o 里的用户实现，成功接管回调',
  },
  weakOnly: {
    label: '只有弱符号',
    objs: [
      { file: 'hal_uart.o', sym: 'weak: HAL_UART_RxCpltCallback', kind: 'weak' },
      { file: 'main.o', sym: '无定义', kind: 'none' },
    ],
    linker: '只有弱符号 → 用弱符号',
    ok: true,
    result: '使用 HAL 默认空实现 —— STM32 HAL 回调原理',
  },
  none: {
    label: '都没有',
    objs: [
      { file: 'hal_uart.o', sym: '无符号', kind: 'none' },
      { file: 'main.o', sym: '只调用，无定义', kind: 'none' },
    ],
    linker: '找不到任何定义',
    ok: false,
    result: "链接错误：undefined reference to `HAL_UART_RxCpltCallback'",
  },
}

const OBJ_SYM_CLS = { strong: 'text-emerald-400', weak: 'text-warn', none: 'text-muted' }

const SAFE_READ_CODE = `uint32_t safe_read(const packed_struct_t *ps)
{
    uint32_t v;
    memcpy(&v, &ps->length, sizeof(v));  /* 字节拷贝不受对齐限制 */
    return v;
}`

const HAL_WEAK_CODE = `/* HAL 里的默认实现 */
__attribute__((weak)) void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
    UNUSED(huart);   /* 用户不重写时什么都不做 */
}

/* 你的代码里重写同名函数即可接管回调（强符号覆盖弱符号） */
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) { ... }`

// 行首偏移地址：0x00、0x08…
const hexOffset = (n) => '0x' + n.toString(16).padStart(2, '0')

const BYTE_COLS = 8

// 字节网格：每行 8 字节，member 按 memberIndex 着色，padding 用斜纹
function ByteGrid({ layout }) {
  if (layout.bytes.length === 0) {
    return <p className="text-xs text-muted">结构体为空 —— 先添加成员，网格会实时画出每个字节的归属。</p>
  }
  const rows = []
  for (let i = 0; i < layout.bytes.length; i += BYTE_COLS) rows.push(layout.bytes.slice(i, i + BYTE_COLS))
  return (
    <div className="space-y-1.5">
      {rows.map((row, r) => (
        <div key={r} className="flex items-center gap-1.5">
          <span className="w-9 text-right font-mono text-xs text-muted">{hexOffset(r * BYTE_COLS)}</span>
          {row.map((b, i) => {
            if (b.kind === 'padding') {
              return <div key={i} title="padding" className="pad-stripes h-8 w-8 rounded border border-line/70" />
            }
            const m = layout.members[b.memberIndex]
            return (
              <div
                key={i}
                title={m.name || `成员 ${b.memberIndex + 1}`}
                className={`flex h-8 w-8 items-center justify-center rounded font-mono text-xs font-semibold text-ink ${MEMBER_PALETTE[b.memberIndex % MEMBER_PALETTE.length]}`}
              >
                {(m.name || '?').charAt(0)}
              </div>
            )
          })}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-muted">
        {layout.members.map((m, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-sm ${MEMBER_PALETTE[i % MEMBER_PALETTE.length]}`} />
            <span className="font-mono">{m.name || `成员 ${i + 1}`}</span>
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="pad-stripes inline-block h-3 w-3 rounded-sm border border-line/70" />
          <span className="font-mono">padding</span>
        </span>
      </div>
    </div>
  )
}

// weak 场景图示：两个 .o 卡 + 链接器盒 + 结果箭头
function WeakDiagram({ scene }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-col gap-2">
        {scene.objs.map((o) => (
          <div key={o.file} className="rounded-lg border border-line bg-panel-2 px-3 py-2">
            <div className="font-mono text-[11px] text-muted">{o.file}</div>
            <div className={`font-mono text-xs ${OBJ_SYM_CLS[o.kind]}`}>{o.sym}</div>
          </div>
        ))}
      </div>
      <span className="font-mono text-lg text-muted">→</span>
      <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-center">
        <div className="text-xs font-semibold text-accent">链接器</div>
        <div className="mt-1 text-[11px] text-ink/85">{scene.linker}</div>
      </div>
      <span className="font-mono text-lg text-muted">→</span>
      <div
        className={`max-w-56 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
          scene.ok ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-danger/40 bg-danger/10 text-danger'
        }`}
      >
        {scene.ok ? '✓ ' : '✗ '}
        {scene.result}
      </div>
    </div>
  )
}

export default function StructLabModule() {
  // —— 结构体编辑器 ——
  const [members, setMembers] = useState([
    { id: 'm1', name: 'type', type: 'uint16_t' },
    { id: 'm2', name: 'length', type: 'uint32_t' },
  ])
  const [packed, setPacked] = useState(false)
  const [alignedStr, setAlignedStr] = useState('') // select 的 value 是字符串，'' = 无
  const [nextId, setNextId] = useState(3)

  // —— 故障模拟器 ——
  const [core, setCore] = useState('cortex-m0')
  const [trap, setTrap] = useState(false)
  const [pickMember, setPickMember] = useState(0)

  // —— weak 场景 ——
  const [weakScene, setWeakScene] = useState('both')

  const aligned = alignedStr === '' ? null : Number(alignedStr)
  const layout = layoutStruct(
    members.map((m) => ({ name: m.name, type: toLayoutType(m.type) })),
    { packed, aligned },
  )

  const updateMember = (id, patch) => setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  const removeMember = (id) => setMembers((ms) => ms.filter((m) => m.id !== id))
  const moveMember = (id, dir) =>
    setMembers((ms) => {
      const i = ms.findIndex((m) => m.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= ms.length) return ms
      const next = [...ms]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const addMember = () => {
    setMembers((ms) => [...ms, { id: `m${nextId}`, name: `field${nextId}`, type: 'uint8_t' }])
    setNextId(nextId + 1)
  }
  const loadExample = () => {
    setMembers([
      { id: `m${nextId}`, name: 'type', type: 'uint16_t' },
      { id: `m${nextId + 1}`, name: 'length', type: 'uint32_t' },
    ])
    setNextId(nextId + 2)
    setPacked(false)
    setAlignedStr('')
    setPickMember(0)
  }

  // 成员被删后 pickMember 可能越界：取安全索引
  const pickIdx = layout.members.length > 0 ? Math.min(pickMember, layout.members.length - 1) : -1
  const picked = pickIdx >= 0 ? layout.members[pickIdx] : null
  const outcome = picked
    ? accessOutcome({ core, accessSize: picked.size, offset: picked.offset, unalignTrap: trap })
    : null

  const inputCls =
    'rounded border border-line bg-panel px-2 py-1 text-xs text-ink outline-none transition-colors focus:border-accent'
  const iconBtnCls =
    'rounded border border-line bg-panel p-1 text-muted transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-line disabled:hover:text-muted'

  return (
    <ModuleShell
      kicker="Structs"
      title="结构体布局实验室"
      subtitle="字节级观察结构体的对齐与填充：编辑成员实时画字节网格，对照笔记四形态，模拟非对齐访问在不同内核上的结局，再对照 pack 写法与 weak 符号链接。"
    >
      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">结构体编辑器 · 字节网格</h3>
        <p className="mb-3 text-xs text-muted">
          增删成员、调整顺序，切换 packed / aligned —— 网格与统计实时更新
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-line bg-panel p-4">
            {members.map((m, i) => (
              <div key={m.id} className="mb-2 flex flex-wrap items-center gap-2">
                <span className="w-5 text-center font-mono text-xs text-muted">{i}</span>
                <input
                  type="text"
                  value={m.name}
                  onChange={(e) => updateMember(m.id, { name: e.target.value })}
                  placeholder="成员名"
                  spellCheck={false}
                  className={`w-28 font-mono ${inputCls}`}
                />
                <select
                  value={m.type}
                  onChange={(e) => updateMember(m.id, { type: e.target.value })}
                  className={`font-mono ${inputCls}`}
                >
                  {TYPE_KEYS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <div className="ml-auto flex gap-1">
                  <button type="button" title="上移" disabled={i === 0} onClick={() => moveMember(m.id, -1)} className={iconBtnCls}>
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    title="下移"
                    disabled={i === members.length - 1}
                    onClick={() => moveMember(m.id, 1)}
                    className={iconBtnCls}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button type="button" title="删除" onClick={() => removeMember(m.id)} className={iconBtnCls}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={addMember}
                className="flex items-center gap-1 rounded border border-accent bg-accent/15 px-3 py-1 text-xs text-accent transition-colors hover:bg-accent/25"
              >
                <Plus size={13} />
                添加成员
              </button>
              <button
                type="button"
                onClick={() => setPacked(!packed)}
                className={[
                  'rounded border px-3 py-1 font-mono text-xs transition-colors',
                  packed
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-line bg-panel text-muted hover:border-accent hover:text-ink',
                ].join(' ')}
              >
                packed: {packed ? '开' : '关'}
              </button>
              <label htmlFor="aligned-select" className="flex items-center gap-2 text-xs text-muted">
                aligned
                <select
                  id="aligned-select"
                  value={alignedStr}
                  onChange={(e) => setAlignedStr(e.target.value)}
                  className={`font-mono ${inputCls}`}
                >
                  <option value="">无</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="4">4</option>
                  <option value="8">8</option>
                </select>
              </label>
            </div>
          </div>
          <div className="rounded-lg border border-line bg-panel p-4">
            <ByteGrid layout={layout} />
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-line bg-panel p-4">
          <div className="flex flex-wrap gap-2">
            {[`sizeof = ${layout.sizeof}`, `对齐 = ${layout.alignment}`, `padding = ${layout.padding} 字节`].map((c) => (
              <span key={c} className="rounded border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-sm text-accent">
                {c}
              </span>
            ))}
          </div>
          {layout.members.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
              {layout.members.map((m, i) => (
                <span key={i} className="font-mono text-xs text-ink">
                  {m.name || '(未命名)'} @ {m.offset}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">笔记四形态对照表</h3>
        <p className="mb-3 text-xs text-muted">
          同一个 struct header（type + length）在四种修饰下的布局 —— 全部由 layoutStruct 实时计算
        </p>
        <button
          type="button"
          onClick={loadExample}
          className="mb-3 rounded border border-accent bg-accent/15 px-3 py-1 text-xs text-accent transition-colors hover:bg-accent/25"
        >
          加载示例
        </button>
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-xs text-muted">
                <th className="px-3 py-2 font-semibold">形态</th>
                <th className="px-3 py-2 font-semibold">length 偏移</th>
                <th className="px-3 py-2 font-semibold">sizeof</th>
                <th className="px-3 py-2 font-semibold">对齐</th>
              </tr>
            </thead>
            <tbody>
              {FORM_ROWS.map((f) => {
                const l = layoutStruct(HEADER_EXAMPLE, f.opts)
                const length = l.members.find((m) => m.name === 'length')
                return (
                  <tr key={f.label} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs text-ink">{f.label}</td>
                    <td className="px-3 py-2 font-mono text-xs text-emerald-400">{length ? length.offset : '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-emerald-400">{l.sizeof}</td>
                    <td className="px-3 py-2 font-mono text-xs text-emerald-400">{l.alignment}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-3">
          <Callout tone="tip" title="aligned(4) 不挪动内部成员">
            aligned(4) 只要求整个结构体对象按 4 字节边界放置，不会把内部 length 从 offset 2 挪到 offset 4；尾部补齐是为了让数组中下一个元素仍满足对齐。
          </Callout>
          <Callout tone="tip" title="packed 管内部，aligned 管整体">
            packed → 管内部成员布局；aligned(N) → 管整个类型/对象对齐；aligned(4) ≠ 每个成员都按 4 字节对齐。
          </Callout>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">非对齐访问故障模拟器</h3>
        <p className="mb-3 text-xs text-muted">
          选一个内核，从当前布局里挑一个成员，看这次读取是安全、变慢还是直接炸
        </p>
        <div className="rounded-lg border border-line bg-panel p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label htmlFor="core-select" className="flex items-center gap-2 text-xs text-muted">
              内核
              <select id="core-select" value={core} onChange={(e) => setCore(e.target.value)} className={`font-mono ${inputCls}`}>
                {Object.keys(ALIGN_CORES).map((k) => (
                  <option key={k} value={k}>{CORE_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setTrap(!trap)}
              className={[
                'rounded border px-3 py-1 font-mono text-xs transition-colors',
                trap
                  ? 'border-warn bg-warn/15 text-warn'
                  : 'border-line bg-panel text-muted hover:border-warn hover:text-ink',
              ].join(' ')}
            >
              UNALIGN_TRP: {trap ? '使能' : '关闭'}
            </button>
            <label htmlFor="pick-member" className="flex items-center gap-2 text-xs text-muted">
              读取成员
              <select
                id="pick-member"
                value={pickIdx >= 0 ? pickIdx : ''}
                disabled={layout.members.length === 0}
                onChange={(e) => setPickMember(Number(e.target.value))}
                className={`font-mono ${inputCls} disabled:opacity-40`}
              >
                {layout.members.map((m, i) => (
                  <option key={i} value={i}>
                    {m.name || `成员 ${i + 1}`}（offset {m.offset} / {m.size} 字节）
                  </option>
                ))}
              </select>
            </label>
          </div>
          {outcome && picked ? (
            <>
              <div className={`rounded-lg border px-4 py-4 ${RESULT_META[outcome.result].box}`}>
                <p className={`text-2xl font-bold ${RESULT_META[outcome.result].text}`}>
                  {RESULT_META[outcome.result].icon} {RESULT_META[outcome.result].label}
                </p>
                <p className="mt-1 text-sm text-ink/85">{outcome.reason}</p>
                <p className="mt-2 font-mono text-xs text-muted">
                  {CORE_LABELS[core]} · 读 {picked.name || '成员'} @ offset {picked.offset} · {picked.size} 字节访问
                </p>
              </div>
              {outcome.result === 'fault' && (
                <div className="mt-3 space-y-3">
                  <CodeBlock title="解法：用 memcpy 做字节级读取" code={SAFE_READ_CODE} />
                  <Callout tone="warn" title="packed 前先想好目标内核">
                    协议、Flash 固定格式需要严格二进制布局时用 packed；但读 packed 成员前先想好目标内核是否支持非对齐访问。M0/M0+ 直接崩，M3/M4/M7 可用但有代价。
                  </Callout>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-muted">结构体为空 —— 先在上方编辑器添加成员，再来模拟访问。</p>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">三种 pack 写法 与 weak 符号</h3>
        <p className="mb-3 text-xs text-muted">写法对照查表；weak 部分切换三种链接场景看链接器怎么选</p>
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-xs text-muted">
                <th className="px-3 py-2 font-semibold">写法</th>
                <th className="px-3 py-2 font-semibold">作用域</th>
                <th className="px-3 py-2 font-semibold">说明</th>
              </tr>
            </thead>
            <tbody>
              {PACK_ROWS.map((r) => (
                <tr key={r.syntax} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 font-mono text-xs text-ink">{r.syntax}</td>
                  <td className="px-3 py-2 text-xs text-muted">{r.scope}</td>
                  <td className="px-3 py-2 text-xs text-muted">{r.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 rounded-lg border border-line bg-panel p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {Object.entries(WEAK_SCENES).map(([id, s]) => (
              <button
                key={id}
                type="button"
                onClick={() => setWeakScene(id)}
                className={[
                  'rounded border px-3 py-1 text-xs transition-colors',
                  weakScene === id
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-line bg-panel text-muted hover:border-accent hover:text-ink',
                ].join(' ')}
              >
                {s.label}
              </button>
            ))}
          </div>
          <WeakDiagram scene={WEAK_SCENES[weakScene]} />
        </div>
        <div className="mt-3">
          <CodeBlock title="HAL weak 回调示例" code={HAL_WEAK_CODE} />
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">AC5/AC6 兼容矩阵</h3>
        <p className="mb-3 text-xs text-muted">weak 写法在两代编译器之间的差异 —— 跨版本代码只认最后一条</p>
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-xs text-muted">
                <th className="px-3 py-2 font-semibold">写法</th>
                <th className="px-3 py-2 font-semibold">AC5</th>
                <th className="px-3 py-2 font-semibold">AC6</th>
                <th className="px-3 py-2 font-semibold">说明</th>
              </tr>
            </thead>
            <tbody>
              {WEAK_MATRIX.map((r) => (
                <tr key={r.syntax} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 font-mono text-xs text-ink">{r.syntax}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted">{r.ac5}</td>
                  <td className={`px-3 py-2 font-mono text-xs ${r.ac6.startsWith('✓') ? 'text-emerald-400' : 'text-danger'}`}>
                    {r.ac6}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-3">
          <Callout tone="tip" title="__weak 是关键字不是宏">
            AC5 的 __weak 是编译器关键字不是宏，#ifndef __weak 检测不到它。自有库建议定义 NVSLITE_WEAK 这类独立名称，别重定义生态已有名称。
          </Callout>
          <Callout tone="ok" title="跨版本公共代码的统一写法">
            AC5/AC6 公共代码推荐统一使用：__attribute__((weak))、__attribute__((packed))、__attribute__((aligned(x)))。
          </Callout>
        </div>
      </section>
    </ModuleShell>
  )
}
