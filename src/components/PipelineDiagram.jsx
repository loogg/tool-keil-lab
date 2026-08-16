import { Fragment } from 'react'

const STAGES = [
  { id: 'source', label: '源码', sub: '.c / .h' },
  { id: 'compile', label: '编译', sub: 'armcc / armclang', moduleId: 'macros' },
  { id: 'link', label: '链接', sub: 'armlink + scatter', moduleId: 'memory' },
  { id: 'image', label: '固件镜像', sub: '.axf / .hex' },
  { id: 'flash', label: '烧录', sub: 'Flash 存储' },
  { id: 'startup', label: '启动搬运', sub: 'RW 复制 / ZI 清零', moduleId: 'memory' },
  { id: 'main', label: 'main()', sub: '应用运行' },
]

const CARD_CLS = 'rounded-lg border border-line bg-panel px-3 py-2'

export default function PipelineDiagram({ onNavigate = () => {} }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-y-4">
        {STAGES.map((stage, i) => (
          <Fragment key={stage.id}>
            {i > 0 && (
              <span aria-hidden="true" className="px-1 font-mono text-sm text-muted">
                →
              </span>
            )}
            {stage.moduleId ? (
              <button
                type="button"
                onClick={() => onNavigate(stage.moduleId)}
                className={`group relative ${CARD_CLS} text-left transition-all hover:-translate-y-0.5 hover:ring-1 hover:ring-accent`}
              >
                <span className="block text-sm font-bold text-ink">{stage.label}</span>
                <span className="block font-mono text-[11px] text-muted">{stage.sub}</span>
                <span className="absolute -top-2.5 right-1 rounded bg-accent px-1.5 py-px text-[10px] font-semibold text-bg opacity-0 transition-opacity group-hover:opacity-100">
                  进入模块
                </span>
              </button>
            ) : (
              <div className={CARD_CLS}>
                <div className="text-sm font-bold text-ink">{stage.label}</div>
                <div className="font-mono text-[11px] text-muted">{stage.sub}</div>
              </div>
            )}
          </Fragment>
        ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted">
        编译阶段决定：宏、属性、警告 → 链接阶段决定：内存布局 → 运行库决定：errno 与 printf 去向
      </p>
    </div>
  )
}
