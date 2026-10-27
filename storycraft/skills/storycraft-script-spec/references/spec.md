# 剧本 spec 与场次

## spec 字段

| 字段 | 含义 |
| --- | --- |
| `mainline` | 一句话卖点 |
| `episodes` | 集数与单集体量 |
| `hooks` | 钩子链：每集末尾留什么 |
| `ending` | 结局方向 |

## 场次字段

| 字段 | 含义 |
| --- | --- |
| `scene` | 场次号 |
| `place` | 地点 |
| `time` | 时间 |
| `cast` | 出场人物 |
| `action` | 动作与冲突 |
| `turn` | 场末变化 |

## 规则

- 每集一个可复述的钩子，场次服务于钩子；
- 时长估算按对白页数折算，见 `references/episode-scene-craft.md`；
- spec 确认前不写场次正文。
