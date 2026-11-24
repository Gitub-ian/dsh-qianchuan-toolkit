#!/usr/bin/env node
/**
 * daily-supervisor.mjs —— 每天固定窗口巡航：07:00 开始，次日 01:00 收工
 *
 *   node daily-supervisor.mjs                       常驻：窗口内跑 hourly.mjs --watch --until 01:00，收工后睡到次日 07:00
 *   node daily-supervisor.mjs --plan                只打印当前判定（不启动巡航）
 *   node daily-supervisor.mjs --start 07:00 --end 01:00
 *
 * 为什么需要它：hourly.mjs 的 --start-at / --until 是「单次」语义，
 * 07:00 起、01:00 止这种跨零点的循环窗口，用外层守夜进程算时间最清楚。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOURLY = process.env.QC_HOURLY || path.join(here, 'hourly.mjs')
if (!fs.existsSync(HOURLY)) { console.error('找不到 hourly.mjs：' + HOURLY + '（可用 QC_HOURLY 指定）'); process.exit(2) }
const HOME = process.env.QC_HOME || path.join(here, '..', 'prod')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const has = (k) => argv.includes('--' + k)

const START = arg('start', '07:00')      // 每天开始
const END = arg('end', '01:00')          // 次日收工
const PLAN_ONLY = has('plan')
const RETRY_MS = 5 * 60 * 1000

const hm = (s) => { const m = String(s).match(/^(\d{1,2}):(\d{2})$/); if (!m) throw new Error('时间格式应为 HH:MM：' + s); return Number(m[1]) * 3600000 + Number(m[2]) * 60000 }
const START_OFF = hm(START)
const END_OFF = hm(END)

const log = (...a) => console.log(new Date().toLocaleString('zh-CN'), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 当天 00:00 的毫秒
function midnight(now = Date.now()) { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() }

// 窗口：今天 START 点 -> 今天 START 点 + (END - START 若为负则加一天)
function windowOfDay(dayStart) {
  const start = dayStart + START_OFF
  let end = dayStart + END_OFF
  if (end <= start) end += 86400000    // 跨零点：07:00 -> 次日 01:00
  return { start, end }
}

function nextWindow(now = Date.now()) {
  const d0 = midnight(now)
  for (let i = -1; i <= 2; i++) {
    const w = windowOfDay(d0 + i * 86400000)
    if (now >= w.start && now < w.end) return { ...w, inWindow: true }
  }
  for (let i = 0; i <= 2; i++) {
    const w = windowOfDay(d0 + i * 86400000)
    if (w.start > now) return { ...w, inWindow: false }
  }
  return { ...windowOfDay(d0 + 86400000), inWindow: false }
}

function fmt(ms) { return new Date(ms).toLocaleString('zh-CN') }

async function runOnce() {
  const args = ['--watch', '--max-rounds', '1000', '--until', END]
  log('启动巡航：hourly.mjs ' + args.join(' '))
  const out = fs.openSync(path.join(HOME, 'watch.out.log'), 'a')
  const child = spawn(process.execPath, [HOURLY, ...args], { stdio: ['ignore', out, out], env: { ...process.env, QC_HOME: HOME } })
  log('巡航 pid ' + child.pid)
  const code = await new Promise((res) => child.on('exit', (c, s) => res(c == null ? -1 : c)))
  try { fs.closeSync(out) } catch { /* 忽略 */ }
  log('巡航退出，退出码 ' + code)
  return code
}

if (PLAN_ONLY) {
  const now = Date.now(); const w = nextWindow(now)
  console.log(JSON.stringify({ now: fmt(now), start: fmt(w.start), end: fmt(w.end), inWindow: w.inWindow, startAt: START, endAt: END }, null, 1))
  process.exit(0)
}

try { fs.writeFileSync(path.join(HOME, 'supervisor.pid'), String(process.pid)) } catch { /* 忽略 */ }
process.on('exit', () => { try { if (String(fs.readFileSync(path.join(HOME, 'supervisor.pid'), 'utf8')).trim() === String(process.pid)) fs.unlinkSync(path.join(HOME, 'supervisor.pid')) } catch { /* 忽略 */ } })
log('守夜进程启动：每天 ' + START + ' 开始，次日 ' + END + ' 收工（数据目录 ' + HOME + '）')
for (;;) {
  const w = nextWindow()
  if (!w.inWindow) {
    log('不在窗口内，睡到 ' + fmt(w.start))
    await sleep(Math.max(0, w.start - Date.now()))
    continue
  }
  log('现在在窗口内（' + fmt(w.start) + ' ~ ' + fmt(w.end) + '），开始巡航')
  const code = await runOnce()
  const still = nextWindow()
  if (!still.inWindow) continue          // 已到收工点：回到循环顶部睡到下一个开始时间
  if (code === 0) {                      // 正常退出（例如跑满 --max-rounds）且还在窗口内：稍等再起，避免空转
    log('正常退出但仍在窗口内，60 秒后重新启动巡航')
    await sleep(60000)
    continue
  }
  log('异常退出（退出码 ' + code + '）且仍在窗口内，' + Math.round(RETRY_MS / 60000) + ' 分钟后重试')
  await sleep(RETRY_MS)
}
