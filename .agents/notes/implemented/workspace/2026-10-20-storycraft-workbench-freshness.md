---
title: 故事工坊：立项后的当前作品与工作台刷新
status: implemented
created: 2026-10-20
updated: 2026-10-20
verification: 21 个单元测试文件与 9 条 E2E 全绿（2026-10-20）；重点覆盖指针 hydrate、单行持久化、已有其他作品拒绝、同 id work-exists、子代理守卫、列表/详情刷新与 focus 不写指针、刷新失败保留旧数据。
---

# Agent Note：故事工坊：立项后的当前作品与工作台刷新

## 问题

新会话里 `story_init` 成功后：

- 会话当前作品仍为空，`story_outline` 报 `work-not-selected`；
- 工作台作品列表只在挂载时请求，仍显示 0 部；
- 作品详情虽有 15 秒轮询，但轮询复用 `load()`：会写 `setCurrent`/整表指针，且没有 `focus` 立即刷新；全书计划写完后按钮最多要等 15 秒，轮询还会与故事动作争写 catalog。

作者必须手动刷新并进入作品，才能继续。

## 与既有记录的关系

当前权威表述在 `story_current` 的动作描述、`storycraft-longform-chapter` 技能与 `storycraft-studio-orchestration` 的“作品由面板进入”行；`implemented/workspace/2026-10-18-storycraft-single-preset-and-forms.md` 的“会话当前工作项”段落记录单预设时代的实现，持久化事实由 `implemented/pipeline/2026-10-19-storycraft-sqlite-store.md` 拥有。本决定只补一个窄例外：

- 会话没有当前作品时，`story_init` 成功后可把新作品设为当前；
- 会话已有其他当前作品时，`story_init` 在创建前拒绝，不切换、不覆盖旧作品；
- 面板仍是任何其他情况下的唯一切换入口。

## 决定

### 宿主：无当前作品时立项可设当前

`story_init` 的 execute：

1. 用共享的 `sessionCurrentOf(root, sessionId)` 读取当前作品：内存为空且该 root/session 尚未 hydrate 时，`try/catch` 调用 `readSessionCurrent(root)` 并 hydrate；读取失败按“无指针”处理、不抛出，并按 root/session 缓存已尝试，避免每个工具调用都打开 catalog；`withCurrentWork`、`story_current`、`story_init` 与 `scopeDenialOf` 都走这个 helper；
2. 按 `initWork` 的规则计算本次要创建的作品 id（`args.workId` 非空时用 `workIdOf(args.workId)`，否则用 `workIdOf(args.title)`）；有当前作品且不是这个 id → 在 `initWork` 之前返回 `work-mismatch`，消息说明“一个会话只操作一个作品：请新建会话再立项”；
3. 有当前作品且 id 相同 → 继续走 `initWork`，由既有的 `work-exists` 报告重复立项；
4. 无当前作品 → 执行 `initWork`，成功后先 `setCurrent(sessionId, created.workId)` 写内存，再用同步 `try/catch` 调 `setSessionCurrent(root, sessionId, workId)` 做非致命持久化；持久化失败只记录，不把已建作品变成失败/孤岛；
5. 返回结构、参数与既有错误码不变；不新增动作。

### 指针存储：单行读写

`session_current` 的读、写统一由 `store-db.js` 拥有：

- `setSessionCurrent(root, sessionId, workId)`：单行 `INSERT ... ON CONFLICT(session_id) DO UPDATE`；
- `clearSessionCurrent(root, sessionId)`：只删一行；
- `replaceSessionCurrent` 与 `snapshot()` 已删除；面板 `POST /current` 与 `story_init` 都走单行函数，整表 DELETE 不再存在；
- `readSessionCurrent` 继续返回整张表，供 `sessionCurrentOf` 读取并 hydrate；
- 不改变表结构。

`story_init` 的 `mutates:true` 由 `action()` 统一守卫覆盖，子代理在 execute 前被 `subagent-cannot-land` 拒绝。

### 工作台：silent refresh，不重放加载态

作品列表：

- 保留挂载时的 `load()`；
- 独立的 `refreshWorks()`：只请求 `listWorks` 与当前指针，更新 `works`/`currentId`；不设置 `status:loading`，失败只设置非阻断 `refreshError`；
- 页面可见时每 10 秒调用一次；`focus` / `visibilitychange` 时立即调用；页面隐藏时暂停；`setTimeout` 递归，避免请求叠加；
- 回收站不在轮询里刷新，保留现有按需加载。

作品详情：

- 保留首次 `load()`；独立的 `refreshDetail()` 请求 `face.work`、`face.volumes`、`face.next`，更新 `detail`/`volumes`/`next`；
- **不调用** `face.setCurrent`，轮询不写 `session_current`；
- 页面可见时每 15 秒调用一次；`focus` / `visibilitychange` 时立即调用；
- 失败时保留旧 `detail`，只设置非阻断 `refreshError`；错误在作品详情顶部渲染为一条紧凑提示，下一次成功后清除；
- 不重置 `selected`、字数范围、新建卷等本地状态。

面板 tab 使用 `keepMounted`，作者在对话里操作时它仍然挂载/可见；这里的“可见”只用于暂停浏览器标签隐藏时的轮询。

## 备选方案

- **只保留手动刷新**：实现最小，但作者刚立项仍会看到 0 部，问题不解决；否决。
- **`story_init` 总是切换当前作品**：作者已有作品时会被静默切走，且需要改写“模型不能切换”的既有规则；否决。
- **`story_init` 有当前作品时只建库不设指针**：新作品会成为孤岛，后续未带 `work` 的动作仍写旧作品；否决。
- **Host 主动推送刷新事件**：最省请求，但需要跨 Host/Client 事件协议，超出本次小修范围；留作后续。
- **轮询复用 `load()`**：会设置 loading/error、重挂载详情、重置表单，并在详情轮询里写 `setCurrent`；否决。

## 后果

- 列表轮询仍会按作品数打开数据库；10 秒间隔是成本与新鲜度的折中；
- 详情 15 秒轮询可能让确认按钮最多延迟 15 秒出现；`focus` 刷新可立即触发；
- `story_init` 在已有其他当前作品时拒绝，作者需要新建会话才能另起作品；
- 多窗口/多会话各自轮询，不引入跨窗口同步；
- 指针持久化失败时只保留内存指针并记录日志；重启后需重新从面板进入。

## 验证

- 21 个单元测试文件全绿；其中覆盖：无当前作品时设置并持久化指针、清空内存后 `story_current` 从 `session_current` hydrate、已有其他当前作品（含仅持久化的行）拒绝且不创建、同 id 重复立项返回 `work-exists`、子代理调用 `story_init` 被 `subagent-cannot-land` 拒绝、单行 update/clear 不丢其他会话行；
- 9 条 E2E 全绿；新增列表自动刷新、详情 `focus` 后 5 秒内出现确认按钮且轮询不写 `session_current`、详情刷新失败保留旧数据并显示可清除提示；
- `node scripts/decisions/check.mjs` 通过；
- 实现提交：`30035b8`（主体）、`ce1faa0`（刷新失败断言）。
