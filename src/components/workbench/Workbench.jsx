// 工作台外壳：模块 = 单屏满高的「左操作 / 右展示」实验台。
// 桌面（lg+）：左操作面板固定 340px + 右画布自适应，两栏各自内部滚动，页面不滚动。
// 移动（<lg）：「操作 / 结果」Segmented 切换两个满屏视图，状态共享。见设计文档第 4 节。
import { useState } from 'react'
import { Segmented } from './controls'

export default function Workbench({ title, tagline, experiments, defaultExperiment }) {
  const [expId, setExpId] = useState(defaultExperiment ?? experiments[0].id)
  const [pane, setPane] = useState('control') // 移动端当前视图：control | canvas
  const exp = experiments.find((e) => e.id === expId) ?? experiments[0]

  return (
    <div className="flex min-h-[calc(100dvh-6.5rem)] flex-col lg:h-dvh lg:min-h-0">
      <header className="shrink-0 border-b border-line px-5 pb-3 pt-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight text-ink">{title}</h2>
            <p className="mt-0.5 text-xs text-muted">{tagline}</p>
          </div>
          <Segmented
            className="ml-auto"
            options={experiments.map(({ id, label }) => ({ id, label }))}
            value={exp.id}
            onChange={setExpId}
          />
        </div>
        {/* 移动端视图切换：桌面常驻分栏，不需要 */}
        <div className="mt-2.5 lg:hidden">
          <Segmented
            options={[
              { id: 'control', label: '操作' },
              { id: 'canvas', label: '结果' },
            ]}
            value={pane}
            onChange={setPane}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside
          className={`${
            pane === 'control' ? 'block' : 'hidden'
          } border-b border-line bg-panel p-4 lg:block lg:h-full lg:overflow-y-auto lg:border-b-0 lg:border-r`}
        >
          {exp.control}
        </aside>
        <section className={`${pane === 'canvas' ? 'block' : 'hidden'} p-4 lg:block lg:h-full lg:overflow-y-auto lg:p-6`}>
          {exp.canvas}
        </section>
      </div>
    </div>
  )
}
