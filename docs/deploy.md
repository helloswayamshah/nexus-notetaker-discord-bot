# Deployment Guide

## Why Cloud Run won't work

Cloud Run is request-scoped and scales to zero — three hard blockers for this bot:
- Discord requires a **persistent WebSocket** (gateway connection dies on idle shutdown)
- SQLite and whisper models need a **persistent filesystem** (ephemeral containers lose them on restart)
- `@discordjs/voice` holds a **long-lived UDP socket** (Cloud Run only allows HTTP/gRPC)

**Use any platform that keeps a container running 24/7.**

| Platform | Free tier | Cost | Notes |
|---|---|---|---|
| **Oracle Cloud A1.Flex** | ✅ Always Free | $0 | 4 OCPU / 24 GB — most generous |
| **GCE e2-micro** | ✅ Always Free (us-*) | $0 | 1 vCPU / 1 GB — tight but works with `base.en` |
| Fly.io | Limited | ~$3–7/mo | Persistent volumes, easy CLI deploys |
| AWS Lightsail | 3-mo trial | $3.50/mo | Simple, predictable |
| AWS ECS on EC2 | 12-mo trial | ~$8–10/mo | Full EBS volumes; see note below |

> **ECS/EKS/GKE note:** These work correctly (persistent volumes, long-lived containers) but add significant complexity and cost for a single bot. EKS alone costs ~$72/mo for the control plane. Only use them if you're co-locating with an existing cluster. Prefer a plain VM + Docker Compose.

---

## Three environments

| | Dev | Local Docker | Production |
|---|---|---|---|
| **How to run** | `npm start` | `docker-run-locally.bat` | SSH + `docker compose up -d` |
| **Env file** | `.env` | `.env.production` | `.env.production` |
| **Ollama** | Local `ollama serve` | In-stack sidecar | In-stack sidecar |
| **Whisper** | Local binary on PATH | Baked into image | Baked into image |
| **DB** | `data/bot.db` (local) | Named Docker volume | Named Docker volume |

---

## 1. Dev — bare Node, no Docker

For local development and testing. No Docker required.

### One-time setup

```bash
# Install whisper.cpp (macOS)
brew install whisper-cpp

# Linux — build from source
git clone --depth 1 https://github.com/ggerganov/whisper.cpp /tmp/whisper.cpp
cmake -B /tmp/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release /tmp/whisper.cpp
cmake --build /tmp/whisper.cpp/build -j --target whisper-cli
sudo cp /tmp/whisper.cpp/build/bin/whisper-cli /usr/local/bin/

# Download a model
mkdir -p models
curl -fsSL -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

# Start Ollama
ollama pull llama3.1

# Install Node deps
npm install
```

### `.env` (dev only — gitignored)

```env
DB_DRIVER=sqlite
ENCRYPTION_KEY=                        # generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
LOG_LEVEL=debug
LOG_FORMAT=                            # human-readable

WHISPER_CPP_BIN=                       # leave empty if whisper-cli is on PATH
WHISPER_MODELS_DIR=                    # leave empty → defaults to <repo>/models

OLLAMA_MODELS=llama3.1

ENABLE_DISCORD=true
DISCORD_TOKEN=your-bot-token-here
DISCORD_APP_ID=your-application-id-here
DISCORD_DEV_GUILD_ID=your-guild-id     # instant slash command updates in dev

ENABLE_SLACK=false
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_APP_TOKEN=xapp-...              # Socket Mode — fine for dev
SLACK_PORT=3001
```

### Run

```bash
npm start
# or Discord only:  npm run start:discord
# or Slack only:    npm run start:slack
```

### First-time bot config (do once per server/workspace)

**Discord** — run in any server where the bot has Manage Server:
```
/config stt provider:whispercpp model:base.en
/config llm provider:ollama base_url:http://localhost:11434 model:llama3.1
/config channel channel:#summaries
```

**Slack:**
```
/config stt provider=whispercpp model=base.en
/config llm provider=ollama base_url=http://localhost:11434 model=llama3.1
/config channel add source=#standup output=#summaries interval=60
```

---

## 2. Local Docker — full stack via script

Runs the exact production stack (bot + Ollama + model init) on your machine using Docker Desktop. Uses `.env.production` — same file as production.

### Setup

```bash
# One-time: create the env file
copy .env.example .env.production
notepad .env.production      # fill in the required values (see Section 3 below)
```

Two wrapper scripts — same commands on both platforms:

**Windows** — `docker-run-locally.bat`
**Linux / macOS** — `docker-run-locally.sh` (make it executable once: `chmod +x docker-run-locally.sh`)

```
# Windows                             # Linux / macOS
docker-run-locally.bat                ./docker-run-locally.sh
docker-run-locally.bat up             ./docker-run-locally.sh up
docker-run-locally.bat up-detached    ./docker-run-locally.sh up-detached
docker-run-locally.bat restart        ./docker-run-locally.sh restart
docker-run-locally.bat logs           ./docker-run-locally.sh logs
docker-run-locally.bat logs-all       ./docker-run-locally.sh logs-all
docker-run-locally.bat status         ./docker-run-locally.sh status
docker-run-locally.bat down           ./docker-run-locally.sh down
docker-run-locally.bat clean          ./docker-run-locally.sh clean
```

First boot downloads ~5 GB (whisper models + Ollama `llama3.1`). Subsequent starts are instant.

---

## 3. Production — GCE e2-micro or Oracle A1.Flex

Same `.env.production` as local Docker. The only difference is where the machine lives.

### Step 1 — Provision the VM

**Google Compute Engine (GCE) — Always Free:**
```bash
gcloud compute instances create summarizer-bot \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB
```
Or in GCP Console: Compute Engine → Create Instance → `e2-micro` → Ubuntu 22.04 → 30 GB disk. Leave HTTP/HTTPS firewall rules unchecked — the bot has no inbound surface.

**Oracle Cloud A1.Flex — Always Free:**
Console → Compute → Instances → Create → Shape: `VM.Standard.A1.Flex` → 2 OCPU / 12 GB RAM → Ubuntu 22.04 → Create.
*(If you get "Out of capacity", retry hourly — ARM capacity is in demand.)*

### Step 2 — Install Docker

```bash
ssh <vm-ip>

curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
docker compose version   # should show v2.x
```

### Step 3 — Clone and configure

```bash
git clone https://github.com/<you>/<repo>.git /opt/ai-call-summarizer
cd /opt/ai-call-summarizer

cp .env.example .env.production
nano .env.production     # fill in all values — see the full spec below
chmod 600 .env.production
```

### Step 4 — Start

```bash
docker compose up -d --build
docker compose logs -f bot
```

First boot takes ~10 min (building whisper.cpp, downloading models). Subsequent starts: ~30 s.

`restart: unless-stopped` in `docker-compose.yml` means the bot auto-restarts on crash and survives reboots — no extra config needed.

### Step 5 — Configure the bot (once per server/workspace)

**Discord:**
```
/config stt provider:whispercpp model:base.en
/config llm provider:ollama base_url:http://ollama:11434 model:llama3.1
/config channel channel:#summaries
```
Note: LLM URL is `http://ollama:11434` (in-stack DNS) not `localhost`.

**Slack:**
```
/config stt provider=whispercpp model=base.en
/config llm provider=ollama base_url=http://ollama:11434 model=llama3.1
/config channel add source=#standup output=#summaries interval=60
```

### Updating

```bash
cd /opt/ai-call-summarizer
git pull
docker compose up -d --build bot
docker compose logs -f bot
```

---

## `.env.production` — full spec

```env
# ── Core ──────────────────────────────────────────────────────────────────────
DB_DRIVER=sqlite

# Generate once, back it up. Losing it means stored STT API keys can't be decrypted.
# node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
ENCRYPTION_KEY=<base64-32-bytes>

# ── Logging ───────────────────────────────────────────────────────────────────
LOG_LEVEL=info
LOG_FORMAT=json

# ── Whisper ───────────────────────────────────────────────────────────────────
# These are baked into the Docker image — do not change.
WHISPER_CPP_BIN=/usr/local/bin/whisper-cli
WHISPER_MODELS_DIR=/opt/whisper-models

# Models to download on first boot (space-separated).
# base.en = 142 MB, fast. small.en = 466 MB, more accurate.
# On e2-micro (1 GB RAM) stick to base.en — small.en peaks at ~700 MB.
WHISPER_MODELS=base.en

# ── LLM ───────────────────────────────────────────────────────────────────────
OLLAMA_MODELS=llama3.1
LLM_DEFAULT_MODEL=llama3.1

# ── Discord ───────────────────────────────────────────────────────────────────
ENABLE_DISCORD=true

# discord.com/developers → your app → Bot → Reset Token
DISCORD_TOKEN=<bot-token>

# discord.com/developers → your app → General Information → Application ID
DISCORD_APP_ID=<numeric-id>

# Leave empty in production (global commands, 1-hr propagation).
# Set to a guild ID only during initial setup for instant registration.
DISCORD_DEV_GUILD_ID=

# ── Slack ─────────────────────────────────────────────────────────────────────
ENABLE_SLACK=true

# api.slack.com/apps → your app → OAuth & Permissions → Bot User OAuth Token
SLACK_BOT_TOKEN=xoxb-<numbers>-<numbers>-<string>

# api.slack.com/apps → your app → Basic Information → Signing Secret
SLACK_SIGNING_SECRET=<32-char-hex>

# Socket Mode (recommended for VM deployments — no public URL needed):
#   api.slack.com/apps → Basic Information → App-Level Tokens → Create token
#   Scope required: connections:write
# Set to empty string to use Events API (HTTP) instead — requires SLACK_PORT open.
SLACK_APP_TOKEN=xapp-<version>-<app-id>-<token>

# Only used when SLACK_APP_TOKEN is empty (Events API mode).
SLACK_PORT=3001
```

### Slack app setup (one-time, at api.slack.com/apps)

**OAuth & Permissions → Bot Token Scopes:**
```
channels:history   channels:read   chat:write   files:write   users:read   commands
```

**Slash Commands — register these four:**
```
/summarize   Summarize a channel's messages over a time window
/report      Alias for /summarize
/config      Configure LLM, STT, schedules, and roles
/help        Show available commands
```

**Socket Mode** — enable it, create an app-level token with scope `connections:write`, paste as `SLACK_APP_TOKEN`.

### Discord app setup (one-time, at discord.com/developers)

**OAuth2 → URL Generator → Scopes:** `bot`, `applications.commands`

**Bot Permissions:**
```
Read Messages / View Channels   Send Messages   Attach Files
Connect   Speak   Use Voice Activity
```

---

## Secrets — where everything lives

| Secret | File | Set by |
|---|---|---|
| `DISCORD_TOKEN`, `DISCORD_APP_ID` | `.env.production` | You at deploy time |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` | `.env.production` | You at deploy time |
| `ENCRYPTION_KEY` | `.env.production` | You — generate once, back it up |
| OpenAI Whisper API key (if used) | SQLite (AES-256-GCM encrypted) | Each guild via `/config stt api_key=...` |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Bot not responding | Check `docker compose logs bot` — usually a bad token or missing env var |
| `connect ECONNREFUSED ollama:11434` | Ollama still starting — wait 60 s, check `docker compose logs ollama` |
| Slack commands time out | Enable Socket Mode (`SLACK_APP_TOKEN`) — avoids needing a public URL |
| Whisper model not found | Check `docker compose logs whisper-models-init`; re-run `docker compose up` |
| OOM crash on e2-micro | Switch to `base.en` only — `small.en` leaves almost no headroom on 1 GB RAM |
| Decryption error after redeploy | `ENCRYPTION_KEY` changed — keep the same key, or users re-run `/config stt api_key=...` |
