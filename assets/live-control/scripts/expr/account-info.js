(() => {
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const box = document.querySelector('.account-info-box, [class*="account-info"]')
  const bodyText = document.body ? document.body.innerText : ''
  const t = box ? c(box.innerText) : c(bodyText).slice(0, 400)
  const id = (t.match(/ID[:：]\s*(\d{16,20})/) || [])[1] || null
  const bodyIds = [...new Set((bodyText.match(/ID：(\d{16,20})/g) || []).map((x) => x.replace(/\D/g, '')))]
  return JSON.stringify({ id, label: t.slice(0, 60), bodyIds: bodyIds.slice(0, 4), url: location.href.slice(0, 90) })
})()
