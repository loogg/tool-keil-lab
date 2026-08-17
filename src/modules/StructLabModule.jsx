import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import Workbench from '../components/workbench/Workbench'
import {
  Button, FieldRow, IconButton, SectionLabel, Segmented, Select, StatTile, Switch, TextInput,
} from '../components/workbench/controls'
import { DrawerTrigger, Principle, RefTable } from '../components/workbench/Principle'
import CodeBlock from '../components/CodeBlock'
import { layoutStruct } from '../lib/structLayout'
import { accessOutcome, ALIGN_CORES } from '../lib/abiLayout'

// ---------- 常量与示例 ----------

const TYPE_KEYS = ['uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'char[4]']
const toLayoutType = (key) => (key === 'char[4]' ? { array: 4 } : key)
const typeToC = (type, name) =>
  typeof type === 'object' && type.array ? `char ${name}[${type.array}]` : `${type} ${name}`

// 通用嵌入式场景示例（STM32 生态常见数据对象，不绑定任何私人笔记）
const EXAMPLES = {
  sensor_frame: {
    label: 'sensor_frame · 传感器数据帧',
    members: [
      { name: 'flags', type: 'uint8_t' },
      { name: 'timestamp', type: 'uint32_t' },
      { name: 'x', type: 'uint16_t' },
      { name: 'y', type: 'uint16_t' },
      { name: 'z', type: 'uint16_t' },
    ],
  },
  uart_packet: {
    label: 'uart_packet · 串口协议包',
    members: [
      { name: 'type', type: 'uint8_t' },
      { name: 'length', type: 'uint16_t' },
      { name: 'data', type: 'char[4]' },
    ],
  },
  gps_point: {
    label: 'gps_point · GPS 定位点',
    members: [
      { name: 'lat', type: 'uint32_t' },
      { name: 'lon', type: 'uint32_t' },
      { name: 'alt', type: 'uint16_t' },
    ],
  },
}

const MEMBER_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b']
const BYTE_COLS = 8
const hexOffset = (n) => '0x' + n.toString(16).padStart(2, '0')

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

const RESULT_META = {
  ok: { icon: '✓', label: '访问安全', box: 'border-ok/40 bg-ok/10', text: 'text-ok' },
  slow: { icon: '⚠', label: '能跑但有代价', box: 'border-warn/40 bg-warn/10', text: 'text-warn' },
  fault: { icon: '✗', label: '访问故障', box: 'border-danger/40 bg-danger/10', text: 'text-danger' },
}

// weak 符号三场景（STM32 HAL 公开机制，通用认知）
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
    result: '执行 HAL 默认空实现 —— STM32 回调「定义同名函数即可重写」的原因',
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

const OBJ_SYM_CLS = { strong: 'text-ok', weak: 'text-warn', none: 'text-muted' }

const WEAK_MATRIX = [
  { syntax: '__weak', ac5: '✓ 原生关键字', ac6: '✗ 不应依赖', note: 'AC5 专属写法' },
  { syntax: '__attribute__((weak))', ac5: '✓', ac6: '✓', note: '跨版本推荐' },
  { syntax: '__WEAK（CMSIS）', ac5: '✓', ac6: '✓', note: '用 CMSIS 时优先' },
]

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

// ---------- 可视化组件 ----------

// 字节网格：每行 8 字节，成员按序号取数据色板，padding 用斜纹
function ByteGrid({ layout, cell = 30, showLegend = true }) {
  if (layout.bytes.length === 0) {
    return <p className="text-xs text-muted">结构体为空 —— 在左侧添加成员，网格实时画出每个字节的归属。</p>
  }
  const rows = []
  for (let i = 0; i < layout.bytes.length; i += BYTE_COLS) rows.push(layout.bytes.slice(i, i + BYTE_COLS))
  return (
    <div className="min-w-0 space-y-1.5 overflow-x-auto">
      {rows.map((row, r) => (
        <div key={r} className="flex items-center gap-1.5">
          <span className="w-9 shrink-0 text-right font-mono text-[11px] text-muted">{hexOffset(r * BYTE_COLS)}</span>
          {row.map((b, i) => {
            if (b.kind === 'padding') {
              return (
                <div
                  key={i}
                  title="padding"
                  className="pad-stripes shrink-0 rounded border border-line"
                  style={{ width: cell, height: cell }}
                />
              )
            }
            const m = layout.members[b.memberIndex]
            return (
              <div
                key={i}
                title={m.name || `成员 ${b.memberIndex + 1}`}
                className="flex shrink-0 items-center justify-center rounded font-mono text-[11px] font-semibold text-white/90"
                style={{ width: cell, height: cell, background: MEMBER_COLORS[b.memberIndex % MEMBER_COLORS.length] }}
              >
                {(m.name || '?').charAt(0)}
              </div>
            )
          })}
        </div>
      ))}
      {showLegend && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-muted">
          {layout.members.map((m, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ background: MEMBER_COLORS[i % MEMBER_COLORS.length] }}
              />
              <span className="font-mono">{m.name || `成员 ${i + 1}`}</span>
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="pad-stripes inline-block h-3 w-3 rounded-sm border border-line" />
            <span className="font-mono">padding</span>
          </span>
        </div>
      )}
    </div>
  )
}

// 成员编辑器（实验①的操作面板）
function MemberEditor({ members, onUpdate, onRemove, onMove, onAdd }) {
  return (
    <div className="space-y-1.5">
      {members.map((m, i) => (
        <div key={m.id} className="flex items-center gap-1.5">
          <span className="w-4 shrink-0 text-center font-mono text-[11px] text-muted">{i}</span>
          <TextInput
            value={m.name}
            onChange={(e) => onUpdate(m.id, { name: e.target.value })}
            placeholder="成员名"
            className="min-w-0 flex-1"
          />
          <Select value={m.type} onChange={(e) => onUpdate(m.id, { type: e.target.value })}>
            {TYPE_KEYS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
          <div className="flex shrink-0 gap-1">
            <IconButton title="上移" disabled={i === 0} onClick={() => onMove(m.id, -1)}>
              <ArrowUp size={12} />
            </IconButton>
            <IconButton title="下移" disabled={i === members.length - 1} onClick={() => onMove(m.id, 1)}>
              <ArrowDown size={12} />
            </IconButton>
            <IconButton title="删除" onClick={() => onRemove(m.id)}>
              <Trash2 size={12} />
            </IconButton>
          </div>
        </div>
      ))}
      <Button variant="ghost" onClick={onAdd} className="flex w-full items-center justify-center gap-1">
        <Plus size={13} />
        添加成员
      </Button>
    </div>
  )
}

// weak 场景图示：两个 .o 卡 → 链接器 → 结果
function WeakDiagram({ scene }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-col gap-2">
        {scene.objs.map((o) => (
          <div key={o.file} className="rounded-lg border border-line bg-panel px-3 py-2">
            <div className="font-mono text-[11px] text-muted">{o.file}</div>
            <div className={`font-mono text-xs ${OBJ_SYM_CLS[o.kind]}`}>{o.sym}</div>
          </div>
        ))}
      </div>
      <span className="font-mono text-lg text-muted">→</span>
      <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-center">
        <div className="text-xs font-semibold text-accent">链接器</div>
        <div className="mt-1 text-[11px] text-secondary">{scene.linker}</div>
      </div>
      <span className="font-mono text-lg text-muted">→</span>
      <div
        className={`max-w-60 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
          scene.ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-danger/40 bg-danger/10 text-danger'
        }`}
      >
        {scene.ok ? '✓ ' : '✗ '}
        {scene.result}
      </div>
    </div>
  )
}

// 生成 C 代码
function toC(layout, structName, packed) {
  if (layout.members.length === 0) return '/* 结构体为空 */'
  const head = packed ? `struct __attribute__((packed)) ${structName}` : `struct ${structName}`
  const body = layout.members.map((m) => `    ${typeToC(m.type, m.name || 'field')};  /* @${m.offset} */`)
  return `${head} {\n${body.join('\n')}\n};  /* sizeof = ${layout.sizeof} */`
}

// ---------- 模块 ----------

export default function StructLabModule() {
  // 共享结构体状态：实验①②③共用同一份成员定义
  const [exampleId, setExampleId] = useState('sensor_frame')
  const [members, setMembers] = useState(() =>
    EXAMPLES.sensor_frame.members.map((m, i) => ({ id: `m${i}`, ...m })),
  )
  const [nextId, setNextId] = useState(EXAMPLES.sensor_frame.members.length)
  const [packed, setPacked] = useState(false)
  const [alignedStr, setAlignedStr] = useState('')
  // 实验③
  const [core, setCore] = useState('cortex-m0')
  const [trap, setTrap] = useState(false)
  const [pickMember, setPickMember] = useState(0)
  // 实验④
  const [weakScene, setWeakScene] = useState('both')

  const aligned = alignedStr === '' ? null : Number(alignedStr)
  const layoutMembers = members.map((m) => ({ name: m.name, type: toLayoutType(m.type) }))
  const layout = layoutStruct(layoutMembers, { packed, aligned })
  const structName = exampleId || 'demo'

  const loadExample = (key) => {
    if (!key) return
    setExampleId(key)
    setMembers(EXAMPLES[key].members.map((m, i) => ({ id: `m${i}`, ...m })))
    setNextId(EXAMPLES[key].members.length)
    setPacked(false)
    setAlignedStr('')
    setPickMember(0)
  }
  const markCustom = () => setExampleId('')
  const updateMember = (id, patch) => {
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)))
    markCustom()
  }
  const removeMember = (id) => {
    setMembers((ms) => ms.filter((m) => m.id !== id))
    markCustom()
  }
  const moveMember = (id, dir) => {
    setMembers((ms) => {
      const i = ms.findIndex((m) => m.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= ms.length) return ms
      const next = [...ms]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    markCustom()
  }
  const addMember = () => {
    setMembers((ms) => [...ms, { id: `m${nextId}`, name: `field${nextId}`, type: 'uint8_t' }])
    setNextId(nextId + 1)
    markCustom()
  }

  // 实验③：挑中的成员被删后取安全索引
  const pickIdx = layout.members.length > 0 ? Math.min(pickMember, layout.members.length - 1) : -1
  const picked = pickIdx >= 0 ? layout.members[pickIdx] : null
  const outcome = picked
    ? accessOutcome({ core, accessSize: picked.size, offset: picked.offset, unalignTrap: trap })
    : null

  const exampleSelect = (
    <Select
      value={exampleId}
      onChange={(e) => loadExample(e.target.value)}
      className="w-full"
      aria-label="示例"
    >
      <option value="">自定义（正在编辑）</option>
      {Object.entries(EXAMPLES).map(([k, ex]) => (
        <option key={k} value={k}>{ex.label}</option>
      ))}
    </Select>
  )

  // ---- 实验① 字节网格 ----
  const gridControl = (
    <div className="space-y-5">
      <div>
        <SectionLabel className="mb-2">Members · 成员</SectionLabel>
        <MemberEditor
          members={members}
          onUpdate={updateMember}
          onRemove={removeMember}
          onMove={moveMember}
          onAdd={addMember}
        />
      </div>
      <div>
        <SectionLabel className="mb-2">Modifiers · 修饰</SectionLabel>
        <div className="space-y-2">
          <FieldRow
            label={
              <>
                packed
                <Principle title="packed 做什么">
                  取消成员间的自然对齐，所有成员紧挨排列（align 全部按 1），消除内部空隙。代价是非对齐访问风险与部分内核上的性能损失。
                </Principle>
              </>
            }
          >
            <Switch label="packed" checked={packed} onChange={setPacked} />
          </FieldRow>
          <FieldRow
            label={
              <>
                aligned
                <Principle title="aligned(N) 做什么">
                  只管整个结构体对象按 N 字节边界放置，不改动内部成员布局；N 小于自然对齐时无效。
                </Principle>
              </>
            }
          >
            <Select value={alignedStr} onChange={(e) => setAlignedStr(e.target.value)} aria-label="aligned">
              <option value="">无</option>
              {['1', '2', '4', '8'].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </Select>
          </FieldRow>
        </div>
      </div>
      <div>
        <SectionLabel className="mb-2">Example · 示例</SectionLabel>
        {exampleSelect}
      </div>
    </div>
  )

  const gridCanvas = (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SectionLabel>Byte Grid · 字节网格</SectionLabel>
        <Principle title="为什么会有空隙">
          每个成员的起始地址必须是其自身大小的整数倍（自然对齐）：uint32_t 必须落在 4 的倍数地址上，前面的空档只能填 padding。
        </Principle>
        <span className="ml-auto font-mono text-xs text-accent">sizeof = {layout.sizeof}</span>
      </div>
      <div className="rounded-lg border border-line bg-panel p-4">
        <ByteGrid layout={layout} />
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="sizeof" value={`${layout.sizeof} B`} tone="accent" sub={`struct ${structName}`} />
        <StatTile
          label="padding"
          value={`${layout.padding} B`}
          tone={layout.padding > 0 ? 'warn' : 'ok'}
          sub={layout.sizeof > 0 ? `占 ${((layout.padding / layout.sizeof) * 100).toFixed(1)}%` : undefined}
        />
        <StatTile label="alignment" value={`${layout.alignment} B`} sub="整体对齐" />
        <StatTile label="members" value={layout.members.length} sub="成员数" />
      </div>
      <CodeBlock title={`${structName}.c`} code={toC(layout, structName, packed)} />
    </div>
  )

  // ---- 实验② 四形态对照 ----
  const formsControl = (
    <div className="space-y-5">
      <div>
        <SectionLabel className="mb-2">Comparison · 对照目标</SectionLabel>
        {exampleSelect}
        <p className="mt-2 text-xs leading-relaxed text-muted">
          当前结构体 {layout.members.length} 个成员。四种形态全部由布局引擎实时计算，不是静态表格。
        </p>
      </div>
      <DrawerTrigger label="pack / aligned 细节" title="pack / aligned 细节">
        <p>
          <strong className="text-ink">aligned(4) 不挪动内部成员</strong> —— 它只要求整个结构体对象按 4
          字节边界放置；尾部补齐是为了让数组中下一个元素仍满足对齐。
        </p>
        <p>
          <strong className="text-ink">packed 管内部，aligned 管整体</strong> —— packed 改变成员布局；aligned(N)
          只改类型对齐。aligned(4) ≠ 每个成员都按 4 字节对齐。
        </p>
        <p>
          写法：<code className="font-mono text-ink">#pragma pack(push, 1)</code>（区间）、
          <code className="font-mono text-ink"> __attribute__((packed))</code>（单类型，AC5/AC6/GCC 通用）、
          <code className="font-mono text-ink"> __packed</code>（AC5 原生，语义更宽，勿与 attribute 混同）。
        </p>
      </DrawerTrigger>
    </div>
  )

  const formsCanvas =
    layoutMembers.length === 0 ? (
      <p className="text-xs text-muted">结构体为空 —— 回到「字节网格」实验添加成员。</p>
    ) : (
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {FORM_ROWS.map((f) => (
          <div key={f.label} className="min-w-0 rounded-lg border border-line bg-panel p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-secondary">{f.label}</span>
              <span className="font-mono text-xs text-accent">
                sizeof = {layoutStruct(layoutMembers, f.opts).sizeof}
              </span>
            </div>
            <ByteGrid layout={layoutStruct(layoutMembers, f.opts)} cell={18} showLegend={false} />
          </div>
        ))}
      </div>
    )

  // ---- 实验③ 非对齐访问 ----
  const accessControl = (
    <div className="space-y-5">
      <FieldRow
        label={
          <>
            内核
            <Principle title="内核之间差在哪">
              Cortex-M0/M0+ 硬件不支持非对齐多字节访问，直接故障；M3/M4/M7/M33 支持但拆成多次总线访问，有性能代价。
            </Principle>
          </>
        }
      >
        <Select value={core} onChange={(e) => setCore(e.target.value)} aria-label="内核">
          {Object.keys(ALIGN_CORES).map((k) => (
            <option key={k} value={k}>{CORE_LABELS[k]}</option>
          ))}
        </Select>
      </FieldRow>
      <FieldRow label="读取成员">
        <Select
          value={pickIdx >= 0 ? pickIdx : ''}
          disabled={layout.members.length === 0}
          onChange={(e) => setPickMember(Number(e.target.value))}
          aria-label="读取成员"
        >
          {layout.members.map((m, i) => (
            <option key={i} value={i}>
              {m.name || `成员 ${i + 1}`} @ {m.offset}
            </option>
          ))}
        </Select>
      </FieldRow>
      <FieldRow
        label={
          <>
            UNALIGN_TRP
            <Principle title="UNALIGN_TRP 是什么">
              CCR.UNALIGN_TRP 使能后，硬件把非对齐访问捕获为 UsageFault —— 开发期用来暴露隐患，产品代码通常关闭。
            </Principle>
          </>
        }
      >
        <Switch label="UNALIGN_TRP" checked={trap} onChange={setTrap} />
      </FieldRow>
      <DrawerTrigger label="memcpy 安全读法" title="packed 成员的安全读取">
        <CodeBlock title="safe_read.c" code={SAFE_READ_CODE} />
        <p>
          协议、Flash 固定格式需要严格二进制布局时用 packed；但读 packed
          成员前先确认目标内核是否支持非对齐访问 —— M0/M0+ 直接崩，M3/M4/M7 可用但有代价。
        </p>
      </DrawerTrigger>
    </div>
  )

  const accessCanvas = (
    <div className="space-y-4">
      {outcome && picked ? (
        <div className={`rounded-lg border px-4 py-4 ${RESULT_META[outcome.result].box}`}>
          <p className={`text-xl font-bold ${RESULT_META[outcome.result].text}`}>
            {RESULT_META[outcome.result].icon} {RESULT_META[outcome.result].label}
          </p>
          <p className="mt-1 text-sm text-secondary">{outcome.reason}</p>
          <p className="mt-2 font-mono text-xs text-muted">
            {CORE_LABELS[core]} · 读 {picked.name || '成员'} @ offset {picked.offset} · {picked.size} 字节访问
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted">结构体为空 —— 回到「字节网格」实验添加成员，再来模拟访问。</p>
      )}
      <div>
        <SectionLabel className="mb-2">Core Matrix · 内核支持矩阵</SectionLabel>
        <RefTable
          head={['内核', '硬件非对齐访问']}
          rows={Object.entries(ALIGN_CORES).map(([k, v]) => [
            CORE_LABELS[k],
            v.unalignedSupport ? '✓ 支持（有代价）' : '✗ 故障',
          ])}
        />
      </div>
    </div>
  )

  // ---- 实验④ weak 符号 ----
  const weakControl = (
    <div className="space-y-5">
      <div>
        <SectionLabel className="mb-2 flex items-center gap-1.5">
          Link Scene · 链接场景
          <Principle title="什么是 weak 符号">
            弱符号可被同名强符号覆盖；只有弱符号时链接照常通过并采用弱实现。STM32 HAL 的回调机制正是靠它。
          </Principle>
        </SectionLabel>
        <Segmented
          className="w-full"
          options={Object.entries(WEAK_SCENES).map(([id, s]) => ({ id, label: s.label }))}
          value={weakScene}
          onChange={setWeakScene}
        />
      </div>
      <DrawerTrigger label="AC5/AC6 兼容矩阵" title="weak 写法的 AC5/AC6 兼容性">
        <RefTable
          head={['写法', 'AC5', 'AC6', '说明']}
          rows={WEAK_MATRIX.map((r) => [r.syntax, r.ac5, r.ac6, r.note])}
        />
        <p>
          AC5 的 <code className="font-mono text-ink">__weak</code> 是编译器关键字不是宏，
          <code className="font-mono text-ink">#ifndef __weak</code> 检测不到它。跨版本公共代码统一用
          <code className="font-mono text-ink">__attribute__((weak))</code>。
        </p>
      </DrawerTrigger>
      <DrawerTrigger label="HAL 回调示例" title="HAL weak 回调示例">
        <CodeBlock title="hal_weak.c" code={HAL_WEAK_CODE} />
      </DrawerTrigger>
    </div>
  )

  const weakCanvas = (
    <div className="space-y-4">
      <WeakDiagram scene={WEAK_SCENES[weakScene]} />
      <p className="max-w-xl text-xs leading-relaxed text-muted">
        链接器按「强符号优先、弱符号兜底」解析同名符号 —— 上面切换三种场景，看结果如何变化。
      </p>
    </div>
  )

  return (
    <Workbench
      title="结构体布局实验室"
      tagline="左边改成员，右边看布局 —— 对齐、填充、非对齐访问与 weak 符号，全部可见"
      experiments={[
        { id: 'grid', label: '字节网格', control: gridControl, canvas: gridCanvas },
        { id: 'forms', label: '四形态', control: formsControl, canvas: formsCanvas },
        { id: 'access', label: '非对齐访问', control: accessControl, canvas: accessCanvas },
        { id: 'weak', label: 'weak 符号', control: weakControl, canvas: weakCanvas },
      ]}
    />
  )
}
