# Docker Deployment

The full production stack runs as a [Docker Compose](https://docs.docker.com/compose/)
project with four services, two named volumes for durable state, a dedicated
internal bridge network, file-based secrets, and CI/CD via GitHub Actions.

## What's in the box

```
              summarizer_backend  (docker network, internal)
┌────────────────────────────────────────────────────────────┐
│                                                            │
│   ┌─────────┐    /api/chat   ┌──────────┐                  │
│   │   bot   │ ─────────────▶ │  ollama  │                  │
│   └────┬────┘                └────┬─────┘                  │
│        │                          │                        │
│        │ reads  ┌──────────────┐  │ reads  ┌─────────────┐ │
│        └───────▶│whisper-models│  └───────▶│ollama-models│ │
│                 │  (volume)    │           │  (volume)   │ │
│                 └──────┬───────┘           └──────┬──────┘ │
│                        ▲                          ▲        │
│               writes   │                  writes  │        │
│         ┌──────────────┴──────┐    ┌──────────────┴──────┐ │
│         │ whisper-models-init │    │ ollama-models-init  │ │
│         │ (one-shot)          │    │ (one-shot)          │ │
│         └─────────────────────┘    └─────────────────────┘ │
│                                                            │
└────────────────────────────────────────────────────────────┘
                       bot-data  (volume, SQLite + audio)
```

**Nothing is exposed to the host.** No ports are published; Discord traffic
is all outbound. This is a private-by-default stack.

### Services

| Service                | Image                          | Role                                                       |
|------------------------|--------------------------------|------------------------------------------------------------|
| `bot`                  | `ghcr.io/<you>/ai-call-summarizer` | Node 20 + whisper-cli + bot source; runs as non-root `bot` |
| `ollama`               | `ollama/ollama:latest`         | Local LLM server                                           |
| `whisper-models-init`  | `debian:bookworm-slim`         | Downloads GGML models into `whisper-models` on first run   |
| `ollama-models-init`   | `ollama/ollama:latest`         | `ollama pull` into `ollama-models` on first run            |

### Volumes (all named — survive `docker compose down`)

| Volume                      | Mounted at              | Holds                                    |
|-----------------------------|-------------------------|------------------------------------------|
| `summarizer_bot_data`       | `/app/data`             | SQLite (`bot.db`) + transient session audio |
| `summarizer_whisper_models` | `/opt/whisper-models`   | `ggml-*.bin` files                       |
| `summarizer_ollama_models`  | `/root/.ollama`         | Ollama manifests + blobs                 |

## Build and run locally (Windows laptop)

While your Oracle VM is being provisioned, you can run the full stack on
your laptop against Docker Desktop — same `docker-compose.yml`, same
images, same behavior.

1. **Install Docker Desktop** from https://www.docker.com/products/docker-desktop/
   and start it. Verify:
   ```powershell
   docker info
   docker compose version
   ```

2. **Create `.env`** from the template in the project root:
   ```powershell
   copy .env.example .env
   notepad .env
   ```
   Fill in these three values:
   ```
   DISCORD_TOKEN=<your Discord bot token>
   DISCORD_APP_ID=<your Discord app ID>
   ENCRYPTION_KEY=<32 random bytes, base64>
   ```
   Generate the encryption key (if Node is installed on your host):
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   If Node isn't on the host, generate it inside a container:
   ```powershell
   docker run --rm node:20-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

3. **Run the helper script** (it validates `.env`, builds the image, brings
   the stack up, and tails bot logs):
   ```
   docker-run-locally.bat
   ```
   First boot takes ~10 minutes — it builds whisper.cpp (~2 min), installs
   Node deps, downloads 3 whisper models (~680 MB), and pulls `llama3.1`
   (~4.7 GB). All of that is cached in named volumes, so subsequent
   `docker-run-locally.bat restart` takes ~30 s.

4. **Configure the bot in Discord** (once per server, Manage Server role):
   ```
   /config channel channel:#summaries
   /config stt provider:whispercpp model:base.en
   /help
   ```
   The LLM base URL and default model were auto-populated (`http://ollama:11434`,
   `llama3.1`) by the compose environment, so `/config llm` isn't needed.

5. **Manage the stack**:
   ```
   docker-run-locally.bat status       show running containers
   docker-run-locally.bat logs         tail bot logs
   docker-run-locally.bat restart      rebuild bot and restart
   docker-run-locally.bat down         stop everything (keep volumes)
   docker-run-locally.bat clean        wipe all volumes (destructive)
   ```

Linux / macOS equivalent (no `.bat`, same idea):
```bash
cp .env.example .env && $EDITOR .env   # fill in the 3 required values
docker compose up -d --build
docker compose logs -f bot
```

## One-time deploy host setup

You need a machine with Docker + Docker Compose v2. For example, on Ubuntu:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
docker compose version   # should report v2.x
```

## First boot (build locally)

1. Clone the repo on the deploy host:
   ```bash
   git clone <your repo URL> /opt/ai-call-summarizer
   cd /opt/ai-call-summarizer
   ```
2. Create `.env` from the template and fill in the Discord credentials
   (compose reads this file automatically for `${VAR}` substitution):
   ```bash
   cp .env.example .env
   $EDITOR .env
   ```
   At minimum, set:
   ```
   DISCORD_TOKEN=...
   DISCORD_APP_ID=...
   ```
   Optional knobs also live in `.env` (all have sensible defaults):
   ```
   LOG_LEVEL=info
   LOG_FORMAT=json
   WHISPER_MODELS=tiny.en base.en small.en
   OLLAMA_MODELS=llama3.1
   LLM_DEFAULT_MODEL=llama3.1
   ```
4. Bring the stack up:
   ```bash
   docker compose up -d --build
   docker compose logs -f bot
   ```
5. In Discord (server with Manage Server on the bot), configure per-guild:
   ```
   /config channel channel:#summaries
   /config stt provider:whispercpp model:base.en
   /help
   ```
   The Ollama base URL and default model were auto-populated for you
   (`http://ollama:11434`, `llama3.1`) because the bot is running inside
   compose — no manual `/config llm` needed.

The first `docker compose up` will take a while: it builds whisper.cpp
(~2 min), installs Node deps, downloads three GGML models (~680 MB total),
and pulls `llama3.1` (~4.7 GB). Subsequent boots skip all of that.

## Updating from GHCR (CI/CD path)

Once the `Publish image` workflow has pushed an image to GHCR, you can swap
the local build for the published image:

```bash
export BOT_IMAGE=ghcr.io/<owner>/<repo>:latest
echo "BOT_IMAGE=$BOT_IMAGE" >> .env
docker compose pull bot
docker compose up -d
```

Or let the `Deploy` workflow do it for you by setting these GitHub Actions
repository secrets:

| Secret                | Value                                             |
|-----------------------|---------------------------------------------------|
| `DEPLOY_SSH_HOST`     | e.g. `ubuntu@203.0.113.4`                         |
| `DEPLOY_SSH_KEY`      | full private key for the deploy user (PEM)        |
| `DEPLOY_SSH_PORT`     | optional, default 22                              |
| `DEPLOY_PROJECT_DIR`  | e.g. `/opt/ai-call-summarizer`                    |

With those set, every push to `main` builds and pushes the image, then SSHes
into the host and runs `docker compose pull bot && docker compose up -d`.
The workflow is a no-op until the secrets exist, so it's safe to merge it
before you're ready to turn it on.

## Logging

- Every service uses `json-file` with `max-size=10m, max-file=5` → bounded
  at ~50 MB per service, rotated automatically.
- The bot's app logs are **structured JSON** in production
  (`LOG_FORMAT=json`), so `docker compose logs bot` produces one JSON object
  per line, ready for Loki / Elasticsearch / CloudWatch ingestion.
- Tail live:
  ```bash
  docker compose logs -f bot
  docker compose logs -f ollama
  ```
- Drop to debug verbosity on a deploy:
  ```bash
  LOG_LEVEL=debug docker compose up -d bot
  ```

## Credentials

Two separate concerns, handled separately:

### Infrastructure credentials (Discord token / app ID)

Live in `.env` at the project root. Compose reads this file automatically
and expands `${DISCORD_TOKEN}` / `${DISCORD_APP_ID}` into the bot
container's environment. The `:?` form in `docker-compose.yml` means
`docker compose up` **fails fast with a clear error** if either is unset —
no silent boots with broken creds.

- `.env` is gitignored, so real values never get committed.
- `.env.example` is tracked and shows the full list of supported variables.
- Rotating is `nano .env && docker compose up -d bot` — container restarts,
  picks up new values.

### User-provided API keys (OpenAI Whisper, etc.)

These are **per-guild**, set at runtime via slash commands, and **encrypted
at rest** in SQLite under `data/bot.db` (see `guild_config.stt_api_key`).
They're not infrastructure secrets and they don't go in `.env` — different
guilds legitimately use different keys.

```
/config stt provider:openai api_key:sk-...
```

Encryption details:
- **Algorithm:** AES-256-GCM with a fresh random 12-byte IV per value.
- **Master key:** `ENCRYPTION_KEY` in `.env` — 32 bytes, base64 or hex.
- **Stored shape:** `v1:<iv>:<auth_tag>:<ciphertext>` (all base64).
- **On read:** decrypted just-in-time by the transcription layer; `/config
  show` never decrypts — it shows `🔒 set (encrypted)` or
  `⚠️ set (plaintext — rotate)`.
- **Rotating the master key:** change `ENCRYPTION_KEY`, redeploy, then
  users rerun `/config stt api_key:...` (old ciphertext becomes
  unreadable — which is the security property you want).

Generate a fresh master key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The SQLite file lives in the `summarizer_bot_data` named volume, so it
survives deploys and container recreation. If the volume is compromised,
stored API keys remain AES-GCM-encrypted under a key that is **not in
the volume** — the attacker also needs `ENCRYPTION_KEY` from `.env` or
the runtime env.

## Scaling hooks

The architecture is deliberately modular:

- **Swap Ollama for a hosted LLM.** Remove `ollama` + `ollama-models-init`
  from compose, or add a `disable` profile. Add a new adapter in
  `src/llm/` (OpenAI, Anthropic, Groq…) and `/config llm provider:<new>`.
- **Run Whisper on a beefier box.** Add a `whispercpp-http` STT adapter in
  `src/transcription/`, run `whisper.cpp`'s built-in server on that host,
  and the bot can stay on a small VM.
- **Multi-host expansion.** The `backend` network is named explicitly
  (`summarizer_backend`). Promote it to an external overlay network for a
  Swarm or Nomad deployment — no per-service changes required.
- **Observability.** Adding a Loki/Promtail sidecar or an OpenTelemetry
  collector is additive — just join the `backend` network and set
  env/volumes on the bot. The structured JSON logger output is already
  shape-friendly.

## Troubleshooting

| Symptom                                            | Likely cause                                              | Fix                                                              |
|----------------------------------------------------|-----------------------------------------------------------|------------------------------------------------------------------|
| `docker compose up` aborts with "DISCORD_TOKEN must be set in .env" | `.env` missing or placeholders not replaced     | Edit `.env`, re-run `docker compose up -d`                       |
| Bot exits with "missing required env"              | `.env` not loaded (running compose from wrong dir)        | `cd` into the project root before `docker compose …`             |
| Bot says LLM error / `connect ECONNREFUSED`        | Ollama healthcheck hasn't gone green yet                  | `docker compose logs ollama` — wait for "Listening on 0.0.0.0:11434" |
| `whisper-models-init` fails with 403/429           | HuggingFace rate limit                                    | Rerun; files already downloaded are skipped                      |
| Summary generation very slow                       | Using `medium.en`/`large-v3` on a small VM                | `/config stt model:base.en`                                      |
| Need to fully reset state                          | —                                                         | `docker compose down -v` (wipes all named volumes — irreversible) |

## Running on Oracle Cloud Always Free

All of the above works unchanged on an Oracle A1.Flex instance (ARM).
The image is built multi-arch in CI (`linux/amd64` + `linux/arm64`), so
`docker compose pull` on ARM gives you the ARM build automatically.

For the full Oracle Cloud VM walkthrough (create the instance, harden it,
install Docker), see [hosting.md](hosting.md).
