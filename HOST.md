# Хост эвента FUTURUM Safe

Ты запускаешь хост на своём ПК. Все игроки (ПК и телефоны в VK) видят одно табло «В ИГРЕ СЕЙЧАС» и кто что открыл.

## 1. Запусти хост

Двойной клик: `start-safe-host.bat`  
или: `py safe-host.py`

Локально: http://127.0.0.1:8787/

## 2. Сделай HTTPS-ссылку (обязательно для VK и телефона)

Страница мини-аппа на `https://…`, поэтому хост тоже должен быть **https**.

### Вариант A — Cloudflare Tunnel (бесплатно)

1. Установи [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)
2. В новом окне терминала:

```bat
cloudflared tunnel --url http://127.0.0.1:8787
```

3. Скопируй выданный URL вида `https://xxxx.trycloudflare.com`

### Вариант B — ngrok

```bat
ngrok http 8787
```

Скопируй `https://….ngrok-free.app`

## 3. Открой игру с хостом

Добавь параметр `host` к ссылке мини-аппа / GitHub Pages:

## VK Mini App — прямая ссылка на сейф (рекомендуется)

В настройках приложения укажи URL:

```
https://dramitelego-netizen.github.io/ops-board/safe.html
```

С хостом:

```
https://dramitelego-netizen.github.io/ops-board/safe.html?host=https://xxxx.trycloudflare.com
```

Так мини-апп сразу открывает сейф внутри VK, без кнопки и без перехода на другую страницу.

Альтернатива (главная FUTURUM): `https://dramitelego-netizen.github.io/ops-board/`

## 4. Что видит табло

- кто сейчас в игре (заход + heartbeat)
- последнее действие: открыл дверь / пропуск / круглую дверь / сейф

Без хоста игра работает как раньше — только локальный список на устройстве.
