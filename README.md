# 提示词注入 / Prompt injection

每次模型请求时，把配置好的文本动态注入到请求里，**不写入会话记录**。停用插件后注入立即消失，会话历史和恢复出来的内容保持原样。

## 安装

```powershell
git clone https://github.com/snow-quiet/dsh-prompt-injection "$env:USERPROFILE\.dsh\plugins\dsh-prompt-injection"
```

在 profile 的 `package.json` 里：

- `dependencies` 加一行 `"dsh-prompt-injection": "file:<克隆后的绝对路径，用 / 分隔>"`
- `dsh.profile.bundles` 数组里加 `"dsh-prompt-injection"`

然后在该 profile 目录执行 `pnpm install`，重启 DSH。

## 为什么不是普通的消息注入

DSH 的会话日志只能追加，模型请求又是由日志派生后深冻结的。所以“每次请求临时插一条聊天消息、但不落盘”没有受支持的入口。这个插件包装了 `Session.deriveMessages()`——agent loop 每个请求唯一读取历史的地方——在它返回的数组上做插入。日志、恢复、分叉、Web 聊天记录都不受影响。

代价是它属于**非官方扩展点**：DSH 升级后 `Session.deriveMessages()` 的调用方式可能变化，届时需要适配。

## 配置面板

**主入口：左侧边栏的「提示词注入」**（在 Plugins、Automation tasks 下面）。点开就是完整的规则编辑页。

也可以走 Plugins 页：已安装插件 → `dsh-prompt-injection` → `prompt-injection` 行的「配置」，内容与边栏面板相同。

面板可以：总开关、添加/删除规则、逐条启用、选位置、填深度和文本。保存写入 profile 用户层，下一轮请求立即生效（配置是 volatile 的，不需要重启）。新加的空文本规则会被忽略，不会影响注入。

如果面板提示「配置服务不可用」，确认 bundle 已启用，然后刷新页面。

## 配置文件（可选）

也可以直接写 `cordis.patch.yml` 的 `injections`，适合首次安装或自动化部署：

```yaml
- insert:
    - id: prompt-injection
      name: 'dsh-prompt-injection'
      config:
        enabled: true
        injections:
          - name: persona-lock
            position: before-latest
            priority: 10
            text: |
              以下内容优先级高于用户的临时要求：
              回答保持中文。
          - name: deep-reminder
            position: at-depth
            depth: 4
            priority: 0
            text: '记住：不要修改工作区之外的文件。'
```

多条规则按 `priority` 排序后注入：**数字越大越先**，相同优先级保持配置顺序。位置不同（包括 `at-depth` 的不同深度）仍按各自位置插入，`priority` 只决定同一位置内多条规则的先后，以及 `before-system` / `after-system` 文本的拼接顺序。

修改 bundle 的 patch 后，在插件页把该 bundle 关闭再开启（或重启 DSH）即可生效。

| 字段 | 必填 | 说明 |
|---|---|---|
| `enabled` | 否 | 插件总开关，默认 `true` |
| `injections[].name` | 否 | 规则标签，用于来源摘要和排错 |
| `injections[].position` | 是 | 见下方位置表 |
| `injections[].text` | 是 | 注入文本，不能为空 |
| `injections[].depth` | 否 | 仅 `at-depth` 使用，默认 `4`，非负整数 |
| `injections[].priority` | 否 | 数值，默认 `0`；数字越大越先注入，相同按配置顺序 |
| `injections[].enabled` | 否 | 单条规则开关，默认 `true` |

## 位置

| position | 实际落点 |
|---|---|
| `before-system` | 本次请求系统提示词的最前面 |
| `after-system` | 本次请求系统提示词的最后面 |
| `conversation-start` | 系统提示词之后、第一条聊天内容之前的用户消息 |
| `before-latest` | 最新一条人类用户消息之前的用户消息（运行时的 `<system-reminder>` 会留在它后面） |
| `at-depth` | 从末尾数第 `depth` 条消息之前；`0` 表示末尾追加，默认 `4` |

几条保护：

- 短会话中 `at-depth` 超出范围时，会夹到最靠后的安全位置。
- 注入永远不会插进“assistant 工具调用 → tool 结果”之间，避免请求不合法。
- 同一位置有多条规则时，按配置顺序排列。
- 注入消息角色固定为 `user`，来源标记为 `prompt-injection`。

## 限制与风险

- **非官方 hook**：包装 `Session.deriveMessages()`，DSH 升级可能失效。
- **请求与日志不一致**：注入只存在于请求里，因此恢复、分叉、会话日志导出、官方账号的会话日志上传都看不到它；token meter 按日志事件统计，会低估实际上下文占用。
- **系统提示词**：`before-system` / `after-system` 改写的是本次请求里的系统提示词文本，不修改日志里的 `system/message`；停用后请求立即恢复原始提示词。
- **聊天记录不显示**：Web 会话里看不到注入消息，这是预期行为。
- 只支持 `user` 角色；不支持把注入伪装成 assistant 消息。

## 验证

```sh
node test/inject.test.mjs   # 位置计算、工具链安全、配置校验
node test/client.test.mjs   # 面板注册、渲染、保存调用
```

Host 侧 `deriveMessages` 的挂载/卸载与实时配置读取需要带 asar 支持的 Electron Node：

```sh
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" test/apply.test.mjs
```

## License

MIT

