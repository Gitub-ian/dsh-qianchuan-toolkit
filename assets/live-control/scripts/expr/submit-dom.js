(() => {
  // 提交按钮：优先 DOM 点击，不依赖坐标（弹窗选定「一键控量」后会重新排版，坐标会漂）
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const shown = (e) => { const b = e.getBoundingClientRect(); return b.width > 100 && b.height > 100 && getComputedStyle(e).display !== 'none' }
  const dlg = [...document.querySelectorAll('.ovui-modal')].filter((d) => shown(d) && c(d.innerText).includes('调控方式')).pop()
  if (!dlg) return JSON.stringify({ ok: false, reason: 'NO_DIALOG' })
  const btns = [...dlg.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0)
  const submit = btns.filter((b) => c(b.innerText) === '提交').pop()
  if (!submit) return JSON.stringify({ ok: false, reason: 'NO_BTN', btns: btns.map((b) => c(b.innerText)) })
  if (submit.disabled || /disabled/.test(String(submit.className))) return JSON.stringify({ ok: false, reason: 'BTN_DISABLED' })
  const r = submit.getBoundingClientRect()
  submit.click()
  return JSON.stringify({ ok: true, clicked: 'dom', x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: c(submit.innerText) })
})()