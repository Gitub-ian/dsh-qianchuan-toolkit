(() => {
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const shown = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 100 && b.height > 100 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  return [...document.querySelectorAll('.ovui-modal, [role=dialog]')].some((d) => shown(d) && c(d.innerText).includes('调控方式'))
})()