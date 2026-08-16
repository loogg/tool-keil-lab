import { useMemo, useState } from 'react'
import ModuleShell from '../components/ModuleShell'
import CodeBlock from '../components/CodeBlock'
import Callout from '../components/Callout'
import { createDefaultModel, placeItem, regionUsage } from '../lib/memoryMap'
import { generateScatter } from '../lib/scatterGen'

// 地址十六进制：8 位补零大写
const hex = (n) => '0x' + n.toString(16).toUpperCase().padStart(8, '0')

// 字节数自适应显示
const fmtSize = (n) => {
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  return `${kb % 1 === 0 ? kb : kb.toFixed(1)} KB`
}

// section 清单里的 size 统一按 KB 显示
const fmtKB = (n) => `${n / 1024} KB`

const ATTR_BADGE = {
  FIXED: 'border-warn/40 bg-warn/10 text-warn',
  UNINIT: 'border-accent-2/40 bg-accent-2/10 text-accent-2',
}

export default function MemoryLabModule() {
  const [model, setModel] = useState(createDefaultModel)
  const [selected, setSelected] = useState(null) // 选中的 item id
  const [lastMoved, setLastMoved] = useState(null) // 上次移动目标区域名（用于 scatter 高亮）

  const regions = [...model.regions].sort((a, b) => a.base - b.base)
  const scatterCode = generateScatter(model)

  // 把上次移动的目标区域块（区域头 + 内容行）映射为 CodeBlock 高亮行号
  const highlightLines = useMemo(() => {
    if (!lastMoved) return []
    const hit = []
    let inside = false
    scatterCode.split('\n').forEach((ln, i) => {
      const t = ln.trim()
      if (inside) {
        if (t === '}') inside = false
        else hit.push(i + 1)
        return
      }
      if (t.startsWith(lastMoved + ' ')) {
        inside = true
        hit.push(i + 1)
      }
    })
    return hit
  }, [scatterCode, lastMoved])

  const place = (regionName) => {
    if (!selected) return
    setModel(placeItem(model, selected, regionName))
    setLastMoved(regionName)
  }

  const reset = () => {
    setModel(createDefaultModel())
    setSelected(null)
    setLastMoved(null)
  }

  return (
    <ModuleShell
      kicker="Memory Layout"
      title="内存布局实验室"
      subtitle="scatter 文件决定每段代码和数据落在哪块 Flash / RAM。在清单里选中一个 section，点击目标内存条即可移动，下方 scatter 文件实时重写。"
    >
      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">芯片内存条</h3>
        <p className="mb-3 text-xs text-muted">
          {selected
            ? '已选中 section：点击下方目标内存条即可放入'
            : '按地址排列的执行区域。先在下方 section 清单里选中一行'}
        </p>
        <div className="space-y-2">
          {regions.map((region) => {
            const { used, limit, overflow } = regionUsage(model, region.name)
            const pct = (used / limit) * 100
            const clickable = Boolean(selected)
            return (
              <button
                key={region.name}
                type="button"
                disabled={!clickable}
                onClick={() => place(region.name)}
                className={[
                  'block w-full rounded-lg border bg-panel p-3 text-left transition-colors',
                  overflow ? 'border-danger/70' : 'border-line',
                  clickable ? 'cursor-pointer hover:border-accent' : 'cursor-default',
                ].join(' ')}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-ink">{region.name}</span>
                    {region.attrs.fixed && (
                      <span className={`rounded border px-1 text-[10px] font-semibold tracking-wide ${ATTR_BADGE.FIXED}`}>
                        FIXED
                      </span>
                    )}
                    {region.attrs.uninit && (
                      <span className={`rounded border px-1 text-[10px] font-semibold tracking-wide ${ATTR_BADGE.UNINIT}`}>
                        UNINIT
                      </span>
                    )}
                    <span className="hidden truncate text-xs text-muted sm:inline">{region.note}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
                    <span>
                      {hex(region.base)} – {hex(region.base + region.maxSize - 1)}
                    </span>
                    {clickable && (
                      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">放入 →</span>
                    )}
                  </div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-2">
                  <div
                    className={`h-full rounded-full ${overflow ? 'bg-danger' : 'bg-accent'}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[11px]">
                  <span className={overflow ? 'text-danger' : 'text-muted'}>
                    {fmtSize(used)} / {fmtSize(limit)}（{pct.toFixed(1)}%）
                  </span>
                  {overflow && (
                    <span className="font-semibold text-danger">⚠ 超出 {used - limit} 字节</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">section 清单</h3>
          <button
            type="button"
            onClick={reset}
            className="rounded border border-line bg-panel px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-ink"
          >
            恢复默认
          </button>
        </div>
        <p className="mb-3 text-xs text-muted">
          点击一行选中，再点击上方目标内存条即可移动；再次点击已选中的行取消选择。
        </p>
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          {model.items.map((item) => {
            const isSel = selected === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(isSel ? null : item.id)}
                className={[
                  'flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left transition-colors last:border-b-0',
                  isSel ? 'bg-accent/10 ring-1 ring-inset ring-accent' : 'hover:bg-panel-2',
                ].join(' ')}
              >
                <span className={`font-mono text-xs ${isSel ? 'text-accent' : 'text-ink'}`}>
                  {item.label}
                </span>
                <span className="hidden truncate text-xs text-muted md:inline">{item.detail}</span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <span className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                    {item.region}
                  </span>
                  <span className="w-16 text-right font-mono text-[11px] text-muted">
                    {fmtKB(item.size)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">scatter 实时回显</h3>
        <p className="mb-3 text-xs text-muted">
          移动 section 后这里实时重新生成；真实工程里这就是 armlink 的输入
        </p>
        <CodeBlock title="target.sct" code={scatterCode} highlightLines={highlightLines} />
      </section>

      <Callout tone="tip" title="为什么网页资源放 Data Flash">
        GD32 的 Flash 分 Code 与 Data 两块，字库/网页这类大块只读数据不要求执行速度，放 Data
        Flash 能给代码腾地方。
      </Callout>
    </ModuleShell>
  )
}
