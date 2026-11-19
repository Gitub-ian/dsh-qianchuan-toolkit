(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const shown = (e) => { const b = e.getBoundingClientRect(); return b.width > 100 && b.height > 100 && getComputedStyle(e).display !== 'none' }
  const toast = [...document.querySelectorAll('[class*=message], [class*=toast], [class*=notice]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => clean(e.innerText)).filter((s) => s && s.length < 40)
  const dlg = [...document.querySelectorAll('.ovui-modal, [role=dialog], [class*=drawer]')].filter((d) => shown(d) && clean(d.innerText).includes('调控方式'))[0]
  return JSON.stringify({ toast: [...new Set(toast)].slice(0, 4), dialogGone: !dlg })
})()