// store.mjs —— 配置与清单存储层（产品化）
// 数据目录：QC_HOME > ~/.qianchuan-cruise；首次运行从插件自带 config.rules.json 生成一份 targets.json
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const PLUGIN_ASSETS = path.resolve(HERE, '..')

export function homeDir() {
  const env = process.env.QC_HOME
  const dir = env && env.trim() ? path.resolve(env.trim()) : path.join(os.homedir(), '.qianchuan-cruise')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const paths = () => {
  const home = homeDir()
  return {
    home,
    targets: path.join(home, 'targets.json'),
    notify: path.join(home, 'notify.json'),
    rounds: path.join(home, 'rounds.jsonl'),
    errors: path.join(home, 'errors.jsonl'),
    actions: path.join(home, 'actions.jsonl'),
    adMap: path.join(home, 'ad-map.json'),
    pending: path.join(home, 'pending-notify.jsonl'),
  }
}

const DEFAULT_HOURLY = { nodes: [15, 30, 45, 55], roiFloor: 2.4, minCost: 1, budget: 200, controlHours: 0.5, extraRoundAfterEndMinutes: 1 }

function readJson(p, dflt) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return dflt }
}
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n') }

function seedFromLegacy() {
  const legacy = readJson(path.join(PLUGIN_ASSETS, 'config.rules.json'), {})
  const h = legacy.hourly || {}
  const hourly = {
    ...DEFAULT_HOURLY,
    ...(Array.isArray(h.nodes) && h.nodes.length ? { nodes: h.nodes.map(Number) } : {}),
    ...(h.judge && h.judge.value !== undefined ? { roiFloor: Number(h.judge.value) } : {}),
    ...(h.control && h.control.budget !== undefined ? { budget: Number(h.control.budget) } : {}),
    ...(h.minCost !== undefined ? { minCost: Number(h.minCost) } : {}),
    ...(h.controlHoursFixed !== undefined ? { controlHours: Number(h.controlHoursFixed) } : {}),
    ...(h.extraRoundAfterEndMinutes !== undefined ? { extraRoundAfterEndMinutes: Number(h.extraRoundAfterEndMinutes) } : {}),
  }
  const accounts = (legacy.accounts || []).map((a) => ({ key: a.key, aavid: String(a.aavid), name: a.label || a.name || a.key, entry: a.entry || 'uniprom' }))
  const targets = []
  for (const a of legacy.accounts || []) {
    if (!a.aweme) continue
    targets.push({
      id: a.key + '/' + (a.awemeUniqueId || a.aweme),
      account: a.key,
      awemeName: a.aweme,
      awemeUniqueId: a.awemeUniqueId || null,
      ads: a.ads || [],
      rules: {},
      enabled: true,
    })
  }
  return { version: 1, defaults: { hourly }, accounts, targets }
}

export function loadTargets({ init = true } = {}) {
  const p = paths().targets
  let t = readJson(p, null)
  if (!t && init) { t = seedFromLegacy(); writeJson(p, t) }
  if (!t) t = { version: 1, accounts: [], targets: [], defaults: { hourly: { ...DEFAULT_HOURLY } } }
  t.defaults = t.defaults || {}
  t.defaults.hourly = { ...DEFAULT_HOURLY, ...(t.defaults.hourly || {}) }
  t.accounts = t.accounts || []
  t.targets = t.targets || []
  return t
}

export function saveTargets(t) { writeJson(paths().targets, t) }

/** 三层覆盖：defaults.hourly → account.rules.hourly → target.rules.hourly */
export function resolveRule(cfg, target) {
  const acct = (cfg.accounts || []).find((a) => a.key === target.account) || {}
  const base = cfg.defaults.hourly
  const merged = { ...base, ...((acct.rules && acct.rules.hourly) || {}), ...((target.rules && target.rules.hourly) || {}) }
  merged.nodes = (merged.nodes || []).map(Number).filter((n) => n >= 1 && n <= 59).sort((a, b) => a - b)
  merged.roiFloor = Number(merged.roiFloor)
  merged.minCost = Number(merged.minCost)
  merged.budget = Number(merged.budget)
  return merged
}

export function accountOf(cfg, key) { return (cfg.accounts || []).find((a) => a.key === key) }

/** 投放产品线的中文短名：uniprom=全域投放，square=乘方（推直播） */
export function entryLabel(entry) {
  return entry === 'square' ? '乘方' : '全域'
}
export function entryFull(entry) {
  return entry === 'square' ? '乘方-推直播' : '全域投放-推直播间'
}

/** 该抖音号在别的账号里作为主力投放的账号 key（人工指定），没有则 null */
export function deliveringAccount(cfg, target) {
  const uid = target.awemeUniqueId || target.awemeName
  const other = (cfg.targets || []).find((t) => t !== target && t.enabled !== false && (t.awemeUniqueId || t.awemeName) === uid && t.delivery !== 'standby')
  if (!other) return null
  const acct = accountOf(cfg, other.account) || {}
  return { key: other.account, target: other, entry: acct.entry || 'uniprom' }
}

/** 按账号分组：一个账号只切一次页 */
export function groupByAccount(cfg) {
  const out = new Map()
  for (const t of cfg.targets || []) {
    if (t.enabled === false) continue
    const acct = accountOf(cfg, t.account)
    if (!acct) continue
    if (!out.has(acct.key)) out.set(acct.key, { account: acct, targets: [] })
    out.get(acct.key).targets.push(t)
  }
  return [...out.values()]
}

export function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(obj) + '\n')
}

/** 判定：一个抖音号当前小时的聚合 */
export function judgeHourly(target, hour, rule) {
  if (!hour || !hour.rows || !hour.rows.length) return { action: 'skip', reason: 'no-data' }
  const rows = hour.rows
  const cost = rows.reduce((s, r) => s + Number(r.cost || 0), 0)
  const gmv = rows.reduce((s, r) => s + Number(r.gmv || 0), 0)
  const orders = rows.reduce((s, r) => s + Number(r.orders || 0), 0)
  const roi = cost > 0 ? gmv / cost : 0
  const base = { cost: round2(cost), gmv: round2(gmv), orders, roi: round2(roi) }
  if (cost <= 0) return { ...base, action: 'skip', reason: 'no-spend' }
  if (cost < rule.minCost) return { ...base, action: 'skip', reason: 'below-min-cost' }
  if (roi < rule.roiFloor) return { ...base, action: 'control', budget: rule.budget, hours: rule.controlHours }
  return { ...base, action: 'skip', reason: 'roi-ok' }
}

function round2(n) { return Math.round(n * 100) / 100 }

export function nextNodeTime(nodes, from = new Date()) {
  const list = (nodes && nodes.length ? nodes : [15, 30, 45, 55]).map(Number).filter((n) => n >= 0 && n <= 59).sort((a, b) => a - b)
  const base = new Date(from.getTime()); base.setSeconds(0, 0)
  for (let add = 0; add <= 60; add++) {
    const t = new Date(base.getTime() + add * 60_000)
    if (list.includes(t.getMinutes()) && t.getTime() > from.getTime()) return t
  }
  return null
}
