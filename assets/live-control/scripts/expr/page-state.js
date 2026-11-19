(() => {
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const vis = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 20 && b.height > 20 && cs.display !== 'none' && cs.visibility !== 'hidden' }
  const overlays = [...document.querySelectorAll('.ovui-modal,[role=dialog]')].filter(vis).map((e) => c(e.innerText).slice(0, 36))
  return JSON.stringify({
    readyState: document.readyState,
    hasBody: !!document.body,
    url: location.href.slice(0, 80),
    overlays,
    spins: [...document.querySelectorAll('.ovui-spin-spinning,[class*="spin-dot"]')].filter(vis).length,
    mask: [...document.querySelectorAll('.ovui-popup__mask')].filter(vis).length
  })
})()
