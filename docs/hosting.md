# Hosting Guide

This bot is designed to run as a long-lived Node.js process with access to a
native binary (`whisper-cli`) and a persistent SQLite database on disk. That
constraint rules some platforms in and others out.

## TL;DR

| Platform              | Verdict        | Free tier            | Notes                                          |
|-----------------------|----------------|----------------------|------------------------------------------------|
| **Vercel**            | ❌ Won't work  | —                    | Serverless; no persistent WS / filesystem.     |
| **Netlify / Cloudflare Workers** | ❌ Won't work | — | Same problem as Vercel.                        |
| **Fly.io**            | ✅ Recommended | 3× 256 MB VM + 3 GB  | Long-running VMs, volumes, Dockerfile build.   |
| **Railway**           | ✅ Works       | $5/mo trial credit   | Nixpacks or Dockerfile; simplest DX.           |
| **Render**            | ⚠️ Background worker only (paid) | —     | Free web services sleep, unusable for bots.    |
| **Oracle Cloud**      | ✅ Most generous | 4 ARM cores, 24 GB RAM, 200 GB | Full VM; requires CC for verification. |
| **Home server / Pi**  | ✅ Cheapest    | Your electricity     | Easiest to set up — install and run.           |

## Why Vercel (and similar) cannot host this bot

Serverless platforms like Vercel, Netlify, and Cloudflare Workers are a poor fit
for Discord bots of this shape for several independent reasons:

1. **Long-lived gateway WebSocket.** discord.js keeps an open WS to the Discord
   gateway 24/7. Serverless functions run for at most 10 s–15 min per request
   and can't maintain this.
2. **Long-lived voice UDP.** `@discordjs/voice` opens a UDP socket for the
   voice payload. Serverless networking is HTTP-only.
3. **Persistent filesystem.** We write per-user PCM files, a GGML model file
   (100 MB – 3 GB), and a SQLite DB. Serverless filesystems are ephemeral or
   read-only outside `/tmp`.
4. **CPU-heavy transcription.** `whisper-cli` can run for seconds per clip —
   fine for a VM, hostile to a function timeout and a pay-per-execution meter.

You *could* in theory use Discord's [HTTP Interactions endpoint](https://discord.com/developers/docs/interactions/receiving-and-responding#receiving-an-interaction)
to handle slash commands over HTTPS (Vercel-compatible), but voice receive
still requires a persistent process — so you'd end up running two separate
services, which defeats the point.

**Conclusion:** host the whole bot on a platform that supports long-running
processes. The rest of this doc covers those options.

## Resource sizing

| Component                                  | Baseline usage               |
|--------------------------------------------|------------------------------|
| Node process + discord.js + voice          | ~150 MB RAM                  |
| `better-sqlite3` + session files           | <50 MB at rest               |
| `whisper-cli` with `ggml-base.en` (142 MB) | ~300 MB RAM during inference |
| `whisper-cli` with `ggml-small.en` (466 MB)| ~700 MB RAM during inference |
| `whisper-cli` with `ggml-medium.en` (1.5 GB)| ~1.7 GB RAM during inference|

Plan for at least **512 MB RAM** for `base.en`, **1 GB** for `small.en`,
**2 GB** for `medium.en`. CPU transcription is ~1–2× realtime on a decent
shared CPU for `base.en` — meaning a 5-minute call takes 3–10 minutes to
transcribe on a free-tier VM. If that's too slow, switch to OpenAI Whisper
via `/config stt provider:openai` (no local CPU cost).

## Option 1 — Fly.io (recommended free pick)

Fly's free allowance gives you three small shared-CPU VMs with attached
volumes — enough for this bot plus a small Whisper model.

### Setup

1. Install `flyctl`: https://fly.io/docs/hands-on/install-flyctl/
2. `fly auth signup` (or `fly auth login`).
3. In the repo root, create `Dockerfile`:

   ```dockerfile
   FROM node:20-bookworm-slim

   # whisper.cpp build deps + runtime deps for better-sqlite3 / @discordjs/opus
   RUN apt-get update && apt-get install -y --no-install-recommends \
         git build-essential cmake ca-certificates python3 curl \
       && rm -rf /var/lib/apt/lists/*

   # Build whisper.cpp
   RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp /opt/whisper.cpp \
       && cmake -S /opt/whisper.cpp -B /opt/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release \
       && cmake --build /opt/whisper.cpp/build -j --target whisper-cli \
       && cp /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli

   # Download a model
   RUN mkdir -p /opt/whisper-models \
       && curl -L -o /opt/whisper-models/ggml-base.en.bin \
          https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

   WORKDIR /app
   COPY package.json package-lock.json* ./
   RUN npm ci --omit=dev

   COPY . .

   ENV WHISPER_CPP_BIN=/usr/local/bin/whisper-cli
   # Data dir will be backed by a volume (see fly.toml below)
   VOLUME /app/data

   CMD ["node", "src/index.js"]
   ```

4. Create a Fly app + volume:

   ```
   fly launch --no-deploy --name ai-call-summarizer
   fly volumes create data --size 3 --region <closest region>
   ```

5. Edit the generated `fly.toml` so the volume is mounted and the bot isn't
   exposed to the internet (it has no HTTP server):

   ```toml
   [build]
     dockerfile = "Dockerfile"

   [mounts]
     source = "data"
     destination = "/app/data"

   [[vm]]
     cpu_kind = "shared"
     cpus = 1
     memory_mb = 512

   [processes]
     app = "node src/index.js"
   ```

   Delete any `[http_service]` block — this is a worker, not a web service.

6. Set secrets (never commit them):

   ```
   fly secrets set DISCORD_TOKEN=... DISCORD_APP_ID=...
   ```

7. Deploy:

   ```
   fly deploy
   fly logs        # tail
   ```

8. Configure the bot once per Discord server via `/config …` as usual. Because
   `/app/data` is the volume, the model path you configure is
   `/opt/whisper-models/ggml-base.en.bin` (baked into the image), and the
   SQLite DB persists across deploys under `/app/data/bot.db`.

### Swapping models

Models are baked into the image — change the `curl` URL in the Dockerfile
and redeploy. Or put models on the volume and pass the volume path via
`/config stt model_path:/app/data/models/ggml-base.en.bin` instead.

## Option 2 — Railway

Similar to Fly, with a smoother UI. $5/mo free trial credit is enough to keep
this bot running for ~2 weeks; after that a $5/mo Hobby plan covers it.

1. Sign up at https://railway.app.
2. Create a new project → "Deploy from GitHub repo".
3. Railway auto-detects Node via Nixpacks; override by committing the same
   Dockerfile as above (Railway uses it automatically if present).
4. Add a **Volume** via the service settings → mount at `/app/data`.
5. Add environment variables: `DISCORD_TOKEN`, `DISCORD_APP_ID`,
   `WHISPER_CPP_BIN=/usr/local/bin/whisper-cli`.
6. Deploy. Tail logs in the dashboard.

## Option 3 — Oracle Cloud (Always Free tier)

Oracle's free tier includes 4 ARM (Ampere) cores and 24 GB RAM across up to
four VMs, always free. It's the best free option *by resources* if you're
willing to manage a VM.

1. Create an Oracle account + verify (credit card needed for identity check).
2. Create a **VM.Standard.A1.Flex** instance with Ubuntu 22.04; allocate
   2 cores and 8 GB RAM to give Whisper headroom.
3. SSH in, then:

   ```bash
   sudo apt update && sudo apt install -y nodejs npm git build-essential cmake
   git clone https://github.com/ggerganov/whisper.cpp
   cd whisper.cpp && cmake -B build && cmake --build build -j --target whisper-cli
   sudo cp build/bin/whisper-cli /usr/local/bin/
   curl -L -o /opt/ggml-base.en.bin \
     https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

   git clone <this repo> && cd ai-call-summarizer-discord-bot
   npm ci
   cp .env.example .env && nano .env    # set DISCORD_TOKEN, DISCORD_APP_ID, WHISPER_CPP_BIN
   npm i -g pm2
   pm2 start src/index.js --name summarizer
   pm2 save && pm2 startup
   ```

4. Configure the bot in Discord: `/config stt model_path:/opt/ggml-base.en.bin`.

## Option 4 — Self-host (home machine, Pi, old laptop)

Most reliable long-term if you have always-on hardware. Follow the standard
README setup; wrap the bot in `pm2` or a systemd unit so it restarts on crash
and boot.

```bash
npm i -g pm2
pm2 start src/index.js --name summarizer
pm2 save && pm2 startup
```

No cold starts, no billing, full control. Only downside is it depends on your
home power + internet.

## LLM hosting considerations

Ollama itself is a separate service. You have three practical options:

1. **Ollama on the same host as the bot.** Easy if you have enough RAM.
   `llama3.1:8b` needs ~6–8 GB RAM alone. Fly.io/Railway free tiers **cannot**
   run a usable LLM locally. Oracle's 24 GB free tier can.
2. **Ollama on your home machine, bot on cloud.** Expose Ollama via
   `cloudflared tunnel` or Tailscale Funnel, set
   `/config llm base_url:https://ollama.your-domain.tld`. Works, fragile.
3. **Switch to a hosted LLM provider.** The cleanest path — add a new adapter
   in `src/llm/` (OpenAI, Anthropic, Groq, etc., each ~30 lines) and configure
   via `/config llm`. No RAM cost to the bot host.

For a free-tier deployment that actually works end-to-end without a home
server, option 3 (hosted LLM) + `whisper.cpp` on the cloud VM is the pragmatic
combination.

## Minimum viable free-tier recipe

If you just want it working on $0:

- **Bot process:** Fly.io 512 MB VM with the Dockerfile above.
- **STT:** `whisper.cpp` baked into the image with `ggml-base.en.bin`.
- **LLM:** Groq free tier (`llama-3.3-70b-versatile` or similar) or OpenAI
  with the free API credits — add a tiny adapter in `src/llm/` and flip
  `/config llm provider:<adapter-name>`.

Total cost: $0, works 24/7, ~5 minutes to transcribe a 5-minute call.

## Future: splitting bot and transcription

If transcription CPU becomes a bottleneck, you can run `whisper.cpp` on a
separate beefier machine, expose it via a simple HTTP wrapper (or use
`whisper.cpp`'s built-in server), and add a third STT provider
`whispercpp-http` that POSTs audio to it. That lets the bot live on a cheap
tier while transcription runs on something with real CPU.
