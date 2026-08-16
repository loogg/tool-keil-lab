// map 文件解读示例（示意摘录，标注各行含义）
export const MAP_SAMPLE = `Grand Totals
  Code (inc. data)   RO Data    RW Data    ZI Data   Debug
  182344      9216    96512      1024     452096   1032144   Grand Totals

Memory Map of the image
  Execution Region ER_IROM1 (Base: 0x08000000, Size: 0x00058A00)
    0x08000000   0x00000200   Region ER_IROM1 RESET        *.o (RESET)
    0x08000200   0x00058300   Section .text                 app.o ...
  Execution Region ER_RODATA (Base: 0x080C0000, Size: 0x00009000)
    0x080c0000   0x00009000   Section .rodata.webpages      webserver_packedfs.o`

export const MAP_NOTES = [
  { key: 'Code', desc: '指令（.text）总字节数，占 Code Flash' },
  { key: 'RO Data', desc: '只读数据（常量表、资源），可与 Code 分区摆放' },
  { key: 'RW Data', desc: '有初值的全局/静态变量，存 Flash、启动时复制到 RAM' },
  { key: 'ZI Data', desc: '零初值变量，只占 RAM，启动时清零，不占 Flash' },
]

// 同一布局的三大工具链写法（示意对照）
export const LINKER_SYNTAX = {
  sct: {
    label: 'Keil scatter (.sct)',
    code: `LR_IROM1 0x08000000 0x00100000  {
  ER_IROM1 0x08000000 0x000C0000  {
   *.o (RESET, +First)
   .ANY (+RO)
  }
  ER_RODATA 0x080C0000 FIXED 0x00010000 {
    webserver_packedfs.o (.rodata.*)
  }
  RW_IRAM1 0x20000000 0x00070000  {
   .ANY (+RW +ZI)
  }
}`,
  },
  ld: {
    label: 'GCC 链接脚本 (.ld)',
    code: `MEMORY
{
  FLASH  (rx)  : ORIGIN = 0x08000000, LENGTH = 768K
  DFLASH (r)   : ORIGIN = 0x080C0000, LENGTH = 64K
  SRAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 448K
}
SECTIONS
{
  .text  : { KEEP(*(.isr_vector)) *(.text*) *(.rodata*) } > FLASH
  .webfs : { KEEP(*(.rodata.webserver*)) } > DFLASH
  .data  : { *(.data*) } > SRAM AT > FLASH   /* LMA 在 Flash，VMA 在 RAM */
  .bss   : { *(.bss*) *(COMMON) } > SRAM
}`,
  },
  icf: {
    label: 'IAR 配置 (.icf)',
    code: `define memory mem with size = 4G;
define region IROM   = mem:[from 0x08000000 size 768K];
define region DFLASH = mem:[from 0x080C0000 size 64K];
define region IRAM   = mem:[from 0x20000000 size 448K];

place in IROM   { readonly };
place in DFLASH { section .rodata.webserver* };
initialize by copy { readwrite };   /* 等价 RW 搬运 */
do not initialize  { section .bss.sdram.noinit };`,
  },
}

// 链接器符号：在 C 代码中导入（extern + 取地址）
export const SYMBOL_EXAMPLE = `extern unsigned int Image$$ER_RODATA$$Base;
extern unsigned int Image$$ER_RODATA$$Length;

void check_webfs(void)
{
    /* 符号本身没有存储空间，值就是地址：必须取址 */
    uint32_t base = (uint32_t)&Image$$ER_RODATA$$Base;
    uint32_t len  = (uint32_t)&Image$$ER_RODATA$$Length;
}`

// 指定固定地址：AC5 / AC6 两种语法
export const atSnippet = (addr) => ({
  ac5: `#define BOOT_FLASH_SECTION __attribute__((at(${addr})))`,
  ac6: `#define __ARM_AT(x) ".ARM.__at_"#x
#define ARM_AT(x) __ARM_AT(x)
#define BOOT_FLASH_SECTION __attribute__((section(ARM_AT(${addr}))))`,
})
