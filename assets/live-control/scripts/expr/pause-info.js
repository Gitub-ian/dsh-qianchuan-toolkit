(async () => {
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  // 「一键调速」组类名不稳定（.interfere-tool-wrapper / .assist-task / .assistTask-*），按组内文案定位
  const speedGroup = (td) => {
    if (!td) return null
    const gs = [...td.querySelectorAll('.interfere-tool-wrapper,[class*="assistTask"],[class*="assist-task"]')]
    const byText = gs.find((g) => /一键调速/.test(c(g.innerText)))
    if (byText) return byText
    return gs.find((g) => g.querySelector('iconpark-icon')) || null
  }
  const all = [...document.querySelectorAll('tbody tr')].filter((t) => t.querySelectorAll('td').length >= 7)
  let heads = [...document.querySelectorAll('th')].map((t) => c(t.innerText))
  if (!heads.includes('抖音号')) {
    const head = all.find((t) => [...t.querySelectorAll('td')].some((td) => c(td.innerText) === '抖音号'))
    heads = head ? [...head.querySelectorAll('td')].map((td) => c(td.innerText)) : []
  }
  const col = (name, dflt) => { const i = heads.findIndex((h) => h === name); return i >= 0 ? i : dflt }
  const iAweme = col('抖音号', 1), iTool = col('调控工具', 4)
  const isData = (t) => !/^共\d+条计划/.test(c(t.innerText)) && ![...t.querySelectorAll('td')].some((td) => c(td.innerText) === '抖音号')
  const want = '{{AWEME}}'
  const hit = all.filter(isData).find((t) => { const td = t.querySelectorAll('td'); return td[iAweme] && c(td[iAweme].innerText).includes(want) })
  if (!hit) return JSON.stringify({ ok: false, reason: 'NO_ROW' })
  const toolCell = hit.querySelectorAll('td')[iTool]
  const g = speedGroup(toolCell)
  if (!g) return JSON.stringify({ ok: false, anomaly: true, reason: 'NO_SPEED_GROUP（页面里找不到「一键调速」组，疑似改版）' })
  const pause = g.querySelector('iconpark-icon[name="iconPauseFilled"]')
  if (!pause) return JSON.stringify({ ok: false, anomaly: true, reason: 'NO_PAUSE（行上显示控量中，但组里没有 ⏸ 图标，前后矛盾）' })
  pause.click()
  let modal = null
  const t0 = Date.now()
  while (Date.now() - t0 < 8000) {
    modal = [...document.querySelectorAll('.ovui-modal')].find((e) => /停止控量/.test(c(e.innerText)))
    if (modal) break
    await wait(150)
  }
  if (!modal) return JSON.stringify({ ok: false, reason: 'DIALOG_NOT_FOUND' })
  const text = c(modal.innerText)
  const m = text.match(/控量时间\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*~\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/)
  const bud = (text.match(/控量预算\s*([\d.]+)\s*元/) || [])[1] || null
  const toMs = (s) => { const t = s.replace(/\s+/, 'T'); const d = new Date(t); return isNaN(d.getTime()) ? null : d.getTime() }
  const startText = m ? m[1] : null
  const endText = m ? m[2] : null
  // 只读：读完立刻用右上角 X 关掉，绝不点「确定」（那是终止控量）
  const x = modal.querySelector('.ovui-modal__close-icon') || modal.querySelector('[class*=close]')
  if (x) x.click()
  await wait(300)
  const stillOpen = [...document.querySelectorAll('.ovui-modal')].some((e) => /停止控量/.test(c(e.innerText)))
  if (stillOpen && x) { x.click(); await wait(300) }
  return JSON.stringify({ ok: !!m, startText, endText, budget: bud, startAt: startText ? toMs(startText) : null, endAt: endText ? toMs(endText) : null, closed: ![...document.querySelectorAll('.ovui-modal')].some((e) => /停止控量/.test(c(e.innerText))), text: text.slice(0, 200) })
})()