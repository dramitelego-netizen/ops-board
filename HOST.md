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

В VK URL приложения:
`https://dramitelego-netizen.github.io/ops-board/`

Сейф открывается **кнопкой «Сейф» на главной без перехода на другой HTML**
(иначе телефон VK открывает системный браузер).

Хост один раз можно прописать так (и открыть в VK):
```
https://dramitelego-netizen.github.io/ops-board/?host=https://xxxx.trycloudflare.com
```
Потом нажать «Сейф» — параметр `host` сохранится в localStorage.

Проверка на ПК:
```
http://127.0.0.1:5173/?host=http://127.0.0.1:8787
```
→ кнопка «Сейф».

## 4. Что видит табло

- кто сейчас в игре (заход + heartbeat)
- последнее действие: открыл дверь / пропуск / круглую дверь / сейф

Без хоста игра работает как раньше — только локальный список на устройстве.
