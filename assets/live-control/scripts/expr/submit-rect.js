(() => {
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const shown = (e) => { const b = e.getBoundingClientRect(); return b.width > 100 && b.height > 100 && getComputedStyle(e).display !== 'none' }
  const dlg = [...document.querySelectorAll('.ovui-modal')].filter((d) => shown(d) && c(d.innerText).includes('调控方式')).pop()
  if (!dlg) return 'null'
  const foot = dlg.querySelector('.ovui-modal__footer')
  const btns = foot ? [...foot.querySelectorAll('button')] : [...dlg.querySelectorAll('button')]
  const live = btns.filter((b) => b.getBoundingClientRect().width > 0)
  const submit = live.filter((b) => c(b.innerText) === '提交').pop()
  if (!submit) return 'null'
  const r = submit.getBoundingClientRect()
  return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), label: c(submit.innerText) })
})()