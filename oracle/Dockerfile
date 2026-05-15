# syntax=docker/dockerfile:1.7
#
# Nexus Oracle — Python FastAPI service.
# Multi-stage build: dependencies first, then app code.

FROM python:3.11-slim-bookworm AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY pyproject.toml .
RUN pip install --no-cache-dir --prefix=/install .


FROM python:3.11-slim-bookworm AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r -g 1001 oracle \
  && useradd -r -u 1001 -g oracle -d /app -s /usr/sbin/nologin oracle

WORKDIR /app

COPY --from=builder /install /usr/local
COPY --chown=oracle:oracle app ./app
COPY --chown=oracle:oracle alembic ./alembic
COPY --chown=oracle:oracle alembic.ini .

RUN mkdir -p /app/data && chown -R oracle:oracle /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LOG_LEVEL=info \
    LOG_FORMAT=json

USER oracle

EXPOSE 8000

ENTRYPOINT ["tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
