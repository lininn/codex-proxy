# codex-proxy 中文说明

返回英文文档：[README.md](https://github.com/lininn/codex-proxy/blob/main/README.md)

`codex-proxy` 是一个本地 OpenAI Responses API 代理。它接收 Codex CLI 发出的 `/v1/responses` 请求，并根据你选择的 provider 类型转发到：

- Chat Completions 兼容接口：`/v1/chat/completions`
- Anthropic Messages 兼容接口：`/v1/messages`

## 适用场景

Codex CLI 使用 Responses API，但很多模型服务商只提供 Chat Completions 或 Anthropic Messages 兼容接口。`codex-proxy` 在本地完成协议转换，让 Codex CLI 可以使用这些上游服务。

## 安装

发布到 npm 后：

```bash
npm install -g @lininn/codex-proxy
```

从源码安装：

```bash
git clone https://github.com/lininn/codex-proxy.git
cd codex-proxy
npm install
npm run build
npm link
```

## 常用命令

```bash
codex-proxy start             # 后台启动代理
codex-proxy start -p 8080     # 指定端口启动
codex-proxy stop              # 停止后台代理
codex-proxy restart           # 重启并重新加载配置
codex-proxy restart -p 8080   # 指定端口重启
codex-proxy --web             # 打开本地 Web 配置页
codex-proxy config            # 输出配置文件路径
codex-proxy --help            # 查看帮助
codex-proxy --version         # 查看版本
```

`codex-proxy --web` 会启动一个临时配置服务。保存配置后会写入配置文件并关闭临时服务。如果后台代理已经在运行，需要执行 `codex-proxy restart` 才会让新配置生效。

## 配置 Provider

打开配置页面：

```bash
codex-proxy --web
```

每个 provider 包含：

- Name：本地 provider 名称。
- Proxy Type：选择 `Chat Completions` 或 `Anthropic Messages`。
- Base URL：上游 API 的 base URL。
- API Key：本地保存，Web 页面会脱敏显示。
- Default Model：可选，填写后会覆盖 Codex CLI 请求中的模型名。

同一时间只有一个 provider 生效。保存并切换默认 provider 后，请重启代理。

## 配置文件示例

默认配置路径是 `~/.codexproxy/config.json`。也可以通过 `CODEXPROXY_HOME` 指定配置目录。

```json
{
  "port": 8080,
  "defaultProvider": "deepseek",
  "providers": [
    {
      "providerType": "chat",
      "name": "deepseek",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "YOUR_DEEPSEEK_KEY",
      "defaultModel": "deepseek-chat"
    },
    {
      "providerType": "anthropic",
      "name": "anthropic",
      "baseUrl": "https://api.anthropic.com/v1",
      "apiKey": "YOUR_ANTHROPIC_KEY",
      "defaultModel": "claude-sonnet-4-5"
    }
  ]
}
```

Provider 类型说明：

- `chat`：把 `/v1/responses` 请求转成 Chat Completions 格式，并转发到 `<baseUrl>/chat/completions`。
- `anthropic`：把 `/v1/responses` 请求转成 Anthropic Messages 格式，并转发到 `<baseUrl>/messages`。

## 配合 Codex CLI 使用

先启动代理：

```bash
codex-proxy start
```

再让 Codex CLI 使用本地代理：

```bash
export OPENAI_BASE_URL=http://127.0.0.1:8080/v1
export OPENAI_API_KEY=local-placeholder
codex
```

这里的 `OPENAI_API_KEY` 只是为了满足客户端要求。真正的上游 API Key 从 `~/.codexproxy/config.json` 读取。

## 开发命令

```bash
npm install
npm run typecheck
npm run build
npm test
```

源码构建后启动：

```bash
node dist/src/cli.js start
```

## 注意事项

- 代理只监听本机地址。
- 保存配置不会热更新正在运行的代理，需要执行 `codex-proxy restart`。
- 内部配置接口仍保留 `/__codexproxy/*`，用于兼容已有实现。
- 默认配置目录仍是 `~/.codexproxy`。
