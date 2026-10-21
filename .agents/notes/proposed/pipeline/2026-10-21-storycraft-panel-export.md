---
title: 故事工坊：面板导出入口与原子导出
status: proposed
created: 2026-10-21
updated: 2026-10-21
---

# Agent Note：故事工坊：面板导出入口与原子导出

## 问题

面板里的「导出目录」只在章节面板渲染，而作品详情传了 `hideActions: true`，所以作者实际看不到导出入口；真正生成导出仍要模型调用 `story_export`。导出是确定性操作，应由宿主直接执行、不经模型。

现有 `exportWork` 在默认目录上先删旧目录再写，失败会丢旧导出；面板按钮可重复点击，不能沿用这条破坏性路径。

## 提案

### 1. 面板入口

- 作品详情 header 增加「导出」和「导出目录」，作品级 busy 状态；
- 点击导出 `POST /api/dsh-storycraft/export`，body `{root, sessionId, workId}`；
- 路由用共享的当前作品校验（loopback、registry、session 当前作品），要求 JSON、小 body；
- 返回 `{directory, files}`；面板提示“已导出 N 个文件：<目录>”；
- 不新增 `story_*` 动作、不发会话消息、不把路径交给模型；
- 删除 ChapterPanel 里不可达的旧「导出目录」按钮，避免两个入口。

### 2. 原子导出（仅面板路径）

新增 `exportWorkAtomic(root, work)`，不改 `story_export` 的现有行为：

1. 在 `.storycraft/exports/` 写临时目录 `.tmp-<workId>-<random>`；
2. 用现有 `exportWork(root, work, stage)` 写入完整导出；该调用抛出的 fs 错误在这里包装为 `export-failed`，路由不会收到 raw error；
3. 若目标存在，rename 目标到 `.bak-<workId>-<random>`：
   - 失败：删除临时目录，旧导出不动；
4. rename 临时目录到目标：这是**提交点**；成功后导出已生效。
   - 失败：删除临时目录；有 `.bak` 时 rename 回目标，恢复失败抛 `export-rollback-failed` 并带备份路径；首次导出没有 `.bak` 时抛 `export-failed`；
5. 提交后删除 `.bak`；删除失败不报错，也不能把成功导出报成失败，残留由作者/后续清理处理；
6. 任一步失败都不得先删除旧目标；若目标缺失且存在 `.bak`，下一次导出/启动恢复备份。

`exportWork` 本身保持现有签名/行为（显式目标直接写；默认目标仍由 `story_export` 使用）；原子行为只由面板路由使用。

并发：`exportWorkAtomic` 用进程内 per-(root,workId) promise mutex 串行；跨进程并发不在本项范围。

故障注入：`exportWorkAtomic(root, work, { rename = renameSync, remove = rmSync } = {})`；测试注入 rename/remove 失败；`exportWork` 本身不注入。

### 3. 错误码

| 码 | 触发 |
| --- | --- |
| `invalid-body` | 缺少 sessionId/workId |
| `invalid-root` | root 缺失/相对路径 |
| `work-not-found` | workId 对应作品不存在 |
| `work-mismatch` | 会话当前作品不匹配 |
| `unknown-workspace` | root 不在 registry |
| `workspace-registry-unavailable` | 宿主 registry 不可用 |
| `export-failed` | 临时目录写入/第一次 rename 失败（权威错误码，补入 #18 表） |
| `export-rollback-failed` | 临时→目标失败且备份恢复也失败 |

所有 fs 错误在 store 层包装为 `StoryError`，路由按现有失败信封返回。

### 4. 测试

- `exportWorkAtomic`：首次导出、重复导出覆盖、旧目标在失败时保留、临时目录清理、提交后备份删除失败仍成功、缺失目标从 `.bak` 恢复；`exportWork` 的 raw fs error 包装为 `export-failed`；
- 注入 `rename` 失败：第一次 rename 失败旧目标不动；第二次 rename 失败恢复 `.bak`；首次导出（无 `.bak`）第二次 rename 失败返回 `export-failed`；
- 注入 `.bak` 删除失败：仍返回成功并保留备份；
- 默认导出 mtime/文件集合与现有导出测试一致；
- API 失败：`invalid-body`、`work-mismatch`、`invalid-root`、`unknown-workspace`、`work-not-found` 各一条；
- E2E：header「导出」→ 提示 → 目录存在；再次导出；没有新增会话消息；
- README/API 表/D1 行/#18 导出说明同步。

## 备选方案

- **面板按钮只发指令给模型**：违背宿主直连原则；否决。
- **改 `exportWork` 默认行为**：会影响 `story_export` 现有回执/错误码；否决，单独 `exportWorkAtomic`。
- **每次导出到时间戳目录**：保留历史但“当前导出”不固定；否决。
- **zip 下载**：D1 非范围。

## 验收条件

产品验收在 #27；本 Note 检查技术性质：

1. 面板路由只调 `exportWorkAtomic`，不调 `story_export`。
2. 原子替换的失败矩阵有测试；旧目标在 swap 前不删除。
3. 路径在 `.storycraft/exports/`，临时/备份名带随机后缀，进程内串行。
4. 输出目录/文件数不含路径给模型。
5. E2E 覆盖按钮、提示、目录存在、无会话消息。

## 风险

- Windows 文件占用可能让 rename/删除失败；失败矩阵按备份恢复处理，恢复失败保留 `.bak`。
- `.tmp` / `.bak` 可能残留；本项不自动清理，错误信息带路径。
- 跨进程并发未加锁；面板单实例使用可接受。
- 导出仍不是 zip，作者需要从目录取文件。
