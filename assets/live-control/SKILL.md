# 千川直播盯盘 + 一键控量

> **资源位置**：本技能资源基目录下有 `scripts/`（主入口 `hourly.mjs`）与 `references/`（规则口径、界面结构、脚本用法、清单与通知）。下文 `scripts/xxx.mjs` 都相对这个基目录。
>
> **运行环境**：Windows（macOS 手动起 Chrome 同理）；Chrome/Edge 以 `--remote-debugging-port=9222` 启动（Windows 双击 `scripts/start-qc.cmd`）；Node 18+，脚本零第三方依赖。
>
> **数据目录**：默认 `~/.qianchuan-cruise`，可用环境变量 `QC_HOME` 指到别处。清单、日志、ad 映射、通知配置全在这里，不在插件目录里。

## 0. 这个技能解决什么

千川按**抖音号**跑量：一个号这个小时烧了多少、净成交 ROI 多少，等肉眼发现 ROI 掉下去时通常已经烧超了。平台自带的补救是 **一键调速 → 一键控量**：给这个号设「接下来 0.5 小时最多花 X 元」的封顶。

本技能做的事：**在自然小时的固定节点读分时数据 → 判定 → 命中就提交一键控量 → 回读计划日志确认真的生效**。

粒度是「**账号 × 抖音号**」，不是计划：一个抖音号下所有在投计划被一起控；同一个抖音号可能同时挂在两个账号下（一个全域、一个乘方），由技能判别谁在实际投放。

## 1. 业务规则（默认值，可被三层覆盖）

| 项 | 默认 | 说明 |
|---|---|---|
| 判定节点 | 每小时 **:15 / :30 / :45 / :55** | `:55` 读的是刚结束的那个小时 |
| 数据源 | 分时报表 `statQuery` | 直接拿「这个小时」的消耗与净成交，不做差量 |
| 判定字段 | 当前小时**净成交 ROI** | 净成交金额 ÷ 消耗 |
| 触发 | ROI **< 2.40** 且该小时**已有消耗** | 消耗为 0 不控（没花钱，控了只是给空跑计划加预算） |
| 动作 | **一键控量** | 预算默认 **200 元** |
| 时长 | **0.5 小时（平台固定，改不了）** | 弹窗里不可编辑 |
| 轮空 | 该行已有控量在跑 | 平台不允许叠加，轮空并记住结束时间，结束后 +1 分钟加插一轮 |
| 人为限流 | **无** | 同一小时可以控两次：18:10 控完，18:40 数据仍差就再控 |
| 常驻刷新 | **不常驻** | 只在节点前 1–3 分钟进页面，跑完离开 |

> 用户口径的演进：早期是「累计值差量、半小时消耗 > 300 且 ROI < 2.4」，后来定为**只看自然小时的净成交 ROI**，消耗只作为「有没有真的在花钱」的前置条件。别再按差量法理解本技能。

三层覆盖（优先级低→高）：`targets.json` 的 `defaults.hourly` → `accounts[].rules.hourly` → `targets[].rules.hourly`，字段：`nodes / roiFloor / minCost / budget / controlHours`。

## 2. 数据口径

列表页只给当日累计，没法回答「这个小时怎么样」。技能直接调页面自己的分时接口（同源 fetch，带登录态）：

```
POST /ad/api/data/v1/common/statQuery?aavid=<账户ID>
{
  "Dimensions": ["stat_time_hour", "ad_id"],
  "StartTime": "2026-11-19 00:00:00",
  "EndTime": "2026-11-19 10:59:59",
  "DataSetKey": "site_promotion_post_overview",
  "Metrics": ["stat_cost",
              "total_prepay_and_pay_settle_roi2_1h",
              "total_order_settle_amount_for_roi2_1h",
              "total_order_settle_count_for_roi2_1h"],
  "Filters": { "Conditions": [ {"Field":"advertiser_id","Values":["<账户ID>"]},
                               {"Field":"marketing_goal","Values":["2"]} ] }
}
```

- 返回「小时 × ad_id」的明细，一次拿当天全部小时，200–400 ms；
- **维度只能是 `ad_id`**：`aweme_id`/`plan_id` 会直接报 `RPC_STATUS_CODE_NOT_ZERO`，所以「哪个 ad 是哪个抖音号」要靠别的途径；
- `ad_id` 会出现 `"null"` 的汇总行，过滤掉；
- 净成交 ROI ≈ 净成交金额 ÷ 消耗（与列表「净成交ROI」列一致）。

**ad → 抖音号映射**：打开计划详情页 `/uni-prom/detail?aavid=<账户>&adId=<ad>`，页头即可读「计划ID / 抖音号ID / 抖音号」，约 2.8 s。首次遇到新 ad 时自动抓一次，缓存到 `ad-map-<aavid>.json`。列表页每行头像元素的 `id` 属性也是抖音号 uniqueId，可用于交叉校验。

## 3. 一键控量的平台事实（踩过的坑，别改）

1. **入口在列表行**，不在详情页：列表「调控工具」列 → 「一键调速」分组里的 `oc-icon-plus`。详情页的「调控」tab 只有起量/追投/抢首屏，**没有一键控量**。
2. **弹窗高度随调控方式变**：「起量」态比「控量」态高约 150 px。**提交前必须当场重新量按钮坐标**，用旧坐标会点在空白处（表现为「点了没反应」）。
3. **时长固定 0.5 小时**，弹窗里改不了，别写代码去改它。
4. **同一直播间已经有控量在跑时，平台不让创建新的**；行上会出现 `iconPauseFilled`（hover 提示「停止一键控量」）。这就是唯一的闸门——技能不做人为冷却。
5. **提交按钮必须真实鼠标点击**；radio、tab、行内图标用 JS `.click()` 更稳。
6. **输入框只做 focus + 原生 setter + input 事件**，绝不 clickAt 输入框。
7. 弹窗里的「任务名」（`20261119_看后搜一键投_直播间购买_09:22:31`）是平台自动生成的，**不是操作凭据**；凭据是计划日志。

## 4. 怎么跑

```bash
# 0) 先看清单和生效规则（不碰页面）
node scripts/hourly.mjs --doctor
node scripts/targets.mjs list

# 1) 建清单
node scripts/targets.mjs account-add --key A --aavid 1860000000000001 --name "账户显示名" --entry uniprom
node scripts/targets.mjs account-add --key B --aavid 1860000000000002 --name "另一个账户" --entry square
node scripts/targets.mjs add --account A --name "抖音号名称" --uid abc123 --ads 1860000000000003 --roi 2.4 --budget 200

# 2) 干跑一轮：读数据、判定，但不提交
node scripts/hourly.mjs --once --dry-run

# 3) 真跑一轮（会提交）
node scripts/hourly.mjs --once

# 4) 按节点常驻
node scripts/hourly.mjs --watch
node scripts/hourly.mjs --watch --max-rounds 8 --stage-timeout 90 --round-timeout 420
```

`--account <key>` 只跑某个账号；`--dry-run` 只报告；`--stage-timeout`（默认 90 s）单阶段看门狗；`--round-timeout`（默认 420 s）整轮看门狗。

单目标单次手动控量：`node scripts/control.mjs --aweme "抖音号名称" --budget 200 [--dry-run]`。

## 5. 一轮里发生什么

1. **按账号分组**（一个账号只切一次页）；账号按 `targets.json` 顺序。
2. **一账号一标签页**：按 URL 里的 `aavid=` 找现成标签复用，没有就 `Target.createTarget` 新开一个，常驻不关（切账号 9–10 s，复用 5–60 ms）。
3. **进列表**：全域投放 `/uni-prom?aavid=`，乘方 `/overall-prom?aavid=&campaignType=1`；SPA 换账号后要**点顶部导航 + 推直播间 tab** 才真的换路由。
4. **等就绪**：`hasAwemeCol && rows>0 && iconsReady`（图标齐才算，行先出现时状态是旧的），超时 12 s → 强刷重试一次 → 仍不行截图跳过本轮。
5. **读分时数据** → 按 ad 归到抖音号 → 判定。
6. **跨账号判别**：同名抖音号只在一个账号「投放中」→ 只对它生效；两个都在投 → 判歧义、只告警不动手。
7. **提交**（仅判定为 control 时）：关无关弹窗 → 唯一命中行 → 点 + → 选「一键控量」→ 填预算 → 重测坐标 → 真实点击 → 等弹窗消失。
8. **回读日志**：详情页「日志」找最新「新建 / 一键控量」，核对预算、时长 0.5、开始时间与提交时刻差 ≤120 s、操作人。
9. **落账**：`rounds.jsonl`（含各阶段耗时）、`actions.jsonl`（只记真提交）、`errors.jsonl`。

## 6. 通知（可选，默认不打扰）

配置文件 `<数据目录>/notify.json`（示例见 `docs/notify.sample.json`），通道：file / webhook（企业微信、飞书、钉钉、Server酱、PushPlus、Bark）/ QQ 官方机器人 / OneBot（NapCat）。配了就发，没配就只写本地 jsonl。

**只在这 5 种情况推送**：提交失败、日志核对不一致、账号或页面多次失败、读数据失败、同名抖音号跨账号歧义。控量成功、轮空、未开播、ROI 达标、没花钱——全部静默。同一事件默认 30 分钟内只发一次（歧义 6 小时）。

自检：`node scripts/notify.mjs --test`。

## 7. 防错铁律

1. **动作前双校验**：页头账户 ID 与 `aavid` 一致 + 抖音号行唯一命中；任一不符就停手。
2. **不确定就不重发**：提交后状态不明（弹窗没消失、图标没出现）只记 `unknown` 并告警，绝不重试——重试会变成两条控量。
3. **三方对齐**才算成功：弹窗消失 + 行上出现 `iconPauseFilled` + 日志三项（预算/时长/开始时间）一致。
4. **表头驱动取列**：全域投放是真 `th`，乘方把表头复制成一行 `tr` 且多两列；按「抖音号」列名定位，别写死索引。
5. **早读 = 读到旧状态**：行出现 ≠ 数据就绪，必须等调控图标齐。
6. **只对「投放中」的行动手**；已暂停/未开播跳过（开播会自动恢复投放，到时再判）。
7. **跨零点/跨账号不混算**：分时数据按当天的自然小时拿，不跨天聚合。
8. **每轮留痕**：决策、耗时、页面状态进 jsonl；异常路径留截图。

## 8. 故障速查

| 现象 | 原因 / 处理 |
|---|---|
| 点 + 没反应、弹窗没出来 | 该行已有控量（`iconPauseFilled`）/ 图标是禁用态（`icon-not-allowed`、`actionIconDisabled`）→ 视为轮空 |
| 点了提交没反应 | 复用了旧坐标；起量态/控量态弹窗高度不同，必须当场重测 |
| 读不到「抖音号」列 | 落在了详情页或别的产品线；`page.url.startsWith` 判定，别用 `includes` |
| 换账号没换页 | 千川是 SPA，`?aavid=` 只换账号不换路由；要点导航 + tab |
| 切换到一半卡住 | 多半是原生 `confirm/alert` 堵住渲染线程；CDP 层已自动 `handleJavaScriptDialog` |
| 页面全屏遮罩、点不动 | 无关活动弹窗压着；先跑 `dismissOverlays`（业务弹窗会被识别并跳过） |
| 数据全是 0 | 该号未开播/已暂停；或查数参数里 `marketing_goal` 不对 |

## 9. 文件地图

```
scripts/hourly.mjs      主入口：多账号巡航、判定、提交、回读、落账、告警
scripts/control.mjs     单次控量 CLI（薄壳，逻辑在 control-lib.mjs）
scripts/control-lib.mjs 控量链路（就绪判定 → 点 + → 填表 → 提交 → 校验）
scripts/account-lib.mjs 切账号、进产品线、一账号一标签页
scripts/page-lib.mjs    就绪轮询、弹窗清理、加载重试
scripts/cdp-lib.mjs     进程内 CDP 客户端（连接、eval、截图、鼠标、原生弹窗处理）
scripts/store.mjs       数据目录、targets.json、三层规则、跨账号判别
scripts/targets.mjs     清单 CLI（account-add / add / list / rm / standby / primary / doctor）
scripts/notify.mjs      多通道通知 + CLI 自检
scripts/selftest.mjs    单元自测
scripts/expr/*.js       注入页面的表达式片段
```

更多细节：`references/01-规则口径.md`（判定顺序、为什么弃用差量法）、`02-界面结构与元素定位.md`、`03-脚本用法.md`、`04-清单与通知.md`。
