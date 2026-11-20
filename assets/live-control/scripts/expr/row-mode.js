(() => {
  // 只看一行「一键调速」组的图标：plus=可创建 / pause=控量中 / unknown=找不到组
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const all = [...document.querySelectorAll('tbody tr')].filter((t) => t.querySelectorAll('td').length >= 7)
  let heads = [...document.querySelectorAll('th')].map((t) => c(t.innerText))
  if (!heads.includes('抖音号')) {
    const head = all.find((t) => [...t.querySelectorAll('td')].some((td) => c(td.innerText) === '抖音号'))
    heads = head ? [...head.querySelectorAll('td')].map((td) => c(td.innerText)) : []
  }
  const col = (name, dflt) => { const i = heads.findIndex((h) => h === name); return i >= 0 ? i : dflt }
  const iAweme = col('抖音号', 1), iTool = col('调控工具', 4)
  const want = '{{AWEME}}'
  const hit = all.find((t) => { const td = t.querySelectorAll('td'); return td[iAweme] && c(td[iAweme].innerText).includes(want) })
  if (!hit) return JSON.stringify({ mode: 'norow' })
  const cell = hit.querySelectorAll('td')[iTool]
  const gs = cell ? [...cell.querySelectorAll('.interfere-tool-wrapper,[class*="assistTask"],[class*="assist-task"]')] : []
  const g = gs.find((x) => /一键调速/.test(c(x.innerText))) || gs.find((x) => x.querySelector('iconpark-icon')) || null
  const icons = g ? [...g.querySelectorAll('iconpark-icon')].map((i) => i.getAttribute('name')) : []
  const mode = !g ? 'unknown' : icons.includes('iconPauseFilled') ? 'pause' : icons.includes('oc-icon-plus') ? 'plus' : 'none'
  return JSON.stringify({ mode, icons })
})()