"""Компактный виджет-таблица: слева серверы, справа события."""

from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVENTS_PATH = ROOT / "events.json"

WIDGET_TYPE = "table"


def load_events() -> list[dict]:
    if not EVENTS_PATH.exists():
        return []
    try:
        data = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
        return list(data.get("events") or [])
    except (OSError, json.JSONDecodeError):
        return []


def _server_cell(server: dict) -> dict:
    is_on = bool(server.get("online"))
    ping = server.get("ping")
    status = "On" if is_on else "Off"
    ping_text = f"{ping}" if is_on and ping is not None else "—"
    return {
        "text": f"{server.get('name', 'Server')} · {status} · {ping_text}",
    }


def _event_cell(event: dict | None) -> dict:
    if not event:
        return {"text": " "}
    when = str(event.get("when") or "").strip()
    title = str(event.get("title") or "").strip()
    text = f"{when} — {title}" if when else title
    return {"text": text or " "}


def build_payload(
    servers: list[dict],
    events: list[dict] | None = None,
    app_id: str | None = None,
) -> dict:
    app_id = app_id or os.environ.get("VK_APP_ID", "").strip()
    events = events if events is not None else load_events()

    online = sum(1 for s in servers if s.get("online"))
    body: list[list[dict]] = []
    rows_count = max(len(servers), len(events), 1)

    for i in range(rows_count):
        left = _server_cell(servers[i]) if i < len(servers) else {"text": " "}
        right = _event_cell(events[i] if i < len(events) else None)
        body.append([left, right])

    payload: dict = {
        "title": f"OPS · {online}/{len(servers)} online",
        "head": [
            {"text": "Серверы", "align": "left"},
            {"text": "События", "align": "left"},
        ],
        "body": body,
    }

    if app_id:
        url = f"https://vk.com/app{app_id}"
        payload["title_url"] = url
        payload["more"] = "Открыть"
        payload["more_url"] = url

    return payload


def build_code(
    servers: list[dict],
    events: list[dict] | None = None,
    app_id: str | None = None,
) -> str:
    return (
        "return "
        + json.dumps(build_payload(servers, events, app_id), ensure_ascii=False)
        + ";"
    )
