# Optional connections

Agent4 starts without third-party credentials. The core workspace does not require these services. Restart/recreate the service after changing `.env`.

| Connection | Enable it | What leaves your server |
| --- | --- | --- |
| Local Ollama | Run Ollama, pull a model, set `OLLAMA_BASE_URL` and `AGENT4_MODEL` | Prompts and the relevant workspace context go to your chosen Ollama endpoint. |
| Hosted AI | Set `AGENT4_AI_PROVIDER=openai`, `OPENAI_API_KEY` and a model your account supports | Prompts, selected client/task context, and meeting transcripts used for generated notes go to the provider. |
| Transcription | Set `AGENT4_VOICE_TRANSCRIPTION_ENABLED=true` and `AGENT4_VOICE_TRANSCRIPTION_URL` | Audio goes to that endpoint. Use a local whisper.cpp-compatible HTTP service to keep processing on your own hardware. |
| GitHub | Set a narrowly scoped `AGENT4_GITHUB_TOKEN`; attach a repository to a project | Requests for your selected repository's commits and metadata go to GitHub. The token stays on the server. |
| Telegram mini app | Configure your own bot token and numeric owner IDs, HTTPS public URL, and bot menu URL ending in `/telegram` | Telegram receives mini app usage and explicit completion notifications when configured. The default web page never loads Telegram's bridge. |
| Site monitoring | Enable Sites and add public URLs | The monitor fetches each configured site and its search-related resources. No sites are preloaded. |
| Visitor/error snippet | Add the snippet shown by Sites to a website you own | Your website sends bounded page/error events to your Agent4 server. Configure your website's privacy notice as appropriate. |
| Client pages | Configure a separate hostname and create a client link | A person holding that private link sees only the selected client's published content. Link-open history stays in your database. |
| Public inquiry | Enable and allowlist your own website origin | Your website sends its inquiry form to your server. Optional Telegram notifications follow your own configuration. |

## Local AI

Install Ollama from its official distribution and pull a model you can run. The default model string is `qwen3.5:4b`; change it to an installed model appropriate for your hardware. Agent4 performs a readiness check and limits concurrent work.

With Docker Desktop, `.env.example` points to `http://host.docker.internal:11434`. On Linux, the included host-gateway mapping supplies that name, but Ollama must listen on an interface reachable from Docker; restrict its firewall to your Docker network. Do not expose an unauthenticated model endpoint to the Internet.

For a native Agent4 installation, use `OLLAMA_BASE_URL=http://127.0.0.1:11434`. Model downloads and inference need additional disk, RAM and CPU/GPU resources. Built-in assistant answers and manual tools remain usable if no model is available.

## Telegram and Google Calendar adapters

The web mini app and server-side Telegram helpers are included. Telegram uses only active accounts linked by the owner; numeric chat and sender IDs must belong to your deployment. No original bot/account IDs are supplied.

Google Calendar connector code is available in `src/connectors/google-calendar.js` for developers building a bot or extension. It is not a one-click Google sync feature in the web UI. Local calendar planning works without Google. Do not assume that entering OAuth credentials automatically synchronizes calendar data.

## Client-facing pages

Use a dedicated hostname, for example `clients.example.com`, separate from the private workspace origin. Set your own values:

```dotenv
AGENT4_CLIENT_PAGES=true
AGENT4_CLIENT_HOSTS=clients.example.com
AGENT4_CLIENT_URL=https://clients.example.com
AGENT4_CLIENT_EMAIL=
AGENT4_CLIENT_WHATSAPP=
```

Route that hostname to Agent4 through your HTTPS proxy and preserve the hostname. Requests on the client hostname can reach client pages only, never the workspace or its private API. Fill contact fields only if you want those details shown to clients. The owner selects the project and published updates for each link. Treat links as credentials, share them privately, and revoke them when needed.

The original company branding, assets, contact information and deployment URLs are absent. Adapt the neutral template wording before sending client pages from your own business.

## Public inquiry endpoint

This is off by default. If you use it, set `AGENT4_PUBLIC_INQUIRY=true` and `AGENT4_INQUIRY_ORIGINS=https://your-own-website.example`. Only listed origins are accepted. Read the validated body fields and limits in `src/public-inquiry.js`. This endpoint is separate from team registration and can never create a team account.
