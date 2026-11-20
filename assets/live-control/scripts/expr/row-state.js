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
  // 「一键调速」组的类名在不同状态下会变（.interfere-tool-wrapper / .assist-task / .assistTask-*），
  // 所以按组内文案「一键调速」定位，最后才退回「第一个含图标的组」。
  //   组里只有 oc-icon-plus(+) → 此刻没有控量任务，可以创建；
  //   组里是 iconPauseFilled(⏸) → 正在控量，点它会弹「确定要停止控量吗？控量时间 起 ~ 止」。
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
  const rows = dataRows.map((t) => {
    const td = t.querySelectorAll('td')
    const toolCell = td[iTool]
    const icons = [...(toolCell ? toolCell.querySelectorAll('iconpark-icon') : [])]
    const names = icons.map((i) => i.getAttribute('name') || '')
    const sp = speedGroup(toolCell)
    const spIcons = sp ? [...sp.querySelectorAll('iconpark-icon')] : []
    const spNames = spIcons.map((i) => i.getAttribute('name') || '')
    const pauseIcon = spIcons.find((i) => i.getAttribute('name') === 'iconPauseFilled') || null
    const plusIcon = spIcons.find((i) => i.getAttribute('name') === 'oc-icon-plus') || null
    const hasPause = !!pauseIcon
    const hasPlus = !!plusIcon
    const plusDisabled = !!(plusIcon && /icon-not-allowed|actionIconDisabled/.test(plusIcon.className || ''))
    const text = c(t.innerText)
    return {
      aweme: c(td[iAweme] && td[iAweme].innerText).slice(0, 26),
      status: c(td[iStatus] && td[iStatus].innerText).slice(0, 26),
      // 「已暂停」行常附带「有效投放中」这类诊断字样，必须用否定词兜住，否则会把暂停行当成在投
      live: (() => { const s = c(td[iStatus] && td[iStatus].innerText); return /投放中/.test(s) && !/已暂停|未开播|审核中|预算不足|已结束/.test(s) })(),
      hasPause,
      hasPlus,
      plusDisabled,
      speedIcons: spNames,
      // unknown = 连「一键调速」组都找不到（页面改版/未加载完），是异常，绝不能当「控量中」
      mode: !sp ? 'unknown' : hasPause ? 'pause' : hasPlus ? 'plus' : 'none',
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
