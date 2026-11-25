#!/usr/bin/env node
/**
 * watchdog.mjs —— 巡航看门狗（独立进程，60 秒一轮）
 *
 * 为什么需要它：巡航进程自己死了就发不出消息，必须有一个「旁观者」。
 * 它做三件事：
 *   1) 心跳检查：读 <QC_HOME>/heartbeat.json，超过 stale-min 分钟没更新 → 判卡死
 *   2) 进程检查：supervisor.pid / watch.pid 是否还活着
 *   3) 环境检查：CDP 9222 是否还能连上（Chrome 是否被关掉）
 * 发现问题 → 能自动重启的就重启（守夜进程死了直接拉起来），然后推送告警；
 * 恢复后再推一条「已恢复」。同一故障 30 分钟内只推一次，避免刷屏。
 *
 *   node watchdog.mjs                      长时间运行（由守夜进程拉起）
 *   node watchdog.mjs --once               只检查一次，打印结果（调试用）
 *   node watchdog.mjs --start 07:00 --end 01:00
 *   node watchdog.mjs --stale-min 6 --interval 60
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { notify } from './notify.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOME = process.env.QC_HOME || path.join(here, '..', 'prod')
const SUPERVISOR = process.env.QC_SUPERVISOR || path.join(here, 'daily-supervisor.mjs')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const has = (k) => argv.includes('--' + k)

const START = arg('start', '07:00')
const END = arg('end', '01:00')
const ONCE = has('once')
const INTERVAL = Math.max(20, Number(arg('interval', '60'))) * 1000
const STALE_MS = Math.max(2, Number(arg('stale-min', '6'))) * 60000
const GRACE_MS = Math.max(0, Number(arg('grace-min', '3'))) * 60000
const ALERT_WIN = 30 * 60000

const log = (...a) => console.log(new Date().toLocaleString('zh-CN'), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const P = (f) => path.join(HOME, f)

const hm = (s) => { const m = String(s).match(/^(\d{1,2}):(\d{2})$/); if (!m) throw new Error('时间格式应为 HH:MM：' + s); return Number(m[1]) * 3600000 + Number(m[2]) * 60000 }
const START_OFF = hm(START)
const END_OFF = hm(END)
const midnight = (now = Date.now()) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() }
function windowOfDay(dayStart) {
  const start = dayStart + START_OFF
  let end = dayStart + END_OFF
  if (end <= start) end += 86400000
  return { start, end }
}
function inWindow(now = Date.now()) {
  const d0 = midnight(now)
  for (let i = -1; i <= 1; i++) { const w = windowOfDay(d0 + i * 86400000); if (now >= w.start && now < w.end) return true }
  return false
}
function nextStart(now = Date.now()) {
  const d0 = midnight(now)
  for (let i = 0; i <= 2; i++) { const w = windowOfDay(d0 + i * 86400000); if (w.start > now) return w.start }
  return now + 86400000
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(P(f), 'utf8')) } catch (e) { return null } }
const readPid = (f) => { try { const n = Number(String(fs.readFileSync(P(f), 'utf8')).trim()); return n > 0 ? n : 0 } catch (e) { return 0 } }
function alive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

// 告警去重：同一 kind 30 分钟一次
function readAlerts() { return readJson('.watchdog-alerts.json') || {} }
function saveAlerts(o) { const now = Date.now(); for (const k of Object.keys(o)) if (now - Number(o[k] || 0) > 7 * 86400000) delete o[k]; try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(P('.watchdog-alerts.json'), JSON.stringify(o)) } catch (e) {} }
async function alertOnce(kind, title, text, level = 'error') {
  const m = readAlerts()
  if (Date.now() - Number(m[kind] || 0) < ALERT_WIN) { log('（' + kind + ' 30 分钟内已报过，不重复推送）'); return false }
  m[kind] = Date.now(); saveAlerts(m)
  await notify({ dir: HOME, title, text, level, event: kind, say: (s) => log('    notify: ' + s) }).catch(() => {})
  return true
}

async function cdpOk() {
  try {
    const r = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(5000) })
    return r.ok
  } catch (e) { return false }
}

function startSupervisor() {
  try {
    const out = fs.openSync(P('supervisor.out.log'), 'a')
    const child = spawn(process.execPath, [SUPERVISOR, '--start', START, '--end', END], { stdio: ['ignore', out, out], env: { ...process.env, QC_HOME: HOME }, detached: true, windowsHide: true })
    child.unref()
    log('已重新拉起守夜进程 pid ' + child.pid)
    return child.pid
  } catch (e) { log('拉起守夜进程失败：' + e.message); return 0 }
}

async function check() {
  const now = Date.now()
  const hb = readJson('heartbeat.json')
  const supPid = readPid('supervisor.pid')
  const watchPid = readPid('watch.pid')
  const issues = []

  if (!hb) issues.push({ kind: 'no-heartbeat', msg: '还没有心跳文件（巡航可能从未成功跑过一轮）' })
  else {
    // 关键：巡航两轮之间最长 15 分钟，所以「多久没更新」不能当成卡死依据。
    // 只有「已经过了它自己说的下一轮时间 + 宽限」才算卡死。
    const hbMs = new Date(hb.ts).getTime()
    const age = now - hbMs
    // 优先用 nextRound（真正的下一轮）；nextAt 可能只是「醒来发整点播报」的时刻，会正常过期
    const dueAt = Number(hb.nextRound || 0) || Number(hb.nextAt || 0) || 0
    const overdue = dueAt ? now > dueAt + GRACE_MS : age > STALE_MS
    if (overdue) issues.push({ kind: 'heartbeat-stale', msg: (dueAt ? '已过下一轮时间 ' + Math.round((now - dueAt) / 60000) + ' 分钟仍未出现新心跳' : '心跳停止 ' + Math.round(age / 60000) + ' 分钟') + '（最后 ' + new Date(hb.ts).toLocaleString('zh-CN') + '，第 ' + (hb.round || '?') + ' 轮' + (dueAt ? '，应于 ' + new Date(dueAt).toLocaleString('zh-CN') + ' 有新心跳' : '') + '）' })
  }
  if (!alive(supPid)) issues.push({ kind: 'supervisor-dead', msg: '守夜进程不存在（supervisor.pid=' + (supPid || '无') + '）' })
  if (!alive(watchPid) && inWindow(now)) issues.push({ kind: 'watch-dead', msg: '巡航进程不存在（watch.pid=' + (watchPid || '无') + '）' })
  const cdp = await cdpOk()
  if (!cdp) issues.push({ kind: 'cdp-down', msg: 'CDP 9222 连不上（Chrome 被关掉或未启动）' })

  if (!issues.length) return { ok: true }
  log('发现问题：' + issues.map((x) => x.kind).join(', '))
  const fixed = []
  if (issues.some((x) => x.kind === 'supervisor-dead')) { const pid = startSupervisor(); if (pid) fixed.push('守夜进程已重启（pid ' + pid + '）') }
  if (!cdp) fixed.push('请双击 start-qc.cmd 重新打开 Chrome 并登录千川')
  if (issues.some((x) => x.kind === 'watch-dead') && alive(supPid)) fixed.push('守夜进程会自动重拉巡航（最多 30 秒）')

  const title = '🚨【巡航看门狗】' + (issues.some((x) => x.kind === 'cdp-down' || x.kind === 'supervisor-dead') ? '巡航已中断' : '巡航可能卡住')
  const text = ['检查时间：' + new Date(now).toLocaleString('zh-CN'), ...issues.map((x) => '• ' + x.msg), ...(fixed.length ? ['', '已处理：', ...fixed.map((s) => '• ' + s)] : []), hb && hb.round ? '最后成功轮次：第 ' + hb.round + ' 轮（' + new Date(hb.ts).toLocaleString('zh-CN') + '）' : ''].filter(Boolean).join('\n')
  await alertOnce('watchdog', title, text)
  return { ok: false, issues }
}

async function recovery() {
  const m = readAlerts()
  if (!m['watchdog']) return
  delete m['watchdog']; saveAlerts(m)
  await notify({ dir: HOME, title: '✅【巡航看门狗】已恢复', text: '之前报过的问题已消失，心跳与进程均正常。\n时间：' + new Date().toLocaleString('zh-CN'), level: 'info', event: 'watchdog-recover', say: (s) => log('    notify: ' + s) }).catch(() => {})
}

if (ONCE) {
  const r = await check()
  console.log(JSON.stringify({ inWindow: inWindow(), ...r }))
  process.exit(r.ok ? 0 : 1)
}

// 单实例
const lock = P('watchdog.pid')
try {
  const old = readPid('watchdog.pid')
  if (old && old !== process.pid && alive(old)) { console.error('已有看门狗在跑（pid ' + old + '），本次不重复启动'); process.exit(4) }
} catch (e) {}
try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(lock, String(process.pid)) } catch (e) {}
process.on('exit', () => { try { if (String(fs.readFileSync(lock, 'utf8')).trim() === String(process.pid)) fs.unlinkSync(lock) } catch (e) {} })

log('看门狗启动：窗口 ' + START + ' ~ 次日 ' + END + '，每 ' + Math.round(INTERVAL / 1000) + ' 秒检查一次（数据目录 ' + HOME + '）')
for (;;) {
  if (!inWindow()) { await sleep(Math.min(Math.max(60000, nextStart() - Date.now()), 30 * 60000)); continue }
  let r
  try { r = await check() } catch (e) { log('检查异常：' + e.message); r = { ok: true } }
  if (r.ok) await recovery().catch(() => {})
  await sleep(INTERVAL)
}
