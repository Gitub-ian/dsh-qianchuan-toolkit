/**
 * 进程内 CDP 客户端：巡航/控量脚本直接 import 本文件，不再 spawn 子进程
 * （沙箱里 Node 再 spawn Node 会 EPERM，所以必须走这条路）。
 *
 * v9 加固：
 *   - 自动接管原生弹窗（alert/confirm/beforeunload）——它们会卡住渲染线程，导致 eval 永不返回
 *   - 所有 CDP 调用带超时（默认 20s），eval 默认 15s，绝不无限等待
 *   - 暴露 page.dialogs，便于排查「页面为什么卡住」
 */
import fs from 'node:fs'
import path from 'node:path'

// 调试端口：默认 9222（巡航用的浏览器实例）。plan-copy 技能用 9223 独立实例，
// 由各 plan-copy 脚本在 import 之后设置 QC_CDP_PORT=9223 —— 所以必须惰性读取，
// 不能在模块加载时求值（那时 env 还没被设置）。
export function cdpPort() { return Number(process.env.QC_CDP_PORT || process.env.CDP_PORT || 9222) }
const base = () => 'http://127.0.0.1:' + cdpPort()
const SEND_TIMEOUT = Number(process.env.CDP_SEND_TIMEOUT_MS || 20000)
const EVAL_TIMEOUT = Number(process.env.CDP_EVAL_TIMEOUT_MS || 15000)

export class CdpError extends Error {}

async function getJson(p) {
  const r = await fetch(base() + p)
  if (!r.ok) throw new CdpError('http ' + r.status + ' ' + p)
  return r.json()
}

export async function listPages() {
  try {
    return await getJson('/json/list')
  } catch (err) {
    const p = cdpPort()
    const hint = p === 9223
      ? 'assets/plan-copy/scripts/start-qc-copy.cmd（复制专用实例，首次要登录一次千川）'
      : (p === 9222 ? 'assets/plan-copy/scripts/start-qc.cmd（巡航实例）' : '用同样的浏览器参数启动调试端口 ' + p)
    throw new CdpError('连不上调试端口 ' + p + '（' + ((err && err.message) || err) + '）—— 请先手动启动浏览器：双击 ' + hint)
  }
}

/** 浏览器级 CDP（用于新建标签页）：/json/version 的 webSocketDebuggerUrl */
async function browserWs() {
  const v = await getJson('/json/version')
  return v.webSocketDebuggerUrl
}

/** 浏览器级调用（Target.createTarget 等） */
export async function browserSend(method, params = {}, timeoutMs = 15000) {
  const wsUrl = await browserWs()
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new CdpError('浏览器 WS 连接超时')), 8000)
    ws.onopen = () => { clearTimeout(timer); res() }
    ws.onerror = () => { clearTimeout(timer); rej(new CdpError('浏览器 WS 连接失败')) }
  })
  try {
    return await new Promise((res, rej) => {
      const id = 1
      const timer = setTimeout(() => rej(new CdpError('浏览器 CDP 超时：' + method)), timeoutMs)
      ws.onmessage = (ev) => {
        let m
        try { m = JSON.parse(ev.data) } catch { return }
        if (m.id !== id) return
        clearTimeout(timer)
        if (m.error) rej(new CdpError(JSON.stringify(m.error))); else res(m.result)
      }
      ws.send(JSON.stringify({ id, method, params }))
    })
  } finally { try { ws.close() } catch {} }
}

/** 新建一个标签页，返回 targetId（不抢焦点：background=true） */
export async function createTab(url, { background = true } = {}) {
  const r = await browserSend('Target.createTarget', { url, background })
  return r.targetId
}

/** 关掉指定标签页 */
export async function closeTab(targetId) {
  try { return await browserSend('Target.closeTarget', { targetId }) } catch (e) { return null }
}

/** 连上匹配 match 的标签页（默认千川页面）；给 id 则精确连某个标签页 */
export async function connect(match = 'jinritemai', { autoDialog = true, id = null } = {}) {
  const pages = await listPages()
  const page = id
    ? pages.find((p) => p.type === 'page' && p.id === id)
    : pages.find((p) => p.type === 'page' && ((p.url || '').includes(match) || (p.title || '').includes(match)))
  if (!page) {
    throw new CdpError('没找到标题/URL 含「' + match + '」的标签页。当前标签页：' + pages.filter((p) => p.type === 'page').map((p) => (p.title || p.url).slice(0, 40)).join(' / '))
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new CdpError('WebSocket 连接超时（' + (page.url || '').slice(0, 60) + '）')), 10000)
    ws.onopen = () => { clearTimeout(timer); res() }
    ws.onerror = () => { clearTimeout(timer); rej(new CdpError('WebSocket 连接失败（' + (page.url || '').slice(0, 60) + '）')) }
  })

  const pending = new Map()
  const dialogs = []
  let seq = 0
  let alive = true

  ws.onmessage = (ev) => {
    let m
    try { m = JSON.parse(ev.data) } catch { return }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      clearTimeout(p.timer)
      if (m.error) p.rej(new CdpError(JSON.stringify(m.error)))
      else p.res(m.result)
      return
    }
    if (m.method === 'Page.javascriptDialogOpening') {
      const info = m.params || {}
      dialogs.push({ type: info.type, message: (info.message || '').slice(0, 120), at: Date.now() })
      if (dialogs.length > 20) dialogs.shift()
      if (autoDialog) {
        const accept = info.type === 'beforeunload'
        rawSend('Page.handleJavaScriptDialog', { accept }).catch(() => {})
      }
    }
  }
  ws.onclose = () => {
    alive = false
    for (const p of pending.values()) { clearTimeout(p.timer); p.rej(new CdpError('ws closed')) }
    pending.clear()
  }

  const rawSend = (method, params = {}, timeoutMs = SEND_TIMEOUT) => new Promise((res, rej) => {
    if (!alive) return rej(new CdpError('ws closed'))
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); rej(new CdpError('cdp 超时 ' + Math.round(timeoutMs / 1000) + 's：' + method)) }, timeoutMs)
    pending.set(id, { res, rej, timer })
    try { ws.send(JSON.stringify({ id, method, params })) } catch (e) { clearTimeout(timer); pending.delete(id); rej(new CdpError('ws send 失败: ' + e.message)) }
  })

  await rawSend('Page.enable', {}).catch(() => {})

  return {
    url: page.url,        // 连接时的快照，导航后不会更新 —— 判断「现在在哪一页」必须用 href()
    title: page.title,
    id: page.id,
    dialogs,
    send: rawSend,
    async href(fallback) {
      // 实时 URL。page.url 是连接时快照，导航后仍是旧值（2026-11-20 16:15 误判「刷新后没找到该行」的根因）
      try { const v = await this.eval('location.href', 8000); return v ? String(v) : (fallback || this.url) } catch (e) { return fallback || this.url }
    },
    async eval(expr, timeoutMs = EVAL_TIMEOUT) {
      const r = await rawSend('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }, timeoutMs)
      if (r.exceptionDetails) throw new CdpError('eval 异常: ' + r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '') + ' ||EXPR|| ' + String(expr).slice(0, 240))
      return r.result ? r.result.value : undefined
    },
    async evalJson(expr, timeoutMs = EVAL_TIMEOUT) {
      const v = await this.eval(expr, timeoutMs)
      return typeof v === 'string' ? JSON.parse(v) : v
    },
    async shot(file) {
      const r = await rawSend('Page.captureScreenshot', { format: 'png' }, 30000)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
      return file
    },
    async clickAt(x, y) {
      for (const e of [
        { type: 'mouseMoved', x, y },
        { type: 'mousePressed', x, y, button: 'left', clickCount: 1 },
        { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 },
      ]) await rawSend('Input.dispatchMouseEvent', e)
      return [Math.round(x), Math.round(y)]
    },
    async ping() { // 渲染线程是否还能跑 JS
      const t0 = Date.now()
      try { const v = await this.eval('1+1', 5000); return { ok: v === 2, ms: Date.now() - t0 } }
      catch (e) { return { ok: false, ms: Date.now() - t0, err: e.message } }
    },
    close() { try { ws.close() } catch {} },
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
