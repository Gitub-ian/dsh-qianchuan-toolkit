/**
 * 页面加载/弹窗的通用保障：等就绪 → 关无关弹窗 → 没出来就强制刷新重试一次。
 * 只依赖调用方传入的 page，不自己连接。
 */
import { sleep } from './cdp-lib.mjs'
import { expr } from './expr-util.mjs'

export async function pollUntil(fn, timeoutMs = 8000, stepMs = 150) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < timeoutMs) {
    try { last = await fn() } catch (e) { last = null }
    if (last) return { ok: true, value: last, ms: Date.now() - t0 }
    await sleep(stepMs)
  }
  return { ok: false, value: last, ms: Date.now() - t0 }
}

export async function pageState(page) {
  try { return JSON.parse(await page.eval(expr('page-state.js'))) } catch (e) { return { readyState: 'unknown', overlays: [], spins: 0, mask: 0 } }
}

/** 关掉与控量无关的弹窗；关不掉就按一次 Esc。返回 {closed, remaining, ms} */
export async function dismissOverlays(page, say = () => {}) {
  const t0 = Date.now()
  let out = { closed: [], remaining: [], stillOpen: 0 }
  try { out = JSON.parse(await page.eval(expr('dismiss-overlays.js'))) } catch (e) {}
  if (out.stillOpen) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' }).catch(() => {})
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' }).catch(() => {})
    await sleep(400)
    try { out = JSON.parse(await page.eval(expr('dismiss-overlays.js'))) } catch (e) {}
  }
  if (out.closed && out.closed.length) say('已关弹窗：' + out.closed.join(' | ').slice(0, 80))
  return { ...out, ms: Date.now() - t0 }
}

/**
 * 保证页面可用：必要时空转导航 → 轮询就绪条件 → 不满足则强制刷新重试（默认 1 次）。
 * @param {object} o {url, ready: async()=>any, timeoutMs, retries, say}
 */
export async function ensureLoaded(page, o = {}) {
  const url = o.url
  const ready = o.ready || (async () => true)
  const timeoutMs = o.timeoutMs ?? 9000
  const retries = o.retries ?? 1
  const say = o.say || (() => {})
  const t0 = Date.now()
  const attempts = []
  // 注意不能用 includes(path)：/uni-prom/detail 也包含 /uni-prom，会误判成已在列表页
  if (url && !page.url.startsWith(url)) {
    await page.send('Page.navigate', { url })
  }
  for (let i = 0; i <= retries; i++) {
    await dismissOverlays(page, say)
    const r = await pollUntil(ready, timeoutMs)
    const st = await pageState(page)
    attempts.push({ try: i + 1, ok: r.ok, ms: r.ms, readyState: st.readyState, overlays: st.overlays, spins: st.spins })
    if (r.ok) return { ok: true, ms: Date.now() - t0, retried: i > 0, attempts, value: r.value }
    if (i < retries) {
      say('页面未就绪（' + r.ms + 'ms），强制刷新重试一次')
      await page.send('Page.reload', { ignoreCache: true }).catch(() => {})
      await sleep(600)
    }
  }
  return { ok: false, ms: Date.now() - t0, retried: retries > 0, attempts }
}