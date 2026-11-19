(() => {
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const all = [...document.querySelectorAll('tbody tr')].filter((t) => t.querySelectorAll('td').length >= 7)
  // 表头两种形态：全域投放是真 <th>；乘方把 thead 克隆成了 tbody 里的一行 tr
  let heads = [...document.querySelectorAll('th')].map((t) => c(t.innerText))
  if (!heads.includes('抖音号')) {
    const head = all.find((t) => [...t.querySelectorAll('td')].some((td) => c(td.innerText) === '抖音号'))
    heads = head ? [...head.querySelectorAll('td')].map((td) => c(td.innerText)) : []
  }
  const col = (name, dflt) => { const i = heads.findIndex((h) => h === name); return i >= 0 ? i : dflt }
  const iAweme = col('抖音号', 1), iStatus = col('投放状态', 2), iTool = col('调控工具', 4)
  const isData = (t) => !/^共\d+条计划/.test(c(t.innerText)) && ![...t.querySelectorAll('td')].some((td) => c(td.innerText) === '抖音号')
  const dataRows = all.filter(isData)
  const groupsOf = (td) => [...(td ? td.querySelectorAll('[class*="assistTask"],[class*="assist-task"]') : [])]
  const labelOf = (g) => c((g.querySelector('[class*="taskLabel"],.title') || g).innerText).slice(0, 20)
  const rows = dataRows.map((t) => {
    const td = t.querySelectorAll('td')
    const toolCell = td[iTool]
    const icons = [...(toolCell ? toolCell.querySelectorAll('iconpark-icon') : [])]
    const names = icons.map((i) => i.getAttribute('name') || '')
    const text = c(t.innerText)
    return {
      aweme: c(td[iAweme] && td[iAweme].innerText).slice(0, 26),
      status: c(td[iStatus] && td[iStatus].innerText).slice(0, 26),
      // 「已暂停」行常附带「有效投放中」这类诊断字样，必须用否定词兜住，否则会把暂停行当成在投
      live: (() => { const s = c(td[iStatus] && td[iStatus].innerText); return /投放中/.test(s) && !/已暂停|未开播|审核中|预算不足|已结束/.test(s) })(),
      hasPause: names.includes('iconPauseFilled'),
      hasPlus: names.includes('oc-icon-plus'),
      tools: groupsOf(toolCell).map(labelOf),
      budget: (text.match(/每日预算\s*([\d.,]+)\s*元/) || [])[1] || null,
      roiTarget: (text.match(/(?:ROI目标|综合营销ROI目标)\s*([\d.]+)/) || [])[1] || null,
    }
  })
  const iconsReady = dataRows.length > 0 && dataRows.every((t) => { const td = t.querySelectorAll('td'); return td[iTool] && td[iTool].querySelectorAll('iconpark-icon').length > 0 })
  return JSON.stringify({
    url: location.href.slice(0, 90),
    hasAwemeCol: heads.includes('抖音号'),
    cols: heads.slice(0, 10),
    layout: heads.includes('营销服务') ? 'square' : 'uni-prom',
    iconsReady,
    rows,
  })
})()
