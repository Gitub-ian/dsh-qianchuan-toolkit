#!/usr/bin/env node
// 抓取乘方-推商品计划参数：列表搜 ID -> 唯一命中 -> 详情页 抖音号/素材 -> params.json
// 用法: node capture.mjs <aavid> <planId> <outJson> [newDateSuffix]
import fs from 'node:fs';
import { connect, sleep, listPages } from '../../live-control/scripts/cdp-lib.mjs';

const aavid = process.argv[2], planId = process.argv[3], outFile = process.argv[4], suffix = process.argv[5] || '1124';
if (!aavid || !planId || !outFile) { console.log('usage: node capture.mjs <aavid> <planId> <outJson> [suffix]'); process.exit(2); }
const listUrl = 'https://qianchuan.jinritemai.com/overall-prom?aavid=' + aavid + '&campaignType=1&uniTab=ad&uniVideoTab=1&overallPromViewTab=plan';
const t0 = Date.now();
const mark = (l, e) => console.log('[' + ((Date.now() - t0) / 1000).toFixed(1) + 's] ' + l + (e ? ' ' + e : ''));
setTimeout(() => { console.log('[WATCHDOG] 超时退出'); process.exit(9) }, Number(process.env.QC_WATCHDOG || 240000));

async function prepFn() {
  const pid = window.__qcArg;
  const T = (s) => (s || '').replace(/[\s\u00a0]+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tab = [...document.querySelectorAll('.aurora-qc-tabs-tab-btn')].find((x) => T(x.innerText) === '商品');
  if (tab) { tab.click(); await sleep(5000) }
  const ct = (w) => { const els = [...document.querySelectorAll('*')].filter((x) => x.children.length === 0 && T(x.innerText) === w && x.getBoundingClientRect().width > 0); if (!els.length) return 'miss'; els[els.length - 1].click(); return 'ok' };
  ct('计划视图'); await sleep(1500); ct('商品自选'); await sleep(5000);
  const inp = [...document.querySelectorAll('input')].find((x) => /回车搜索|计划名称|计划ID/.test(x.placeholder || ''));
  if (!inp) return JSON.stringify({ err: 'noinput', ph: [...document.querySelectorAll('input')].map((i) => i.placeholder).slice(0, 10) });
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, pid); inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  await sleep(8000);
  const rows = [...document.querySelectorAll('tbody tr')].map((r) => T(r.innerText)).filter((t) => t.indexOf('ID：') >= 0);
  const row = [...document.querySelectorAll('tbody tr')].find((r) => T(r.innerText).includes(pid));
  if (rows.length !== 1 || !row) return JSON.stringify({ err: 'notunique', n: rows.length });
  const name = T(rows[0]).split(' ID')[0];
  const nameEl = [...row.querySelectorAll('*')].find((e) => e.children.length === 0 && T(e.innerText) === name);
  if (!nameEl) return JSON.stringify({ err: 'noname', name });
  nameEl.click(); await sleep(4500);
  return JSON.stringify({ row: rows[0], name });
}

async function awemesFn() {
  const pid = window.__qcArg;
  const T = (s) => (s || '').replace(/[\s\u00a0]+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ct = (w) => { const els = [...document.querySelectorAll('div,span,li,a,button')].filter((x) => T(x.innerText) === w && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().y < 210); if (!els.length) return 'miss'; els[els.length - 1].click(); return 'ok' };
  const tabRes = ct('抖音号');
  await sleep(4000);
  const parse = () => {
    const out = [];
    const rows = [...document.querySelectorAll('tr')].filter((r) => {
      const t = r.innerText || '';
      if (!/编辑/.test(t) || !/删除/.test(t)) return false;
      if (/已删除/.test(t)) return false;
      if (t.indexOf('无抖音号') >= 0) return false;
      if (t.indexOf(pid) >= 0) return false;
      if (!/ID：/.test(t)) return false;
      return true;
    });
    for (const r of rows) {
      const t = T(r.innerText);
      const m = t.match(/^(.{1,40}?)\s*ID：([A-Za-z0-9_.\-]+)/);
      if (!m) continue;
      const name = m[1].trim();
      const id = m[2];
      const allIds = [...t.matchAll(/ID：([A-Za-z0-9_.\-]+)/g)].map((x) => x[1]);
      const prodId = allIds.find((x) => /^\d{15,}$/.test(x)) || '';
      const seg = t.indexOf('渠道品') >= 0 ? t.slice(t.indexOf('渠道品') + 3, t.indexOf('ID：' + prodId)) : '';
      out.push({ name, id, prodId, prodName: T(seg) });
    }
    return out;
  };
  let all = parse();
  const pagerItems = () => [...document.querySelectorAll('li.main-vmok-plugin-page-turner__item')].filter((e) => /^\d+$/.test(T(e.innerText)) && e.getBoundingClientRect().x > 1000);
  const pages = pagerItems().map((e) => T(e.innerText));
  for (const p of pages) {
    if (p === '1') continue;
    const li = pagerItems().find((e) => T(e.innerText) === p);
    if (!li) continue;
    li.click(); await sleep(2800);
    all = all.concat(parse());
  }
  const seen = new Map();
  for (const a of all) { if (!seen.has(a.id)) seen.set(a.id, a) }
  const list = [...seen.values()];
  const prod = {};
  for (const a of list) { if (a.prodId && !prod[a.prodId]) prod[a.prodId] = a.prodName }
  return JSON.stringify({ tabRes, pages, count: list.length, list, products: prod });
}

async function matFn() {
  const T = (s) => (s || '').replace(/[\s\u00a0]+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ct = (w) => { const els = [...document.querySelectorAll('div,span,li,a,button')].filter((x) => T(x.innerText) === w && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().y < 210); if (!els.length) return 'miss'; els[els.length - 1].click(); return 'ok' };
  ct('素材'); await sleep(3500);
  const t = T(document.body.innerText);
  const m = (t.match(/共\s*\d+\s*个视频/) || [])[0] || null;
  const i = t.indexOf('视频');
  return JSON.stringify({ mat: m, snip: i >= 0 ? t.slice(Math.max(0, i - 60), i + 60) : t.slice(0, 160) });
}

async function pageFor() {
  try {
    const pages = await listPages();
    const hit = pages.find((t) => t.type === 'page' && (t.url || '').indexOf('overall-prom') >= 0 && (t.url || '').indexOf(aavid) >= 0);
    if (hit) return await connect('overall-prom', { id: hit.id });
    const any = pages.find((t) => t.type === 'page' && (t.url || '').indexOf('jinritemai') >= 0);
    if (any) return await connect('jinritemai', { id: any.id });
  } catch (e) { mark('pageFor', String(e.message).slice(0, 60)) }
  throw new Error('没有可用的千川标签页');
}

const page = await pageFor();
await page.send('Page.navigate', { url: listUrl }, 20000);
mark('nav-done');
await sleep(3000);
const run = (fn, arg, timeout) => page.eval('window.__qcArg=' + JSON.stringify(arg) + ';(' + fn.toString() + ')()', timeout);

let prep = null;
for (let attempt = 1; attempt <= 2 && !prep; attempt++) {
  const r = JSON.parse(await run(prepFn, planId, 60000));
  mark('prep-' + attempt, JSON.stringify(r).slice(0, 160));
  if (r.err === 'notunique' && attempt === 1) { await sleep(3000); continue }
  if (r.err) throw new Error('列表阶段失败: ' + JSON.stringify(r));
  prep = r;
}
const row = prep.row;
const aw = JSON.parse(await run(awemesFn, planId, 120000));
mark('awemes', 'count=' + aw.count + ' pages=' + JSON.stringify(aw.pages) + ' products=' + JSON.stringify(aw.products).slice(0, 120));
const mat = JSON.parse(await run(matFn, 0, 60000));
mark('mat', JSON.stringify(mat));

const nums = (row.match(/综合营销ROI目标\s*([0-9.]+)/) || [])[1] || '';
const budget = (row.match(/每日预算\s*([0-9.]+)/) || [])[1] || '';
const stateM = row.match(/投放中|已暂停|已结束|审核中|未开始/);
const state = stateM ? stateM[0] : '';
const chip = (row.match(/(\d+)\s*抖音号/) || [])[1] || '';
const planName = prep.name || '';
let newName = planName;
if (/--\d{4}$/.test(planName)) newName = planName.replace(/--\d{4}$/, '--' + suffix);
else if (/--\d{4}/.test(planName)) newName = planName.replace(/--\d{4}(?!.*--\d{4})/, '--' + suffix);
else newName = planName + '--' + suffix;

const awemeNames = {};
const awemeIds = [];
for (const a of aw.list) { awemeIds.push(a.id); awemeNames[a.id] = a.name }
const prodIds = Object.keys(aw.products || {});
const params = {
  planName: newName,
  productId: prodIds.filter((x) => x.length >= 15)[0] || prodIds[0] || '',
  productName: prodIds.length ? aw.products[prodIds[0]] : '',
  awemeIds, awemeNames,
  roi: nums, budget,
  origin: { planId, planName, state, awemes: aw.count, chipAwemes: chip, materials: mat.mat },
  note: 'capture.mjs ' + new Date().toISOString()
};
fs.writeFileSync(outFile, JSON.stringify(params, null, 1));
mark('written', outFile);
console.log('SUMMARY ' + JSON.stringify({ planName, newName, roi: nums, budget, state, awemes: aw.count, chip, productId: params.productId, productName: params.productName, mat: mat.mat }));
process.exit(0);
