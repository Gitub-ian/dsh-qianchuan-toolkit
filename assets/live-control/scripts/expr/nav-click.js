(() => {
  // 点顶部产品线导航（全域投放 / 乘方）。千川 SPA 用 URL 改路由不可靠，只能点导航。
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const want = '{{TEXT}}'
  const leaves = [...document.querySelectorAll('div,span,a')].filter((e) => e.children.length === 0 && c(e.innerText) === want)
  if (!leaves.length) return 'none'
  const el = leaves[0]
  const y = el.getBoundingClientRect().y
  if (!(y >= 0 && y < 80)) return 'not-nav'
  ;(el.closest('a') || el).click()
  return 'clicked'
})()
