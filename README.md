# AI Call Summarizer Discord Bot

A Discord bot that joins a voice channel, records each speaker separately, transcribes
the audio with speaker labels, and produces a Markdown summary with TL;DR, key points,
and action items — all via a configurable LLM (Ollama by default) and a configurable
speech-to-text provider (local `whisper.cpp` by default, OpenAI Whisper API as alternative).

## How it works

Discord exposes each voice-channel participant as a separate Opus stream, so speaker
labels come for free — no diarization model needed. Per-user audio is captured to PCM,
transcribed independently, then stitched chronologically into a single transcript that
is fed to the LLM.

## Prerequisites

- Node.js 18.17+
- A Discord application + bot token (https://discord.com/developers/applications)
  - Required bot intents: **Server Members**, **Message Content** is NOT needed.
  - Required permissions: **Connect**, **Speak**, **Send Messages**, **Attach Files**,
    **Use Slash Commands**.
- **Ollama** running somewhere reachable (default `http://localhost:11434`) with a
  model pulled (e.g. `ollama pull llama3.1`).
- For local STT: **whisper.cpp** built, with the `whisper-cli` (or `main`) binary on
  `PATH` plus a GGML model file (e.g. `ggml-base.en.bin`).
- On Windows, `@discordjs/opus` and `better-sqlite3` are native modules — you will
  need Visual Studio Build Tools (C++) installed for `npm install` to compile them.

## Install

```bash
npm install
cp .env.example .env
# fill in DISCORD_TOKEN and DISCORD_APP_ID
npm start
```

On first run, the bot registers its slash commands (to `DISCORD_DEV_GUILD_ID` if set,
otherwise globally) and creates `data/bot.db`.

## Step-by-step Windows setup

### 1. Ollama (local LLM)

1. Download and install Ollama from https://ollama.com/download.
2. Pull a model (fast, ~4.7 GB for llama3.1 8B):
   ```powershell
   ollama pull llama3.1
   ```
3. Verify it's running:
   ```powershell
   curl http://localhost:11434/api/tags
   ```
   Should return JSON listing your models.

### 2. whisper.cpp (local STT)

1. Open https://github.com/ggerganov/whisper.cpp/releases and download the latest
   Windows release zip (look for a file like `whisper-bin-x64.zip` — pick the CUDA
   variant if you have an NVIDIA GPU).
2. Extract to a path with no spaces, e.g. `C:\tools\whisper.cpp\`.
   You should see `whisper-cli.exe` (or `main.exe` in older releases) inside.
3. Add the folder to `PATH` **or** set `WHISPER_CPP_BIN` in your `.env` to the full
   path of the binary, e.g.:
   ```
   WHISPER_CPP_BIN=C:\tools\whisper.cpp\whisper-cli.exe
   ```
4. Download a GGML model from https://huggingface.co/ggerganov/whisper.cpp/tree/main.
   Good starter choices:

   | Model               | Size    | Notes                                    |
   |---------------------|---------|------------------------------------------|
   | `ggml-base.en.bin`  | 142 MB  | English-only, fast, decent accuracy      |
   | `ggml-small.en.bin` | 466 MB  | English-only, better accuracy            |
   | `ggml-medium.en.bin`| 1.5 GB  | Excellent English, slower                |
   | `ggml-large-v3.bin` | 3.1 GB  | Multilingual, best accuracy, needs a GPU |

   Save it next to the binary, e.g. `C:\tools\whisper.cpp\ggml-base.en.bin`.
5. Quick sanity check:
   ```powershell
   whisper-cli -m C:\tools\whisper.cpp\ggml-base.en.bin -f samples\jfk.wav -oj
   ```
   Should print segments and write a `.json` next to the input.

### 3. Configure the bot in Discord

Run these in your server (Manage Server permission required):

```
/config channel channel:#summaries
/config stt provider:whispercpp model_path:C:\tools\whisper.cpp\ggml-base.en.bin
/config llm provider:ollama base_url:http://localhost:11434 model:llama3.1
/help
```

`/help` will show a live check of what's configured and what's missing.

### 4. Record a call

```
/join            (while you're in a voice channel)
... talk ...
/leave
```

The summary + full `transcript.txt` will be posted to your configured summary channel.

## Slash commands

### Recording
| Command   | What it does                                                                |
|-----------|-----------------------------------------------------------------------------|
| `/join`   | Bot joins your current voice channel and starts recording every speaker.    |
| `/leave`  | Stops recording, transcribes, summarizes, posts to the configured channel. |
| `/help`   | Shows setup instructions and a live config-status check.                    |

### Configuration
| Command                                                                           | What it does                                   |
|-----------------------------------------------------------------------------------|------------------------------------------------|
| `/config llm provider:<ollama> base_url:<url> model:<name>`                       | Sets the LLM provider, endpoint, and model.    |
| `/config stt provider:<whispercpp\|openai> model_path:<path> api_key:<key>`       | Sets the transcription provider and options.   |
| `/config channel channel:<#channel>`                                              | Sets the channel where summaries are posted.   |
| `/config role role:<@role>`                                                       | Allows a role to run `/config` (in addition to Manage Server admins). |
| `/config show`                                                                    | Shows current configuration (API key masked). |

Anyone with **Manage Server** — or the configured role — may use `/config`.

## Defaults

| Setting          | Default                       |
|------------------|-------------------------------|
| LLM provider     | `ollama`                      |
| LLM base URL     | `http://localhost:11434`      |
| LLM model        | `llama3.1`                    |
| STT provider     | `whispercpp`                  |
| STT model path   | (unset — must configure)      |
| Summary channel  | (unset — must configure)      |

## Security notes

- The OpenAI API key is stored **plaintext** in SQLite. If you run this bot on a
  shared host, restrict filesystem access to `data/bot.db`.
- `/config show` masks the API key in its response, but the DB file itself is
  unencrypted.
- Anyone with `Manage Server` (or the configured role) can change provider URLs
  and models — verify your role setup before running in large servers.

## Out of scope (v1)

- Real-time transcription while the call is ongoing.
- LLM providers other than Ollama (the adapter layer makes it straightforward to
  add OpenAI/Anthropic/etc. — see `src/llm/`).
- Encryption of stored credentials at rest.
- Per-guild concurrency limits.
