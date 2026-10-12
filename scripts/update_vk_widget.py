"""
Обновляет виджет сообщества VK (таблица: серверы | события).

Переменные:
  VK_COMMUNITY_TOKEN
  VK_APP_ID
  VK_API_VERSION (по умолчанию 5.199)
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATUS_PATH = ROOT / "status.json"
API = "https://api.vk.ru/method/appWidgets.update"

sys.path.insert(0, str(ROOT / "scripts"))
from widget_payload import WIDGET_TYPE, build_code  # noqa: E402


def update_widget(token: str, code: str, api_version: str) -> dict:
    data = urllib.parse.urlencode(
        {
            "access_token": token,
            "v": api_version,
            "type": WIDGET_TYPE,
            "code": code,
        }
    ).encode("utf-8")
    req = urllib.request.Request(API, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    token = os.environ.get("VK_COMMUNITY_TOKEN", "").strip()
    if not token:
        print("SKIP: VK_COMMUNITY_TOKEN не задан — виджет не обновляем")
        return 0

    if not STATUS_PATH.exists():
        print("ERROR: нет status.json", file=sys.stderr)
        return 1

    status = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    servers = status.get("servers", [])
    code = build_code(servers)
    api_version = os.environ.get("VK_API_VERSION", "5.199")

    result = update_widget(token, code, api_version)
    if "error" in result:
        print("VK ERROR:", result["error"], file=sys.stderr)
        return 1

    print("OK: виджет обновлён", result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
