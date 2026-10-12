"""Проверка серверов и запись status.json (для GitHub Pages / Actions)."""

from __future__ import annotations

import json
import socket
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "servers.json"
OUT_PATH = ROOT / "status.json"
TIMEOUT = 2.5


def tcp_ping(ip: str, port: int) -> dict:
    started = time.perf_counter()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(TIMEOUT)
    try:
        sock.connect((ip, port))
        return {"online": True, "ping": round((time.perf_counter() - started) * 1000)}
    except OSError:
        return {"online": False, "ping": None}
    finally:
        sock.close()


def main() -> None:
    servers = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))["servers"]
    results: dict[str, dict] = {}

    with ThreadPoolExecutor(max_workers=len(servers) or 1) as pool:
        futures = {
            pool.submit(tcp_ping, s["ip"], int(s["port"])): s for s in servers
        }
        for future in as_completed(futures):
            server = futures[future]
            status = future.result()
            results[server["id"]] = {
                "id": server["id"],
                "name": server["name"],
                "ip": server["ip"],
                "port": server["port"],
                "color": server.get("color", "slate"),
                "online": status["online"],
                "ping": status["ping"],
            }

    payload = {
        "updatedAt": time.strftime("%H:%M:%S"),
        "servers": [results[s["id"]] for s in servers],
    }
    OUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    online = sum(1 for s in payload["servers"] if s["online"])
    print(f"OK: {online}/{len(payload['servers'])} online -> {OUT_PATH.name}")


if __name__ == "__main__":
    main()
