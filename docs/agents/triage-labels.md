# 分诊标签

技能用五个固定角色描述 issue 的分诊状态。下表把这些角色映射到本仓库实际使用的标签字符串。

| 技能中的角色 | 本仓库的标签 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 待维护者评估 |
| `needs-info` | `needs-info` | 等报告者补充信息 |
| `ready-for-agent` | `ready-for-agent` | 已写清，可交给无人值守的 Agent |
| `ready-for-human` | `ready-for-human` | 需要人来实现 |
| `wontfix` | `wontfix` | 不处理 |

状态流转：无标签的 issue 先归 `needs-triage`；从那里转到 `needs-info`、`ready-for-agent`、`ready-for-human` 或 `wontfix`。`needs-info` 在报告者回复后回到 `needs-triage`。维护者可以随时覆盖，但异常流转先确认。

这些是 GitHub 标签，需在 `dehuadong/dsh-nove` 仓库中存在。本次配置只登记词表，未创建远端标签；首次分诊前用 `gh label create` 创建，属于远端变更，需单独授权。
