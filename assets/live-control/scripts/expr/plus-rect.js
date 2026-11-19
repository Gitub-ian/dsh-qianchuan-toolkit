(() => {
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const all = [...document.querySelectorAll('tbody tr')].filter((t) => t.querySelectorAll('td').length >= 7)
  const head = all.find((t) => [...t.querySelectorAll('td')].some((td) => c(td.innerText) === '抖音号'))
  const heads = head ? [...head.querySelectorAll('td')].map((td) => c(td.innerText)) : []
  const col = (name, dflt) => { const i = heads.findIndex((h) => h === name); return i >= 0 ? i : dflt }
  const iAweme = col('抖音号', 1), iStatus = col('投放状态', 2), iTool = col('调控工具', 4)
  const isData = (t) => t !== head && !/^共\d+条计划/.test(c(t.innerText))
  const dataRows = all.filter(isData)
  const groupsOf = (td) => [...(td ? td.querySelectorAll('[class*="assistTask"],[class*="assist-task"]') : [])]
  const labelOf = (g) => c((g.querySelector('[class*="taskLabel"],.title') || g).innerText).slice(0, 20)
  const DISABLED = /icon-not-allowed|actionIconDisabled/
  const want = '{{AWEME}}'
  const hit = dataRows.filter((t) => { const td = t.querySelectorAll('td'); return td[iAweme] && c(td[iAweme].innerText).includes(want) })[0]
  if (!hit) return 'null'
  const groups = groupsOf(hit.querySelectorAll('td')[iTool])
  const g0 = groups.find((g) => labelOf(g).startsWith('一键调速')) || groups[0]
  const p = g0 && g0.querySelector('iconpark-icon[name="oc-icon-plus"]')
  if (!p) return 'null'
  const b = p.getBoundingClientRect()
  return JSON.stringify({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), w: Math.round(b.width) })
})()
