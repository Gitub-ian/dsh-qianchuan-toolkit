(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const shown = (e) => { const b = e.getBoundingClientRect(); return b.width > 100 && b.height > 100 && getComputedStyle(e).display !== 'none' }
  const visIn = (e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none'
  const hit = (e) => { const b = e.getBoundingClientRect(); if (!b.width) return false; const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!t && (t === e || e.contains(t)) }
  const radioOf = (d) => [...d.querySelectorAll('[class*=radio-item]')].filter((r) => clean(r.innerText) === '一键控量')[0] || null
  const cands = [...document.querySelectorAll('.ovui-modal')].filter((d) => shown(d) && clean(d.innerText).includes('调控方式'))
  const dlg = cands.filter((d) => { const k = radioOf(d); return k && hit(k) })[0] || cands.filter((d) => radioOf(d) && visIn(radioOf(d)))[0]
  if (!dlg) return JSON.stringify({ err: 'NO_DIALOG', cands: cands.length })
  const kong = radioOf(dlg)
  if (!kong) return JSON.stringify({ err: 'NO_KONG_RADIO' })
  if (/disabled/.test(String(kong.className))) return JSON.stringify({ err: 'KONG_DISABLED', cls: String(kong.className) })
  kong.click()
  const setInput = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    el.focus()
    setter.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.blur()
  }
  const nums = [...dlg.querySelectorAll('input')].filter((i) => visIn(i) && !/任务名称|ROI/.test(i.placeholder || ''))
  if (nums.length < 2) return JSON.stringify({ err: 'NO_INPUTS', n: nums.length, ph: nums.map((i) => i.placeholder) })
  setInput(nums[0], '{{BUDGET}}')
  setInput(nums[1], '{{HOURS}}')
  const text = clean(dlg.innerText)
  const foot = dlg.querySelector('.ovui-modal__footer')
  const btns = (foot ? [...foot.querySelectorAll('button')] : [...dlg.querySelectorAll('button')]).filter(visIn)
  const submit = btns.filter((b) => clean(b.innerText) === '提交').reverse().find(hit) || btns.filter((b) => clean(b.innerText) === '提交')[0] || null
  const r = submit ? submit.getBoundingClientRect() : null
  const nameEl = [...dlg.querySelectorAll('input')].filter((i) => /任务名称/.test(i.placeholder || ''))[0]
  return JSON.stringify({
    okMode: text.includes('调控预算') && text.includes('调控时长'),
    mode: text.includes('调控预算') ? '一键控量' : '一键起量',
    budget: nums[0].value,
    hours: nums[1].value,
    name: nameEl ? nameEl.value : '(自动生成)',
    dlgRect: (() => { const b = dlg.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] })(),
    submitHit: submit ? hit(submit) : false,
    submit: r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null,
    tip: text.includes('3～5分钟生效')
  })
})()