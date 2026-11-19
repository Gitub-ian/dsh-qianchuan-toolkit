(() => {
  // 关掉与控量无关的弹窗（推广/升级/引导）。绝不碰含「调控方式」的业务弹窗。
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const vis = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 20 && b.height > 20 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' }
  const visSmall = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width >= 6 && b.height >= 6 && cs.display !== 'none' && cs.visibility !== 'hidden' }
  const BUSINESS = /调控方式|一键控量|控量预算/
  const overlays = [...document.querySelectorAll('.ovui-modal,[role=dialog],[class*="modal"],[class*="dialog"]')]
    .filter((e) => vis(e) && e.getBoundingClientRect().width > 200 && e.getBoundingClientRect().height > 120)
    .filter((e, i, a) => a.indexOf(e) === i)
    .filter((e) => !BUSINESS.test(c(e.innerText)))
  const result = { closed: [], remaining: [], mask: 0, tried: 0 }
  for (const ov of overlays) {
    const title = c(ov.innerText).slice(0, 40)
    if (!title) continue
    result.tried++
    const cands = [
      ...ov.querySelectorAll('[class*="close"],[class*="Close"],[aria-label*="close"],[aria-label*="关闭"]'),
      ...ov.querySelectorAll('iconpark-icon'),
    ].filter((x) => visSmall(x) && x.getBoundingClientRect().width < 120)
    const iconClose = cands.find((x) => /close/i.test((x.getAttribute('name') || '') + ' ' + (x.className || '')))
    const btn = iconClose || cands.find((x) => ['×', '✕', 'x', 'X', '关闭'].includes(c(x.innerText)))
    if (btn) { btn.click(); result.closed.push(title) } else result.remaining.push(title)
  }
  result.mask = [...document.querySelectorAll('.ovui-popup__mask,[class*="mask"]')].filter(vis).length
  const still = [...document.querySelectorAll('.ovui-modal,[role=dialog]')].filter((e) => vis(e) && c(e.innerText).length > 10 && !BUSINESS.test(c(e.innerText)))
  result.stillOpen = still.length
  // 只剩遮罩、没有任何可见弹窗时，把遮罩藏掉，否则全屏遮罩会吞掉后面的点击
  const anyDlg = [...document.querySelectorAll('.ovui-modal,[role=dialog]')].filter((e) => vis(e) && c(e.innerText).length > 10)
  if (!anyDlg.length) {
    let cleared = 0
    for (const m of [...document.querySelectorAll('.ovui-popup__mask')]) { if (vis(m)) { m.style.display = 'none'; cleared++ } }
    result.maskCleared = cleared
  }
  return JSON.stringify(result)
})()
