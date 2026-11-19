/**
 * 通知：控量失败 / 异常 / 需要人工确认时，让不在电脑前的人也能收到。
 *
 * 设计成多通道：启用的通道全部尝试（不再"首个成功即停"），任一成功即视为已送达：
 *   file      只落本地 notifications.jsonl（永远执行，兜底）
 *   webhook   通用 HTTP：wecom 企业微信机器人 / feishu 飞书 / dingtalk 钉钉 /
 *             serverchan Server酱 / pushplus / bark(iOS) / json 自定义
 *   qq        QQ 官方机器人（AppID + ClientSecret + openid/group_openid）
 *   onebot    OneBot v11（NapCat / LLOneBot）：个人 QQ 登录，可发给任意 QQ 号/群
 * 失败重试 3 次（1s/3s/9s），仍失败写入 pending-notify.jsonl，下次启动补发。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

export const LEVEL = { info: 'info', warn: 'warn', error: 'error' }

const nowIso = () => new Date().toISOString()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function loadNotifyConfig(dir) {
  const p = path.join(dir, 'notify.json')
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return { channels: [] } }
}

function payloadFor(type, title, text) {
  switch (type) {
    case 'wecom': return { msgtype: 'text', text: { content: title + '\n' + text } }
    case 'feishu': return { msg_type: 'text', content: { text: title + '\n' + text } }
    case 'dingtalk': return { msgtype: 'text', text: { content: title + '\n' + text } }
    case 'serverchan': return { title, desp: text }
    case 'pushplus': return { title, content: text.replace(/\n/g, '<br/>'), template: 'html' }
    case 'bark': return { title, body: text }
    default: return { title, text, level: LEVEL.info }
  }
}

async function postJson(url, body, headers) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body) })
  const txt = await res.text().catch(() => '')
  return { ok: res.ok, status: res.status, body: txt.slice(0, 300) }
}

async function sendWebhook(ch, title, text) {
  const type = ch.type || 'json'
  if (type === 'serverchan') {
    const u = ch.url.includes('?') ? ch.url + '&title=' + encodeURIComponent(title) : ch.url + '?title=' + encodeURIComponent(title)
    const res = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'desp=' + encodeURIComponent(text) })
    return { ok: res.ok, status: res.status, body: (await res.text().catch(() => '')).slice(0, 200) }
  }
  return postJson(ch.url, payloadFor(type, title, text), ch.headers)
}

let qqToken = null // { token, expireAt }

async function qqAccessToken(ch) {
  if (qqToken && qqToken.expireAt > Date.now() + 60_000) return qqToken.token
  const res = await fetch('https://bots.qq.com/app/getAppAccessToken', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: ch.appId, clientSecret: ch.clientSecret }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error('QQ 获取 token 失败: ' + JSON.stringify(j).slice(0, 200))
  qqToken = { token: j.access_token, expireAt: Date.now() + (Number(j.expires_in || 7200) - 120) * 1000 }
  return qqToken.token
}

/** OneBot v11（NapCat / LLOneBot / go-cqhttp）：用个人 QQ 登录，可发给任意 QQ 号或群 */
async function sendOneBot(ch, title, text) {
  const base = (ch.url || 'http://127.0.0.1:3000').replace(/\/+$/, '')
  const msg = title + '\n' + text
  const isGroup = !!ch.groupId
  const endpoint = isGroup ? '/send_group_msg' : '/send_private_msg'
  const body = isGroup ? { group_id: Number(ch.groupId), message: msg, auto_escape: true } : { user_id: Number(ch.qq), message: msg, auto_escape: true }
  const res = await fetch(base + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ch.token ? { Authorization: 'Bearer ' + ch.token } : {}) },
    body: JSON.stringify(body),
  })
  const txt = await res.text().catch(() => '')
  let ok = res.ok
  try { const j = JSON.parse(txt); if (j && j.status === 'failed') ok = false } catch (e) {}
  return { ok, status: res.status, body: txt.slice(0, 300) }
}

async function sendQQ(ch, title, text) {
  const token = await qqAccessToken(ch)
  const base = ch.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'
  const target = ch.groupOpenid
    ? base + '/v2/groups/' + ch.groupOpenid + '/messages'
    : base + '/v2/users/' + ch.openid + '/messages'
  const res = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + token },
    body: JSON.stringify({ content: (title + '\n' + text).slice(0, 1900), msg_type: 0, msg_id: ch.msgId || undefined }),
  })
  return { ok: res.ok, status: res.status, body: (await res.text().catch(() => '')).slice(0, 300) }
}

/** 送达一条通知。任何通道都失败也不抛错（控量流程不能因为通知挂掉）。 */
export async function notify({ dir, title, text, level = 'info', event = 'event', targets = [], say = () => {} }) {
  const cfg = loadNotifyConfig(dir)
  const rec = { ts: nowIso(), event, level, title, text, targets }
  try { fs.appendFileSync(path.join(dir, 'notifications.jsonl'), JSON.stringify(rec) + '\n') } catch (e) {}
  const channels = (cfg.channels || []).filter((c) => c.enabled !== false && c.type !== 'file')
  if (!channels.length) { say('未配置通知通道（notify.json 缺失或无启用项），本轮只落本地 notifications.jsonl'); return { delivered: false, tried: [] } }
  const tried = []
  // 所有启用的通道都发一遍：配了 QQ + 企业微信就两边都收到；只有一个成功也算送达
  for (const ch of channels) {
    let r = null
    for (let i = 0; i < 2; i++) {
      try {
        r = ch.type === 'qq' ? await sendQQ(ch, title, text)
          : ch.type === 'onebot' ? await sendOneBot(ch, title, text)
          : await sendWebhook(ch, title, text)
      } catch (e) { r = { ok: false, status: 0, body: e.message } }
      if (r.ok) break
      await sleep([1000, 3000][i] || 3000)
    }
    tried.push({ name: ch.name || ch.type, ok: !!(r && r.ok), status: r && r.status, body: r && r.body })
    say((r && r.ok ? '已送达 ' : '发送失败 ') + (ch.name || ch.type) + (r && !r.ok ? '：' + String(r.body || '').slice(0, 120) : ''))
  }
  const delivered = tried.some((t) => t.ok)
  if (!delivered) {
    try { fs.appendFileSync(path.join(dir, 'pending-notify.jsonl'), JSON.stringify({ ...rec, tried }) + '\n') } catch (e) {}
    say('通知全部通道失败，已排队等补发')
  }
  return { delivered, tried }
}

// ---- CLI：给自己发一条测试通知（用户可选功能的自检入口）----
//   node notify.mjs --test                      用默认数据目录 ~/.qianchuan-cruise/notify.json
//   node notify.mjs --test --dir <QC_HOME>
//   node notify.mjs --title '标题' --text '内容'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
  const dir = arg('dir', path.join(os.homedir(), '.qianchuan-cruise'))
  const isTest = argv.includes('--test')
  const title = arg('title', isTest ? '千川控量·通知测试' : '千川控量')
  const text = arg('text', isTest ? '这是一条测试消息：收到说明通知通道配置正确。' : '')
  const r = await notify({ dir, title, text, level: 'info', event: isTest ? 'test' : 'manual', say: (m) => console.log('·', m) })
  console.log(JSON.stringify({ dir, delivered: r.delivered, tried: r.tried.map((t) => ({ name: t.name, ok: t.ok, status: t.status })) }, null, 1))
  process.exit(r.delivered ? 0 : 1)
}
