"""
AES-256-GCM credential vault — Python port of src/core/utils/crypto.js.

Wire-compatible: values encrypted by the Node.js version can be decrypted
here and vice versa. Format: v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
"""

import base64
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VERSION = "v1"
IV_BYTES = 12
KEY_BYTES = 32

_cached_key: bytes | None = None


def _load_key() -> bytes | None:
    global _cached_key
    if _cached_key is not None:
        return _cached_key

    raw = os.environ.get("ENCRYPTION_KEY", "").strip()
    if not raw:
        return None

    buf: bytes | None = None

    # Try hex (64 chars)
    if len(raw) == 64:
        try:
            buf = bytes.fromhex(raw)
        except ValueError:
            pass

    # Try base64
    if buf is None:
        try:
            decoded = base64.b64decode(raw)
            if len(decoded) == KEY_BYTES:
                buf = decoded
        except Exception:
            pass

    if buf is None or len(buf) != KEY_BYTES:
        raise ValueError(
            f"ENCRYPTION_KEY must decode to {KEY_BYTES} bytes "
            "(either 64-char hex or 44-char base64)."
        )

    _cached_key = buf
    return _cached_key


def is_encrypted(value: str) -> bool:
    return isinstance(value, str) and value.startswith(f"{VERSION}:")


def encrypt(plaintext: str) -> str:
    if not plaintext:
        return plaintext

    key = _load_key()
    if key is None:
        raise RuntimeError(
            "ENCRYPTION_KEY is not set — refusing to store a secret in plaintext."
        )

    aesgcm = AESGCM(key)
    iv = os.urandom(IV_BYTES)
    # AESGCM.encrypt appends the 16-byte tag to the ciphertext
    ct_with_tag = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    # Split: last 16 bytes are the tag
    ct = ct_with_tag[:-16]
    tag = ct_with_tag[-16:]

    iv_b64 = base64.b64encode(iv).decode()
    tag_b64 = base64.b64encode(tag).decode()
    ct_b64 = base64.b64encode(ct).decode()

    return f"{VERSION}:{iv_b64}:{tag_b64}:{ct_b64}"


def decrypt(encoded: str) -> str:
    if not encoded:
        return encoded

    if not is_encrypted(encoded):
        # Legacy plaintext — return as-is
        return encoded

    key = _load_key()
    if key is None:
        raise RuntimeError(
            "ENCRYPTION_KEY is not set but an encrypted value was found."
        )

    parts = encoded.split(":")
    if len(parts) != 4:
        raise ValueError("Malformed encrypted value — expected 4 colon-delimited parts.")

    _, iv_b64, tag_b64, ct_b64 = parts
    iv = base64.b64decode(iv_b64)
    tag = base64.b64decode(tag_b64)
    ct = base64.b64decode(ct_b64)

    aesgcm = AESGCM(key)
    # AESGCM.decrypt expects ct + tag concatenated
    plaintext = aesgcm.decrypt(iv, ct + tag, None)
    return plaintext.decode("utf-8")


def is_key_configured() -> bool:
    try:
        return _load_key() is not None
    except ValueError:
        return False
