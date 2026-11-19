(() => {
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const shown = (e) => { if (!e) return false; const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 50 && b.height > 50 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const d = [...document.querySelectorAll('.ovui-modal, [role=dialog]')].filter((x) => shown(x) && c(x.innerText).includes('调控方式'))[0]
  if (!d) return 'none'
  const b = [...d.querySelectorAll('button')].find((x) => c(x.innerText) === '取消')
  if (!b) return 'no-cancel'
  b.click()
  return 'canceled'
})()