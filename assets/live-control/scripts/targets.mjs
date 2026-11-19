#!/usr/bin/env node
// targets.mjs —— 监控清单 CLI：targets add|list|rm|on|off、accounts、doctor
import fs from 'node:fs'
import { loadTargets, saveTargets, paths, groupByAccount, resolveRule, accountOf, entryLabel } from './store.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0] || 'list'
function arg(name, dflt) { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt }

const cfg = loadTargets()

function printTable(rows) {
  const cols = Object.keys(rows[0] || {})
  if (!cols.length) { console.log('(空)'); return }
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)))
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(w[i])).join('  ')
  console.log(line(cols))
  console.log(line(cols.map((c) => '-'.repeat(c.length))))
  for (const r of rows) console.log(line(cols.map((c) => r[c])))
}

if (cmd === 'account-add') {
  const key = arg('key'); const aavid = arg('aavid'); const name = arg('name') || key
  const entry = arg('entry', 'uniprom')
  if (!key || !aavid) { console.error('用法：account-add --key A --aavid 1865... --name "账户名" [--entry uniprom|square]'); process.exit(2) }
  if (!/^\d{8,}$/.test(aavid)) { console.error('aavid 应为 16 位数字：' + aavid); process.exit(2) }
  if (!['uniprom', 'square'].includes(entry)) { console.error('entry 只能是 uniprom（全域投放）或 square（乘方）'); process.exit(2) }
  if (cfg.accounts.some((a) => a.key === key || String(a.aavid) === aavid)) { console.error('账号已存在（key 或 aavid 重复）'); process.exit(3) }
  cfg.accounts.push({ key, aavid, name, entry })
  saveTargets(cfg)
  console.log('已加入账号：' + key + ' / ' + aavid + ' / ' + entryLabel(entry) + ' / ' + name)
} else if (cmd === 'account-rm') {
  const key = argv[1]
  const i = cfg.accounts.findIndex((a) => a.key === key || String(a.aavid) === key)
  if (i < 0) { console.error('找不到账号：' + key); process.exit(2) }
  const used = cfg.targets.filter((t) => t.account === cfg.accounts[i].key)
  if (used.length) { console.error('该账号下还有 ' + used.length + ' 个目标，先 targets rm：' + used.map((t) => t.id).join(', ')); process.exit(3) }
  cfg.accounts.splice(i, 1); saveTargets(cfg); console.log('已删除账号：' + key)
} else if (cmd === 'accounts') {
  printTable(cfg.accounts.map((a) => ({ key: a.key, aavid: a.aavid, entry: a.entry, name: a.name })))
} else if (cmd === 'add') {
  const account = arg('account')
  const acct = cfg.accounts.find((a) => a.key === account)
  if (!acct) { console.error('没有这个账号 key：' + account + '（先看 targets.mjs accounts）'); process.exit(2) }
  const awemeName = arg('name')
  const uid = arg('uid') || null
  if (!awemeName) { console.error('需要 --name <抖音号昵称>'); process.exit(2) }
  if (cfg.targets.some((t) => t.account === account && (t.awemeName === awemeName || (uid && t.awemeUniqueId === uid)))) {
    console.error('清单里已有这个账号下的该抖音号'); process.exit(3)
  }
  const t = { id: account + '/' + (uid || awemeName), account, awemeName, awemeUniqueId: uid, ads: (arg('ads') || '').split(',').filter(Boolean), rules: {}, enabled: true }
  if (argv.includes('--standby')) t.delivery = 'standby'
  const roi = arg('roi'); const budget = arg('budget'); const nodes = arg('nodes')
  if (roi) t.rules.hourly = { ...(t.rules.hourly || {}), roiFloor: Number(roi) }
  if (budget) t.rules.hourly = { ...(t.rules.hourly || {}), budget: Number(budget) }
  if (nodes) t.rules.hourly = { ...(t.rules.hourly || {}), nodes: nodes.split(',').map(Number) }
  cfg.targets.push(t)
  saveTargets(cfg)
  console.log('已加入：' + t.id)
} else if (cmd === 'standby' || cmd === 'primary') {
  const id = argv[1]
  const i = cfg.targets.findIndex((t) => t.id === id || t.awemeName === id)
  if (i < 0) { console.error('找不到目标：' + id); process.exit(2) }
  const t = cfg.targets[i]
  if (cmd === 'standby') { t.delivery = 'standby'; console.log('已标为备用（该抖音号由别的账号投放，本账号不控）：' + t.id) }
  else { delete t.delivery; console.log('已标为主力投放：' + t.id) }
  const same = cfg.targets.filter((x) => (x.awemeUniqueId || x.awemeName) === (t.awemeUniqueId || t.awemeName))
  if (same.length > 1) console.log('  同名抖音号还有：' + same.map((x) => x.id + (x.delivery === 'standby' ? '(备用)' : '(主力)')).join(' / '))
  saveTargets(cfg)
} else if (cmd === 'rm' || cmd === 'on' || cmd === 'off') {
  const id = argv[1]
  const i = cfg.targets.findIndex((t) => t.id === id || t.awemeName === id)
  if (i < 0) { console.error('找不到目标：' + id); process.exit(2) }
  if (cmd === 'rm') { cfg.targets.splice(i, 1); console.log('已删除：' + id) }
  else { cfg.targets[i].enabled = cmd === 'on'; console.log((cmd === 'on' ? '已启用：' : '已停用：') + cfg.targets[i].id) }
  saveTargets(cfg)
} else if (cmd === 'doctor') {
  const p = paths()
  console.log('数据目录     ' + p.home)
  console.log('清单文件     ' + p.targets)
  console.log('通知配置     ' + p.notify)
  let notifyOk = false
  try { const n = JSON.parse(fs.readFileSync(p.notify, 'utf8')); notifyOk = (n.channels || []).some((c) => c.enabled !== false) } catch (e) {}
  console.log('通知通道     ' + (notifyOk ? '已配置' : '未配置（notify.json 缺失或无启用通道）'))
  console.log('账号数       ' + cfg.accounts.length)
  const groups = groupByAccount(cfg)
  console.log('启用目标数   ' + groups.reduce((s, g) => s + g.targets.length, 0) + '（' + groups.length + ' 个账号）')
  for (const g of groups) {
    for (const t of g.targets) {
      const r = resolveRule(cfg, t)
      console.log('  - ' + (t.awemeUniqueId || t.awemeName) + ' @' + g.account.key + '(' + entryLabel(g.account.entry) + ')  ROI<' + r.roiFloor + ' 预算' + r.budget + ' 节点' + r.nodes.join(','))
    }
  }
} else {
  printTable(cfg.targets.map((t) => ({ id: t.id, account: t.account, entry: entryLabel((accountOf(cfg, t.account) || {}).entry), aweme: t.awemeName, uid: t.awemeUniqueId || '', role: t.delivery === 'standby' ? '备用' : '主力', ads: (t.ads || []).join(','), enabled: t.enabled !== false })))
  const groups = groupByAccount(cfg)
  console.log('')
  console.log('启用 ' + groups.reduce((s, g) => s + g.targets.length, 0) + ' 个目标，分布在 ' + groups.length + ' 个账号；默认 ROI<' + cfg.defaults.hourly.roiFloor + ' 预算' + cfg.defaults.hourly.budget + ' 节点 ' + cfg.defaults.hourly.nodes.join(',') + ' 分')
}
