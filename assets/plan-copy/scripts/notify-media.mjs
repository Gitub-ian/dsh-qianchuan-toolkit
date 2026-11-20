import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const CFG = path.join(os.homedir(), '.qianchuan-cruise', 'notify.json');

export function loadChannels() {
  try { return JSON.parse(fs.readFileSync(CFG, 'utf8')).channels || [] } catch { return [] }
}

let tok = null;
async function qqToken(ch) {
  if (tok && tok.exp > Date.now() + 60000) return tok.v;
  const r = await fetch('https://bots.qq.com/app/getAppAccessToken', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: ch.appId, clientSecret: ch.clientSecret }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('QQ token 失败 ' + JSON.stringify(j).slice(0, 160));
  tok = { v: j.access_token, exp: Date.now() + (Number(j.expires_in || 7200) - 120) * 1000 };
  return tok.v;
}

async function qqPost(ch, p, body, auth) {
  const r = await fetch('https://api.sgroup.qq.com' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + auth }, body: JSON.stringify(body) });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t) } catch {}
  return { status: r.status, j, body: t.slice(0, 200) };
}

async function sendQQText(ch, text) {
  const a = await qqToken(ch);
  return qqPost(ch, '/v2/users/' + ch.openid + '/messages', { content: text, msg_type: 0 }, a);
}

async function sendQQImage(ch, file) {
  const a = await qqToken(ch);
  const b64 = fs.readFileSync(file).toString('base64');
  const up = await qqPost(ch, '/v2/users/' + ch.openid + '/files', { file_type: 1, file_data: b64, srv_send_msg: false }, a);
  const info = up.j && up.j.file_info;
  if (!info) return { ok: false, step: 'upload', status: up.status, body: up.body };
  const sent = await qqPost(ch, '/v2/users/' + ch.openid + '/messages', { content: '', msg_type: 7, media: { file_info: info } }, a);
  return { ok: sent.status === 200 || sent.status === 201, step: 'send', status: sent.status, body: sent.body };
}

async function sendWecomImage(ch, file) {
  const buf = fs.readFileSync(file);
  const body = { msgtype: 'image', image: { base64: buf.toString('base64'), md5: crypto.createHash('md5').update(buf).digest('hex') } };
  const r = await fetch(ch.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text();
  return { ok: /"errcode":0/.test(t), status: r.status, body: t.slice(0, 200) };
}

async function sendWecomText(ch, text) {
  const r = await fetch(ch.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'text', text: { content: text } }) });
  const t = await r.text();
  return { ok: /"errcode":0/.test(t), status: r.status, body: t.slice(0, 200) };
}

/** 把一张图 + 一段文字同时推到所有启用的渠道 */
export async function pushImage({ file, text, say = () => {} }) {
  const out = [];
  for (const ch of loadChannels()) {
    if (!ch.enabled) continue;
    try {
      if (ch.type === 'qq') {
        if (text) out.push({ ch: ch.name, part: 'text', ...(await sendQQText(ch, text)) });
        out.push({ ch: ch.name, part: 'image', ...(await sendQQImage(ch, file)) });
      } else if (ch.type === 'wecom') {
        if (text) out.push({ ch: ch.name, part: 'text', ...(await sendWecomText(ch, text)) });
        out.push({ ch: ch.name, part: 'image', ...(await sendWecomImage(ch, file)) });
      }
    } catch (e) { out.push({ ch: ch.name, ok: false, err: String(e.message).slice(0, 120) }) }
  }
  out.forEach(r => say('[notify] ' + JSON.stringify(r).slice(0, 150)));
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('notify-media.mjs')) {
  const file = process.argv[2];
  const text = process.argv[3] || '';
  const r = await pushImage({ file, text, say: (s) => console.log(s) });
  console.log('RESULT ' + JSON.stringify(r.map(x => ({ ch: x.ch, part: x.part, ok: x.ok, status: x.status, step: x.step }))));
}
