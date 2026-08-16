import { MemoryStick, ScanSearch, Grid3x3, Terminal, Route, Printer } from 'lucide-react'
import ModuleShell from '../components/ModuleShell'
import PipelineDiagram from '../components/PipelineDiagram'
import Callout from '../components/Callout'

const LABS = [
  {
    id: 'memory',
    title: '内存布局实验室',
    icon: MemoryStick,
    desc: 'scatter 文件怎么把代码和数据摆进 Flash 与 RAM，FIXED/UNINIT 是什么',
  },
  {
    id: 'macros',
    title: '宏探测站',
    icon: ScanSearch,
    desc: '__CC_ARM 还是 __ARMCOMPILER_VERSION？一张表看懂编译器识别',
  },
  {
    id: 'structs',
    title: '结构体布局实验室',
    icon: Grid3x3,
    desc: 'packed 与 aligned 如何改变字节排布，非对齐访问为何会崩',
  },
  {
    id: 'diagnostics',
    title: '诊断控制台',
    icon: Terminal,
    desc: 'Warning 该修还是该屏蔽？AC5/AC6 两套 pragma 一次讲清',
  },
  {
    id: 'errno',
    title: 'errno 隧道',
    icon: Route,
    desc: 'errno 不是普通全局变量，跟 __aeabi_errno_addr() 走进线程安全',
  },
  {
    id: 'printf',
    title: 'printf 的旅程',
    icon: Printer,
    desc: 'MicroLIB 与完整库两条重定向链路，semihosting 为何卡死',
  },
]

export default function IntroModule({ onNavigate = () => {} }) {
  return (
    <ModuleShell
      kicker="Overview"
      title="从源码到芯片"
      subtitle="本课程把 Keil/Arm 工具链拆成 6 个可以动手玩的实验室。先看一遍构建管线，再挑一个模块开始。"
    >
      <section>
        <h3 className="mb-3 text-sm font-semibold text-ink">构建管线</h3>
        <PipelineDiagram onNavigate={onNavigate} />
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold text-ink">六个实验室</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {LABS.map((lab) => {
            const Icon = lab.icon
            return (
              <button
                key={lab.id}
                type="button"
                onClick={() => onNavigate(lab.id)}
                className="flex flex-col items-start gap-2 rounded-lg border border-line bg-panel p-4 text-left transition-all hover:-translate-y-0.5 hover:ring-1 hover:ring-accent"
              >
                <span className="flex items-center gap-2">
                  <Icon size={16} className="text-accent" />
                  <span className="text-sm font-bold text-ink">{lab.title}</span>
                </span>
                <span className="text-xs leading-relaxed text-muted">{lab.desc}</span>
              </button>
            )
          })}
        </div>
      </section>
      <Callout tone="tip" title="可复现性承诺">
        本工具所有数值都可复现：结构体偏移、宏取值、scatter 文本均由单元测试锁定，与 Arm 官方文档一致。
      </Callout>
    </ModuleShell>
  )
}
