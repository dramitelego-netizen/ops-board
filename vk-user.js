/**
 * Показ текущего пользователя VK + локальный журнал заходов (для админов).
 * Общий журнал на всех нужен бэкенд — позже можно подключить API.
 */

const VISITS_KEY = "futurum_visits_v1";
const MAX_VISITS = 40;

function getLaunchParams() {
  const out = {};
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  for (const [k, v] of search.entries()) out[k] = v;
  for (const [k, v] of hash.entries()) if (!(k in out)) out[k] = v;
  return out;
}

function bridge() {
  return window.vkBridge || null;
}

function roleLabel(role) {
  const map = {
    admin: "Админ",
    editor: "Редактор",
    moder: "Модератор",
    member: "Участник",
    none: "Гость",
  };
  return map[role] || role || "—";
}

function loadVisits() {
  try {
    return JSON.parse(localStorage.getItem(VISITS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveVisit(entry) {
  const list = loadVisits().filter((v) => v.id !== entry.id || v.at !== entry.at);
  list.unshift(entry);
  localStorage.setItem(VISITS_KEY, JSON.stringify(list.slice(0, MAX_VISITS)));
}

function renderUser(user) {
  const root = document.getElementById("user-chip");
  if (!root) return;

  if (!user) {
    root.hidden = true;
    return;
  }

  root.hidden = false;
  root.innerHTML = `
    <img class="user-avatar" src="${user.photo || ""}" alt="" width="28" height="28" />
    <div class="user-meta">
      <strong>Вы вошли как ${escapeText(user.name)}</strong>
      <span>id ${escapeText(user.id)} · ${escapeText(user.roleLabel)}</span>
    </div>
  `;
}

function renderVisits(isAdmin) {
  const panel = document.getElementById("visits-panel");
  const listEl = document.getElementById("visits-list");
  if (!panel || !listEl) return;

  if (!isAdmin) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  const visits = loadVisits();
  if (!visits.length) {
    listEl.innerHTML = `<li class="visit-item">Пока нет записей на этом устройстве</li>`;
    return;
  }

  listEl.innerHTML = visits
    .slice(0, 12)
    .map(
      (v) => `
      <li class="visit-item">
        <strong>${escapeText(v.name)}</strong>
        <span>${escapeText(v.at)} · id ${escapeText(v.id)} · ${escapeText(v.roleLabel)}</span>
      </li>
    `
    )
    .join("");
}

function escapeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function resolveUser(params) {
  const userId = params.vk_user_id || "";
  const role = params.vk_viewer_group_role || "none";
  const groupId = params.vk_group_id || "";
  const b = bridge();

  let name = userId ? `id${userId}` : "Гость";
  let photo = "";

  if (b) {
    try {
      const info = await b.send("VKWebAppGetUserInfo");
      const first = info?.first_name || "";
      const last = info?.last_name || "";
      name = `${first} ${last}`.trim() || name;
      photo = info?.photo_200 || info?.photo_100 || "";
    } catch {
      // вне VK или отказ
    }
  }

  return {
    id: String(userId || "0"),
    name,
    photo,
    role,
    roleLabel: roleLabel(role),
    groupId: String(groupId || ""),
  };
}

async function initVkUser() {
  const params = getLaunchParams();
  const inVk = Boolean(params.vk_user_id || bridge());
  const isAdmin = ["admin", "editor", "moder"].includes(params.vk_viewer_group_role || "");

  if (!inVk && !params.vk_user_id) {
    renderUser(null);
    const chip = document.getElementById("user-chip");
    if (chip) {
      chip.hidden = false;
      chip.innerHTML = `
        <div class="user-meta">
          <strong>Откройте из VK</strong>
          <span>тогда увидите, кто вошёл</span>
        </div>
      `;
    }
    renderVisits(false);
    return;
  }

  const user = await resolveUser(params);
  renderUser(user);

  const at = new Date().toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  saveVisit({
    id: user.id,
    name: user.name,
    roleLabel: user.roleLabel,
    groupId: user.groupId,
    at,
  });

  renderVisits(isAdmin);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initVkUser);
} else {
  initVkUser();
}
