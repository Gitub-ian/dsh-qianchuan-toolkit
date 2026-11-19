/**
 * `dsh-qianchuan-toolkit` — 一个包里带两个千川技能：
 *
 *   · qianchuan-live-control  盯盘 + 一键控量（assets/live-control/）
 *   · qianchuan-plan-copy     乘方计划复制（assets/plan-copy/）
 *
 * 两个技能各自资源自足：SKILL.md、scripts/、references/ 都在自己的子目录里，
 * 脚本只依赖 Node 18+ 内置模块，不共享文件，单独拷走也能跑。
 *
 * @module dsh-qianchuan-toolkit
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// 内置技能档位的 rank；不 import @deepseek-ai/dsh-skill —— 该包不在 profile 的
// node_modules 里，从本地目录安装时会 ERR_MODULE_NOT_FOUND。
const BUNDLED_SKILL_RANK = 600

const INVOCATION = { modelInvocable: true, userInvocable: true }

const SKILLS = [
  {
    dir: '../assets/live-control/',
    name: 'qianchuan-live-control',
    description: "巨量千川直播计划盯盘与自动控量：按「账号 × 抖音号」盯盘，在自然小时的 :15/:30/:45/:55 读分时数据，当前小时净成交 ROI 低于阈值（默认 2.40）且已有消耗时，对该抖音号提交「一键控量」（默认预算 200 元、时长 0.5 小时，平台固定）。支持多账号多标签页、全域投放与乘方两条产品线、同名抖音号跨账号判别、日志回读核对、异常才通知。用户提到「巡航」「盯盘」「一键控量」「控预算」「ROI 掉线自动控量」时使用本技能。",
  },
  {
    dir: '../assets/plan-copy/',
    name: 'qianchuan-plan-copy',
    description: "巨量千川「乘方-推商品-自选商品」计划的复制流程。乘方计划按「商品×抖音号」唯一、平台没有复制按钮，所谓复制 = 搜索原计划 → 抓全部参数 → 用户确认后删除 → 按参数重建 → 逐抖音号全选主页素材 → 核对。当用户给出一个千川计划 ID 并要求「复制这条计划」「重建计划」「改 ROI 后复制」时使用本技能。内含已验证的 CDP 驱动脚本、坐标坑、弹窗处理、删除前强制自查与确认规则。",
  },
]

function makeProvider(def) {
  const bodyUrl = new URL(def.dir + 'SKILL.md', import.meta.url)
  const resourceBase = { kind: 'directory', path: fileURLToPath(new URL(def.dir, import.meta.url)) }
  const candidate = {
    name: def.name,
    description: def.description,
    invocation: INVOCATION,
    provider: def.name,
    source: 'bundled',
    resourceBase,
    rank: BUNDLED_SKILL_RANK,
    locator: bodyUrl,
  }
  return {
    name: def.name,
    list: () => Promise.resolve([candidate]),
    async get() {
      return {
        name: candidate.name,
        description: candidate.description,
        invocation: candidate.invocation,
        provider: candidate.provider,
        source: candidate.source,
        resourceBase,
        content: await readFile(bodyUrl, 'utf8'),
      }
    },
  }
}

/** Cordis plugin name. */
export const name = 'dsh-qianchuan-toolkit'
/** Service dependencies. */
export const inject = ['skills']

/** 注册包里全部技能。 */
export function apply(ctx) {
  for (const def of SKILLS) {
    const provider = makeProvider(def)
    ctx.skills.registerProvider(() => provider)
  }
}
