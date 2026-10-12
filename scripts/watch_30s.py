"""
Мониторинг каждые 30 секунд:
  - пишет status.json
  - обновляет виджет VK (если есть токен)

Запуск:
  py scripts/watch_30s.py

Токен:
  файл .env  →  VK_COMMUNITY_TOKEN=...
  или переменная окружения
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from check_servers import main as write_status  # noqa: E402
from update_vk_widget import main as update_widget  # noqa: E402

INTERVAL = 30
ENV_PATH = ROOT / ".env"


def load_env_file() -> None:
    if not ENV_PATH.exists():
        return
    for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def main() -> None:
    load_env_file()
    token = os.environ.get("VK_COMMUNITY_TOKEN", "").strip()

    print("OPS Board — обновление каждые 30 секунд")
    print(f"Токен VK: {'да' if token else 'нет (только status.json)'}")
    print("Остановка: Ctrl+C\n")

    while True:
        started = time.time()
        try:
            write_status()
            update_widget()
        except Exception as exc:  # noqa: BLE001
            print("Ошибка цикла:", exc)

        elapsed = time.time() - started
        sleep_for = max(1.0, INTERVAL - elapsed)
        time.sleep(sleep_for)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nОстановлено")
