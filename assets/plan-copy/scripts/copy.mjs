#!/usr/bin/env node
// 乘方-推商品「复制计划」v2：全部用 DOM 点击 + 页面内等待，不用坐标，不受窗口大小/缩放/滚动影响。
// 用法：node copy.mjs <all|confirm|search|delete|create|materials|publish|verify> <aavid> [params.json|计划ID]
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pickAllOnTarget } from './pick-all.mjs';
import { connect, sleep, listPages } from '../../live-control/scripts/cdp-lib.mjs';

const W = 'C:/Users/admin/Documents/deepseek-harness/default-workspace';

// ---------- 删除前确认单（硬闸门）----------
// 规则（用户 2026-11-20 定）：删除前必须把「搜索该计划 ID 后的单条计划截图」原文发给用户并等其确认；
// 只读图不算发图。confirm 子命令负责产出截图 + 确认单；delete 没有有效确认单一律拒绝。
// 确认单 30 分钟失效；换计划 ID 或换了截图都要重新 confirm。
const RECEIPT_TTL_MS = 30 * 60 * 1000;
const receiptPath = (planId) => path.join(W, 'qc', 'confirm', planId + '.json');
const tokenFor = (planId, ts, shot) => crypto.createHash('sha1').update(planId + '|' + ts + '|' + shot).digest('hex').slice(0, 16);
const nowIso = () => new Date().toISOString();
const t0 = Date.now();
let LAST = 'init';
const mark = (l, e) => { LAST = l; console.log('[' + ((Date.now() - t0) / 1000).toFixed(1) + 's] ' + l + (e ? ' ' + e : '')); };
// 看门狗：任何一步卡住都会打印最后一步并退出，避免静默长跑（默认 150s，可用 QC_WATCHDOG 覆盖）
setTimeout(() => { console.log('[WATCHDOG] 卡在 ' + LAST + '，强制退出'); process.exit(9) }, Number(process.env.QC_WATCHDOG || 150000));

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
  text = String(text);
  const ok = await page.eval('(() => { const i = ' + inputExpr + '; if (!i) return false; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; s.call(i, ""); i.dispatchEvent(new Event("input", { bubbles: true })); i.focus(); i.select(); return true })()');
  if (!ok) throw new Error('input not found');
  await page.send('Input.insertText', { text }, 8000);
  return true;
}

const HIT_ONE = (pid) => '(() => { const rows=[...document.querySelectorAll("tbody tr")].filter(function(r){ return (r.innerText||"").indexOf("ID：")>=0 }); return rows.length === 1 && (rows[0].innerText||"").indexOf(' + JSON.stringify(pid) + ') >= 0 })()';
async function pressEnter(page, inputExpr) {
  const expr = inputExpr || 'document.activeElement';
  return await page.eval('(() => { const i = ' + expr + '; if (!i) return "noinput"; const k = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }; i.dispatchEvent(new KeyboardEvent("keydown", k)); i.dispatchEvent(new KeyboardEvent("keyup", k)); return "sent" })()')
}
async function searchPlan(page, planId) {
  for (let i = 1; i <= 2; i++) {
    await focusAndType(page, PLAN_SEARCH, planId);
    await sleep(700);
    await pressEnter(page);
    if (await wait(page, HIT_ONE(planId), i === 1 ? 9000 : 15000)) return 'hit-' + i;
    await sleep(800);
  }
  return 'miss'
}
const PLAN_SEARCH = '[...document.querySelectorAll("input")].find(x => /回车搜索|计划名称|计划ID|计划 ID/.test(x.placeholder||""))';
const PRODUCT_SEARCH = '[...document.querySelectorAll("input")].find(x => (x.placeholder||"").includes("商品名称"))';
const AWEME_SEARCH = '[...document.querySelectorAll("input")].find(x => (x.placeholder||"").includes("抖音号名称"))';
const ROI_INPUT = 'document.querySelectorAll(".aurora-qc-input-number-input")[0]';
const BUDGET_INPUT = 'document.querySelectorAll(".aurora-qc-input-number-input")[1]';
const NAME_INPUT = '[...document.querySelectorAll("input")].find(x => (x.placeholder||"").includes("计划名称，1-50"))';

async function openList(page, aavid) {
  await page.send('Page.navigate', { url: 'https://qianchuan.jinritemai.com/overall-prom?aavid=' + aavid + '&campaignType=1&uniTab=ad&marGoal=1&uniVideoTab=1&overallPromViewTab=plan' }, 15000);
  await sleep(2500);
  mark('nav-done');
  // 导航后 SPA 常把视图停在上次的「全店托管」，先注入再切视图，否则连搜索框都搜不到
  let injected = false;
  for (let i = 0; i < 6 && !injected; i++) {
    try { await page.eval(INJECT); injected = true } catch (e) { await sleep(1000) }
  }
  mark('injected', injected ? 'ok' : 'fail');
  const ready = await wait(page, '(__qc.text().indexOf("计划视图") >= 0 || __qc.text().indexOf("商品自选") >= 0 || __qc.text().indexOf("全店托管") >= 0)', 20000);
  mark('page-ready', ready ? 'ok' : 'timeout');
  if (!ready) throw new Error('列表页未就绪（没看到 计划视图/商品自选/全店托管 任一文字）');
  await ensurePlanList(page);
}

// 列表页默认可能停在「全店托管」，必须先切到「商品自选」才有计划搜索框
async function ensurePlanList(page) {
  const clickLeaf = async (w) => page.eval('(() => { const els=[...document.querySelectorAll("*")].filter(x=>x.children.length===0 && (x.innerText||"").trim()===' + JSON.stringify(w) + ' && x.getBoundingClientRect().width>0); if(!els.length) return "missing"; els[els.length-1].click(); return "clicked" })()');
  // 1) 先切「计划视图」（页面上有 商品视图/计划视图 两级），2) 再切「商品自选」，3) 才出现计划搜索框
  const r1 = await clickLeaf('计划视图');
  await sleep(1200);
  const r2 = await clickLeaf('商品自选');
  mark('tabs', r1 + '/' + r2);
  let ok = await wait(page, '!!(' + PLAN_SEARCH + ')', 12000);
  mark('search-box', ok ? 'ok' : 'timeout');
  if (!ok) {
    const diag = await page.eval('JSON.stringify([...document.querySelectorAll("*")].filter(x=>x.children.length===0 && (x.innerText||"").trim().length>0 && (x.innerText||"").trim().length<8 && x.getBoundingClientRect().width>0).map(x=>(x.innerText||"").trim()).filter((v,i,a)=>a.indexOf(v)===i).slice(0,40))');
    await clickLeaf('计划视图');
    await sleep(1500);
    await clickLeaf('商品自选');
    ok = await wait(page, '!!(' + PLAN_SEARCH + ')', 12000);
    if (!ok) throw new Error('计划列表搜索框未就绪（计划视图=' + r1 + ' 商品自选=' + r2 + ' 可见文字=' + String(diag).slice(0, 200) + '）');
  }
  return true;
}

async function cmdSearch() {
  const aavid = process.argv[3], planId = process.argv[4];
  const page = await connect('jinritemai');
  await openList(page, aavid);
  const hitRes = await searchPlan(page, planId);
  mark('search-hit', hitRes);
  await wait(page, '(() => { const t = document.body.innerText || ""; return t.indexOf("条计划") >= 0 })()', 12000);
  const info = await page.eval('(() => { const rows = [...document.querySelectorAll("tbody tr")].map(r => r.innerText || "").filter(x => x.indexOf("ID：") >= 0); return JSON.stringify({ idRows: rows.length, rows: rows.slice(0, 5) }) })()');
  mark('search', info);
  // 不要 page.close()：会关掉标签页
}

async function cmdDelete() {
  const aavid = process.argv[3], planId = process.argv[4], token = process.argv[5];
  if (!planId) throw new Error('用法: copy.mjs delete <aavid> <planId> <确认单TOKEN>');
  // —— 硬闸门：没有 confirm 产出的确认单，直接拒绝删除（除非显式 --force，但仍会告警）
  if (token !== '--force') {
    const rp = receiptPath(planId);
    if (!fs.existsSync(rp)) throw new Error('拒绝删除：没有确认单 ' + rp + '，先跑 confirm 并把截图原文发给用户');
    const rc = JSON.parse(fs.readFileSync(rp, 'utf8'));
    if (rc.planId !== planId) throw new Error('拒绝删除：确认单不属于计划 ' + planId);
    if (Date.now() - rc.ts > RECEIPT_TTL_MS) throw new Error('拒绝删除：确认单已超过 30 分钟，重新 confirm');
    if (rc.token !== token) throw new Error('拒绝删除：TOKEN 与确认单不一致（应为 ' + rc.token + '）');
    if (!fs.existsSync(rc.shot)) throw new Error('拒绝删除：确认截图文件丢失 ' + rc.shot);
    mark('receipt-ok', rc.shot + ' @ ' + new Date(rc.ts).toISOString());
  } else { mark('WARN', '--force 跳过了确认单校验，仅限用户已口头明确授权'); }
  const page = await connect('jinritemai');
  await openList(page, aavid);
  const hit = (await searchPlan(page, planId)) !== 'miss';
  if (!hit) throw new Error('未唯一命中，拒绝删除');
  mark('unique-hit');
  const clicked = await page.eval('(() => { const c=(s)=>(s||"").replace(/\s+/g," ").trim(); const tr=[...document.querySelectorAll("tbody tr")].find(r=>c(r.innerText).includes(' + JSON.stringify(planId) + ')); if(!tr) return "norow"; const b=[...tr.querySelectorAll("*")].filter(e=>e.children.length===0 && c(e.innerText)==="删除").pop(); if(!b) return "nobtn"; b.click(); return "ok" })()');
  if (clicked !== 'ok') throw new Error('删除按钮: ' + clicked);
  const dlg = await wait(page, '[...document.querySelectorAll("*")].some(e=>(e.innerText||"").trim()==="确定要删除计划吗？")', 6000);
  if (!dlg) throw new Error('删除弹窗未出现');
  await page.eval('(() => { const c=(s)=>(s||"").replace(/\s+/g," ").trim(); const t=[...document.querySelectorAll("*")].find(e=>(e.innerText||"").trim()==="确定要删除计划吗？"); const w=t.closest(".aurora-qc-modal-wrap"); const b=[...w.querySelectorAll("button")].find(x=>c(x.innerText)==="确定"); if(b) b.click(); return 1 })()');
  mark('confirm-clicked');
  const gone = await wait(page, '(() => { const t = document.body.innerText || ""; if (t.indexOf("删除成功") < 0) return false; const rows = [...document.querySelectorAll("tbody tr")].filter(r => (r.innerText || "").indexOf("ID：") >= 0); return rows.length === 0 })()', 75000);
  mark('deleted', gone ? 'ok' : 'timeout');
  // 不要 page.close()：会关掉标签页
  process.exit(gone ? 0 : 4);
}

async function cmdConfirm() {
  const aavid = process.argv[3], planId = process.argv[4];
  if (!planId) throw new Error('用法: copy.mjs confirm <aavid> <planId>');
  const page = await connect('jinritemai');
  await openList(page, aavid);
  const hit = (await searchPlan(page, planId)) !== 'miss';
  if (!hit) throw new Error('拒绝出确认图：搜索结果里没有唯一该 ID 的行');
  const row = await page.eval('(() => { const c=(s)=>(s||"").replace(/\s+/g," ").trim(); const tr=[...document.querySelectorAll("tbody tr")].find(r=>c(r.innerText).includes(' + JSON.stringify(planId) + ')); return tr ? c(tr.innerText) : "norow" })()');
  if (row === 'norow') throw new Error('拒绝出确认图：列表里没有该 ID 的行');
  const outDir = path.join(W, 'qc');
  fs.mkdirSync(outDir, { recursive: true });
  const shot = path.join(outDir, 'confirm-' + planId + '.png');
  await page.eval('window.scrollTo(0,0)');
  await page.shot(shot);
  const ts = Date.now(), token = tokenFor(planId, ts, shot);
  fs.mkdirSync(path.dirname(receiptPath(planId)), { recursive: true });
  fs.writeFileSync(receiptPath(planId), JSON.stringify({ planId, aavid, ts, shot, token, rowText: row }, null, 1));
  mark('confirm-shot', shot);
  console.log('ROW ' + row);
  console.log('SHOT ' + shot);
  console.log('TOKEN ' + token);
  console.log('-- 硬规则：把下面这行原文发给用户，等用户回「确认删除」后，再用 TOKEN 执行 delete --');
  console.log('![删除前确认](<' + shot.replace(/\\/g, '/') + '>)');
  // 不要 page.close()：会关掉标签页
  process.exit(0);
}

async function cmdCreate() {
  const aavid = process.argv[3], p = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  const page = await connect('jinritemai');
  await page.send('Page.navigate', { url: 'https://qianchuan.jinritemai.com/create-ad/overall-product?aavid=' + aavid }, 15000);
  await page.eval(INJECT);   // 必须先注入 __qc，否则 ready 判断里的 __qc.text() 直接抛错
  const ready = await wait(page, '/选择投放对象/.test(__qc.text())', 20000);
  if (!ready) throw new Error('新建页未就绪');
  mark('create-page');

  await wait(page, '/添加商品/.test(__qc.text())', 20000);
  let drawerOpened = false;
  for (let i = 0; i < 3 && !drawerOpened; i++) {
    await page.eval('__qc.clickText("添加商品")');
    drawerOpened = await wait(page, '!!' + PRODUCT_SEARCH, 8000);
    if (!drawerOpened) await page.eval('new Promise(r=>setTimeout(r,1500))');
  }
  if (!drawerOpened) throw new Error('商品抽屉未出现（搜索框没出来）');
  mark('product-drawer');

  const filt = await page.eval('(() => { var ls = [].slice.call(document.querySelectorAll("label,span,div")).filter(function (e) { var t = e.innerText || ""; return t.indexOf("只看可投商品") >= 0 && t.length < 30 }); if (!ls.length) return "no-label"; ls.sort(function (a, b) { return (a.innerText || "").length - (b.innerText || "").length }); var lab = ls[0].closest ? ls[0].closest("label") : null; var inp = null; if (lab) inp = lab.querySelector("input[type=checkbox]"); if (!inp) inp = ls[0].querySelector("input[type=checkbox]"); if (!inp) return "no-input"; if (inp.checked) { inp.click(); return "unchecked" } return "already-off" })()');
  mark('product-filter', filt);
  await sleep(600);
  let rowOk = false;
  for (let i = 0; i < 3 && !rowOk; i++) {
    await focusAndType(page, PRODUCT_SEARCH, p.productId);
    await sleep(600);
    rowOk = await wait(page, '__qc.rowByText(' + JSON.stringify(p.productId) + ')', 7000);
    if (!rowOk) { await pressEnter(page); rowOk = await wait(page, '__qc.rowByText(' + JSON.stringify(p.productId) + ')', 8000); }
    if (!rowOk) await sleep(1000);
  }
  if (!rowOk) throw new Error('商品行未出现（已尝试取消只看可投商品并回车搜索三次）');
  const clicked = await page.eval('__qc.clickRowLabel(' + JSON.stringify(p.productId) + ')');
  if (clicked !== 'ok') throw new Error('商品勾选: ' + clicked);
  const picked = await wait(page, '/已选[^0-9]{0,3}[1-9]\\d*\\s*\\/\\s*30/.test(__qc.text())', 4000);
  if (!picked) throw new Error('商品未选中');
  mark('product-picked');

  await page.eval('__qc.clickText("下一步")');
  const step2 = await wait(page, '/手动选择抖音号|为商品添加抖音号|请输入抖音号名称/.test(__qc.text())', 15000);
  if (!step2) throw new Error('抖音号步骤未出现');
  await page.eval('__qc.clickText("手动选择抖音号")');
  const awemeReady = await wait(page, '!!' + AWEME_SEARCH, 12000);
  if (!awemeReady) throw new Error('抖音号搜索框未出现');
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

// ---------- 规则（用户 2026-11-20 定，写进代码）----------
// 1) 页面上任何遮挡式引导/气泡（「建议您开启…」「我知道了」）必须先关掉，再做下一步；
// 2) 素材唯一合法路径：列表 → 搜计划ID → 该行「素材」入口（详情抽屉）→ 素材 → 素材类型「视频」→ 添加视频
//    → 逐抖音号全选 → 一次确定。禁止走 create-ad?type=e 编辑页加素材。
const BUBBLE_TEXTS = ['我知道了', '知道了', '不再提示', '跳过'];

async function dismissBubbles(page, depth = 0) {
  if (depth > 3) return 'deeper';
  const r = await page.eval('(() => { const texts = ' + JSON.stringify(BUBBLE_TEXTS) + '; const els = [...document.querySelectorAll("span,div,button,a")].filter(e => e.children.length === 0 && texts.indexOf((e.innerText || "").trim()) >= 0 && e.getBoundingClientRect().width > 0); if (!els.length) return "none"; els[els.length - 1].click(); return "dismissed" })()');
  if (r === 'dismissed') { await sleep(900); return dismissBubbles(page, depth + 1) }
  return r
}

// 列表第一行 = 最新创建的计划（列表按创建时间倒序）
async function newestPlanId(page) {
  const raw = await page.eval('(() => { const tr = document.querySelector("tbody tr"); return tr ? tr.innerText : "" })()');
  const m = String(raw).match(/ID[:：]\s*(\d{10,})/);
  return m ? m[1] : null
}

// 素材：只在详情页抽屉里加（用户指定路径）
async function addMaterialsViaDrawer(page, aavid, planId, names, opts = {}) {
  await openList(page, aavid);
  await dismissBubbles(page);
  mark('list-ready');
  const hit = (await searchPlan(page, planId)) !== 'miss';
  if (!hit) throw new Error('搜索该 ID 不是唯一 1 条（可见行数不唯一或窗口里没等到结果），拒绝继续');
  mark('search-unique');
  const chip = await page.eval('(() => { const rows = [...document.querySelectorAll("tbody tr")]; const tr = rows.find(r => (r.innerText || "").indexOf(' + JSON.stringify(planId) + ') >= 0); if (!tr) return "norow"; const leaves = [...tr.querySelectorAll("*")].filter(e => e.children.length === 0 && (e.innerText || "").trim().length > 0); const first = (tr.innerText || "").split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean)[0]; let el = leaves.find(e => e.innerText.trim() === first) || leaves.find(e => e.innerText.trim() === "素材"); if (!el) return "nochip"; el.click(); return "ok" })()');
  if (chip !== 'ok') throw new Error('打不开素材入口: ' + chip);
  const opened = await wait(page, '(__qc.text().indexOf("保障历史") >= 0)', 12000);
  if (!opened) throw new Error('详情抽屉未打开');
  const tabClick = await page.eval('(() => { const roots = [...document.querySelectorAll("*")].filter(e => { const t = e.innerText || ""; return t.indexOf("保障历史") >= 0 && t.indexOf("素材") >= 0 && t.length > 100 }); if (!roots.length) return "noroot"; roots.sort((a, b) => a.innerText.length - b.innerText.length); const r = roots[0]; const lv = [...r.querySelectorAll("*")].filter(e => e.children.length === 0 && (e.innerText || "").trim() === "素材"); if (!lv.length) return "notab"; lv[0].click(); return "ok" })()');
  mark('material-tab', tabClick);
  await sleep(1500);
  const drawer = await wait(page, '(__qc.text().indexOf("素材来源") >= 0)', 15000);
  if (!drawer) throw new Error('详情抽屉-素材 tab 未就绪');
  await dismissBubbles(page);
  mark('drawer-material');
  const typeOk = await wait(page, '(__qc.text().indexOf("素材类型") >= 0)', 8000);
  if (!typeOk) throw new Error('素材类型行未出现');
  const srcPick = await clickByText(page, '自选素材');
  mark('material-src', JSON.stringify(srcPick));
  await sleep(900);
  const typePick = await clickByText(page, '视频');
  mark('material-type', JSON.stringify(typePick));
  await sleep(1500);
  const hasBtn = await wait(page, '(__qc.text().indexOf("添加视频") >= 0)', 10000);
  if (!hasBtn) throw new Error('选中 自选素材/视频 后仍没有「添加视频」按钮');
  const clicked = await clickByText(page, '添加视频');
  if (clicked.click !== 'ok') throw new Error('点不到「添加视频」: ' + JSON.stringify(clicked));
  const popup = await wait(page, '(__qc.text().indexOf("已选择") >= 0)', 15000);
  if (!popup) throw new Error('「添加视频」弹窗未打开');
  mark('popup');
  const targets = (await listPages()).filter((t) => t.type === 'page' && (t.url || '').indexOf('qianchuan') >= 0);
  if (!targets.length) throw new Error('找不到千川标签页');
  // 绑定到当前驱动的那个标签页（有 id 就按 id，没有就按连接时的 URL 兜底）
  const tgt = (page.id && targets.find((t) => t.id === page.id)) || targets.find((t) => t.url === page.url) || targets[0];
  const res = await pickAllOnTarget(tgt, names);
  if (res.error) throw new Error(res.error);
  mark('pick', JSON.stringify(res.log));
  if (opts.cancelAfterPick) {
    // 验证用：勾完不提交，直接取消，计划数据不变
    const cx = await clickByText(page, '取消');
    mark('cancelled', JSON.stringify(cx));
    return res
  }
  const applied = await wait(page, '(__qc.text().split(" ").join("").indexOf("个视频") >= 0)', 8000);
  mark('materials-applied', applied ? 'ok' : 'timeout');
  return res
}

async function cmdMaterials() {
  const aavid = process.argv[3], planId = process.argv[4], paramsFile = process.argv[5];
  const dry = process.argv.includes('--dry');
  if (!aavid || !planId) throw new Error('用法: node copy.mjs materials <aavid> <计划ID> [params.json] [--dry]');
  const p = paramsFile ? JSON.parse(fs.readFileSync(paramsFile, 'utf8')) : {};
  const names = Object.values(p.awemeNames || {});
  if (!names.length) throw new Error('params.json 里没有 awemeNames，拿不到抖音号名单');
  if (dry) {
    const page0 = await connect('jinritemai');
    mark('connected');
    await openList(page0, aavid);
    mark('list-ready');
    await dismissBubbles(page0);
    const hit = (await searchPlan(page0, planId)) !== 'miss';
    mark('submitted', hit ? 'hit' : 'miss');
    const rowsInfo = String(1);
    mark('rows', rowsInfo);
    const chip = await page0.eval('(() => { const rows = [...document.querySelectorAll("tbody tr")]; const tr = rows.find(r => (r.innerText || "").indexOf(' + JSON.stringify(planId) + ') >= 0); if (!tr) return "norow"; const chips = [...tr.querySelectorAll("*")].filter(e => e.children.length === 0 && (e.innerText || "").trim() === "素材" && e.getBoundingClientRect().width > 0); if (!chips.length) return "nochip"; chips[chips.length - 1].click(); return "ok" })()');
    const drawer = await wait(page0, '(__qc.text().indexOf("素材来源") >= 0)', 15000);
    mark('dry', JSON.stringify({ hit: hit, chip: chip, drawer: drawer, names: names.length }));
    return
  }
  const page = await connect('jinritemai');
  await page.eval(INJECT);
  const res = await addMaterialsViaDrawer(page, aavid, planId, names, { cancelAfterPick: process.argv.includes('--picktest') });
  mark('result', JSON.stringify({ totalVideos: res.totalVideos, submitted: res.submitted, picktest: process.argv.includes('--picktest') }));
}

// 一条龙：新建 → 发布 → 找新计划ID → 详情抽屉加素材
async function cmdAll() {
  const aavid = process.argv[3], paramsFile = process.argv[4];
  const argv0 = process.argv.slice(0, 2);
  process.argv = argv0.concat(['create', aavid, paramsFile]);
  await cmdCreate();
  process.argv = argv0.concat(['publish']);
  await cmdPublish();
  const page = await connect('jinritemai');
  await page.eval(INJECT);
  const newId = await newestPlanId(page);
  if (!newId) throw new Error('发布后拿不到新计划 ID');
  mark('new-plan', newId);
  process.argv = argv0.concat(['materials', aavid, newId, paramsFile]);
  await cmdMaterials();
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
  if (!done) throw new Error('发布后未跳到 createSuccess');
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
const table = { all: cmdAll, confirm: cmdConfirm, search: cmdSearch, verify: cmdSearch, delete: cmdDelete, create: cmdCreate, materials: cmdMaterials, publish: cmdPublish, click: cmdClick };
const cmd = process.argv[2];
if (!table[cmd]) { console.log('usage: node copy.mjs <all|confirm|search|delete|create|materials|publish|verify|click> ...')
  console.log('  all <aavid> <params.json>   一条龙：新建+发布+素材')
  console.log('  confirm <aavid> <计划ID>    出确认截图+确认单（删除前置）')
  console.log('  materials <aavid> <计划ID> [params.json] [--dry]  详情抽屉加素材'); process.exit(2); }
try { await table[cmd](); mark('done'); process.exit(0) } catch (e) { console.log('ERR ' + e.message); process.exit(3) }