export const WARNING_CASES = [
  {
    id: 'wformat',
    flag: '-Wformat',
    meaning: 'printf 等格式符与实际参数类型不匹配',
    bad: `int64_t total = get_total();
printf("total = %d\\n", total);   /* %d 期望 int，实参是 int64_t */`,
    good: `printf("total = %lld\\n", (long long)total);  /* 格式符与类型一致 */`,
    advice: '自有代码优先修正格式符；第三方代码确认无风险后再在对应 .c 文件屏蔽',
  },
  {
    id: 'nodecl',
    flag: '-Wdeprecated-non-prototype',
    meaning: '旧式函数声明未提供 prototype',
    bad: `void foo();        /* 参数个数未知，不是"无参数" */`,
    good: `void foo(void);    /* 明确的无参数声明 */`,
    advice: '自有代码改成完整 prototype；第三方旧代码可在 AC6 下按需屏蔽',
  },
]

export const SUPPRESS_TEMPLATES = {
  ac6: {
    file: `#if defined(__ARMCOMPILER_VERSION)
#pragma clang diagnostic ignored "-Wformat"
#endif`,
    local: `#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wformat"
/* 需要忽略的代码 */
#pragma clang diagnostic pop`,
  },
  ac5: {
    file: `#pragma push
#pragma diag_suppress 1254   /* AC5 用诊断号，非名称 */
/* 整个文件后续生效 */`,
    local: `#pragma push
#pragma diag_suppress 1254
/* 需要忽略的代码 */
#pragma pop`,
  },
}

export const SYSTEM_HEADER = {
  ac5: { dirFlag: '-J<dir>', pragma: '#pragma GCC system_header' },
  ac6: { dirFlag: '-isystem <dir>', pragma: '#pragma clang system_header' },
}
