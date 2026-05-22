# codex-proxy

Local OpenAI Responses API proxy for Codex CLI. It accepts `/v1/responses` requests and forwards them to either Chat Completions-compatible providers or Anthropic Messages-compatible providers.

Chinese documentation: [docs/zh-CN.md](docs/zh-CN.md)

## Why

Codex CLI talks to the OpenAI Responses API. Many model providers expose only one of these compatible APIs:

- OpenAI-style Chat Completions: `/v1/chat/completions`
- Anthropic-style Messages: `/v1/messages`

`codex-proxy` runs locally, translates Codex CLI requests, and forwards them to the provider you choose.

## Features

- Local `/v1/responses` endpoint for Codex CLI.
- Responses to Chat Completions request/response translation.
- Responses to Anthropic Messages request/response translation.
- Streaming SSE translation back to Responses events.
- Multiple saved providers with one active default provider.
- Local web configuration page.
- Background service commands: start, stop, restart.
- API keys stored locally in `~/.codexproxy/config.json`.

## Requirements

- Node.js 20 or newer
- npm

## Install

From npm after publishing:

```bash
npm install -g codex-proxy
```

From this repository:

```bash
git clone https://github.com/lininn/codex-proxy.git
cd codex-proxy
npm install
npm run build
npm link
```

## Commands

```bash
codex-proxy start             # Start the proxy in the background
codex-proxy start -p 8080     # Start on a specific port
codex-proxy stop              # Stop the background proxy
codex-proxy restart           # Restart and reload saved configuration
codex-proxy restart -p 8080   # Restart on a specific port
codex-proxy --web             # Open the local provider configuration page
codex-proxy config            # Print the config file path
codex-proxy --help            # Show CLI help
codex-proxy --version         # Show version
```

The `--web` command starts a temporary local config server. Saving configuration writes the config file and closes that temporary server. If a proxy is already running, run `codex-proxy restart` for saved provider changes to take effect.

## Configure Providers

Open the web configuration UI:

```bash
codex-proxy --web
```

Each provider has:

- Name: local provider identifier.
- Proxy Type: `Chat Completions` or `Anthropic Messages`.
- Base URL: provider API base URL.
- API Key: stored locally and masked in the UI.
- Default Model: optional model override.

Only one provider is active at a time. Use the web page to select the active provider, then restart the proxy.

## Example Configuration

The config file is stored at `~/.codexproxy/config.json` unless `CODEXPROXY_HOME` is set.

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

Provider type behavior:

- `chat` sends `/v1/responses` traffic to `<baseUrl>/chat/completions`.
- `anthropic` sends `/v1/responses` traffic to `<baseUrl>/messages`.

## Use With Codex CLI

Start the proxy:

```bash
codex-proxy start
```

Point Codex CLI at the proxy:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:8080/v1
export OPENAI_API_KEY=local-placeholder
codex
```

The local API key value is only used to satisfy clients that require one. Upstream provider keys are read from `~/.codexproxy/config.json`.

## Development

```bash
npm install
npm run typecheck
npm run build
npm test
```

Run the proxy from source after building:

```bash
node dist/src/cli.js start
```

## Notes

- The proxy listens on localhost only.
- Config saves do not hot-reload a running proxy. Use `codex-proxy restart`.
- Existing internal routes remain under `/__codexproxy/*` for compatibility.
- Existing config defaults remain under `~/.codexproxy`.
