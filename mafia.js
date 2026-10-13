/**
 * FUTURUM Мафия — многопользовательская комната через PeerJS (хост = сервер).
 * 4–10 игроков. Роли: мафия, комиссар, доктор, мирные.
 */

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 10;
const ROLE_REVEAL_SEC = 6;
const NIGHT_SEC = 28;
const DAY_SEC = 22;
const VOTE_SEC = 28;
const RESULT_SEC = 6;

const ROLE_INFO = {
  mafia: {
    title: "Мафия",
    desc: "Ночью выбираете жертву вместе с напарниками. Днём притворяйтесь мирным.",
    className: "role-mafia",
  },
  cop: {
    title: "Комиссар",
    desc: "Ночью проверяете одного игрока: мафия это или нет.",
    className: "role-cop",
  },
  doctor: {
    title: "Доктор",
    desc: "Ночью можете спасти одного игрока от выстрела мафии.",
    className: "role-doctor",
  },
  civilian: {
    title: "Мирный",
    desc: "Выживайте, обсуждайте и голосуйте. Найдите мафию днём.",
    className: "role-civilian",
  },
};

const $ = (id) => document.getElementById(id);

const ui = {
  home: $("screen-home"),
  lobby: $("screen-lobby"),
  role: $("screen-role"),
  night: $("screen-night"),
  day: $("screen-day"),
  vote: $("screen-vote"),
  result: $("screen-result"),
  name: $("name-input"),
  joinCode: $("join-code"),
  roomBadge: $("room-badge"),
  roomCodeView: $("room-code-view"),
  lobbyList: $("lobby-list"),
  lobbyN: $("lobby-n"),
  lobbyHint: $("lobby-hint"),
  btnStart: $("btn-start"),
  btnCopy: $("btn-copy"),
  btnCreate: $("btn-create"),
  btnJoin: $("btn-join"),
  btnAgain: $("btn-again"),
  roleCard: $("role-card"),
  roleName: $("role-name"),
  roleDesc: $("role-desc"),
  roleTimer: $("role-timer"),
  nightTitle: $("night-title"),
  nightSub: $("night-sub"),
  nightList: $("night-list"),
  nightTimer: $("night-timer"),
  dayEvent: $("day-event"),
  dayList: $("day-list"),
  dayTimer: $("day-timer"),
  voteList: $("vote-list"),
  voteTimer: $("vote-timer"),
  resultKicker: $("result-kicker"),
  resultTitle: $("result-title"),
  resultText: $("result-text"),
  resultList: $("result-list"),
  status: $("status-line"),
};

let peer = null;
let hostConn = null; // client → host
const clientConns = new Map(); // host: peerId → DataConnection
let isHost = false;
let myId = "";
let myName = "";
let roomCode = "";
let localRole = null;
let pickedId = null;
let phaseTimer = null;
let tickTimer = null;
let advancing = false;
let nightPriv = null;

/** Shared snapshot from host */
let state = {
  phase: "lobby", // lobby | role | night | day | vote | result | end
  players: [], // {id,name,alive,role?,isHost}
  night: { kill: null, save: null, check: null, checks: {} },
  votes: {},
  lastEvent: "",
  winner: null, // town | mafia | null
  endsAt: 0,
};

function setStatus(text) {
  ui.status.textContent = text || "";
}

function showScreen(name) {
  for (const key of ["home", "lobby", "role", "night", "day", "vote", "result"]) {
    ui[key].hidden = key !== name;
  }
}

function codeGen() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

function peerIdFromCode(code) {
  return `futurum-mafia-${code.toUpperCase()}`;
}

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function me() {
  return state.players.find((p) => p.id === myId);
}

function alivePlayers() {
  return state.players.filter((p) => p.alive);
}

function assignRoles(players) {
  const n = players.length;
  let mafiaCount = 1;
  if (n >= 6) mafiaCount = 2;
  if (n >= 9) mafiaCount = 3;

  const roles = [];
  for (let i = 0; i < mafiaCount; i++) roles.push("mafia");
  roles.push("cop");
  if (n >= 6) roles.push("doctor");
  while (roles.length < n) roles.push("civilian");

  for (let i = roles.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  return players.map((p, i) => ({
    ...p,
    alive: true,
    role: roles[i],
  }));
}

function publicPlayers() {
  return state.players.map((p) => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    isHost: p.isHost,
    role: state.phase === "end" || state.winner ? p.role : undefined,
  }));
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const conn of clientConns.values()) {
    if (conn.open) conn.send(data);
  }
}

function sendToHost(msg) {
  if (hostConn?.open) hostConn.send(JSON.stringify(msg));
}

function pushState(extra = {}) {
  if (!isHost) return;
  const payload = {
    type: "state",
    state: {
      phase: state.phase,
      players: publicPlayers(),
      lastEvent: state.lastEvent,
      winner: state.winner,
      endsAt: state.endsAt,
      ...extra,
    },
  };
  // Host also keeps private roles; send personalized role to each client
  broadcast(payload);
  for (const conn of clientConns.values()) {
    if (!conn.open) continue;
    const pl = state.players.find((p) => p.id === conn.peer);
    if (pl) {
      conn.send(
        JSON.stringify({
          type: "you",
          role: pl.role,
          nightPrivate: nightPrivateFor(pl),
        })
      );
    }
  }
  // Host local
  const self = me();
  if (self) {
    localRole = self.role;
    applyStateView({
      ...payload.state,
      _nightPrivate: nightPrivateFor(self),
    });
  }
}

function nightPrivateFor(pl) {
  if (!pl || state.phase !== "night") return null;
  if (pl.role === "mafia") {
    return {
      action: "kill",
      mates: state.players.filter((p) => p.role === "mafia" && p.alive).map((p) => p.name),
    };
  }
  if (pl.role === "cop") return { action: "check" };
  if (pl.role === "doctor") return { action: "save" };
  return { action: "wait" };
}

function applyStateView(snap) {
  state.phase = snap.phase;
  state.players = snap.players.map((p) => {
    const prev = state.players.find((x) => x.id === p.id);
    return { ...prev, ...p, role: p.role ?? prev?.role };
  });
  state.lastEvent = snap.lastEvent || "";
  state.winner = snap.winner;
  state.endsAt = snap.endsAt || 0;

  ui.roomBadge.hidden = !roomCode;
  ui.roomCodeView.textContent = roomCode || "————";

  if (snap._nightPrivate) {
    renderNight(snap._nightPrivate);
  }

  renderPhase();
}

function secondsLeft() {
  if (!state.endsAt) return 0;
  return Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
}

function startLocalTicker() {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    const left = secondsLeft();
    for (const el of [ui.roleTimer, ui.nightTimer, ui.dayTimer, ui.voteTimer]) {
      if (el && !el.closest(".screen")?.hidden) el.textContent = String(left);
    }
    if (
      isHost &&
      !advancing &&
      state.endsAt &&
      left <= 0 &&
      state.phase !== "lobby" &&
      state.phase !== "end"
    ) {
      advancing = true;
      hostAdvance();
    }
  }, 250);
}

function renderPlayerList(container, { pickable = false, showDead = true, allowSelf = false } = {}) {
  container.innerHTML = "";
  for (const p of state.players) {
    if (!showDead && !p.alive) continue;
    const btn = document.createElement(pickable ? "button" : "li");
    if (pickable) btn.type = "button";
    btn.className = "player-chip";
    if (p.isHost) btn.classList.add("is-host");
    if (!p.alive) btn.classList.add("is-dead");
    if (p.id === myId) btn.classList.add("is-self");
    if (pickedId === p.id) btn.classList.add("is-picked");

    btn.innerHTML = `
      <span class="avatar">${initials(p.name)}</span>
      <span class="meta">
        <strong>${escapeHtml(p.name)}</strong>
        <small>${p.id === myId ? "вы" : p.isHost ? "хост" : p.alive ? "в игре" : "выбыл"}</small>
      </span>
    `;

    if (pickable) {
      const canPick = p.alive && (allowSelf || p.id !== myId);
      btn.disabled = !canPick;
      if (canPick) {
        btn.addEventListener("click", () => onPick(p.id));
      }
    }

    container.appendChild(btn);
  }
}

function escapeHtml(v) {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderLobby() {
  showScreen("lobby");
  ui.lobbyN.textContent = String(state.players.length);
  renderPlayerList(ui.lobbyList, { pickable: false });
  const host = isHost;
  ui.btnStart.hidden = !host;
  ui.btnStart.disabled = state.players.length < MIN_PLAYERS;
  ui.lobbyHint.textContent = host
    ? state.players.length < MIN_PLAYERS
      ? `Ждём ещё ${MIN_PLAYERS - state.players.length}… Отправьте код друзьям`
      : "Все на месте — можно начинать"
    : "Ждём, пока хост начнёт игру";
}

function renderRole() {
  showScreen("role");
  const info = ROLE_INFO[localRole] || ROLE_INFO.civilian;
  ui.roleCard.className = `role-card ${info.className}`;
  ui.roleName.textContent = info.title;
  ui.roleDesc.textContent = info.desc;
  ui.roleTimer.textContent = String(secondsLeft());
}

function renderNight(priv) {
  showScreen("night");
  ui.nightTimer.textContent = String(secondsLeft());
  const action = priv?.action || "wait";

  nightPriv = priv;
  if (action === "kill") {
    ui.nightTitle.textContent = "Ход мафии";
    ui.nightSub.textContent = priv.mates?.length
      ? `Напарники: ${priv.mates.join(", ")}. Выберите жертву.`
      : "Выберите жертву.";
    renderPlayerList(ui.nightList, { pickable: true, showDead: true });
  } else if (action === "check") {
    ui.nightTitle.textContent = "Проверка комиссара";
    ui.nightSub.textContent = "Кого проверить?";
    renderPlayerList(ui.nightList, { pickable: true, showDead: true });
  } else if (action === "save") {
    ui.nightTitle.textContent = "Ход доктора";
    ui.nightSub.textContent = "Кого спасти этой ночью? Можно и себя.";
    renderPlayerList(ui.nightList, { pickable: true, showDead: true, allowSelf: true });
  } else {
    ui.nightTitle.textContent = "Город спит";
    ui.nightSub.textContent = "Дождитесь утра. Ночные роли делают ход.";
    ui.nightList.innerHTML = "";
  }
}

function renderDay() {
  showScreen("day");
  ui.dayEvent.textContent = state.lastEvent || "Тихая ночь.";
  ui.dayTimer.textContent = String(secondsLeft());
  renderPlayerList(ui.dayList, { pickable: false });
}

function renderVote() {
  showScreen("vote");
  ui.voteTimer.textContent = String(secondsLeft());
  const self = me();
  if (self && !self.alive) {
    ui.voteList.innerHTML = "";
    setStatus("Вы выбыли — только наблюдаете");
    return;
  }
  renderPlayerList(ui.voteList, { pickable: true });
}

function renderResult() {
  showScreen("result");
  if (state.winner === "town") {
    ui.resultKicker.textContent = "победа города";
    ui.resultTitle.textContent = "Мирные победили";
    ui.resultText.textContent = "Мафия разоблачена. Город может выдохнуть.";
  } else if (state.winner === "mafia") {
    ui.resultKicker.textContent = "победа мафии";
    ui.resultTitle.textContent = "Мафия победила";
    ui.resultText.textContent = "Тень накрыла город. Мирных осталось слишком мало.";
  } else {
    ui.resultKicker.textContent = "изгнание";
    ui.resultTitle.textContent = "Итог голосования";
    ui.resultText.textContent = state.lastEvent || "";
  }
  renderPlayerList(ui.resultList, { pickable: false });
  ui.btnAgain.hidden = !isHost || !state.winner;
}

function renderPhase() {
  pickedId = null;
  setStatus("");
  switch (state.phase) {
    case "lobby":
      renderLobby();
      break;
    case "role":
      renderRole();
      break;
    case "night":
      // night private arrives via "you" — if missing, show wait
      if (ui.night.hidden) renderNight({ action: "wait" });
      break;
    case "day":
      renderDay();
      break;
    case "vote":
      renderVote();
      break;
    case "result":
    case "end":
      renderResult();
      break;
    default:
      break;
  }
}

function onPick(targetId) {
  pickedId = targetId;
  if (state.phase === "night") {
    const allowSelf = nightPriv?.action === "save";
    renderPlayerList(ui.nightList, { pickable: true, allowSelf });
    const msg = { type: "night_action", targetId };
    if (isHost) handleHostMessage(myId, msg);
    else sendToHost(msg);
  } else if (state.phase === "vote") {
    renderPlayerList(ui.voteList, { pickable: true });
    const msg = { type: "vote", targetId };
    if (isHost) handleHostMessage(myId, msg);
    else sendToHost(msg);
  }
}

function hostSetPhase(phase, sec) {
  advancing = false;
  state.phase = phase;
  state.endsAt = Date.now() + sec * 1000;
  if (phase === "night") {
    state.night = { kill: null, save: null, check: null, checks: {} };
  }
  if (phase === "vote") {
    state.votes = {};
  }
  pushState();
  if (phase === "night") {
    renderNight(nightPrivateFor(me()));
  }
}

function hostAdvance() {
  if (!isHost) return;
  clearTimeout(phaseTimer);

  if (state.phase === "role") {
    hostSetPhase("night", NIGHT_SEC);
  } else if (state.phase === "night") {
    resolveNight();
  } else if (state.phase === "day") {
    hostSetPhase("vote", VOTE_SEC);
  } else if (state.phase === "vote") {
    resolveVote();
  } else if (state.phase === "result") {
    if (state.winner) {
      state.phase = "end";
      state.endsAt = 0;
      pushState();
    } else {
      hostSetPhase("night", NIGHT_SEC);
    }
  }
}

function resolveNight() {
  const killId = state.night.kill;
  const saveId = state.night.save;
  let event = "Ночь прошла спокойно. Никто не пострадал.";

  if (killId && killId !== saveId) {
    const victim = state.players.find((p) => p.id === killId);
    if (victim && victim.alive) {
      victim.alive = false;
      event = `Ночью погиб${victim.name.endsWith("а") ? "ла" : ""} ${victim.name}.`;
    }
  } else if (killId && killId === saveId) {
    event = "Мафия стреляла, но доктор спас цель.";
  }

  // Commissioner check feedback only to cop via next "you" — store result
  if (state.night.check) {
    const target = state.players.find((p) => p.id === state.night.check);
    const cop = state.players.find((p) => p.role === "cop" && p.alive);
    if (cop && target) {
      state.night.checks[cop.id] = {
        name: target.name,
        isMafia: target.role === "mafia",
      };
    }
  }

  const win = checkWin();
  state.lastEvent = event;
  if (win) {
    state.winner = win;
    state.phase = "end";
    state.endsAt = 0;
    // reveal roles
    pushState();
    applyEndReveal();
    return;
  }

  hostSetPhase("day", DAY_SEC);

  // Send check result privately
  const cop = state.players.find((p) => p.role === "cop");
  if (cop && state.night.checks[cop.id]) {
    const info = state.night.checks[cop.id];
    const text = `${info.name}: ${info.isMafia ? "МАФИЯ" : "не мафия"}`;
    if (cop.id === myId) setStatus(`Проверка: ${text}`);
    else {
      const conn = clientConns.get(cop.id);
      if (conn?.open) conn.send(JSON.stringify({ type: "check_result", text }));
    }
  }
}

function resolveVote() {
  const counts = {};
  for (const [voterId, targetId] of Object.entries(state.votes)) {
    const voter = state.players.find((p) => p.id === voterId);
    if (!voter?.alive) continue;
    counts[targetId] = (counts[targetId] || 0) + 1;
  }

  let best = null;
  let bestN = 0;
  let tie = false;
  for (const [id, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = id;
      bestN = n;
      tie = false;
    } else if (n === bestN) {
      tie = true;
    }
  }

  if (!best || bestN === 0 || tie) {
    state.lastEvent = "Город не смог договориться. Никого не изгнали.";
  } else {
    const victim = state.players.find((p) => p.id === best);
    if (victim) {
      victim.alive = false;
      const roleTitle = ROLE_INFO[victim.role]?.title || victim.role;
      state.lastEvent = `Изгнан${victim.name.endsWith("а") ? "а" : ""} ${victim.name}. Роль: ${roleTitle}.`;
    }
  }

  const win = checkWin();
  if (win) {
    state.winner = win;
    state.phase = "end";
    state.endsAt = 0;
    pushState();
    applyEndReveal();
    return;
  }

  hostSetPhase("result", RESULT_SEC);
}

function checkWin() {
  const alive = alivePlayers();
  const mafia = alive.filter((p) => p.role === "mafia").length;
  const town = alive.length - mafia;
  if (mafia === 0) return "town";
  if (mafia >= town) return "mafia";
  return null;
}

function applyEndReveal() {
  // ensure roles visible on host UI
  state.players = state.players.map((p) => ({ ...p }));
  renderResult();
}

function handleHostMessage(fromId, msg) {
  if (!isHost) return;

  if (msg.type === "hello") {
    if (state.phase !== "lobby") {
      const conn = clientConns.get(fromId);
      conn?.send(JSON.stringify({ type: "error", text: "Игра уже идёт" }));
      return;
    }
    if (state.players.length >= MAX_PLAYERS) {
      clientConns.get(fromId)?.send(JSON.stringify({ type: "error", text: "Комната полная" }));
      return;
    }
    if (!state.players.some((p) => p.id === fromId)) {
      state.players.push({
        id: fromId,
        name: String(msg.name || "Игрок").slice(0, 16),
        alive: true,
        isHost: false,
      });
    }
    pushState();
    return;
  }

  if (msg.type === "night_action") {
    const pl = state.players.find((p) => p.id === fromId);
    if (!pl?.alive || state.phase !== "night") return;
    const target = state.players.find((p) => p.id === msg.targetId && p.alive);
    if (!target) return;
    if (pl.role === "mafia") state.night.kill = target.id;
    if (pl.role === "doctor") state.night.save = target.id;
    if (pl.role === "cop") state.night.check = target.id;
    return;
  }

  if (msg.type === "vote") {
    const pl = state.players.find((p) => p.id === fromId);
    if (!pl?.alive || state.phase !== "vote") return;
    const target = state.players.find((p) => p.id === msg.targetId && p.alive);
    if (!target || target.id === fromId) return;
    state.votes[fromId] = target.id;
    return;
  }

  if (msg.type === "start") {
    if (fromId !== myId) return;
    hostStartGame();
  }
}

function hostStartGame() {
  if (!isHost || state.players.length < MIN_PLAYERS) return;
  state.players = assignRoles(state.players);
  state.winner = null;
  state.lastEvent = "";
  localRole = me()?.role;
  hostSetPhase("role", ROLE_REVEAL_SEC);
}

function wireConn(conn, asHostSide) {
  conn.on("data", (raw) => {
    let msg;
    try {
      msg = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return;
    }
    if (asHostSide) {
      handleHostMessage(conn.peer, msg);
    } else {
      handleClientMessage(msg);
    }
  });
  conn.on("close", () => {
    if (asHostSide) {
      clientConns.delete(conn.peer);
      if (state.phase === "lobby") {
        state.players = state.players.filter((p) => p.id !== conn.peer);
        pushState();
      }
    } else {
      setStatus("Связь с хостом потеряна");
    }
  });
}

function handleClientMessage(msg) {
  if (msg.type === "state") {
    applyStateView(msg.state);
  }
  if (msg.type === "you") {
    localRole = msg.role;
    if (state.phase === "role") renderRole();
    if (state.phase === "night") renderNight(msg.nightPrivate);
  }
  if (msg.type === "check_result") {
    setStatus(`Проверка: ${msg.text}`);
  }
  if (msg.type === "error") {
    setStatus(msg.text);
    alert(msg.text);
  }
}

async function createRoom() {
  myName = (ui.name.value || "").trim() || "Хост";
  roomCode = codeGen();
  isHost = true;
  setStatus("Создаём комнату…");

  peer = new Peer(peerIdFromCode(roomCode), { debug: 0 });

  await new Promise((resolve, reject) => {
    peer.on("open", resolve);
    peer.on("error", reject);
  });

  myId = peer.id;
  state = {
    phase: "lobby",
    players: [{ id: myId, name: myName, alive: true, isHost: true }],
    night: { kill: null, save: null, check: null, checks: {} },
    votes: {},
    lastEvent: "",
    winner: null,
    endsAt: 0,
  };

  peer.on("connection", (conn) => {
    clientConns.set(conn.peer, conn);
    conn.on("open", () => {
      wireConn(conn, true);
      // wait for hello
    });
  });

  startLocalTicker();
  pushState();
  setStatus("Комната создана");
}

async function joinRoom() {
  myName = (ui.name.value || "").trim() || "Игрок";
  roomCode = (ui.joinCode.value || "").trim().toUpperCase();
  if (roomCode.length < 4) {
    setStatus("Введите код комнаты");
    return;
  }
  isHost = false;
  setStatus("Подключаемся…");

  peer = new Peer({ debug: 0 });
  await new Promise((resolve, reject) => {
    peer.on("open", resolve);
    peer.on("error", reject);
  });
  myId = peer.id;

  hostConn = peer.connect(peerIdFromCode(roomCode), { reliable: true });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 12000);
    hostConn.on("open", () => {
      clearTimeout(t);
      resolve();
    });
    hostConn.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    peer.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });

  wireConn(hostConn, false);
  hostConn.send(JSON.stringify({ type: "hello", name: myName }));
  startLocalTicker();
  showScreen("lobby");
  setStatus("В комнате");
}

ui.btnCreate.addEventListener("click", () => {
  createRoom().catch((e) => {
    console.error(e);
    setStatus("Не удалось создать комнату. Обновите страницу.");
  });
});

ui.btnJoin.addEventListener("click", () => {
  joinRoom().catch((e) => {
    console.error(e);
    setStatus("Не удалось войти. Проверьте код и что хост онлайн.");
  });
});

ui.btnStart.addEventListener("click", () => {
  if (isHost) hostStartGame();
});

ui.btnCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    setStatus("Код скопирован");
  } catch {
    setStatus(`Код: ${roomCode}`);
  }
});

ui.btnAgain.addEventListener("click", () => {
  if (!isHost) return;
  state.phase = "lobby";
  state.winner = null;
  state.lastEvent = "";
  state.endsAt = 0;
  state.players = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    alive: true,
    isHost: p.isHost,
  }));
  localRole = null;
  pushState();
});

ui.joinCode.addEventListener("input", () => {
  ui.joinCode.value = ui.joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
});

// Prefill name from VK if available
try {
  const cached = localStorage.getItem("futurum_vk_name");
  if (cached) ui.name.value = cached.slice(0, 16);
} catch {
  /* ignore */
}

showScreen("home");
setStatus("");
