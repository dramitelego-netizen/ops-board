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

```
https://dramitelego-netizen.github.io/ops-board/?view=safe&host=https://xxxx.trycloudflare.com
```

В VK URL приложения лучше оставить:
`https://dramitelego-netizen.github.io/ops-board/`  
Сейф открывается кнопкой внутри (тот же адрес + `?view=safe`), иначе телефон уводит в браузер.

Проверка без VK (только свой ПК):

```
http://127.0.0.1:5173/?view=safe&host=http://127.0.0.1:8787
```

## 4. Что видит табло

- кто сейчас в игре (заход + heartbeat)
- последнее действие: открыл дверь / пропуск / круглую дверь / сейф

Без хоста игра работает как раньше — только локальный список на устройстве.
