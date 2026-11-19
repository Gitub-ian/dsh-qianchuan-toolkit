// selftest.mjs —— 纯函数断言，不连浏览器。改 rule 相关代码后先跑它：node selftest.mjs
import { resolveRule, judgeHourly, deliveringAccount, entryLabel, entryFull, groupByAccount, nextNodeTime, accountOf } from './store.mjs'

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : (fail++, console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want)))
}

/* ---------- 1. resolveRule：三层覆盖 defaults -> account -> target ---------- */
const CFG = {
  version: 1,
  defaults: { hourly: { nodes: [15, 30, 45, 55], roiFloor: 2.4, minCost: 1, budget: 200, controlHours: 0.5, extraRoundAfterEndMinutes: 1 } },
  accounts: [
    { key: 'A', aavid: '1860000000000001', entry: 'uniprom' },
    { key: 'B', aavid: '1860000000000002', entry: 'square', rules: { hourly: { roiFloor: 3, nodes: [10, 40] } } },
  ],
  targets: [
    { id: 'A/abc123', account: 'A', awemeName: '某个抖音号', awemeUniqueId: 'abc123', ads: ['1860000000000003'], enabled: true },
    { id: 'B/def456', account: 'B', awemeName: '另一个抖音号', awemeUniqueId: 'def456', enabled: true },
    { id: 'B/def456#x', account: 'B', awemeName: '另一个抖音号', awemeUniqueId: 'def456', enabled: true, rules: { hourly: { budget: 500, nodes: [20, 50, 5] } } },
  ],
}
const rA = resolveRule(CFG, CFG.targets[0])
eq('resolveRule 默认层', [rA.nodes, rA.roiFloor, rA.budget, rA.controlHours], [[15, 30, 45, 55], 2.4, 200, 0.5])
const rB = resolveRule(CFG, { account: 'B' })
eq('resolveRule 账号层覆盖', [rB.nodes, rB.roiFloor, rB.budget], [[10, 40], 3, 200])
const rT = resolveRule(CFG, CFG.targets[2])
eq('resolveRule 目标层 + 节点排序', [rT.nodes, rT.roiFloor, rT.budget], [[5, 20, 50], 3, 500])
eq('resolveRule 非法节点被过滤', resolveRule(CFG, { account: 'A', rules: { hourly: { nodes: [0, 60, 15, '30'] } } }).nodes, [15, 30])

/* ---------- 2. judgeHourly：自然小时判定 ---------- */
const R = { roiFloor: 2.4, minCost: 1, budget: 200, controlHours: 0.5 }
const H = (rows) => ({ hour: '2026-11-19 09:00', rows })
eq('没花钱 -> no-spend', judgeHourly({}, H([{ cost: 0, gmv: 0, orders: 0 }]), R).reason, 'no-spend')
eq('没数据行 -> no-data', judgeHourly({}, H([]), R).reason, 'no-data')
eq('ROI 1.08 < 2.4 -> 控 200', judgeHourly({}, H([{ cost: 129.46, gmv: 109, orders: 1 }]), R),
  { cost: 129.46, gmv: 109, orders: 1, roi: 0.84, action: 'control', budget: 200, hours: 0.5 })
eq('ROI 恰好 2.4 -> 不控', judgeHourly({}, H([{ cost: 100, gmv: 240, orders: 1 }]), R).action, 'skip')
eq('ROI 3.40 -> 不控', judgeHourly({}, H([{ cost: 169.34, gmv: 575.76, orders: 3 }]), R).reason, 'roi-ok')
eq('消耗低于 minCost -> 不控', judgeHourly({}, H([{ cost: 0.5, gmv: 0, orders: 0 }]), { ...R, minCost: 1 }).reason, 'below-min-cost')
eq('多计划汇总成抖音号', judgeHourly({}, H([{ cost: 100, gmv: 100, orders: 1 }, { cost: 100, gmv: 300, orders: 2 }]), R),
  { cost: 200, gmv: 400, orders: 3, roi: 2, action: 'control', budget: 200, hours: 0.5 })
eq('预算跟随目标覆盖值', judgeHourly({}, H([{ cost: 50, gmv: 10, orders: 1 }]), { ...R, budget: 300 }).budget, 300)

/* ---------- 3. deliveringAccount / standby：同名抖音号谁在投 ---------- */
eq('主力无备用 -> null', deliveringAccount(CFG, CFG.targets[0]), null)
const SB = {
  version: 1,
  defaults: CFG.defaults,
  accounts: CFG.accounts,
  targets: [
    { id: 'A/abc123', account: 'A', awemeName: '同一个抖音号', awemeUniqueId: 'abc123', delivery: 'standby', enabled: true },
    { id: 'B/abc123', account: 'B', awemeName: '同一个抖音号', awemeUniqueId: 'abc123', enabled: true },
  ],
}
const d = deliveringAccount(SB, SB.targets[0])
eq('备用账号找到主力', [d.key, d.entry], ['B', 'square'])
eq('主力自己不算替身', deliveringAccount(SB, SB.targets[1]), null)
const off = { ...SB, targets: [SB.targets[0], { ...SB.targets[1], enabled: false }] }
eq('主力停用后不再作替身', deliveringAccount(off, off.targets[0]), null)

/* ---------- 4. entryLabel：全域 / 乘方 ---------- */
eq('entryLabel square', entryLabel('square'), '乘方')
eq('entryLabel uniprom', entryLabel('uniprom'), '全域')
eq('entryLabel 缺省', entryLabel(undefined), '全域')
eq('entryFull square', entryFull('square'), '乘方-推直播')
eq('entryFull uniprom', entryFull('uniprom'), '全域投放-推直播间')

/* ---------- 5. groupByAccount：停用目标不进轮次 ---------- */
const g = groupByAccount({ ...CFG, targets: [...CFG.targets.map((t) => ({ ...t })), { id: 'A/off', account: 'A', awemeUniqueId: 'off', enabled: false }] })
eq('按账号分组', g.map((x) => [x.account.key, x.targets.length]), [['A', 1], ['B', 2]])
eq('accountOf 未知名 -> undefined', accountOf(CFG, 'Z'), undefined)

/* ---------- 6. nextNodeTime：下一个判定节点 ---------- */
const N = [15, 30, 45, 55]
eq('12:00:00 -> 12:15', nextNodeTime(N, new Date('2026-11-19T12:00:00+08:00')).toTimeString().slice(0, 8), '12:15:00')
eq('12:15:00 整点不重复 -> 12:30', nextNodeTime(N, new Date('2026-11-19T12:15:00+08:00')).toTimeString().slice(0, 8), '12:30:00')
eq('12:14:30 -> 12:15', nextNodeTime(N, new Date('2026-11-19T12:14:30+08:00')).toTimeString().slice(0, 8), '12:15:00')
eq('12:56:10 -> 13:15', nextNodeTime(N, new Date('2026-11-19T12:56:10+08:00')).toTimeString().slice(0, 8), '13:15:00')

console.log('\nselftest: ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)
