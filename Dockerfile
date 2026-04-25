# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the AI Call Summarizer Discord bot.
# Final image contains: Node.js 20 runtime + whisper-cli binary + bot source.
# Whisper models and Ollama models are NOT baked in — they live in named
# volumes populated by dedicated init services (see docker-compose.yml).
# This keeps the image small (~330 MB) and model changes cheap.

# ──────────────────────────────────────────────────────────────────────────
# Stage 1: build whisper.cpp from source and produce a stripped binary.
# ──────────────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS whisper-builder

ARG WHISPER_REF=master

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       git build-essential cmake ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch ${WHISPER_REF} \
      https://github.com/ggerganov/whisper.cpp whisper.cpp

WORKDIR /src/whisper.cpp
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  && cmake --build build -j"$(nproc)" --target whisper-cli \
  && strip build/bin/whisper-cli

# ──────────────────────────────────────────────────────────────────────────
# Stage 2: install production Node dependencies. Native modules
# (better-sqlite3, @discordjs/opus) compile here and will be copied to the
# runtime stage — both stages must share the same base image / arch / libc.
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       python3 build-essential ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# ──────────────────────────────────────────────────────────────────────────
# Stage 3: slim runtime. No compilers, no git, no models. Runs as non-root.
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

# libgomp1 is required by whisper.cpp when built with OpenMP.
# tini gives us a real PID 1 for clean signal handling.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates libgomp1 tini ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r -g 1001 bot \
  && useradd  -r -u 1001 -g bot -d /app -s /usr/sbin/nologin bot

WORKDIR /app

COPY --from=whisper-builder /src/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=deps             /app/node_modules                    ./node_modules
COPY --chown=bot:bot         src                                  ./src
COPY --chown=bot:bot         bin                                  ./bin
COPY --chown=bot:bot         package.json                         ./

# Data directory is mounted from a named volume at runtime; create it so
# the non-root user owns it regardless of whether the volume is empty.
RUN mkdir -p /app/data /opt/whisper-models \
  && chown -R bot:bot /app /opt/whisper-models

ENV NODE_ENV=production \
    WHISPER_CPP_BIN=/usr/local/bin/whisper-cli \
    WHISPER_MODELS_DIR=/opt/whisper-models \
    LOG_LEVEL=info \
    LOG_FORMAT=json

USER bot

ENTRYPOINT ["tini", "--"]
CMD ["node", "src/index.js"]
