# Secrets

This folder holds Docker Compose secrets. Files here are mounted into the bot
container at `/run/secrets/<filename-without-extension>`, backed by tmpfs, and
are **never** exposed as environment variables.

## Required files

Each file contains **only the secret value**, no key, no quotes, no trailing
newline (a trailing newline is tolerated but trimmed).

| File                   | Contents                                               |
|------------------------|--------------------------------------------------------|
| `discord_token.txt`    | Your Discord bot token from the Developer Portal       |
| `discord_app_id.txt`   | Your Discord application ID (numeric)                  |

## How to create them

```bash
mkdir -p secrets
printf '%s' 'YOUR_DISCORD_BOT_TOKEN'   > secrets/discord_token.txt
printf '%s' '1234567890123456789'       > secrets/discord_app_id.txt
chmod 600 secrets/*.txt
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force secrets | Out-Null
Set-Content -NoNewline -Path secrets\discord_token.txt  -Value 'YOUR_DISCORD_BOT_TOKEN'
Set-Content -NoNewline -Path secrets\discord_app_id.txt -Value '1234567890123456789'
```

## Rules

- `secrets/` is in `.gitignore` — **never commit real values**.
- Rotate by replacing the file and running `docker compose up -d` (secrets are
  re-read on container restart).
- Do not put secrets in `.env` for the production stack. `.env` is for
  non-secret configuration (`LOG_LEVEL`, `WHISPER_MODELS`, etc.).

## Upgrading to Vault

See `docs/docker.md` → "Upgrading to HashiCorp Vault" for swapping the
file-based secrets with a vault-agent sidecar that writes to tmpfs. The
bot's secrets loader doesn't change — only the source of the files does.
