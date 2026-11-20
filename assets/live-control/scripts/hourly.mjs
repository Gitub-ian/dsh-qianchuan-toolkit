#!/usr/bin/env node
/**
 * hourly.mjs —— 按「自然小时」巡航盯盘（v9：抓取/执行两段 + 同名抖音号判别 + 只报异常）
 *
 *   node hourly.mjs --once [--dry-run]             跑一轮（targets.json 所有启用目标）
 *   node hourly.mjs --once --account B             只跑某个账号
 *   node hourly.mjs --watch [--max-rounds 8]       按节点排轮（默认 :15/:30/:45/:55）
 *   node hourly.mjs --doctor                       打印清单与生效规则
 *
 * 通知口径（v9）：只在「异常」时推送 —— 提交失败、日志核对不一致、账号/页面多次失败、
 * 同名抖音号跨账号冲突；控量成功、轮空（已有控量/未开播/ROI 达标/没花钱）一律静默。
 */
import fs from 'node:fs'
import path from 'node:path'
import { sleep } from './cdp-lib.mjs'
import { expr } from './expr-util.mjs'
import { runControl } from './control-lib.mjs'
import { ensureAccount, ensureTabFor, listUrl, detailUrl } from './account-lib.mjs'
import { loadTargets, paths, resolveRule, groupByAccount, judgeHourly, appendJsonl, entryLabel, deliveringAccount } from './store.mjs'
import { notify } from './notify.mjs'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const has = (k) => argv.includes('--' + k)

const DRY = has('dry-run')
const WATCH = has('watch')
const ONLY = arg('account', '')
const MAX_ROUNDS = Number(arg('max-rounds', WATCH ? '8' : '1'))
const STAGE_MS = Number(arg('stage-timeout', '90')) * 1000
const ROUND_MS = Number(arg('round-timeout', '420')) * 1000
const SHOTS = arg('shots', paths().home)
const REPORT_ALL = has('report-all')            // 每轮都把结果推给通知通道（默认只报异常）
const UNTIL = arg('until', '')                  // 例：--until 01:00 跑到次日 01:00 自动收工
function deadlineOf(hhmm) {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return 0
  const d = new Date()
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
  return d.getTime()
}
const DEADLINE = UNTIL ? deadlineOf(UNTIL) : 0

const P = paths()
const pad = (n) => String(n).padStart(2, '0')
const r2 = (n) => Math.round(Number(n) * 100) / 100
const log = (...a) => console.log(new Date().toLocaleTimeString('zh-CN'), ...a)
const jl = appendJsonl
const cfg = loadTargets()

if (!fs.existsSync(P.notify)) log('提示：' + P.notify + ' 不存在，异常也不会推送（可选功能，notify.sample.json 可复制一份）')

function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('超时 ' + Math.round(ms / 1000) + 's：' + label)), ms) }),
  ])
}

async function pollEval(page, src, ok, timeoutMs = 15000, step = 120) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try { const v = await page.eval(src); if (v && v !== '' && v !== 'null' && ok(v)) return v } catch (e) {}
    await sleep(step)
  }
  return null
}

// ---------- 通知：只报异常，且同一异常 30 分钟内不重复 ----------
const ALERT_FILE = () => path.join(P.home, '.alerts.json')
function readAlerts() { try { return JSON.parse(fs.readFileSync(ALERT_FILE(), 'utf8')) } catch (e) { return {} } }
function writeAlerts(o) {
  const now = Date.now()
  for (const k of Object.keys(o)) if (now - Number(o[k] || 0) > 7 * 86400000) delete o[k]
  fs.mkdirSync(P.home, { recursive: true }); fs.writeFileSync(ALERT_FILE(), JSON.stringify(o))
}
async function alert(kind, key, title, text, winMs = 30 * 60000) {
  const m = readAlerts()
  const k = kind + '|' + key
  if (Date.now() - Number(m[k] || 0) < winMs) { log('    （异常 30 分钟内已报过，本轮不重复推送）'); return }
  m[k] = Date.now(); writeAlerts(m)
  await notify({ dir: P.home, title, text, level: 'error', event: kind, say: (s) => log('    notify: ' + s) }).catch(() => {})
}

// ---------- 控量中：读弹窗里的控量结束时间（只读，点 X 关闭，绝不点「确定」） ----------
async function readPauseInfo(page, aweme) {
  try {
    const v = await page.eval(expr('pause-info.js', { '{{AWEME}}': aweme }))
    return JSON.parse(v)
  } catch (e) {
    return { ok: false, reason: 'eval-failed：' + e.message }
  }
}

// ---------- 抓取阶段 ----------
async function ensureAdMap(page, acct, adIds, stage) {
  const t0 = Date.now()
  const file = path.join(P.home, 'ad-map-' + acct.aavid + '.json')
  const map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { ads: {} }
  map.ads ||= {}
  const missing = adIds.filter((id) => !(map.ads[id] && map.ads[id].name))
  for (const id of missing) {
    await page.send('Page.navigate', { url: detailUrl(acct.aavid, id) })
    const raw = await pollEval(page, expr('admap-head.js'), (v) => { try { return !!JSON.parse(v).adId } catch (e) { return false } }, 12000)
    if (raw) { const o = JSON.parse(raw); map.ads[o.adId] = { name: o.name, uniqueId: o.uniqueId } }
  }
  if (missing.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(map, null, 1))
    await page.send('Page.navigate', { url: listUrl(acct) })
    await pollEval(page, expr('row-state.js'), (v) => { try { const o = JSON.parse(v); return o.rows.length > 0 && o.iconsReady } catch (e) { return false } }, 15000)
  }
  stage.mapMs = Date.now() - t0
  return map
}

/** 该抖音号在当前小时的数据：优先用清单登记的 ads，没有就按 ad-map 反查 */
function targetHour(data, target, adMap) {
  const all = new Map()
  for (const r of data.rows || []) {
    const id = String(r.adId)
    if (!/^\d{6,}$/.test(id)) continue
    const h = String(r.hour)
    const key = id + '|' + h
    const prev = all.get(key) || { adId: id, hour: h, cost: 0, gmv: 0, orders: 0 }
    prev.cost += Number(r.cost || 0); prev.gmv += Number(r.gmv || 0); prev.orders += Number(r.orders || 0)
    all.set(key, prev)
  }
  let ads = (target.ads || []).map(String)
  if (!ads.length) {
    ads = Object.entries(adMap.ads || {}).filter(([, v]) => v.name === target.awemeName || (target.awemeUniqueId && v.uniqueId === target.awemeUniqueId)).map(([k]) => k)
  }
  const hour = pad(new Date().getHours())
  const rows = [...all.values()].filter((r) => ads.includes(r.adId) && r.hour.endsWith(hour + ':00'))
  const merged = rows.reduce((a, r) => ({ cost: a.cost + r.cost, gmv: a.gmv + r.gmv, orders: a.orders + r.orders }), { cost: 0, gmv: 0, orders: 0 })
  return { hour, ads, rows, cost: merged.cost, gmv: merged.gmv, orders: merged.orders }
}

// ---------- 每账号一个标签页（全程复用，不来回切） ----------
const pageByKey = new Map()
async function pageFor(acct) {
  const cached = pageByKey.get(acct.key)
  if (cached) { const p = await cached.ping(); if (p.ok) return cached }
  const p = await ensureTabFor(acct, (m) => log('    [' + acct.key + '] ' + m))
  pageByKey.set(acct.key, p)
  return p
}

async function gatherAccount(group) {
  const acct = group.account
  const stage = {}
  const t0 = Date.now()
  const out = { key: acct.key, aavid: acct.aavid, name: acct.name, entry: acct.entry, entryLabel: entryLabel(acct.entry), layout: null, day: null, decisions: [], anomalies: [], done: [], stageMs: stage }

  log('  [' + acct.key + '|' + entryLabel(acct.entry) + '] 打开账号标签页 / 进入口…')
  let t = Date.now()
  let page
  try { page = await withTimeout(pageFor(acct), STAGE_MS, '打开标签页') }
  catch (e) { out.err = 'tab-open-failed：' + e.message; stage.totalMs = Date.now() - t0; return out }
  stage.tabMs = Date.now() - t
  await page.eval(expr('close-dialog.js')).catch(() => {})
  const acc = await withTimeout(ensureAccount(page, acct, (m) => log('    ' + m)), STAGE_MS, '切账号').catch((e) => ({ ok: false, err: e.message }))
  stage.accountMs = Date.now() - t
  if (!acc || !acc.ok) { out.err = (acc && acc.err) || 'account-not-ready'; stage.totalMs = Date.now() - t0; return out }
  out.accountId = acc.account.id

  // 每轮强制刷新列表页：SPA 内部点击导航不会重新拉「调控工具」图标，
  // 控量结束后图标仍会残留，导致把「已结束」误判成「还在控」而漏控。
  log('    [' + acct.key + '] 刷新列表页（强制、忽略缓存）…')
  t = Date.now()
  // 之前可能停在详情页（/uni-prom/detail 也有 th 表头，会被误判成就绪）→ 先确认路径是列表页
  const wantPath = new URL(listUrl(acct)).pathname
  if (new URL(page.url).pathname !== wantPath) {
    await page.send('Page.navigate', { url: listUrl(acct) }).catch(() => {})
    await sleep(600)
  }
  let origin0 = null
  try { origin0 = String(await page.eval('performance.timeOrigin')) } catch (e) {}
  await page.send('Page.reload', { ignoreCache: true }, 20000).catch(() => {})
  // 等真正的重新加载：timeOrigin 变了才算新文档，否则会读到刷新前的旧 DOM（或空 DOM）
  await pollEval(page, 'performance.timeOrigin', (v) => v && String(v) !== origin0, 12000, 200)
  await sleep(300)
  const wantLayout = acct.entry === 'square' ? 'square' : 'uni-prom'
  const rf = await pollEval(page, expr('row-state.js'), (s) => {
    try {
      const v = JSON.parse(s)
      if (!v || !v.hasAwemeCol || !v.iconsReady) return false
      if (v.layout !== wantLayout) return false
      if (new URL(page.url).pathname !== wantPath) return false
      return (v.rows || []).some((r) => r.aweme && String(r.aweme).trim().length > 1)
    } catch (e) { return false }
  }, 15000, 350)
  stage.refreshMs = Date.now() - t
  if (!rf) log('    [' + acct.key + '] 刷新后 15s 仍未就绪，继续按当前 DOM 读')

  log('    [' + acct.key + '] 读列表…')
  t = Date.now()
  await sleep(450)
  const v2 = JSON.parse(await page.eval(expr('row-state.js')))
  // 绝不要合并 ensureAccount 里的 acc.view.rows：那是「刷新前」的快照（可能是上一轮的 DOM），
  // 会把已经结束的旧 ⏸ 图标续命 → 误判「控量中」（2026-11-19 23:14 事故根因）。刷新后的 DOM 才是唯一依据。
  const rows = v2.rows.map((r) => ({ ...r }))
  out.layout = v2.layout
  stage.rowsMs = Date.now() - t

  log('    [' + acct.key + '] 查分时数据…')
  t = Date.now()
  const groupAds = [...new Set(group.targets.flatMap((x) => x.ads || []).map(String).filter((id) => /^\d{6,}$/.test(id)))]
  const data = JSON.parse(await page.eval(expr('hourly-data.js', { '{{ADV}}': acct.aavid, '{{ADS}}': JSON.stringify(groupAds) })))
  stage.queryMs = Date.now() - t
  if (!data.rows) { out.err = 'no-data'; stage.totalMs = Date.now() - t0; return out }
  out.day = data.day

  const adIds = [...new Set(data.rows.map((r) => String(r.adId)))].filter((id) => /^\d{6,}$/.test(id))
  const needMap = group.targets.some((x) => !(x.ads || []).length)
  t = Date.now()
  const adMap = needMap ? await ensureAdMap(page, acct, adIds, stage) : { ads: {} }
  if (needMap) { const again = await ensureAccount(page, acct, () => {}); if (again && again.view) acc.view = again.view }

  for (const target of group.targets) {
    const rule = resolveRule(cfg, target)
    const hr = targetHour(data, target, adMap)
    const row = rows.find((r) => (target.awemeUniqueId && r.aweme === target.awemeUniqueId) || r.aweme === target.awemeName || (target.awemeName && r.aweme.includes(target.awemeName.slice(0, 4)))) || null
    const acts = readJsonl(P.actions).filter((a) => a.ok && !a.dryRun && a.aavid === acct.aavid && a.aweme === target.awemeName)
    const other = target.delivery === 'standby' ? deliveringAccount(cfg, target) : null
    let d
    if (target.delivery === 'standby') d = { action: 'skip', reason: 'standby：该抖音号实际由 ' + (other ? other.key + '(' + entryLabel(other.entry) + ')' : '其他账号') + ' 投放，此账号仅备用，不控' }
    else if (!row) d = { action: 'skip', reason: 'row-not-found：列表里没找到这个抖音号（是否已解绑/改名？）' }
    else if (row.mode === 'pause') {
      // 行上 ⏸ = 有控量任务在跑：点开确认弹窗读「控量时间 起 ~ 止」，记下结束时间，到点后加跑一轮。
      const pi = await readPauseInfo(page, target.awemeName)
      const nowMs = Date.now()
      if (pi && pi.ok && pi.endAt) {
        const stale = pi.endAt < nowMs - 60000
        d = {
          action: 'skip',
          reason: 'controlling：正在控量 ' + pi.startText + ' ~ ' + pi.endText + (pi.budget ? '（预算 ' + pi.budget + ' 元）' : '') + (stale ? ' —— 异常：结束时间已过，⏸ 图标仍在（疑似残留）' : '，结束后加跑一轮'),
          endAt: pi.endAt,
          pauseInfo: { startText: pi.startText, endText: pi.endText, budget: pi.budget },
          anomaly: stale ? 'pause-stale' : undefined,
        }
      } else {
        d = {
          action: 'skip',
          anomaly: 'pause-dialog-missing',
          reason: '异常：列表显示控量中，但点开读不到「控量时间」（' + ((pi && pi.reason) || 'unknown') + '），本轮轮空',
        }
      }
    } else if (row.mode === 'unknown') {
      // 找不到「一键调速」组 = 页面结构变了/没渲染完，逻辑上不能当成「控量中」。
      d = { action: 'skip', anomaly: 'no-speed-group', reason: '异常：页面里找不到「一键调速」组（可能改版或未渲染完），无法判断能否控量，本轮轮空' }
    } else if (!row.live) d = { action: 'skip', reason: 'not-live：' + (row.status || '未在投放') }
    else if (!hr.ads.length) d = { action: 'skip', reason: 'no-ads：没有该抖音号的 ad_id（先跑一次映射）' }
    else if (!hr.rows.length) d = { action: 'skip', reason: 'no-spend：本小时还没有消耗数据（刚开播或还没花钱）' }
    else d = judgeHourly(target, hr, rule)

    const rec = {
      target: target.id, aweme: target.awemeName, uid: target.awemeUniqueId || target.awemeName,
      account: acct.key, entry: acct.entry, entryLabel: entryLabel(acct.entry),
      adId: hr.ads[0] || null, rowStatus: row ? row.status : '', live: !!(row && row.live), hasPause: row ? !!row.hasPause : null,
      hour: hr.hour, cost: r2(hr.cost), gmv: r2(hr.gmv), orders: hr.orders,
      roi: hr.cost > 0 ? r2(hr.gmv / hr.cost) : 0,
      rule: { roiFloor: rule.roiFloor, budget: rule.budget }, decision: d,
    }
    out.decisions.push(rec)
    if (d.anomaly) out.anomalies.push({ aweme: rec.aweme, kind: d.anomaly, msg: d.reason, hour: hr.hour })
    log('    ' + '[' + rec.entryLabel + '] ' + rec.aweme + ' [' + (row ? row.status : '未找到') + '] ' + hr.hour + '时 消耗 ' + rec.cost + ' 净成交 ' + rec.gmv + ' ROI ' + rec.roi + ' → ' + d.action + ' ' + (d.reason || ''))
  }
  // 逻辑自查：判定与现场证据不自洽就是异常（不只是「轮空」）
  for (const dd of out.decisions) {
    if (dd.decision.action === 'control' && dd.hasPause) out.anomalies.push({ aweme: dd.aweme, kind: 'contradiction', msg: '判定要控量，但同一行显示控量中', hour: dd.hour })
    if (dd.decision.action === 'control' && !dd.live) out.anomalies.push({ aweme: dd.aweme, kind: 'contradiction', msg: '判定要控量，但该抖音号不在投放', hour: dd.hour })
  }
  for (const a of out.anomalies) log('    ⚠ 异常[' + a.aweme + '] ' + a.msg)
  stage.totalMs = Date.now() - t0
  return out
}

// ---------- 同名抖音号判别（跨账号） ----------
function resolveCrossAccount(recs) {
  const byUid = new Map()
  for (const rec of recs) {
    if (rec.err) continue
    for (const d of rec.decisions) {
      if (!byUid.has(d.uid)) byUid.set(d.uid, [])
      byUid.get(d.uid).push(d)
    }
  }
  for (const [uid, list] of byUid) {
    if (list.length < 2) continue
    const live = list.filter((x) => x.live)
    const where = list.map((x) => x.account + '(' + x.entryLabel + ')').join(' / ')
    if (live.length > 1) {
      const msg = '同名抖音号「' + uid + '」在多个账号同时投放：' + where + '。无法判断该控哪一个，本轮全部跳过，请手动指定。'
      log('    ⚠ ' + msg)
      for (const d of live) {
        if (d.decision.action === 'control') d.decision = { action: 'skip', reason: 'ambiguous：同名抖音号跨账号同时投放，需人工指定' }
        d.conflict = 'ambiguous'
      }
      alert('ambiguous-aweme', uid, '千川控量：同名抖音号跨账号冲突', msg, 6 * 3600000)
    } else if (live.length === 1) {
      const on = live[0]
      log('    同名抖音号「' + uid + '」存在于 ' + where + '，仅 ' + on.account + '(' + on.entryLabel + ') 在投放 → 只对该账号生效')
      for (const d of list) d.delivery = on.account + '(' + on.entryLabel + ')'
    }
  }
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch (e) { return null } }).filter(Boolean)
}

function parseLogTime(s) {
  const m = String(s).match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})时(\d{1,2})分/)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0).getTime()
}

async function verifyLog(page, acct, o) {
  const t0 = Date.now()
  await page.send('Page.navigate', { url: detailUrl(acct.aavid, o.adId) })
  const head = await pollEval(page, expr('admap-head.js'), (v) => { try { return !!JSON.parse(v).adId } catch (e) { return false } }, 12000)
  const raw = head ? await pollEval(page, expr('plan-log.js'), (v) => { try { return (JSON.parse(v).rows || []).length > 0 } catch (e) { return false } }, 12000) : null
  await page.send('Page.navigate', { url: listUrl(acct) })
  if (!head || !raw) return { ms: Date.now() - t0, verified: false, err: !head ? 'no-detail-head' : 'no-log-rows' }
  const rows = JSON.parse(raw).rows || []
  const row = rows.find((r) => /新建/.test(r.type) && /一键控量/.test(r.content)) || null
  if (!row) return { ms: Date.now() - t0, verified: false, err: 'no-control-log-row', rows: rows.slice(0, 3) }
  const nBudget = Number((row.content.match(/控量预算[：:]\s*([\d.]+)/) || [])[1])
  const nHours = Number((row.content.match(/控量时长[：:]\s*([\d.]+)/) || [])[1])
  const at = parseLogTime(row.content)
  const want = new Date(o.submittedAt).getTime()
  const checks = { budget: nBudget === Number(o.budget), hours: nHours === Number(o.hours), time: at != null && Math.abs(at - want) <= 120000, deltaSec: at != null ? Math.round((at - want) / 1000) : null, logBudget: nBudget, logHours: nHours, logAt: row.content.slice(0, 120) }
  return { ms: Date.now() - t0, verified: checks.budget && checks.hours && checks.time, checks, row, rows: rows.slice(0, 3), detail: JSON.parse(head) }
}

// ---------- 执行阶段 ----------
// 提交失败后的自动重试：3 分钟后加跑一轮；同一目标连续失败 2 次就停手，交人工
const failStreak = new Map()
const RETRY_DELAY_MS = 180000

async function executeAccount(group, rec) {
  const acct = group.account
  const todo = rec.decisions.filter((d) => d.decision.action === 'control')
  if (!todo.length) return
  if (DRY) {
    for (const d of todo) { rec.done.push({ ...d, mode: 'dry-run' }); log('    [' + acct.key + '] [dry-run] 应控 ' + d.aweme + ' 预算 ' + d.decision.budget) }
    return
  }

  log('  [' + acct.key + '|' + rec.entryLabel + '] 回到账号标签页准备提交…')
  const page = await pageFor(acct).catch((e) => null)
  const acc = page ? await withTimeout(ensureAccount(page, acct, (m) => log('    ' + m)), STAGE_MS, '确认账号').catch((e) => ({ ok: false, err: e.message })) : { ok: false, err: 'tab-lost' }
  if (!acc || !acc.ok) {
    for (const d of todo) { d.exec = { ok: false, code: 'account-not-ready' }; rec.done.push(d) }
    await alert('account-fail', acct.key, '千川控量：切账号失败，未能提交', acct.name + '(' + acct.key + ') 切账号失败：' + ((acc && acc.err) || 'timeout') + '，本轮以下目标未控：' + todo.map((d) => d.aweme).join('、'))
    return
  }

  for (const dr of todo) {
    log('    [' + acct.key + '] 提交控量：' + dr.aweme + ' 预算 ' + dr.decision.budget)
    const r = await runControl(page, { aweme: dr.aweme, budget: dr.decision.budget, shots: SHOTS, aavid: acct.aavid, listUrl: listUrl(acct), say: (m) => log('      ' + m) })
    const at = { ts: new Date().toISOString(), account: acct.key, entry: acct.entry, aavid: acct.aavid, target: dr.target, aweme: dr.aweme, adId: dr.adId, budget: dr.decision.budget, hours: 0.5, hour: dr.hour, ok: !!r.ok, dryRun: false, code: r.code, stage: r.stage, submittedAt: r.submittedAt, dialogGone: r.dialogGone, clickedAt: r.clickedAt ? { how: r.clickedAt.how, x: r.clickedAt.x, y: r.clickedAt.y } : null, rowMode: r.rowMode, retried: r.retried ? { how: r.retried.how, x: r.retried.x, y: r.retried.y } : null }
    if (r.ok) {
      failStreak.delete(dr.target)
      const v = await verifyLog(page, acct, { adId: dr.adId, budget: at.budget, hours: 0.5, submittedAt: r.submittedAt })
      at.logVerified = v.verified; at.logCheck = v.checks || { err: v.err }; at.logMs = v.ms
      rec.stageMs.verifyMs = (rec.stageMs.verifyMs || 0) + v.ms
      if (v.row) at.logRow = v.row
      if (!v.verified) {
        await alert('log-mismatch', at.target, '千川控量：提交成功但日志核对不一致',
          [acct.name + ' / ' + dr.aweme + '（' + rec.entryLabel + '）', '预算 ' + at.budget + ' 元 / 0.5 小时，提交时刻 ' + at.submittedAt,
            '日志核对未通过：' + JSON.stringify(at.logCheck), at.logRow ? '日志行：' + JSON.stringify(at.logRow).slice(0, 300) : '（没找到日志行）'].join('\n'))
      }
    } else {
      // 判定该控却没提交成功：不能就这么等到下一个 10 分钟节点（09:45 事故的教训）
      const n = (failStreak.get(dr.target) || 0) + 1
      failStreak.set(dr.target, n)
      let retryNote = ''
      if (n <= 2) {
        const retryAt = Date.now() + RETRY_DELAY_MS
        extras.push(retryAt)
        at.retryAt = new Date(retryAt).toISOString()
        retryNote = '将在 ' + new Date(retryAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + ' 自动重试（第 ' + n + ' 次）'
        log('      提交失败，' + retryNote)
      } else {
        retryNote = '已连续失败 ' + n + ' 次，停止自动重试，请人工介入'
        log('      提交失败，' + retryNote)
      }
      await alert(n <= 2 ? 'control-fail' : 'control-fail-x', at.target, n <= 2 ? '千川控量：提交失败，稍后自动重试' : '⚠️ 千川控量：连续提交失败，需人工介入',
        [acct.name + ' / ' + dr.aweme + '（' + rec.entryLabel + '）', dr.hour + '时 消耗 ' + dr.cost + ' 净成交 ' + dr.gmv + ' ROI ' + dr.roi + '（阈值 <' + dr.rule.roiFloor + '）',
          '预算 ' + at.budget + ' 元 / 0.5 小时', '提交失败 code=' + at.code + ' stage=' + at.stage,
          at.clickedAt ? '点击方式 ' + (at.clickedAt.how || '?') + (at.clickedAt.x != null ? ' @' + at.clickedAt.x + ',' + at.clickedAt.y : '') : '',
          retryNote].filter(Boolean).join('\n'))
    }
    jl(P.actions, at)
    rec.done.push({ ...dr, exec: { ok: at.ok, code: at.code, logVerified: at.logVerified, logCheck: at.logCheck, retryAt: at.retryAt } })
  }
}

// ---------- 每轮结果推送（--report-all 时，不论正常还是异常都发） ----------
async function reportRound(i, recs, nextAt) {
  const lines = []
  for (const rec of recs) {
    if (rec.err) { lines.push('• ' + (rec.name || rec.key) + '：读取失败 — ' + rec.err); continue }
    for (const d of rec.decisions) {
      const done = (rec.done || []).find((x) => x.target === d.target && x.aweme === d.aweme)
      let tail = d.decision.action
      if (d.decision.action === 'control') {
        if (done && done.exec) tail = done.exec.ok ? '已提交控量 ' + d.decision.budget + ' 元 / 0.5 小时' + (done.exec.logVerified === true ? '，日志核对通过' : done.exec.logVerified === false ? '，日志核对未通过' : '') : '提交失败 code=' + done.exec.code + (done.exec.retryAt ? '，已排 ' + new Date(done.exec.retryAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + ' 自动重试' : '')
        else if (done && done.mode === 'dry-run') tail = 'dry-run：应控 ' + d.decision.budget + ' 元'
      } else if (d.decision.reason) tail += '：' + d.decision.reason
      lines.push('• ' + d.aweme + '（' + d.entryLabel + '）' + d.hour + '时 消耗 ' + d.cost + ' / 净成交 ' + d.gmv + ' / ROI ' + d.roi + ' → ' + tail)
    }
  }
  const anomalies = []
  for (const rec of recs) {
    if (rec.err) anomalies.push({ aweme: rec.name || rec.key, msg: '读取失败 ' + rec.err })
    for (const a of rec.anomalies || []) anomalies.push({ aweme: (rec.name ? rec.name + ' / ' : '') + a.aweme, msg: a.msg })
  }
  const head = anomalies.length ? ['⚠️ 本轮有 ' + anomalies.length + ' 处异常，请人工确认：', ...anomalies.map((a) => '  ⚠️ ' + a.aweme + ' — ' + a.msg)] : []
  const text = [...(anomalies.length ? head : []), '第 ' + i + ' 轮 · ' + new Date().toLocaleString('zh-CN'), ...lines, '下一轮 ' + (nextAt ? new Date(nextAt).toLocaleString('zh-CN') : '（收工）')].join('\n')
  await notify({ dir: P.home, title: (anomalies.length ? '⚠️【异常】' : '') + '千川巡航：第 ' + i + ' 轮结果', text, level: anomalies.length ? 'warn' : 'info', event: 'round', say: (s) => log('    notify: ' + s) }).catch(() => {})
}

// ---------- 轮次调度 ----------
function nextSlot(nodes, extraAt = [], lastStart = 0) {
  const now = Date.now()
  const floor = Math.max(now + 20000, lastStart + 120000)   // 上一轮结束后至少隔 2 分钟，避免加跑轮和节点轮贴在一起
  const cands = []
  for (const h of [new Date(), new Date(Date.now() + 3600000), new Date(Date.now() + 7200000)]) {
    for (const m of nodes) {
      const d = new Date(h.getFullYear(), h.getMonth(), h.getDate(), h.getHours(), m, 0, 0)
      if (d.getTime() > floor) cands.push(d.getTime())
    }
  }
  for (const e of extraAt) if (e > floor) cands.push(e)
  return cands.length ? Math.min(...cands) : now + 900000
}

// ---- main ----
if (has('doctor')) {
  console.log('数据目录 ' + P.home)
  for (const g of groupByAccount(cfg)) for (const t of g.targets) {
    const r = resolveRule(cfg, t)
    console.log('  ' + t.id + ' @' + g.account.key + '(' + entryLabel(g.account.entry) + ')  ROI<' + r.roiFloor + ' 预算' + r.budget + ' 节点' + r.nodes.join(','))
  }
  process.exit(0)
}

const groups = groupByAccount(cfg).filter((g) => !ONLY || g.account.key === ONLY || g.account.aavid === ONLY)
if (!groups.length) { console.error('没有可跑的监控目标（先 node targets.mjs add 或改 targets.json）'); process.exit(2) }

log('本轮 ' + groups.length + ' 个账号 / ' + groups.reduce((s, g) => s + g.targets.length, 0) + ' 个目标' + (DRY ? ' [dry-run]' : '') + (REPORT_ALL ? ' [每轮推送]' : '') + (DEADLINE ? ' [跑到 ' + new Date(DEADLINE).toLocaleString('zh-CN') + ']' : ''))
if (REPORT_ALL && WATCH) {
  const r0 = resolveRule(cfg, groups[0].targets[0])
  await notify({ dir: P.home, title: '千川巡航：已启动', text: ['开始巡航，' + (DEADLINE ? '将持续到 ' + new Date(DEADLINE).toLocaleString('zh-CN') : '持续运行') + '，每轮结果都会推送到这里。', '目标：' + groups.flatMap((g) => g.targets.map((t) => t.awemeName + '（' + entryLabel(g.account.entry) + '）')).join('、'), '规则：小时消耗 > ' + r0.minCost + ' 元 且 净成交 ROI < ' + r0.roiFloor + ' → 一键控量 ' + r0.budget + ' 元 / 0.5 小时'].join('\n'), level: 'info', event: 'start', say: (s) => log('    notify: ' + s) }).catch(() => {})
}
try { await pageFor(groups[0].account) } catch (e) {
  console.error('连不上 CDP 9222 或打不开标签页：' + e.message + '\n请先双击 start-qc.cmd 启动 Chrome 并登录千川'); process.exit(3)
}
const extras = []
try {
  for (let i = 1; i <= MAX_ROUNDS; i++) {
    const roundStart = Date.now()
    log('=== 第 ' + i + '/' + MAX_ROUNDS + ' 轮 ' + new Date().toLocaleString('zh-CN') + (DRY ? ' [dry-run]' : '') + ' ===')
    const recs = []
    for (const g of groups) {
      let rec
      try { rec = await withTimeout(gatherAccount(g), ROUND_MS, '账号 ' + g.account.key + ' 抓取') }
      catch (e) {
        rec = { key: g.account.key, name: g.account.name, err: e.message, decisions: [], done: [], stageMs: {} }
        jl(P.errors, { ts: new Date().toISOString(), round: i, account: g.account.key, stage: 'gather', err: e.message })
        await alert('gather-fail', g.account.key, '千川控量：读账户失败（本轮未控量）', g.account.name + '(' + g.account.key + ') 抓取阶段失败：' + e.message)
      }
      recs.push(rec)
      if (rec.err) log('  [' + g.account.key + '] 失败：' + rec.err)
    }
    resolveCrossAccount(recs)
    for (const rec of recs) {
      if (rec.err) continue
      const g = groups.find((x) => x.account.key === rec.key)
      try { await withTimeout(executeAccount(g, rec), ROUND_MS, '账号 ' + rec.key + ' 提交') }
      catch (e) { jl(P.errors, { ts: new Date().toISOString(), round: i, account: rec.key, stage: 'execute', err: e.message }); log('  [' + rec.key + '] 提交阶段失败：' + e.message) }
      for (const d of rec.decisions) if (d.decision.endAt) extras.push(new Date(d.decision.endAt).getTime() + 60000)
    }
    for (const rec of recs) { delete rec._group }
    jl(P.rounds, { ts: new Date().toISOString(), round: i, ms: Date.now() - roundStart, accounts: recs })
    log('本轮耗时 ' + ((Date.now() - roundStart) / 1000).toFixed(1) + 's')
    const nodes = [...new Set(groups.flatMap((g) => g.targets.flatMap((t) => resolveRule(cfg, t).nodes)))].sort((a, b) => a - b)
    const last = i === MAX_ROUNDS
    const next = last ? 0 : nextSlot(nodes, extras, roundStart)
    // 有异常时即使没开 --report-all 也要推，异常必须让人看到
    if (REPORT_ALL || recs.some((r) => (r.anomalies || []).length)) await reportRound(i, recs, next)
    if (last) break
    if (DEADLINE && next > DEADLINE) {
      log('已到收工时间 ' + new Date(DEADLINE).toLocaleString('zh-CN') + '，巡航结束')
      if (REPORT_ALL) await notify({ dir: P.home, title: '千川巡航：已收工', text: '本轮后到达停止时间 ' + new Date(DEADLINE).toLocaleString('zh-CN') + '，巡航结束。', level: 'info', event: 'stop', say: (s) => log('    notify: ' + s) }).catch(() => {})
      break
    }
    const waitMs = Math.max(0, next - Date.now())
    log('下一轮 ' + new Date(next).toLocaleString('zh-CN') + '（' + Math.round(waitMs / 60000) + ' 分钟后，本轮已推送结果）')
    await sleep(waitMs)
  }
} finally {
  for (const p of pageByKey.values()) p.close()   // 只断 WS，标签页留着给下一轮/下一账号用
}
log('完成。埋点：' + P.rounds)
