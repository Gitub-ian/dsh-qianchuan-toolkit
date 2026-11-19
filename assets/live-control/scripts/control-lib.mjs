/**
 * 一键控量（全域投放 · 推直播间）执行层，供 control.mjs 与 hourly.mjs 复用。
 * 只依赖调用方传入的 page（cdp-lib 连接），不自己连/断，方便串在一轮巡航里。
 *
 * 返回 { code, ok, stage, nick, fill, submittedAt, dialogGone, toast, shot }
 *   code 0 成功 / 2 定位失败 / 3 页面结构不符 / 4 状态不允许
 */
import fs from 'node:fs'
import path from 'node:path'
import { sleep } from './cdp-lib.mjs'
import { expr } from './expr-util.mjs'
import { ensureLoaded, dismissOverlays } from './page-lib.mjs'

/** 从页面 URL 里取当前账号 ID（不内置任何真实账户）。 */
export function aavidFromUrl(u) {
  try { return new URL(u).searchParams.get('aavid') || '' } catch (e) { return '' }
}
export const LIST_URL = (aavid) => 'https://qianchuan.jinritemai.com/uni-prom' + (aavid ? '?aavid=' + aavid : '')

const shot = async (page, dir, name) => {
  try { fs.mkdirSync(dir, { recursive: true }); return await page.shot(path.join(dir, name)) } catch (e) { return null }
}

export async function runControl(page, o = {}) {
  const aweme = o.aweme
  const budget = Number(o.budget)
  const hours = 0.5 // 平台口径固定 0.5 小时，不开放配置
  const shots = o.shots || 'qc-live'
  const dryRun = !!o.dryRun
  const aavid = o.aavid || aavidFromUrl(page.url)
  const LURL = o.listUrl || LIST_URL(aavid)
  const say = o.say || (() => {})
  const res = { ok: false, code: 2, stage: 'start', aweme, budget, hours }
  if (!aweme) return { ...res, stage: 'args', err: 'missing aweme' }
  if (!(budget > 0)) return { ...res, stage: 'args', err: 'budget must be > 0' }

  await page.eval(expr('close-dialog.js')).catch(() => {})
  const d0 = await dismissOverlays(page, say)
  if (d0.closed.length) say('关闭无关弹窗: ' + d0.closed.join(' | ').slice(0, 60))
  res.stage = 'navigate'
  const load = await ensureLoaded(page, {
    url: LURL,
    ready: async () => { const o = JSON.parse(await page.eval(expr('row-state.js'))); return o.hasAwemeCol && o.rows.length > 0 && o.iconsReady ? o : null },
    timeoutMs: 12000, retries: 1, say,
  })
  if (!load.ok) { await shot(page, shots, 'control-nolist.png'); return { ...res, code: 2, stage: 'navigate', err: 'list not loaded', attempts: load.attempts } }
  res.stage = 'tab'
  const tab = await page.eval(expr('tab.js'))
  if (tab === 'none') return { ...res, code: 3, stage: 'tab', err: 'no 推直播间 tab' }
  if (tab === 'clicked') await sleep(2000)

  res.stage = 'pick'
  let pick = JSON.parse(await page.eval(expr('pick.js', { '{{AWEME}}': aweme })))
  if (!pick.ok) {
    // 行没匹配上：可能是弹窗/懒加载残留，刷新一次再试（只重试一次）
    say('未命中行，刷新重试一次')
    await page.send('Page.reload', { ignoreCache: true }).catch(() => {})
    await sleep(800)
    await dismissOverlays(page, say)
    const again = await ensureLoaded(page, {
      ready: async () => { const o = JSON.parse(await page.eval(expr('row-state.js'))); return o.hasAwemeCol && o.rows.length > 0 && o.iconsReady ? o : null },
      timeoutMs: 12000, retries: 0, say,
    })
    if (again.ok) pick = JSON.parse(await page.eval(expr('pick.js', { '{{AWEME}}': aweme })))
  }
  if (!pick.ok) return { ...res, code: 2, stage: 'pick', err: JSON.stringify(pick) }
  res.nick = pick.nick
  say('命中行 ' + pick.nick + ' | 状态 ' + pick.status)
  if (!pick.live) return { ...res, code: 4, stage: 'pick', err: 'row not 投放中' }
  // 只要有控量在跑，平台就不允许再建新的 → 直接拒，不看有没有 + 号
  if (pick.hasPause) return { ...res, code: 4, stage: 'pick', err: 'control already running' }
  if (!pick.hasPlus) return { ...res, code: 3, stage: 'pick', err: 'no plus icon' }
  if (pick.plusDisabled) return { ...res, code: 4, stage: 'pick', err: 'plus icon disabled' }

  res.stage = 'open'
  const isOpen = async () => String(await page.eval(expr('dialog-open.js'))) === 'true'
  const openRet = await page.eval(expr('open-plus.js', { '{{AWEME}}': aweme }))
  say('点 + : ' + openRet)
  if (openRet === 'PLUS_DISABLED') return { ...res, code: 4, stage: 'open', err: 'plus icon disabled (control running?)' }
  await sleep(1200)
  let opened = await isOpen()
  if (!opened) {
    const rect = JSON.parse((await page.eval(expr('plus-rect.js', { '{{AWEME}}': aweme }))) || 'null')
    if (rect && rect.w > 0) {
      await page.clickAt(rect.x, rect.y)
      await sleep(1500)
      opened = await isOpen()
    }
  }
  if (!opened) {
    // 可能开成了「调控工具」弹窗但默认选了别的工具卡片（一键调速被禁用时会发生），先关掉再报错，别留遮罩
    await page.eval(expr('cancel-modal.js')).catch(() => {})
    await shot(page, shots, 'control-nodlg.png')
    return { ...res, code: 3, stage: 'open', err: 'dialog not open (wrong tool card?)' }
  }
  say('弹窗已打开')

  res.stage = 'fill'
  const fill = JSON.parse(await page.eval(expr('fill.js', { '{{BUDGET}}': budget, '{{HOURS}}': hours })))
  if (!fill.okMode) { await shot(page, shots, 'control-fail.png'); return { ...res, code: 3, stage: 'fill', err: JSON.stringify(fill) } }
  res.fill = fill
  say('调控方式=一键控量 | 预算 ' + fill.budget + ' 元 | 时长 ' + fill.hours + ' 小时')
  await shot(page, shots, dryRun ? 'control-dryrun.png' : 'control-filled.png')
  if (dryRun) return { ...res, code: 0, ok: true, stage: 'dryrun' }

  res.stage = 'submit'
  const sr = JSON.parse((await page.eval(expr('submit-rect.js'))) || 'null')
  if (!sr) return { ...res, code: 3, stage: 'submit', err: 'no submit button' }
  await page.clickAt(sr.x, sr.y)
  res.submittedAt = new Date().toISOString()
  res.clickedAt = sr
  await sleep(3000)
  const r = JSON.parse(await page.eval(expr('result.js')))
  res.toast = r.toast
  res.dialogGone = !!r.dialogGone
  const good = res.dialogGone || (r.toast || []).some((t) => /成功|已提交|设置/.test(t))
  await shot(page, shots, 'control-done.png')
  return { ...res, code: good ? 0 : 1, ok: good, stage: good ? 'done' : 'unknown' }
}