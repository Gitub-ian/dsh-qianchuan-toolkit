(() => {
  const t = document.body.innerText
  const m = t.match(/计划ID[：:]\s*(\d+)/)
  if (!m) return ''
  const sid = t.match(/抖音号ID[：:]\s*([A-Za-z0-9_.-]+)/)
  const nm = t.match(/抖音号[：:]\s*([^\s]{1,24})/)
  return JSON.stringify({ adId: m[1], uniqueId: sid ? sid[1] : '', name: nm ? nm[1] : '' })
})()