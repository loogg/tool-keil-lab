import { Fragment, useState } from 'react'
import ModuleShell from '../components/ModuleShell'
import CodeBlock from '../components/CodeBlock'
import Callout from '../components/Callout'
import {
  CHAINS, FPUTC_SNIPPET, SYS_WRITE_SNIPPET, NO_SEMIHOSTING, STUBS, TOOLCHAIN_RETARGET, LIB_CHOICE,
} from '../data/stdioData'

const LIB_TABS = [
  { id: 'microlib', label: 'MicroLIB' },
  { id: 'full', label: '完整 Arm C Library' },
]

const CHANNEL_TABS = [
  { id: 'uart', label: 'UART 串口' },
  { id: 'itm', label: 'ITM/SWO' },
]

// ITM 通道：底层发送改走 ITM_SendChar，重定向示例代码随之替换
const ITM_FPUTC_SNIPPET = `/* ITM 通道：fputc 把字符直接推给 ITM */
int fputc(int ch, FILE *f)
{
    (void)f;
    ITM_SendChar(ch);
    return 1;
}`

const ITM_SYS_WRITE_SNIPPET = `/* ITM 通道：_sys_write 逐字符推给 ITM，返回 0 = 全部写出 */
int _sys_write(FILEHANDLE fh, const unsigned char *buf,
               unsigned len, int mode)
{
    (void)fh; (void)mode;
    for (unsigned i = 0; i < len; i++) ITM_SendChar(buf[i]);
    return 0;
}`

// 通用切换按钮：选中态描边高亮，未选中悬停提示
function TabButton({ active, disabled = false, onClick, children }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        'rounded border px-3 py-1 text-xs transition-colors',
        active
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-line bg-panel text-muted hover:border-accent hover:text-ink',
        disabled ? 'cursor-not-allowed opacity-40' : '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// 链路节点配色：semihosting 链整体警示红，常规链首节点与末端硬件高亮
const chainNodeCls = (idx, isLast, semi) => {
  if (semi) return 'border-danger/40 bg-danger/10 text-danger'
  if (isLast) return 'border-accent-2/40 bg-accent-2/10 text-accent-2'
  if (idx === 0) return 'border-accent/40 bg-accent/10 text-accent'
  return 'border-line bg-panel-2 text-ink'
}

export default function PrintfModule() {
  // —— 调用链卡片 ——
  const [lib, setLib] = useState('microlib')
  const [semi, setSemi] = useState(false)
  const [channel, setChannel] = useState('uart')

  // —— 三工具链对照 ——
  const [toolchainId, setToolchainId] = useState('keil')

  const chain = semi
    ? CHAINS.semihosting
    : channel === 'itm'
      ? [...CHAINS[lib].slice(0, -1), 'ITM/SWO 调试口']
      : CHAINS[lib]

  const snippet = lib === 'microlib'
    ? channel === 'itm' ? ITM_FPUTC_SNIPPET : FPUTC_SNIPPET
    : channel === 'itm' ? ITM_SYS_WRITE_SNIPPET : SYS_WRITE_SNIPPET

  const snippetTitle = lib === 'microlib'
    ? `MicroLIB 重定向入口 · fputc${channel === 'itm' ? ' · ITM' : ''}`
    : `完整库重定向入口 · _sys_write${channel === 'itm' ? ' · ITM' : ''}`

  const toolchain = TOOLCHAIN_RETARGET.find((t) => t.id === toolchainId)

  return (
    <ModuleShell
      kicker="printf"
      title="printf 的旅程"
      subtitle="printf 不是直接写串口：它沿着库内调用链走到重定向入口，最终落在 UART、ITM 或调试器 semihosting。切换库与通道看链路变化，对照桩函数契约，比较三大工具链的重定向入口。"
    >
      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">printf 调用链</h3>
        <p className="mb-3 text-xs text-muted">
          选择 C 库与输出通道，看 printf 实际走哪条链；打开 semihosting 会切到调试器代理 I/O 链
        </p>
        <div className="rounded-lg border border-line bg-panel p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">C 库</span>
              {LIB_TABS.map((t) => (
                <TabButton key={t.id} active={lib === t.id} disabled={semi} onClick={() => setLib(t.id)}>
                  {t.label}
                </TabButton>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">输出通道</span>
              {CHANNEL_TABS.map((t) => (
                <TabButton key={t.id} active={channel === t.id} disabled={semi} onClick={() => setChannel(t.id)}>
                  {t.label}
                </TabButton>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">semihosting</span>
              <button
                type="button"
                onClick={() => setSemi((s) => !s)}
                className={[
                  'rounded border px-3 py-1 text-xs transition-colors',
                  semi
                    ? 'border-danger bg-danger/15 text-danger'
                    : 'border-line bg-panel text-muted hover:border-danger hover:text-ink',
                ].join(' ')}
              >
                {semi ? '已开启（BKPT）' : '已关闭'}
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {chain.map((n, i) => (
              <Fragment key={n}>
                {i > 0 && (
                  <span className={`text-xs transition-colors ${semi ? 'text-danger' : 'text-muted'}`}>→</span>
                )}
                <span
                  className={`rounded border px-2 py-1 font-mono text-xs transition-colors ${
                    chainNodeCls(i, i === chain.length - 1, semi)
                  }`}
                >
                  {n}
                </span>
              </Fragment>
            ))}
          </div>
          {semi ? (
            <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm leading-relaxed">
              <div className="font-semibold text-danger">⛔ 脱机卡死警告</div>
              <div className="mt-1 text-ink/85">
                semihosting 依赖调试器代为 I/O。脱机运行时 printf 触发 BKPT 却无人应答 ——
                程序直接卡死或进 HardFault。这是"printf 莫名卡死"的头号原因。
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <CodeBlock
                title={snippetTitle}
                code={snippet}
                className={channel === 'itm' ? 'lg:max-w-xl' : ''}
              />
            </div>
          )}
        </div>
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-ink">关闭 semihosting</h4>
          <p className="mb-2 mt-1 text-xs text-muted">
            关闭后不能再依赖调试器提供的默认 I/O，所需底层接口必须工程自己提供。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <CodeBlock title="AC6（armclang）" code={NO_SEMIHOSTING.ac6} />
            <CodeBlock title="AC5（armcc）" code={NO_SEMIHOSTING.ac5} />
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">桩函数契约表</h3>
        <p className="mb-3 text-xs text-muted">
          完整 Arm C Library 使用 stdio 时会调用全套 _sys_* 桩；这里是工程当前实现与各接口的注意事项
        </p>
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-xs text-muted">
                <th className="px-3 py-2 font-semibold">接口</th>
                <th className="px-3 py-2 font-semibold">当前实现</th>
                <th className="px-3 py-2 font-semibold">说明</th>
              </tr>
            </thead>
            <tbody>
              {STUBS.map((s) => (
                <tr key={s.name} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-accent-2">{s.name}</td>
                  <td className="px-3 py-2 text-xs text-ink">{s.impl}</td>
                  <td className="px-3 py-2 text-xs text-muted">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-3">
          <Callout tone="warn" title="_sys_read() 契约警告">
            当前 _sys_read() 返回 0 但没填充 buf：若以后启用 scanf/getchar/stdin，必须实现实际读取或按契约返回未读取长度，不能继续"未填数据却返回 0"。
          </Callout>
          <Callout tone="warn" title="fputc() 错误处理建议">
            当前 fputc() 固定返回 1 且忽略 console_send() 失败：作为通用 fputc 使用时，建议失败返回 EOF 并决定是否向上传递错误。
          </Callout>
          <Callout tone="ok" title="记忆卡">
            MicroLIB 重定向主要看 fputc()；完整 Arm C Library 重定向主要看 _sys_write()。关闭 semihosting 后，工程必须自己提供所需的底层 I/O 钩子。
          </Callout>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">三工具链重定向对照</h3>
        <p className="mb-3 text-xs text-muted">
          不同 libc 的重定向桩入口各不相同；切换工具链对照钩子说明与示例代码
        </p>
        <div className="rounded-lg border border-line bg-panel p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {TOOLCHAIN_RETARGET.map((t) => (
              <TabButton key={t.id} active={toolchainId === t.id} onClick={() => setToolchainId(t.id)}>
                {t.label}
              </TabButton>
            ))}
          </div>
          <p className="mb-3 text-sm leading-relaxed text-ink">
            <span className="font-mono text-accent">{toolchain.label}</span>
            <span className="mx-2 text-muted">·</span>
            {toolchain.hook}
          </p>
          <CodeBlock title={`${toolchain.label} · 重定向示例`} code={toolchain.code} />
        </div>
        <div className="mt-4">
          <h4 className="mb-2 text-sm font-semibold text-ink">MicroLIB vs 完整库选型</h4>
          <div className="overflow-x-auto rounded-lg border border-line bg-panel">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-panel-2 text-xs text-muted">
                  <th className="px-3 py-2 font-semibold">对比项</th>
                  <th className="px-3 py-2 font-semibold">MicroLIB</th>
                  <th className="px-3 py-2 font-semibold">完整库</th>
                </tr>
              </thead>
              <tbody>
                {LIB_CHOICE.map((r) => (
                  <tr key={r.item} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 text-xs font-semibold text-ink">{r.item}</td>
                    <td className="px-3 py-2 text-xs text-accent-2">{r.micro}</td>
                    <td className="px-3 py-2 text-xs text-muted">{r.full}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-3">
          <Callout tone="tip" title="返回值语义相反">
            注意返回值语义相反：Keil _sys_write 返回"未写出"字节数（0=成功），GCC _write 返回"已写出"字节数。移植时最容易踩的坑之一。
          </Callout>
        </div>
      </section>
    </ModuleShell>
  )
}
