(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const tab = [...document.querySelectorAll('div,span,a,li')].filter((e) => e.children.length === 0 && clean(e.innerText) === '日志')[0]
  if (!tab) return JSON.stringify({ err: 'NO_LOG_TAB' })
  tab.click()
  for (let i = 0; i < 40; i++) {
    await sleep(100)
    const trs = [...document.querySelectorAll('tbody tr')].filter((t) => t.querySelectorAll('td').length >= 4)
    if (trs.length && document.body.innerText.includes('操作时间')) {
      const rows = trs.slice(0, 8).map((t) => {
        const td = [...t.querySelectorAll('td')].map((x) => clean(x.innerText))
        return { time: td[0], type: td[1], content: td[2], operator: td[3] || '' }
      })
      return JSON.stringify({ url: location.href.slice(0, 120), rows })
    }
  }
  return JSON.stringify({ err: 'NO_LOG_ROWS' })
})()