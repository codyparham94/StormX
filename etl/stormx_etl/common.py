"""Shared helpers: HTTP with retries and compact JSON output."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

USER_AGENT = "StormX/0.1 (https://stormx.codyparham.com; github.com/codyparham94/StormX)"


def fetch(url: str, *, timeout: int = 60, attempts: int = 3) -> bytes:
    """GETs a URL, retrying network errors and 5xx answers with a short backoff."""
    last: Exception | None = None
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as err:
            if err.code < 500:
                raise
            last = err
        except (urllib.error.URLError, TimeoutError) as err:
            last = err
        time.sleep(2 ** (attempt + 1))
    assert last is not None
    raise last


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


def feature_collection(features: list[dict[str, Any]], **meta: Any) -> dict[str, Any]:
    return {"type": "FeatureCollection", "metadata": meta, "features": features}
