/**
 * Установка компактного виджета: слева серверы, справа события (table).
 */

function getLaunchParams() {
  const params = new URLSearchParams(window.location.search);
  const out = {};
  for (const [key, value] of params.entries()) out[key] = value;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  for (const [key, value] of hash.entries()) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

function bridge() {
  return window.vkBridge || null;
}

async function loadJson(url) {
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(url);
  return res.json();
}

async function loadWidgetData() {
  let servers = [];
  let events = [];
  try {
    const status = await loadJson("./status.json");
    servers = Array.isArray(status.servers) ? status.servers : [];
  } catch {
    // ignore
  }
  try {
    const data = await loadJson("./events.json");
    events = Array.isArray(data.events) ? data.events : [];
  } catch {
    // ignore
  }
  return { servers, events };
}

function buildWidgetCode(servers, events, appId) {
  const online = servers.filter((s) => s.online).length;
  const rows = Math.max(servers.length, events.length, 1);
  const body = [];

  for (let i = 0; i < rows; i += 1) {
    const s = servers[i];
    const e = events[i];

    let left = " ";
    if (s) {
      const on = Boolean(s.online);
      const ping = on && s.ping != null ? String(s.ping) : "—";
      left = `${s.name} · ${on ? "On" : "Off"} · ${ping}`;
    }

    let right = " ";
    if (e) {
      const when = (e.when || "").trim();
      const title = (e.title || "").trim();
      right = when ? `${when} — ${title}` : title || " ";
    }

    body.push([{ text: left }, { text: right }]);
  }

  const payload = {
    title: `OPS · ${online}/${servers.length} online`,
    head: [
      { text: "Серверы", align: "left" },
      { text: "События", align: "left" },
    ],
    body,
  };

  if (appId) {
    const url = `https://vk.com/app${appId}`;
    payload.title_url = url;
    payload.more = "Открыть";
    payload.more_url = url;
  }

  return `return ${JSON.stringify(payload)};`;
}

function showAdminBar(groupId, appId) {
  if (document.getElementById("widget-admin")) return;

  const bar = document.createElement("section");
  bar.id = "widget-admin";
  bar.className = "panel admin-panel";
  bar.innerHTML = `
    <div class="panel-head">
      <h2>Виджет: серверы | события</h2>
    </div>
    <p class="admin-hint">Компактная таблица под шапкой группы. Слева серверы, справа события.</p>
    <div class="admin-actions">
      <button type="button" class="admin-btn" data-action="add">1. Добавить плагин в сообщество</button>
      <button type="button" class="admin-btn admin-btn-main" data-action="widget">2. Установить виджет</button>
      <button type="button" class="admin-btn" data-action="token">3. Токен для автообновления</button>
    </div>
    <p class="admin-note" id="admin-note">Группа: ${groupId || "—"}${appId ? ` · App: ${appId}` : ""}</p>
  `;

  const dash = document.querySelector(".dashboard");
  const cols = document.querySelector(".cols");
  if (dash && cols) dash.insertBefore(bar, cols);
  else dash?.appendChild(bar);

  bar.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    const note = document.getElementById("admin-note");
    const b = bridge();
    if (!b) {
      note.textContent = "Откройте плагин внутри VK из сообщества.";
      return;
    }

    try {
      if (action === "add") {
        await b.send("VKWebAppAddToCommunity");
        note.textContent = "Плагин добавлен в сообщество (или уже был).";
      }

      if (action === "widget") {
        const gid = Number(groupId);
        if (!gid) {
          note.textContent = "Нет vk_group_id. Откройте плагин из сообщества.";
          return;
        }
        const { servers, events } = await loadWidgetData();
        const code = buildWidgetCode(servers, events, appId);
        await b.send("VKWebAppShowCommunityWidgetPreviewBox", {
          group_id: gid,
          type: "table",
          code,
        });
        note.textContent = "В окне VK подтвердите установку виджета.";
      }

      if (action === "token") {
        const gid = Number(groupId);
        if (!gid) {
          note.textContent = "Нет vk_group_id. Откройте плагин из сообщества.";
          return;
        }
        const payload = { group_id: gid, scope: "app_widget" };
        if (appId) payload.app_id = Number(appId);
        const result = await b.send("VKWebAppGetCommunityToken", payload);
        const token = result?.access_token || "";
        if (!token) {
          note.textContent = "Токен не получен. Нужны права админа.";
          return;
        }
        note.textContent =
          "Токен получен. Сохраните в .env как VK_COMMUNITY_TOKEN и запускайте start-30s.bat";
        console.log("VK_COMMUNITY_TOKEN:", token);
        try {
          await navigator.clipboard.writeText(token);
          note.textContent += " (скопирован).";
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
  const appId = params.vk_app_id || "";
  const isAdmin = ["admin", "editor", "moder"].includes(role);
  const force = params.admin === "1";

  if ((isAdmin && groupId) || force) {
    showAdminBar(groupId, appId);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWidgetAdmin);
} else {
  initWidgetAdmin();
}
