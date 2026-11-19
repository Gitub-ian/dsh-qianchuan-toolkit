(() => {
  // 切到「推直播间」tab：千川这个 tab 只有最内层 span.tab-label 的 click 有效
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  if ([...document.querySelectorAll('th')].some((th) => c(th.innerText) === '抖音号')) return 'already'
  const all = [...document.querySelectorAll('span,div')].filter((e) => c(e.innerText) === '推直播间')
  if (!all.length) return 'none'
  const leaf = all.filter((e) => e.children.length === 0)
  const label = leaf.find((e) => /tab-label/.test(String(e.className || ''))) || leaf[0] || all[0]
  label.click()
  return 'clicked'
})()
