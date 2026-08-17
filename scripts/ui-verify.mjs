// UI 验证脚本：结构体实验室改版试点（设计文档 2026-08-17 第 6 节验收标准 2/3）。
// 依赖 playwright-core + 本机 chromium（不下载浏览器）；先 `npm run dev` 起服务。
// 用法：node scripts/ui-verify.mjs  （可用环境变量覆盖）
//   UI_BASE     默认 http://localhost:5199
//   CHROME_PATH 默认 %LOCALAPPDATA%/ms-playwright/chromium-1234/chrome-win64/chrome.exe
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.UI_BASE ?? 'http://localhost:5199'
const CHROME_PATH =
  process.env.CHROME_PATH ??
  `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1234/chrome-win64/chrome.exe`
const SHOT_DIR = new URL('../screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

mkdirSync(SHOT_DIR, { recursive: true })

// ---------- 结果收集 ----------
const checks = [] // { phase, name, ok, detail }
let consoleErrors = []
let pageErrors = []

function check(phase, name, ok, detail = '') {
  checks.push({ phase, name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} [${phase}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function attachErrorListeners(page) {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => pageErrors.push(String(e.message ?? e)))
}

function drainErrors() {
  const out = [...consoleErrors, ...pageErrors]
  consoleErrors = []
  pageErrors = []
  return out
}

async function checkOverflow(page, phase, name) {
  const { docScroll, client, bodyScroll } = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
  }))
  const widest = Math.max(docScroll, bodyScroll)
  check(phase, `${name} · 无横向溢出`, widest <= client, `scrollWidth ${widest}px / clientWidth ${client}px`)
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOT_DIR}${name}.png` })
}

// StatTile 大数字（T4 等宽 22px）：顺序 sizeof / padding / alignment / members
const tileValues = (page) => page.locator('section div[class*="text-[22px]"]')
// 页面里同名 aria-label 可能有隐藏副本（控制/结果双栏都在 DOM 里），只操作可见的那个。
// exact：Principle 触发器的 aria-label 形如「原理：内核之间差在哪」，子串匹配会误命中。
const visibleByLabel = (page, label) => page.getByLabel(label, { exact: true }).filter({ visible: true })

// ---------- 桌面端 ----------
async function desktopPhase(browser) {
  const phase = '桌面'
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  attachErrorListeners(page)

  await page.goto(BASE, { waitUntil: 'networkidle' })
  check(phase, '应用加载', await page.getByRole('heading', { name: 'Keil 交互实验室' }).isVisible())

  // 进入结构体实验室
  await page.locator('aside nav').getByRole('button', { name: '结构体布局实验室' }).click()
  await page.getByRole('heading', { name: '结构体布局实验室' }).waitFor()
  check(phase, '进入结构体实验室', true)

  const expTab = (label) => page.locator('header').getByRole('button', { name: label, exact: true })

  // ---- 实验① 字节网格（默认） ----
  check(phase, '实验① 默认渲染', await page.getByText('Byte Grid · 字节网格').isVisible())
  const size0 = await tileValues(page).nth(0).textContent()
  check(phase, '实验① StatTile 有值', /\d+ B/.test(size0), `sizeof = ${size0}`)
  await shot(page, 'desktop-1-grid')

  // packed 开关：sensor_frame 自然布局 → packed，sizeof 必然变化（16B → 11B）
  await page.getByRole('switch', { name: 'packed' }).click()
  const sizePacked = await tileValues(page).nth(0).textContent()
  check(phase, 'packed 切换生效', size0 !== sizePacked, `${size0} → ${sizePacked}`)
  await page.getByRole('switch', { name: 'packed' }).click() // 还原

  // 换示例：uart_packet 3 成员 sizeof 8
  await visibleByLabel(page, '示例').selectOption('uart_packet')
  const sizeUart = (await tileValues(page).nth(0).textContent()).trim()
  check(phase, '示例切换生效', sizeUart === '8 B', `uart_packet sizeof = ${sizeUart}`)
  await visibleByLabel(page, '示例').selectOption('sensor_frame') // 还原

  // 成员编辑：添加 → +1；删除 → 还原；下移 → 首行变化
  const count0 = await tileValues(page).nth(3).textContent()
  await page.getByRole('button', { name: '添加成员' }).click()
  const count1 = await tileValues(page).nth(3).textContent()
  check(phase, '添加成员生效', Number(count1) === Number(count0) + 1, `成员 ${count0} → ${count1}`)
  await page.getByTitle('删除').last().click()
  const count2 = await tileValues(page).nth(3).textContent()
  check(phase, '删除成员生效', Number(count2) === Number(count0), `成员 ${count1} → ${count2}`)

  const firstInput = () => page.getByPlaceholder('成员名').first()
  const name0 = await firstInput().inputValue()
  await page.getByTitle('下移').first().click()
  const name1 = await firstInput().inputValue()
  check(phase, '成员排序生效', name0 !== name1, `首行 ${name0} → ${name1}`)
  // 排序测试打乱了成员顺序：重载示例，把成员/布局/选中成员全部还原到基准状态
  await visibleByLabel(page, '示例').selectOption('uart_packet')
  await visibleByLabel(page, '示例').selectOption('sensor_frame')

  // Principle 弹层：开 → 有内容；点外圈 → 关
  await page.getByLabel('原理：packed 做什么').click()
  check(phase, '原理弹层打开', await page.getByText('取消成员间的自然对齐').isVisible())
  await page.locator('div.fixed.inset-0').first().click({ position: { x: 600, y: 600 } })
  check(phase, '原理弹层关闭', !(await page.getByText('取消成员间的自然对齐').isVisible()))

  await checkOverflow(page, phase, '实验①')
  const errs1 = drainErrors()
  check(phase, '实验① 控制台零错误', errs1.length === 0, errs1[0] ?? '')

  // ---- 实验② 四形态对照 ----
  await expTab('四形态').click()
  await page.waitForTimeout(150)
  const formCount = await page.locator('section').getByText(/sizeof = \d+/).count()
  check(phase, '实验② 四形态渲染', formCount === 4, `${formCount} 张卡片`)
  await page.getByRole('button', { name: 'pack / aligned 细节' }).click()
  await page.getByRole('heading', { name: 'pack / aligned 细节' }).waitFor()
  check(phase, '实验② 速查抽屉打开', true)
  await page.getByLabel('关闭', { exact: true }).click()
  check(phase, '实验② 抽屉可关闭', !(await page.getByRole('heading', { name: 'pack / aligned 细节' }).isVisible()))
  await shot(page, 'desktop-2-forms')
  await checkOverflow(page, phase, '实验②')
  const errs2 = drainErrors()
  check(phase, '实验② 控制台零错误', errs2.length === 0, errs2[0] ?? '')

  // ---- 实验③ 非对齐访问 ----
  await expTab('非对齐访问').click()
  const verdict = () => page.locator('section').getByText(/^(✓|⚠|✗) /).first()
  await verdict().waitFor()
  const v0 = await verdict().textContent()

  // packed 让 timestamp 落在 offset 1 → M0 读 4 字节必故障（与默认 flags@0 判决不同）
  await expTab('字节网格').click()
  await page.getByRole('switch', { name: 'packed' }).click()
  await expTab('非对齐访问').click()
  await visibleByLabel(page, '读取成员').selectOption('1') // timestamp
  const v1 = await verdict().textContent()
  check(phase, '实验③ 判决随布局变化', v0 !== v1, `「${v0}」→「${v1}」`)

  // 换内核：M4 支持非对齐（有代价），与 M0 判决不同
  await visibleByLabel(page, '内核').selectOption('cortex-m4')
  const v2 = await verdict().textContent()
  check(phase, '实验③ 内核切换生效', v1 !== v2, `M0「${v1}」→ M4「${v2}」`)

  // UNALIGN_TRP：M4 + trap，判决语义应再变
  await page.getByRole('switch', { name: 'UNALIGN_TRP' }).click()
  const v3 = await verdict().textContent()
  check(phase, '实验③ UNALIGN_TRP 生效', v2 !== v3, `「${v2}」→「${v3}」`)

  check(phase, '实验③ 内核矩阵渲染', await page.getByText('Core Matrix · 内核支持矩阵').isVisible())
  await shot(page, 'desktop-3-access')

  await checkOverflow(page, phase, '实验③')
  const errs3 = drainErrors()
  check(phase, '实验③ 控制台零错误', errs3.length === 0, errs3[0] ?? '')

  // ---- 实验④ weak 符号 ----
  await expTab('weak 符号').click()
  const scene = async (label) => {
    await page.locator('aside').getByRole('button', { name: label, exact: true }).click()
    await page.waitForTimeout(120)
    return page.locator('section').textContent()
  }
  const s1 = await scene('强弱共存')
  const s2 = await scene('只有弱符号')
  const s3 = await scene('都没有')
  check(phase, '实验④ 强弱共存', s1.includes('用户实现'))
  check(phase, '实验④ 只有弱符号', s2.includes('HAL 默认空实现'))
  check(phase, '实验④ 都没有', s3.includes('undefined reference'))
  await page.getByRole('button', { name: 'AC5/AC6 兼容矩阵' }).click()
  check(phase, '实验④ 兼容矩阵抽屉', await page.getByText('__attribute__((weak))').first().isVisible())
  await page.getByLabel('关闭', { exact: true }).click()
  await shot(page, 'desktop-4-weak')
  await checkOverflow(page, phase, '实验④')
  const errs4 = drainErrors()
  check(phase, '实验④ 控制台零错误', errs4.length === 0, errs4[0] ?? '')

  // ---- 其余模块冒烟：令牌全局变更不能点谁谁崩 ----
  const others = ['开篇导读', '内存布局实验室', '宏探测站', '诊断控制台', 'errno 隧道', 'printf 的旅程']
  for (const name of others) {
    await page.locator('aside nav').getByRole('button', { name }).click()
    await page.waitForTimeout(250)
    await checkOverflow(page, phase, `模块「${name}」`)
  }
  const errsSmoke = drainErrors()
  check(phase, '其余 6 模块控制台零错误', errsSmoke.length === 0, errsSmoke[0] ?? '')

  await page.close()
}

// ---------- 移动端 ----------
async function mobilePhase(browser) {
  const phase = '移动'
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  attachErrorListeners(page)

  await page.goto(BASE, { waitUntil: 'networkidle' })

  // 抽屉导航：开 → 选模块 → 自动收起
  await page.getByLabel('打开导航').click()
  await page.locator('aside').getByRole('button', { name: '结构体布局实验室' }).click()
  await page.getByRole('heading', { name: '结构体布局实验室' }).waitFor()
  const drawerClosed = await page.locator('aside').first().evaluate((el) => el.classList.contains('invisible'))
  check(phase, '抽屉导航可用且自动收起', drawerClosed)

  // 双视图切换：默认「操作」，切「结果」后画布可见、操作面板隐藏
  check(phase, '默认操作视图', await page.getByText('Members · 成员').isVisible())
  await shot(page, 'mobile-control')

  await page.locator('header').getByRole('button', { name: '结果', exact: true }).click()
  await page.waitForTimeout(120)
  const canvasVisible = await page.getByText('Byte Grid · 字节网格').isVisible()
  const controlHidden = !(await page.getByText('Members · 成员').isVisible())
  check(phase, '切到结果视图', canvasVisible && controlHidden)
  await shot(page, 'mobile-canvas')

  await page.locator('header').getByRole('button', { name: '操作', exact: true }).click()
  check(phase, '切回操作视图', await page.getByText('Members · 成员').isVisible())

  // 移动端交互：packed 开关在操作视图里能点
  await page.getByRole('switch', { name: 'packed' }).click()
  await page.getByRole('switch', { name: 'packed' }).click()
  check(phase, '移动端 packed 可交互', true)

  // 实验切换器在移动端头部可用
  await page.locator('header').getByRole('button', { name: 'weak 符号', exact: true }).click()
  await page.waitForTimeout(120)
  check(phase, '移动端实验切换', await page.getByText('Link Scene · 链接场景').isVisible())

  await checkOverflow(page, phase, '结构体实验室')
  const errs = drainErrors()
  check(phase, '移动端控制台零错误', errs.length === 0, errs[0] ?? '')

  await page.close()
}

// ---------- 主流程 ----------
const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true })
try {
  await desktopPhase(browser)
  await mobilePhase(browser)
} finally {
  await browser.close()
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n===== 汇总：${checks.length - failed.length}/${checks.length} 通过${failed.length ? `，${failed.length} 项失败` : ''} =====`)
for (const f of failed) console.log(`FAIL [${f.phase}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)
process.exit(failed.length ? 1 : 0)
