# Hosting Guide

This bot needs a long-lived Node.js process, a native `whisper-cli` binary,
GGML model files on disk, and a persistent SQLite DB. That rules out all
serverless platforms and most "free" hobby tiers (which sleep on idle).

## TL;DR

| Platform                     | Lifetime free?        | Recommended for…                                |
|------------------------------|------------------------|-------------------------------------------------|
| **Oracle Cloud (Always Free)** | ✅ **Yes** — genuinely forever | Cloud-hosted, zero $ long-term **(top pick)** |
| **Self-host** (home PC / Pi) | ✅ Yes (your electricity) | You already have an always-on box              |
| Fly.io                       | ❌ 7-day trial only    | Short prototyping only                          |
| Railway                      | ❌ $5/mo trial credit  | Paid hobby tier (~$5/mo)                        |
| Render free                  | ❌ Sleeps on idle      | Not usable for a voice bot                      |
| Vercel / Netlify / Workers   | ❌ Serverless only     | Won't work — see "Why serverless" below         |

**The practical lifetime-free answer is Oracle Cloud Always Free.** Everything
else with "free" in the name either charges after a trial, sleeps on idle, or
can't keep a WebSocket open to Discord.

## Why serverless (Vercel etc.) can't host this bot

Four independent blockers, any one of which is fatal:

1. **Long-lived gateway WebSocket** — discord.js keeps a WS to Discord 24/7.
   Serverless functions run at most 10 s–15 min per request.
2. **Long-lived voice UDP** — `@discordjs/voice` holds a UDP socket for voice
   audio. Serverless networking is HTTP-only.
3. **Persistent filesystem** — we write per-user PCM, a 100 MB – 3 GB GGML
   model, and a SQLite DB. Serverless filesystems are ephemeral.
4. **CPU budget** — `whisper-cli` runs for several seconds per clip. Fine on
   a VM, hostile to function timeouts and per-invocation pricing.

So the rest of this doc is only about platforms that run long-lived processes.

## Resource sizing

| Piece                                        | RAM                           |
|----------------------------------------------|-------------------------------|
| Node + discord.js + voice                    | ~150 MB                       |
| SQLite + session PCM files                   | <50 MB at rest                |
| `whisper-cli` with `ggml-base.en` (142 MB)   | ~300 MB during inference      |
| `whisper-cli` with `ggml-small.en` (466 MB)  | ~700 MB during inference      |
| `whisper-cli` with `ggml-medium.en` (1.5 GB) | ~1.7 GB during inference      |
| Ollama `llama3.1:8b` (if self-hosting LLM)   | ~6–8 GB                       |

The Oracle Cloud free tier gives you up to **24 GB RAM**, so it comfortably
fits the bot + whisper + a local Ollama on a single VM. No other free tier
does.

> **Preferred deployment path: Docker Compose.** The production setup is
> fully containerised — see [`docs/docker.md`](docker.md) for the stack
> layout, CI/CD, secrets, and Vault overlay. This doc covers how to
> provision the *host* that runs that stack.

---

## Option 1 — Oracle Cloud Always Free (recommended, lifetime free)

Oracle's Always Free tier gives you, forever:

- Up to **4 Ampere ARM cores** + **24 GB RAM** split across 1–4 VMs.
- 200 GB block storage.
- 10 TB/month outbound traffic.
- An unchanging public IP.

That's genuinely enough to run the bot, whisper.cpp, **and** Ollama on one
VM — completely free.

### 1. Create the account

1. Sign up at https://www.oracle.com/cloud/free/ (needs a credit card for
   identity verification — Oracle states they don't charge it; if you want
   extra safety, use a virtual card).
2. Pick your **home region** carefully — it can't be changed later, and
   Always Free capacity varies by region. Try **Phoenix**, **Ashburn**, or
   your nearest region with ARM availability.

### 2. Create the VM

1. Console → Compute → Instances → **Create instance**.
2. Image: **Canonical Ubuntu 22.04** (or 24.04).
3. Shape: **Ampere → VM.Standard.A1.Flex**. Allocate **2 OCPU / 12 GB RAM**
   (you can grow to 4 / 24 later; 2/12 is plenty for the bot alone).
4. Networking: create a new VCN with internet connectivity (default is fine),
   assign a public IPv4.
5. SSH keys: upload your public key or let Oracle generate one and download it.
6. Create.

If you get "Out of capacity for A1.Flex", retry hourly — Always Free ARM
capacity is in high demand. Usually available within a day.

### 3. Open the firewall for outbound voice (no inbound needed)

The bot initiates everything; Discord doesn't connect inward. Default
outbound rules are fine. Do **not** open inbound ports — the bot has no
HTTP surface.

### 4a. Install Docker + deploy via compose (recommended)

SSH in (`ssh ubuntu@<public-ip>`), then:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

git clone <your repo URL> /opt/ai-call-summarizer
cd /opt/ai-call-summarizer
mkdir -p secrets
printf '%s' 'YOUR_DISCORD_BOT_TOKEN'  > secrets/discord_token.txt
printf '%s' 'YOUR_DISCORD_APP_ID'     > secrets/discord_app_id.txt
chmod 600 secrets/*.txt

docker compose up -d --build
docker compose logs -f bot
```

Everything — whisper.cpp, models, Ollama + `llama3.1`, SQLite — is
provisioned by the compose stack. First boot downloads ~5 GB of models;
subsequent restarts are instant. See [`docs/docker.md`](docker.md) for
service layout, logging, secrets, Vault upgrade path, and CI/CD.

### 4b. Install natively (no Docker, legacy path)

If you specifically don't want Docker on the host, you can install
everything as plain packages:

```bash
# Base tooling
sudo apt update
sudo apt install -y curl git build-essential cmake ca-certificates

# Node.js 20 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Build whisper.cpp
git clone https://github.com/ggerganov/whisper.cpp /tmp/whisper.cpp
cd /tmp/whisper.cpp
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j --target whisper-cli
sudo cp build/bin/whisper-cli /usr/local/bin/

# Download a couple of models to a fixed folder
sudo mkdir -p /opt/whisper-models
for m in tiny.en base.en small.en; do
  sudo curl -fsSL -o /opt/whisper-models/ggml-$m.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$m.bin
done
```

### 5. (Optional) Install Ollama on the same VM

Only do this if you picked 4 OCPU / 24 GB RAM; `llama3.1:8b` needs ~8 GB.

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.1
# Ollama listens on 127.0.0.1:11434 by default — perfect, no firewall change needed.
```

If your VM is 2 OCPU / 12 GB, skip Ollama on-host and use a hosted LLM
instead (see "LLM hosting" below).

### 6. Deploy the bot

```bash
cd ~
git clone <your repo URL> ai-call-summarizer-discord-bot
cd ai-call-summarizer-discord-bot
npm ci

cp .env.example .env
nano .env
# Fill in:
#   DISCORD_TOKEN=...
#   DISCORD_APP_ID=...
#   WHISPER_CPP_BIN=/usr/local/bin/whisper-cli
#   WHISPER_MODELS_DIR=/opt/whisper-models
```

### 7. Keep it running with systemd

```bash
sudo tee /etc/systemd/system/summarizer.service > /dev/null <<'EOF'
[Unit]
Description=AI Call Summarizer Discord Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/ai-call-summarizer-discord-bot
EnvironmentFile=/home/ubuntu/ai-call-summarizer-discord-bot/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now summarizer
sudo systemctl status summarizer
journalctl -u summarizer -f          # tail logs
```

### 8. Configure in Discord

```
/config channel channel:#summaries
/config stt provider:whispercpp model:base.en
/config llm provider:ollama base_url:http://localhost:11434 model:llama3.1
/help
```

Done — bot runs 24/7, restarts on crash or reboot, transcribes locally,
summarizes via on-host Ollama, and it's $0 for life.

### Switching whisper models at runtime

Models baked on the VM live under `WHISPER_MODELS_DIR=/opt/whisper-models`.
To switch, just re-run `/config stt model:small.en` — no restart, no deploy.
To add a model:

```bash
sudo curl -fsSL -o /opt/whisper-models/ggml-medium.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin
```

Then `/config stt model:medium.en` in Discord.

### Updating the bot

```bash
cd ~/ai-call-summarizer-discord-bot
git pull
npm ci
sudo systemctl restart summarizer
```

---

## Option 2 — Self-host on a home machine / Raspberry Pi

If you have an always-on PC or Pi, this is the cheapest option long-term
(just your electricity).

1. Follow the normal README setup (`npm install`, `.env`, whisper.cpp).
2. Set `WHISPER_MODELS_DIR` to a folder where you drop GGML files
   (default is `<repo>/models`).
3. Wrap the bot in a process manager so it restarts on crash / boot:

   **Linux (systemd)** — same unit file as the Oracle option above, with
   paths adjusted.

   **Windows** — either run `npm start` in a persistent terminal, or use
   [NSSM](https://nssm.cc/) to register `node src/index.js` as a Windows
   service.

   **Mac** — `pm2` works well:
   ```bash
   npm i -g pm2
   pm2 start src/index.js --name summarizer
   pm2 save
   pm2 startup    # follow the printed command
   ```

Raspberry Pi sizing: a Pi 4 with 4 GB RAM will handle `tiny.en` or
`base.en`. Don't try `medium.en` or larger — it'll crawl.

---

## Local development (always free, always works)

Your day-to-day dev loop doesn't require any of the above. The code uses
env vars so the same `src/index.js` runs identically on Windows/Mac/Linux
locally and on Oracle Cloud.

### Local setup recap

```
# 1. Install whisper.cpp somewhere, note the path to whisper-cli(.exe)
# 2. mkdir models   (in the repo root)
# 3. Drop one or more ggml-*.bin files into models/
# 4. Install Ollama from https://ollama.com/download, then: ollama pull llama3.1
# 5. In .env:
#      DISCORD_TOKEN=...
#      DISCORD_APP_ID=...
#      WHISPER_CPP_BIN=<full path to whisper-cli.exe>   (Windows) or leave empty if on PATH
#      WHISPER_MODELS_DIR=   (leave empty to default to <repo>/models)
# 6. npm install
# 7. npm start
```

Then in Discord:

```
/config channel channel:#summaries
/config stt provider:whispercpp model:base.en
/config llm provider:ollama base_url:http://localhost:11434 model:llama3.1
```

The defaults in code (`WHISPER_MODELS_DIR` → `<repo>/models`, Ollama URL →
`http://localhost:11434`) mean a fresh clone Just Works for local dev, and
the same binary deploys to Oracle Cloud unchanged — only the env values
differ.

---

## LLM hosting choices

You have three practical paths:

1. **Ollama on the same host as the bot.** Easiest when you have RAM for it.
   - Oracle Cloud 4 OCPU / 24 GB: ✅ fits `llama3.1:8b` comfortably.
   - Oracle Cloud 2 OCPU / 12 GB: ⚠️ tight; stick to smaller models (`phi4`, `llama3.2:3b`).
   - Raspberry Pi: ❌ too slow to be practical.

2. **Ollama on your home machine, bot on cloud.** Expose Ollama via
   [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
   or [Tailscale Funnel](https://tailscale.com/kb/1223/funnel/), then
   `/config llm base_url:https://ollama.your-domain.tld`. Works, but fragile
   (depends on your home uptime).

3. **Hosted LLM provider.** Drop a ~30-line adapter in `src/llm/` (Groq
   free tier, OpenAI, Anthropic, etc.) and `/config llm provider:<new-name>`.
   Zero RAM on the bot host. This is the cleanest option if your deployment
   box is RAM-constrained.

For Oracle Always Free with 24 GB RAM, option 1 (Ollama on-host) is simplest
and keeps everything free.

---

## Future: splitting transcription onto a beefier box

If you outgrow whisper-on-the-bot-host (e.g. you run the bot on a tiny
Raspberry Pi but want to transcribe fast on a desktop GPU), you can:

1. Run `whisper.cpp`'s built-in HTTP server on the beefy machine.
2. Add a third STT provider `whispercpp-http` in `src/transcription/` that
   POSTs the WAV file to it.
3. `/config stt provider:whispercpp-http` + a base URL.

The rest of the system stays untouched thanks to the pluggable STT factory
in [src/transcription/index.js](../src/transcription/index.js).
