"""
Локальный мониторинг серверов + раздача дашборда.
Запуск: py monitor.py
Открыть: http://127.0.0.1:5173/
"""

from __future__ import annotations

import json
import socket
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "servers.json"
HOST = "127.0.0.1"
PORT = 5173
TIMEOUT = 2.0


def load_servers() -> list[dict]:
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return data["servers"]


def tcp_ping(ip: str, port: int, timeout: float = TIMEOUT) -> dict:
    started = time.perf_counter()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect((ip, port))
        ping_ms = round((time.perf_counter() - started) * 1000)
        return {"online": True, "ping": ping_ms}
    except OSError:
        return {"online": False, "ping": None}
    finally:
        sock.close()


def check_all() -> list[dict]:
    servers = load_servers()
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

    # сохранить исходный порядок
    return [results[s["id"]] for s in servers]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/status":
            payload = {
                "updatedAt": time.strftime("%H:%M:%S"),
                "servers": check_all(),
            }
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        return super().do_GET()

    def log_message(self, format, *args):
        # тише в консоли
        if args and str(args[0]).startswith("GET /api/"):
            return
        super().log_message(format, *args)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Дашборд: http://{HOST}:{PORT}/")
    print(f"API:      http://{HOST}:{PORT}/api/status")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nОстановлено")


if __name__ == "__main__":
    main()
