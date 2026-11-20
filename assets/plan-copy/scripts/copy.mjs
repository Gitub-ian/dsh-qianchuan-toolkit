#!/usr/bin/env node
// 乘方-推商品「复制计划」v2：全部用 DOM 点击 + 页面内等待，不用坐标，不受窗口大小/缩放/滚动影响。
// 用法：node copy.mjs <search|delete|create|materials|publish|verify> <aavid> [params.json]
import fs from 'node:fs';
import { connect, sleep } from '../../live-control/scripts/cdp-lib.mjs';

const W = 'C:/Users/admin/Documents/deepseek-harness/default-workspace';
const t0 = Date.now();
const mark = (l, e) => console.log('[' + ((Date.now() - t0) / 1000).toFixed(1) + 's] ' + l + (e ? ' ' + e : ''));

// ---------- 注入到页面里的工具函数（不依赖坐标） ----------
function qcHelpers() {
  const T = (s) => (s || '').replace(/\s+/g, ' ').trim();
  window.__qc = {
    text: () => T(document.body ? document.body.innerText : ''),
    leaves(t, root) {
      return [...(root || document).querySelectorAll('button,span,div,a,li,label')]
        .filter((e) => e.children.length === 0 && T(e.innerText) === t && e.getBoundingClientRect().width > 0);
    },
    clickText(t, root) {
      const hits = this.leaves(t, root);
      const el = hits[hits.length - 1];
      if (!el) return false;
      el.click();
      return true;
    },
    rowByText(t) {
      const cands = [...document.querySelectorAll('*')]
        .filter((e) => e.children.length === 0 && T(e.innerText).includes(t) && e.getBoundingClientRect().width > 0);
      for (const l of cands) { const tr = l.closest('tr'); if (tr) return tr; }
      for (const l of cands) { const c = l.closest('.card-product-item,.oc-card,.ovui-card,.create-material-list-card-item'); if (c) return c; }
      return null;
    },
    clickRowLabel(t) {
      const row = this.rowByText(t);
      if (!row) return 'norow';
      const lab = row.querySelector('label.ovui-checkbox') || row.querySelector('label') || row.querySelector('input[type=checkbox]');
      if (!lab) return 'nolabel';
      lab.click();
      return 'ok';
    },
    clickCardLabel(i) {
      const cards = [...document.querySelectorAll('.create-material-list-card-item')].filter((c) => c.getBoundingClientRect().height > 0);
      const card = cards[i];
      if (!card) return 'nocard';
      const lab = card.querySelector('label') || card.querySelector('[class*=checkbox]') || card;
      lab.click();
      return 'ok';
    },
    cardsInfo() {
      const cards = [...document.querySelectorAll('.create-material-list-card-item')].filter((c) => c.getBoundingClientRect().height > 0);
      const sel = cards.filter((c) => c.querySelector('.oc-create-material-card-selected')).length;
      return { n: cards.length, sel: sel };
    }
  };
  return true;
}
const INJECT = '(' + qcHelpers.toString() + ')()';
const waitJs = (cond, ms) => '(async () => { const t0 = performance.now(); while (performance.now() - t0 < ' + ms + ') { try { if (' + cond + ') return true } catch (e) {} await new Promise(r => setTimeout(r, 40)) } return false })()';
const wait = async (page, cond, ms) => await page.eval(waitJs(cond, ms), ms + 8000);
const txt = async (page) => await page.eval('__qc.text()');

async function focusAndType(page, inputExpr, text) {
  const ok = await page.eval('(() => { const i = ' + inputExpr + '; if (!i) return false; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; s.call(i, ""); i.dispatchEvent(new Event("input", { bubbles: true })); i.focus(); i.select(); return true })()');
  if (!ok) throw new Error('input not found');
  await page.send('Input.insertText', { text }, 8000);
  return true;
}

const PLAN_SEARCH = '[...document.querySelectorAll("input")].find(x => (x.placeholder||"").includes("计划名称"))';
const PRODUCT_SEARCH = '[...document.querySelectorAll("input")].find(x => (x.placeholder||"").includes("商品名称"))';
const AWEME_SEARCH = '[...document.querySelectorAll("input")].find(x => (x.placeholder||"").includes("抖音号名称"))';
const ROI_INPUT = 'document.querySelectorAll(".aurora-qc-input-number-input")[0]';
const BUDGET_INPUT = 'document.querySelectorAll(".aurora-qc-input-number-input")[1]';
const NAME_INPUT = '[...document.querySelectorAll("input")].find(x => (x.placeholder||"").includes("计划名称，1-50"))';

async function openList(page, aavid) {
  await page.send('Page.navigate', { url: 'https://qianchuan.jinritemai.com/overall-prom?aavid=' + aavid + '&campaignType=1&uniTab=ad&marGoal=1&uniVideoTab=1&overallPromViewTab=plan' }, 15000);
  const ok = await wait(page, '!!' + PLAN_SEARCH, 15000);
  if (!ok) throw new Error('列表页未就绪');
  await page.eval(INJECT);
}

async function cmdSearch() {
  const aavid = process.argv[3], planId = process.argv[4];
  const page = await connect('jinritemai');
  await openList(page, aavid);
  await focusAndType(page, PLAN_SEARCH, planId);
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }, 8000);
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }, 8000);
  await wait(page, '/共\s*\d+\s*条计划/.test(__qc.text())', 8000);
  const info = await page.eval('(() => { const c=(s)=>(s||"").replace(/\s+/g," ").trim(); const m=c(document.body.innerText).match(/共\s*(\d+)\s*条计划/); const rows=[...document.querySelectorAll("tbody tr")].map(r=>c(r.innerText)).filter(x=>x.length>40); return JSON.stringify({count: m?m[1]:null, rows: rows.slice(0,3)}) })()');
  mark('search', info);
  // 不要 page.close()：会关掉标签页
}

async function cmdDelete() {
  const aavid = process.argv[3], planId = process.argv[4];
  const page = await connect('jinritemai');
  await openList(page, aavid);
  await focusAndType(page, PLAN_SEARCH, planId);
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }, 8000);
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }, 8000);
  const hit = await wait(page, '/共\s*1\s*条计划/.test(__qc.text())', 8000);
  if (!hit) throw new Error('未唯一命中，拒绝删除');
  mark('unique-hit');
  const clicked = await page.eval('(() => { const c=(s)=>(s||"").replace(/\s+/g," ").trim(); const tr=[...document.querySelectorAll("tbody tr")].find(r=>c(r.innerText).includes(' + JSON.stringify(planId) + ')); if(!tr) return "norow"; const b=[...tr.querySelectorAll("*")].filter(e=>e.children.length===0 && c(e.innerText)==="删除").pop(); if(!b) return "nobtn"; b.click(); return "ok" })()');
  if (clicked !== 'ok') throw new Error('删除按钮: ' + clicked);
  const dlg = await wait(page, '[...document.querySelectorAll("*")].some(e=>(e.innerText||"").trim()==="确定要删除计划吗？")', 6000);
  if (!dlg) throw new Error('删除弹窗未出现');
  await page.eval('(() => { const c=(s)=>(s||"").replace(/\s+/g," ").trim(); const t=[...document.querySelectorAll("*")].find(e=>(e.innerText||"").trim()==="确定要删除计划吗？"); const w=t.closest(".aurora-qc-modal-wrap"); const b=[...w.querySelectorAll("button")].find(x=>c(x.innerText)==="确定"); if(b) b.click(); return 1 })()');
  mark('confirm-clicked');
  const gone = await wait(page, '/删除成功/.test(__qc.text()) && /共\s*0\s*条计划|暂无数据/.test(__qc.text())', 75000);
  mark('deleted', gone ? 'ok' : 'timeout');
  // 不要 page.close()：会关掉标签页
  process.exit(gone ? 0 : 4);
}

async function cmdCreate() {
  const aavid = process.argv[3], p = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  const page = await connect('jinritemai');
  await page.send('Page.navigate', { url: 'https://qianchuan.jinritemai.com/create-ad/overall-product?aavid=' + aavid }, 15000);
  const ready = await wait(page, '/选择投放对象/.test(__qc.text())', 20000);
  if (!ready) throw new Error('新建页未就绪');
  await page.eval(INJECT);
  mark('create-page');

  const opened = await page.eval('__qc.clickText("添加商品")');
  if (!opened) throw new Error('找不到「添加商品」');
  const drawer = await wait(page, '!!document.querySelector(".card-product-item")', 8000);
  if (!drawer) throw new Error('商品抽屉未出现');
  mark('product-drawer');

  await focusAndType(page, PRODUCT_SEARCH, p.productId);
  const rowOk = await wait(page, '__qc.rowByText(' + JSON.stringify(p.productId) + ')', 10000);
  if (!rowOk) throw new Error('商品行未出现');
  const clicked = await page.eval('__qc.clickRowLabel(' + JSON.stringify(p.productId) + ')');
  if (clicked !== 'ok') throw new Error('商品勾选: ' + clicked);
  const picked = await wait(page, '/已选[^0-9]{0,3}[1-9]\d*\s*\/\s*30/.test(__qc.text())', 4000);
  if (!picked) throw new Error('商品未选中');
  mark('product-picked');

  await page.eval('__qc.clickText("下一步")');
  const step2 = await wait(page, '/手动选择抖音号/.test(__qc.text())', 8000);
  if (!step2) throw new Error('抖音号步骤未出现');
  await page.eval('__qc.clickText("手动选择抖音号")');
  await wait(page, '!!' + AWEME_SEARCH, 4000);
  mark('aweme-step');

  const ids = p.awemeIds || [], names = p.awemeNames || {};
  const tA = Date.now();
  let done = 0;
  for (const id of ids) {
    await focusAndType(page, AWEME_SEARCH, id);
    let ok = await wait(page, '__qc.rowByText(' + JSON.stringify(id) + ')', 4000);
    if (!ok) {
      const nm = names[id];
      if (nm) { await focusAndType(page, AWEME_SEARCH, nm); ok = await wait(page, '__qc.rowByText(' + JSON.stringify(id) + ')', 4000); }
    }
    if (!ok) { console.log('MISS ' + id); continue; }
    const r = await page.eval('__qc.clickRowLabel(' + JSON.stringify(id) + ')');
    if (r !== 'ok') { console.log('MISS2 ' + id + ' ' + r); continue; }
    done++;
  }
  const pickedAw = await page.eval('(() => { const m = __qc.text().match(/当前商品已选：\s*(\d+)/); return m ? m[1] : "?" })()');
  mark('awemes', 'clicked=' + done + ' picked=' + pickedAw + ' in ' + ((Date.now() - tA) / 1000).toFixed(1) + 's');
  await page.eval('__qc.clickText("确定")');
  const applied = await wait(page, '/\d+个抖音号/.test(__qc.text())', 8000);
  mark('aweme-applied', applied ? 'ok' : 'timeout');

  await focusAndType(page, ROI_INPUT, p.roi);
  await focusAndType(page, BUDGET_INPUT, p.budget);
  await focusAndType(page, NAME_INPUT, p.planName);
  const vals = await page.eval('JSON.stringify({ nums: [...document.querySelectorAll(".aurora-qc-input-number-input")].map(x => x.value), name: (' + NAME_INPUT + ' || {}).value })');
  mark('form', vals);
  // 不要 page.close()：会关掉标签页
}

async function cmdMaterials() {
  const p = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const page = await connect('jinritemai');
  await page.eval(INJECT);
  const ok = await page.eval('__qc.clickText("添加自选素材")');
  if (!ok) throw new Error('找不到「添加自选素材」');
  const dOpen = await wait(page, '[...document.querySelectorAll(".ovui-tabs__tab-btn")].length > 1', 10000);
  if (!dOpen) throw new Error('素材抽屉未打开');
  mark('material-drawer');
  const cnt = await page.eval('[...document.querySelectorAll(".ovui-tabs__tab-btn")].length');
  let total = 0;
  for (let i = 1; i < cnt; i++) {
    const tA = Date.now();
    const tabName = await page.eval('(() => { const t=[...document.querySelectorAll(".ovui-tabs__tab-btn")][' + i + ']; return t ? (t.innerText||"").trim() : "" })()');
    await page.eval('(() => { const t=[...document.querySelectorAll(".ovui-tabs__tab-btn")][' + i + ']; if(t) t.click(); return 1 })()');
    await wait(page, '__qc.text().includes("添加视频")', 5000);
    await page.eval('__qc.clickText("添加视频")');
    let info = null;
    for (let a = 0; a < 3; a++) {
      const hasCards = await wait(page, '__qc.cardsInfo().n > 0', 8000);
      if (!hasCards) { await page.eval('__qc.clickText("添加视频")'); continue; }
      info = await page.eval('__qc.cardsInfo()');
      if (info.n > 0) break;
    }
    if (!info || info.n === 0) { console.log('NOCARD ' + tabName); continue; }
    let n = info.n;
    for (let k = 0; k < n; k++) await page.eval('__qc.clickCardLabel(' + k + ')');
    const after = await wait(page, '__qc.cardsInfo().sel >= ' + n, 3000);
    const st = await page.eval('__qc.cardsInfo()');
    total += st.sel;
    await page.eval('__qc.clickText("确定")');
    await wait(page, '/已添加：\d+/.test(__qc.text())', 5000);
    console.log('VID ' + tabName + ' n=' + n + ' sel=' + st.sel + ' ' + ((Date.now() - tA) / 1000).toFixed(1) + 's');
  }
  await page.eval('__qc.clickText("确定")');
  await sleep(600);
  const summary = await page.eval('(() => { const m = __qc.text().match(/共\s*(\d+)\s*条自选素材/); return m ? m[1] : "?" })()');
  mark('all-materials', 'total=' + total + ' applied=' + summary);
  // 注意：绝不能 page.close()，那会关掉标签页（曾导致整窗退出）
}

async function cmdPublish() {
  const page = await connect('jinritemai');
  await page.eval(INJECT);
  await page.eval('__qc.clickText("发布计划")');
  const dlg = await wait(page, '/确认发布/.test(__qc.text())', 8000);
  if (!dlg) throw new Error('发布确认框未出现');
  const c = await clickByText(page, '确认发布');
  mark('confirm', JSON.stringify(c));
  const done = await wait(page, 'location.href.includes("overall-prom") && location.href.includes("createSuccess")', 30000);
  mark('published', done ? 'ok' : 'timeout');
  process.exit(done ? 0 : 4);
}


// ---------- 统一「按文字点击」：普通 DOM → 穿透 shadow DOM 兜底 ----------
async function findInShadow(page, text) {
  if (!page.__domEnabled) { await page.send('DOM.enable', {}, 8000); page.__domEnabled = true }
  const flat = await page.send('DOM.getFlattenedDocument', { depth: -1, pierce: true }, 20000);
  return (flat.nodes || []).filter((n) => n.nodeType === 3 && (n.nodeValue || "").indexOf(text) >= 0);
}
async function clickInShadow(page, text) {
  const hits = await findInShadow(page, text);
  if (!hits.length) return 'noshadow';
  const pid = hits[hits.length - 1].parentId;
  const obj = await page.send('DOM.resolveNode', { nodeId: pid }, 10000);
  const fn = 'function(){var p=this;for(var d=0;d<6&&p;d++){var c=(p.className||"").toString();if(p.tagName==="BUTTON"||c.indexOf("btn")>=0||c.indexOf("button")>=0){p.click();return "clicked:"+p.tagName}p=p.parentElement}this.click();return "clicked-self"}';
  const r = await page.send('Runtime.callFunctionOn', { objectId: obj.object.objectId, functionDeclaration: fn, returnByValue: true }, 10000);
  return r.result ? r.result.value : 'unknown';
}
// 先普通 DOM（__qc.clickText），没有就立刻穿透 shadow DOM；返回走了哪一层、耗多少毫秒
async function clickByText(page, text) {
  const t = Date.now();
  const dom = await page.eval('__qc.clickText(' + JSON.stringify(text) + ')');
  if (dom) return { text: text, layer: 'dom', click: 'ok', ms: Date.now() - t };
  const sh = await clickInShadow(page, text);
  return { text: text, layer: 'shadow', click: sh, ms: Date.now() - t };
}
async function cmdClick() {
  const page = await connect('jinritemai');
  await page.eval(INJECT);
  const text = process.argv[3] || '发布计划';
  const dry = process.argv.includes('--dry');
  const domCount = await page.eval('__qc.leaves(' + JSON.stringify(text) + ').length');
  let shadowHit = 0;
  try { shadowHit = (await findInShadow(page, text)).length } catch (e) { shadowHit = -1 }
  mark('locate', JSON.stringify({ text: text, domLeaves: domCount, shadowTextNodes: shadowHit }));
  if (!dry) mark('click', JSON.stringify(await clickByText(page, text)));
}
const table = { search: cmdSearch, verify: cmdSearch, delete: cmdDelete, create: cmdCreate, materials: cmdMaterials, publish: cmdPublish, click: cmdClick };
const cmd = process.argv[2];
if (!table[cmd]) { console.log('usage: node copy.mjs <search|delete|create|materials|publish|verify> ...'); process.exit(2); }
try { await table[cmd](); } catch (e) { console.log('ERR ' + e.message); process.exit(3); }
