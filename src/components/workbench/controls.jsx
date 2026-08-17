// 工作台标准控件集：改版后的模块只允许使用这些控件，质感由系统统一保证。
// 规格见 docs/superpowers/specs/2026-08-17-keil-lab-redesign-design.md 第 3.3 节。

// T2 微标签：11px / 600 / 全大写
export function SectionLabel({ children, className = '' }) {
  return (
    <div className={`text-[11px] font-semibold uppercase tracking-[1px] text-muted ${className}`}>
      {children}
    </div>
  )
}

// 两级按钮：primary = 唯一强调色；ghost = 描边
export function Button({ variant = 'ghost', children, className = '', ...props }) {
  const look =
    variant === 'primary'
      ? 'bg-accent font-semibold text-[#0b0b14] hover:bg-accent/85'
      : 'border border-line-strong bg-transparent text-secondary hover:border-accent/60 hover:text-ink'
  return (
    <button
      type="button"
      className={`rounded-md px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${look} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

// 图标按钮（成员行的上移/下移/删除）
export function IconButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`rounded-md border border-line bg-panel-2 p-1.5 text-muted transition-colors hover:border-accent/60 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-line disabled:hover:text-muted ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

// 开关：纯滑轨，与 FieldRow 组合使用（标签在行内，避免按钮嵌按钮）。
// role=switch + aria-label 便于自动化测试定位
export function Switch({ label, checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-[#26262b]'
      }`}
    >
      <span
        className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-white transition-all ${
          checked ? 'left-[16px]' : 'left-[2px]'
        }`}
      />
    </button>
  )
}

// 分段选择：实验切换器 / 场景切换 / 移动端「操作·结果」视图切换
export function Segmented({ options, value, onChange, className = '' }) {
  return (
    <div className={`inline-flex flex-wrap gap-0.5 rounded-md border border-line bg-panel-2 p-0.5 ${className}`}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={`whitespace-nowrap rounded-[5px] px-2.5 py-1 text-xs transition-colors ${
              on ? 'bg-accent font-semibold text-[#0b0b14]' : 'text-secondary hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// 字段行：左标签右控件
export function FieldRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-secondary">{label}</span>
      {children}
    </div>
  )
}

// 下拉与输入框：等宽、发丝描边、聚焦亮 accent
const fieldCls =
  'rounded-md border border-line bg-panel-2 px-2 py-1.5 font-mono text-xs text-ink outline-none transition-colors focus:border-accent disabled:opacity-40'

export function Select({ className = '', ...props }) {
  return <select className={`${fieldCls} ${className}`} {...props} />
}

export function TextInput({ className = '', ...props }) {
  return <input type="text" spellCheck={false} className={`${fieldCls} ${className}`} {...props} />
}

// 指标块：结果区专用，T4 等宽大数字
const STAT_TONES = {
  default: 'text-ink',
  accent: 'text-accent',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
}

export function StatTile({ label, value, sub, tone = 'default' }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-panel px-3.5 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[1px] text-muted">{label}</div>
      <div className={`mt-1.5 truncate font-mono text-[22px] font-semibold leading-none ${STAT_TONES[tone]}`}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-[11px] text-muted">{sub}</div> : null}
    </div>
  )
}
