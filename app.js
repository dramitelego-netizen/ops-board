/**
 * Дашборд: мониторинг слева, события справа.
 * 1) пробует живой API (monitor.py)
 * 2) иначе берёт status.json (GitHub Actions)
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

const events = [
  { id: "e1", title: "Ночной вайп", when: "Сегодня · 23:00", place: "Все серверы" },
  { id: "e2", title: "Турнир PvP", when: "Завтра · 19:00", place: "Красный" },
  { id: "e3", title: "Ивент на босса", when: "Сб · 17:00", place: "Синий" },
];

const serverList = document.getElementById("server-list");
const eventList = document.getElementById("event-list");
const lastUpdate = document.getElementById("last-update");
const serversSummary = document.getElementById("servers-summary");

let servers = fallbackServers.map((s) => ({ ...s }));

function statusBadge(online) {
  return online
    ? `<span class="badge badge-online">On</span>`
    : `<span class="badge badge-offline">Off</span>`;
}

function renderServers() {
  const onlineCount = servers.filter((s) => s.online).length;
  serversSummary.textContent = `${onlineCount} / ${servers.length} онлайн`;

  serverList.innerHTML = servers
    .map(
      (server) => `
      <li class="server-item color-${server.color || "slate"}" data-id="${server.id}">
        <span class="dot" aria-hidden="true"></span>
        <div class="server-main">
          <h3 class="server-name">${server.name}</h3>
          <p class="server-addr">${server.ip}:${server.port}</p>
        </div>
        ${statusBadge(Boolean(server.online))}
        <div class="stat" data-metric="ping">
          <span class="stat-label">Пинг</span>
          ${server.online && server.ping != null ? `${server.ping}` : "—"}
        </div>
      </li>
    `
    )
    .join("");
}

function renderEvents() {
  eventList.innerHTML = events
    .map(
      (event) => `
      <li class="event-item">
        <p class="event-when">${event.when}</p>
        <h3 class="event-title">${event.title}</h3>
        <p class="event-place">${event.place}</p>
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
  const sources = [
    "./api/status",
    "/api/status",
    "./status.json",
  ];

  for (const url of sources) {
    try {
      const data = await loadJson(url);
      if (!data || !Array.isArray(data.servers)) continue;
      applyStatus(data.servers, data.updatedAt);
      return;
    } catch {
      // пробуем следующий источник
    }
  }

  renderServers();
  lastUpdate.textContent = "нет связи";
}

function init() {
  renderServers();
  renderEvents();
  fetchStatus();
  setInterval(fetchStatus, REFRESH_MS);
}

init();
