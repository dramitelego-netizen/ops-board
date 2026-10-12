/**
 * Дашборд: мониторинг слева, события справа.
 * Обновления статуса без пересоздания списка (без дёрганья).
 */

const REFRESH_MS = 30000;

const fallbackServers = [
  { id: "list", name: "Server list", ip: "195.211.128.131", port: 4000, color: "slate", online: false, ping: null },
  { id: "white", name: "Белый", ip: "195.211.128.130", port: 2001, color: "white", online: false, ping: null },
  { id: "blue", name: "Синий", ip: "195.211.128.136", port: 2001, color: "blue", online: false, ping: null },
  { id: "green", name: "Зелёный", ip: "195.211.128.133", port: 2001, color: "green", online: false, ping: null },
  { id: "red", name: "Красный", ip: "195.211.128.132", port: 2001, color: "red", online: false, ping: null },
  { id: "yellow", name: "Жёлтый", ip: "195.211.128.131", port: 2001, color: "yellow", online: false, ping: null },
];

const fallbackEvents = [
  {
    id: "e1",
    title: "Пока на проверке",
    when: "Скоро",
    place: "Раздел событий",
    text: "События временно скрыты. Скоро здесь появится актуальная информация.",
  },
];

const serverList = document.getElementById("server-list");
const eventList = document.getElementById("event-list");
const lastUpdate = document.getElementById("last-update");
const serversSummary = document.getElementById("servers-summary");

let servers = fallbackServers.map((s) => ({ ...s }));
let events = fallbackEvents.map((e) => ({ ...e }));
let listBuilt = false;
let eventsSignature = "";

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

/** 0..1 — чем выше, тем лучше пинг */
function pingQuality(ping, online) {
  if (!online || ping == null) return 0;
  return Math.max(0, Math.min(1, 1 - ping / 160));
}

function pingTone(quality, online) {
  if (!online || quality <= 0) return "bad";
  if (quality >= 0.7) return "good";
  if (quality >= 0.4) return "mid";
  return "bad";
}

const ARC_LEN = 88; // длина окружности для r≈14

function arcOffset(quality) {
  return (ARC_LEN * (1 - quality)).toFixed(1);
}

function pingArcHtml(ping, online) {
  const quality = pingQuality(ping, online);
  const tone = pingTone(quality, online);
  const offset = arcOffset(quality);
  return `
    <svg class="ping-arc tone-${tone}" viewBox="0 0 36 36" aria-hidden="true">
      <circle class="ping-arc-bg" cx="18" cy="18" r="14"></circle>
      <circle
        class="ping-arc-fg"
        cx="18" cy="18" r="14"
        stroke-dasharray="${ARC_LEN}"
        stroke-dashoffset="${offset}"
        transform="rotate(-90 18 18)"
      ></circle>
    </svg>
  `;
}

function buildServers() {
  serverList.innerHTML = servers
    .map((server) => {
      const online = Boolean(server.online);
      const quality = pingQuality(server.ping, online);
      const tone = pingTone(quality, online);
      return `
      <li
        class="server-item color-${server.color || "slate"} ${online ? "is-online" : "is-offline"} tone-${tone}"
        data-id="${escapeHtml(server.id)}"
        style="--ping-q:${quality.toFixed(3)}"
      >
        <span class="strip" aria-hidden="true"></span>
        <span class="dot" aria-hidden="true"></span>
        <h3 class="server-name">${escapeHtml(server.name)}</h3>
        <div class="badge-slot">${statusBadge(online)}</div>
        <div class="ping-box">
          ${pingArcHtml(server.ping, online)}
          <div class="stat">
            <span class="stat-label">Пинг</span>
            <strong data-ping>${online && server.ping != null ? `${server.ping}` : "—"}</strong>
          </div>
        </div>
      </li>
    `;
    })
    .join("");
  listBuilt = true;
  updateSummary();
}

function updateSummary() {
  const onlineCount = servers.filter((s) => s.online).length;
  serversSummary.textContent = `${onlineCount} / ${servers.length} онлайн`;
}

function patchServers() {
  if (!listBuilt || serverList.children.length !== servers.length) {
    buildServers();
    return;
  }

  for (const server of servers) {
    const row = serverList.querySelector(`[data-id="${server.id}"]`);
    if (!row) {
      buildServers();
      return;
    }

    const online = Boolean(server.online);
    const quality = pingQuality(server.ping, online);
    const tone = pingTone(quality, online);

    row.classList.toggle("is-online", online);
    row.classList.toggle("is-offline", !online);
    row.classList.remove("tone-good", "tone-mid", "tone-bad");
    row.classList.add(`tone-${tone}`);
    row.style.setProperty("--ping-q", quality.toFixed(3));

    const badgeSlot = row.querySelector(".badge-slot");
    const nextBadge = statusBadge(online);
    if (badgeSlot && badgeSlot.innerHTML !== nextBadge) {
      badgeSlot.innerHTML = nextBadge;
    }

    const arc = row.querySelector(".ping-arc");
    const arcFg = row.querySelector(".ping-arc-fg");
    if (arc) {
      arc.classList.remove("tone-good", "tone-mid", "tone-bad");
      arc.classList.add(`tone-${tone}`);
    }
    if (arcFg) {
      arcFg.setAttribute("stroke-dashoffset", arcOffset(quality));
    }

    const pingEl = row.querySelector("[data-ping]");
    if (pingEl) {
      pingEl.textContent = online && server.ping != null ? `${server.ping}` : "—";
    }
  }

  updateSummary();
}

function renderEvents() {
  const signature = JSON.stringify(events);
  if (signature === eventsSignature && eventList.children.length) return;
  eventsSignature = signature;

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

function applyStatus(nextServers, updatedAt) {
  servers = nextServers;
  patchServers();
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

  patchServers();
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
  buildServers();
  renderEvents();
  fetchEvents();
  fetchStatus();
  setInterval(fetchStatus, REFRESH_MS);
  setInterval(fetchEvents, 60000);
}

init();
