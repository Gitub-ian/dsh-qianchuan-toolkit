/**
 * 多账号：切账号 + 点导航切产品线（全域投放-推直播间 / 乘方-推直播）。
 *
 * 踩过的坑：千川是 SPA，用 URL 改路由基本无效——?aavid= 只会换账号，
 * 页面/产品线仍然停在原来那个（URL 都不变）。所以：
 *   切账号 = navigate ?aavid=<目标> 后比对页头 ID；
 *   切产品线 = JS 点顶部导航「全域投放」/「乘方」，再点「推直播间」tab。
 */
import { expr } from './expr-util.mjs'
import { sleep, connect, listPages, createTab } from './cdp-lib.mjs'
import { ensureLoaded, pollUntil, dismissOverlays } from './page-lib.mjs'

export const detailUrl = (aavid, adId) => 'https://qianchuan.jinritemai.com/uni-prom/detail?aavid=' + aavid + '&adId=' + adId
export const listUrl = (acct) => acct.entry === 'square'
  ? 'https://qianchuan.jinritemai.com/overall-prom?aavid=' + acct.aavid + '&campaignType=1'
  : 'https://qianchuan.jinritemai.com/uni-prom?aavid=' + acct.aavid

export async function readAccount(page) {
  try { return JSON.parse(await page.eval(expr('account-info.js'))) } catch (e) { return { id: null, label: '', bodyIds: [] } }
}

export const rowsReady = async (page, layout) => {
  const o = JSON.parse(await page.eval(expr('row-state.js')))
  if (!o.hasAwemeCol || !o.rows.length || !o.iconsReady) return null
  if (layout && o.layout !== layout) return null
  return o
}

async function switchAccount(page, aavid, say) {
  const cur = await readAccount(page)
  if (cur.id === aavid) return { ok: true, ms: 0, from: cur.id }
  const t0 = Date.now()
  await page.send('Page.navigate', { url: 'https://qianchuan.jinritemai.com/uni-prom?aavid=' + aavid }).catch(() => {})
  let r = await pollUntil(async () => { const a = await readAccount(page); return a.id === aavid ? a : null }, 12000, 300)
  if (!r.ok) {
    say('账号未切换成功，强制重载一次')
    await page.eval('location.replace(' + JSON.stringify('https://qianchuan.jinritemai.com/uni-prom?aavid=' + aavid) + '); "ok"').catch(() => {})
    r = await pollUntil(async () => { const a = await readAccount(page); return a.id === aavid ? a : null }, 15000, 300)
  }
  return { ok: r.ok, ms: Date.now() - t0, from: cur.id }
}

async function openEntry(page, acct, say) {
  const t0 = Date.now()
  const wantLayout = acct.entry === 'square' ? 'square' : 'uni-prom'
  const navText = acct.entry === 'square' ? '乘方' : '全域投放'
  for (let attempt = 1; attempt <= 2; attempt++) {
    const before = await rowsReady(page, wantLayout).catch(() => null)
    if (before) return { ok: true, ms: Date.now() - t0, view: before, attempt }
    await dismissOverlays(page, say)
    const nav = await page.eval(expr('nav-click.js', { '{{TEXT}}': navText })).catch(() => 'err')
    say('点导航「' + navText + '」→ ' + nav)
    await sleep(1800)
    if (acct.entry !== 'square') {
      const tab = await page.eval(expr('tab.js')).catch(() => 'err')
      if (tab === 'clicked') await sleep(1500)
    }
    const load = await ensureLoaded(page, { ready: async () => rowsReady(page, wantLayout), timeoutMs: 12000, retries: 0, say })
    if (load.ok) return { ok: true, ms: Date.now() - t0, view: load.value, attempt }
  }
  return { ok: false, ms: Date.now() - t0 }
}

/**
 * 每个账号一个独立标签页：能复用就复用（URL 里带该账号 aavid 且停在列表页），
 * 没有再新建一个。这样多账号并行巡航不需要来回切换账号。
 */
export async function ensureTabFor(acct, say = () => {}) {
  const t0 = Date.now()
  const pages = await listPages()
  const hit = pages.find((p) => p.type === 'page'
    && (p.url || '').includes('aavid=' + acct.aavid)
    && /(uni-prom|overall-prom)/.test(p.url || '')
    && !/\/detail/.test(p.url || ''))
  let page
  if (hit) {
    page = await connect('jinritemai', { id: hit.id })
    say('复用标签页 ' + acct.key + '：' + (hit.title || hit.url || '').slice(0, 40))
  } else {
    const id = await createTab(listUrl(acct))
    let found = null
    for (let i = 0; i < 40 && !found; i++) {
      await sleep(150)
      const now = await listPages()
      found = now.find((p) => p.id === id || ((p.type === 'page') && (p.url || '').includes('aavid=' + acct.aavid)))
    }
    if (!found) throw new Error('新建标签页失败（' + acct.key + '）')
    page = await connect('jinritemai', { id: found.id })
    say('新建标签页 ' + acct.key + '：' + (found.url || '').slice(0, 60))
  }
  page.tabId = hit ? hit.id : page.tabId
  say('标签页就绪 ' + Math.round(Date.now() - t0) + 'ms')
  return page
}

/** 确保当前会话在指定账号 + 指定产品线列表页 */
export async function ensureAccount(page, acct, say = () => {}) {
  const t0 = Date.now()
  const sw = await switchAccount(page, acct.aavid, say)
  if (!sw.ok) return { ok: false, ms: Date.now() - t0, err: 'switch-failed', account: await readAccount(page) }
  const entry = await openEntry(page, acct, say)
  const account = await readAccount(page)
  return {
    ok: entry.ok && account.id === acct.aavid,
    ms: Date.now() - t0,
    account,
    view: entry.view,
    switched: sw.ms > 0,
    entryMs: entry.ms,
    err: entry.ok ? (account.id === acct.aavid ? undefined : 'account-mismatch') : 'entry-not-ready',
  }
}
