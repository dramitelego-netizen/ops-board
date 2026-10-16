# -*- coding: utf-8 -*-
"""Запуск ssh-туннеля и автозапись URL в host.json."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST_JSON = ROOT / "host.json"
URL_RE = re.compile(r"https://[a-z0-9]+\.lhr\.life", re.I)


def save_url(url: str) -> None:
    payload = {
        "url": url.rstrip("/"),
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    HOST_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print()
    print("  ========================================")
    print(f"  ТУННЕЛЬ: {url}")
    print("  Записано в host.json")
    print("  Теперь в другом окне выполни:")
    print("    git add host.json")
    print('    git commit -m "Update host URL"')
    print("    git push")
    print("  ========================================")
    print()


def main() -> int:
    cmd = [
        "ssh",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "ServerAliveInterval=15",
        "-R",
        "80:127.0.0.1:8787",
        "nokey@localhost.run",
    ]
    print("  Подключение к localhost.run …")
    saved = False
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except FileNotFoundError:
        print("  [Ошибка] ssh не найден. Включи OpenSSH Client в Windows.")
        return 1

    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()
        if not saved:
            m = URL_RE.search(line)
            if m:
                save_url(m.group(0))
                saved = True

    code = proc.wait()
    print("  Туннель закрыт.")
    return code or 0


if __name__ == "__main__":
    raise SystemExit(main())
