import { connect, sleep, listPages } from '../../live-control/scripts/cdp-lib.mjs'
// 复制技能固定连 9223 的独立浏览器实例（与 9222 的巡航实例物理隔离，互不抢标签）。
process.env.QC_CDP_PORT = process.env.QC_CDP_PORT || '9223';
const A = process.argv[2], ID = process.argv[3]
const pages = await listPages()
const hit = pages.find(p => p.type==='page' && (p.url||'').indexOf('overall-prom')>=0 && (p.url||'').indexOf(A)>=0)
if (!hit) { console.log(JSON.stringify({err:'no tab'})); process.exit(1) }
const c = await connect('overall-prom', { id: hit.id })
await c.send('Page.navigate', { url: 'https://qianchuan.jinritemai.com/overall-prom?aavid='+A+'&campaignType=1&uniTab=ad&uniVideoTab=1&overallPromViewTab=plan' }, 20000)
await sleep(6000)
const txt = await c.eval('document.body.innerText')
const box = await c.eval('(() => { const i=[...document.querySelectorAll("input")].find(x=>/回车搜索|计划名称|计划ID|计划 ID/.test(x.placeholder||"")); return i ? "ok" : "nobox" })()')
console.log(JSON.stringify({ step:'list', box, hasPlanView: String(txt).indexOf('计划视图')>=0 }))
await c.eval('(() => { const els=[...document.querySelectorAll("*")].filter(x=>x.children.length===0 && (x.innerText||"").trim()==="计划视图"); if(els.length) els[els.length-1].click(); const e2=[...document.querySelectorAll("*")].filter(x=>x.children.length===0 && (x.innerText||"").trim()==="商品自选"); if(e2.length) e2[e2.length-1].click(); return "clicked" })()')
await sleep(2500)
const set = '(() => { const i=[...document.querySelectorAll("input")].find(x=>/回车搜索|计划名称|计划ID|计划 ID/.test(x.placeholder||"")); if(!i) return "noinput"; i.focus(); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; s.call(i, ""); i.dispatchEvent(new Event("input",{bubbles:true})); s.call(i, ' + JSON.stringify(ID) + '); i.dispatchEvent(new Event("input",{bubbles:true})); return "typed" })()'
console.log(JSON.stringify({ typed: await c.eval(set) }))
await sleep(700)
await c.eval('(() => { const i=document.activeElement; const k={key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true}; i.dispatchEvent(new KeyboardEvent("keydown",k)); i.dispatchEvent(new KeyboardEvent("keyup",k)); return "enter" })()')
await sleep(9000)
const rowsTxt = await c.eval('(() => { const trs=[...document.querySelectorAll("tbody tr")].filter(r=>(r.innerText||"").indexOf("ID：")>=0); return trs.map(r=>(r.innerText||"").replace(/\\s+/g," ").slice(0,60)) })()')
console.log(JSON.stringify({ rows: rowsTxt }))
const chip = await c.eval('(() => { const tr=[...document.querySelectorAll("tbody tr")].find(r=>(r.innerText||"").indexOf(' + JSON.stringify(ID) + ')>=0); if(!tr) return "norow"; const leaves=[...tr.querySelectorAll("*")].filter(e=>e.children.length===0 && (e.innerText||"").trim().length>0); const first=(tr.innerText||"").split(String.fromCharCode(10)).map(s=>s.trim()).filter(Boolean)[0]; const el=leaves.find(e=>e.innerText.trim()===first)||leaves.find(e=>e.innerText.trim()==="素材"); if(!el) return "nochip"; el.click(); return "ok" })()')
console.log(JSON.stringify({ chip }))
await sleep(4000)
const tabRes = await c.eval('(() => { const roots=[...document.querySelectorAll("*")].filter(e=>{const t=e.innerText||"";return t.indexOf("保障历史")>=0 && t.indexOf("素材")>=0 && t.length>100}); if(!roots.length) return "noroot"; roots.sort((a,b)=>a.innerText.length-b.innerText.length); const lv=[...roots[0].querySelectorAll("*")].filter(e=>e.children.length===0 && (e.innerText||"").trim()==="素材"); if(!lv.length) return "notab"; lv[0].click(); return "ok" })()')
await sleep(5000)
const total = await c.eval('(() => { const t=document.body.innerText; const m=t.match(/共\\d+个视频/); const m2=t.match(/已选\\d+\\/200/); return { total: m?m[0]:null, sel: m2?m2[0]:null } })()')
console.log(JSON.stringify({ tabRes, total }))