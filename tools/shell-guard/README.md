# shell-guard

Host 插件：在工具派发前拒绝“删除/移动工作区外路径”的 shell 命令。

## 为什么存在

为了拿到干净状态去删真实用户目录（`~/.dsh`、`~/.ssh`、`~/.claude` …）是不能靠“记得住规则”来避免的。
分类器在 `tools/pre-execute` 上做静态判断，命中就返回 `deny`，由运行时短路该次调用。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | 插件入口；从 `sandboxPolicy.resolve({ session }).workspaceRoot` 取工作区边界 |
| `classify.js` | 纯函数分类器：动词识别、目标提取、越界判定、拒绝文案 |
| `test.mjs` | 19 条用例，`node tools/shell-guard/test.mjs`，不依赖 Harness |
| `cordis.patch.yml` | 插入 `shell-guard` 行（`package.json` 的 `dsh.bundle.patch` 指向它） |

## 判定规则

命中任一删除/移动动词（`Remove-Item`、`rm`、`rmdir`/`rd`、`del`/`erase`、`Move-Item`、`robocopy /mir|/purge|/move`、`.NET ::Delete`、`shutil.rmtree`、`os.remove`、`fs.rmSync`、`git clean -xdf`），并且：

- 目标解析后不在工作区根内 → `deny`
- 目标含通配符，或由变量拼接导致无法静态确定 → `deny`
- 管道喂给动词（真实目标不可见）→ `deny`

工作区内的删除照常放行。命中时回执给出 `scripts/trash.mjs` 的替代路径。

## 修改后如何生效

装进 profile 的是指向本目录的 **Junction**。改完源码后模块实例仍是旧的，需要重载：

```
plugin_manager  set_bundle  target=@dsh-nove/shell-guard  enabled=false
plugin_manager  set_bundle  target=@dsh-nove/shell-guard  enabled=true
```

或重启客户端。不要在 profile 里手改文件：安装与选择由 `plugin_manager` 拥有。

## 边界

- 只覆盖经由本 Harness 工具发起的 `pwsh` / `bash` 调用；作者自己终端里的操作不在其内。
- 只装在当前 profile。
- 静态分类不是安全边界：刻意混淆（编码、变量拼接）能绕过。它防的是手滑和“图省事”的破坏性命令。

## 关闭

`plugin_manager set_bundle target=@dsh-nove/shell-guard enabled=false`。关掉之前先想清楚：这正是上次出事的路径。
