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
2. Create the two required secret files — real values, no trailing newline:
   ```bash
   mkdir -p secrets
   printf '%s' 'YOUR_DISCORD_BOT_TOKEN' > secrets/discord_token.txt
   printf '%s' 'YOUR_DISCORD_APP_ID'    > secrets/discord_app_id.txt
   chmod 600 secrets/*.txt
   ```
3. Optional `.env` for non-secret settings (all have sensible defaults):
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

## Secrets

The default flow uses Docker Compose's native `secrets:` mechanism, which
mounts files from `./secrets/*.txt` at `/run/secrets/<name>` inside the bot
container. Those files:

- Are backed by tmpfs (never written to the container's writable layer).
- Are **not** visible as environment variables (no leak via `/proc/<pid>/environ`).
- Are read by the bot's loader at [src/config/secrets.js](../src/config/secrets.js),
  which falls back to env vars when the file is missing — so local `npm
  start` with `.env` still works.

### Rotating a secret

```bash
printf '%s' 'new-token-value' > secrets/discord_token.txt
docker compose up -d bot     # container restarts, re-reads the file
```

### Upgrading to HashiCorp Vault

For multi-service production or auditable secret access, swap the
`file:`-backed secrets for a Vault-Agent sidecar by layering in the
overlay file:

```bash
docker compose -f docker-compose.yml -f docker-compose.vault.yml up -d
```

See [`docker-compose.vault.yml`](../docker-compose.vault.yml) — it adds:

- `vault` — a Vault server (dev mode out of the box; point it at Raft /
  Consul for prod).
- `vault-agent` — authenticates with Vault via AppRole, renders
  `discord_token` / `discord_app_id` into a tmpfs volume, keeps them
  refreshed when they rotate in Vault.

The bot's secrets loader is unchanged — only the **source** of the files
changes. You won't need to rebuild or restart the bot when rotating in
Vault.

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
| `summarizer-bot` exits with "missing required secrets" | `secrets/*.txt` empty or wrong value                    | Recreate files, `docker compose up -d bot`                       |
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
