"""Общий конструктор payload для виджета compact_list."""

from __future__ import annotations

import json
import os


def build_payload(servers: list[dict], app_id: str | None = None) -> dict:
    app_id = app_id or os.environ.get("VK_APP_ID", "").strip()
    rows = []
    online = 0

    for s in servers:
        is_on = bool(s.get("online"))
        if is_on:
            online += 1
        ping = s.get("ping")
        rows.append(
            {
                "title": str(s.get("name", "Server")),
                "descr": "Online" if is_on else "Offline",
                "button": f"{ping} ms" if is_on and ping is not None else "—",
            }
        )

    payload: dict = {
        "title": "Игровые серверы",
        "title_counter": online,
        "rows": rows or [{"title": "Нет данных", "descr": "—", "button": "—"}],
    }

    if app_id:
        url = f"https://vk.com/app{app_id}"
        payload["title_url"] = url
        payload["more"] = "Открыть дашборд"
        payload["more_url"] = url
        for row in payload["rows"]:
            row["title_url"] = url
            row["button_url"] = url

    return payload


def build_code(servers: list[dict], app_id: str | None = None) -> str:
    return "return " + json.dumps(build_payload(servers, app_id), ensure_ascii=False) + ";"


WIDGET_TYPE = "compact_list"
