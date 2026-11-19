(async () => {
  const pad = (n) => String(n).padStart(2, '0')
  const now = new Date()
  const day = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
  const end = day + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':59'
  const body = {
    Dimensions: ['stat_time_hour', 'ad_id'],
    StartTime: day + ' 00:00:00',
    EndTime: end,
    OrderBy: [{ Type: 1, Field: 'stat_time_hour' }],
    DataSetKey: 'site_promotion_post_overview',
    Metrics: ['stat_cost', 'total_prepay_and_pay_settle_roi2_1h', 'total_order_settle_amount_for_roi2_1h', 'total_order_settle_count_for_roi2_1h'],
    Filters: { ConditionRelationshipType: 1, Conditions: [
      { Field: 'advertiser_id', Operator: 7, Values: ['{{ADV}}'] },
      { Field: 'pricing_category', Operator: 7, Values: ['2'] },
      { Field: 'marketing_goal', Operator: 7, Values: ['2'] },
      { Field: 'ecp_app_id', Operator: 7, Values: ['1'] },
      { Field: 'campaign_type', Operator: 7, Values: ['1'] },
      { Field: 'adlab_mode', Operator: 7, Values: ['1'] }] },
    refer: '', FilterParams: {}
  }
  const t0 = Date.now()
  const r = await fetch('/ad/api/data/v1/common/statQuery?aavid={{ADV}}', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body)
  })
  const j = await r.json()
  const rows = (((j.data || {}).StatsData || {}).Rows) || []
  const out = rows.map((x) => {
    const m = x.Metrics
    return {
      adId: x.Dimensions.ad_id.Value,
      hour: x.Dimensions.stat_time_hour.ValueStr,
      cost: m.stat_cost.Value,
      gmv: m.total_order_settle_amount_for_roi2_1h.Value,
      orders: m.total_order_settle_count_for_roi2_1h.Value,
      roi: m.total_prepay_and_pay_settle_roi2_1h.Value
    }
  })
  return JSON.stringify({ day, hour: pad(now.getHours()), now: now.toISOString(), ms: Date.now() - t0, code: j.code, rows: out })
})()