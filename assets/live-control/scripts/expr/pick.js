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
  // 「一键调速」组类名不稳定（.interfere-tool-wrapper / .assist-task / .assistTask-*），按组内文案定位
  const speedGroup = (td) => {
    if (!td) return null
    const gs = [...td.querySelectorAll('.interfere-tool-wrapper,[class*="assistTask"],[class*="assist-task"]')]
    const byText = gs.find((g) => /一键调速/.test(c(g.innerText)))
    if (byText) return byText
    // 绝不退回「第一个含图标的组」：素材/人群追投组里也有 iconpark-icon（含 ⏸），
    // 退回去会把「素材追投暂停」当成「控量中」，点它还弹不出控量弹窗（2026-11-20 11:15 事故根因）
    const byCls = td.querySelector('.interfere-tool-wrapper')
    if (byCls && !/素材|人群|搜索/.test(c(byCls.innerText))) return byCls
    return null
  }
  const want = '{{AWEME}}'
  const hits = dataRows.filter((t) => { const td = t.querySelectorAll('td'); return td[iAweme] && c(td[iAweme].innerText).includes(want) })
  if (!hits.length) return JSON.stringify({ err: 'NO_ROW' })
  if (hits.length > 1) return JSON.stringify({ err: 'MULTI_ROW', n: hits.length })
  const tds = hits[0].querySelectorAll('td')
  const status = c(tds[iStatus].innerText)
  const toolCell = tds[iTool]
  // 必须取「一键调速」那一组，否则会落到「素材/人群追投」组去点加号，弹出的是另一套弹窗。
  const g0 = speedGroup(toolCell)
  const plus = g0 ? g0.querySelector('iconpark-icon[name="oc-icon-plus"]') : null
  const pauseIcon = g0 ? g0.querySelector('iconpark-icon[name="iconPauseFilled"]') : null
  const box = g0 ? g0.getBoundingClientRect() : null
  return JSON.stringify({
    ok: true,
    nick: c(tds[iAweme].innerText).slice(0, 20),
    status,
    live: /投放中/.test(status) && !/未开播/.test(status),
    hasPlus: !!plus,
    plusDisabled: !!(plus && DISABLED.test(plus.className || '')),
    hasPause: !!pauseIcon,
    mode: pauseIcon ? 'pause' : plus ? 'plus' : 'none',
    group: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null,
    groups: groupsOf(toolCell).map(labelOf),
  })
})()
