/**
 * Дашборд: мониторинг слева, события справа.
 * Серверы: API / status.json
 * События: events.json (позже можно подтягивать из VK)
 */

const REFRESH_MS = 15000;

const fallbackServers = [
  { id: "list", name: "Server list", ip: "195.211.128.131", port: 4000, color: "slate", online: false, ping: null },
  { id: "white", name: "Белый", ip: "195.211.128.130", port: 2001, color: "white", online: false, ping: null },
  { id: "blue", name: "Синий", ip: "195.211.128.136", port: 2001, color: "blue", online: false, ping: null },
  { id: "green", name: "Зелёный", ip: "195.211.128.133", port: 2001, color: "green", online: false, ping: null },
  { id: "red", name: "Красный", ip: "195.211.128.132", port: 2001, color: "red", online: false, ping: null },
  { id: "yellow", name: "Жёлтый", ip: "195.211.128.131", port: 2001, color: "yellow", online: false, ping: null },
];

const fallbackEvents = [
  { id: "e1", title: "Ночной вайп", when: "Сегодня · 23:00", place: "Все серверы", text: "" },
  { id: "e2", title: "Турнир PvP", when: "Завтра · 19:00", place: "Красный", text: "" },
  { id: "e3", title: "Ивент на босса", when: "Сб · 17:00", place: "Синий", text: "" },
];

const serverList = document.getElementById("server-list");
const eventList = document.getElementById("event-list");
const lastUpdate = document.getElementById("last-update");
const serversSummary = document.getElementById("servers-summary");

let servers = fallbackServers.map((s) => ({ ...s }));
let events = fallbackEvents.map((e) => ({ ...e }));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusBadge(online) {
  return online
    ? `<span class="badge badge-online"><span class="badge-pulse"></span>Online</span>`
    : `<span class="badge badge-offline">Offline</span>`;
}

function pingLevel(ping, online) {
  if (!online || ping == null) return 0;
  if (ping <= 30) return 3;
  if (ping <= 80) return 2;
  return 1;
}

function renderServers() {
  const onlineCount = servers.filter((s) => s.online).length;
  serversSummary.textContent = `${onlineCount} / ${servers.length} онлайн`;

  serverList.innerHTML = servers
    .map((server, index) => {
      const online = Boolean(server.online);
      const level = pingLevel(server.ping, online);
      return `
      <li
        class="server-item color-${server.color || "slate"} ${online ? "is-online" : "is-offline"}"
        data-id="${escapeHtml(server.id)}"
        style="--i:${index}"
      >
        <span class="strip" aria-hidden="true"></span>
        <span class="dot" aria-hidden="true"></span>
        <h3 class="server-name">${escapeHtml(server.name)}</h3>
        ${statusBadge(online)}
        <div class="ping-box" data-metric="ping">
          <div class="ping-bars" aria-hidden="true" data-level="${level}">
            <span></span><span></span><span></span>
          </div>
          <div class="stat">
            <span class="stat-label">Пинг</span>
            <strong>${online && server.ping != null ? `${server.ping}` : "—"}</strong>
          </div>
        </div>
      </li>
    `;
    })
    .join("");
}

function renderEvents() {
  eventList.innerHTML = events
    .map(
      (event) => `
      <li class="event-item">
        <p class="event-when">${escapeHtml(event.when)}</p>
        <h3 class="event-title">${escapeHtml(event.title)}</h3>
        <p class="event-place">${escapeHtml(event.place || "")}</p>
        ${
          event.text
            ? `<p class="event-text">${escapeHtml(event.text)}</p>`
            : ""
        }
      </li>
    `
    )
    .join("");
}

function flash(el) {
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

function applyStatus(nextServers, updatedAt) {
  const prev = new Map(servers.map((s) => [s.id, s]));
  servers = nextServers;
  renderServers();

  for (const server of servers) {
    const old = prev.get(server.id);
    if (!old) continue;
    const row = serverList.querySelector(`[data-id="${server.id}"]`);
    if (!row) continue;
    if (old.ping !== server.ping || old.online !== server.online) {
      flash(row.querySelector('[data-metric="ping"]'));
    }
  }

  lastUpdate.textContent = updatedAt || "—";
}

async function loadJson(url) {
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchStatus() {
  const sources = ["./api/status", "/api/status", "./status.json"];

  for (const url of sources) {
    try {
      const data = await loadJson(url);
      if (!data || !Array.isArray(data.servers)) continue;
      applyStatus(data.servers, data.updatedAt);
      return;
    } catch {
      // next source
    }
  }

  renderServers();
  lastUpdate.textContent = "нет связи";
}

async function fetchEvents() {
  try {
    const data = await loadJson("./events.json");
    if (data && Array.isArray(data.events)) {
      events = data.events;
      renderEvents();
    }
  } catch {
    renderEvents();
  }
}

function init() {
  renderServers();
  renderEvents();
  fetchEvents();
  fetchStatus();
  setInterval(fetchStatus, REFRESH_MS);
  setInterval(fetchEvents, 60000);
}

init();
