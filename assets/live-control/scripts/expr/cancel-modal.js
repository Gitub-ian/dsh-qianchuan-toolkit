(() => {
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const m = [...document.querySelectorAll('.ovui-modal,[role=dialog]')].pop()
  if (!m) return 'none'
  const b = [...m.querySelectorAll('button')].find((x) => c(x.innerText) === '取消')
  if (!b) return 'no-cancel'
  b.click()
  return 'canceled'
})()
