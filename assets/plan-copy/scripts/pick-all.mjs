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
//   3) 每张卡片 CDP 真实点击；点完先读「这张卡是否已选中」，只对明确未选中的补点一次——卡片是开关式复选框，二次点已选中的卡等于取消勾选
//      （「已选择 N/200」是全弹窗计数、刷新有延迟，不能当单卡状态用）
//   4) 某号 0 卡片 → 取消勾选「过滤不良素材」刷新 → 仍为 0 判定该号确实无视频，继续下一个号
//   5) 全部号点完，一次性点「确定」提交；不再二次进弹窗、不再翻抽屉核对
import fs from 'node:fs'

// 复制技能固定连 9223 的独立浏览器实例（与 9222 的巡航实例物理隔离，互不抢标签）。
process.env.QC_CDP_PORT = process.env.QC_CDP_PORT || '9223'
const PORT = Number(process.env.QC_CDP_PORT || 9222), BASE = 'http://127.0.0.1:' + PORT
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
// 单张卡片是否已选中：1=已选中 0=明确未选中 -1=判断不出（判断不出时不补点，只记账）
const isSel = (id) => `(()=>{const cands=[...document.querySelectorAll('${CARD}')].filter(x=>(x.querySelector('[itemid]')||x).getAttribute('itemid')===${JSON.stringify(id)});const c=cands.find(x=>{const r=x.getBoundingClientRect();return r.width>=10&&r.height>=10})||cands[0];if(!c)return -1;const SEL=/selected|checked/i,UN=/(un|dis)selected|unchecked|not-selected/i;const cls=(e)=>String(e.className||'');if(SEL.test(cls(c))&&!UN.test(cls(c)))return 1;const cb=c.querySelector('input[type=checkbox],input[type=radio]');if(cb)return cb.checked?1:0;const ac=c.getAttribute('aria-checked');if(ac==='true')return 1;if(ac==='false')return 0;for(const d of c.querySelectorAll('*')){const k=cls(d);if(SEL.test(k)&&!UN.test(k))return 1}return -1})()`
async function waitSel(c, id, maxMs) { const t0 = Date.now(); let st = await ev(c, isSel(id)); while (st !== 1 && Date.now() - t0 < maxMs) { await sleep(120); st = await ev(c, isSel(id)) } return st }
const clickTab = (name) => `(()=>{const ls=[...document.querySelectorAll('${NAV}')];for(const list of ls){const t=[...list.children].find(c=>c.innerText&&c.innerText.replace(/\\s+/g,' ').trim().includes(${JSON.stringify(name)}));if(t){t.click();return 'OK'}}return 'NOTAB'})()`
// 只取真能被点到的卡片：弹窗 DOM 里有隐藏同构副本，坐标取自副本会点击落空或点穿页面
// 返回全部去重卡片 id（网格多行、可横向滚动；滚动与命中判定交给 cardPos）
const listCards = `(()=>{const seen=new Set();const out=[];for(const c of document.querySelectorAll('${CARD}')){const w=c.querySelector('[itemid]')||c;const id=w.getAttribute('itemid');if(!id||seen.has(id))continue;const r=c.getBoundingClientRect();if(r.width<10||r.height<10)continue;seen.add(id);out.push({id,y:Math.round(r.y),x:Math.round(r.x)})}out.sort((a,b)=>a.y-b.y||a.x-b.x);return out.map(o=>o.id)})()`
const chainInfo = (id) => `(()=>{const c=[...document.querySelectorAll('${CARD}')].map(x=>x).filter(x=>(x.querySelector('[itemid]')||x).getAttribute('itemid')===${JSON.stringify(id)})[0];if(!c)return null;const out=[];let a=c;for(let i=0;i<8&&a&&a!==document.body;i++,a=a.parentElement){const s=getComputedStyle(a);const r=a.getBoundingClientRect();out.push({t:a.tagName,c:String(a.className).slice(0,60),ox:s.overflowX,oy:s.overflowY,sl:a.scrollLeft,sw:a.scrollWidth,cw:a.clientWidth,x:Math.round(r.x),w:Math.round(r.width),tr:s.transform.slice(0,30)})}return out})()`
// 面板被渲染到视口右侧外（左边界≥innerWidth）时，强制 fixed 定位到屏幕内，避免点不到卡片
const fixOffscreen = `(()=>{const el=document.querySelector('.main-vmok-plugin-create-material-list');if(!el)return 'nolist';let a=el.offsetParent,tf=null;while(a&&a!==document.documentElement){const s=getComputedStyle(a);if(s.transform&&s.transform!=='none'){tf=a;break}a=a.offsetParent}if(!tf){let p=el.parentElement;while(p&&p!==document.documentElement){const s=getComputedStyle(p);if(s.transform&&s.transform!=='none'){tf=p;break}p=p.parentElement}}if(tf){tf.style.transform='none'}let r=el.getBoundingClientRect();if(!(r.x>=0&&r.x+40<innerWidth)){el.style.position='fixed';el.style.left='320px';el.style.top='60px';el.style.zIndex='99999';el.style.background='#fff';el.style.maxHeight=(innerHeight-90)+'px';el.style.overflow='auto'}const r2=el.getBoundingClientRect();return 'tf='+(tf?String(tf.className).slice(0,42):'none')+' x='+Math.round(r.x)+' -> '+Math.round(r2.x)})()`
const cardPos = (id) => `(()=>{const cands=[...document.querySelectorAll('${CARD}')].filter(x=>(x.querySelector('[itemid]')||x).getAttribute('itemid')===${JSON.stringify(id)});if(!cands.length)return {err:'nocard'};const seen=[];for(const c of cands){const r=c.getBoundingClientRect();if(r.width<10||r.height<10){seen.push(['tiny',Math.round(r.x)]);continue}const cx=Math.round(r.x+r.width/2),cy=Math.round(r.y+r.height/2);if(cx<0||cy<0||cx>innerWidth||cy>innerHeight){seen.push(['off',Math.round(r.x),Math.round(r.y)]);continue}const e=document.elementFromPoint(cx,cy);if(!e||!c.contains(e)){seen.push(['hid',Math.round(r.x),Math.round(r.y)]);continue}return {x:cx,y:cy}}return {err:'noclick',n:cands.length,seen}})()`
const listPos = `(()=>[...document.querySelectorAll('${CARD}')].slice(0,6).map(c=>{const r=c.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]}))()`
const resetScroll = `(()=>{let n=0;for(const el of document.querySelectorAll('*')){const s=getComputedStyle(el);if((s.overflowX==='auto'||s.overflowX==='scroll')&&el.scrollWidth>el.clientWidth+4){if(el.scrollLeft!==0){el.scrollLeft=0;n++}}}return n})()`
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
  // 多轮：不在可视区的卡（弹窗第二屏 / 横向滚动区外）先滚动让它进视野，下一轮再点，直到全部点完 —— 不允许静默 skipped
  let clicked = 0, retried = 0, already = 0
  const unknown = []
  let pending = ids.slice()
  for (let pass = 0; pass < 10 && pending.length; pass++) {
    const next = []
    for (const id of pending) {
      const p = await ev(c, cardPos(id))
      if (!p || p.err || typeof p.x !== 'number') { next.push(id); continue }
      await sleep(120)
      // 已经勾上的卡绝不点：开关式复选框，二次点击=取消勾选
      if ((await ev(c, isSel(id))) === 1) { already++; continue }
      await click(c, p.x, p.y)
      clicked++
      let st = await waitSel(c, id, 1200)
      if (st !== 1) {
        if (st === 0) {
          const p2 = await ev(c, cardPos(id))
          if (p2 && typeof p2.x === 'number' && (await ev(c, isSel(id))) === 0) { await click(c, p2.x, p2.y); retried++; st = await waitSel(c, id, 1200) }
        }
        if (st !== 1) unknown.push(id)
      }
    }
    if (!next.length) { pending = []; break }
    for (let k = 0; k < 2; k++) { await ev(c, scrollStep); await sleep(450) }
    pending = next
  }
  let why = null
  const skipped = pending.length
  if (skipped) { try { why = JSON.stringify(await ev(c, chainInfo(pending[0]))) } catch (e) { why = 'chainInfo-fail' } }
  return { clicked, retried, skipped, already, unknown, why }
}

// 让素材弹窗里的滚动容器往前走一屏（横向那一排卡在第 2 屏，只点视口内的卡必然漏）
const scrollStep = '(()=>{const roots=[...document.querySelectorAll("[class*=create-material]")];const els=new Set();for(const r of roots){let a=r;for(let i=0;i<8&&a;i++,a=a.parentElement)els.add(a)}let n=0;for(const el of els){if(el===document.body||el===document.documentElement)continue;const rc=el.getBoundingClientRect();if(!rc||rc.width<10)continue;const s=getComputedStyle(el);if((s.overflowX==="auto"||s.overflowX==="scroll")&&el.scrollWidth>el.clientWidth+4){el.scrollLeft=Math.min(el.scrollLeft+Math.round(el.clientWidth*0.8),el.scrollWidth-el.clientWidth);n++}if((s.overflowY==="auto"||s.overflowY==="scroll")&&el.scrollHeight>el.clientHeight+4&&el.clientHeight>200){el.scrollTop=Math.min(el.scrollTop+Math.round(el.clientHeight*0.6),el.scrollHeight-el.clientHeight);n++}}return n})()'

// 供 copy.mjs 复用：在已打开的「添加视频」弹窗里按名单逐个抖音号全选，返回结构化日志
export async function pickAllOnTarget(target, names) {
  const c = await connect(target)
  const modalOpen = await ev(c, `(()=>/已选择\\s*\\d+\\/200/.test(document.body.innerText))()`)
  if (!modalOpen) return { error: '「添加视频」弹窗没开，先点「添加视频」' }
  await ev(c, resetScroll)
  
  const log = []
  const fixRes = 'skip'
  for (const name of names) {
    let r = await ev(c, clickTab(name))
    // 切号后 tab 列表偶尔还未渲染完，重试几次再判定失败
    for (let i = 0; i < 4 && r !== 'OK'; i++) { await sleep(900); r = await ev(c, clickTab(name)) }
    if (r !== 'OK') { log.push({ name, err: r }); continue }
    await ev(c, resetScroll)
    let ids = await pollCards(c, 8000)
    if (ids.length) { await sleep(1500); ids = await ev(c, listCards) }
    let refreshed = false
    if (!ids.length) {
      const t = await ev(c, filterToggle)
      if (t === 'OK') { refreshed = true; await sleep(1200); ids = await pollCards(c, 12000) }
    }
    const before = await ev(c, getSel)
    let sel = { clicked: 0, retried: 0, skipped: 0, already: 0, unknown: [] }
    if (ids.length) sel = await selectCards(c, ids)
    const after = await ev(c, getSel)
    if (refreshed) { await ev(c, filterToggle); await sleep(600) }
    log.push({ name, cards: ids.length, before, after, delta: after - before, clicked: sel.clicked, retried: sel.retried, already: sel.already, unknown: sel.unknown, skipped: sel.skipped, why: sel.why, pos: await ev(c, listPos), note: ids.length ? undefined : '该号主页无可投视频（取消过滤后仍为空）' })
  }
  const okb = await ev(c, `(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='确定'&&b.getBoundingClientRect().width>0);if(!bs.length)return 'NOOK';const r=bs[bs.length-1].getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]})()`)
  let submitted = false
  if (Array.isArray(okb)) { await click(c, okb[0], okb[1]); await sleep(5000); submitted = true }
  const total = await ev(c, `(()=>{const m=document.body.innerText.match(/共\\d+个视频/);return m?m[0]:null})()`)
  return { ok: true, fix: fixRes, submitted, totalVideos: total, log }
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