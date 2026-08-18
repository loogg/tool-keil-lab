# Keil 交互实验室（tool-keil-lab）

一门关于 **Arm 编译工具链（Keil / MDK）** 的交互课。把那些只在文档里出现、靠想象很难建立直觉的概念——内存布局、链接脚本、结构体对齐、预定义宏、诊断信息、`errno`、`printf` 重定向——做成可以动手拖拽、实时反馈的小实验。

**在线体验**：<https://loogg.github.io/tool-keil-lab/>

## 模块一览

| 模块 | 讲什么 |
| --- | --- |
| 开篇导读 | 整门课的地图：各模块解决什么问题、按什么顺序看 |
| 内存布局实验室 | 链接脚本决定每段代码和数据落在哪块 Flash / RAM |
| 宏探测站 | 代码怎么知道自己在被哪个编译器构建？靠预定义宏 |
| 结构体布局实验室 | 左边改成员，右边看布局——对齐、填充、非对齐访问与 weak 符号，全部可见 |
| 诊断控制台 | Warning 该修还是该屏蔽？真实案例、屏蔽 pragma、System Header 搜索链与决策树 |
| errno 隧道 | 给 `errno` 赋值，实际是沿着宏展开的隧道走到一个 ABI 钩子函数 |
| printf 的旅程 | `printf` 不是直接写串口：沿库内调用链走到重定向入口，落在 UART / ITM / semihosting |

## 内存布局实验室（重点模块）

围绕一张可编辑的内存模型，把同一份布局用三大工具链的链接脚本各自表达，并双向联动：

- **三种链接脚本互切**：Keil `.sct` / GCC `.ld` / IAR `.icf`，同一模型各自生成符合官方文档的语法；页签互切同步。
- **粘贴真实脚本**：直接粘贴工程里的 `.ld` / `.sct` / `.icf`，自动识别语法并解析成模型；应用后可在「原文」与「生成视图」之间随时切换，原文保留不丢。
- **语义化添加**：左侧树按「加载区 → Region → Section」三层组织；添加 section 时选语义类型（只读 / 读写 / 零初始化 / 向量表 / 自定义），三种脚本各自生成官方写法。
- **联动高亮**：树、脚本行、Region 占用条之间点击互相定位；占用总览双列展示使用率与溢出告警。

> 语法依据：Keil armlink User Guide（execution/load region 属性）、GNU binutils `ld` 手册（`MEMORY` / Output Section Type）、IAR ILINK 链接配置文件（`define region` / `place` / `initialize`）。

## 技术栈

- [React](https://react.dev/) 19 + [Vite](https://vitejs.dev/) 7
- [Tailwind CSS](https://tailwindcss.com/) 4
- [Vitest](https://vitest.dev/) 单元测试
- 纯前端静态站点，无运行时后端

## 本地开发

```bash
npm ci          # 安装依赖
npm run dev     # 开发服务器
npm test        # 运行测试
npm run lint    # 代码检查
npm run build   # 产物构建到 dist/
```

## 版本与发布

`package.json.version` 是界面版本徽标和发布校验的唯一来源。

- 向 `main` 的普通推送只跑 **CI**（lint + test + build）。
- 只有 `v*.*.*` 标签会触发 **Release to GitHub Pages**，且要求标签版本与 `package.json.version` 一致。

发布一个新版本：

```bash
# 先提交改动，然后：
npm version patch   # 或 minor / major
git push origin main --follow-tags
```

不要移动或复用已有标签；回滚请用新的 patch 版本。发布时无需修改 `toolbox` 首页清单，除非工具的名称、说明、图标、URL 或上下架状态发生变化。部署 base 自动取自 GitHub 仓库名。
