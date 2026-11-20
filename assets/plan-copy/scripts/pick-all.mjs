// pick-all.mjs —— 「添加视频」弹窗里把每个抖音号的主页视频全勾上，一次跑完直接点确定（不二次补选）
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// 用法: node scripts/pick-all.mjs "抖音号名1,抖音号名2,...,抖音号名N"
//   （单号也要带尾逗号："号名,"；不传参时从 out/*.json 读名单）
// 前提: 已进入某计划的 素材 tab，素材类型=视频，且「添加视频」弹窗已打开
// 改自技能资产 dsh-qianchuan-toolkit/assets/plan-copy/scripts/pick-all.mjs（用户 2026-11-20 要求的一次跑完规则）
// 逻辑:
//   1) 切号 JS click（横向列表坐标点不动，只能 JS click）
//   2) 切号后轮询等卡片渲染（最多 8s），不要固定 sleep 后立刻取
//   3) 每张卡片 CDP 真实点击；点完读「已选择 N/200」，没涨就补点一次（漏勾/点空）
//   4) 某号 0 卡片 → 取消勾选「过滤不良素材」刷新 → 仍为 0 判定该号确实无视频，继续下一个号
//   5) 全部号点完，一次性点「确定」提交；不再二次进弹窗、不再翻抽屉核对
import fs from 'node:fs'

const PORT = 9222, BASE = 'http://127.0.0.1:' + PORT
const OUT_DIR = process.env.QC_OUT || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.qianchuan-cruise', 'out')
const CARD = '.main-vmok-plugin-create-material-list-card-item'
const NAV = '.main-vmok-plugin-tabs__nav-list'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function namesFor(adId) {
  if (adId) { const f = path.join(OUT_DIR, adId + '.json'); if (fs.existsSync(f)) { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return d.douyinNames || [] } }
  if (!fs.existsSync(OUT_DIR)) return []
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(OUT_DIR, f))
  if (!files.length) return []
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return JSON.parse(fs.readFileSync(files[0], 'utf8')).douyinNames || []
}

async function j(p) { const r = await fetch(BASE + p); if (!r.ok) throw new Error('http ' + r.status); return r.json() }
async function connect(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')) })
  const c = { ws, seq: 0, p: new Map() }
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data) } catch { return } if (m.id && c.p.has(m.id)) { const q = c.p.get(m.id); c.p.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result) } }
  return c
}
function send(c, method, params = {}) { const id = ++c.seq; return new Promise((res, rej) => { c.p.set(id, { res, rej }); c.ws.send(JSON.stringify({ id, method, params })) }) }
async function ev(c, expr) { const r = await send(c, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result?.value }
async function click(c, x, y) {
  await send(c, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send(c, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send(c, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const getSel = `(()=>{const t=document.body.innerText.replace(/[ \\t]+/g,' ');const m=t.match(/已选择\\s*(\\d+)\\/200/);return m?Number(m[1]):-1})()`
const clickTab = (name) => `(()=>{const ls=[...document.querySelectorAll('${NAV}')];for(const list of ls){const t=[...list.children].find(c=>c.innerText&&c.innerText.replace(/\\s+/g,' ').trim().includes(${JSON.stringify(name)}));if(t){t.click();return 'OK'}}return 'NOTAB'})()`
const listCards = `(()=>[...document.querySelectorAll('${CARD}')].map(c=>{const w=c.querySelector('[itemid]')||c;return w.getAttribute('itemid')}).filter(Boolean))()`
const cardPos = (id) => `(()=>{const c=[...document.querySelectorAll('${CARD}')].find(x=>{const w=x.querySelector('[itemid]')||x;return w.getAttribute('itemid')===${JSON.stringify(id)}});if(!c)return null;c.scrollIntoView({block:'center',inline:'nearest'});const r=c.getBoundingClientRect();if(r.width<10)return null;return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`
const filterFind = `(()=>{const ins=[...document.querySelectorAll('input[type=checkbox]')];for(const i of ins){const lab=((i.closest('label')||i.parentElement||{}).innerText||'');if(lab.includes('过滤不良素材'))return i}return null})()`
const filterToggle = `(()=>{const i=${filterFind};if(!i)return 'NOBOX';i.click();return 'OK'})()`

async function pollCards(c, maxMs) {
  const t0 = Date.now(); let ids = []
  while (Date.now() - t0 < maxMs) {
    ids = await ev(c, listCards)
    if (ids.length) return ids
    await sleep(400)
  }
  return ids
}

async function selectCards(c, ids) {
  let clicked = 0, retried = 0
  for (const id of ids) {
    const p = await ev(c, cardPos(id))
    if (!p) continue
    await sleep(120)
    const before = await ev(c, getSel)
    await click(c, p.x, p.y)
    await sleep(260)
    let after = await ev(c, getSel)
    if (after === before) {
      const p2 = await ev(c, cardPos(id))
      if (p2) { await sleep(120); await click(c, p2.x, p2.y); await sleep(320); retried++ }
    }
    clicked++
  }
  return { clicked, retried }
}


// 供 copy.mjs 复用：在已打开的「添加视频」弹窗里按名单逐个抖音号全选，返回结构化日志
export async function pickAllOnTarget(target, names) {
  const c = await connect(target)
  const modalOpen = await ev(c, `(()=>/已选择\\s*\\d+\\/200/.test(document.body.innerText))()`)
  if (!modalOpen) return { error: '「添加视频」弹窗没开，先点「添加视频」' }
  
  const log = []
  for (const name of names) {
    const r = await ev(c, clickTab(name))
    if (r !== 'OK') { log.push({ name, err: r }); continue }
    let ids = await pollCards(c, 8000)
    let refreshed = false
    if (!ids.length) {
      const t = await ev(c, filterToggle)
      if (t === 'OK') { refreshed = true; await sleep(1200); ids = await pollCards(c, 12000) }
    }
    const before = await ev(c, getSel)
    let sel = { clicked: 0, retried: 0 }
    if (ids.length) sel = await selectCards(c, ids)
    const after = await ev(c, getSel)
    if (refreshed) { await ev(c, filterToggle); await sleep(600) }
    log.push({ name, cards: ids.length, before, after, delta: after - before, retried: sel.retried, note: ids.length ? undefined : '该号主页无可投视频（取消过滤后仍为空）' })
  }
  const okb = await ev(c, `(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='确定'&&b.getBoundingClientRect().width>0);if(!bs.length)return 'NOOK';const r=bs[bs.length-1].getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]})()`)
  let submitted = false
  if (Array.isArray(okb)) { await click(c, okb[0], okb[1]); await sleep(5000); submitted = true }
  const total = await ev(c, `(()=>{const m=document.body.innerText.match(/共\\d+个视频/);return m?m[0]:null})()`)
  return { ok: true, submitted, totalVideos: total, log }
}

async function main() {
  const arg = process.argv[2]
  const names = arg ? arg.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean) : namesFor(null)
  if (!names.length) { console.log(JSON.stringify({ error: '没有抖音号名单：把名字用逗号串起来传进来' })); process.exit(1) }
  const pages = (await j('/json/list')).filter((t) => t.type === 'page')
  const target = pages.find((p) => p.url.includes('qianchuan')) || pages[0]
  const res = await pickAllOnTarget(target, names)
  if (res.error) { console.log(JSON.stringify(res)); process.exit(1) }
  console.log(JSON.stringify(res, null, 1))
  process.exit(0)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
