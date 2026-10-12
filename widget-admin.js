/**
 * Кнопки админа: добавить в группу / поставить виджет / получить токен.
 * Работает только внутри VK (vkBridge) и для админов сообщества.
 */

function getLaunchParams() {
  const params = new URLSearchParams(window.location.search);
  const out = {};
  for (const [key, value] of params.entries()) out[key] = value;
  // иногда параметры приходят в hash
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  for (const [key, value] of hash.entries()) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

function bridge() {
  return window.vkBridge || null;
}

async function loadStatusServers() {
  try {
    const res = await fetch(`./status.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("status");
    const data = await res.json();
    return Array.isArray(data.servers) ? data.servers : [];
  } catch {
    return [];
  }
}

function buildWidgetCode(servers) {
  const lines = [];
  let online = 0;
  for (const s of servers) {
    const isOn = Boolean(s.online);
    if (isOn) online += 1;
    const mark = isOn ? "Online" : "Offline";
    const ping = isOn && s.ping != null ? `${s.ping} ms` : "—";
    lines.push(`${s.name}: ${mark} · ${ping}`);
  }
  const payload = {
    title: `Серверы · ${online}/${servers.length || 0} online`,
    text: lines.join("\n") || "Нет данных",
  };
  return `return ${JSON.stringify(payload)};`;
}

function showAdminBar(groupId) {
  if (document.getElementById("widget-admin")) return;

  const bar = document.createElement("section");
  bar.id = "widget-admin";
  bar.className = "panel admin-panel";
  bar.innerHTML = `
    <div class="panel-head">
      <h2>Виджет на главной группы</h2>
    </div>
    <p class="admin-hint">Чтобы статус был виден сразу на странице сообщества — выполните шаги по порядку.</p>
    <div class="admin-actions">
      <button type="button" class="admin-btn" data-action="add">1. Добавить в сообщество</button>
      <button type="button" class="admin-btn" data-action="widget">2. Установить виджет</button>
      <button type="button" class="admin-btn" data-action="token">3. Получить токен обновления</button>
    </div>
    <p class="admin-note" id="admin-note">Группа: ${groupId || "не указана"}</p>
  `;

  const dash = document.querySelector(".dashboard");
  dash?.appendChild(bar);

  bar.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    const note = document.getElementById("admin-note");
    const b = bridge();
    if (!b) {
      note.textContent = "Откройте приложение внутри VK, не в обычном браузере.";
      return;
    }

    try {
      if (action === "add") {
        await b.send("VKWebAppAddToCommunity");
        note.textContent = "Приложение добавлено в сообщество (или уже было добавлено).";
      }

      if (action === "widget") {
        const gid = Number(groupId);
        if (!gid) {
          note.textContent = "Нет vk_group_id. Откройте приложение из сообщества.";
          return;
        }
        const servers = await loadStatusServers();
        const code = buildWidgetCode(servers);
        await b.send("VKWebAppShowCommunityWidgetPreviewBox", {
          group_id: gid,
          type: "text",
          code,
        });
        note.textContent = "Подтвердите установку виджета в окне VK.";
      }

      if (action === "token") {
        const gid = Number(groupId);
        if (!gid) {
          note.textContent = "Нет vk_group_id. Откройте приложение из сообщества.";
          return;
        }
        const result = await b.send("VKWebAppGetCommunityToken", {
          app_id: Number(new URLSearchParams(location.search).get("vk_app_id")) || undefined,
          group_id: gid,
          scope: "app_widget",
        });
        const token = result?.access_token || "";
        if (!token) {
          note.textContent = "Токен не получен. Нужны права админа сообщества.";
          return;
        }
        note.textContent =
          "Токен получен. Сохраните его в GitHub → Settings → Secrets → VK_COMMUNITY_TOKEN. Не публикуйте токен.";
        console.log("VK_COMMUNITY_TOKEN:", token);
        try {
          await navigator.clipboard.writeText(token);
          note.textContent += " Токен скопирован в буфер обмена.";
        } catch {
          // ignore
        }
      }
    } catch (err) {
      note.textContent = `Ошибка: ${err?.error_data?.error_reason || err?.message || "отменено"}`;
    }
  });
}

function initWidgetAdmin() {
  const params = getLaunchParams();
  const role = params.vk_viewer_group_role || "";
  const groupId = params.vk_group_id || "";
  const isAdmin = ["admin", "editor", "moder"].includes(role);

  // Показываем админ-панель админам группы; вне VK — короткую подсказку не показываем
  if (isAdmin && groupId) {
    showAdminBar(groupId);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWidgetAdmin);
} else {
  initWidgetAdmin();
}
