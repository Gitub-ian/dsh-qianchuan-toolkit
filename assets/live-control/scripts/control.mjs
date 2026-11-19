#!/usr/bin/env node
// 一键控量（全域投放-推直播间）：列表行「一键调速」组的 + → 弹窗选「一键控量」→ 预算/时长 → 提交
// 用法：node control.mjs --aweme "抖音号名称" --budget 200 [--aavid 账户ID] [--dry-run] [--shots 目录]
// 不给 --aavid 时用当前标签页 URL 里的 aavid。
// 时长固定 0.5 小时（平台口径，不接受配置）。退出码：0 成功；2 参数/定位失败；3 页面结构不符；4 状态不允许
import fs from 'node:fs'
import path from 'node:path'
import { connect } from './cdp-lib.mjs'
import { runControl } from './control-lib.mjs'
import { homeDir } from './store.mjs'

const argv = process.argv.slice(2)
const arg = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def }
const flag = (name) => argv.includes('--' + name)

const AWEME = arg('aweme', '')
const BUDGET = Number(arg('budget', '200'))
const DRY = flag('dry-run')
const SHOTS = arg('shots', homeDir())
const A_AVID = arg('aavid', '')

if (!AWEME) { console.error('缺少 --aweme'); process.exit(2) }
if (!(BUDGET > 0)) { console.error('--budget 必须 > 0'); process.exit(2) }

fs.mkdirSync(SHOTS, { recursive: true })
const LOG = path.join(SHOTS, 'actions.jsonl')
const page = await connect('jinritemai')
console.log('页面', page.url.split('?')[0])
const r = await runControl(page, { aweme: AWEME, budget: BUDGET, shots: SHOTS, dryRun: DRY, aavid: A_AVID, say: (m) => console.log(m) })
fs.appendFileSync(LOG, JSON.stringify(Object.assign({ ts: new Date().toISOString(), dryRun: DRY }, r)) + '\n')
if (!r.ok) { console.error('失败', r.code, r.stage, r.err || ''); page.close(); process.exit(r.code || 1) }
console.log(DRY ? 'DRY-RUN 完成（未提交）' : '提交完成 ' + r.submittedAt + ' dialogGone=' + r.dialogGone)
page.close()
process.exit(0)
