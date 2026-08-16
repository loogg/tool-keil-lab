// 两条调用链（节点 id 用于渲染）
export const CHAINS = {
  microlib: ['printf', 'fputc', 'console_send', 'UART 硬件'],
  full: ['printf', 'stdio 缓冲层', '_sys_write', 'console_send', 'UART 硬件'],
  semihosting: ['printf', 'BKPT 指令', '调试器主机 I/O'],
}

export const FPUTC_SNIPPET = `/* MicroLIB：实现字符输出即可 */
int fputc(int ch, FILE *f)
{
    uint8_t c = (uint8_t)ch;
    (void)f;
    (void)console_send(CONSOLE_EP(MAIN), &c, 1);
    return 1;
}`

export const SYS_WRITE_SNIPPET = `/* 完整 Arm C Library：_sys_write 返回值 = 未写出的字节数，0 = 全部成功 */
int _sys_write(FILEHANDLE fh, const unsigned char *buf,
               unsigned len, int mode)
{
    (void)fh; (void)mode;
    (void)console_send(CONSOLE_EP(MAIN), buf, len);
    return 0;
}`

export const NO_SEMIHOSTING = {
  ac6: `__asm(".global __use_no_semihosting\\n\\t");`,
  ac5: `#pragma import(__use_no_semihosting_swi)`,
}

export const STUBS = [
  { name: '_ttywrch()', impl: '发送到主 Console', note: '单字符输出钩子' },
  { name: '_sys_exit()', impl: 'while (1) {}', note: '裸机没有进程退出语义' },
  { name: '_sys_open()', impl: '只认 STDIN/STDOUT/STDERR', note: '其它返回 -1' },
  { name: '_sys_write()', impl: 'console_send，返回 0', note: '返回值 = 未写出字节数' },
  { name: '_sys_read()', impl: '占位返回 0', note: '返回值 = 未读取字节数（见下方警告）' },
  { name: '_sys_close()', impl: '返回 0', note: '占位，不维护文件资源' },
  { name: '_sys_ensure()', impl: '返回 0', note: '不做 flush，兼容性接口' },
  { name: '_sys_seek()', impl: '返回 0', note: '不维护真实文件位置' },
  { name: '_sys_flen()', impl: '返回 0', note: '无真实文件长度' },
  { name: '_sys_istty()', impl: '0~2 返回 1', note: '三个标准流均视为终端' },
  { name: '_sys_command_string()', impl: '返回 NULL', note: '不支持命令行参数' },
]

export const TOOLCHAIN_RETARGET = [
  {
    id: 'keil', label: 'Keil（Arm C Library）',
    hook: 'MicroLIB 用 fputc；完整库用 _sys_open/_sys_write/_sys_read 等全套',
    code: `/* 见上方 fputc 与 _sys_write 示例；官方契约：_sys_* 改一个必须全改 */`,
  },
  {
    id: 'gcc', label: 'GCC（newlib）',
    hook: 'POSIX 风格 syscall 桩：_write / _read / _close / _lseek / _fstat / _sbrk',
    code: `int _write(int fd, const char *buf, int len)
{
    (void)fd;
    return uart_send(buf, len);   /* 返回写出的字节数（与 Keil 相反！） */
}`,
  },
  {
    id: 'iar', label: 'IAR（DLib）',
    hook: '低级接口 __write()（推荐）或旧式 fputc()',
    code: `size_t __write(int handle, const unsigned char *buf, size_t bufSize)
{
    if (handle != _LLIO_STDOUT && handle != _LLIO_STDERR) return _LLIO_ERROR;
    return uart_send(buf, bufSize);
}`,
  },
]

export const LIB_CHOICE = [
  { item: '代码体积', micro: '小（为体积优化）', full: '大' },
  { item: 'stdio 缓冲', micro: '极简（默认无缓冲）', full: '完整缓冲层' },
  { item: 'printf 浮点 %f', micro: '默认不支持', full: '勾选 float printf 选项后支持' },
  { item: '重定向入口', micro: 'fputc', full: '_sys_* 全套' },
]
