# -*- coding: utf-8 -*-
"""
FUTURUM Safe — хост эвента.
Ты запускаешь этот скрипт → игроки шлют заходы/события → табло общее.

Локально:  http://127.0.0.1:8787/
Для VK/телефона нужен HTTPS-туннель (см. HOST.md).
"""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HOST = "0.0.0.0"
PORT = 8787
PLAYER_TTL_SEC = 5 * 60
MAX_EVENTS = 80
MAX_PLAYERS = 64
EVENT_UNLOCK_SEC = 60  # общий таймер двери для всех клиентов

_lock = threading.Lock()
_players: dict[str, dict] = {}
_events: list[dict] = []
_event_started_at = time.time()  # старт эвента = момент запуска хоста


def _now() -> float:
    return time.time()


def _event_ends_at() -> float:
    return _event_started_at + EVENT_UNLOCK_SEC


def _reset_event_timer() -> None:
    global _event_started_at
    _event_started_at = _now()


def _prune_players(now: float | None = None) -> None:
    t = now if now is not None else _now()
    dead = [pid for pid, p in _players.items() if t - p.get("at", 0) > PLAYER_TTL_SEC]
    for pid in dead:
        _players.pop(pid, None)


def _state() -> dict:
    now = _now()
    _prune_players(now)
    players = sorted(_players.values(), key=lambda p: p.get("at", 0), reverse=True)
    ends = _event_ends_at()
    return {
        "ok": True,
        "serverTime": now,
        "eventStartAt": _event_started_at,
        "eventEndsAt": ends,
        "eventUnlockSec": EVENT_UNLOCK_SEC,
        "eventSecondsLeft": max(0.0, ends - now),
        "players": players[:MAX_PLAYERS],
        "events": list(reversed(_events[-40:])),
    }


def _upsert_player(data: dict) -> dict:
    pid = str(data.get("id") or "0").strip() or "0"
    name = str(data.get("name") or "Гость").strip()[:48] or "Гость"
    photo = str(data.get("photo") or "")[:512]
    now = _now()
    prev = _players.get(pid) or {}
    entry = {
        "id": pid,
        "name": name,
        "photo": photo,
        "at": now,
        "last": prev.get("last") or "зашёл",
        "lastAt": prev.get("lastAt") or now,
    }
    _players[pid] = entry
    _prune_players(now)
    return entry


def _add_event(data: dict) -> dict:
    pid = str(data.get("id") or "0")
    name = str(data.get("name") or "Игрок")[:48]
    etype = str(data.get("type") or "action")[:32]
    detail = str(data.get("detail") or "")[:80]
    labels = {
        "join": "зашёл в игру",
        "lobby_door": "открыл дверь в коридор",
        "pass": "разблокировал пропуск",
        "gate": "открыл круглую дверь",
        "safe": "открыл сейф",
        "heartbeat": "онлайн",
    }
    label = detail or labels.get(etype, etype)
    now = _now()
    ev = {
        "id": pid,
        "name": name,
        "type": etype,
        "label": label,
        "at": now,
    }
    _events.append(ev)
    if len(_events) > MAX_EVENTS:
        del _events[: len(_events) - MAX_EVENTS]
    if pid in _players:
        _players[pid]["last"] = label
        _players[pid]["lastAt"] = now
        _players[pid]["at"] = now
        if data.get("photo"):
            _players[pid]["photo"] = str(data.get("photo"))[:512]
        if data.get("name"):
            _players[pid]["name"] = name
    elif etype != "heartbeat":
        _upsert_player({"id": pid, "name": name, "photo": data.get("photo") or ""})
        if pid in _players:
            _players[pid]["last"] = label
            _players[pid]["lastAt"] = now
    return ev


class Handler(BaseHTTPRequestHandler):
    server_version = "FuturumSafeHost/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Bypass-Tunnel-Reminder, ngrok-skip-browser-warning",
        )
        self.send_header("Cache-Control", "no-store")

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 50_000:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path in ("/", "/api/health"):
            self._json(200, {"ok": True, "service": "futurum-safe-host", "port": PORT})
            return
        if path == "/api/state":
            with _lock:
                self._json(200, _state())
            return
        self._json(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path.rstrip("/") or "/"
        data = self._read_json()
        with _lock:
            if path == "/api/join":
                player = _upsert_player(data)
                _add_event(
                    {
                        "id": player["id"],
                        "name": player["name"],
                        "photo": player.get("photo"),
                        "type": "join",
                    }
                )
                self._json(200, {"ok": True, "player": player, "state": _state()})
                return
            if path == "/api/heartbeat":
                player = _upsert_player(data)
                self._json(200, {"ok": True, "player": player})
                return
            if path == "/api/event":
                if not data.get("type"):
                    self._json(400, {"ok": False, "error": "type_required"})
                    return
                if data.get("type") != "join":
                    _upsert_player(data)
                ev = _add_event(data)
                self._json(200, {"ok": True, "event": ev, "state": _state()})
                return
            if path == "/api/timer/reset":
                _reset_event_timer()
                self._json(200, {"ok": True, "state": _state()})
                return
        self._json(404, {"ok": False, "error": "not_found"})


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print()
    print("  FUTURUM Safe Host")
    print("  -----------------")
    print(f"  Локально:  http://127.0.0.1:{PORT}/")
    print(f"  Health:    http://127.0.0.1:{PORT}/api/health")
    print(f"  State:     http://127.0.0.1:{PORT}/api/state")
    print(f"  Таймер:    {EVENT_UNLOCK_SEC} сек с момента запуска хоста")
    print(f"  Сброс:     POST /api/timer/reset")
    print()
    print("  Для телефонов / VK нужен HTTPS-туннель — см. HOST.md")
    print("  Клиент: safe.html?host=https://ВАШ_ТУННЕЛЬ")
    print("  Ctrl+C — остановить")
    print()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Хост остановлен.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
