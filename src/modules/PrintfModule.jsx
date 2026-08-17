import { Fragment, useState } from 'react'
import Workbench from '../components/workbench/Workbench'
import { Button, FieldRow, SectionLabel, Segmented, StatTile } from '../components/workbench/controls'
import { DrawerTrigger, Principle, RefTable } from '../components/workbench/Principle'
import CodeBlock from '../components/CodeBlock'
import {
  CHAINS, FPUTC_SNIPPET, SYS_WRITE_SNIPPET, NO_SEMIHOSTING, STUBS, TOOLCHAIN_RETARGET, LIB_CHOICE,
} from '../data/stdioData'

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

// 链路节点配色：semihosting 链整体警示红，常规链首节点与末端硬件高亮
const chainNodeCls = (idx, isLast, semi) => {
  if (semi) return 'border-danger/40 bg-danger/10 text-danger'
  if (isLast) return 'border-accent-2/40 bg-accent-2/10 text-accent-2'
  if (idx === 0) return 'border-accent/40 bg-accent/10 text-accent'
  return 'border-line bg-panel-2 text-ink'
}

export default function PrintfModule() {
  // 调用链
  const [lib, setLib] = useState('microlib')
  const [semi, setSemi] = useState(false)
  const [channel, setChannel] = useState('uart')

  // 工具链对照
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

  // ---- 实验① 调用链 ----
  const chainControl = (
    <div className="space-y-5">
      <div>
        <SectionLabel className="mb-2">C Library · 库</SectionLabel>
        <Segmented
          options={[
            { id: 'microlib', label: 'MicroLIB' },
            { id: 'full', label: '完整库' },
          ]}
          value={lib}
          onChange={setLib}
          className="w-full"
        />
      </div>
      <div>
        <SectionLabel className="mb-2">Output Channel · 输出通道</SectionLabel>
        <Segmented
          options={[
            { id: 'uart', label: 'UART' },
            { id: 'itm', label: 'ITM/SWO' },
          ]}
          value={channel}
          onChange={setChannel}
          className="w-full"
        />
      </div>
      <FieldRow label={<>semihosting <Principle title="semihosting 是什么">半主机：让目标板通过调试器代理完成 I/O。脱机运行时 BKPT 无人应答，程序卡死。</Principle></>}>
        <Button variant={semi ? 'danger' : 'ghost'} onClick={() => setSemi(!semi)}>
          {semi ? '已开启（BKPT）' : '已关闭'}
        </Button>
      </FieldRow>
    </div>
  )

  const chainCanvas = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel>Call Chain · 调用链</SectionLabel>
        <span className="ml-auto text-xs text-muted">
          {semi ? '调试器代理链' : `${lib === 'microlib' ? 'MicroLIB' : '完整库'} · ${channel === 'itm' ? 'ITM' : 'UART'}`}
        </span>
      </div>
      <div className="rounded-lg border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center gap-2">
          {chain.map((n, i) => (
            <Fragment key={n}>
              {i > 0 && <span className={`text-xs ${semi ? 'text-danger' : 'text-muted'}`}>→</span>}
              <span className={`rounded border px-2 py-1 font-mono text-xs ${chainNodeCls(i, i === chain.length - 1, semi)}`}>
                {n}
              </span>
            </Fragment>
          ))}
        </div>
      </div>
      {semi ? (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3">
          <div className="font-semibold text-danger">⛔ 脱机卡死警告</div>
          <div className="mt-1 text-sm text-ink/85">
            semihosting 依赖调试器代为 I/O。脱机运行时 printf 触发 BKPT 却无人应答 —— 程序直接卡死或进 HardFault。这是"printf 莫名卡死"的头号原因。
          </div>
        </div>
      ) : (
        <CodeBlock title={snippetTitle} code={snippet} />
      )}
    </div>
  )

  // ---- 实验② 桩函数契约 ----
  const stubsControl = (
    <div className="space-y-3">
      <SectionLabel>Stub Contracts · 契约表</SectionLabel>
      <p className="text-xs leading-relaxed text-muted">
        完整 Arm C Library 使用 stdio 时会调用全套 <code className="font-mono text-ink">_sys_*</code> 桩；下面是工程当前实现与各接口的注意事项。
      </p>
    </div>
  )

  const stubsCanvas = (
    <div className="space-y-4">
      <RefTable
        head={['接口', '当前实现', '说明']}
        rows={STUBS.map((s) => [s.name, s.impl, s.note])}
      />
      <div className="space-y-3">
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs leading-relaxed">
          <strong className="text-warn">_sys_read() 契约警告</strong>
          <p className="mt-1 text-ink/85">当前 _sys_read() 返回 0 但没填充 buf：若以后启用 scanf/getchar/stdin，必须实现实际读取或按契约返回未读取长度。</p>
        </div>
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs leading-relaxed">
          <strong className="text-warn">fputc() 错误处理</strong>
          <p className="mt-1 text-ink/85">当前 fputc() 固定返回 1 且忽略 console_send() 失败：作为通用 fputc 使用时，建议失败返回 EOF。</p>
        </div>
        <div className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-xs leading-relaxed">
          <strong className="text-ok">记忆卡</strong>
          <p className="mt-1 text-ink/85">MicroLIB 重定向主要看 fputc()；完整 Arm C Library 重定向主要看 _sys_write()。</p>
        </div>
      </div>
    </div>
  )

  // ---- 实验③ 工具链对照 ----
  const toolchainControl = (
    <div className="space-y-5">
      <div>
        <SectionLabel className="mb-2">Toolchain · 工具链</SectionLabel>
        <Segmented
          options={TOOLCHAIN_RETARGET.map((t) => ({ id: t.id, label: t.label }))}
          value={toolchainId}
          onChange={setToolchainId}
          className="w-full"
        />
      </div>
      <DrawerTrigger label="MicroLIB vs 完整库选型" title="MicroLIB vs 完整库选型对照">
        <RefTable
          head={['对比项', 'MicroLIB', '完整库']}
          rows={LIB_CHOICE.map((r) => [r.item, r.micro, r.full])}
        />
        <p className="text-xs">
          注意返回值语义相反：Keil <code className="font-mono">_sys_write</code> 返回"未写出"字节数（0=成功），GCC <code className="font-mono">_write</code> 返回"已写出"字节数。移植时最容易踩的坑之一。
        </p>
      </DrawerTrigger>
    </div>
  )

  const toolchainCanvas = (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-ink">
        <span className="font-mono text-accent">{toolchain.label}</span>
        <span className="mx-2 text-muted">·</span>
        {toolchain.hook}
      </p>
      <CodeBlock title={`${toolchain.label} · 重定向示例`} code={toolchain.code} />
      <div className="rounded-lg border border-line bg-panel p-4">
        <SectionLabel className="mb-2">关闭 semihosting 后的底层钩子</SectionLabel>
        <div className="grid gap-3 lg:grid-cols-2">
          <CodeBlock title="AC6（armclang）" code={NO_SEMIHOSTING.ac6} />
          <CodeBlock title="AC5（armcc）" code={NO_SEMIHOSTING.ac5} />
        </div>
      </div>
    </div>
  )

  return (
    <Workbench
      title="printf 的旅程"
      tagline="printf 不是直接写串口：它沿着库内调用链走到重定向入口，最终落在 UART、ITM 或调试器 semihosting"
      experiments={[
        { id: 'chain', label: '调用链', control: chainControl, canvas: chainCanvas },
        { id: 'stubs', label: '桩函数契约', control: stubsControl, canvas: stubsCanvas },
        { id: 'toolchain', label: '工具链对照', control: toolchainControl, canvas: toolchainCanvas },
      ]}
    />
  )
}
