import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 读 expr/<name> 并按 {{KEY}} 替换占位符。 */
export function expr(name, subs) {
  let src = fs.readFileSync(path.join(HERE, 'expr', name), 'utf8')
  for (const [k, v] of Object.entries(subs || {})) src = src.split(k).join(String(v))
  return src
}
