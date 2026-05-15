"""
Structured logging for the oracle service.
Mirrors the pattern from Node.js src/core/utils/logger.js.
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone


LOG_LEVEL = os.environ.get("LOG_LEVEL", "info").upper()
USE_JSON = os.environ.get("LOG_FORMAT", "").lower() == "json"


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "module": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info and record.exc_info[1]:
            log_record["error"] = str(record.exc_info[1])
        if hasattr(record, "extra_data"):
            log_record.update(record.extra_data)
        return json.dumps(log_record)


class HumanFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        level = record.levelname.ljust(5)
        msg = record.getMessage()
        line = f"{ts} {level} [{record.name}] {msg}"
        if record.exc_info and record.exc_info[1]:
            line += f"\n{record.exc_info[1]}"
        return line


def create_logger(name: str) -> logging.Logger:
    """Create a structured logger matching the Node.js logger pattern."""
    logger = logging.getLogger(f"nexus.{name}")

    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter() if USE_JSON else HumanFormatter())
        logger.addHandler(handler)

    logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
    return logger
