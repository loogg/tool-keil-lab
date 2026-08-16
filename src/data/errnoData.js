// 宏展开隧道的四步
export const EXPAND_STEPS = [
  { code: 'errno = EINVAL;', note: '看起来像给全局变量赋值' },
  { code: '#define errno (*__aeabi_errno_addr())', note: '实际上 errno 是个宏' },
  { code: '(*__aeabi_errno_addr()) = EINVAL;', note: '展开后：先取"errno 存储地址"，再写入' },
  { code: 'extern volatile int *__aeabi_errno_addr(void);', note: '存储位置由这个 ABI 钩子函数决定' },
]

export const ARM_ERRNO_H = `/* Arm C Library / MicroLIB 的 errno.h 核心形式 */
extern volatile int *__aeabi_errno_addr(void);
#define errno (*__aeabi_errno_addr())`

export const TASK_OVERRIDE = `/* 多任务：让每个任务拥有独立 errno，保持 Arm ABI 入口不变 */
volatile int *__aeabi_errno_addr(void)
{
    return &current_task->errno_value;
}`

export const WRAPPER_ERRNO_H = `#ifndef PORT_ERRNO_H
#define PORT_ERRNO_H

/* 继续使用 Arm C Library 的 errno / __aeabi_errno_addr() */
#include_next <errno.h>

/* 只补移植代码需要、Arm 没有提供的错误码 */
#ifndef EIO
#define EIO 5
#endif

#ifndef ENOSPC
#define ENOSPC 28
#endif

#ifndef ETIMEDOUT
#define ETIMEDOUT 116
#endif

#endif`

export const LIBC_ERRNO_TABLE = [
  { libc: 'Arm C Library / MicroLIB', storage: '__aeabi_errno_addr() ABI 钩子', thread: '覆盖钩子即可支持每任务 errno' },
  { libc: 'Zephyr Minimal libc', storage: 'z_errno()：TLS 变量或 k_thread 成员', thread: '依赖 Zephyr 内核/TLS 实现线程隔离' },
  { libc: 'Zephyr + armstdc', storage: '覆盖 __aeabi_errno_addr() 指向 _current->errno_var', thread: '让 Arm libc 反向使用当前线程 errno' },
  { libc: 'GCC newlib', storage: 'struct _reent 内的 _errno（每线程一个 reent）', thread: '由 RTOS 提供 _impure_ptr 切换' },
]

// include 搜索链演示的目录列表（正确顺序）
export const INCLUDE_ORDER = [
  { id: 'wrapper', label: '工程兼容层目录（自定义 wrapper errno.h）' },
  { id: 'rte', label: 'Keil RTE / CMSIS include 目录' },
  { id: 'arm', label: 'Arm C Library 系统头文件目录' },
]
