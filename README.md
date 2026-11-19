# dsh-qianchuan-toolkit

一个 DSH 技能包，装两个千川技能：

| 技能 | 干什么 |
|---|---|
| `qianchuan-live-control` | 直播盯盘 + 一键控量：在自然小时的 :15/:30/:45/:55 读分时数据，当前小时消耗**超过 200 元**且净成交 ROI 低于阈值，就给该抖音号提交一键控量（默认 200 元 / 0.5 小时），提交后回读计划日志核对。 |
| `qianchuan-plan-copy` | 乘方「推商品」计划复制：搜原计划 → 抓参数 → 确认 → 删除 → 按参数重建 → 逐抖音号全选主页素材 → 核对。 |

两个技能的脚本各自独立（都在自己的 `assets/*/scripts/` 下），只依赖 Node 18+ 内置模块和一个带调试端口的浏览器。

## 为什么是「账号 × 抖音号」

千川的一键控量挂在**列表行**上，一个抖音号下的所有在投计划会一起被控；同一个抖音号还可能同时挂在两个账号下（一个投全域投放、一个投乘方）。所以清单的主键是 `账号/抖音号`，计划 ID 只用来核对和聚合分时数据。

## 安装

在 DSH profile 目录里：

```bash
npm install dsh-qianchuan-toolkit
```

或在 `cordis.patch.yml` 里加：

```yaml
- insert:
    - id: dsh-qianchuan-toolkit
      name: 'dsh-qianchuan-toolkit'
      config: {}
```

装好后技能目录里出现 `qianchuan-live-control` 与 `qianchuan-plan-copy` 两个技能，不需要重启。

## 上手（live-control）

```bash
# 1) 由你自己启动浏览器（沙箱里起 Chrome 会因为没有 crashpad 权限自杀）
#    Windows：双击 assets/live-control/scripts/start-qc.cmd
#    然后在这个浏览器里登录千川

# 2) 建清单（数据默认放 ~/.qianchuan-cruise，可用 QC_HOME 改）
node assets/live-control/scripts/targets.mjs account-add --key A --aavid <账户ID> --name "<账户名>" --entry uniprom
node assets/live-control/scripts/targets.mjs add --account A --name "<抖音号名>" --uid <uniqueId> --ads <计划ID> --roi 2.4 --budget 200

# 3) 先干跑，看判定与耗时
node assets/live-control/scripts/hourly.mjs --once --dry-run

# 4) 确认没问题再真跑；提交成功会自动读日志核对
node assets/live-control/scripts/hourly.mjs --once

# 5) 常驻（按节点 :15/:30/:45/:55）
node assets/live-control/scripts/hourly.mjs --watch
```

## 默认规则（可被三层覆盖）

| 项 | 默认 |
|---|---|
| 判定节点 | 每小时 :15 / :30 / :45 / :55 |
| 判定字段 | 当前小时净成交 ROI |
| 触发 | ROI < 2.40 且本小时已有消耗 |
| 动作 | 一键控量，预算 200 元 |
| 时长 | 0.5 小时（平台固定，不可改） |
| 控量中 | 轮空并记结束时间，结束后 +1 分钟加插一轮 |
| 人为限流 | 无（同小时可重复控，平台本身不允许叠加） |

覆盖顺序：`defaults.hourly` → `accounts[].rules.hourly` → `targets[].rules.hourly`，字段 `nodes / roiFloor / minCost / budget / controlHours`。

## 通知（可选，默认不打扰）

默认只写本地 `notifications.jsonl`。要收推送就在 `<数据目录>/notify.json` 里配通道（企业微信、飞书、钉钉、Server酱、PushPlus、Bark、QQ 官方机器人、OneBot），示例见 `docs/notify.sample.json`。

只有异常才推：提交失败、日志核对不一致、账号/页面多次失败、读数据失败、同名抖音号跨账号歧义。**控量成功、轮空、未开播、ROI 达标都不打扰。** 自检：`node assets/live-control/scripts/notify.mjs --test`。

## 目录

```
lib/index.js                注册两个技能
assets/live-control/        SKILL.md + scripts/ + references/ + config.rules.json
assets/plan-copy/           SKILL.md + references/ + scripts/
locale/                     插件市场文案
docs/DETAIL.md              插件详情
docs/notify.sample.json     通知配置示例
```

数据与日志都在数据目录（`~/.qianchuan-cruise` 或 `QC_HOME`），插件目录里不写任何运行产物。

## 边界

- 只操作你有权限的千川账户；脚本不绕过任何平台限制，不伪造请求签名。
- 所有提交动作都留痕（`actions.jsonl` + 计划日志回读），不确定时只告警不重试——重试会变成两条控量。
- 控量是「接下来 0.5 小时的消耗封顶」，不是暂停；封顶用完自然停。

## 许可

MIT
