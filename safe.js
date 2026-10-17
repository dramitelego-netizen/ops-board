/**
 * Центр комнаты → клик по объекту = подойти → второй клик = взаимодействие
 * Осмотр камерой с лимитами (нельзя смотреть сквозь стены)
 * 2 комната: цифровая панель на стене (код)
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** код двери хранилища — цифры с панели */
const GATE_CODE = [1, 3, 3, 7];

const canvas = document.getElementById("c");

/** авто-low mode: слабые телефоны / VK WebView */
function isLikelyMobile() {
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile|VKAndroid|VKiOS/i.test(ua)) return true;
  return navigator.maxTouchPoints > 1 && Math.min(screen.width || 0, screen.height || 0) < 900;
}

function readQualityOverride() {
  try {
    const q = new URLSearchParams(location.search).get("quality");
    if (q === "low" || q === "high") return q;
    const ls = localStorage.getItem("safe_quality");
    if (ls === "low" || ls === "high") return ls;
  } catch (_) {}
  return null;
}

function detectAutoLowMode() {
  const override = readQualityOverride();
  if (override === "low") return true;
  if (override === "high") return false;

  if (!isLikelyMobile()) return false;

  const ua = navigator.userAgent || "";
  const android = /Android/i.test(ua);
  const mem = navigator.deviceMemory; // Chrome: ГБ ОЗУ
  const cores = navigator.hardwareConcurrency || 8;
  const dpr = window.devicePixelRatio || 1;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const cssPixels = (screen.width || 1) * (screen.height || 1);

  if (saveData) return true;
  if (typeof mem === "number" && mem <= 4) return true;
  if (cores <= 4) return true;
  // Android без deviceMemory (часто VK WebView) — сразу low
  if (android && typeof mem !== "number") return true;
  // Android с высоким DPR и скромной памятью
  if (android && dpr >= 2.5 && (typeof mem !== "number" || mem <= 6)) return true;
  if (android && cssPixels >= 2_200_000 && dpr >= 2 && (typeof mem !== "number" || mem <= 6)) {
    return true;
  }
  // iOS/прочие: не форсим low (флагманы тянут); если лагает — включит FPS-адаптер
  return false;
}

let perfLow = detectAutoLowMode();
let perfMaxDpr = perfLow ? 1 : Math.min(2, isLikelyMobile() ? 1.5 : 2);
let perfFpsFrames = 0;
let perfFpsLastT = 0;
let perfFpsAcc = 0;
let perfAdaptChecked = false;
let perfFrame = 0;

function applyPerfGraphics() {
  if (!renderer) return;
  renderer.shadowMap.enabled = !perfLow;
  if (perfLow) {
    renderer.shadowMap.type = THREE.BasicShadowMap;
    renderer.toneMappingExposure = 1.12;
  } else {
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMappingExposure = 1.08;
  }
  if (keyLight) {
    keyLight.castShadow = !perfLow;
    if (!perfLow) keyLight.shadow.mapSize.set(2048, 2048);
  }
  if (spot) {
    spot.castShadow = !perfLow;
    if (!perfLow) spot.shadow.mapSize.set(1024, 1024);
  }
  scene?.traverse?.((obj) => {
    if (obj.isLight && obj.isSpotLight) {
      obj.castShadow = !perfLow && obj.userData.wantShadow !== false;
    }
    if (obj.isLight && obj.isDirectionalLight) {
      obj.castShadow = !perfLow && obj.userData.wantShadow !== false;
    }
  });
  perfMaxDpr = perfLow ? 1 : Math.min(2, isLikelyMobile() ? 1.5 : 2);
  fitViewport();
}

function enableLowMode(reason) {
  if (perfLow) return;
  perfLow = true;
  try {
    console.info("[safe] low mode:", reason || "auto");
  } catch (_) {}
  applyPerfGraphics();
}

let phase = "intro"; // intro → lobby → gate → vault
let introDone = false;
let introHasKey = false;
let introLetterOpen = false;
let assignedRoomNo = 0;
let introWalkX = 0;
const INTRO_DOOR_SPACING = 1.75;
const INTRO_ROOM_COUNT = 10;
const introDoors = []; // { no, x, pivot, targets, open, openT }
let introRoot = null;
let introDoorUnlocking = null;
let introLetterStep = 0;

function introDoorX(no) {
  return (no - (INTRO_ROOM_COUNT + 1) / 2) * INTRO_DOOR_SPACING;
}
let focus = null; // null = центр комнаты; иначе у объекта
let entered = [];
let gateOpening = false;
let gateOpenT = 0;
let gateWheelSpin = 0;
let camLerp = null;
/** свет сцены / коридора — объявлены рано: snapToStand() зовётся до блока ламп */
let ambientLight = null;
let hemi = null;
let hallLightOn = false;
let hallLightAnim = null;
let hallLightLevel = 0;
let safeOpen = false;
let safeOpenT = 0;
let safeOpening = false;
let handleTwist = 0;
let handleTarget = 0;
let handleShake = 0;
let lobbyDoorOpen = false;
let lobbyDoorT = 0;
let lobbyOpening = false;
let lobbyClosing = false;
let lobbyLightsOn = false; // потолочные лампы холла — старт выключен
const lobbyLamps = []; // рано: applyRoomMood может гасить свет до сборки холла
let lightSwitchRocker = null;
let lightSwitchGlow = null;
let gateDoorOpen = false; // большая дверь в хранилище открыта
let passUnlocked = false; // карта приложена к ридеру
let passTaken = false; // пропуск снят с крючка
let passCardOut = false; // смотрим на свою карточку
let passScanning = false; // анимация прикладывания
let passScanDeny = false; // скан до конца таймера — отказ
let passScanT = 0;
let passTakeT = -1; // анимация снятия с крючка
let passInspectT = -1; // короткая пауза «смотрю карту» после снятия
let passPocketT = -1; // убираем в карман после взятия
let passDenyKind = "locked"; // locked | noPass — отказ двери
let readerNoCardT = -1; // попытка ридера без пропуска
let ledMode = "red"; // red | blink | green | deny
let ledBlinkT = 0;
let handleTugT = -1; // дёрганье без доступа
let handlePullT = -1; // потяг перед открытием
let lobbyDoorShake = 0;
/** игрок (раньше VK) — ник с экрана КПП */
let vkUser = { name: "Гость", photo: "", id: "0" };
let playerReady = false;
const PLAYER_NAME_KEY = "futurum_callsign";
const PLAYER_ID_KEY = "futurum_pid";

/** эвент: дверь закрыта, пока не выйдет таймер (потом карта) */
const EVENT_UNLOCK_DAYS = 12;
let EVENT_UNLOCK_SEC = EVENT_UNLOCK_DAYS * 24 * 60 * 60; // 12 суток — общий таймер с хостом
const EVENT_PLAYERS_KEY = "futurum_event_players_v1";
const SAFE_HOST_KEY = "futurum_safe_host";
let eventStartAt = performance.now(); // локальный запасной старт
let eventEndsAtUnix = 0; // unix-сек с хоста (общий для всех)
let serverTimeOffsetMs = 0; // serverNow - Date.now()
let doorEventReady = false; // таймер дошёл до 0
let eventReadyAnnounced = false;
let eventPlayers = []; // кто сейчас в игре
let safeHostUrl = ""; // https://… туннель или http://127.0.0.1:8787
let safeHostOnline = false;
let safeHostEvents = [];
let _hostPollTimer = 0;
let _hostHbTimer = 0;

function resolveSafeHostUrl() {
  try {
    const q = new URLSearchParams(location.search);
    let fromQ = (q.get("host") || "").trim();
    if (fromQ) {
      try {
        fromQ = decodeURIComponent(fromQ);
      } catch {
        /* keep raw */
      }
      const clean = fromQ.replace(/\/$/, "");
      localStorage.setItem(SAFE_HOST_KEY, clean);
      return clean;
    }
    return (localStorage.getItem(SAFE_HOST_KEY) || "").trim().replace(/\/$/, "");
  } catch {
    return "";
  }
}

safeHostUrl = resolveSafeHostUrl();

/** актуальный хост с GitHub Pages (VK часто отбрасывает ?host= из URL мини-аппа) */
async function loadHostFromJson() {
  try {
    const res = await fetch(new URL("./host.json", location.href).href + "?t=" + Date.now(), {
      cache: "no-store",
      mode: "cors",
    });
    if (!res.ok) return safeHostUrl || "";
    const data = await res.json();
    const url = String(data?.url || "")
      .trim()
      .replace(/\/$/, "");
    // пустой host.json = хост ещё не настроили → сбросить старый мёртвый адрес
    if (!url) {
      safeHostUrl = "";
      try {
        localStorage.removeItem(SAFE_HOST_KEY);
      } catch {
        /* ignore */
      }
      return "";
    }
    safeHostUrl = url;
    try {
      localStorage.setItem(SAFE_HOST_KEY, url);
    } catch {
      /* ignore */
    }
    return url;
  } catch {
    return safeHostUrl || "";
  }
}

async function hostFetch(path, body) {
  if (!safeHostUrl) return null;
  try {
    const res = await fetch(`${safeHostUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers: body
        ? {
            "Content-Type": "application/json",
            "Bypass-Tunnel-Reminder": "true",
          }
        : { "Bypass-Tunnel-Reminder": "true" },
      body: body ? JSON.stringify(body) : undefined,
      mode: "cors",
      cache: "no-store",
    });
    if (!res.ok) throw new Error("host " + res.status);
    const data = await res.json();
    safeHostOnline = true;
    return data;
  } catch {
    safeHostOnline = false;
    return null;
  }
}

function syncedNowMs() {
  return Date.now() + serverTimeOffsetMs;
}

function applyHostTimer(data) {
  if (!data) return;
  if (typeof data.serverTime === "number") {
    serverTimeOffsetMs = data.serverTime * 1000 - Date.now();
  }
  if (typeof data.eventUnlockSec === "number" && data.eventUnlockSec > 0) {
    EVENT_UNLOCK_SEC = data.eventUnlockSec;
  }
  if (typeof data.eventEndsAt === "number" && data.eventEndsAt > 0) {
    eventEndsAtUnix = data.eventEndsAt;
    const left = Math.max(0, eventEndsAtUnix - syncedNowMs() / 1000);
    if (left <= 0) {
      if (!doorEventReady) {
        doorEventReady = true;
        if (typeof drawPassCard === "function") drawPassCard(vkUser, passPhotoImg);
      }
    } else {
      // хост перезапустил таймер
      doorEventReady = false;
      eventReadyAnnounced = false;
    }
    if (typeof drawTimerBoard === "function") drawTimerBoard();
  }
}

function applyHostState(data) {
  if (!data) return;
  applyHostTimer(data);
  if (!data.players) return;
  eventPlayers = data.players.map((p) => ({
    id: String(p.id || "0"),
    name: p.name || "Игрок",
    photo: p.photo || "",
    at: Math.round((p.at || 0) * 1000),
    last: p.last || "",
  }));
  safeHostEvents = Array.isArray(data.events) ? data.events : [];
  if (typeof assignCellOwners === "function") assignCellOwners();
  if (typeof drawPlayersBoard === "function") drawPlayersBoard();
}

async function hostJoin(user) {
  if (!safeHostUrl || !user) return;
  const data = await hostFetch("/api/join", {
    id: String(user.id || "0"),
    name: user.name || "Гость",
    photo: user.photo || "",
  });
  if (data?.state) applyHostState(data.state);
}

async function hostHeartbeat(user) {
  if (!safeHostUrl || !user) return;
  await hostFetch("/api/heartbeat", {
    id: String(user.id || "0"),
    name: user.name || "Гость",
    photo: user.photo || "",
  });
}

async function hostEvent(type, detail = "") {
  if (!safeHostUrl) return;
  const data = await hostFetch("/api/event", {
    id: String(vkUser.id || "0"),
    name: vkUser.name || "Гость",
    photo: vkUser.photo || "",
    type,
    detail: detail || undefined,
  });
  if (data?.state) applyHostState(data.state);
}

function isEventAdmin() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get("admin") === "1") {
      localStorage.setItem("futurum_admin", "1");
      return true;
    }
    return localStorage.getItem("futurum_admin") === "1";
  } catch {
    return false;
  }
}

async function hostResetTimer() {
  if (!safeHostUrl) return false;
  const data = await hostFetch("/api/timer/reset", {});
  if (data?.state) {
    applyHostState(data.state);
    hostEvent("timer_reset", "сбросил таймер эвента");
    return true;
  }
  return false;
}

/** UI: записка / финал / глазок / сирена */
const noteOverlay = document.getElementById("note-overlay");
const noteTitleEl = document.getElementById("note-title");
const noteBodyEl = document.getElementById("note-body");
const noteCloseBtn = document.getElementById("note-close");
const finaleOverlay = document.getElementById("finale-overlay");
const finaleTitleEl = document.getElementById("finale-title");
const finaleBodyEl = document.getElementById("finale-body");
const finaleCloseBtn = document.getElementById("finale-close");
const peepholeStatusEl = document.getElementById("peephole-status");
const alarmFlashEl = document.getElementById("alarm-flash");

let codeFailCount = 0;
let alarmUntil = 0;
let finaleShown = false;
let foundCodeHints = { mag: false, phone: false, dossier: false, cellKey: false, cellNote: false };

function showNote(title, body) {
  if (!noteOverlay) return;
  if (noteTitleEl) noteTitleEl.textContent = title || "";
  if (noteBodyEl) noteBodyEl.textContent = body || "";
  noteOverlay.hidden = false;
}

function hideNote() {
  if (noteOverlay) noteOverlay.hidden = true;
}

function showFinale(who, when) {
  if (!finaleOverlay || finaleShown) return;
  finaleShown = true;
  if (finaleTitleEl) finaleTitleEl.textContent = "Эвент пройден";
  if (finaleBodyEl) {
    finaleBodyEl.textContent = [
      who ? `Сейф вскрыл: ${who}` : "Сейф открыт",
      when || new Date().toLocaleString("ru-RU"),
      "",
      "Хранилище FUTURUM · доступ получен",
    ].join("\n");
  }
  finaleOverlay.hidden = false;
}

function hideFinale() {
  if (finaleOverlay) finaleOverlay.hidden = true;
}

if (noteCloseBtn) noteCloseBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  hideNote();
});
if (noteOverlay) {
  noteOverlay.addEventListener("click", (e) => {
    if (e.target === noteOverlay) hideNote();
  });
}
if (finaleCloseBtn) finaleCloseBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  hideFinale();
});

function updatePeepholeStatus() {
  if (!peepholeStatusEl) return;
  const on = !!(peepholeLooking && focus === "peephole");
  peepholeStatusEl.hidden = !on;
  if (!on) return;
  const lit = hallLightOn || hallLightLevel > 0.35;
  const line1 = lit ? "КОРИДОР · ЛАМПЫ ГОРЯТ" : "КОРИДОР · ТЕМНО";
  const line2 = lit
    ? "люминесцентный свет · панель справа"
    : "дежурная лампа · ждать открытия";
  peepholeStatusEl.innerHTML = `${line1}<br/><span style="opacity:.75;font-weight:500">${line2}</span>`;
}

function sfxSiren() {
  ensureAudio();
  if (!audioCtx || !sfxOut()) return;
  const out = sfxOut();
  const now = audioCtx.currentTime;
  for (let i = 0; i < 3; i++) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(740 + i * 40, now + i * 0.22);
    o.frequency.linearRampToValueAtTime(420, now + i * 0.22 + 0.18);
    g.gain.setValueAtTime(0.0001, now + i * 0.22);
    g.gain.exponentialRampToValueAtTime(0.09, now + i * 0.22 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.2);
    o.connect(g);
    g.connect(out);
    o.start(now + i * 0.22);
    o.stop(now + i * 0.22 + 0.22);
  }
}

function triggerAccessAlarm() {
  codeFailCount = 0;
  alarmUntil = performance.now() + 2200;
  if (alarmFlashEl) {
    alarmFlashEl.hidden = false;
    alarmFlashEl.style.animation = "none";
    void alarmFlashEl.offsetWidth;
    alarmFlashEl.style.animation = "";
    setTimeout(() => {
      if (alarmFlashEl) alarmFlashEl.hidden = true;
    }, 2200);
  }
  sfxSiren();
  hostEvent("alarm", "ошибка доступа · сирена");
  showNote("ДОСТУП ОТКЛОНЁН", "Три неверных кода.\nСирена зафиксирована на табло эвента.\nПодсказки: журнал, телефон, архив на левой стене.");
}

function sfxCooler() {
  ensureAudio();
  if (!audioCtx || !sfxOut()) return;
  const out = sfxOut();
  const now = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  const f = audioCtx.createBiquadFilter();
  o.type = "triangle";
  o.frequency.setValueAtTime(180, now);
  o.frequency.exponentialRampToValueAtTime(90, now + 0.35);
  f.type = "lowpass";
  f.frequency.value = 600;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.07, now + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
  o.connect(f);
  f.connect(g);
  g.connect(out);
  o.start(now);
  o.stop(now + 0.42);
}

function sfxPhoneTone() {
  ensureAudio();
  if (!audioCtx || !sfxOut()) return;
  const out = sfxOut();
  const now = audioCtx.currentTime;
  [440, 480].forEach((freq, i) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.045, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    o.connect(g);
    g.connect(out);
    o.start(now + i * 0.02);
    o.stop(now + 0.58);
  });
}

async function hostPullState() {
  if (!safeHostUrl) return;
  const data = await hostFetch("/api/state");
  if (data) applyHostState(data);
}

function startHostSync() {
  if (!safeHostUrl) return;
  hostPullState();
  clearInterval(_hostPollTimer);
  clearInterval(_hostHbTimer);
  _hostPollTimer = setInterval(() => hostPullState(), 3000);
  _hostHbTimer = setInterval(() => hostHeartbeat(vkUser), 20000);
}

/** стоять в центре / подойти ближе — фронтальный взгляд */
const ROOMS = {
  intro: {
    // ряд дверей слева→направо, смотрим на стену (−Z)
    stand: new THREE.Vector3(0, 1.55, 2.35),
    look: new THREE.Vector3(0, 1.4, 0.2),
    yawRange: 1.15,
    pitchRange: 0.2,
  },
  lobby: {
    stand: new THREE.Vector3(0, 1.62, 21.0),
    look: new THREE.Vector3(0, 1.55, 16.55),
    yawRange: 0.9,
    pitchRange: 0.28,
  },
  gate: {
    stand: new THREE.Vector3(0, 2.15, 11.5),
    look: new THREE.Vector3(0, 2.3, 5.55),
    yawRange: 0.8,
    pitchRange: 0.28,
  },
  vault: {
    stand: new THREE.Vector3(0, 1.7, 2.2),
    look: new THREE.Vector3(0, 1.25, -1.5),
    yawRange: 2.2,
    pitchRange: 0.32,
  },
};

/**
 * target — куда смотрим
 * dist — дистанция спереди (стена смотрит в +Z → камера на target.z + dist)
 * pos — если задан, точная позиция камеры (для сейфа под углом)
 */
const FOCUS = {
  lobbyDoor: {
    target: new THREE.Vector3(0, 1.55, 16.55),
    dist: 2.15,
    yawRange: 0.32,
    pitchRange: 0.18,
  },
  // глазок — подошли к двери; сам обзор — крупный круг (peepholeCam)
  peephole: {
    pos: new THREE.Vector3(0, 1.62, 17.45),
    target: new THREE.Vector3(0, 1.58, 16.55),
    yawRange: 0.22,
    pitchRange: 0.14,
  },
  reader: {
    target: new THREE.Vector3(1.42, 1.4, 16.62),
    dist: 1.2,
    yawRange: 0.28,
    pitchRange: 0.16,
  },
  playersBoard: {
    target: new THREE.Vector3(-1.85, 1.95, 16.64),
    dist: 1.4,
    yawRange: 0.18,
    pitchRange: 0.14,
  },
  timerBoard: {
    target: new THREE.Vector3(2.15, 2.05, 16.64),
    dist: 1.45,
    yawRange: 0.22,
    pitchRange: 0.16,
  },
  radio: {
    // правая стена: стоим слева от радио и смотрим на +X
    pos: new THREE.Vector3(1.75, 1.45, 20.9),
    target: new THREE.Vector3(3.05, 1.12, 20.9),
    yawRange: 0.35,
    pitchRange: 0.22,
  },
  lightSwitch: {
    pos: new THREE.Vector3(-2.0, 1.45, 17.55),
    target: new THREE.Vector3(-3.35, 1.4, 17.55),
    yawRange: 0.28,
    pitchRange: 0.16,
  },
  deskLamp: {
    // стоим в комнате чуть спереди/сбоку — смотрим на лампу и шнурок
    pos: new THREE.Vector3(-1.45, 1.58, 20.55),
    target: new THREE.Vector3(-3.05, 1.2, 19.9),
    yawRange: 0.28,
    pitchRange: 0.18,
  },
  magazine: {
    pos: new THREE.Vector3(-0.55, 1.35, 20.85),
    target: new THREE.Vector3(-1.55, 0.55, 21.55),
    yawRange: 0.3,
    pitchRange: 0.22,
  },
  cooler: {
    pos: new THREE.Vector3(-1.55, 1.45, 18.15),
    target: new THREE.Vector3(-3.05, 1.05, 18.15),
    yawRange: 0.28,
    pitchRange: 0.16,
  },
  phone: {
    pos: new THREE.Vector3(-1.55, 1.55, 19.55),
    target: new THREE.Vector3(-2.95, 1.12, 19.55),
    yawRange: 0.28,
    pitchRange: 0.16,
  },
  guestPass: {
    pos: new THREE.Vector3(-1.55, 1.55, 19.85),
    target: new THREE.Vector3(-2.85, 1.05, 19.95),
    yawRange: 0.28,
    pitchRange: 0.16,
  },
  // пропуск на крючках — смотрим сбоку из комнаты, не вдоль ридера
  passHook: {
    pos: new THREE.Vector3(1.85, 1.7, 18.55),
    target: new THREE.Vector3(3.28, 1.62, 17.85),
    yawRange: 0.28,
    pitchRange: 0.16,
  },
  // цифровая панель на правой стене коридора (смотрит в −X)
  gateKeypad: {
    pos: new THREE.Vector3(1.55, 2.15, 8.5),
    target: new THREE.Vector3(3.22, 2.15, 8.5),
    yawRange: 0.35,
    pitchRange: 0.22,
  },
  gateLeft: {
    pos: new THREE.Vector3(-1.55, 2.15, 8.5),
    target: new THREE.Vector3(-3.22, 2.15, 8.5),
    yawRange: 0.35,
    pitchRange: 0.22,
  },
  safe: {
    pos: new THREE.Vector3(1.55, 1.55, 0.85),
    target: new THREE.Vector3(0, 1.25, -1.5),
    yawRange: 0.4,
    pitchRange: 0.2,
  },
  cells: {
    target: new THREE.Vector3(0, 1.7, -5.0),
    dist: 3.4,
    yawRange: 0.4,
    pitchRange: 0.18,
  },
};

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !perfLow,
  powerPreference: "high-performance",
  alpha: false,
});
renderer.shadowMap.enabled = !perfLow;
renderer.shadowMap.type = perfLow ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = perfLow ? 1.12 : 1.08;
try {
  console.info("[safe] perf:", perfLow ? "low" : "high", "dprMax", perfMaxDpr);
} catch (_) {}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd8d4cc);
scene.fog = new THREE.FogExp2(0xd4d0c8, 0.022);

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 80);
camera.rotation.order = "YXZ";

/** реальный размер окна (VK / мобильный браузер часто врёт innerWidth/Height) */
function getViewSize() {
  const vv = window.visualViewport;
  let w = vv?.width ?? document.documentElement?.clientWidth ?? innerWidth;
  let h = vv?.height ?? document.documentElement?.clientHeight ?? innerHeight;
  w = Math.max(1, Math.floor(w));
  h = Math.max(1, Math.floor(h));
  return { w, h };
}

function fitViewport() {
  const { w, h } = getViewSize();
  const dpr = Math.min(window.devicePixelRatio || 1, perfMaxDpr);
  renderer.setPixelRatio(dpr);
  // false = не трогать CSS style автоматически (иначе на части телефонов тянет картинку)
  renderer.setSize(w, h, false);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.style.margin = "0";
  // visualViewport может сдвигаться при клавиатуре / панелях VK
  const vv = window.visualViewport;
  const ox = vv ? Math.round(vv.offsetLeft || 0) : 0;
  const oy = vv ? Math.round(vv.offsetTop || 0) : 0;
  canvas.style.left = `${ox}px`;
  canvas.style.top = `${oy}px`;
  updateCameraFov(w, h);
}

const controls = new OrbitControls(camera, canvas);
controls.enabled = false;
controls.enableDamping = false;

let lookYaw = 0;
let lookPitch = 0;
let lookDragging = false;
let lookLastX = 0;
let lookLastY = 0;
let boardScrolling = false;
let camMode = "stand"; // stand | focus
let camAnchor = ROOMS.intro.stand.clone();
let camLookAt = new THREE.Vector3(0, 1.4, 0.2);
let yawLimit = { min: -0.95, max: 0.95 };
let pitchLimit = { min: -0.35, max: 0.4 };

const stepBackBtn = document.getElementById("step-back");
const roomBackBtn = document.getElementById("room-back");
const navLeftBtn = document.getElementById("nav-left");
const navRightBtn = document.getElementById("nav-right");

function setStepBackVisible(on) {
  if (!stepBackBtn) return;
  stepBackBtn.hidden = !on;
  updateRoomBackBtn();
}

/** боковые кнопки перехода / подхода */
function updateSideNav() {
  const idle = !focus && !camLerp && !lobbyOpening && !lobbyClosing && !gateOpening;
  if (navRightBtn) {
    if (phase === "intro" && idle && introHasKey) {
      navRightBtn.hidden = false;
      navRightBtn.disabled = false;
      navRightBtn.textContent = "Вправо →";
      navRightBtn.title = "Вдоль дверей вправо";
      navRightBtn.classList.remove("side-nav-radio");
      navRightBtn.removeAttribute("aria-disabled");
    } else if (phase === "lobby" && idle) {
      navRightBtn.hidden = false;
      navRightBtn.disabled = false;
      navRightBtn.textContent = "→ Радио";
      navRightBtn.title = "Подойти к радио";
      navRightBtn.classList.add("side-nav-radio");
      navRightBtn.removeAttribute("aria-disabled");
    } else if (phase === "gate" && idle) {
      navRightBtn.hidden = false;
      navRightBtn.disabled = false;
      navRightBtn.textContent = "→ Код";
      navRightBtn.title = "Панель кода";
      navRightBtn.classList.remove("side-nav-radio");
      navRightBtn.removeAttribute("aria-disabled");
    } else {
      navRightBtn.hidden = true;
      navRightBtn.classList.remove("side-nav-radio");
    }
  }
  if (navLeftBtn) {
    if (phase === "intro" && idle && introHasKey) {
      navLeftBtn.hidden = false;
      navLeftBtn.disabled = false;
      navLeftBtn.textContent = "← Влево";
      navLeftBtn.title = "Вдоль дверей влево";
      navLeftBtn.removeAttribute("aria-disabled");
    } else {
      const showLeft = phase === "gate" && idle;
      navLeftBtn.hidden = !showLeft;
      navLeftBtn.disabled = !showLeft;
      navLeftBtn.textContent = "← Архив";
      navLeftBtn.title = "Документы на левой стене";
      if (showLeft) navLeftBtn.removeAttribute("aria-disabled");
      else navLeftBtn.setAttribute("aria-disabled", "true");
    }
  }
}

function updateRoomBackBtn() {
  if (!roomBackBtn) return;
  const busy = !!(focus || camLerp || lobbyOpening || lobbyClosing || gateOpening);
  if (busy) {
    roomBackBtn.hidden = true;
    document.body.classList.remove("has-room-back");
    updateSideNav();
    return;
  }
  if (phase === "gate" && lobbyDoorOpen) {
    roomBackBtn.hidden = false;
    roomBackBtn.textContent = "← Холл";
    document.body.classList.add("has-room-back");
  } else if (phase === "vault" && gateDoorOpen) {
    roomBackBtn.hidden = false;
    roomBackBtn.textContent = "← Коридор";
    document.body.classList.add("has-room-back");
  } else if (phase === "lobby" && lobbyDoorOpen) {
    roomBackBtn.hidden = false;
    roomBackBtn.textContent = "Коридор →";
    document.body.classList.add("has-room-back");
  } else if (phase === "gate" && gateDoorOpen) {
    roomBackBtn.hidden = false;
    roomBackBtn.textContent = "Хранилище →";
    document.body.classList.add("has-room-back");
  } else {
    roomBackBtn.hidden = true;
    document.body.classList.remove("has-room-back");
  }
  updateSideNav();
}

function goRoomBack() {
  if (camLerp || lobbyOpening || lobbyClosing || gateOpening) return;
  if (focus) {
    returnToRoom();
    return;
  }
  ensureAudio();
  hidePassCard();
  if (phase === "vault" && gateDoorOpen) {
    phase = "gate";
    setHallLightsPower(true);
    sfxClack(170, 0.04);
    startCamLerp(ROOMS.gate.stand, ROOMS.gate.look, () => {
      snapToStand("gate");
      updateRoomBackBtn();
    });
    return;
  }
  if (phase === "gate" && lobbyDoorOpen) {
    phase = "lobby";
    setHallLightsPower(false);
    sfxClack(170, 0.04);
    startCamLerp(ROOMS.lobby.stand, ROOMS.lobby.look, () => {
      snapToStand("lobby");
      updateRoomBackBtn();
    });
    return;
  }
  // вперёд по уже открытым дверям
  if (phase === "lobby" && lobbyDoorOpen) {
    phase = "gate";
    setHallLightsPower(true);
    sfxClack(170, 0.04);
    startCamLerp(ROOMS.gate.stand, ROOMS.gate.look, () => {
      snapToStand("gate");
      updateRoomBackBtn();
    });
    return;
  }
  if (phase === "gate" && gateDoorOpen) {
    phase = "vault";
    vault.visible = true;
    peekBlock.visible = false;
    sfxClack(170, 0.04);
    startCamLerp(ROOMS.vault.stand, ROOMS.vault.look, () => {
      snapToStand("vault");
      updateRoomBackBtn();
    });
  }
}

/** FOV под телефон / ПК — чтобы объекты не «кривило» */
function updateCameraFov(w, h) {
  const size = w && h ? { w, h } : getViewSize();
  const aspect = size.w / Math.max(1, size.h);
  // портрет телефона — шире; десктоп — спокойнее
  if (aspect < 0.55) camera.fov = 68;
  else if (aspect < 0.7) camera.fov = 64;
  else if (aspect < 1) camera.fov = 58;
  else if (aspect < 1.4) camera.fov = 54;
  else camera.fov = 50;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

fitViewport();

/** позиция камеры ровно напротив объекта (стена в сторону комнаты = +Z) */
function resolveFocusPose(id) {
  const f = FOCUS[id];
  if (!f) return null;
  const target = f.target.clone();
  let pos;
  if (f.pos) {
    pos = f.pos.clone();
  } else {
    const dist = focusDist(f.dist ?? 1.5);
    pos = new THREE.Vector3(target.x, target.y, target.z + dist);
  }
  return { pos, target, yawRange: f.yawRange ?? 0.3, pitchRange: f.pitchRange ?? 0.18 };
}

/** на узком экране чуть дальше, чтобы всё влезало в кадр */
function focusDist(base) {
  const { w, h } = getViewSize();
  const aspect = w / Math.max(1, h);
  if (aspect < 0.55) return base * 1.32;
  if (aspect < 0.7) return base * 1.22;
  if (aspect < 1) return base * 1.1;
  return base;
}

function refitFocusCamera() {
  if (!focus || camLerp) return;
  const pose = resolveFocusPose(focus);
  if (!pose) return;
  camAnchor.copy(pose.pos);
  camLookAt.copy(pose.target);
  faceToward(camAnchor, pose.target);
  setLookLimitsAround(lookYaw, pose.yawRange, lookPitch, pose.pitchRange);
  applyLook();
}

function applyLook() {
  camera.position.copy(camAnchor);
  lookYaw = Math.max(yawLimit.min, Math.min(yawLimit.max, lookYaw));
  lookPitch = Math.max(pitchLimit.min, Math.min(pitchLimit.max, lookPitch));
  camera.rotation.y = lookYaw;
  camera.rotation.x = lookPitch;
  camera.rotation.z = 0;
}

function faceToward(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  // YXZ + getWorldDirection(0,0,−1): yaw = atan2(−dx, −dz)
  lookYaw = Math.atan2(-dx, -dz);
  const dist = Math.hypot(dx, dz) || 1;
  lookPitch = Math.atan2(dy, dist);
}

function setLookLimitsAround(baseYaw, yawRange, basePitch, pitchRange) {
  yawLimit = { min: baseYaw - yawRange, max: baseYaw + yawRange };
  pitchLimit = { min: basePitch - pitchRange, max: basePitch + pitchRange };
}

function applyRoomMood(roomKey) {
  if (roomKey === "vault") {
    scene.background = new THREE.Color(0xe4e0d8);
    scene.fog = new THREE.FogExp2(0xddd8d0, 0.016);
    if (ambientLight) {
      ambientLight.color.setHex(0xfff6ea);
      ambientLight.intensity = 0.42;
    }
    if (hemi) {
      hemi.color.setHex(0xfffaf0);
      hemi.groundColor.setHex(0xc8c4bc);
      hemi.intensity = 0.45;
    }
    if (keyLight) {
      keyLight.color.setHex(0xfff2e0);
      keyLight.intensity = 1.15;
    }
    if (spot) {
      spot.color.setHex(0xffe8c8);
      spot.intensity = 22;
    }
    if (fillWarm) {
      fillWarm.color.setHex(0xffd9a8);
      fillWarm.intensity = 4.5;
    }
    if (fillCool) fillCool.intensity = 3.2;
  } else if (roomKey === "intro") {
    scene.background = new THREE.Color(0x12151a);
    scene.fog = new THREE.FogExp2(0x101318, 0.055);
    if (ambientLight) {
      ambientLight.color.setHex(0xc8d0d8);
      ambientLight.intensity = 0.22;
    }
    if (hemi) {
      hemi.color.setHex(0xd8e0e8);
      hemi.groundColor.setHex(0x1a1814);
      hemi.intensity = 0.28;
    }
    if (keyLight) {
      keyLight.color.setHex(0xffe8c8);
      keyLight.intensity = 0.15;
    }
    if (spot) spot.intensity = 0;
    if (fillWarm) fillWarm.intensity = 0.05;
    if (fillCool) fillCool.intensity = 0.2;
  } else if (roomKey === "gate") {
    // почти чёрный коридор, пока люминесцентные не зажглись
    const lit = hallLightOn && !hallLightAnim ? 1 : hallLightOn ? 0.55 : 0;
    scene.background = new THREE.Color().setHSL(0.6, 0.05, 0.015 + lit * 0.48);
    scene.fog = new THREE.FogExp2(
      new THREE.Color().setHSL(0.6, 0.06, 0.01 + lit * 0.4).getHex(),
      0.045 - lit * 0.022
    );
    if (ambientLight) ambientLight.intensity = 0.012 + lit * 0.35;
    if (hemi) hemi.intensity = 0.015 + lit * 0.35;
    if (keyLight) keyLight.intensity = lit * 0.35;
    if (spot) spot.intensity = 0;
    if (fillWarm) fillWarm.intensity = 0;
    if (fillCool) fillCool.intensity = 0;
  } else {
    // холл: темнее, основной свет — тёплые потолочные лампы
    scene.background = new THREE.Color(0x1c1814);
    scene.fog = new THREE.FogExp2(0x1a1612, 0.028);
    if (ambientLight) {
      ambientLight.color.setHex(0xffd8a8);
      ambientLight.intensity = 0.12;
    }
    if (hemi) {
      hemi.color.setHex(0xffe0b8);
      hemi.groundColor.setHex(0x2a2218);
      hemi.intensity = 0.16;
    }
    if (keyLight) {
      keyLight.color.setHex(0xffc878);
      keyLight.intensity = 0.22;
    }
    if (spot) {
      spot.color.setHex(0xffc898);
      spot.intensity = 5.5;
    }
    if (fillWarm) {
      fillWarm.color.setHex(0xffb060);
      fillWarm.intensity = 1.6;
    }
    if (fillCool) fillCool.intensity = 0.15;
    // если выключатель выключен — снова гасим потолок (только когда лампы уже есть)
    if (!lobbyLightsOn && lobbyLamps.length && typeof applyLobbyCeilingLights === "function") {
      applyLobbyCeilingLights(false);
    }
  }
}

function snapToStand(roomKey) {
  const r = ROOMS[roomKey];
  if (!r) return;
  focus = null;
  camMode = "stand";
  if (roomKey === "intro") {
    const x = introWalkX;
    camAnchor.set(x, r.stand.y, r.stand.z);
    camLookAt.set(x, 1.4, 0.15);
  } else {
    camAnchor.copy(r.stand);
    camLookAt.copy(r.look);
  }
  faceToward(camAnchor, camLookAt);
  setLookLimitsAround(lookYaw, r.yawRange, lookPitch, r.pitchRange);
  applyLook();
  applyRoomMood(roomKey);
  setStepBackVisible(false);
  updateRoomBackBtn();
  setPeepholeView(false);
}

function yawPitchToward(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const yaw = Math.atan2(-dx, -dz);
  const dist = Math.hypot(dx, dz) || 1;
  const pitch = Math.atan2(dy, dist);
  return { yaw, pitch };
}

function startCamLerp(toPos, toLook, onDone, speed = 0.02) {
  lookDragging = false;
  boardScrolling = false;
  setStepBackVisible(false);
  const aim = yawPitchToward(toPos, toLook);
  camLerp = {
    t: 0,
    speed,
    fromPos: camera.position.clone(),
    toPos: toPos.clone(),
    fromYaw: lookYaw,
    fromPitch: lookPitch,
    toYaw: aim.yaw,
    toPitch: aim.pitch,
    onDone: onDone || null,
  };
}

let peepholeLooking = false; // true только пока активен круглый обзор

function setPeepholeView(on) {
  peepholeLooking = !!on;
  document.body.classList.toggle("peephole-view", !!on);
  updatePeepholeStatus();
  const mask = document.getElementById("peephole-mask");
  if (mask) mask.hidden = !on;
  if (on) {
    // смотрим ровно в коридор на дверь ворот — без кривого угла
    lookYaw = 0;
    lookPitch = 0.06;
    setLookLimitsAround(0, 0.18, 0.06, 0.1);
  } else {
    // сразу закрыть «дыру» в дверь (объекты могут ещё не существовать на старте)
    try {
      if (!lobbyDoorOpen && !lobbyOpening) lobbyPeekBlock.visible = true;
      lobbyRoot.visible = true;
      peepholeRoot.visible = true;
    } catch {
      /* сцена ещё собирается */
    }
  }
}

function approachFocus(id) {
  const pose = resolveFocusPose(id);
  if (!pose || camLerp) return;
  if (phase === "intro" && String(id).startsWith("introDoor")) {
    const no = Number(String(id).replace("introDoor", ""));
    const door = introDoors.find((x) => x.no === no);
    if (door) introWalkX = door.x;
  }
  ensureAudio();
  startMusic();
  sfxClack(190, 0.04);
  setPeepholeView(false);
  startCamLerp(pose.pos, pose.target, () => {
    focus = id;
    camMode = "focus";
    camAnchor.copy(pose.pos);
    camLookAt.copy(pose.target);
    faceToward(camAnchor, pose.target);
    setLookLimitsAround(lookYaw, pose.yawRange, lookPitch, pose.pitchRange);
    applyLook();
    setStepBackVisible(true);
    setPeepholeView(id === "peephole");
    updateSideNav();
  });
  updateSideNav();
}

function returnToRoom() {
  if (camLerp || passScanning) return;
  if (!focus && camMode === "stand") return;
  if (passCardOut && !passUnlocked) hidePassCard();
  const r = ROOMS[phase];
  if (!r) return;
  sfxClack(160, 0.035);
  // выходим из глазка сразу: иначе кадры ещё рендерят 2 комнату без маски
  const leavingPeephole = focus === "peephole" || peepholeLooking;
  setPeepholeView(false);
  if (leavingPeephole) {
    focus = null;
    camMode = "stand";
    if (!lobbyDoorOpen && !lobbyOpening) lobbyPeekBlock.visible = true;
    if (phase === "lobby") lobbyRoot.visible = true;
  }
  if (phase === "intro") {
    const stand = r.stand.clone();
    stand.x = introWalkX;
    const look = new THREE.Vector3(introWalkX, 1.4, 0.15);
    startCamLerp(stand, look, () => {
      snapToStand("intro");
    });
    return;
  }
  startCamLerp(r.stand, r.look, () => {
    snapToStand(phase);
  });
}

if (stepBackBtn) {
  stepBackBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ensureAudio();
    returnToRoom();
  });
  stepBackBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
}

if (roomBackBtn) {
  roomBackBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ensureAudio();
    goRoomBack();
  });
  roomBackBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
}

function goToGateKeypad() {
  if (phase !== "gate" || gateOpening) return;
  if (camLerp) return;
  if (focus === "gateKeypad") return;
  ensureAudio();
  startMusic();
  approachFocus("gateKeypad");
}

function goToGateArchive() {
  if (phase !== "gate" || gateOpening) return;
  if (camLerp) return;
  if (focus === "gateLeft") return;
  ensureAudio();
  startMusic();
  approachFocus("gateLeft");
}

function goToRadio() {
  if (phase !== "lobby" || focus || camLerp) return;
  ensureAudio();
  startMusic();
  approachFocus("radio");
  updateSideNav();
}

function introWalk(deltaX) {
  if (phase !== "intro" || !introHasKey || camLerp || focus) return;
  const minX = introDoorX(1);
  const maxX = introDoorX(INTRO_ROOM_COUNT);
  introWalkX = Math.max(minX, Math.min(maxX, introWalkX + deltaX));
  camAnchor.x = introWalkX;
  camLookAt.x = introWalkX;
  applyLook();
  sfxClack(160, 0.02);
}

if (navRightBtn) {
  navRightBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (phase === "intro") introWalk(INTRO_DOOR_SPACING);
    else if (phase === "lobby") goToRadio();
    else if (phase === "gate") goToGateKeypad();
  });
  navRightBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
}
if (navLeftBtn) {
  navLeftBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (phase === "intro") introWalk(-INTRO_DOOR_SPACING);
    else if (phase === "gate") goToGateArchive();
  });
  navLeftBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
}

scene.add(camera); // дети камеры (карточка пропуска) должны рендериться
// snapToStand("lobby") — после создания ambientLight (ниже)

const steel = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 0.7, roughness: 0.35 });
const steelDark = new THREE.MeshStandardMaterial({ color: 0x7a7a7a, metalness: 0.65, roughness: 0.4 });
const brass = new THREE.MeshStandardMaterial({ color: 0xc4a35a, metalness: 0.85, roughness: 0.28 });

/* —— пропуск VK: фото + имя —— */
const passCanvas = document.createElement("canvas");
passCanvas.width = 512;
passCanvas.height = 320;
const passCtx = passCanvas.getContext("2d");
const passTex = new THREE.CanvasTexture(passCanvas);
passTex.colorSpace = THREE.SRGBColorSpace;

function playerInitials(name) {
  const parts = String(name || "G")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function hashCallsign(name) {
  const s = String(name || "FUTURUM").toUpperCase();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const AGENT_CLASSES = [
  "OBSERVER",
  "CIPHER",
  "VAULTWALK",
  "NIGHTOWL",
  "SIGNAL",
  "ARCHIVIST",
  "PHANTOM",
  "KEYMASTER",
];

function agentClassFor(name) {
  return AGENT_CLASSES[hashCallsign(name) % AGENT_CLASSES.length];
}

/** процедурная эмблема агента — «аватар» на пропуске */
function drawAgentAvatar(ctx, ax, ay, as, name) {
  const h = hashCallsign(name || "?");
  const style = h % 6;
  const cx = ax + as / 2;
  const cy = ay + as / 2;
  const r = as * 0.42;
  const gold = "#c9a86a";
  const ink = "#0e1218";
  const accents = ["#66e0ff", "#ff7a5c", "#a8e08a", "#e0b0ff", "#ffd36a", "#7ab8ff"];
  const accent = accents[h % accents.length];

  const bg = ctx.createLinearGradient(ax, ay, ax + as, ay + as);
  bg.addColorStop(0, "#1a2230");
  bg.addColorStop(1, "#0a0e14");
  ctx.fillStyle = bg;
  ctx.fillRect(ax, ay, as, as);

  ctx.save();
  ctx.beginPath();
  ctx.rect(ax, ay, as, as);
  ctx.clip();

  // сетка / шум
  ctx.strokeStyle = "rgba(201,168,106,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const p = ax + ((i + 1) / 7) * as;
    ctx.beginPath();
    ctx.moveTo(p, ay);
    ctx.lineTo(p, ay + as);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax, p);
    ctx.lineTo(ax + as, p);
    ctx.stroke();
  }

  ctx.strokeStyle = gold;
  ctx.lineWidth = Math.max(2, as * 0.035);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(2, as * 0.03);

  if (style === 0) {
    // глаз
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.55, r * 0.28, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  } else if (style === 1) {
    // гекс
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * r * 0.45;
      const y = cy + Math.sin(a) * r * 0.45;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = gold;
    ctx.font = `700 ${Math.floor(as * 0.22)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(playerInitials(name), cx, cy + 1);
  } else if (style === 2) {
    // ключ / зубцы
    ctx.fillStyle = gold;
    ctx.fillRect(cx - r * 0.08, cy - r * 0.35, r * 0.16, r * 0.7);
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.35, r * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillRect(cx + r * 0.08, cy + r * 0.15, r * 0.22, r * 0.1);
    ctx.fillRect(cx + r * 0.08, cy + r * 0.32, r * 0.14, r * 0.1);
  } else if (style === 3) {
    // сигнал
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx - r * 0.15, cy, r * 0.18 * i, -Math.PI * 0.55, Math.PI * 0.55);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx - r * 0.15, cy, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (style === 4) {
    // звезда / компас
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? r * 0.5 : r * 0.22;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // портал / кольца
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.28, 0.2, Math.PI * 1.6);
    ctx.stroke();
    ctx.fillStyle = gold;
    ctx.font = `700 ${Math.floor(as * 0.2)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(playerInitials(name), cx, cy + 1);
  }

  ctx.restore();
  ctx.strokeStyle = gold;
  ctx.lineWidth = 2;
  ctx.strokeRect(ax + 2, ay + 2, as - 4, as - 4);
}

function drawPassMonogram(ctx, ax, ay, as, name) {
  drawAgentAvatar(ctx, ax + 4, ay + 4, as - 8, name);
}

function paintCheckinAvatar(name) {
  const c = document.getElementById("checkin-avatar");
  if (!c) return;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  drawAgentAvatar(ctx, 0, 0, c.width, normalizeCallsign(name) || "??");
}

function drawPassCard(user, photoImg) {
  const ctx = passCtx;
  const w = passCanvas.width;
  const h = passCanvas.height;
  ctx.clearRect(0, 0, w, h);
  // пластик пропуска
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#2a3140");
  g.addColorStop(1, "#12161e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#c9a86a";
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = "#c9a86a";
  ctx.font = "700 22px sans-serif";
  ctx.fillText("FUTURUM  ·  ACCESS", 28, 42);
  ctx.fillStyle = "#6a7380";
  ctx.font = "12px sans-serif";
  ctx.fillText("AUTHORIZED PERSONNEL", 28, 62);

  const ax = 28;
  const ay = 88;
  const as = 140;
  ctx.fillStyle = "#0e1116";
  ctx.fillRect(ax, ay, as, as);
  if (photoImg) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(ax + 4, ay + 4, as - 8, as - 8);
    ctx.clip();
    ctx.drawImage(photoImg, ax + 4, ay + 4, as - 8, as - 8);
    ctx.restore();
  } else {
    drawPassMonogram(ctx, ax, ay, as, user?.name);
  }

  ctx.fillStyle = "#e8ecf2";
  ctx.font = "700 28px sans-serif";
  const name = (user?.name || "Гость").slice(0, 22);
  ctx.fillText(name, 190, 130);
  ctx.fillStyle = "#8a93a0";
  ctx.font = "16px sans-serif";
  ctx.fillText("CALL  " + (user?.id || "—").toString().slice(0, 12), 190, 165);
  ctx.fillText("STATUS  ACTIVE", 190, 195);
  ctx.fillStyle = "#c9a86a";
  ctx.font = "13px sans-serif";
  let status = "TAP READER TO SCAN";
  if (passUnlocked) status = "✓ CLEARANCE GRANTED";
  else if (!passTaken) status = "TAKE FROM HOOK";
  else if (!doorEventReady) status = "WAIT FOR EVENT TIMER";
  ctx.fillText(status, 190, 235);
  passTex.needsUpdate = true;
}

const passCard = new THREE.Group();
passCard.visible = false;
const passMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(0.42, 0.26),
  new THREE.MeshBasicMaterial({ map: passTex, transparent: true, opacity: 1 })
);
passCard.add(passMesh);
const passBack = new THREE.Mesh(
  new THREE.PlaneGeometry(0.42, 0.26),
  new THREE.MeshStandardMaterial({ color: 0x1a1f28, metalness: 0.4, roughness: 0.5 })
);
passBack.rotation.y = Math.PI;
passBack.position.z = -0.002;
passCard.add(passBack);
passCard.position.set(0.12, -0.18, -0.55);
passCard.rotation.set(-0.25, -0.35, -0.08);
camera.add(passCard);
drawPassCard(vkUser, null);

// «пустая» карта для отказа на ридере без пропуска
const emptyPassCanvas = document.createElement("canvas");
emptyPassCanvas.width = 256;
emptyPassCanvas.height = 160;
{
  const cx = emptyPassCanvas.getContext("2d");
  cx.fillStyle = "#1a1214";
  cx.fillRect(0, 0, 256, 160);
  cx.strokeStyle = "#ff4455";
  cx.lineWidth = 8;
  cx.strokeRect(8, 8, 240, 144);
  cx.strokeStyle = "#ff3344";
  cx.lineWidth = 6;
  cx.beginPath();
  cx.moveTo(70, 40);
  cx.lineTo(186, 120);
  cx.moveTo(186, 40);
  cx.lineTo(70, 120);
  cx.stroke();
  cx.fillStyle = "#ff8899";
  cx.font = "700 22px sans-serif";
  cx.textAlign = "center";
  cx.fillText("NO CARD", 128, 145);
}
const emptyPassTex = new THREE.CanvasTexture(emptyPassCanvas);
emptyPassTex.colorSpace = THREE.SRGBColorSpace;
const emptyPassMat = new THREE.MeshBasicMaterial({
  map: emptyPassTex,
  transparent: true,
  opacity: 0.9,
});
const emptyPassCard = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.22), emptyPassMat);
emptyPassCard.visible = false;
emptyPassCard.position.set(0.1, -0.22, -0.52);
emptyPassCard.rotation.set(-0.3, -0.3, -0.1);
camera.add(emptyPassCard);

let passPhotoImg = null;
let passAnim = 0; // 0 hidden → 1 shown

function loadEventPlayers() {
  // при общем хосте список приходит с сервера
  if (safeHostUrl) return;
  try {
    eventPlayers = JSON.parse(localStorage.getItem(EVENT_PLAYERS_KEY) || "[]");
    if (!Array.isArray(eventPlayers)) eventPlayers = [];
  } catch {
    eventPlayers = [];
  }
}

function saveEventPlayers() {
  try {
    localStorage.setItem(EVENT_PLAYERS_KEY, JSON.stringify(eventPlayers.slice(0, 48)));
  } catch {
    /* ignore */
  }
}

function registerEventPlayerLocal(user) {
  loadEventPlayers();
  const now = Date.now();
  eventPlayers = eventPlayers.filter((p) => now - (p.at || 0) < 2 * 60 * 60 * 1000);
  const idx = eventPlayers.findIndex((p) => String(p.id) === String(user.id));
  const entry = {
    id: String(user.id || "0"),
    name: user.name || "Гость",
    photo: user.photo || "",
    at: now,
    last: "зашёл",
  };
  if (idx >= 0) eventPlayers[idx] = entry;
  else eventPlayers.unshift(entry);
  saveEventPlayers();
  if (typeof drawPlayersBoard === "function") drawPlayersBoard();
}

async function registerEventPlayer(user) {
  // 1) ?host=  2) host.json с GitHub  3) localStorage  4) локально
  if (!safeHostUrl) await loadHostFromJson();
  else {
    // даже если есть старый URL в localStorage — обновим с GitHub
    await loadHostFromJson();
  }

  if (safeHostUrl) {
    const data = await hostFetch("/api/join", {
      id: String(user.id || "0"),
      name: user.name || "Гость",
      photo: user.photo || "",
    });
    if (data?.state) {
      applyHostState(data.state);
      startHostSync();
      return;
    }
    // старый туннель мёртв — ещё раз host.json и повтор
    await loadHostFromJson();
    const retry = await hostFetch("/api/join", {
      id: String(user.id || "0"),
      name: user.name || "Гость",
      photo: user.photo || "",
    });
    if (retry?.state) {
      applyHostState(retry.state);
      startHostSync();
      return;
    }
  }
  registerEventPlayerLocal(user);
}

function eventSecondsLeft() {
  // общий таймер с хоста (одинаковый у всех)
  if (eventEndsAtUnix > 0 && safeHostOnline) {
    return Math.max(0, eventEndsAtUnix - syncedNowMs() / 1000);
  }
  if (eventEndsAtUnix > 0 && safeHostUrl) {
    return Math.max(0, eventEndsAtUnix - syncedNowMs() / 1000);
  }
  // без хоста — локальный отсчёт
  const left = EVENT_UNLOCK_SEC - (performance.now() - eventStartAt) / 1000;
  return Math.max(0, left);
}

function normalizeCallsign(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
}

function ensurePlayerId() {
  try {
    let id = localStorage.getItem(PLAYER_ID_KEY);
    if (id && id !== "0") return id;
    id = "p" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
    localStorage.setItem(PLAYER_ID_KEY, id);
    return id;
  } catch {
    return "p" + Date.now().toString(36);
  }
}

function paintCheckinPassPreview(name) {
  const c = document.getElementById("checkin-pass");
  if (!c) return;
  const ctx = c.getContext("2d");
  const w = c.width;
  const h = c.height;
  const label = normalizeCallsign(name) || "ПОЗЫВНОЙ";
  const ready = normalizeCallsign(name).length >= 2;
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#2a3140");
  g.addColorStop(1, "#12161e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#c9a86a";
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.fillStyle = "#c9a86a";
  ctx.font = "700 20px sans-serif";
  ctx.fillText("FUTURUM  ·  ACCESS", 28, 44);
  ctx.fillStyle = "#6a7380";
  ctx.font = "12px sans-serif";
  ctx.fillText("IDENTITY FORGE · AGENT SEAL", 28, 66);
  drawAgentAvatar(ctx, 32, 92, 112, label);
  ctx.fillStyle = "#e8ecf2";
  ctx.font = "700 26px sans-serif";
  ctx.fillText(label.toUpperCase().slice(0, 14), 168, 128);
  ctx.fillStyle = "#8a93a0";
  ctx.font = "14px sans-serif";
  ctx.fillText("CLASS  " + agentClassFor(label), 168, 158);
  ctx.fillStyle = "#c9a86a";
  ctx.font = "13px sans-serif";
  ctx.fillText(ready ? "SEAL LOCKED · READY" : "AWAITING CALLSIGN", 168, 198);
  paintCheckinAvatar(label);
  const cls = document.getElementById("checkin-class");
  if (cls) cls.textContent = ready ? `CLASS · ${agentClassFor(label)}` : "CLASS · —";
}

async function enterGameAsPlayer(name) {
  const callsign = normalizeCallsign(name);
  if (callsign.length < 2) return false;
  const id = ensurePlayerId();
  try {
    localStorage.setItem(PLAYER_NAME_KEY, callsign);
  } catch {
    /* ignore */
  }
  vkUser = { name: callsign, photo: "", id };
  passPhotoImg = null;
  playerReady = true;
  drawPassCard(vkUser, null);
  await registerEventPlayer(vkUser);
  drawPlayersBoard();
  assignCellOwners();
  return true;
}

function finishCheckinUI() {
  const gate = document.getElementById("checkin");
  if (gate) {
    gate.classList.add("is-stamping");
    setTimeout(() => {
      gate.hidden = true;
      document.body.classList.remove("checkin-lock");
      beginIntroSequence();
    }, 280);
  } else {
    document.body.classList.remove("checkin-lock");
    beginIntroSequence();
  }
  try {
    sfxUnlock();
  } catch {
    /* audio may be locked */
  }
}

function pickAssignedRoom() {
  try {
    const k = "futurum_intro_room_" + String(vkUser.id || "x");
    let n = parseInt(localStorage.getItem(k), 10);
    if (n >= 1 && n <= INTRO_ROOM_COUNT) return n;
    n = 1 + Math.floor(Math.random() * INTRO_ROOM_COUNT);
    localStorage.setItem(k, String(n));
    return n;
  } catch {
    return 1 + Math.floor(Math.random() * INTRO_ROOM_COUNT);
  }
}

function invitationLetterText(roomNo, name) {
  return (
    `${name},\n\n` +
    `Вас ждут на закрытом эвенте FUTURUM.\n` +
    `В конверте — ключ от комнаты № ${String(roomNo).padStart(2, "0")}.\n\n` +
    `Вы уже стоите у своей двери.\n` +
    `Откройте ключом и войдите.\n\n` +
    `— Служба допуска`
  );
}

function setPhysLetterStep(step) {
  introLetterStep = step;
  const wrap = document.getElementById("intro-letter");
  const hint = document.getElementById("phys-hint");
  const btn = document.getElementById("phys-action");
  if (wrap) wrap.dataset.step = String(step);
  const hints = [
    "Конверт у вас в руках",
    "Клапан открыт — достаньте письмо",
    "Прочитайте приглашение",
    "Сложите письмо обратно",
    "В конверте ещё что-то… достаньте ключ",
  ];
  const labels = [
    "Открыть конверт",
    "Достать письмо",
    "Сложить письмо",
    "Заглянуть в конверт",
    "Взять ключ",
  ];
  if (hint) hint.textContent = hints[step] || "";
  if (btn) btn.textContent = labels[step] || "Далее";
}

function finishPhysLetter() {
  const wrap = document.getElementById("intro-letter");
  introLetterOpen = false;
  if (wrap) wrap.hidden = true;
  introHasKey = true;
  const hud = document.getElementById("intro-key-hud");
  const no = document.getElementById("intro-key-no");
  if (no) no.textContent = String(assignedRoomNo).padStart(2, "0");
  if (hud) hud.hidden = false;
  sfxClack(260, 0.06);
  setTimeout(() => sfxClack(180, 0.05), 100);
  updateSideNav();
}

function advancePhysLetter() {
  if (!introLetterOpen) return;
  ensureAudio();
  if (introLetterStep === 0) {
    sfxClack(200, 0.04);
    setPhysLetterStep(1);
  } else if (introLetterStep === 1) {
    softNoise?.(0.08, 0.02, 500, 1.2);
    sfxClack(240, 0.05);
    setPhysLetterStep(2);
  } else if (introLetterStep === 2) {
    sfxClack(180, 0.04);
    setPhysLetterStep(3);
  } else if (introLetterStep === 3) {
    sfxClack(160, 0.035);
    setPhysLetterStep(4);
  } else {
    sfxUnlock();
    finishPhysLetter();
  }
}

function showIntroLetter() {
  const wrap = document.getElementById("intro-letter");
  const body = document.getElementById("intro-sheet-body");
  const tag = document.getElementById("phys-key-tag");
  if (!wrap) return;
  assignedRoomNo = pickAssignedRoom();
  introWalkX = introDoorX(assignedRoomNo);
  snapToStand("intro");
  if (body) body.textContent = invitationLetterText(assignedRoomNo, vkUser.name || "агент");
  if (tag) tag.textContent = String(assignedRoomNo).padStart(2, "0");
  wrap.hidden = false;
  introLetterOpen = true;
  setPhysLetterStep(0);
  softNoise?.(0.05, 0.015, 350, 1.1);
}

function beginIntroSequence() {
  if (introDone) {
    enterLobbyFromIntro(true);
    return;
  }
  phase = "intro";
  if (introRoot) introRoot.visible = true;
  if (lobbyRoot) lobbyRoot.visible = false;
  assignedRoomNo = pickAssignedRoom();
  introWalkX = introDoorX(assignedRoomNo);
  snapToStand("intro");
  setTimeout(() => showIntroLetter(), 450);
}

function enterLobbyFromIntro(skipAnim = false) {
  introDone = true;
  introHasKey = false;
  focus = null;
  setStepBackVisible(false);
  const hud = document.getElementById("intro-key-hud");
  if (hud) hud.hidden = true;
  hidePassCard?.();
  if (skipAnim) {
    if (introRoot) introRoot.visible = false;
    if (lobbyRoot) lobbyRoot.visible = true;
    phase = "lobby";
    snapToStand("lobby");
    updateRoomBackBtn();
    return;
  }
  const door = introDoors.find((d) => d.no === assignedRoomNo);
  const x = door ? door.x : introWalkX;
  // шаг 1: пройти в открытую дверь
  const through = new THREE.Vector3(x, 1.52, -1.55);
  const lookThru = new THREE.Vector3(x, 1.42, -3.8);
  startCamLerp(
    through,
    lookThru,
    () => {
      // шаг 2: уже «за порогом» — холл
      if (introRoot) introRoot.visible = false;
      if (lobbyRoot) lobbyRoot.visible = true;
      phase = "lobby";
      sfxClack(150, 0.04);
      startCamLerp(
        ROOMS.lobby.stand,
        ROOMS.lobby.look,
        () => {
          snapToStand("lobby");
          updateRoomBackBtn();
        },
        0.012
      );
    },
    0.018
  );
}

{
  const btn = document.getElementById("phys-action");
  if (btn) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      advancePhysLetter();
    });
  }
}

function runCheckinBootLine() {
  const el = document.getElementById("checkin-boot");
  if (!el) return;
  const lines = [
    "SYS · LINKING CLEARANCE NODE…",
    "SCAN · FORGING AGENT SEAL…",
    "WAIT · ENTER CALLSIGN TO BIND…",
    "OK · IDENTITY FORGE ONLINE",
  ];
  let i = 0;
  const tick = () => {
    if (!document.getElementById("checkin") || document.getElementById("checkin").hidden) return;
    el.textContent = lines[i % lines.length];
    i++;
    if (i < lines.length) setTimeout(tick, 700);
    else {
      // редкий глитч строки
      setInterval(() => {
        if (document.getElementById("checkin")?.hidden) return;
        if (Math.random() > 0.82) {
          const prev = el.textContent;
          el.textContent = "ERR · █▓░ SIGNAL NOISE ░▓█";
          setTimeout(() => {
            if (el) el.textContent = prev || lines[3];
          }, 180);
        }
      }, 3200);
    }
  };
  tick();
}

function setupCheckin() {
  const gate = document.getElementById("checkin");
  const input = document.getElementById("checkin-name");
  const go = document.getElementById("checkin-go");
  if (!gate || !input || !go) {
    enterGameAsPlayer("Гость");
    document.body.classList.remove("checkin-lock");
    return;
  }

  let saved = "";
  try {
    saved = localStorage.getItem(PLAYER_NAME_KEY) || "";
  } catch {
    saved = "";
  }
  if (saved) input.value = saved;
  paintCheckinPassPreview(input.value);
  go.disabled = normalizeCallsign(input.value).length < 2;
  runCheckinBootLine();

  const sync = () => {
    const v = normalizeCallsign(input.value);
    input.value = input.value.slice(0, 18);
    paintCheckinPassPreview(input.value);
    go.disabled = v.length < 2;
    // лёгкий shake бренда при вводе
    const brand = document.getElementById("checkin-brand");
    if (brand && v) {
      brand.style.transform = `translateX(${(Math.random() - 0.5) * 3}px)`;
      setTimeout(() => {
        if (brand) brand.style.transform = "";
      }, 80);
    }
  };
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !go.disabled) {
      e.preventDefault();
      go.click();
    }
  });

  go.addEventListener("click", async (e) => {
    e.preventDefault();
    if (go.disabled || playerReady) return;
    go.disabled = true;
    const boot = document.getElementById("checkin-boot");
    if (boot) boot.textContent = "SEAL · ENGRAVING PASS…";
    const ok = await enterGameAsPlayer(input.value);
    if (!ok) {
      go.disabled = false;
      return;
    }
    finishCheckinUI();
  });

  setTimeout(() => {
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus?.();
    }
  }, 350);
}

setupCheckin();

function showPassCard() {
  if (!passTaken || passScanning || passScanDeny || passTakeT >= 0) return;
  passCardOut = true;
  passCard.visible = true;
  passAnim = 0;
  passMesh.material.opacity = 1;
  drawPassCard(vkUser, passPhotoImg);
  sfxClack(320, 0.06);
}

function hidePassCard() {
  passCardOut = false;
  passScanning = false;
  passScanDeny = false;
  passCard.visible = false;
  passAnim = 0;
  passMesh.material.opacity = 1;
  passInspectT = -1;
  passPocketT = -1;
}

function scanPass() {
  if (!passTaken || passUnlocked || passScanning || passScanDeny || !passCardOut) return;
  ensureAudio();
  passScanT = 0;
  // до конца таймера эвента — карта не разблокирует
  if (!doorEventReady) {
    passScanDeny = true;
    ledMode = "deny";
    ledBlinkT = 0;
    drawPassCard(vkUser, passPhotoImg);
    sfxBeep(220, 0.06);
    setTimeout(() => sfxRattle(), 100);
    return;
  }
  passScanning = true;
  ledMode = "blink";
  ledBlinkT = 0;
  drawPassCard(vkUser, passPhotoImg);
  sfxBeep(880, 0.08);
  setTimeout(() => sfxBeep(1200, 0.1), 180);
}

// свет холла: низкий ambient, основной — тёплые лампы
ambientLight = new THREE.AmbientLight(0xffd8a8, 0.12);
scene.add(ambientLight);
hemi = new THREE.HemisphereLight(0xffe0b8, 0x2a2218, 0.16);
scene.add(hemi);

let keyLight = null;
let spot = null;
let fillWarm = null;
let fillCool = null;

keyLight = new THREE.DirectionalLight(0xffc878, 0.22);
keyLight.position.set(2.5, 9, 22);
keyLight.userData.wantShadow = true;
keyLight.castShadow = !perfLow;
keyLight.shadow.mapSize.set(perfLow ? 512 : 2048, perfLow ? 512 : 2048);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 40;
keyLight.shadow.camera.left = -8;
keyLight.shadow.camera.right = 8;
keyLight.shadow.camera.top = 8;
keyLight.shadow.camera.bottom = -8;
keyLight.shadow.bias = -0.00025;
keyLight.shadow.normalBias = 0.03;
scene.add(keyLight);

spot = new THREE.SpotLight(0xffc898, 5.5, 28, Math.PI / 6, 0.55, 1.2);
spot.position.set(0, 5.8, 19.5);
spot.target.position.set(0, 1.4, 16.6);
spot.userData.wantShadow = true;
spot.castShadow = !perfLow;
spot.shadow.mapSize.set(perfLow ? 512 : 1024, perfLow ? 512 : 1024);
spot.shadow.bias = -0.0002;
scene.add(spot, spot.target);

fillWarm = new THREE.PointLight(0xffb060, 1.6, 14, 2);
fillWarm.position.set(-2.2, 3.2, 21);
scene.add(fillWarm);
fillCool = new THREE.PointLight(0xffe0c0, 0.15, 12, 2);
fillCool.position.set(2.5, 3.0, 18.5);
scene.add(fillCool);

snapToStand("intro");
updateRoomBackBtn();

/* —— audio: мягкие ASMR-звуки —— */
let audioCtx = null;
let master = null;
let musicOn = false;
let musicTrack = 0;
let musicVolume = 0.02; // по умолчанию 2%
let musicStatus = "idle"; // idle | connecting | playing | error
let musicPlayId = 0;
let radioEl = null;
let lampHumOn = false;
let lampHumGain = null; // гул потолочных ламп (гаснет вместе со светом)
let roomToneGain = null; // постоянный тихий фон комнаты (не зависит от выключателя)
let lampHumTarget = 0.014;
const RADIO_WORLD = new THREE.Vector3(2.95, 1.05, 20.9);

/** живые интернет-станции (HTMLAudio, без MediaElementSource — иначе CORS глушит) */
const RADIO_STATIONS = [
  {
    name: "Groove Salad",
    tag: "chill · SomaFM",
    url: "https://ice6.somafm.com/groovesalad-128-mp3",
  },
  {
    name: "Lush",
    tag: "ambient · SomaFM",
    url: "https://ice6.somafm.com/lush-128-mp3",
  },
  {
    name: "Space Station",
    tag: "space · SomaFM",
    url: "https://ice6.somafm.com/spacestation-128-mp3",
  },
  {
    name: "Drone Zone",
    tag: "drone · SomaFM",
    url: "https://ice6.somafm.com/dronezone-128-mp3",
  },
  {
    name: "Radio Record",
    tag: "dance · RU",
    url: "https://radiorecord.hostingradio.ru/rr_main96.aacp",
  },
  {
    name: "Europa Plus",
    tag: "hits · RU",
    url: "https://ep128.hostingradio.ru:8030/ep128",
  },
  {
    name: "Monte Carlo",
    tag: "lounge · RU",
    url: "https://montecarlo.hostingradio.ru/montecarlo96.aacp",
  },
];

function currentStation() {
  return RADIO_STATIONS[musicTrack % RADIO_STATIONS.length];
}

function musicRoomVol() {
  if (phase === "vault") return 0.18;
  if (phase === "gate") return 0.32;
  const d = camAnchor.distanceTo(RADIO_WORLD);
  if (focus === "radio" || d < 2.2) return 1;
  if (d < 4) return 0.7;
  return 0.48;
}

function applyMusicSpatial() {
  if (!radioEl || !musicOn) return;
  radioEl.volume = Math.max(0, Math.min(1, musicVolume * musicRoomVol()));
}

function setMusicVolume(v) {
  // шаги по 2%: 0, 2, 4, …, 100
  musicVolume = Math.max(0, Math.min(1, Math.round(v * 50) / 50));
  applyMusicSpatial();
  if (typeof updateRadioDisplay === "function") updateRadioDisplay();
}

function bumpMusicVolume(delta) {
  setMusicVolume(musicVolume + delta);
  softNoise(0.02, 0.012, 800, 2);
}

/** автозапуск на 2% (браузер может потребовать жест пользователя) */
function tryAutoStartRadio() {
  if (musicOn || musicStatus === "connecting") return;
  setMusicVolume(0.02);
  playLobbyMusic(musicTrack);
}

function ensureRadioEl() {
  if (radioEl) return radioEl;
  radioEl = new Audio();
  radioEl.preload = "none";
  // без crossOrigin: поток идёт напрямую в динамики, CORS не нужен
  radioEl.addEventListener("playing", () => {
    if (!musicOn) return;
    musicStatus = "playing";
    if (typeof updateRadioDisplay === "function") updateRadioDisplay();
  });
  radioEl.addEventListener("waiting", () => {
    if (!musicOn) return;
    musicStatus = "connecting";
    if (typeof updateRadioDisplay === "function") updateRadioDisplay();
  });
  radioEl.addEventListener("stalled", () => {
    if (!musicOn) return;
    musicStatus = "connecting";
    if (typeof updateRadioDisplay === "function") updateRadioDisplay();
  });
  radioEl.addEventListener("error", () => {
    if (!musicOn) return;
    musicStatus = "error";
    musicOn = false;
    if (typeof updateRadioDisplay === "function") updateRadioDisplay();
  });
  return radioEl;
}

let sfxBus = null; // отдельная шина SFX — не тонет в гудах/радио

function ensureAudio() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      master = audioCtx.createGain();
      master.gain.value = 0.7;
      master.connect(audioCtx.destination);
      sfxBus = audioCtx.createGain();
      sfxBus.gain.value = 1.15;
      sfxBus.connect(master);
    }
    if (!sfxBus && master) {
      sfxBus = audioCtx.createGain();
      sfxBus.gain.value = 1.15;
      sfxBus.connect(master);
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
  } catch {
    /* ignore */
  }
  return audioCtx;
}

function sfxOut() {
  return sfxBus || master;
}

function makeLoopNoise(a, seconds, color = "white") {
  const n = Math.max(1, (a.sampleRate * seconds) | 0);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (color === "brown") {
      b0 = (b0 + 0.02 * w) / 1.02;
      d[i] = b0 * 3.5;
    } else if (color === "pink") {
      b0 = 0.98 * b0 + 0.02 * w;
      d[i] = b0 * 2.2 + w * 0.15;
    } else {
      d[i] = w;
    }
  }
  return buf;
}

function startLampHum() {
  const a = ensureAudio();
  if (!a || !master || lampHumOn) return;
  lampHumOn = true;

  // постоянный тон комнаты (вентиляция / воздух) — не гаснет с лампами
  roomToneGain = a.createGain();
  roomToneGain.gain.value = 0.045;
  roomToneGain.connect(master);
  try {
    const roomSrc = a.createBufferSource();
    roomSrc.buffer = makeLoopNoise(a, 3, "brown");
    roomSrc.loop = true;
    const roomLp = a.createBiquadFilter();
    roomLp.type = "lowpass";
    roomLp.frequency.value = 280;
    roomLp.Q.value = 0.5;
    const roomHp = a.createBiquadFilter();
    roomHp.type = "highpass";
    roomHp.frequency.value = 40;
    const roomG = a.createGain();
    roomG.gain.value = 0.55;
    roomSrc.connect(roomHp);
    roomHp.connect(roomLp);
    roomLp.connect(roomG);
    roomG.connect(roomToneGain);
    roomSrc.start();
  } catch {
    /* ignore */
  }

  // гул люминесцентных / тёплых ламп — мягче, ближе к реальному ballast
  lampHumGain = a.createGain();
  lampHumGain.gain.value = lobbyLightsOn ? 0.012 : 0.0001;
  lampHumGain.connect(master);
  lampHumTarget = lobbyLightsOn ? 0.014 : 0.0001;

  // 50 Гц сеть + гармоники (не писк на 100/120)
  const humMix = a.createGain();
  humMix.gain.value = 0.55;
  humMix.connect(lampHumGain);
  const harmonics = [
    [50, 0.55],
    [100, 0.35],
    [150, 0.12],
    [200, 0.06],
  ];
  for (const [freq, vol] of harmonics) {
    const o = a.createOscillator();
    o.type = "sine";
    o.frequency.value = freq;
    const g = a.createGain();
    g.gain.value = vol;
    o.connect(g);
    g.connect(humMix);
    o.start();
  }

  // мягкий свист/шипение трубки (не резкий bandpass)
  try {
    const tubeSrc = a.createBufferSource();
    tubeSrc.buffer = makeLoopNoise(a, 2.5, "pink");
    tubeSrc.loop = true;
    const bp = a.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 920;
    bp.Q.value = 0.55;
    const lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2400;
    const ng = a.createGain();
    ng.gain.value = 0.14;
    tubeSrc.connect(bp);
    bp.connect(lp);
    lp.connect(ng);
    ng.connect(lampHumGain);
    tubeSrc.start();
  } catch {
    /* ignore */
  }
}

/** совместимость: раньше startMusic() вызывался на клик — теперь только аудио+гул */
function startMusic() {
  ensureAudio();
  startLampHum();
}

function noiseBuf(dur = 0.05) {
  const a = ensureAudio();
  if (!a) return null;
  const n = (a.sampleRate * dur) | 0;
  const b = a.createBuffer(1, n, a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const env = 1 - i / n;
    d[i] = (Math.random() * 2 - 1) * env * env;
  }
  return b;
}

function tone(freq, dur, vol, type = "sine", slide = 1) {
  const a = ensureAudio();
  const out = sfxOut();
  if (!a || !out) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  const g = a.createGain();
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = Math.min(5200, freq * 5);
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
  const v = Math.max(0.0001, vol);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f);
  f.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + dur + 0.03);
}

function softNoise(dur, vol, freq = 800, q = 2) {
  const a = ensureAudio();
  const out = sfxOut();
  if (!a || !out) return;
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noiseBuf(Math.max(0.02, dur));
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = a.createGain();
  const v = Math.max(0.0001, vol);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(t + dur + 0.03);
}

function sfxTick() {
  tone(1850, 0.04, 0.045, "sine", 0.85);
  softNoise(0.025, 0.028, 2400, 6);
}

function sfxClack(p = 220, vol = 0.07) {
  tone(p * 1.4, 0.06, vol * 0.75, "triangle", 0.55);
  softNoise(0.045, vol * 0.55, p * 2.2, 1.6);
}

/** щелчок рокер-выключателя */
function sfxSwitch(on) {
  ensureAudio();
  softNoise(0.018, 0.055, on ? 2800 : 2200, 8);
  tone(on ? 1900 : 1400, 0.035, 0.05, "square", 0.45);
  setTimeout(() => softNoise(0.03, 0.03, on ? 900 : 700, 2.5), 25);
  setTimeout(() => tone(on ? 420 : 320, 0.04, 0.025, "triangle", 0.7), 35);
}

/** клик настольной лампы */
function sfxLamp(on) {
  ensureAudio();
  softNoise(0.022, 0.04, on ? 2400 : 1600, 6);
  tone(on ? 880 : 520, 0.05, 0.035, "triangle", 0.6);
  if (on) setTimeout(() => softNoise(0.08, 0.018, 400, 1.2), 40);
}

/** взял пропуск с крючка */
function sfxPassTake() {
  ensureAudio();
  softNoise(0.07, 0.035, 650, 1.3);
  tone(340, 0.08, 0.03, "sine", 1.15);
  setTimeout(() => softNoise(0.05, 0.025, 1200, 2), 50);
  setTimeout(() => tone(520, 0.06, 0.022, "triangle", 0.9), 90);
}

/** убрал карту в карман */
function sfxPassPocket() {
  ensureAudio();
  softNoise(0.1, 0.03, 380, 1.1);
  tone(180, 0.07, 0.02, "triangle", 0.75);
}

function sfxBeep(freq = 720, vol = 0.06) {
  tone(freq, 0.11, vol, "sine", 1.05);
}

function sfxUnlock() {
  tone(523, 0.14, 0.055, "sine", 1);
  setTimeout(() => tone(659, 0.14, 0.06, "sine", 1), 90);
  setTimeout(() => tone(784, 0.22, 0.065, "sine", 1), 180);
  setTimeout(() => softNoise(0.12, 0.035, 600, 1.2), 260);
}

function sfxRattle() {
  softNoise(0.07, 0.055, 300, 1.3);
  setTimeout(() => tone(150, 0.05, 0.04, "triangle", 0.7), 25);
  setTimeout(() => softNoise(0.06, 0.04, 240, 1.1), 60);
  setTimeout(() => tone(120, 0.07, 0.035, "triangle", 0.6), 100);
  setTimeout(() => softNoise(0.05, 0.03, 180, 1), 140);
}

function sfxHeavy() {
  tone(70, 0.55, 0.07, "sine", 0.65);
  softNoise(0.45, 0.05, 160, 0.8);
}

function sfxDoor() {
  softNoise(0.65, 0.07, 300, 0.95);
  tone(95, 0.45, 0.055, "sine", 0.55);
  setTimeout(() => softNoise(0.35, 0.04, 180, 0.7), 180);
}

function sfxHandle() {
  softNoise(0.09, 0.045, 480, 1.5);
  tone(250, 0.08, 0.04, "triangle", 0.7);
  setTimeout(() => softNoise(0.06, 0.03, 320, 1.2), 50);
}

function stopLobbyMusic() {
  musicPlayId++;
  musicOn = false;
  musicStatus = "idle";
  if (radioEl) {
    try {
      radioEl.pause();
      radioEl.removeAttribute("src");
      radioEl.load();
    } catch {
      /* ignore */
    }
  }
  if (typeof updateRadioDisplay === "function") updateRadioDisplay();
}

function playLobbyMusic(trackIndex) {
  ensureAudio();
  startLampHum();
  if (typeof trackIndex === "number") musicTrack = trackIndex;
  musicTrack = ((musicTrack % RADIO_STATIONS.length) + RADIO_STATIONS.length) % RADIO_STATIONS.length;

  const station = currentStation();
  const el = ensureRadioEl();
  const playId = ++musicPlayId;

  try {
    el.pause();
  } catch {
    /* ignore */
  }

  musicOn = true;
  musicStatus = "connecting";
  el.src = station.url;
  applyMusicSpatial();
  el.play()
    .then(() => {
      if (playId !== musicPlayId) return;
      musicStatus = "playing";
      if (typeof updateRadioDisplay === "function") updateRadioDisplay();
    })
    .catch(() => {
      if (playId !== musicPlayId) return;
      musicOn = false;
      musicStatus = "error";
      if (typeof updateRadioDisplay === "function") updateRadioDisplay();
    });

  sfxBeep(660, 0.04);
  if (typeof updateRadioDisplay === "function") updateRadioDisplay();
}

function nextMusicTrack() {
  musicTrack = (musicTrack + 1) % RADIO_STATIONS.length;
  if (musicOn || musicStatus === "connecting" || musicStatus === "error") {
    playLobbyMusic(musicTrack);
  } else if (typeof updateRadioDisplay === "function") {
    updateRadioDisplay();
  }
  sfxClack(260, 0.04);
}

function canvasTex(draw, size = 512, opts = {}) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  draw(c.getContext("2d"), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) tex.repeat.set(opts.repeat, opts.repeat);
  tex.anisotropy = 8;
  return tex;
}

function makeNoise(ctx, size, amount = 0.06) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const amp = amount * 255;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amp;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function makeWallTexture() {
  return canvasTex((ctx, s) => {
    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 50; i++) {
      const g = 230 + ((Math.random() * 18) | 0);
      ctx.fillStyle = `rgba(${g},${g},${g},${0.08 + Math.random() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * s,
        Math.random() * s,
        30 + Math.random() * 90,
        12 + Math.random() * 40,
        Math.random() * Math.PI,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    makeNoise(ctx, s, 0.015);
  }, 512, { repeat: 3 });
}

function makeFloorTexture() {
  return canvasTex((ctx, s) => {
    const tile = s / 4;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const shade = 235 + ((x + y) % 2) * 8;
        ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
        ctx.fillRect(x * tile, y * tile, tile - 2, tile - 2);
        ctx.strokeStyle = "rgba(200,200,200,0.8)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x * tile + 1, y * tile + 1, tile - 4, tile - 4);
      }
    }
    makeNoise(ctx, s, 0.03);
  }, 512, { repeat: 6 });
}

/** тёплая штукатурка холла */
function makeLobbyWallTexture() {
  return canvasTex((ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, "#d8c8b0");
    g.addColorStop(0.4, "#cbb9a0");
    g.addColorStop(1, "#c0ae94");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      const r = 180 + ((Math.random() * 40) | 0);
      const gg = 160 + ((Math.random() * 35) | 0);
      const b = 130 + ((Math.random() * 30) | 0);
      ctx.fillStyle = `rgba(${r},${gg},${b},${0.05 + Math.random() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * s,
        Math.random() * s,
        20 + Math.random() * 80,
        10 + Math.random() * 50,
        Math.random() * Math.PI,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    // тонкие вертикальные следы валика
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * s;
      ctx.strokeStyle = `rgba(255,240,220,${0.015 + Math.random() * 0.03})`;
      ctx.lineWidth = 2 + Math.random() * 4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (Math.random() - 0.5) * 8, s);
      ctx.stroke();
    }
    makeNoise(ctx, s, 0.02);
  }, 512, { repeat: 2.5 });
}

/** паркет ёлкой */
function makeLobbyFloorTexture() {
  return canvasTex((ctx, s) => {
    ctx.fillStyle = "#6a5238";
    ctx.fillRect(0, 0, s, s);
    const plankW = s / 8;
    const plankH = s / 4;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const flip = (row + col) % 2 === 0;
        const x = col * plankW;
        const y = row * (plankH / 2);
        ctx.save();
        ctx.translate(x + plankW / 2, y + plankH / 4);
        ctx.rotate(flip ? Math.PI / 4 : -Math.PI / 4);
        const shade = 110 + ((row * 7 + col * 13) % 40);
        ctx.fillStyle = `rgb(${shade + 30},${shade},${shade - 25})`;
        ctx.fillRect(-plankW * 0.7, -plankH * 0.12, plankW * 1.4, plankH * 0.22);
        // волокна
        ctx.strokeStyle = `rgba(60,40,20,${0.08 + Math.random() * 0.1})`;
        ctx.lineWidth = 1;
        for (let k = 0; k < 4; k++) {
          const ly = -plankH * 0.08 + k * 4;
          ctx.beginPath();
          ctx.moveTo(-plankW * 0.65, ly);
          ctx.lineTo(plankW * 0.65, ly + (Math.random() - 0.5) * 2);
          ctx.stroke();
        }
        ctx.strokeStyle = "rgba(40,25,12,0.35)";
        ctx.strokeRect(-plankW * 0.7, -plankH * 0.12, plankW * 1.4, plankH * 0.22);
        ctx.restore();
      }
    }
    makeNoise(ctx, s, 0.035);
  }, 512, { repeat: 4 });
}

/** текстура дерева для мебели */
function makeWoodTexture(base = [140, 110, 75]) {
  return canvasTex((ctx, s) => {
    const [br, bg, bb] = base;
    ctx.fillStyle = `rgb(${br},${bg},${bb})`;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * s;
      const wobble = (Math.random() - 0.5) * 18;
      ctx.strokeStyle = `rgba(${br - 40},${bg - 35},${bb - 30},${0.08 + Math.random() * 0.18})`;
      ctx.lineWidth = 1 + Math.random() * 2.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.33, y + wobble, s * 0.66, y - wobble, s, y + wobble * 0.5);
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const y = Math.random() * s;
      ctx.strokeStyle = `rgba(${br + 40},${bg + 30},${bb + 15},0.12)`;
      ctx.lineWidth = 8 + Math.random() * 14;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y + (Math.random() - 0.5) * 10);
      ctx.stroke();
    }
    makeNoise(ctx, s, 0.04);
  }, 512, { repeat: 2 });
}

/** ковровая текстура */
function makeCarpetTexture(c1 = [55, 70, 62], c2 = [180, 150, 90]) {
  return canvasTex((ctx, s) => {
    const [r1, g1, b1] = c1;
    const [r2, g2, b2] = c2;
    ctx.fillStyle = `rgb(${r1},${g1},${b1})`;
    ctx.fillRect(0, 0, s, s);
    const step = 6;
    for (let y = 0; y < s; y += step) {
      for (let x = 0; x < s; x += step) {
        const lit = ((x + y) / step) % 2 === 0;
        ctx.fillStyle = lit
          ? `rgba(${r1 + 18},${g1 + 16},${b1 + 12},0.55)`
          : `rgba(${r1 - 10},${g1 - 8},${b1 - 6},0.4)`;
        ctx.fillRect(x, y, step - 1, step - 1);
      }
    }
    // кайма
    ctx.strokeStyle = `rgb(${r2},${g2},${b2})`;
    ctx.lineWidth = 18;
    ctx.strokeRect(14, 14, s - 28, s - 28);
    ctx.strokeStyle = `rgba(${r2 + 30},${g2 + 20},${b2},0.7)`;
    ctx.lineWidth = 4;
    ctx.strokeRect(28, 28, s - 56, s - 56);
    // орнамент по центру
    ctx.strokeStyle = `rgba(${r2},${g2},${b2},0.45)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.22);
    ctx.lineTo(s * 0.72, s * 0.5);
    ctx.lineTo(s * 0.5, s * 0.78);
    ctx.lineTo(s * 0.28, s * 0.5);
    ctx.closePath();
    ctx.stroke();
    makeNoise(ctx, s, 0.05);
  }, 256, { repeat: 1 });
}

/** кожа для кресла */
function makeLeatherTexture() {
  return canvasTex((ctx, s) => {
    ctx.fillStyle = "#3a4550";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 120; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const rad = 8 + Math.random() * 28;
      ctx.fillStyle = `rgba(${40 + Math.random() * 30},${48 + Math.random() * 30},${55 + Math.random() * 25},0.2)`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    makeNoise(ctx, s, 0.045);
  }, 256, { repeat: 2 });
}

/** абстрактная картина */
function makeArtTexture(seed = 1) {
  return canvasTex((ctx, s) => {
    ctx.fillStyle = seed === 1 ? "#1a2230" : "#2a2018";
    ctx.fillRect(0, 0, s, s);
    const palette =
      seed === 1
        ? ["#c9a86a", "#8a9aaa", "#d4c4a8", "#5a7080", "#e8dcc8"]
        : ["#a86848", "#c9a86a", "#6a5040", "#e0d0b8", "#8a7060"];
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = palette[i % palette.length];
      ctx.globalAlpha = 0.35 + Math.random() * 0.45;
      ctx.beginPath();
      if (i % 3 === 0) {
        ctx.rect(Math.random() * s * 0.7, Math.random() * s * 0.7, 40 + Math.random() * 120, 20 + Math.random() * 80);
      } else {
        ctx.ellipse(
          Math.random() * s,
          Math.random() * s,
          20 + Math.random() * 90,
          15 + Math.random() * 60,
          Math.random() * Math.PI,
          0,
          Math.PI * 2
        );
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    makeNoise(ctx, s, 0.03);
  }, 256);
}

function makeMetalTexture() {
  return canvasTex((ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, "#9a9a9a");
    g.addColorStop(0.35, "#6e6e6e");
    g.addColorStop(0.55, "#8a8a8a");
    g.addColorStop(1, "#555555");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 120; i++) {
      const y = Math.random() * s;
      ctx.strokeStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y + (Math.random() - 0.5) * 4);
      ctx.stroke();
    }
    makeNoise(ctx, s, 0.05);
  }, 512);
}

/** текстура входной двери — гладкий крашеный металл (отличается от стены) */
function makeLobbyDoorTexture() {
  return canvasTex((ctx, s) => {
    const base = ctx.createLinearGradient(0, 0, s, 0);
    base.addColorStop(0, "#b8bcc0");
    base.addColorStop(0.2, "#d5d9dc");
    base.addColorStop(0.5, "#c8ccd0");
    base.addColorStop(0.8, "#d8dce0");
    base.addColorStop(1, "#aeb4b8");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * s;
      ctx.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.03})`;
      ctx.fillRect(x, 0, 1, s);
    }
    // рамка створки
    ctx.strokeStyle = "#8a9096";
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, s - 20, s - 20);
    ctx.strokeStyle = "#e8ecf0";
    ctx.lineWidth = 4;
    ctx.strokeRect(22, 22, s - 44, s - 44);
    makeNoise(ctx, s, 0.012);
  }, 512);
}

/** белый бетон / штукатурка стены у ворот */
function makeConcreteTexture() {
  return canvasTex((ctx, s) => {
    ctx.fillStyle = "#ececec";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 200; i++) {
      const g = 200 + ((Math.random() * 40) | 0);
      ctx.fillStyle = `rgba(${g},${g},${g},${0.04 + Math.random() * 0.08})`;
      ctx.beginPath();
      ctx.arc(Math.random() * s, Math.random() * s, 2 + Math.random() * 18, 0, Math.PI * 2);
      ctx.fill();
    }
    // тонкие трещины
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = `rgba(160,160,160,${0.08 + Math.random() * 0.1})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      let x = Math.random() * s, y = Math.random() * s;
      ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) {
        x += (Math.random() - 0.5) * 80;
        y += (Math.random() - 0.5) * 80;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    makeNoise(ctx, s, 0.05);
  }, 512, { repeat: 3 });
}

const wallTex = makeWallTexture();
const floorTex = makeFloorTexture();
const lobbyWallTex = makeLobbyWallTexture();
const lobbyFloorTex = makeLobbyFloorTexture();
const woodTex = makeWoodTexture([150, 118, 82]);
const woodDarkTex = makeWoodTexture([110, 82, 55]);
const carpetTex = makeCarpetTexture([52, 68, 60], [190, 155, 95]);
const rugTex = makeCarpetTexture([48, 42, 38], [170, 130, 80]);
const leatherTex = makeLeatherTexture();
const artTexA = makeArtTexture(1);
const artTexB = makeArtTexture(2);
const metalTex = makeMetalTexture();
const lobbyDoorTex = makeLobbyDoorTexture();
const concreteTex = makeConcreteTexture();
const metalMat = new THREE.MeshStandardMaterial({
  map: metalTex,
  metalness: 0.85,
  roughness: 0.35,
});
const metalDarkMat = new THREE.MeshStandardMaterial({
  map: metalTex,
  color: 0x888888,
  metalness: 0.9,
  roughness: 0.28,
});
const lobbyDoorMat = new THREE.MeshStandardMaterial({
  map: lobbyDoorTex,
  metalness: 0.35,
  roughness: 0.45,
});
const frameMat = new THREE.MeshStandardMaterial({
  color: 0x9a9a9a,
  metalness: 0.65,
  roughness: 0.38,
});

/* —— табло на двери —— */
const boardCanvas = document.createElement("canvas");
boardCanvas.width = 512;
boardCanvas.height = 220;
const boardCtx = boardCanvas.getContext("2d");
const boardTex = new THREE.CanvasTexture(boardCanvas);
boardTex.colorSpace = THREE.SRGBColorSpace;

function drawBoard(flash = null) {
  const w = boardCanvas.width;
  const h = boardCanvas.height;
  const ctx = boardCtx;
  const need = GATE_CODE.length;
  ctx.fillStyle = "#070a0e";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#c9a86a";
  ctx.lineWidth = 5;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = "#8a7a60";
  ctx.font = "600 18px monospace";
  ctx.textAlign = "center";
  ctx.fillText("FUTURUM ACCESS", w / 2, 36);
  ctx.fillStyle = flash === "ok" ? "#7dba7d" : flash === "bad" ? "#c45c4a" : "#5a6570";
  ctx.font = "14px monospace";
  ctx.fillText(
    flash === "ok" ? "ACCESS GRANTED" : flash === "bad" ? "ACCESS DENIED" : "ENTER CODE",
    w / 2,
    58
  );
  const slotW = Math.min(72, (w - 80) / need);
  const totalW = need * slotW + (need - 1) * 12;
  const startX = (w - totalW) / 2;
  for (let i = 0; i < need; i++) {
    const x = startX + i * (slotW + 12);
    ctx.fillStyle = "#101820";
    ctx.fillRect(x, 85, slotW, 88);
    ctx.strokeStyle =
      flash === "ok" ? "#7dba7d" : flash === "bad" ? "#c45c4a" : entered[i] !== undefined ? "#c9a86a" : "#2a3340";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, 85, slotW, 88);
    ctx.fillStyle = flash === "bad" ? "#c45c4a" : flash === "ok" ? "#7dba7d" : "#edd9a3";
    ctx.font = "800 52px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(entered[i] !== undefined ? String(entered[i]) : "·", x + slotW / 2, 130);
  }
  boardTex.needsUpdate = true;
}

/* ===================== LOBBY — входная дверь ===================== */
const lobbyRoot = new THREE.Group();
scene.add(lobbyRoot);
lobbyRoot.visible = false; // сначала комната 0 (коридор)

/* —— КОМНАТА 0: двери в ряд слева→направо —— */
introRoot = new THREE.Group();
scene.add(introRoot);
{
  const span = INTRO_ROOM_COUNT * INTRO_DOOR_SPACING + 4;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xc8b8a0, roughness: 0.88, metalness: 0.04 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x8a7355, roughness: 0.55, metalness: 0.15 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.75 });
  const carpetMat = new THREE.MeshStandardMaterial({ color: 0x5a3a3a, roughness: 0.92 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d4, roughness: 0.9 });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(span, 0.08, 6.5), floorMat);
  floor.position.set(0, -0.04, 1.2);
  floor.receiveShadow = true;
  introRoot.add(floor);
  const runner = new THREE.Mesh(new THREE.BoxGeometry(span - 1, 0.02, 1.4), carpetMat);
  runner.position.set(0, 0.01, 1.6);
  runner.receiveShadow = true;
  introRoot.add(runner);
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(span, 0.1, 6.5), ceilMat);
  ceil.position.set(0, 3.05, 1.2);
  introRoot.add(ceil);
  // задняя стена с дверями
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(span, 3.1, 0.25), wallMat);
  backWall.position.set(0, 1.5, -0.35);
  backWall.receiveShadow = true;
  introRoot.add(backWall);
  // плинтус / карниз
  const base = new THREE.Mesh(new THREE.BoxGeometry(span, 0.12, 0.08), trimMat);
  base.position.set(0, 0.06, -0.18);
  introRoot.add(base);
  const crown = new THREE.Mesh(new THREE.BoxGeometry(span, 0.1, 0.08), trimMat);
  crown.position.set(0, 2.95, -0.18);
  introRoot.add(crown);
  // боковые торцы
  [-1, 1].forEach((side) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.1, 6.5), wallMat);
    w.position.set(side * (span / 2 - 0.1), 1.5, 1.2);
    introRoot.add(w);
  });
  // бра между дверями + потолочные
  for (let i = 0; i < INTRO_ROOM_COUNT; i++) {
    const x = introDoorX(i + 1);
    if (i < INTRO_ROOM_COUNT - 1) {
      const mid = (introDoorX(i + 1) + introDoorX(i + 2)) / 2;
      const sconce = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.06, 0.12, 10),
        new THREE.MeshStandardMaterial({
          color: 0xe8dcc0,
          emissive: 0xffd090,
          emissiveIntensity: 0.7,
        })
      );
      sconce.position.set(mid, 2.15, -0.15);
      introRoot.add(sconce);
      const sl = new THREE.PointLight(0xffe0b0, perfLow ? 0.55 : 1.1, 4.5, 2);
      sl.position.set(mid, 2.05, 0.4);
      introRoot.add(sl);
    }
    const ceilLamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.05, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xf0e8d8, emissive: 0xffe8c0, emissiveIntensity: 0.5 })
    );
    ceilLamp.position.set(x, 2.98, 1.5);
    introRoot.add(ceilLamp);
  }

  const doorMat = new THREE.MeshStandardMaterial({ color: 0x6a4e32, metalness: 0.2, roughness: 0.48 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x5a4228, metalness: 0.15, roughness: 0.55 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a2a18, metalness: 0.25, roughness: 0.45 });

  function makeIntroDoor(no) {
    const x = introDoorX(no);
    const root = new THREE.Group();
    root.position.set(x, 0, 0);
    introRoot.add(root);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.45, 0.14), frameMat);
    frame.position.set(0, 1.2, -0.12);
    root.add(frame);
    const pivot = new THREE.Group();
    pivot.position.set(-0.48, 0, 0.02);
    root.add(pivot);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.98, 2.25, 0.07), doorMat);
    door.position.set(0.48, 1.12, 0);
    door.castShadow = true;
    door.userData.kind = "introDoor";
    door.userData.roomNo = no;
    pivot.add(door);
    // филёнки
    [[0.48, 1.55, 0.42, 0.55], [0.48, 0.75, 0.42, 0.55]].forEach(([px, py, w, h]) => {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), panelMat);
      panel.position.set(px, py, 0.045);
      panel.userData.kind = "introDoor";
      panel.userData.roomNo = no;
      pivot.add(panel);
    });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), brass);
    knob.position.set(0.85, 1.05, 0.07);
    knob.userData.kind = "introDoor";
    knob.userData.roomNo = no;
    pivot.add(knob);
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.28, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xc9a86a, metalness: 0.7, roughness: 0.3 })
    );
    plate.position.set(0.48, 1.85, 0.05);
    plate.userData.kind = "introDoor";
    plate.userData.roomNo = no;
    pivot.add(plate);
    const numC = document.createElement("canvas");
    numC.width = 128;
    numC.height = 128;
    const nctx = numC.getContext("2d");
    nctx.clearRect(0, 0, 128, 128);
    nctx.fillStyle = "#1a1208";
    nctx.font = "700 58px monospace";
    nctx.textAlign = "center";
    nctx.textBaseline = "middle";
    nctx.fillText(String(no).padStart(2, "0"), 64, 70);
    const ntex = new THREE.CanvasTexture(numC);
    ntex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, 0.18),
      new THREE.MeshBasicMaterial({ map: ntex })
    );
    label.position.set(0.48, 1.85, 0.065);
    label.userData.kind = "introDoor";
    label.userData.roomNo = no;
    pivot.add(label);
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 2.5, 0.55),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(0, 1.2, 0.2);
    hit.userData.kind = "introDoor";
    hit.userData.roomNo = no;
    root.add(hit);
    const targets = [door, knob, plate, label, hit, ...pivot.children];
    introDoors.push({
      no,
      x,
      root,
      pivot,
      door,
      targets,
      open: false,
      openT: 0,
      opening: false,
    });
    FOCUS["introDoor" + no] = {
      pos: new THREE.Vector3(x, 1.5, 2.0),
      target: new THREE.Vector3(x, 1.35, 0.05),
      yawRange: 0.28,
      pitchRange: 0.16,
    };
  }

  for (let i = 1; i <= INTRO_ROOM_COUNT; i++) makeIntroDoor(i);
}

function tryIntroDoor(roomNo) {
  if (phase !== "intro" || introLetterOpen || introDoorUnlocking || camLerp) return;
  if (!introHasKey) {
    showNote("Сначала конверт", "Откройте конверт, прочитайте письмо и достаньте ключ.");
    return;
  }
  const focusId = "introDoor" + roomNo;
  if (focus !== focusId) {
    approachFocus(focusId);
    return;
  }
  const d = introDoors.find((x) => x.no === roomNo);
  if (!d || d.open || d.opening) return;
  ensureAudio();
  if (roomNo !== assignedRoomNo) {
    sfxRattle();
    sfxBeep(180, 0.06);
    showNote(
      "Не та дверь",
      `Ваш ключ — от комнаты № ${String(assignedRoomNo).padStart(2, "0")}.`
    );
    return;
  }
  d.opening = true;
  d.openT = 0;
  introDoorUnlocking = d;
  sfxUnlock();
  setTimeout(() => sfxDoor(), 220);
}

const lobbyWallMat = new THREE.MeshStandardMaterial({
  map: lobbyWallTex,
  color: 0xe8dcc8,
  roughness: 0.88,
});
const woodMat = new THREE.MeshStandardMaterial({
  map: woodTex,
  color: 0xe8d4b8,
  roughness: 0.48,
  metalness: 0.08,
});
const woodDarkMat = new THREE.MeshStandardMaterial({
  map: woodDarkTex,
  color: 0xd4c0a0,
  roughness: 0.52,
  metalness: 0.06,
});
const lobbyFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 14),
  new THREE.MeshStandardMaterial({
    map: lobbyFloorTex,
    color: 0xc4a882,
    roughness: 0.62,
    metalness: 0.05,
  })
);
lobbyFloor.rotation.x = -Math.PI / 2;
lobbyFloor.position.set(0, 0, 20);
lobbyFloor.receiveShadow = true;
lobbyRoot.add(lobbyFloor);

[-1, 1].forEach((side) => {
  const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.2, 12), lobbyWallMat);
  w.position.set(side * 3.6, 2.1, 20);
  w.receiveShadow = true;
  w.castShadow = true;
  lobbyRoot.add(w);

  // деревянные панели (вагонка) до пояса
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 1.15, 11.6),
    woodDarkMat
  );
  panel.position.set(side * 3.42, 0.62, 20);
  panel.castShadow = true;
  panel.receiveShadow = true;
  lobbyRoot.add(panel);
  // вертикальные рейки панелей
  for (let i = 0; i < 9; i++) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 1.05, 0.04),
      woodMat
    );
    rail.position.set(side * 3.385, 0.62, 15.2 + i * 1.2);
    lobbyRoot.add(rail);
  }
  // поручень / chair rail
  const chairRail = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.06, 11.7),
    woodMat
  );
  chairRail.position.set(side * 3.4, 1.22, 20);
  chairRail.castShadow = true;
  lobbyRoot.add(chairRail);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.16, 12),
    woodMat
  );
  base.position.set(side * 3.44, 0.08, 20);
  base.castShadow = true;
  lobbyRoot.add(base);
  // молдинг под потолком
  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.12, 12),
    new THREE.MeshStandardMaterial({ color: 0xd8cbb8, roughness: 0.65, map: woodTex })
  );
  crown.position.set(side * 3.44, 3.96, 20);
  lobbyRoot.add(crown);
});

const lobbyCeil = new THREE.Mesh(
  new THREE.BoxGeometry(7.5, 0.2, 12),
  new THREE.MeshStandardMaterial({
    color: 0xd6c9b4,
    roughness: 0.92,
    // чуть тёплого self-light, чтобы на мобилках ACES не уводил потолок в оливковый
    emissive: 0x2a2418,
    emissiveIntensity: 0.08,
  })
);
lobbyCeil.position.set(0, 4.15, 20);
lobbyCeil.receiveShadow = true;
lobbyRoot.add(lobbyCeil);

// потолочный карниз по периметру
[-1, 1].forEach((side) => {
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.08, 0.14),
    woodDarkMat
  );
  beam.position.set(0, 4.02, 20 + side * 5.7);
  lobbyRoot.add(beam);
});

// потолочные светильники — главный тёплый свет холла
[-2.2, 0, 2.2].forEach((zOff, i) => {
  const fixture = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.07, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x6a5a48, metalness: 0.55, roughness: 0.35, map: woodDarkTex })
  );
  fixture.position.set(0, 4.05, 20 + zOff);
  fixture.castShadow = true;
  lobbyRoot.add(fixture);
  // декоративная рамка светильника
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(1.62, 0.03, 0.48),
    brass
  );
  trim.position.set(0, 4.08, 20 + zOff);
  lobbyRoot.add(trim);
  const lampMat = new THREE.MeshStandardMaterial({
    // тёплый тауп без оливкового (на телефоне 0x6a6050 читался как зелёный потолок)
    color: 0x5a5348,
    emissive: 0x1c1812,
    emissiveIntensity: 0.04,
  });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.04, 0.28), lampMat);
  lamp.position.set(0, 3.98, 20 + zOff);
  lobbyRoot.add(lamp);
  const pl = new THREE.PointLight(0xffb060, 0, 12, 1.65);
  pl.position.set(0, 3.72, 20 + zOff);
  lobbyRoot.add(pl);
  lobbyLamps.push({
    mat: lampMat,
    light: pl,
    base: 7.2,
    baseEmissive: 1.85,
    phase: i * 2.1,
  });
});

// щелчковый рокер-выключатель на левой стене
let lightSwitchTargets = [];
let lightSwitchAnimT = -1;
let lightSwitchFromX = -0.32;
let lightSwitchToX = -0.32;
{
  const root = new THREE.Group();
  root.position.set(-3.36, 1.4, 17.55);
  root.rotation.y = Math.PI / 2;
  lobbyRoot.add(root);

  // рамка
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.2, 0.022),
    new THREE.MeshStandardMaterial({ color: 0xd8d0c4, roughness: 0.5, metalness: 0.15 })
  );
  frame.position.z = 0.01;
  frame.userData.kind = "lightSwitch";
  root.add(frame);

  // углубление
  const recess = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.14, 0.016),
    new THREE.MeshStandardMaterial({ color: 0xb8b0a4, roughness: 0.65 })
  );
  recess.position.z = 0.02;
  recess.userData.kind = "lightSwitch";
  root.add(recess);

  // рокер: качается вокруг X (верх/низ), как настоящий щелчковый
  lightSwitchRocker = new THREE.Group();
  lightSwitchRocker.position.z = 0.028;
  root.add(lightSwitchRocker);
  const paddle = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.118, 0.028),
    new THREE.MeshStandardMaterial({ color: 0xf7f4ef, roughness: 0.4, metalness: 0.05 })
  );
  paddle.userData.kind = "lightSwitch";
  lightSwitchRocker.add(paddle);
  // линия посередине рокера
  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.004, 0.029),
    new THREE.MeshStandardMaterial({ color: 0xc8c0b4, roughness: 0.5 })
  );
  seam.userData.kind = "lightSwitch";
  lightSwitchRocker.add(seam);
  lightSwitchRocker.rotation.x = -0.32; // OFF: низ утоплен

  lightSwitchGlow = new THREE.PointLight(0x334466, 0.02, 1.1, 2);
  lightSwitchGlow.position.set(0, 0, 0.12);
  root.add(lightSwitchGlow);

  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.32, 0.18),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hit.position.z = 0.06;
  hit.userData.kind = "lightSwitch";
  root.add(hit);
  lightSwitchTargets.push(frame, recess, paddle, seam, hit);
}

function applyLobbyCeilingLights(on, animate = false) {
  const next = !!on;
  if (animate && lightSwitchRocker) {
    lightSwitchFromX = lightSwitchRocker.rotation.x;
    lightSwitchToX = next ? 0.32 : -0.32;
    lightSwitchAnimT = 0;
  } else if (lightSwitchRocker) {
    lightSwitchRocker.rotation.x = next ? 0.32 : -0.32;
  }
  lobbyLightsOn = next;
  if (lightSwitchGlow) {
    lightSwitchGlow.intensity = lobbyLightsOn ? 0.3 : 0.02;
    lightSwitchGlow.color.setHex(lobbyLightsOn ? 0xffc878 : 0x334466);
  }
  for (const L of lobbyLamps) {
    if (lobbyLightsOn) {
      L.light.intensity = L.base;
      L.mat.emissiveIntensity = L.baseEmissive;
      L.mat.emissive.setHex(0xffb040);
      L.mat.color.setHex(0xffe8c0);
    } else {
      L.light.intensity = 0;
      L.mat.emissiveIntensity = 0.04;
      L.mat.emissive.setHex(0x1c1812);
      L.mat.color.setHex(0x5a5348);
    }
  }
  if (phase === "lobby") {
    if (lobbyLightsOn) {
      applyRoomMood("lobby");
    } else {
      scene.background = new THREE.Color(0x0a0908);
      scene.fog = new THREE.FogExp2(0x080706, 0.035);
      if (ambientLight) ambientLight.intensity = 0.035;
      if (hemi) hemi.intensity = 0.04;
      if (keyLight) keyLight.intensity = 0.04;
      if (spot) spot.intensity = 0.8;
      if (fillWarm) fillWarm.intensity = 0.25;
      if (fillCool) fillCool.intensity = 0.05;
    }
  }
}

function toggleLobbyLights() {
  ensureAudio();
  startMusic();
  const next = !lobbyLightsOn;
  sfxSwitch(next);
  applyLobbyCeilingLights(next, true);
}

function onLightSwitchTap() {
  if (phase !== "lobby") return;
  if (focus !== "lightSwitch") {
    approachFocus("lightSwitch");
    return;
  }
  toggleLobbyLights();
}

// холл стартует в темноте — выключатель OFF
applyLobbyCeilingLights(false);

// крючки + пропуск (изначально висит на среднем)
let passWorldRoot = null;
let passHookTargets = [];
let passLanyard = null;
const PASS_HOOK_ORIGIN = new THREE.Vector3(3.28, 1.48, 17.77);
{
  const hookZs = [17.55, 17.77, 17.99];
  hookZs.forEach((z, i) => {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.04), brass);
    plate.position.set(3.38, 1.85, z);
    plate.rotation.y = -Math.PI / 2;
    plate.userData.kind = "passHook";
    lobbyRoot.add(plate);
    passHookTargets.push(plate);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 12, Math.PI), brass);
    hook.position.set(3.34, 1.78, z);
    hook.rotation.y = -Math.PI / 2;
    hook.rotation.z = Math.PI / 2;
    hook.userData.kind = "passHook";
    lobbyRoot.add(hook);
    passHookTargets.push(hook);
    // пустые крючки — лёгкий намёк (кольцо)
    if (i !== 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.03, 0.006, 6, 14),
        new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.7, roughness: 0.35 })
      );
      ring.position.set(3.3, 1.68, z);
      ring.rotation.y = -Math.PI / 2;
      lobbyRoot.add(ring);
    }
  });

  // пропуск на среднем крючке
  passWorldRoot = new THREE.Group();
  passWorldRoot.position.copy(PASS_HOOK_ORIGIN);
  passWorldRoot.rotation.y = -Math.PI / 2;
  lobbyRoot.add(passWorldRoot);

  passLanyard = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, 0.22, 6),
    new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.55 })
  );
  passLanyard.position.set(0, 0.2, 0);
  passWorldRoot.add(passLanyard);
  const clip = new THREE.Mesh(
    new THREE.TorusGeometry(0.028, 0.006, 6, 12),
    brass
  );
  clip.position.set(0, 0.32, 0);
  clip.rotation.x = Math.PI / 2;
  passWorldRoot.add(clip);

  const worldPass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.38, 0.24),
    new THREE.MeshBasicMaterial({ map: passTex, side: THREE.DoubleSide })
  );
  worldPass.position.set(0, 0.02, 0.01);
  worldPass.userData.kind = "passHook";
  passWorldRoot.add(worldPass);
  const worldBack = new THREE.Mesh(
    new THREE.PlaneGeometry(0.38, 0.24),
    new THREE.MeshStandardMaterial({ color: 0x1a1e28, roughness: 0.55, metalness: 0.2 })
  );
  worldBack.position.set(0, 0.02, -0.01);
  worldBack.rotation.y = Math.PI;
  worldBack.userData.kind = "passHook";
  passWorldRoot.add(worldBack);
  const passHit = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.55, 0.12),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  passHit.position.set(0, 0.1, 0);
  passHit.userData.kind = "passHook";
  passWorldRoot.add(passHit);
  passHookTargets.push(worldPass, worldBack, passHit, clip, passLanyard);
}

function startTakePass() {
  if (passTaken || passTakeT >= 0 || passInspectT >= 0 || passPocketT >= 0) return;
  ensureAudio();
  startMusic();
  passTakeT = 0;
  passInspectT = -1;
  passPocketT = -1;
  if (passCard.visible) passCard.visible = false;
  sfxPassTake();
}

function onPassHookTap() {
  if (phase !== "lobby" || passTaken || passTakeT >= 0) return;
  if (focus !== "passHook") {
    approachFocus("passHook");
    return;
  }
  startTakePass();
}

// мелкий декор холла: вентиляция, табличка
{
  const vent = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.24, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x8a8478, metalness: 0.6, roughness: 0.4 })
  );
  vent.position.set(-3.42, 3.65, 20.35);
  vent.rotation.y = Math.PI / 2;
  lobbyRoot.add(vent);
  for (let i = 0; i < 5; i++) {
    const slat = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.015, 0.01),
      new THREE.MeshStandardMaterial({ color: 0x5a564e, metalness: 0.5, roughness: 0.45 })
    );
    slat.position.set(-3.4, 3.56 + i * 0.04, 20.35);
    slat.rotation.y = Math.PI / 2;
    lobbyRoot.add(slat);
  }
  const numPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.2, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x2a2e32, metalness: 0.4, roughness: 0.4 })
  );
  numPlate.position.set(1.35, 3.55, 16.62);
  lobbyRoot.add(numPlate);
  const nc = document.createElement("canvas");
  nc.width = 128;
  nc.height = 80;
  const ncx = nc.getContext("2d");
  ncx.fillStyle = "#1a1e22";
  ncx.fillRect(0, 0, 128, 80);
  ncx.fillStyle = "#c9a86a";
  ncx.font = "700 36px serif";
  ncx.textAlign = "center";
  ncx.textBaseline = "middle";
  ncx.fillText("01", 64, 42);
  const ntex = new THREE.CanvasTexture(nc);
  ntex.colorSpace = THREE.SRGBColorSpace;
  const numLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.16),
    new THREE.MeshBasicMaterial({ map: ntex })
  );
  numLabel.position.set(1.35, 3.55, 16.65);
  lobbyRoot.add(numLabel);
}

// коврик у двери
{
  const rug = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.025, 1.1),
    new THREE.MeshStandardMaterial({ map: rugTex, color: 0xb8a090, roughness: 0.92 })
  );
  rug.position.set(0, 0.02, 17.9);
  rug.receiveShadow = true;
  rug.castShadow = true;
  lobbyRoot.add(rug);
}

// скамейка
{
  const bench = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.48), woodMat);
  seat.position.y = 0.45;
  seat.castShadow = true;
  seat.receiveShadow = true;
  bench.add(seat);
  const cushion = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.05, 0.4),
    new THREE.MeshStandardMaterial({ map: leatherTex, color: 0x6a7580, roughness: 0.75 })
  );
  cushion.position.set(0, 0.51, 0.02);
  cushion.castShadow = true;
  bench.add(cushion);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 0.06), woodDarkMat);
  back.position.set(0, 0.7, -0.2);
  back.castShadow = true;
  bench.add(back);
  [-0.7, 0.7].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.45, 0.42), woodDarkMat);
    leg.position.set(x, 0.22, 0);
    leg.castShadow = true;
    bench.add(leg);
  });
  bench.position.set(-2.4, 0, 22.0);
  lobbyRoot.add(bench);
}

function addPlant(x, z, scale = 1) {
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * scale, 0.18 * scale, 0.35 * scale, 16),
    new THREE.MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.55, metalness: 0.1, map: woodDarkTex })
  );
  pot.position.set(x, 0.18 * scale, z);
  pot.castShadow = true;
  pot.receiveShadow = true;
  lobbyRoot.add(pot);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.2 * scale, 0.02 * scale, 8, 20),
    new THREE.MeshStandardMaterial({ color: 0xa88868, roughness: 0.5 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.set(x, 0.34 * scale, z);
  lobbyRoot.add(rim);
  const soil = new THREE.Mesh(
    new THREE.CircleGeometry(0.17 * scale, 16),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1 })
  );
  soil.rotation.x = -Math.PI / 2;
  soil.position.set(x, 0.33 * scale, z);
  lobbyRoot.add(soil);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry((0.14 + i * 0.02) * scale, 10, 10),
      new THREE.MeshStandardMaterial({
        color: i % 2 ? 0x3d6b4f : 0x2f5a42,
        roughness: 0.65,
      })
    );
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(
      x + Math.cos(a) * 0.11 * scale,
      (0.48 + i * 0.1) * scale,
      z + Math.sin(a) * 0.11 * scale
    );
    leaf.scale.set(1, 1.4, 0.65);
    leaf.castShadow = true;
    lobbyRoot.add(leaf);
  }
}
// растения — по углам, без пересечений
addPlant(2.95, 22.15, 0.9);
addPlant(-3.05, 22.2, 0.7);

const magazineTargets = [];
const coolerTargets = [];
const phoneTargets = [];
const guestPassTargets = [];
const gateArchiveTargets = [];

// столик у скамейки + журналы (между скамейкой и центром)
{
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.35, 0.05, 20), woodMat);
  table.position.set(-1.55, 0.42, 21.55);
  table.castShadow = true;
  table.receiveShadow = true;
  lobbyRoot.add(table);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.4, 10), brass);
  pole.position.set(-1.55, 0.2, 21.55);
  pole.castShadow = true;
  lobbyRoot.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 16), brass);
  base.position.set(-1.55, 0.02, 21.55);
  lobbyRoot.add(base);
  [[-0.06, 0.02, 0xc45c4a], [0.05, -0.04, 0x4a6a8a], [0, 0.06, 0xd4c4a0]].forEach(([ox, oz, col], i) => {
    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.02, 0.24),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 })
    );
    mag.position.set(-1.55 + ox, 0.46 + i * 0.02, 21.55 + oz);
    mag.rotation.y = (i - 1) * 0.25;
    mag.castShadow = true;
    mag.userData.kind = "magazine";
    lobbyRoot.add(mag);
    magazineTargets.push(mag);
  });
  const magHit = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.2, 0.45),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  magHit.position.set(-1.55, 0.5, 21.55);
  magHit.userData.kind = "magazine";
  lobbyRoot.add(magHit);
  magazineTargets.push(magHit);
}

// кресло — в проходе справа, не у шкафа
{
  const chair = new THREE.Group();
  const leatherMat = new THREE.MeshStandardMaterial({
    map: leatherTex,
    color: 0x8a96a0,
    roughness: 0.68,
    metalness: 0.05,
  });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.5), leatherMat);
  seat.position.y = 0.42;
  seat.castShadow = true;
  chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.07), leatherMat);
  back.position.set(0, 0.72, -0.22);
  back.castShadow = true;
  chair.add(back);
  [-0.28, 0.28].forEach((x) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.42), woodDarkMat);
    arm.position.set(x, 0.58, -0.02);
    arm.castShadow = true;
    chair.add(arm);
  });
  [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), woodDarkMat);
    leg.position.set(x, 0.2, z);
    leg.castShadow = true;
    chair.add(leg);
  });
  chair.position.set(1.85, 0, 20.35);
  chair.rotation.y = -0.85;
  lobbyRoot.add(chair);
}

// шкаф у правой стены
{
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.35, 0.38), woodMat);
  cabinet.position.set(3.1, 0.68, 19.35);
  cabinet.castShadow = true;
  cabinet.receiveShadow = true;
  lobbyRoot.add(cabinet);
  [-0.2, 0.2].forEach((ox) => {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.15, 0.03), woodDarkMat);
    door.position.set(3.1 + ox * 0.02, 0.68, 19.14);
    lobbyRoot.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 10), brass);
    knob.position.set(3.1 + ox * 0.1, 0.68, 19.11);
    lobbyRoot.add(knob);
  });
  // папки и книги — только на крышке шкафа
  [0, 1, 2, 3].forEach((i) => {
    const binder = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.26, 0.2),
      new THREE.MeshStandardMaterial({
        color: [0x8a4a4a, 0x4a6a8a, 0x4a7a5a, 0x8a7a4a][i],
        roughness: 0.65,
      })
    );
    binder.position.set(2.9 + i * 0.11, 1.5, 19.35);
    binder.castShadow = true;
    lobbyRoot.add(binder);
  });
  [0, 1, 2].forEach((i) => {
    const book = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.2 + (i % 2) * 0.04, 0.16),
      new THREE.MeshStandardMaterial({
        color: [0x5a3a2a, 0x2a3a5a, 0x3a5a3a][i],
        roughness: 0.7,
      })
    );
    book.position.set(2.95 + i * 0.09, 1.48, 19.5);
    book.rotation.y = 0.15;
    book.castShadow = true;
    lobbyRoot.add(book);
  });
}

// картины на стенах — с зазором друг от друга и от часов
function addFramedArt(x, y, z, rotY, tex, w = 0.85, h = 0.6) {
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.045),
    brass
  );
  frame.position.set(x, y, z);
  frame.rotation.y = rotY;
  frame.castShadow = true;
  lobbyRoot.add(frame);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const n = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
  art.position.set(x + n.x * 0.028, y, z + n.z * 0.028);
  art.rotation.y = rotY;
  lobbyRoot.add(art);
  const picLight = new THREE.SpotLight(0xffe0b0, 1.4, 3.8, Math.PI / 8, 0.6, 1.6);
  picLight.position.set(x - n.x * 0.3, y + h * 0.45, z - n.z * 0.3);
  picLight.target.position.set(x, y, z);
  lobbyRoot.add(picLight, picLight.target);
}
// левая стена: две картины с зазором ~1.4м
addFramedArt(-3.38, 2.55, 18.55, Math.PI / 2, artTexA, 0.8, 0.58);
addFramedArt(-3.38, 2.55, 21.55, Math.PI / 2, artTexB, 0.7, 0.5);
// правая стена: одна картина (часы отдельно дальше)
addFramedArt(3.38, 2.5, 18.4, -Math.PI / 2, artTexB, 0.72, 0.52);

// вешалка / стойка для зонтов
{
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 0.08, 16),
    steelDark
  );
  stand.position.set(2.75, 0.04, 17.65);
  stand.castShadow = true;
  lobbyRoot.add(stand);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 8), steel);
  rod.position.set(2.75, 0.58, 17.65);
  rod.castShadow = true;
  lobbyRoot.add(rod);
  const umbrella = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.04, 0.85, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a3540, roughness: 0.5 })
  );
  umbrella.position.set(2.68, 0.5, 17.7);
  umbrella.rotation.z = 0.12;
  umbrella.castShadow = true;
  lobbyRoot.add(umbrella);
}

// кулер — левая стена, между радио и консолью
{
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 1.1, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.45, metalness: 0.2 })
  );
  body.position.set(-3.05, 0.55, 18.15);
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.kind = "cooler";
  lobbyRoot.add(body);
  coolerTargets.push(body);
  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.45, 16),
    new THREE.MeshStandardMaterial({
      color: 0xa8d4e8,
      transparent: true,
      opacity: 0.55,
      roughness: 0.2,
      metalness: 0.1,
    })
  );
  bottle.position.set(-3.05, 1.35, 18.15);
  bottle.castShadow = true;
  bottle.userData.kind = "cooler";
  lobbyRoot.add(bottle);
  coolerTargets.push(bottle);
  const coolHit = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 1.5, 0.55),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  coolHit.position.set(-3.05, 0.85, 18.15);
  coolHit.userData.kind = "cooler";
  lobbyRoot.add(coolHit);
  coolerTargets.push(coolHit);
}

// длинный ковёр по центру холла
{
  const runner = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.018, 3.4),
    new THREE.MeshStandardMaterial({ map: carpetTex, color: 0xa8b0a8, roughness: 0.9 })
  );
  runner.position.set(0, 0.012, 20.2);
  runner.receiveShadow = true;
  lobbyRoot.add(runner);
}

// настольная лампа — верёвочный выключатель
let deskLampOn = true;
let deskLampLevel = 1; // 0..1 текущая яркость (анимируется)
let deskLampPending = null; // состояние после дёрганья шнурка
let deskLampLight = null;
let deskLampShadeMat = null;
let deskLampBulbMat = null;
let deskLampCord = null;
let deskLampCordKnob = null;
let deskLampCordPullT = -1;
let deskLampFlickerT = -1;
let deskLampNextFlickerAt = typeof performance !== "undefined" ? performance.now() + 3500 : 3500;
const deskLampTargets = [];
const DESK_LAMP_CORD_Y = 1.05;
const DESK_LAMP_CORD_LEN = 0.28;
const _deskColA = new THREE.Color();
const _deskColB = new THREE.Color();

function paintDeskLamp(level, flicker = 1) {
  const L = Math.max(0, Math.min(1, level)) * flicker;
  if (deskLampLight) deskLampLight.intensity = 1.6 * L;
  if (deskLampShadeMat) {
    deskLampShadeMat.emissiveIntensity = 0.02 + 0.33 * L;
    _deskColA.setHex(0x8a8070);
    _deskColB.setHex(0xf5ecd8);
    deskLampShadeMat.color.copy(_deskColA).lerp(_deskColB, L);
    _deskColA.setHex(0x2a2418);
    _deskColB.setHex(0xffe8c0);
    deskLampShadeMat.emissive.copy(_deskColA).lerp(_deskColB, L);
  }
  if (deskLampBulbMat) {
    deskLampBulbMat.emissiveIntensity = 0.05 + 1.15 * L;
    _deskColA.setHex(0x4a4030);
    _deskColB.setHex(0xfff0d0);
    deskLampBulbMat.color.copy(_deskColA).lerp(_deskColB, L);
    _deskColA.setHex(0x221808);
    _deskColB.setHex(0xffcc66);
    deskLampBulbMat.emissive.copy(_deskColA).lerp(_deskColB, L);
  }
}

function applyDeskLamp(on) {
  deskLampOn = !!on;
  deskLampPending = null;
  deskLampLevel = deskLampOn ? 1 : 0;
  paintDeskLamp(deskLampLevel, 1);
}

function toggleDeskLamp() {
  ensureAudio();
  startMusic();
  const next = !(deskLampPending !== null ? deskLampPending : deskLampOn);
  sfxLamp(next);
  deskLampPending = next;
  deskLampCordPullT = 0; // дёргаем шнурок — свет сменится на пике
  if (next) deskLampNextFlickerAt = performance.now() + 400;
}

function onDeskLampTap() {
  if (phase !== "lobby") return;
  if (focus !== "deskLamp") {
    approachFocus("deskLamp");
    return;
  }
  toggleDeskLamp();
}

// консоль / ресепшен — левая стена, между кулером и скамейкой
{
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.08, 0.42), woodMat);
  desk.position.set(-2.95, 0.95, 19.85);
  desk.castShadow = true;
  desk.receiveShadow = true;
  lobbyRoot.add(desk);
  const deskBody = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.85, 0.38), woodDarkMat);
  deskBody.position.set(-2.95, 0.45, 19.85);
  deskBody.castShadow = true;
  lobbyRoot.add(deskBody);
  [-0.2, 0.15].forEach((oy) => {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), brass);
    handle.position.set(-2.75, 0.55 + oy, 19.64);
    lobbyRoot.add(handle);
  });
  const vase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 0.22, 12),
    new THREE.MeshStandardMaterial({ color: 0xd8c8a8, metalness: 0.3, roughness: 0.4 })
  );
  vase.position.set(-2.55, 1.15, 19.85);
  vase.castShadow = true;
  lobbyRoot.add(vase);
  for (let i = 0; i < 4; i++) {
    const flower = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 8),
      new THREE.MeshStandardMaterial({ color: [0xc45c6a, 0xe8d0a0, 0xc45c6a, 0xe8e8e8][i], roughness: 0.6 })
    );
    flower.position.set(-2.55 + (i - 1.5) * 0.035, 1.3 + (i % 2) * 0.035, 19.85 + (i % 2) * 0.025);
    lobbyRoot.add(flower);
  }
  // настольная лампа + верёвочный выключатель
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.04, 12), brass);
  lampBase.position.set(-3.2, 1.0, 19.85);
  lobbyRoot.add(lampBase);
  const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.35, 8), brass);
  lampPole.position.set(-3.2, 1.18, 19.85);
  lobbyRoot.add(lampPole);
  deskLampShadeMat = new THREE.MeshStandardMaterial({
    color: 0xf5ecd8,
    emissive: 0xffe8c0,
    emissiveIntensity: 0.35,
    side: THREE.DoubleSide,
  });
  const lampShade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.14, 0.14, 16, 1, true),
    deskLampShadeMat
  );
  lampShade.position.set(-3.2, 1.4, 19.85);
  lobbyRoot.add(lampShade);
  deskLampBulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff0d0,
    emissive: 0xffcc66,
    emissiveIntensity: 1.2,
  });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), deskLampBulbMat);
  bulb.position.set(-3.2, 1.38, 19.85);
  lobbyRoot.add(bulb);
  deskLampLight = new THREE.PointLight(0xffe0b0, 1.6, 3.5, 2);
  deskLampLight.position.set(-3.05, 1.35, 20.05);
  lobbyRoot.add(deskLampLight);

  // шнурок свисает из-под абажура в сторону комнаты
  const cordMat = new THREE.MeshStandardMaterial({ color: 0xd8c8a0, roughness: 0.7, metalness: 0.05 });
  deskLampCord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, DESK_LAMP_CORD_LEN, 6),
    cordMat
  );
  deskLampCord.position.set(-3.08, DESK_LAMP_CORD_Y, 19.92);
  deskLampCord.userData.kind = "deskLamp";
  lobbyRoot.add(deskLampCord);
  deskLampCordKnob = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 10, 10),
    brass
  );
  deskLampCordKnob.position.set(-3.08, DESK_LAMP_CORD_Y - DESK_LAMP_CORD_LEN * 0.5 - 0.012, 19.92);
  deskLampCordKnob.userData.kind = "deskLamp";
  lobbyRoot.add(deskLampCordKnob);
  // зона клика по шнурку
  const cordHit = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.4, 0.12),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  cordHit.position.set(-3.08, 1.05, 19.92);
  cordHit.userData.kind = "deskLamp";
  lobbyRoot.add(cordHit);
  deskLampTargets.push(deskLampCord, deskLampCordKnob, cordHit);

  // телефон на ресепшене — автоответчик с фрагментом кода
  const phoneBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.05, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.4, roughness: 0.45 })
  );
  phoneBase.position.set(-2.75, 1.01, 19.7);
  phoneBase.userData.kind = "phone";
  lobbyRoot.add(phoneBase);
  phoneTargets.push(phoneBase);
  const handset = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.04, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.35, roughness: 0.5 })
  );
  handset.position.set(-2.75, 1.06, 19.7);
  handset.userData.kind = "phone";
  lobbyRoot.add(handset);
  phoneTargets.push(handset);
  const phoneHit = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.25, 0.28),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  phoneHit.position.set(-2.75, 1.08, 19.7);
  phoneHit.userData.kind = "phone";
  lobbyRoot.add(phoneHit);
  phoneTargets.push(phoneHit);

  // чужой пропуск на столе (имя с табло / архив)
  const gpCanvas = document.createElement("canvas");
  gpCanvas.width = 256;
  gpCanvas.height = 160;
  const gpCtx = gpCanvas.getContext("2d");
  function paintGuestPassCard(name) {
    gpCtx.fillStyle = "#1a2230";
    gpCtx.fillRect(0, 0, 256, 160);
    gpCtx.strokeStyle = "#c9a86a";
    gpCtx.lineWidth = 6;
    gpCtx.strokeRect(8, 8, 240, 144);
    gpCtx.fillStyle = "#c9a86a";
    gpCtx.font = "700 18px sans-serif";
    gpCtx.textAlign = "center";
    gpCtx.fillText("ПРОПУСК · ГОСТЬ", 128, 48);
    gpCtx.fillStyle = "#e8ecf2";
    gpCtx.font = "700 22px sans-serif";
    gpCtx.fillText(String(name || "АРХИВ").slice(0, 16), 128, 92);
    gpCtx.fillStyle = "#6a7380";
    gpCtx.font = "14px sans-serif";
    gpCtx.fillText("не ваш · оставить на месте", 128, 128);
  }
  paintGuestPassCard("АРХИВ");
  const gpTex = new THREE.CanvasTexture(gpCanvas);
  gpTex.colorSpace = THREE.SRGBColorSpace;
  window.__guestPassPaint = paintGuestPassCard;
  window.__guestPassTex = gpTex;
  const guestPass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.18),
    new THREE.MeshBasicMaterial({ map: gpTex })
  );
  guestPass.position.set(-3.15, 1.005, 19.95);
  guestPass.rotation.x = -Math.PI / 2;
  guestPass.userData.kind = "guestPass";
  lobbyRoot.add(guestPass);
  guestPassTargets.push(guestPass);
  const gpHit = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.08, 0.28),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  gpHit.position.set(-3.15, 1.02, 19.95);
  gpHit.userData.kind = "guestPass";
  lobbyRoot.add(gpHit);
  guestPassTargets.push(gpHit);
}

function refreshGuestPassLabel() {
  const paint = window.__guestPassPaint;
  const tex = window.__guestPassTex;
  if (!paint || !tex) return;
  const others = eventPlayers.filter((p) => String(p.id) !== String(vkUser.id));
  const name = others.length ? others[0].name : "АРХИВ";
  paint(name);
  tex.needsUpdate = true;
}

// настенные часы — правая стена, отдельно от картины
let wallClockHour = null;
let wallClockMinute = null;
let wallClockSecond = null;
{
  const clockRoot = new THREE.Group();
  clockRoot.position.set(3.38, 2.55, 20.65);
  clockRoot.rotation.y = -Math.PI / 2;
  lobbyRoot.add(clockRoot);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 8, 32), brass);
  rim.castShadow = true;
  clockRoot.add(rim);

  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.26, 32),
    new THREE.MeshStandardMaterial({ color: 0xf8f4ec, roughness: 0.6 })
  );
  face.position.z = 0.01;
  clockRoot.add(face);

  // метки часов
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const mark = new THREE.Mesh(
      new THREE.BoxGeometry(i % 3 === 0 ? 0.028 : 0.016, i % 3 === 0 ? 0.05 : 0.032, 0.008),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a })
    );
    mark.position.set(Math.sin(a) * 0.21, Math.cos(a) * 0.21, 0.02);
    mark.rotation.z = -a;
    clockRoot.add(mark);
  }

  const handMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.3, roughness: 0.45 });
  const secMat = new THREE.MeshStandardMaterial({ color: 0xb02020, metalness: 0.2, roughness: 0.5 });

  wallClockHour = new THREE.Group();
  const hourMesh = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.12, 0.01), handMat);
  hourMesh.position.y = 0.055;
  wallClockHour.add(hourMesh);
  wallClockHour.position.z = 0.025;
  clockRoot.add(wallClockHour);

  wallClockMinute = new THREE.Group();
  const minuteMesh = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.18, 0.01), handMat);
  minuteMesh.position.y = 0.085;
  wallClockMinute.add(minuteMesh);
  wallClockMinute.position.z = 0.03;
  clockRoot.add(wallClockMinute);

  wallClockSecond = new THREE.Group();
  const secondMesh = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.2, 0.006), secMat);
  secondMesh.position.y = 0.08;
  wallClockSecond.add(secondMesh);
  wallClockSecond.position.z = 0.035;
  clockRoot.add(wallClockSecond);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.02, 12),
    brass
  );
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.038;
  clockRoot.add(hub);
}

function updateWallClock() {
  if (!wallClockHour) return;
  const now = new Date();
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  const ms = now.getMilliseconds();
  wallClockHour.rotation.z = -((h + m / 60) / 12) * Math.PI * 2;
  wallClockMinute.rotation.z = -((m + s / 60) / 60) * Math.PI * 2;
  wallClockSecond.rotation.z = -((s + ms / 1000) / 60) * Math.PI * 2;
}
updateWallClock();

// огнетушитель — угол у двери справа, отдельно от зонтов
{
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.1, 0.45, 14),
    new THREE.MeshStandardMaterial({ color: 0xc43838, metalness: 0.4, roughness: 0.4 })
  );
  tank.position.set(3.2, 0.35, 16.95);
  tank.castShadow = true;
  lobbyRoot.add(tank);
  const nozzle = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.08, 0.12),
    steelDark
  );
  nozzle.position.set(3.2, 0.6, 16.95);
  lobbyRoot.add(nozzle);
}

// урна — у кулера, с зазором
{
  const bin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.12, 0.4, 14),
    new THREE.MeshStandardMaterial({ color: 0x4a5048, metalness: 0.5, roughness: 0.45 })
  );
  bin.position.set(-2.55, 0.2, 18.35);
  bin.castShadow = true;
  lobbyRoot.add(bin);
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.03, 14),
    steelDark
  );
  lid.position.set(-2.55, 0.42, 18.35);
  lobbyRoot.add(lid);
}

// мягкий пуф — у кресла, не у растения
{
  const ottoman = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.32, 0.36, 20),
    new THREE.MeshStandardMaterial({ color: 0x5a6a62, roughness: 0.85 })
  );
  ottoman.position.set(2.15, 0.18, 21.15);
  ottoman.castShadow = true;
  ottoman.receiveShadow = true;
  lobbyRoot.add(ottoman);
}

// табличка ACCESS / правила у двери
{
  const plaque = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.7, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.4, roughness: 0.4 })
  );
  plaque.position.set(-1.15, 1.55, 16.58);
  plaque.castShadow = true;
  lobbyRoot.add(plaque);
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 320;
  const cx = c.getContext("2d");
  cx.fillStyle = "#1a1a1a";
  cx.fillRect(0, 0, 256, 320);
  cx.fillStyle = "#c9a86a";
  cx.font = "700 22px sans-serif";
  cx.textAlign = "center";
  cx.fillText("ACCESS", 128, 48);
  cx.fillStyle = "#ccc";
  cx.font = "14px sans-serif";
  cx.fillText("1. Возьмите пропуск", 128, 100);
  cx.fillText("2. Дождитесь таймера", 128, 132);
  cx.fillText("3. Приложите карту", 128, 164);
  cx.fillText("4. Откройте дверь", 128, 196);
  cx.fillStyle = "#888";
  cx.font = "12px sans-serif";
  cx.fillText("AUTHORIZED ONLY", 128, 260);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.48, 0.6),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  sign.position.set(-1.15, 1.55, 16.61);
  lobbyRoot.add(sign);
}

// кашпо у двери — справа от коврика, не у радио
addPlant(0.95, 17.35, 0.45);

/* —— радио у правой стены: цельный корпус, кнопки на панели —— */
const radioCanvas = document.createElement("canvas");
radioCanvas.width = 384;
radioCanvas.height = 128;
const radioCtx = radioCanvas.getContext("2d");
const radioTex = new THREE.CanvasTexture(radioCanvas);
radioTex.colorSpace = THREE.SRGBColorSpace;

function updateRadioDisplay() {
  const ctx = radioCtx;
  const w = radioCanvas.width;
  const h = radioCanvas.height;
  const station = currentStation();
  const live = musicOn && (musicStatus === "playing" || musicStatus === "connecting");
  ctx.fillStyle = "#0a0e14";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#c9a86a";
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.fillStyle = "#c9a86a";
  ctx.font = "700 15px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("FUTURUM RADIO", 16, 28);
  ctx.fillStyle =
    musicStatus === "error" ? "#ff8899" : live ? "#88ffaa" : "#8a93a0";
  ctx.font = "700 18px sans-serif";
  const mark = musicStatus === "error" ? "✕  " : live ? "▶  " : "■  ";
  ctx.fillText(mark + station.name, 16, 56);
  ctx.fillStyle = "#6a7380";
  ctx.font = "12px sans-serif";
  ctx.fillText(station.tag, 16, 78);
  let statusLine = "on air · 2% default";
  if (musicStatus === "connecting") statusLine = "connecting…";
  else if (musicStatus === "playing") statusLine = "on air";
  else if (musicStatus === "error") statusLine = "stream error · NEXT";
  else if (!musicOn) statusLine = "press PLAY";
  ctx.fillText(statusLine, 16, 104);
  const volPct = Math.round(musicVolume * 100);
  ctx.fillStyle = "#c9a86a";
  ctx.font = "700 13px monospace";
  ctx.fillText("VOL " + String(volPct).padStart(2, "0") + "%", 210, 78);
  ctx.fillStyle = "#1a222c";
  ctx.fillRect(210, 88, 150, 14);
  ctx.fillStyle = "#c9a86a";
  ctx.fillRect(210, 88, 150 * musicVolume, 14);
  if (musicStatus === "playing") {
    for (let i = 0; i < 6; i++) {
      const bh = 8 + Math.sin(performance.now() * 0.01 + i) * 10 + 8;
      ctx.fillStyle = "#c9a86a";
      ctx.fillRect(300 + i * 10, 70 - bh, 6, bh);
    }
  }
  radioTex.needsUpdate = true;
}

const radioRoot = new THREE.Group();
// правая стена, лицом в комнату (−X)
radioRoot.position.set(3.12, 0, 20.9);
radioRoot.rotation.y = -Math.PI / 2;
lobbyRoot.add(radioRoot);
const radioTargets = [];
{
  const wood = woodMat;
  const casing = new THREE.MeshStandardMaterial({
    color: 0x1c2028,
    metalness: 0.55,
    roughness: 0.38,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: 0x2a3038,
    metalness: 0.45,
    roughness: 0.4,
  });

  // тумба
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.7, 0.4), wood);
  stand.position.set(0, 0.35, 0);
  stand.castShadow = true;
  stand.receiveShadow = true;
  radioRoot.add(stand);
  const standTop = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.04, 0.44), woodDarkMat);
  standTop.position.set(0, 0.72, 0);
  standTop.castShadow = true;
  radioRoot.add(standTop);

  // цельный корпус радио
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.32), casing);
  body.position.set(0, 1.0, 0);
  body.castShadow = true;
  body.userData.kind = "radio";
  radioRoot.add(body);

  // передняя панель (безель)
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.46, 0.03), accent);
  face.position.set(0, 1.0, 0.16);
  face.userData.kind = "radio";
  radioRoot.add(face);

  // экран в углублении
  const screenBezel = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.22, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x0a0c10, metalness: 0.3, roughness: 0.5 })
  );
  screenBezel.position.set(0, 1.1, 0.175);
  radioRoot.add(screenBezel);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.56, 0.18),
    new THREE.MeshBasicMaterial({ map: radioTex })
  );
  screen.position.set(0, 1.1, 0.188);
  screen.userData.kind = "radio";
  radioRoot.add(screen);

  // панель кнопок — часть корпуса под экраном
  const btnDeck = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.06), casing);
  btnDeck.position.set(0, 0.88, 0.175);
  btnDeck.userData.kind = "radio";
  radioRoot.add(btnDeck);
  const btnDeckLip = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.015, 0.07), accent);
  btnDeckLip.position.set(0, 0.825, 0.18);
  radioRoot.add(btnDeckLip);

  // динамики по бокам
  [-0.28, 0.28].forEach((sx) => {
    const grill = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.02, 20),
      new THREE.MeshStandardMaterial({ color: 0x12151a, metalness: 0.6, roughness: 0.35 })
    );
    grill.rotation.x = Math.PI / 2;
    grill.position.set(sx, 1.1, 0.178);
    radioRoot.add(grill);
    for (let r = 0; r < 3; r++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.02 + r * 0.018, 0.004, 6, 16),
        steelDark
      );
      ring.position.set(sx, 1.1, 0.19);
      radioRoot.add(ring);
    }
  });

  // индикатор питания
  const powerLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0x44ff66,
      emissive: 0x22ff44,
      emissiveIntensity: 1.8,
    })
  );
  powerLed.position.set(0.34, 1.2, 0.19);
  radioRoot.add(powerLed);

  const btnDefs = [
    { label: "▶", kind: "radioPlay", x: -0.26, color: 0x2f6b45 },
    { label: "■", kind: "radioStop", x: -0.13, color: 0x7a3535 },
    { label: "≫", kind: "radioNext", x: 0.0, color: 0x35507a },
    { label: "VOL−", kind: "radioVolDown", x: 0.15, color: 0x3a3a42, w: 0.14 },
    { label: "VOL+", kind: "radioVolUp", x: 0.3, color: 0x3a3a42, w: 0.14 },
  ];
  const btnY = 0.88;
  const btnZ = 0.21; // на поверхности панельки
  btnDefs.forEach((b) => {
    const w = b.w ?? 0.11;
    const btn = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.055, 0.035),
      new THREE.MeshStandardMaterial({ color: b.color, metalness: 0.4, roughness: 0.35 })
    );
    btn.position.set(b.x, btnY, btnZ);
    btn.userData.kind = b.kind;
    btn.castShadow = true;
    radioRoot.add(btn);
    radioTargets.push(btn);
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 48;
    const cx = c.getContext("2d");
    cx.fillStyle = "#0a0a0a";
    cx.fillRect(0, 0, 128, 48);
    cx.fillStyle = "#eee";
    cx.font = "700 22px sans-serif";
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText(b.label, 64, 26);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const lab = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.85, 0.04),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    lab.position.set(b.x, btnY, btnZ + 0.02);
    lab.userData.kind = b.kind;
    radioRoot.add(lab);
    radioTargets.push(lab);
  });

  radioTargets.push(body, face, screen, btnDeck);
}
updateRadioDisplay();
setMusicVolume(0.02);
// сразу пробуем эфир на 2%; если автоплей запрещён — старт по первому клику
queueMicrotask(() => tryAutoStartRadio());
canvas.addEventListener(
  "pointerdown",
  () => {
    if (!musicOn && musicStatus !== "connecting") tryAutoStartRadio();
  },
  { once: true }
);

// бра у двери — тёплые пятна на стене
[-1.15, 1.15].forEach((x) => {
  const sconce = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.22, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xa88858, metalness: 0.7, roughness: 0.35 })
  );
  sconce.position.set(x, 2.35, 16.58);
  sconce.castShadow = true;
  lobbyRoot.add(sconce);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xffe0a8, emissive: 0xffa040, emissiveIntensity: 1.8 })
  );
  glow.position.set(x, 2.35, 16.64);
  lobbyRoot.add(glow);
  const sl = new THREE.PointLight(0xffa858, 2.4, 4.2, 1.8);
  sl.position.set(x, 2.35, 16.9);
  lobbyRoot.add(sl);
});

// камера наблюдения — лёгкий поворот + красный индикатор
let secCamYawPivot = null;
let secCamLedMat = null;
let secCamLedLight = null;
{
  const mount = new THREE.Group();
  mount.position.set(2.55, 3.92, 17.55);
  lobbyRoot.add(mount);

  const bracket = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.12, 0.08),
    steelDark
  );
  bracket.position.y = -0.02;
  mount.add(bracket);

  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.28, 8), steel);
  arm.position.y = -0.2;
  mount.add(arm);

  secCamYawPivot = new THREE.Group();
  secCamYawPivot.position.y = -0.34;
  mount.add(secCamYawPivot);

  const head = new THREE.Group();
  head.rotation.x = 0.35; // чуть вниз
  secCamYawPivot.add(head);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.15, 0.32), steelDark);
  body.castShadow = true;
  head.add(body);

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.09, 12), steel);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.185;
  head.add(lens);

  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(0.045, 16),
    new THREE.MeshStandardMaterial({
      color: 0x1a2230,
      metalness: 0.9,
      roughness: 0.15,
      emissive: 0x0a1520,
      emissiveIntensity: 0.4,
    })
  );
  glass.position.z = 0.232;
  head.add(glass);

  secCamLedMat = new THREE.MeshStandardMaterial({
    color: 0xff2020,
    emissive: 0xff0000,
    emissiveIntensity: 2.2,
    roughness: 0.35,
  });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 10), secCamLedMat);
  led.position.set(0.08, 0.06, 0.12);
  head.add(led);

  secCamLedLight = new THREE.PointLight(0xff2200, 0.35, 1.2, 2);
  secCamLedLight.position.copy(led.position);
  head.add(secCamLedLight);

  // стартовый ракурс — в сторону двери/зала
  secCamYawPivot.rotation.y = -0.55;
}

function updateSecCamera(t) {
  if (!secCamYawPivot) return;
  // медленный маятник ~±35°
  secCamYawPivot.rotation.y = -0.55 + Math.sin(t * 0.28) * 0.55;
  if (secCamLedMat) {
    // мигание раз в ~1.4 с
    const blink = (Math.sin(t * 4.5) > 0.55) || (Math.sin(t * 0.9) > 0.2);
    const on = blink ? 1 : 0.08;
    secCamLedMat.emissiveIntensity = 0.35 + on * 2.4;
    if (secCamLedLight) secCamLedLight.intensity = 0.05 + on * 0.45;
  }
}

// стена холла — проём ровно под коробку, без щелей «как окно»
[
  [-2.75, 2.1, 3.4, 4.3], // лево
  [2.75, 2.1, 3.4, 4.3], // право
  [0, 3.58, 2.2, 1.35], // над дверью
].forEach(([x, y, w, h]) => {
  const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.36), lobbyWallMat);
  part.position.set(x, y, 16.4);
  part.receiveShadow = true;
  lobbyRoot.add(part);
});
// лёгкая «штора» только пока дверь закрыта — тёмный коридор, не белый экран
const lobbyPeekBlock = new THREE.Mesh(
  new THREE.BoxGeometry(2.05, 2.9, 0.06),
  new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.95 })
);
lobbyPeekBlock.position.set(0, 1.4, 16.22);
lobbyRoot.add(lobbyPeekBlock);

// табличка FUTURUM с мерцающей подсветкой
let futurumSignMat = null;
let futurumSignLight = null;
{
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.98, 0.32, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x1a1c1e, metalness: 0.55, roughness: 0.35 })
  );
  plate.position.set(0, 3.55, 16.62);
  lobbyRoot.add(plate);

  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const cx = c.getContext("2d");
  cx.fillStyle = "#0a0c10";
  cx.fillRect(0, 0, 512, 128);
  // мягкое свечение букв
  cx.shadowColor = "#ffc878";
  cx.shadowBlur = 22;
  cx.fillStyle = "#ffe2a8";
  cx.font = "700 58px sans-serif";
  cx.textAlign = "center";
  cx.textBaseline = "middle";
  cx.fillText("FUTURUM", 256, 68);
  cx.shadowBlur = 0;
  cx.strokeStyle = "rgba(201,168,106,0.55)";
  cx.lineWidth = 3;
  cx.strokeRect(18, 14, 476, 100);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  futurumSignMat = new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: new THREE.Color(0xffc878),
    emissiveIntensity: 1.35,
    roughness: 0.4,
    metalness: 0.15,
  });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.26), futurumSignMat);
  label.position.set(0, 3.55, 16.66);
  lobbyRoot.add(label);

  futurumSignLight = new THREE.PointLight(0xffc070, 1.1, 3.2, 1.8);
  futurumSignLight.position.set(0, 3.55, 16.95);
  lobbyRoot.add(futurumSignLight);
}

function updateFuturumSign(t) {
  if (!futurumSignMat) return;
  // тёплое мерцание подсветки
  const flicker =
    1 +
    Math.sin(t * 3.1) * 0.12 +
    Math.sin(t * 7.7) * 0.07 +
    Math.sin(t * 19.3) * 0.04 +
    (Math.random() - 0.5) * 0.06;
  const f = Math.max(0.55, Math.min(1.55, flicker));
  futurumSignMat.emissiveIntensity = 0.85 + f * 0.95;
  if (futurumSignLight) futurumSignLight.intensity = 0.55 + f * 0.85;
}

/* —— табло игроков (слева) + таймер эвента (справа) —— */
const playersCanvas = document.createElement("canvas");
playersCanvas.width = 512;
playersCanvas.height = 640;
const playersCtx = playersCanvas.getContext("2d");
const playersTex = new THREE.CanvasTexture(playersCanvas);
playersTex.colorSpace = THREE.SRGBColorSpace;

const timerCanvas = document.createElement("canvas");
timerCanvas.width = 512;
timerCanvas.height = 448;
const timerCtx = timerCanvas.getContext("2d");
const timerTex = new THREE.CanvasTexture(timerCanvas);
timerTex.colorSpace = THREE.SRGBColorSpace;

function formatEventCountdown(secLeft) {
  const s = Math.ceil(Math.max(0, secLeft));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  if (days > 0) return `${days}д ${hh}:${mm}:${ss}`;
  if (hours > 0) return `${hh}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

const playerPhotoCache = new Map();
let playersScroll = 0; // смещение списка (px в canvas)
const PLAYERS_ROW_H = 82;
const PLAYERS_VIEW_TOP = 96;
const PLAYERS_VIEW_BOTTOM = 580;
const PLAYERS_VISIBLE_H = PLAYERS_VIEW_BOTTOM - PLAYERS_VIEW_TOP;

function playersMaxScroll() {
  loadEventPlayers();
  const content = Math.max(0, eventPlayers.length * PLAYERS_ROW_H - PLAYERS_VISIBLE_H);
  return content;
}

function clampPlayersScroll() {
  playersScroll = Math.max(0, Math.min(playersMaxScroll(), playersScroll));
}

function drawPlayersBoard() {
  const ctx = playersCtx;
  const w = playersCanvas.width;
  const h = playersCanvas.height;
  clampPlayersScroll();
  ctx.fillStyle = "#0c0e12";
  ctx.fillRect(0, 0, w, h);
  // рамка монитора
  ctx.strokeStyle = "#c9a86a";
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  // шапка
  ctx.fillStyle = "#161a22";
  ctx.fillRect(12, 12, w - 24, 78);
  ctx.fillStyle = "#c9a86a";
  ctx.font = "700 26px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("В ИГРЕ СЕЙЧАС", 28, 44);
  ctx.fillStyle = "#6a7380";
  ctx.font = "15px sans-serif";
  loadEventPlayers();
  const total = eventPlayers.length;
  const hostTag = safeHostUrl
    ? safeHostOnline
      ? "HOST ON"
      : "HOST …"
    : "LOCAL";
  ctx.fillText(`FUTURUM EVENT  ·  ${total}  ·  ${hostTag}`, 28, 72);

  // область списка
  ctx.save();
  ctx.beginPath();
  ctx.rect(16, PLAYERS_VIEW_TOP, w - 32, PLAYERS_VISIBLE_H);
  ctx.clip();

  if (!total) {
    ctx.fillStyle = "#8a93a0";
    ctx.font = "20px sans-serif";
    ctx.fillText("Ожидание игроков…", 36, PLAYERS_VIEW_TOP + 50);
  }

  eventPlayers.forEach((p, i) => {
    const y = PLAYERS_VIEW_TOP + i * PLAYERS_ROW_H - playersScroll;
    if (y + PLAYERS_ROW_H < PLAYERS_VIEW_TOP || y > PLAYERS_VIEW_BOTTOM) return;
    const me = String(p.id) === String(vkUser.id);
    ctx.fillStyle = me ? "#1a2a22" : i % 2 === 0 ? "#14181f" : "#181c24";
    ctx.fillRect(24, y + 4, w - 70, PLAYERS_ROW_H - 10);
    if (me) {
      ctx.strokeStyle = "#44aa66";
      ctx.lineWidth = 2;
      ctx.strokeRect(24, y + 4, w - 70, PLAYERS_ROW_H - 10);
    }
    const img = playerPhotoCache.get(String(p.id));
    const cy = y + PLAYERS_ROW_H / 2;
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(68, cy, 26, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, 42, cy - 26, 52, 52);
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.arc(68, cy, 26, 0, Math.PI * 2);
      ctx.clip();
      drawAgentAvatar(ctx, 42, cy - 26, 52, p.name || "?");
      ctx.restore();
      if (p.photo && !playerPhotoCache.has("load:" + p.id)) {
        playerPhotoCache.set("load:" + p.id, true);
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => {
          playerPhotoCache.set(String(p.id), im);
          drawPlayersBoard();
        };
        im.onerror = () => {};
        im.src = p.photo;
      }
    }
    ctx.fillStyle = "#e8ecf2";
    ctx.font = "700 22px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText((p.name || "Игрок").slice(0, 20), 110, cy - 4);
    ctx.fillStyle = me ? "#66dd88" : "#8a93a0";
    ctx.font = "14px sans-serif";
    const sub = p.last ? String(p.last).slice(0, 28) : me ? "это вы" : `#${i + 1}  онлайн`;
    ctx.fillText(sub, 110, cy + 18);
  });
  ctx.restore();

  // скроллбар
  const maxS = playersMaxScroll();
  if (maxS > 0) {
    const trackH = PLAYERS_VISIBLE_H - 8;
    const thumbH = Math.max(36, trackH * (PLAYERS_VISIBLE_H / (PLAYERS_VISIBLE_H + maxS)));
    const thumbY = PLAYERS_VIEW_TOP + 4 + (trackH - thumbH) * (playersScroll / maxS);
    ctx.fillStyle = "#2a3038";
    ctx.fillRect(w - 28, PLAYERS_VIEW_TOP + 4, 8, trackH);
    ctx.fillStyle = "#c9a86a";
    ctx.fillRect(w - 28, thumbY, 8, thumbH);
  }

  // лента последних событий хоста
  if (safeHostEvents.length) {
    const ev = safeHostEvents[0];
    ctx.fillStyle = "#12161c";
    ctx.fillRect(16, h - 88, w - 32, 28);
    ctx.fillStyle = "#c9a86a";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "left";
    const line = `${ev.name || "Игрок"}: ${ev.label || ev.type || ""}`.slice(0, 42);
    ctx.fillText(line, 28, h - 68);
  }

  // подвал
  ctx.fillStyle = "#161a22";
  ctx.fillRect(12, h - 48, w - 24, 36);
  ctx.fillStyle = "#8a93a0";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  let foot = "монитор эвента";
  if (safeHostUrl && safeHostOnline) foot = "общий хост · синхрон";
  else if (safeHostUrl && !safeHostOnline) foot = "хост недоступен — проверь туннель и host.json";
  else foot = maxS > 0 ? "листайте вниз · колёсико / свайп" : "хост не настроен (host.json пуст)";
  ctx.fillText(foot, w / 2, h - 24);

  playersTex.needsUpdate = true;
}

function drawTimerBoard() {
  const ctx = timerCtx;
  const w = timerCanvas.width;
  const h = timerCanvas.height;
  const left = eventSecondsLeft();
  const ready = left <= 0;
  const isOpen = !!(lobbyDoorOpen || lobbyOpening);
  const total = Math.max(1, EVENT_UNLOCK_SEC);
  ctx.fillStyle = "#0e1116";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = isOpen ? "#44ff66" : ready ? "#c9a86a" : "#8a7060";
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = isOpen ? "#44ff66" : "#c9a86a";
  ctx.font = "700 28px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(isOpen ? "ДВЕРЬ ОТКРЫТА" : "ДВЕРЬ ЗАКРЫТА", w / 2, 52);
  ctx.fillStyle = "#6a7380";
  ctx.font = "16px sans-serif";
  let hint = "ожидание таймера";
  if (isOpen) hint = "проход открыт";
  else if (passUnlocked) hint = "потяните ручку";
  else if (!passTaken) hint = "возьмите пропуск";
  else if (ready) hint = "приложите карту";
  else hint = "пропуск у вас · ждите";
  ctx.fillText(hint, w / 2, 84);

  const clock = ready || isOpen ? "00:00" : formatEventCountdown(left);
  const longClock = clock.length >= 10;
  ctx.fillStyle = isOpen ? "#88ffaa" : ready ? "#e8d4a8" : "#e8ecf2";
  ctx.font = longClock ? "700 48px monospace" : "700 64px monospace";
  ctx.fillText(clock, w / 2, 175);

  // кольцо прогресса
  const cx = w / 2;
  const cy = 310;
  const r = 58;
  ctx.strokeStyle = "#2a3038";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  const prog = isOpen || ready ? 1 : 1 - left / total;
  ctx.strokeStyle = isOpen ? "#44ff66" : "#c9a86a";
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#5a6570";
  ctx.font = "13px sans-serif";
  ctx.fillText(`до открытия · ${EVENT_UNLOCK_DAYS} дн.`, w / 2, h - 48);
  if (isEventAdmin()) {
    ctx.fillStyle = "#c9a86a";
    ctx.font = "700 14px sans-serif";
    ctx.fillText("админ · тап = сброс таймера", w / 2, h - 22);
  }

  timerTex.needsUpdate = true;
}

// монитор игроков — клик = подойти, скролл списка
const playersBoardFrame = new THREE.Mesh(
  new THREE.BoxGeometry(1.15, 1.45, 0.1),
  new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.55, roughness: 0.35 })
);
playersBoardFrame.position.set(-1.85, 1.95, 16.58);
playersBoardFrame.castShadow = true;
playersBoardFrame.userData.kind = "playersBoard";
lobbyRoot.add(playersBoardFrame);
const playersBoardScreen = new THREE.Mesh(
  new THREE.PlaneGeometry(1.05, 1.32),
  new THREE.MeshBasicMaterial({ map: playersTex })
);
playersBoardScreen.position.set(-1.85, 1.95, 16.64);
playersBoardScreen.userData.kind = "playersBoard";
lobbyRoot.add(playersBoardScreen);
const playersBoardHit = new THREE.Mesh(
  new THREE.BoxGeometry(1.3, 1.6, 0.4),
  new THREE.MeshBasicMaterial({ visible: false })
);
playersBoardHit.position.set(-1.85, 1.95, 16.7);
playersBoardHit.userData.kind = "playersBoard";
lobbyRoot.add(playersBoardHit);
const playersBoardTargets = [playersBoardFrame, playersBoardScreen, playersBoardHit];

// лёгкий блик «монитора»
{
  const bevel = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.5, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.3 })
  );
  bevel.position.set(-1.85, 1.95, 16.55);
  lobbyRoot.add(bevel);
}

// таймер — клик = подойти (крупнее: формат «12д 00:00:00»)
const timerBoardFrame = new THREE.Mesh(
  new THREE.BoxGeometry(1.35, 1.2, 0.1),
  new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.55, roughness: 0.35 })
);
timerBoardFrame.position.set(2.15, 2.05, 16.58);
timerBoardFrame.castShadow = true;
timerBoardFrame.userData.kind = "timerBoard";
lobbyRoot.add(timerBoardFrame);
const timerBoardScreen = new THREE.Mesh(
  new THREE.PlaneGeometry(1.22, 1.05),
  new THREE.MeshBasicMaterial({ map: timerTex })
);
timerBoardScreen.position.set(2.15, 2.05, 16.64);
timerBoardScreen.userData.kind = "timerBoard";
lobbyRoot.add(timerBoardScreen);
const timerBoardHit = new THREE.Mesh(
  new THREE.BoxGeometry(1.5, 1.35, 0.4),
  new THREE.MeshBasicMaterial({ visible: false })
);
timerBoardHit.position.set(2.15, 2.05, 16.7);
timerBoardHit.userData.kind = "timerBoard";
lobbyRoot.add(timerBoardHit);
const timerBoardTargets = [timerBoardFrame, timerBoardScreen, timerBoardHit];

loadEventPlayers();
drawPlayersBoard();
drawTimerBoard();

// кардридер у двери — сначала карта, потом ручка
const readerRoot = new THREE.Group();
const READER_POS = new THREE.Vector3(1.42, 1.38, 16.62);
readerRoot.position.copy(READER_POS);
lobbyRoot.add(readerRoot);
const readerBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.22, 0.34, 0.1),
  new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.55, roughness: 0.35 })
);
readerBody.userData.kind = "reader";
readerRoot.add(readerBody);
const readerPadMat = new THREE.MeshStandardMaterial({
  color: 0x333333,
  metalness: 0.3,
  roughness: 0.5,
  emissive: 0x000000,
  emissiveIntensity: 0,
});
const readerPad = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.02), readerPadMat);
readerPad.position.set(0, -0.02, 0.06);
readerPad.userData.kind = "reader";
readerRoot.add(readerPad);
const readerLedMat = new THREE.MeshStandardMaterial({
  color: 0xff3344,
  emissive: 0xff1122,
  emissiveIntensity: 2.2,
});
const readerLed = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.055, 0.025), readerLedMat);
readerLed.position.set(0, 0.12, 0.06);
readerLed.userData.kind = "reader";
readerRoot.add(readerLed);
// свечение лампочки на стену
const readerGlow = new THREE.PointLight(0xff2233, 1.8, 1.6, 2);
readerGlow.position.set(0, 0.12, 0.18);
readerRoot.add(readerGlow);
const readerHit = new THREE.Mesh(
  new THREE.BoxGeometry(0.35, 0.5, 0.35),
  new THREE.MeshBasicMaterial({ visible: false })
);
readerHit.userData.kind = "reader";
readerRoot.add(readerHit);
const readerTargets = [readerBody, readerPad, readerLed, readerHit];

function setReaderLed(ok) {
  if (ok) {
    ledMode = "green";
    readerLedMat.color.setHex(0x33ff66);
    readerLedMat.emissive.setHex(0x22ff55);
    readerLedMat.emissiveIntensity = 3.2;
    readerGlow.color.setHex(0x33ff66);
    readerGlow.intensity = 3.5;
  } else {
    ledMode = "red";
    readerLedMat.color.setHex(0xff3344);
    readerLedMat.emissive.setHex(0xff1122);
    readerLedMat.emissiveIntensity = 2.2;
    readerGlow.color.setHex(0xff2233);
    readerGlow.intensity = 1.8;
  }
}

// дверная коробка с глубиной — створка внутри проёма, не «наклейка на стене»
const DOOR_Z = 16.48;
const jambMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, metalness: 0.45, roughness: 0.42 });
{
  // глубокий косяк внутрь стены (видна толщина проёма)
  [
    [-1.02, 1.4, 0.1, 2.9, 0.42],
    [1.02, 1.4, 0.1, 2.9, 0.42],
    [0, 2.88, 2.14, 0.1, 0.42],
  ].forEach(([x, y, w, h, d]) => {
    const j = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), jambMat);
    j.position.set(x, y, DOOR_Z - 0.05);
    lobbyRoot.add(j);
  });
  // наружный наличник поверх стены
  [
    [0, 3.0, 2.4, 0.16, 0.06],
    [-1.16, 1.4, 0.16, 3.05, 0.06],
    [1.16, 1.4, 0.16, 3.05, 0.06],
  ].forEach(([x, y, w, h, d]) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
    f.position.set(x, y, DOOR_Z + 0.18);
    f.castShadow = true;
    lobbyRoot.add(f);
  });
  // порог
  const sill = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.07, 0.4), jambMat);
  sill.position.set(0, 0.035, DOOR_Z - 0.02);
  lobbyRoot.add(sill);
}

// сплошная металлическая створка (не стекло/окно)
const lobbyDoorPivot = new THREE.Group();
lobbyDoorPivot.position.set(-0.95, 0, DOOR_Z + 0.02);
lobbyRoot.add(lobbyDoorPivot);

const doorSteel = new THREE.MeshStandardMaterial({
  map: lobbyDoorTex,
  color: 0xc5c9ce,
  metalness: 0.72,
  roughness: 0.32,
});
const lobbyDoor = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.8, 0.14), doorSteel);
lobbyDoor.position.set(0.95, 1.42, 0);
lobbyDoor.castShadow = true;
lobbyDoor.receiveShadow = true;
lobbyDoor.userData.kind = "lobbyDoor";
lobbyDoorPivot.add(lobbyDoor);

// выступающая кромка по периметру
{
  const lipMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.75, roughness: 0.3 });
  [
    [0.95, 2.78, 1.9, 0.06, 0.04],
    [0.95, 0.06, 1.9, 0.06, 0.04],
    [0.05, 1.42, 0.06, 2.8, 0.04],
    [1.85, 1.42, 0.06, 2.8, 0.04],
  ].forEach(([x, y, w, h, d]) => {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lipMat);
    lip.position.set(x, y, 0.09);
    lip.userData.kind = "lobbyDoor";
    lobbyDoorPivot.add(lip);
  });
}

// утопленные филёнки (темнее створки — металл, не стекло)
const recessMat = new THREE.MeshStandardMaterial({ color: 0x8e949a, metalness: 0.7, roughness: 0.38 });
const beadMat = new THREE.MeshStandardMaterial({ color: 0xa8aeb4, metalness: 0.7, roughness: 0.32 });
[-0.55, 0.55].forEach((y) => {
  const bead = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.02, 0.03), beadMat);
  bead.position.set(0.95, 1.42 + y, 0.075);
  bead.userData.kind = "lobbyDoor";
  lobbyDoorPivot.add(bead);
  const recess = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.86, 0.025), recessMat);
  recess.position.set(0.95, 1.42 + y, 0.065);
  recess.userData.kind = "lobbyDoor";
  lobbyDoorPivot.add(recess);
});

// нижняя отбойная пластина
{
  const kick = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.28, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x6a7076, metalness: 0.8, roughness: 0.28 })
  );
  kick.position.set(0.95, 0.22, 0.09);
  kick.userData.kind = "lobbyDoor";
  lobbyDoorPivot.add(kick);
}

// ручка-рычаг: нажимается вниз (rotation.z), не крутится «через себя»
const lobbyHandleBase = new THREE.Group();
lobbyHandleBase.position.set(1.62, 1.38, 0.09);
lobbyDoorPivot.add(lobbyHandleBase);
const lobbyHandlePivot = new THREE.Group(); // крутится рычаг
lobbyHandleBase.add(lobbyHandlePivot);
const lobbyHandleParts = [];
{
  const rose = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.04, 20),
    metalDarkMat
  );
  rose.rotation.x = Math.PI / 2;
  rose.position.z = 0.01;
  rose.userData.kind = "lobbyHandle";
  lobbyHandleBase.add(rose);
  lobbyHandleParts.push(rose);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 12), metalDarkMat);
  neck.rotation.x = Math.PI / 2;
  neck.position.z = 0.04;
  neck.userData.kind = "lobbyHandle";
  lobbyHandlePivot.add(neck);
  lobbyHandleParts.push(neck);

  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.28, 12), metalDarkMat);
  lever.rotation.z = Math.PI / 2;
  lever.position.set(0.14, 0, 0.05);
  lever.userData.kind = "lobbyHandle";
  lobbyHandlePivot.add(lever);
  lobbyHandleParts.push(lever);

  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 12), metalDarkMat);
  tip.position.set(0.28, 0, 0.05);
  tip.userData.kind = "lobbyHandle";
  lobbyHandlePivot.add(tip);
  lobbyHandleParts.push(tip);

  const handleHit = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.35, 0.3),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  handleHit.position.set(0.12, 0, 0.06);
  handleHit.userData.kind = "lobbyHandle";
  lobbyHandleBase.add(handleHit);
  lobbyHandleParts.push(handleHit);
}
let handleAngle = 0; // текущий угол рычага (0 = горизонтально, + = вниз)

const lobbyDoorHit = new THREE.Mesh(
  new THREE.BoxGeometry(2.0, 2.9, 0.45),
  new THREE.MeshBasicMaterial({ visible: false })
);
lobbyDoorHit.position.set(0.95, 1.4, 0.05);
lobbyDoorHit.userData.kind = "lobbyDoor";
lobbyDoorPivot.add(lobbyDoorHit);

const lobbyDoorTargets = [lobbyDoor, lobbyDoorHit, ...lobbyDoorPivot.children.filter((c) => c.userData.kind === "lobbyDoor")];
const lobbyHandleTargets = lobbyHandleParts;

/* —— дверной глазок: живой вид во 2 комнату —— */
const peepholeRT = new THREE.WebGLRenderTarget(512, 512, {
  type: THREE.UnsignedByteType,
  depthBuffer: true,
});
peepholeRT.texture.colorSpace = THREE.SRGBColorSpace;

const peepholeCam = new THREE.PerspectiveCamera(118, 1, 0.06, 35);
peepholeCam.position.set(0, 1.58, 16.08);
peepholeCam.lookAt(0, 1.9, 8.2);

const peepholeRoot = new THREE.Group();
peepholeRoot.position.set(0.95, 1.58, 0.095);
lobbyDoorPivot.add(peepholeRoot);

const peepholeChrome = new THREE.MeshStandardMaterial({
  color: 0xc8ced4,
  metalness: 0.95,
  roughness: 0.18,
});
const peepholeChromeDark = new THREE.MeshStandardMaterial({
  color: 0x5a6068,
  metalness: 0.9,
  roughness: 0.28,
});

// наружное кольцо / юбка
{
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.062, 0.012, 28),
    peepholeChrome
  );
  skirt.rotation.x = Math.PI / 2;
  skirt.position.z = 0.002;
  skirt.userData.kind = "peephole";
  peepholeRoot.add(skirt);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.007, 12, 28), peepholeChrome);
  ring.position.z = 0.01;
  ring.userData.kind = "peephole";
  peepholeRoot.add(ring);

  const ringInner = new THREE.Mesh(
    new THREE.TorusGeometry(0.028, 0.004, 10, 24),
    peepholeChromeDark
  );
  ringInner.position.z = 0.014;
  ringInner.userData.kind = "peephole";
  peepholeRoot.add(ringInner);
}

// линза: тусклое зеленоватое стекло, картинка еле читается
const peepholeLensMat = new THREE.MeshBasicMaterial({
  map: peepholeRT.texture,
  color: 0x5a6a58,
  transparent: true,
  opacity: 0.92,
});
const peepholeLens = new THREE.Mesh(
  new THREE.CircleGeometry(0.026, 28),
  peepholeLensMat
);
peepholeLens.position.z = 0.016;
peepholeLens.userData.kind = "peephole";
peepholeRoot.add(peepholeLens);

// сильное затемнение края — как настоящий глазок
{
  const edge = new THREE.Mesh(
    new THREE.RingGeometry(0.014, 0.027, 28),
    new THREE.MeshBasicMaterial({
      color: 0x020304,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    })
  );
  edge.position.z = 0.017;
  edge.userData.kind = "peephole";
  peepholeRoot.add(edge);
}


const peepholeHit = new THREE.Mesh(
  new THREE.CircleGeometry(0.08, 20),
  new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
);
peepholeHit.position.z = 0.02;
peepholeHit.userData.kind = "peephole";
peepholeRoot.add(peepholeHit);

const peepholeTargets = peepholeRoot.children.filter((c) => c.userData.kind === "peephole");

let peepholeRenderTick = 0;

function renderPeepholeView() {
  // маленький превью на линзе двери (когда не смотрим сквозь глазок)
  if (focus === "peephole") return;
  if (lobbyDoorOpen || lobbyOpening || phase !== "lobby") return;
  peepholeRenderTick++;
  if (peepholeRenderTick % 3 !== 0) return;

  const snap = beginPeepholeScene();
  peepholeCam.position.set(0, 1.58, 16.05);
  peepholeCam.rotation.order = "YXZ";
  peepholeCam.rotation.set(0.04, 0, 0);
  peepholeCam.fov = 118;
  peepholeCam.updateProjectionMatrix();

  renderer.setRenderTarget(peepholeRT);
  renderer.autoClear = true;
  renderer.clear();
  renderer.render(scene, peepholeCam);
  renderer.setRenderTarget(null);

  endPeepholeScene(snap);
  if (nightLampLight) {
    nightLampLight.intensity = nightLampLight.userData.baseIntensity ?? 0.28;
  }
}

function goToPeephole() {
  if (phase !== "lobby" || lobbyDoorOpen || lobbyOpening || lobbyClosing) return;
  if (camLerp) return;
  if (focus === "peephole") return;
  ensureAudio();
  softNoise(0.04, 0.015, 900, 1.5);
  // подходим к двери, затем включается крупный круглый обзор
  approachFocus("peephole");
}

/** настроение сцены для вида «сквозь глазок» */
function beginPeepholeScene() {
  if (!ambientLight) return null;
  const snap = {
    amb: ambientLight.intensity,
    hemi: hemi ? hemi.intensity : 0,
    bg: scene.background ? scene.background.clone() : null,
    fog: scene.fog,
    night: nightLampLight ? nightLampLight.intensity : 0,
    nightDist: nightLampLight ? nightLampLight.distance : 6.5,
    peek: lobbyPeekBlock.visible,
    pass: passCard.visible,
    root: peepholeRoot.visible,
    lobby: lobbyRoot.visible,
    // ключи/заливки холла не должны светить в глазок
    key: keyLight.intensity,
    spot: spot.intensity,
    fillW: fillWarm.intensity,
    fillC: fillCool.intensity,
  };
  lobbyPeekBlock.visible = false;
  peepholeRoot.visible = false;
  passCard.visible = false;
  lobbyRoot.visible = false;
  // полутёмный коридор: силуэты и пятно дежурной лампы едва читаются
  ambientLight.intensity = 0.06;
  if (hemi) hemi.intensity = 0.08;
  keyLight.intensity = 0;
  spot.intensity = 0;
  fillWarm.intensity = 0;
  fillCool.intensity = 0;
  scene.background = new THREE.Color(0x0a0c10);
  scene.fog = new THREE.FogExp2(0x0a0c10, 0.028);
  if (nightLampLight) {
    nightLampLight.distance = 9;
    // мигание сохраняем — только усиливаем базу для глазка
    const f = nightLampLight.userData.lastFlicker ?? 1;
    nightLampLight.intensity = 1.3 * f;
  }
  return snap;
}

function endPeepholeScene(snap) {
  if (!snap) return;
  lobbyPeekBlock.visible = snap.peek;
  peepholeRoot.visible = snap.root;
  passCard.visible = snap.pass;
  lobbyRoot.visible = snap.lobby;
  if (ambientLight) ambientLight.intensity = snap.amb;
  if (hemi) hemi.intensity = snap.hemi;
  keyLight.intensity = snap.key;
  spot.intensity = snap.spot;
  fillWarm.intensity = snap.fillW;
  fillCool.intensity = snap.fillC;
  if (snap.bg) scene.background.copy(snap.bg);
  scene.fog = snap.fog;
  if (nightLampLight) {
    nightLampLight.intensity = snap.night;
    nightLampLight.distance = snap.nightDist ?? 6.5;
  }
}

function syncPeepholeCam() {
  // ровно по центру коридора, смотрим на круглую дверь ворот
  peepholeCam.position.set(0, 1.7, 14.8);
  const tx = lookYaw * 2.2;
  const ty = 2.35 + lookPitch * 2.0;
  peepholeCam.up.set(0, 1, 0);
  peepholeCam.lookAt(tx, ty, 5.55);
  peepholeCam.fov = 58;
  peepholeCam.updateProjectionMatrix();
}

/* ===================== GATE — круглая дверь вписана в коридор (~4.2м высота) ===================== */
const gateRoot = new THREE.Group();
gateRoot.position.set(0, 0, 5.5);
scene.add(gateRoot);

const wallMat = new THREE.MeshStandardMaterial({
  map: concreteTex,
  color: 0x1a1c20,
  roughness: 0.92,
  metalness: 0.02,
});
const WALL_COL_DARK = new THREE.Color(0x121418);
const WALL_COL_LIT = new THREE.Color(0xb8bcc2);

// радиус проёма: дверь не должна вылезать за пол/потолок коридора
const GATE_CY = 2.15;
const GATE_OPEN_R = 1.76; // дырка в бетоне
const GATE_DOOR_R = 1.7; // створка почти вплотную к воротнику
const GATE_DOOR_Z = 0.3; // заподлицо с фланцем (не утоплена)

// цельная лицевая стена с КРУГЛЫМ проёмом
const wallFace = new THREE.Mesh(
  new THREE.RingGeometry(GATE_OPEN_R + 0.02, 8.0, 64),
  wallMat
);
wallFace.position.set(0, GATE_CY, 0.22);
wallFace.receiveShadow = true;
gateRoot.add(wallFace);

// толщина стены вокруг (короб) — низ НЕ врезается в круглый проём
[
  [-5.5, 3.2, 6, 6.8],
  [5.5, 3.2, 6, 6.8],
  [0, 6.35, 11, 1.3],
  // верх плиты пола под проёмом: y+h/2 < GATE_CY - GATE_OPEN_R
  [0, 0.14, 11, 0.28],
].forEach(([x, y, w, h]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.1), wallMat);
  m.position.set(x, y, -0.2);
  m.receiveShadow = true;
  gateRoot.add(m);
});

// металлический туннель/воротник
const tunnel = new THREE.Mesh(
  new THREE.CylinderGeometry(GATE_OPEN_R, GATE_OPEN_R, 1.0, 64, 1, true),
  metalDarkMat
);
tunnel.rotation.x = Math.PI / 2;
tunnel.position.set(0, GATE_CY, -0.05);
gateRoot.add(tunnel);

// внешний стальной фланец — в одной плоскости с дверью
const flange = new THREE.Mesh(
  new THREE.RingGeometry(GATE_OPEN_R - 0.02, GATE_OPEN_R + 0.38, 64),
  metalDarkMat
);
flange.position.set(0, GATE_CY, 0.36);
gateRoot.add(flange);
{
  const flangeRim = new THREE.Mesh(
    new THREE.TorusGeometry(GATE_OPEN_R + 0.18, 0.05, 12, 64),
    brass
  );
  flangeRim.position.set(0, GATE_CY, 0.4);
  gateRoot.add(flangeRim);
  const innerRim = new THREE.Mesh(
    new THREE.TorusGeometry(GATE_OPEN_R - 0.01, 0.03, 10, 64),
    metalDarkMat
  );
  innerRim.position.set(0, GATE_CY, 0.38);
  gateRoot.add(innerRim);
}
// болты по фланцу
for (let i = 0; i < 20; i++) {
  const a = (i / 20) * Math.PI * 2;
  const br = GATE_OPEN_R + 0.2;
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 8), brass);
  bolt.rotation.x = Math.PI / 2;
  bolt.position.set(Math.cos(a) * br, GATE_CY + Math.sin(a) * br, 0.44);
  gateRoot.add(bolt);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.025, 6), brass);
  head.rotation.x = Math.PI / 2;
  head.position.set(Math.cos(a) * br, GATE_CY + Math.sin(a) * br, 0.48);
  gateRoot.add(head);
}

// створка заподлицо с основанием/фланцем
const gateDoorPivot = new THREE.Group();
gateDoorPivot.position.set(0, GATE_CY, GATE_DOOR_Z);
gateRoot.add(gateDoorPivot);

const gateDisc = new THREE.Mesh(
  new THREE.CylinderGeometry(GATE_DOOR_R, GATE_DOOR_R, 0.28, 64),
  metalDarkMat
);
gateDisc.rotation.x = Math.PI / 2;
gateDisc.castShadow = true;
gateDoorPivot.add(gateDisc);

const gateFace = new THREE.Mesh(new THREE.CircleGeometry(GATE_DOOR_R - 0.015, 64), metalMat);
gateFace.position.z = 0.145;
gateDoorPivot.add(gateFace);

// зубчатый венец по краю (катится по шестерням)
{
  const rimGear = new THREE.Mesh(
    new THREE.TorusGeometry(GATE_DOOR_R - 0.04, 0.05, 8, 64),
    brass
  );
  rimGear.position.z = 0.12;
  gateDoorPivot.add(rimGear);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const tooth = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.1, 0.06),
      brass
    );
    tooth.position.set(
      Math.cos(a) * (GATE_DOOR_R - 0.02),
      Math.sin(a) * (GATE_DOOR_R - 0.02),
      0.12
    );
    tooth.rotation.z = a;
    gateDoorPivot.add(tooth);
  }
}

[GATE_DOOR_R * 0.78, GATE_DOOR_R * 0.52, GATE_DOOR_R * 0.3].forEach((r, i) => {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(r, i ? 0.022 : 0.035, 10, 48),
    i ? metalMat : brass
  );
  ring.position.z = 0.19;
  gateDoorPivot.add(ring);
});

for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  const ribLen = GATE_DOOR_R * 0.68;
  const rib = new THREE.Mesh(new THREE.BoxGeometry(0.055, ribLen, 0.03), metalMat);
  const mid = ribLen * 0.4;
  rib.position.set(Math.cos(a) * mid, Math.sin(a) * mid, 0.2);
  rib.rotation.z = a;
  gateDoorPivot.add(rib);
}

const wheel = new THREE.Group();
wheel.position.z = 0.36;
gateDoorPivot.add(wheel);
{
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.1, 16), brass);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  const wr = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.045, 10, 32), brass);
  wr.position.z = 0.02;
  wheel.add(wr);
  const wr2 = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.028, 8, 32), metalMat);
  wr2.position.z = 0.03;
  wheel.add(wr2);
}
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.52, 0.04), brass);
  spoke.position.set(Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0.02);
  spoke.rotation.z = a;
  wheel.add(spoke);
}

/** шестерёнка для механизма закатывания */
function makeGateGear(radius, teeth, thick, mat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.72, radius * 0.72, thick, 20),
    mat
  );
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, thick + 0.02, 12),
    brass
  );
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const tooth = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 0.28, thick * 0.95, radius * 0.32),
      mat
    );
    tooth.position.set(Math.cos(a) * radius * 0.85, Math.sin(a) * radius * 0.85, 0);
    tooth.rotation.z = a;
    g.add(tooth);
  }
  return g;
}

const gateGears = [];
const gateBolts = [];
const gateLockLeds = [];
let gateDriveGear = null;
let gatePistonL = null;
let gatePistonR = null;
{
  const gearMat = new THREE.MeshStandardMaterial({
    color: 0xb8a050,
    metalness: 0.85,
    roughness: 0.3,
  });
  const specs = [
    { x: GATE_OPEN_R + 0.35, y: GATE_CY - 0.55, r: 0.28, teeth: 10, ratio: 1 },
    { x: GATE_OPEN_R + 0.72, y: GATE_CY + 0.15, r: 0.42, teeth: 14, ratio: -0.65 },
    { x: GATE_OPEN_R + 1.15, y: GATE_CY - 0.35, r: 0.22, teeth: 8, ratio: 1.2 },
    { x: GATE_OPEN_R + 0.95, y: GATE_CY + 0.75, r: 0.18, teeth: 7, ratio: -1.5 },
  ];
  specs.forEach((s) => {
    const gear = makeGateGear(s.r, s.teeth, 0.1, gearMat);
    gear.position.set(s.x, s.y, 0.48);
    gateRoot.add(gear);
    gateGears.push({ mesh: gear, ratio: s.ratio });
    const ax = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.16, 8),
      metalDarkMat
    );
    ax.rotation.x = Math.PI / 2;
    ax.position.set(s.x, s.y, 0.42);
    gateRoot.add(ax);
  });

  // главная ведущая шестерня снизу — цепляет венец двери
  gateDriveGear = makeGateGear(0.38, 12, 0.14, gearMat);
  gateDriveGear.position.set(0, GATE_CY - GATE_DOOR_R - 0.32, 0.35);
  gateRoot.add(gateDriveGear);
  gateGears.push({ mesh: gateDriveGear, ratio: -1.8 });

  // рельсы
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(GATE_DOOR_R * 2.6, 0.08, 0.12),
    metalDarkMat
  );
  rail.position.set(GATE_OPEN_R + GATE_DOOR_R * 0.85, GATE_CY - GATE_DOOR_R - 0.08, 0.2);
  gateRoot.add(rail);
  const rail2 = rail.clone();
  rail2.position.y = GATE_CY + GATE_DOOR_R + 0.08;
  gateRoot.add(rail2);

  // радиальные засовы по ободу (втянуты = открыто)
  const BOLT_N = 12;
  for (let i = 0; i < BOLT_N; i++) {
    const a = (i / BOLT_N) * Math.PI * 2;
    const holder = new THREE.Group();
    holder.position.set(0, GATE_CY, 0.38);
    holder.rotation.z = a;
    gateRoot.add(holder);
    const house = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.1, 0.1),
      metalDarkMat
    );
    house.position.x = GATE_OPEN_R + 0.06;
    holder.add(house);
    const bolt = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.055, 0.055),
      brass
    );
    // locked: tip в дверь; open: выдвинут наружу
    bolt.position.x = GATE_OPEN_R - 0.12;
    holder.add(bolt);
    gateBolts.push({ bolt, i, lockedX: GATE_OPEN_R - 0.12, openX: GATE_OPEN_R + 0.2 });

    const ledMat = new THREE.MeshStandardMaterial({
      color: 0xff3344,
      emissive: 0xff0022,
      emissiveIntensity: 1.2,
    });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), ledMat);
    led.position.set(
      Math.cos(a) * (GATE_OPEN_R + 0.28),
      GATE_CY + Math.sin(a) * (GATE_OPEN_R + 0.28),
      0.5
    );
    gateRoot.add(led);
    gateLockLeds.push(ledMat);
  }

  // гидроцилиндры по бокам — «выталкивают» дверь в карман
  function makePiston(side) {
    const g = new THREE.Group();
    g.position.set(side * (GATE_OPEN_R + 0.15), GATE_CY, 0.55);
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.08, 0.55, 10),
      metalDarkMat
    );
    cyl.rotation.z = Math.PI / 2;
    g.add(cyl);
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8),
      brass
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.x = side * 0.15;
    g.add(rod);
    gateRoot.add(g);
    return { group: g, rod, side };
  }
  gatePistonL = makePiston(-1);
  gatePistonR = makePiston(1);
}

/* —— цифровая панель на ПРАВОЙ боковой стене (лицом в коридор) —— */
const keypadRoot = new THREE.Group();
// стена коридора: центр x=3.5, толщина 0.35 → внутренняя грань ≈3.325
// мир: ~(3.22, 2.15, 8.5); −π/2 → local +Z смотрит в −X (в коридор)
keypadRoot.position.set(3.22, 2.15, 3.0); // gateRoot.z=5.5 → world z=8.5
keypadRoot.rotation.y = -Math.PI / 2;
gateRoot.add(keypadRoot);

const keypadTargets = [];
{
  // корпус панели
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 1.55, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, metalness: 0.55, roughness: 0.4 })
  );
  panel.castShadow = true;
  panel.userData.kind = "keypad";
  keypadRoot.add(panel);
  keypadTargets.push(panel);
  // рамка
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(1.02, 1.62, 0.04),
    metalDarkMat
  );
  frame.position.z = -0.04;
  keypadRoot.add(frame);
  // винты
  [[-0.44, 0.72], [0.44, 0.72], [-0.44, -0.72], [0.44, -0.72]].forEach(([x, y]) => {
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 8), brass);
    sc.rotation.x = Math.PI / 2;
    sc.position.set(x, y, 0.06);
    keypadRoot.add(sc);
  });
  // табло
  const boardFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.82, 0.38, 0.05),
    metalMat
  );
  boardFrame.position.set(0, 0.48, 0.06);
  boardFrame.userData.kind = "keypad";
  keypadRoot.add(boardFrame);
  keypadTargets.push(boardFrame);
  const boardMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.76, 0.32),
    new THREE.MeshBasicMaterial({ map: boardTex })
  );
  boardMesh.position.set(0, 0.48, 0.095);
  boardMesh.userData.kind = "keypad";
  keypadRoot.add(boardMesh);
  keypadTargets.push(boardMesh);

  function makeKey(label, kind, digit, x, y, color) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.18, 0.06),
      new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.4 })
    );
    body.position.set(x, y, 0.08);
    body.userData.kind = kind;
    if (digit !== undefined) body.userData.digit = digit;
    body.castShadow = true;
    keypadRoot.add(body);
    keypadTargets.push(body);
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 96;
    const cx = c.getContext("2d");
    cx.fillStyle = "#0a0a0a";
    cx.fillRect(0, 0, 128, 96);
    cx.fillStyle = "#f0e6d0";
    cx.font = "700 42px monospace";
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText(label, 64, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const lab = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, 0.14),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    lab.position.set(x, y, 0.115);
    lab.userData.kind = kind;
    if (digit !== undefined) lab.userData.digit = digit;
    keypadRoot.add(lab);
    keypadTargets.push(lab);
  }

  // сетка 1–9, CLR / 0 / OK
  const keys = [
    ["1", "digit", 1], ["2", "digit", 2], ["3", "digit", 3],
    ["4", "digit", 4], ["5", "digit", 5], ["6", "digit", 6],
    ["7", "digit", 7], ["8", "digit", 8], ["9", "digit", 9],
    ["C", "clr", undefined], ["0", "digit", 0], ["OK", "ok", undefined],
  ];
  keys.forEach((k, i) => {
    const col = i % 3;
    const row = (i / 3) | 0;
    const x = (col - 1) * 0.26;
    const y = 0.12 - row * 0.22;
    const color =
      k[1] === "ok" ? 0x3a6a45 : k[1] === "clr" ? 0x6a3a3a : 0x2a2e34;
    makeKey(k[0], k[1], k[2], x, y, color);
  });

  // индикатор
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xff0022, emissiveIntensity: 1.5 })
  );
  led.position.set(0.38, 0.7, 0.1);
  keypadRoot.add(led);
  window.__gateLed = led;

  // зона подхода — чуть сзади кнопок, не перекрывает цифры
  const padHit = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.7, 0.2),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  padHit.position.set(0, 0, -0.05);
  padHit.userData.kind = "keypad";
  keypadRoot.add(padHit);
  keypadTargets.push(padHit);

  // подпись на стене над панелью
  {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const cx = c.getContext("2d");
    cx.fillStyle = "#1a1a1a";
    cx.fillRect(0, 0, 256, 64);
    cx.fillStyle = "#c9a86a";
    cx.font = "700 28px sans-serif";
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText("КОД ДОСТУПА", 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.18),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    sign.position.set(0, 0.95, 0.06);
    keypadRoot.add(sign);
  }
}

/* —— архив на ЛЕВОЙ стене коридора (фрагмент кода) —— */
const archiveRoot = new THREE.Group();
archiveRoot.position.set(-3.22, 2.15, 3.0);
archiveRoot.rotation.y = Math.PI / 2;
gateRoot.add(archiveRoot);
{
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.35, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x3a342c, metalness: 0.25, roughness: 0.55 })
  );
  cab.userData.kind = "gateArchive";
  archiveRoot.add(cab);
  gateArchiveTargets.push(cab);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.95),
    new THREE.MeshStandardMaterial({
      color: 0x88aacc,
      transparent: true,
      opacity: 0.18,
      metalness: 0.1,
      roughness: 0.2,
    })
  );
  glass.position.z = 0.1;
  glass.userData.kind = "gateArchive";
  archiveRoot.add(glass);
  gateArchiveTargets.push(glass);
  const ac = document.createElement("canvas");
  ac.width = 384;
  ac.height = 512;
  const ax = ac.getContext("2d");
  ax.fillStyle = "#f3ead8";
  ax.fillRect(0, 0, 384, 512);
  ax.fillStyle = "#8a3030";
  ax.font = "700 28px sans-serif";
  ax.textAlign = "center";
  ax.fillText("СЛУЖЕБНЫЙ АРХИВ", 192, 56);
  ax.fillStyle = "#2a2418";
  ax.font = "18px sans-serif";
  ax.fillText("FUTURUM · gate access", 192, 96);
  ax.font = "700 64px monospace";
  ax.fillStyle = "#1a1a1a";
  ax.fillText("13 _ _", 192, 220);
  ax.font = "16px sans-serif";
  ax.fillStyle = "#5a5040";
  ax.fillText("фрагмент кода · лист 02", 192, 280);
  ax.fillText("остальное — в холле", 192, 310);
  ax.fillText("(журнал / автоответчик)", 192, 340);
  const atex = new THREE.CanvasTexture(ac);
  atex.colorSpace = THREE.SRGBColorSpace;
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.72),
    new THREE.MeshBasicMaterial({ map: atex })
  );
  paper.position.set(0, 0.05, 0.11);
  paper.userData.kind = "gateArchive";
  archiveRoot.add(paper);
  gateArchiveTargets.push(paper);
  const aHit = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.5, 0.5),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  aHit.position.z = 0.15;
  aHit.userData.kind = "gateArchive";
  archiveRoot.add(aHit);
  gateArchiveTargets.push(aHit);
}

const gateHit = new THREE.Mesh(
  new THREE.CircleGeometry(GATE_DOOR_R + 0.05, 32),
  new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
);
gateHit.position.set(0, 0, 0.2);
gateHit.userData.kind = "gatebody";
gateDoorPivot.add(gateHit);

// заглушка сразу за створкой — без светлой «дыры» в щели
const peekBlock = new THREE.Mesh(
  new THREE.CircleGeometry(GATE_OPEN_R + 0.08, 48),
  new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.95, side: THREE.DoubleSide })
);
peekBlock.position.set(0, GATE_CY, GATE_DOOR_Z - 0.22);
gateRoot.add(peekBlock);

// коридор от входной двери (z≈16) до ворот (z≈5.5) — тёмный, пока не зажглись лампы
const hallSurfaces = [];
const HALL_COL_DARK = {
  wall: new THREE.Color(0x0a0b0d),
  floor: new THREE.Color(0x060708),
  ceil: new THREE.Color(0x08090a),
  base: new THREE.Color(0x101114),
  runner: new THREE.Color(0x050607),
};
const HALL_COL_LIT = {
  wall: new THREE.Color(0xd8dde4),
  floor: new THREE.Color(0xc8ced6),
  ceil: new THREE.Color(0xe4e8ee),
  base: new THREE.Color(0xa8aeb6),
  runner: new THREE.Color(0x2e3a42),
};

const hallMat = new THREE.MeshStandardMaterial({
  map: wallTex,
  color: HALL_COL_DARK.wall.clone(),
  roughness: 0.9,
});
const hallFloorMat = new THREE.MeshStandardMaterial({
  map: floorTex,
  color: HALL_COL_DARK.floor.clone(),
  roughness: 0.82,
});
const hallCeilMat = new THREE.MeshStandardMaterial({
  color: HALL_COL_DARK.ceil.clone(),
  roughness: 0.94,
});
const hallBaseMat = new THREE.MeshStandardMaterial({
  color: HALL_COL_DARK.base.clone(),
  roughness: 0.6,
});
const hallRunnerMat = new THREE.MeshStandardMaterial({
  color: HALL_COL_DARK.runner.clone(),
  roughness: 0.92,
});
hallSurfaces.push(
  { mat: hallMat, dark: HALL_COL_DARK.wall, lit: HALL_COL_LIT.wall },
  { mat: hallFloorMat, dark: HALL_COL_DARK.floor, lit: HALL_COL_LIT.floor },
  { mat: hallCeilMat, dark: HALL_COL_DARK.ceil, lit: HALL_COL_LIT.ceil },
  { mat: hallBaseMat, dark: HALL_COL_DARK.base, lit: HALL_COL_LIT.base },
  { mat: hallRunnerMat, dark: HALL_COL_DARK.runner, lit: HALL_COL_LIT.runner }
);

{
  const hallFloor = new THREE.Mesh(new THREE.PlaneGeometry(8, 14), hallFloorMat);
  hallFloor.rotation.x = -Math.PI / 2;
  hallFloor.position.set(0, 0.01, 11);
  hallFloor.receiveShadow = true;
  scene.add(hallFloor);
}
[-1, 1].forEach((side) => {
  const w = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.4, 12.5), hallMat);
  w.position.set(side * 3.5, 2.2, 11);
  w.receiveShadow = true;
  w.castShadow = true;
  scene.add(w);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 12.5), hallBaseMat);
  base.position.set(side * 3.35, 0.06, 11);
  scene.add(base);
});
{
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.2, 12.5), hallCeilMat);
  ceil.position.set(0, 4.35, 11);
  scene.add(ceil);
}

// люминесцентные лампы вдоль коридора
const hallLights = [];
hallLightOn = false;
hallLightAnim = null;
hallLightLevel = 0;

const fluoroHousing = new THREE.MeshStandardMaterial({
  color: 0x3a3e44,
  metalness: 0.55,
  roughness: 0.45,
});

[15.0, 13.0, 11.0, 9.0, 7.2].forEach((z, i) => {
  const group = new THREE.Group();
  group.position.set(0, 4.18, z);
  scene.add(group);

  const housing = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 0.22), fluoroHousing);
  housing.position.y = 0.06;
  group.add(housing);

  // два люминесцентных стержня + колпачки
  const tubeMats = [];
  [-0.055, 0.055].forEach((tz) => {
    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0xb8c8d0,
      emissive: 0xd8f2ff,
      emissiveIntensity: 0,
      roughness: 0.35,
      metalness: 0.05,
    });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1.32, 12), tubeMat);
    tube.rotation.z = Math.PI / 2;
    tube.position.set(0, -0.02, tz);
    group.add(tube);
    tubeMats.push(tubeMat);
    [-0.68, 0.68].forEach((ex) => {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.06), fluoroHousing);
      cap.position.set(ex, -0.02, tz);
      group.add(cap);
    });
  });

  const pl = new THREE.PointLight(0xdcefff, 0, 8.5, 1.8);
  pl.position.set(0, 3.55, z);
  scene.add(pl);

  hallLights.push({
    mats: tubeMats,
    light: pl,
    base: 4.6,
    baseEmissive: 2.4,
    delay: 0.08 + i * 0.18,
    buzzed: false,
  });
});

{
  const runner = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 10), hallRunnerMat);
  runner.position.set(0, 0.025, 11);
  runner.receiveShadow = true;
  scene.add(runner);
}
{
  const gateSpot = new THREE.SpotLight(0xd0e8ff, 0, 22, Math.PI / 5.2, 0.45, 1.15);
  gateSpot.position.set(0, 5.0, 9.5);
  gateSpot.target.position.set(0, 2.2, 5.5);
  gateSpot.userData.wantShadow = true;
  gateSpot.castShadow = !perfLow;
  gateSpot.shadow.mapSize.set(perfLow ? 512 : 1024, perfLow ? 512 : 1024);
  scene.add(gateSpot, gateSpot.target);
  hallLights.push({
    mats: [],
    light: gateSpot,
    base: 28,
    baseEmissive: 0,
    delay: 0.95,
    buzzed: false,
  });
}

// дежурная лампа — всегда чуть светит в кромешной темноте
const nightLampRoot = new THREE.Group();
nightLampRoot.position.set(3.05, 2.55, 10.2);
scene.add(nightLampRoot);
{
  const cage = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.08, 0.14, 10, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x3a3a38,
      metalness: 0.7,
      roughness: 0.45,
      side: THREE.DoubleSide,
    })
  );
  nightLampRoot.add(cage);
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffd9a0,
    emissive: 0xffaa55,
    emissiveIntensity: 0.9,
    roughness: 0.4,
  });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), bulbMat);
  nightLampRoot.add(bulb);
  nightLampRoot.userData.bulbMat = bulbMat;
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.05, 0.06, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2a28, metalness: 0.4, roughness: 0.6 })
  );
  shade.position.y = 0.08;
  nightLampRoot.add(shade);
}
const nightLampLight = new THREE.PointLight(0xffb060, 0.42, 7.5, 2);
nightLampLight.position.copy(nightLampRoot.position);
nightLampLight.userData.baseIntensity = 0.42;
nightLampLight.userData.lastFlicker = 1;
scene.add(nightLampLight);

/** мигание дежурной лампы (и в коридоре, и в глазке) */
function updateNightLamp() {
  const bulbMat = nightLampRoot.userData.bulbMat;
  if (hallLightOn && hallLightLevel > 0.7) {
    nightLampLight.intensity = 0.08;
    nightLampLight.userData.lastFlicker = 0.2;
    if (bulbMat) bulbMat.emissiveIntensity = 0.12;
    return;
  }
  const t = performance.now() * 0.001;
  // медленная волна + быстрый дрожащий свет + шум
  let f =
    1 +
    Math.sin(t * 1.9) * 0.14 +
    Math.sin(t * 7.4) * 0.16 +
    Math.sin(t * 19.0) * 0.1 +
    (Math.random() - 0.5) * 0.28;
  // редкие «просадки» как у старой лампочки
  const dip = Math.sin(t * 0.55 + Math.sin(t * 2.3));
  if (dip > 0.88) f *= 0.12 + Math.random() * 0.28;
  else if (dip > 0.72 && Math.random() < 0.35) f *= 0.35 + Math.random() * 0.3;
  f = Math.max(0.1, Math.min(1.4, f));
  nightLampLight.userData.lastFlicker = f;
  nightLampLight.intensity = nightLampLight.userData.baseIntensity * f;
  if (bulbMat) bulbMat.emissiveIntensity = 0.35 + f * 0.85;
}

/** классический старт люминесцентной лампы: вспышка → пауза → вспышка → выход на режим */
function fluorescentIgnite(local) {
  if (local < 0) return 0;
  if (local < 0.07) return 0.9;
  if (local < 0.16) return 0.02;
  if (local < 0.24) return 0.75;
  if (local < 0.34) return 0.05;
  if (local < 0.42) return 0.55;
  if (local < 0.55) return 0.15 + (local - 0.42) * 2.2;
  if (local < 0.85) {
    const u = (local - 0.55) / 0.3;
    return 0.55 + u * 0.4 + Math.sin(local * 55) * 0.08 * (1 - u);
  }
  return 1;
}

function applyHallSurfaces(k) {
  const t = Math.max(0, Math.min(1, k));
  for (const s of hallSurfaces) {
    s.mat.color.copy(s.dark).lerp(s.lit, t);
  }
  // стена ворот тоже не белая в темноте
  if (wallMat) wallMat.color.copy(WALL_COL_DARK).lerp(WALL_COL_LIT, t);
}

function applyHallLightLevel(k) {
  hallLightLevel = k;
  applyHallSurfaces(k);
  for (const L of hallLights) {
    L.light.intensity = L.base * k;
    for (const m of L.mats) m.emissiveIntensity = L.baseEmissive * k;
  }
  if (phase === "gate") applyRoomMood("gate");
}

/** включить / выключить люминесцентный свет коридора */
function setHallLightsPower(on) {
  if (on && hallLightOn && !hallLightAnim) return;
  if (!on && !hallLightOn && !hallLightAnim) {
    applyHallLightLevel(0);
    return;
  }
  hallLightOn = on;
  hallLightAnim = { t: 0, on };
  for (const L of hallLights) L.buzzed = false;
  if (on) {
    softNoise(0.05, 0.02, 1200, 2);
  }
}

/** кольцо статусных ламп вокруг круглой двери — «охранный» обход */
function updateGateRingLeds() {
  if (!gateLockLeds.length || gateOpening) return;
  const t = performance.now() * 0.001;
  const n = gateLockLeds.length;
  // бегущий луч по кольцу + мягкое дыхание
  const sweep = ((t * 0.55) % 1) * n;
  for (let i = 0; i < n; i++) {
    const m = gateLockLeds[i];
    let d = Math.abs(i - sweep);
    if (d > n * 0.5) d = n - d;
    const beam = Math.max(0, 1 - d * 1.15);
    const beamSoft = beam * beam;
    const breathe = 0.55 + 0.2 * Math.sin(t * 1.35 + i * 0.4);
    // редкий двойной «тиктяк» как у сигнализации
    const tick = Math.sin(t * Math.PI * 2.0);
    const alarmBlink = tick > 0.82 ? 0.35 : tick < -0.9 ? 0.2 : 0;
    const intensity = breathe + beamSoft * 1.55 + alarmBlink;
    m.color.setHex(0xff3344);
    m.emissive.setHex(0xff0022);
    m.emissiveIntensity = 0.45 + intensity * 1.1;
  }
}

function updateHallLights() {
  updateNightLamp();
  updateGateRingLeds();
  if (!hallLightAnim) {
    // живые люминесцентные: гул + редкие просадки + лёгкий дрейф
    if (hallLightOn && hallLightLevel > 0.85) {
      const t = performance.now() * 0.001;
      for (const L of hallLights) {
        if (!L.mats.length) continue;
        const hum =
          1 +
          Math.sin(t * 8.5 + L.delay * 10) * 0.02 +
          Math.sin(t * 1.7 + L.delay * 3) * 0.035;
        const dipWave = Math.sin(t * 0.33 + L.delay * 5);
        const dip = dipWave > 0.92 ? 0.62 + Math.random() * 0.18 : 1;
        const f = Math.max(0.55, hum * dip);
        L.light.intensity = L.base * f;
        for (const m of L.mats) m.emissiveIntensity = L.baseEmissive * f;
      }
      // спот на дверь тоже чуть дышит
      for (const L of hallLights) {
        if (L.mats.length) continue;
        const f = 1 + Math.sin(t * 1.1) * 0.04 + Math.sin(t * 0.37) * 0.03;
        L.light.intensity = L.base * f;
      }
    }
    return;
  }
  // при входе из холла каскад чуть медленнее — лучше видно через дверь
  hallLightAnim.t += lobbyOpening && hallLightAnim.on ? 0.0085 : 0.014;
  const T = hallLightAnim.t;
  if (hallLightAnim.on) {
    let sum = 0;
    let allDone = true;
    for (const L of hallLights) {
      const local = (T - L.delay) / (lobbyOpening ? 0.95 : 0.72);
      if (local < 1) allDone = false;
      const k = fluorescentIgnite(local);
      if (!L.buzzed && local >= 0 && local < 0.1) {
        L.buzzed = true;
        softNoise(0.04, 0.016, 1400 + L.delay * 400, 2.2);
      }
      L.light.intensity = L.base * k;
      for (const m of L.mats) m.emissiveIntensity = L.baseEmissive * k;
      sum += k;
    }
    hallLightLevel = sum / Math.max(1, hallLights.length);
    applyHallSurfaces(hallLightLevel);
    if (phase === "gate" || lobbyOpening) applyRoomMood(phase === "gate" ? "gate" : "lobby");
    // подсветка коридора при открытии двери ещё из холла
    if (lobbyOpening && hallLightLevel > 0.05) {
      ambientLight.intensity = 0.42 - hallLightLevel * 0.12;
    }
    if (allDone && T > 1.85) {
      hallLightAnim = null;
      applyHallLightLevel(1);
      if (phase === "gate") applyRoomMood("gate");
    }
  } else {
    const k = Math.max(0, 1 - T * 1.6);
    applyHallLightLevel(k);
    if (k <= 0) {
      hallLightAnim = null;
      if (phase === "lobby") applyRoomMood("lobby");
    }
  }
}

/* ===================== VAULT ROOM (скрыта до кода) ===================== */
const vault = new THREE.Group();
vault.position.set(0, 0, -2);
vault.visible = false;
scene.add(vault);

const vaultFloor = new THREE.Mesh(
  new THREE.CircleGeometry(6, 48),
  new THREE.MeshStandardMaterial({ map: floorTex, color: 0xe8e2d8, roughness: 0.75 })
);
vaultFloor.rotation.x = -Math.PI / 2;
vaultFloor.receiveShadow = true;
vault.add(vaultFloor);

const vaultWalls = new THREE.Mesh(
  new THREE.CylinderGeometry(5.5, 5.5, 4.5, 40, 1, true),
  new THREE.MeshStandardMaterial({ map: wallTex, color: 0xeae6e0, side: THREE.BackSide, roughness: 0.88 })
);
vaultWalls.position.y = 2.2;
vault.add(vaultWalls);
{
  const vCeil = new THREE.Mesh(
    new THREE.CircleGeometry(5.6, 40),
    new THREE.MeshStandardMaterial({ color: 0xf0ebe4, roughness: 0.92, side: THREE.DoubleSide })
  );
  vCeil.rotation.x = Math.PI / 2;
  vCeil.position.y = 4.4;
  vault.add(vCeil);
}

vault.add(new THREE.AmbientLight(0xfff4e8, 0.4));
{
  const vKey = new THREE.DirectionalLight(0xffefd8, 0.9);
  vKey.position.set(2, 6, 4);
  vKey.userData.wantShadow = true;
  vKey.castShadow = !perfLow;
  vKey.shadow.mapSize.set(perfLow ? 512 : 1024, perfLow ? 512 : 1024);
  vKey.shadow.camera.near = 1;
  vKey.shadow.camera.far = 20;
  vKey.shadow.camera.left = -6;
  vKey.shadow.camera.right = 6;
  vKey.shadow.camera.top = 6;
  vKey.shadow.camera.bottom = -6;
  vault.add(vKey);
}
vault.add(new THREE.PointLight(0xffe0b0, 12, 12, 1.5).translateY(3.5));
vault.add(new THREE.PointLight(0xd0e0ff, 4, 10, 2).translateX(2).translateY(2).translateZ(1));

// стол + сейф
const table = new THREE.Mesh(
  new THREE.BoxGeometry(2.2, 0.1, 1.4),
  new THREE.MeshStandardMaterial({ color: 0xe4dccf, roughness: 0.65, metalness: 0.12 })
);
table.position.set(0, 0.5, 0.5);
table.castShadow = true;
table.receiveShadow = true;
vault.add(table);
{
  const legMat = new THREE.MeshStandardMaterial({ color: 0x8a8070, metalness: 0.5, roughness: 0.4 });
  [[-0.9, -0.55], [0.9, -0.55], [-0.9, 0.55], [0.9, 0.55]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), legMat);
    leg.position.set(x, 0.25, 0.5 + z);
    leg.castShadow = true;
    vault.add(leg);
  });
}

const safeRoot = new THREE.Group();
safeRoot.position.set(0, 0.55, 0.5);
vault.add(safeRoot);

const SW = 1.4;
const SH = 1.7;
const SD = 1.05;
const safeBody = new THREE.Mesh(new THREE.BoxGeometry(SW, SH, SD), steel);
safeBody.position.y = SH / 2;
safeBody.castShadow = true;
safeRoot.add(safeBody);

const safeDoorPivot = new THREE.Group();
safeDoorPivot.position.set(-SW / 2, SH / 2, SD / 2);
safeRoot.add(safeDoorPivot);
const safeDoor = new THREE.Mesh(new THREE.BoxGeometry(SW - 0.04, SH - 0.08, 0.09), steelDark);
safeDoor.position.set(SW / 2, 0, 0);
safeDoor.castShadow = true;
safeDoorPivot.add(safeDoor);

const safeHandle = new THREE.Group();
safeHandle.position.set(SW / 2 + 0.25, -0.25, 0.08);
safeDoorPivot.add(safeHandle);
{
  const hm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.05, 16), brass);
  hm.rotation.x = Math.PI / 2;
  safeHandle.add(hm);
}
const safeArm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.05), brass);
safeArm.position.set(0.18, 0, 0.02);
safeHandle.add(safeArm);
const safeBall = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), brass);
safeBall.position.set(0.38, 0, 0.02);
safeHandle.add(safeBall);
const safeHandleHit = new THREE.Mesh(
  new THREE.SphereGeometry(0.35, 10, 10),
  new THREE.MeshBasicMaterial({ visible: false })
);
safeHandleHit.position.set(0.15, 0, 0);
safeHandleHit.userData.kind = "safeHandle";
safeHandle.add(safeHandleHit);

const safeLoot = new THREE.Mesh(
  new THREE.BoxGeometry(0.3, 0.1, 0.2),
  new THREE.MeshStandardMaterial({ color: 0xc9a86a, emissive: 0x332200, emissiveIntensity: 0.4, metalness: 0.8 })
);
safeLoot.position.set(0, SH / 2, 0);
safeLoot.visible = false;
safeRoot.add(safeLoot);

/* —— ячейки сзади —— */
const cells = [];
const cellGroup = new THREE.Group();
cellGroup.position.set(0, 0, -3.2);
vault.add(cellGroup);

const bank = new THREE.Mesh(
  new THREE.BoxGeometry(5.2, 3.2, 0.5),
  new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.35, roughness: 0.55 })
);
bank.position.y = 1.7;
bank.castShadow = true;
cellGroup.add(bank);

/** роли ячеек: ключ / записка / чужие / пустые */
const CELL_ROLES = [
  { role: "key", color: 0xc9a86a, title: "Ключ", body: "Бирка на ключе: «…37».\nПохоже на конец кода доступа." },
  { role: "empty", color: 0x6a6a6a, title: "Пусто", body: "Ячейка пуста." },
  { role: "guest", color: 0x6a8cff, title: "Чужая", body: "" },
  { role: "note", color: 0x7dba7d, title: "Записка", body: "«Первые цифры — 1 и 3.\nНе забыть порядок.»" },
  { role: "guest", color: 0xff8844, title: "Чужая", body: "" },
  { role: "empty", color: 0x5a5a5a, title: "Пусто", body: "Только пыль." },
  { role: "guest", color: 0xa88cff, title: "Чужая", body: "" },
  { role: "empty", color: 0x707070, title: "Пусто", body: "Пусто." },
  { role: "empty", color: 0x4a4a4a, title: "Пусто", body: "Ничего." },
  { role: "guest", color: 0x88c0a0, title: "Чужая", body: "" },
  { role: "empty", color: 0x666666, title: "Пусто", body: "Пусто." },
  { role: "empty", color: 0x555555, title: "Пусто", body: "Пусто." },
];

const COLS = 4;
const ROWS = 3;
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const id = cells.length;
    const def = CELL_ROLES[id] || { role: "empty", color: 0x666666, title: "Пусто", body: "Пусто." };
    const cell = new THREE.Group();
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.85, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x3a3834, metalness: 0.7, roughness: 0.4 })
    );
    door.castShadow = true;
    door.userData.kind = "cell";
    door.userData.cellId = id;
    cell.add(door);

    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 10), brass);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(0.35, 0, 0.06);
    knob.userData.kind = "cell";
    knob.userData.cellId = id;
    cell.add(knob);

    const numC = document.createElement("canvas");
    numC.width = 128;
    numC.height = 64;
    const nctx = numC.getContext("2d");
    function paintCellLabel(ownerName) {
      nctx.clearRect(0, 0, 128, 64);
      nctx.fillStyle = "#c9a86a";
      nctx.font = "700 28px monospace";
      nctx.textAlign = "center";
      nctx.fillText(String(id + 1).padStart(2, "0"), 64, 28);
      if (ownerName) {
        nctx.fillStyle = "#8ab4ff";
        nctx.font = "700 14px sans-serif";
        nctx.fillText(String(ownerName).slice(0, 8), 64, 52);
      } else if (def.role === "key") {
        nctx.fillStyle = "#e8d4a8";
        nctx.font = "700 12px sans-serif";
        nctx.fillText("КЛЮЧ", 64, 52);
      } else if (def.role === "note") {
        nctx.fillStyle = "#a8d8a8";
        nctx.font = "700 12px sans-serif";
        nctx.fillText("ЗАПИСЬ", 64, 52);
      }
    }
    paintCellLabel(null);
    const ntex = new THREE.CanvasTexture(numC);
    ntex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.18), new THREE.MeshBasicMaterial({ map: ntex }));
    label.position.set(-0.25, 0.25, 0.05);
    cell.add(label);

    const inside = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.15, 0.2),
      new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: 0x221100,
        emissiveIntensity: 0.35,
        metalness: 0.6,
      })
    );
    inside.position.z = -0.15;
    inside.visible = false;
    cell.add(inside);

    cell.position.set((col - 1.5) * 1.2, 0.7 + row * 0.95, 0.3);
    cellGroup.add(cell);
    cells.push({
      group: cell,
      door,
      inside,
      labelTex: ntex,
      paintLabel: paintCellLabel,
      role: def.role,
      title: def.title,
      body: def.body,
      ownerName: "",
      open: false,
      openT: 0,
      opening: false,
      revealed: false,
    });
  }
}

function assignCellOwners() {
  if (!cells.length) return;
  const others = eventPlayers.filter((p) => String(p.id) !== String(vkUser.id));
  let gi = 0;
  cells.forEach((c) => {
    if (c.role !== "guest") return;
    const p = others[gi % Math.max(1, others.length)];
    c.ownerName = others.length ? p.name || "Игрок" : "АРХИВ";
    c.body = `Ячейка закреплена за:\n${c.ownerName}\nНе ваша — лучше закрыть.`;
    c.paintLabel(c.ownerName);
    c.labelTex.needsUpdate = true;
    gi++;
  });
  refreshGuestPassLabel();
}

assignCellOwners();

/* —— interaction —— */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function ndc(e) {
  const r = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

function hits(e, objs) {
  ndc(e);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(objs, true);
}

function tryLobbyHandle() {
  if (phase !== "lobby" || lobbyOpening || lobbyClosing || handlePullT >= 0 || handleTugT >= 0) return;
  ensureAudio();
  startMusic();
  if (!passTaken || !passUnlocked) {
    // без пропуска / без скана — дёргаем рычаг и дверь
    passDenyKind = !passTaken ? "noPass" : "locked";
    handleTugT = 0;
    lobbyDoorShake = 1;
    sfxHandle();
    setTimeout(() => sfxRattle(), 70);
    if (!passTaken) {
      sfxBeep(180, 0.07);
      setTimeout(() => sfxBeep(140, 0.08), 110);
    } else {
      setTimeout(() => sfxBeep(220, 0.05), 90);
    }
    return;
  }
  if (focus !== "lobbyDoor") {
    approachFocus("lobbyDoor");
    return;
  }
  // уже открыта — закрываем (после возврата из коридора)
  if (lobbyDoorOpen) {
    lobbyClosing = true;
    lobbyDoorT = 1;
    handleAngle = 0;
    lobbyHandlePivot.rotation.z = 0;
    sfxHandle();
    setTimeout(() => sfxDoor(), 120);
    setStepBackVisible(false);
    updateRoomBackBtn();
    return;
  }
  // рычаг вниз → открытие двери
  handlePullT = 0;
  sfxHandle();
}

/** жест к ридеру без карты — отказ */
function playReaderNoCard() {
  if (readerNoCardT >= 0 || passScanning || passScanDeny) return;
  readerNoCardT = 0;
  ledMode = "deny";
  ledBlinkT = 0;
  // «пустая» карта в руке для жеста
  if (emptyPassCard) {
    emptyPassCard.visible = true;
    emptyPassMat.opacity = 0.85;
  }
  sfxBeep(200, 0.06);
  setTimeout(() => sfxRattle(), 100);
  setTimeout(() => sfxBeep(150, 0.09), 200);
}

function onReaderTap() {
  if (
    phase !== "lobby" ||
    lobbyOpening ||
    lobbyClosing ||
    passScanning ||
    passTakeT >= 0 ||
    readerNoCardT >= 0
  )
    return;
  ensureAudio();
  startMusic();
  // подойти к ридеру можно всегда
  if (focus !== "reader") {
    approachFocus("reader");
    return;
  }
  if (passUnlocked) return;
  // без пропуска — красивый отказ, дверь/доступ не открыть
  if (!passTaken) {
    playReaderNoCard();
    return;
  }
  if (!passCardOut) {
    showPassCard();
    return;
  }
  // карта в руке — прикладываем к панели
  scanPass();
}

function setGateLed(ok) {
  const led = window.__gateLed;
  if (!led) return;
  if (ok === true) {
    led.material.color.setHex(0x44ff88);
    led.material.emissive.setHex(0x22ff66);
    led.material.emissiveIntensity = 2.2;
  } else if (ok === false) {
    led.material.color.setHex(0xff3344);
    led.material.emissive.setHex(0xff0022);
    led.material.emissiveIntensity = 2.5;
  } else {
    led.material.color.setHex(0xff3344);
    led.material.emissive.setHex(0xff0022);
    led.material.emissiveIntensity = 1.5;
  }
}

function pressDigit(n) {
  if (phase !== "gate" || gateOpening || focus !== "gateKeypad") return;
  if (entered.length >= GATE_CODE.length) return;
  ensureAudio();
  startMusic();
  entered.push(n);
  sfxClack(280 + n * 8, 0.06);
  drawBoard();
  // авто-проверка после полной длины
  if (entered.length >= GATE_CODE.length) submitCode();
}

function submitCode() {
  if (phase !== "gate" || gateOpening || focus !== "gateKeypad") return;
  ensureAudio();
  startMusic();
  if (entered.length < GATE_CODE.length) {
    sfxBeep(420, 0.04);
    return;
  }
  const ok = GATE_CODE.every((v, i) => v === entered[i]);
  if (ok) {
    codeFailCount = 0;
    drawBoard("ok");
    setGateLed(true);
    sfxUnlock();
    openGate();
  } else {
    codeFailCount += 1;
    drawBoard("bad");
    setGateLed(false);
    sfxRattle();
    if (codeFailCount >= 3) {
      setTimeout(() => triggerAccessAlarm(), 200);
    }
    setTimeout(() => {
      entered = [];
      setGateLed(null);
      drawBoard();
    }, 700);
  }
}

function clearDigits() {
  if (phase !== "gate" || gateOpening || focus !== "gateKeypad") return;
  entered = [];
  setGateLed(null);
  sfxClack(180, 0.05);
  drawBoard();
}

function openGate() {
  gateOpening = true;
  gateOpenT = 0;
  vault.visible = true;
  controls.enabled = false;
  // отойти от панели — смотреть, как открывается дверь
  if (focus || camMode === "focus") {
    const r = ROOMS.gate;
    focus = null;
    setStepBackVisible(false);
    startCamLerp(r.stand, r.look, () => {
      snapToStand("gate");
    });
  }
  // механика: засовы → шестерни → качение
  sfxClack(140, 0.05);
  setTimeout(() => softNoise(0.12, 0.035, 380, 1.4), 80);
  setTimeout(() => {
    for (let i = 0; i < 6; i++) {
      setTimeout(() => sfxClack(200 + i * 15, 0.04), i * 70);
    }
  }, 150);
  setTimeout(() => sfxHeavy(), 450);
  setTimeout(() => softNoise(0.22, 0.04, 160, 1), 700);
  setTimeout(() => sfxDoor(), 1100);
  setTimeout(() => softNoise(0.3, 0.03, 80, 0.7), 1600);
}

function enterVault() {
  if (phase === "vault") return;
  phase = "vault";
  focus = null;
  if (!gateDoorOpen) hostEvent("gate");
  gateDoorOpen = true;
  vault.visible = true;
  peekBlock.visible = false;
  scene.background = new THREE.Color(0xe4e0d8);
  scene.fog = new THREE.FogExp2(0xddd8d0, 0.016);
  const r = ROOMS.vault;
  // плавный медленный заход в хранилище после анимации двери
  startCamLerp(
    r.stand,
    r.look,
    () => {
      snapToStand("vault");
    },
    0.009
  );
}

function trySafe() {
  if (phase !== "vault" || focus !== "safe" || safeOpen || safeOpening) return;
  ensureAudio();
  startMusic();
  handleTarget = -Math.PI * 0.5;
  sfxClack(160, 0.09);
  setTimeout(() => {
    safeOpening = true;
    safeOpenT = 0;
    sfxDoor();
    safeLoot.visible = true;
  }, 350);
}

function tryCell(id) {
  if (phase !== "vault" || focus !== "cells") return;
  const c = cells[id];
  if (!c || c.open || c.opening) return;
  ensureAudio();
  c.opening = true;
  c.openT = 0;
  sfxClack(240, 0.06);
  setTimeout(() => sfxClack(140, 0.05), 120);
}

function onCellOpened(c) {
  if (!c || c.revealed) return;
  c.revealed = true;
  if (c.role === "key") foundCodeHints.cellKey = true;
  if (c.role === "note") foundCodeHints.cellNote = true;
  const title = c.title || "Ячейка";
  let body = c.body || "";
  if (c.role === "guest" && c.ownerName) {
    body = `Ячейка закреплена за:\n${c.ownerName}\nНе ваша — лучше закрыть.`;
  }
  showNote(title, body);
  hostEvent("cell", `${title}${c.ownerName ? " · " + c.ownerName : ""}`);
}

function onMagazineTap() {
  if (phase !== "lobby") return;
  if (focus !== "magazine") {
    approachFocus("magazine");
    return;
  }
  foundCodeHints.mag = true;
  sfxClack(220, 0.04);
  showNote(
    "Журнал · закладка",
    "Между страницами записка:\n«Код ворот начинается с 1 3…\nОстальное — в архиве / на телефоне.»"
  );
}

function onCoolerTap() {
  if (phase !== "lobby") return;
  if (focus !== "cooler") {
    approachFocus("cooler");
    return;
  }
  sfxCooler();
  showNote("Кулер", "Бульк.\nВода холодная. Больше ничего интересного.");
}

function onPhoneTap() {
  if (phase !== "lobby") return;
  if (focus !== "phone") {
    approachFocus("phone");
    return;
  }
  foundCodeHints.phone = true;
  sfxPhoneTone();
  showNote(
    "Автоответчик",
    "«…напоминание охране:\nпоследние две цифры кода — 3 и 7.\nКонец сообщения.»"
  );
}

function onGuestPassTap() {
  if (phase !== "lobby") return;
  if (focus !== "guestPass") {
    approachFocus("guestPass");
    return;
  }
  refreshGuestPassLabel();
  const others = eventPlayers.filter((p) => String(p.id) !== String(vkUser.id));
  const name = others.length ? others[0].name : "АРХИВ";
  sfxClack(200, 0.04);
  showNote("Чужой пропуск", `На столе чужая карта:\n${name}\nЕё нельзя забрать — только посмотреть.`);
}

function onGateArchiveTap() {
  if (phase !== "gate" || gateOpening) return;
  if (focus !== "gateLeft") {
    goToGateArchive();
    return;
  }
  foundCodeHints.dossier = true;
  sfxClack(180, 0.05);
  showNote(
    "Служебный архив",
    "Лист 02 / gate access:\n\n13 _ _\n\nПервые две цифры кода.\nДополните по подсказкам из холла."
  );
}

async function onTimerBoardTap() {
  if (phase !== "lobby") return;
  if (focus !== "timerBoard") {
    approachFocus("timerBoard");
    return;
  }
  if (!isEventAdmin()) {
    showNote("Таймер эвента", "Общий отсчёт до открытия двери.\nСинхронизируется с хостом.");
    return;
  }
  const ok = await hostResetTimer();
  if (ok) {
    sfxUnlock();
    showNote("Таймер сброшен", `Админ-сброс выполнен.\nСнова ${EVENT_UNLOCK_DAYS} дн. для всех игроков.`);
    drawTimerBoard();
  } else {
    showNote("Сброс не удался", "Хост недоступен.\nПроверь туннель и host.json.");
  }
}

const safeTargets = [safeHandleHit, safeArm, safeBall, safeDoor, safeBody];
const cellTargets = cells.flatMap((c) => [c.door, ...c.group.children]);
const gateBodyTargets = [gateHit, gateDisc, gateFace];

let ptrDown = null;

function onTap(e) {
  if (!playerReady) return;
  if (introLetterOpen) return;
  if (
    camLerp ||
    lobbyOpening ||
    lobbyClosing ||
    gateOpening ||
    passScanning ||
    passTakeT >= 0 ||
    passInspectT >= 0 ||
    passPocketT >= 0 ||
    readerNoCardT >= 0 ||
    introDoorUnlocking
  )
    return;
  ensureAudio();
  startMusic();

  if (phase === "intro") {
    for (const d of introDoors) {
      if (hits(e, d.targets).length) {
        tryIntroDoor(d.no);
        return;
      }
    }
    if (focus) returnToRoom();
    return;
  }

  if (phase === "lobby") {
    if (hits(e, playersBoardTargets).length) {
      if (focus !== "playersBoard") approachFocus("playersBoard");
      return;
    }
    if (hits(e, timerBoardTargets).length) {
      onTimerBoardTap();
      return;
    }
    if (magazineTargets.length && hits(e, magazineTargets).length) {
      onMagazineTap();
      return;
    }
    if (coolerTargets.length && hits(e, coolerTargets).length) {
      onCoolerTap();
      return;
    }
    if (phoneTargets.length && hits(e, phoneTargets).length) {
      onPhoneTap();
      return;
    }
    if (guestPassTargets.length && hits(e, guestPassTargets).length) {
      onGuestPassTap();
      return;
    }
    const rh = hits(e, radioTargets);
    if (rh.length) {
      if (focus !== "radio") {
        approachFocus("radio");
        return;
      }
      const hit =
        rh.find((h) => {
          const k = h.object.userData.kind;
          return (
            k === "radioPlay" ||
            k === "radioStop" ||
            k === "radioNext" ||
            k === "radioVolUp" ||
            k === "radioVolDown"
          );
        }) || rh[0];
      const kind = hit.object.userData.kind;
      if (kind === "radioPlay") playLobbyMusic(musicTrack);
      else if (kind === "radioStop") stopLobbyMusic();
      else if (kind === "radioNext") nextMusicTrack();
      else if (kind === "radioVolUp") bumpMusicVolume(0.02);
      else if (kind === "radioVolDown") bumpMusicVolume(-0.02);
      updateRadioDisplay();
      return;
    }
    if (lightSwitchTargets.length && hits(e, lightSwitchTargets).length) {
      onLightSwitchTap();
      return;
    }
    if (deskLampTargets.length && hits(e, deskLampTargets).length) {
      onDeskLampTap();
      return;
    }
    if (!passTaken && passHookTargets.length && hits(e, passHookTargets).length) {
      onPassHookTap();
      return;
    }
    if (hits(e, readerTargets).length) {
      onReaderTap();
      return;
    }
    if (!lobbyDoorOpen && hits(e, peepholeTargets).length) {
      if (focus !== "peephole") goToPeephole();
      else returnToRoom();
      return;
    }
    if (hits(e, lobbyHandleTargets).length) {
      if (focus !== "lobbyDoor") approachFocus("lobbyDoor");
      else tryLobbyHandle();
      return;
    }
    if (hits(e, lobbyDoorTargets).length) {
      if (focus !== "lobbyDoor") approachFocus("lobbyDoor");
      else tryLobbyHandle();
      return;
    }
    if (passCardOut && !passUnlocked) {
      hidePassCard();
      return;
    }
    if (focus) returnToRoom();
    return;
  }

  if (phase === "gate") {
    if (gateArchiveTargets.length && hits(e, gateArchiveTargets).length) {
      onGateArchiveTap();
      return;
    }
    const b = hits(e, keypadTargets);
    if (b.length) {
      if (focus !== "gateKeypad") {
        goToGateKeypad();
        return;
      }
      const hit =
        b.find(
          (h) =>
            h.object.userData.kind === "digit" ||
            h.object.userData.kind === "ok" ||
            h.object.userData.kind === "clr"
        ) || b[0];
      const kind = hit.object.userData.kind;
      if (kind === "digit") pressDigit(hit.object.userData.digit);
      else if (kind === "ok") submitCode();
      else if (kind === "clr") clearDigits();
      return;
    }
    if (hits(e, gateBodyTargets).length) {
      goToGateKeypad();
      return;
    }
    if (focus) returnToRoom();
    return;
  }

  if (phase === "vault") {
    if (hits(e, safeTargets).length) {
      if (focus !== "safe") approachFocus("safe");
      else trySafe();
      return;
    }
    const ch = hits(e, cellTargets);
    if (ch.length) {
      if (focus !== "cells") approachFocus("cells");
      else {
        const id = ch[0].object.userData.cellId;
        if (id !== undefined) tryCell(id);
      }
      return;
    }
    if (focus) returnToRoom();
  }
}

canvas.addEventListener("pointerdown", (e) => {
  ensureAudio();
  startMusic();
  ptrDown = { x: e.clientX, y: e.clientY, moved: false };
  boardScrolling = false;

  // у монитора игроков — свайп листает список
  if (phase === "lobby" && focus === "playersBoard" && !camLerp) {
    if (hits(e, playersBoardTargets).length) {
      boardScrolling = true;
      lookLastX = e.clientX;
      lookLastY = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
  }

  if (!camLerp) {
    lookDragging = true;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (boardScrolling) {
    const dy = e.clientY - lookLastY;
    lookLastY = e.clientY;
    if (ptrDown && Math.abs(dy) > 2) ptrDown.moved = true;
    playersScroll += dy * 1.8;
    clampPlayersScroll();
    drawPlayersBoard();
    e.preventDefault();
    return;
  }
  if (lookDragging && !camLerp) {
    const dx = e.clientX - lookLastX;
    const dy = e.clientY - lookLastY;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
    if (ptrDown && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) ptrDown.moved = true;
    lookYaw -= dx * 0.0045;
    lookPitch -= dy * 0.0035;
    applyLook();
    e.preventDefault();
  }
});

canvas.addEventListener(
  "wheel",
  (e) => {
    if (phase !== "lobby" || focus !== "playersBoard") return;
    e.preventDefault();
    playersScroll += e.deltaY * 0.65;
    clampPlayersScroll();
    drawPlayersBoard();
  },
  { passive: false }
);

canvas.addEventListener("pointerup", (e) => {
  lookDragging = false;
  boardScrolling = false;
  try {
    canvas.releasePointerCapture?.(e.pointerId);
  } catch {
    /* ignore */
  }
  if (!ptrDown) return;
  const moved = ptrDown.moved;
  const dx = e.clientX - ptrDown.x;
  const dy = e.clientY - ptrDown.y;
  ptrDown = null;
  if (moved || dx * dx + dy * dy > 64) return;
  onTap(e);
});

canvas.addEventListener("pointercancel", () => {
  ptrDown = null;
  lookDragging = false;
  boardScrolling = false;
});

function onViewportChange() {
  fitViewport();
  refitFocusCamera();
}

window.addEventListener("resize", onViewportChange);
window.addEventListener("orientationchange", () => {
  // после поворота WebView часто отдаёт размер с задержкой
  setTimeout(onViewportChange, 50);
  setTimeout(onViewportChange, 250);
  setTimeout(onViewportChange, 600);
});
if (window.visualViewport) {
  visualViewport.addEventListener("resize", onViewportChange);
  visualViewport.addEventListener("scroll", onViewportChange);
}
// VK Mini App: первый кадр иногда с кривым размером
setTimeout(onViewportChange, 100);
setTimeout(onViewportChange, 400);
setTimeout(onViewportChange, 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) setTimeout(onViewportChange, 50);
});

function loop() {
  requestAnimationFrame(loop);

  // авто-переход в low, если FPS держится низко ~2 сек
  {
    const now = performance.now();
    if (!perfFpsLastT) perfFpsLastT = now;
    const dt = now - perfFpsLastT;
    perfFpsLastT = now;
    if (dt > 0 && dt < 250) {
      perfFpsAcc += dt;
      perfFpsFrames += 1;
      if (perfFpsAcc >= 2000) {
        const fps = (perfFpsFrames * 1000) / perfFpsAcc;
        perfFpsAcc = 0;
        perfFpsFrames = 0;
        if (!perfLow && !perfAdaptChecked && fps < 28) {
          perfAdaptChecked = true;
          enableLowMode(`fps ${fps.toFixed(0)}`);
        } else if (perfLow) {
          perfAdaptChecked = true;
        }
      }
    }
  }

  updateHallLights();
  updateWallClock();
  const _t = performance.now() * 0.001;
  perfFrame++;
  // в low — реже тяжёлые декоративные апдейты
  if (!perfLow || (perfFrame & 1) === 0) {
    updateSecCamera(_t);
    if (phase === "lobby") updateFuturumSign(_t);
  }

  // входная дверь холла → коридор → ворота
  if (lobbyOpening) {
    // дверь открывается медленнее — успеваем увидеть зажигание ламп
    if (lobbyDoorT < 1) lobbyDoorT = Math.min(1, lobbyDoorT + 0.009);
    const e = 1 - Math.pow(1 - lobbyDoorT, 2.5);
    lobbyDoorPivot.rotation.y = -e * 1.85;
    // щёлкает щель → сразу каскад люминесцентных во 2-й комнате
    if (lobbyDoorT > 0.08) lobbyPeekBlock.visible = false;
    if (lobbyDoorT > 0.06 && !hallLightOn && !hallLightAnim) setHallLightsPower(true);
    // в коридор идём только когда лампы уже толком загорелись
    const lightsReady =
      hallLightLevel >= 0.72 || (lobbyDoorT >= 1 && hallLightLevel >= 0.4);
    if (lobbyDoorT > 0.4 && lightsReady && phase === "lobby" && !camLerp) {
      phase = "gate";
      focus = null;
      hidePassCard();
      setStepBackVisible(false);
      drawBoard();
      applyRoomMood("gate");
      const r = ROOMS.gate;
      startCamLerp(
        r.stand,
        r.look,
        () => {
          snapToStand("gate");
        },
        0.01
      );
    }
    // не закрываем фазу открытия, пока не стартовал переход (ждём свет)
    if (lobbyDoorT >= 1 && (phase === "gate" || camLerp)) {
      lobbyOpening = false;
      if (!lobbyDoorOpen) hostEvent("lobby_door");
      lobbyDoorOpen = true;
      lobbyPeekBlock.visible = false;
      updateRoomBackBtn();
    }
  } else if (lobbyClosing) {
    lobbyDoorT = Math.max(0, lobbyDoorT - 0.022);
    const e = 1 - Math.pow(1 - lobbyDoorT, 2.5);
    lobbyDoorPivot.rotation.y = -e * 1.85;
    if (lobbyDoorT < 0.22) lobbyPeekBlock.visible = true;
    if (lobbyDoorT <= 0) {
      lobbyClosing = false;
      lobbyDoorOpen = false;
      lobbyDoorT = 0;
      lobbyDoorPivot.rotation.y = 0;
      lobbyPeekBlock.visible = true;
      handleAngle = 0;
      lobbyHandlePivot.rotation.z = 0;
      sfxClack(160, 0.045);
      if (focus === "lobbyDoor") setStepBackVisible(true);
      updateRoomBackBtn();
    }
  }

  // таймер эвента на табло справа
  {
    const left = eventSecondsLeft();
    if (!doorEventReady && left <= 0) {
      doorEventReady = true;
      drawPassCard(vkUser, passPhotoImg);
      if (!eventReadyAnnounced) {
        eventReadyAnnounced = true;
        sfxBeep(660, 0.05);
        setTimeout(() => sfxBeep(880, 0.06), 120);
      }
    }
    if (phase === "lobby") drawTimerBoard();
  }

  // мерцание потолочных ламп + лёгкая модуляция гула
  if (phase === "lobby") {
    const t = performance.now() * 0.001;
    let avgFlicker = 0;
    for (const L of lobbyLamps) {
      if (!lobbyLightsOn) {
        L.light.intensity = 0;
        L.mat.emissiveIntensity = 0.04;
        avgFlicker += 0;
        continue;
      }
      let f;
      if (perfLow) {
        // без Math.random — стабильнее FPS на слабых GPU
        f = 1 + Math.sin(t * 2.1 + L.phase) * 0.03;
      } else {
        const wave =
          1 +
          Math.sin(t * 2.4 + L.phase) * 0.045 +
          Math.sin(t * 7.3 + L.phase * 1.7) * 0.028 +
          (Math.random() - 0.5) * 0.035;
        const dip = Math.sin(t * 0.41 + L.phase) > 0.965 ? 0.68 : 1;
        f = Math.max(0.55, wave * dip);
      }
      L.light.intensity = L.base * f;
      L.mat.emissiveIntensity = L.baseEmissive * f;
      avgFlicker += f;
    }
    avgFlicker /= Math.max(1, lobbyLamps.length);
    // гул ламп плавно следует за выключателем; фон комнаты не трогаем
    if (lampHumGain) {
      lampHumTarget = lobbyLightsOn ? 0.011 + avgFlicker * 0.005 : 0.0001;
      const cur = lampHumGain.gain.value;
      lampHumGain.gain.value = cur + (lampHumTarget - cur) * 0.08;
    }
    if (roomToneGain) {
      const want = 0.04;
      roomToneGain.gain.value += (want - roomToneGain.gain.value) * 0.04;
    }
    if (musicOn && focus === "radio" && ((performance.now() / 250) | 0) !== loop._radioTick) {
      loop._radioTick = (performance.now() / 250) | 0;
      updateRadioDisplay();
    }
  }

  if (musicOn && ((performance.now() / 200) | 0) !== loop._spatialTick) {
    loop._spatialTick = (performance.now() / 200) | 0;
    applyMusicSpatial();
  }

  // ридер без карты: пустой жест + красный отказ + дрожь панели
  if (readerNoCardT >= 0) {
    readerNoCardT = Math.min(1, readerNoCardT + 0.032);
    const t = readerNoCardT;
    const reach = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
    const shake = t > 0.35 && t < 0.85 ? Math.sin(t * 55) * 0.012 * (1 - Math.abs(t - 0.6) / 0.25) : 0;
    if (emptyPassCard) {
      emptyPassCard.visible = true;
      emptyPassCard.position.set(
        0.1 + reach * 0.22 + shake,
        -0.22 + reach * 0.08,
        -0.52 + reach * 0.2
      );
      emptyPassCard.rotation.set(-0.3 + reach * 0.4, -0.3 + reach * 0.7, -0.1 + shake * 2);
      emptyPassMat.opacity = t < 0.75 ? 0.9 : 0.9 * (1 - (t - 0.75) / 0.25);
    }
    readerRoot.position.set(
      READER_POS.x + shake * 0.6,
      READER_POS.y + Math.abs(shake) * 0.4,
      READER_POS.z
    );
    if (t > 0.3 && t < 0.8) {
      const flash = Math.sin((t - 0.3) * Math.PI * 5);
      readerPadMat.emissive.setHex(0xff2244);
      readerPadMat.emissiveIntensity = Math.max(0, flash) * 2.8;
    } else {
      readerPadMat.emissiveIntensity *= 0.85;
    }
    if (t >= 1) {
      readerNoCardT = -1;
      if (emptyPassCard) {
        emptyPassCard.visible = false;
        emptyPassMat.opacity = 0.9;
        emptyPassCard.position.set(0.1, -0.22, -0.52);
        emptyPassCard.rotation.set(-0.3, -0.3, -0.1);
      }
      readerRoot.position.copy(READER_POS);
      readerPadMat.emissiveIntensity = 0;
      ledMode = "red";
      setReaderLed(false);
    }
  }

  // снятие с крючка (только world-карта) → осмотр в руке → вниз в карман
  // без жеста «к ридеру» (тот идёт вперёд/вправо при scan)
  if (passTakeT >= 0 && passWorldRoot) {
    passTakeT = Math.min(1, passTakeT + 0.02);
    const t = passTakeT;
    // 0–0.35: снять с крючка вверх
    const lift = Math.min(1, t / 0.35);
    const liftE = lift * lift * (3 - 2 * lift);
    // 0.3–0.9: подтянуть к камере снизу (не к ридеру)
    const pull = Math.max(0, Math.min(1, (t - 0.3) / 0.55));
    const pullE = pull * pull * (3 - 2 * pull);
    const hand = new THREE.Vector3(0.08, -0.2, -0.48);
    hand.applyQuaternion(camera.quaternion);
    hand.add(camera.position);
    const mid = PASS_HOOK_ORIGIN.clone();
    mid.y += 0.28;
    mid.x -= 0.35; // в комнату, от стены
    if (pullE < 0.001) {
      passWorldRoot.position.lerpVectors(PASS_HOOK_ORIGIN, mid, liftE);
    } else {
      const from = new THREE.Vector3().lerpVectors(PASS_HOOK_ORIGIN, mid, 1);
      passWorldRoot.position.lerpVectors(from, hand, pullE);
    }
    passWorldRoot.rotation.y = -Math.PI / 2 + pullE * 0.85;
    passWorldRoot.rotation.x = -0.15 * liftE - pullE * 0.2;
    passWorldRoot.rotation.z = (1 - pullE) * Math.sin(performance.now() * 0.01) * 0.04;
    passWorldRoot.scale.setScalar(1 + pullE * 0.2);
    // камерную карту не показываем, пока world не долетит — иначе «двойной скан»
    if (passCard.visible) passCard.visible = false;
    if (t >= 1) {
      passTakeT = -1;
      passWorldRoot.visible = false;
      passTaken = true;
      passCardOut = true;
      passCard.visible = true;
      passAnim = 1;
      passMesh.material.opacity = 1;
      // поза «смотрю на карту» — у груди, без выноса к ридеру
      passCard.position.set(0.1, -0.2, -0.5);
      passCard.rotation.set(-0.35, -0.25, -0.06);
      drawPassCard(vkUser, passPhotoImg);
      sfxClack(340, 0.05);
      passInspectT = 0;
      passPocketT = -1;
    }
  } else if (passInspectT >= 0 && passCardOut) {
    // любопытный осмотр: медленно, плавно — как будто впервые видит пропуск
    passInspectT = Math.min(1, passInspectT + 0.007);
    const t = passInspectT;
    const easeIn = t * t * (3 - 2 * t);
    const curious = Math.sin(t * Math.PI); // интерес нарастает и сходит
    const settle = t > 0.78 ? ((t - 0.78) / 0.22) ** 2 * (3 - 2 * ((t - 0.78) / 0.22)) : 0;

    // живое покачивание «в руках»
    const swayX = Math.sin(t * Math.PI * 1.25) * 0.04 * curious;
    const swayY = Math.sin(t * Math.PI * 2.0) * 0.014;
    const turn = Math.sin(t * Math.PI * 1.05) * 0.42 * curious;
    const tip = Math.sin(t * Math.PI * 1.5) * 0.18 * curious;
    const nod = Math.sin(t * Math.PI * 1.7) * 0.07 * curious;

    let px = 0.09 + swayX;
    let py = -0.2 + easeIn * 0.08 + swayY;
    let pz = -0.52 + easeIn * 0.07;
    let rx = -0.36 - curious * 0.08 + nod;
    let ry = -0.2 + turn;
    let rz = tip;

    // перед карманом мягко выравнивает
    if (settle > 0) {
      px += (0.08 - px) * settle;
      py += (-0.22 - py) * settle;
      pz += (-0.5 - pz) * settle;
      rx += (-0.4 - rx) * settle;
      ry += (-0.22 - ry) * settle;
      rz += (0 - rz) * settle;
    }

    passCard.position.set(px, py, pz);
    passCard.rotation.set(rx, ry, rz);
    passMesh.material.opacity = 1;

    if (t >= 1) {
      passInspectT = -1;
      passPocketT = 0;
      sfxPassPocket();
    }
  } else if (passPocketT >= 0 && passCardOut) {
    // строго вниз/назад в карман — не вперёд к ридеру
    passPocketT = Math.min(1, passPocketT + 0.038);
    const e = passPocketT;
    const ease = e * e;
    passCard.position.set(0.06 - ease * 0.04, -0.2 - ease * 0.42, -0.5 - ease * 0.12);
    passCard.rotation.set(-0.35 - ease * 0.55, -0.25, -0.06 + ease * 0.1);
    passMesh.material.opacity = 1 - ease;
    if (e >= 1) {
      hidePassCard();
      if (focus === "passHook") returnToRoom();
    }
  }

  // анимация щелчка рокера
  if (lightSwitchAnimT >= 0 && lightSwitchRocker) {
    lightSwitchAnimT = Math.min(1, lightSwitchAnimT + 0.14);
    const u = lightSwitchAnimT;
    // overshoot как настоящий щелчок
    const e = u < 0.7 ? (u / 0.7) * (u / 0.7) : 1 + Math.sin((u - 0.7) * Math.PI) * 0.08 * (1 - (u - 0.7) / 0.3);
    const k = Math.min(1, e);
    lightSwitchRocker.rotation.x = lightSwitchFromX + (lightSwitchToX - lightSwitchFromX) * k;
    if (u >= 1) lightSwitchAnimT = -1;
  }

  // дёрганье верёвочного выключателя лампы
  if (deskLampCordPullT >= 0 && deskLampCord && deskLampCordKnob) {
    deskLampCordPullT = Math.min(1, deskLampCordPullT + 0.055);
    const u = deskLampCordPullT;
    const pull = u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65;
    const pullE = Math.sin(pull * Math.PI);
    const stretch = DESK_LAMP_CORD_LEN * (1 + pullE * 0.35);
    deskLampCord.scale.y = stretch / DESK_LAMP_CORD_LEN;
    deskLampCord.position.y = DESK_LAMP_CORD_Y - (stretch - DESK_LAMP_CORD_LEN) * 0.5;
    deskLampCordKnob.position.y = DESK_LAMP_CORD_Y - stretch * 0.5 - 0.012;
    // щелчок/свет — на нижней точке шнурка
    if (u >= 0.32 && deskLampPending !== null) {
      deskLampOn = deskLampPending;
      deskLampPending = null;
      if (deskLampOn) {
        deskLampLevel = Math.min(deskLampLevel, 0.08);
        deskLampFlickerT = 0; // короткий «зажигательный» вспых
      }
    }
    if (u >= 1) {
      deskLampCordPullT = -1;
      deskLampCord.scale.y = 1;
      deskLampCord.position.y = DESK_LAMP_CORD_Y;
      deskLampCordKnob.position.y = DESK_LAMP_CORD_Y - DESK_LAMP_CORD_LEN * 0.5 - 0.012;
    }
  }

  // яркость лампы: плавное вкл/выкл + редкое мягкое мерцание
  if (deskLampLight) {
    const now = performance.now();
    const want = deskLampOn ? 1 : 0;
    const speed = deskLampOn ? 0.07 : 0.11; // выключается чуть быстрее
    deskLampLevel += (want - deskLampLevel) * speed;
    if (Math.abs(deskLampLevel - want) < 0.002) deskLampLevel = want;

    let flicker = 1;
    if (deskLampOn && deskLampLevel > 0.2) {
      // редкие события мерцания
      if (deskLampFlickerT < 0 && now >= deskLampNextFlickerAt) {
        deskLampFlickerT = 0;
        deskLampNextFlickerAt = now + 2800 + Math.random() * 6500;
      }
      if (deskLampFlickerT >= 0) {
        deskLampFlickerT = Math.min(1, deskLampFlickerT + 0.028);
        const f = deskLampFlickerT;
        // 2–3 мягких провала, без резкого строба
        const dip =
          1 -
          Math.max(0, Math.sin(f * Math.PI * 2.2)) * 0.22 * Math.sin(f * Math.PI) -
          Math.max(0, Math.sin(f * Math.PI * 4.1 + 0.4)) * 0.12 * (1 - f);
        flicker = 0.72 + dip * 0.28;
        // лёгкий «живой» тремор нити
        flicker *= 1 + Math.sin(now * 0.045) * 0.018 + Math.sin(now * 0.11) * 0.01;
        if (f >= 1) deskLampFlickerT = -1;
      } else {
        // едва заметное дыхание света
        flicker = 1 + Math.sin(now * 0.0022) * 0.012 + Math.sin(now * 0.0051) * 0.008;
      }
    }
    paintDeskLamp(deskLampLevel, flicker);
  }

  // лёгкое покачивание пропуска на крючке
  if (!passTaken && passTakeT < 0 && passWorldRoot?.visible) {
    const sway = Math.sin(performance.now() * 0.0018) * 0.06;
    passWorldRoot.rotation.z = sway;
    passWorldRoot.rotation.x = Math.sin(performance.now() * 0.0011) * 0.03;
  }

  // карточка: достали / прикладываем к ридеру
  if (passTakeT >= 0 || passInspectT >= 0 || passPocketT >= 0) {
    /* жесты взятия/кармана уже выше — не мешаем скану */
  } else if (passScanDeny) {
    passScanT = Math.min(1, passScanT + 0.04);
    const e = passScanT;
    // короткий жест к ридеру и назад — отказ
    const swing = e < 0.45 ? e / 0.45 : 1 - (e - 0.45) / 0.55;
    passCard.position.set(0.12 + swing * 0.18, -0.14, -0.55 + swing * 0.12);
    passCard.rotation.set(-0.25, -0.35 + swing * 0.4, -0.08);
    if (e > 0.2 && e < 0.55) {
      readerPadMat.emissive.setHex(0xff3344);
      readerPadMat.emissiveIntensity = Math.sin((e - 0.2) * 10) * 2;
    } else {
      readerPadMat.emissiveIntensity *= 0.8;
    }
    if (e >= 1) {
      passScanDeny = false;
      ledMode = "red";
      setReaderLed(false);
      passAnim = 1;
      passCard.position.set(0.12, -0.16, -0.55);
      passCard.rotation.set(-0.25, -0.35, -0.08);
    }
  } else if (passScanning) {
    passScanT = Math.min(1, passScanT + 0.028);
    const e = passScanT;
    // свайп вправо-вперёд к панели
    passCard.position.set(0.12 + e * 0.28, -0.12 - e * 0.05, -0.55 + e * 0.22);
    passCard.rotation.set(-0.2 + e * 0.35, -0.35 + e * 0.9, -0.08 + e * 0.2);
    passMesh.material.opacity = 1 - Math.max(0, e - 0.7) / 0.3;
    // вспышка на площадке ридера
    if (e > 0.35 && e < 0.75) {
      const flash = Math.sin((e - 0.35) * Math.PI / 0.4);
      readerPadMat.emissive.setHex(0x88ffaa);
      readerPadMat.emissiveIntensity = flash * 2.5;
    } else {
      readerPadMat.emissiveIntensity *= 0.85;
    }
    if (e >= 1) {
      passScanning = false;
      if (doorEventReady) {
        if (!passUnlocked) hostEvent("pass");
        passUnlocked = true;
        setReaderLed(true);
        hidePassCard();
        drawPassCard(vkUser, passPhotoImg);
        sfxUnlock();
      } else {
        hidePassCard();
        setReaderLed(false);
      }
    }
  } else if (passCardOut && passTakeT < 0) {
    passAnim = Math.min(1, passAnim + 0.08);
    const e = 1 - Math.pow(1 - passAnim, 2);
    passCard.position.set(0.12, -0.28 + e * 0.12, -0.55);
    passCard.rotation.set(-0.45 + e * 0.2, -0.45 + e * 0.1, -0.12 + e * 0.04);
  }

  // лампочка: красный → мигание → зелёный / отказ
  if (ledMode === "deny") {
    ledBlinkT += 0.12;
    const on = Math.sin(ledBlinkT * 18) > 0;
    readerLedMat.color.setHex(on ? 0xff2244 : 0x440010);
    readerLedMat.emissive.setHex(on ? 0xff0022 : 0x220008);
    readerLedMat.emissiveIntensity = on ? 4 : 0.5;
    readerGlow.color.setHex(0xff2233);
    readerGlow.intensity = on ? 5 : 0.4;
  } else if (ledMode === "blink") {
    ledBlinkT += 0.09;
    const on = Math.sin(ledBlinkT * 14) > 0;
    if (on) {
      readerLedMat.color.setHex(0xffaa33);
      readerLedMat.emissive.setHex(0xff8800);
      readerLedMat.emissiveIntensity = 3.5;
      readerGlow.color.setHex(0xff9900);
      readerGlow.intensity = 4;
    } else {
      readerLedMat.color.setHex(0x442200);
      readerLedMat.emissive.setHex(0x221100);
      readerLedMat.emissiveIntensity = 0.4;
      readerGlow.intensity = 0.3;
    }
  } else if (ledMode === "green") {
    readerLedMat.emissiveIntensity = 2.6 + Math.sin(performance.now() * 0.006) * 0.6;
    readerGlow.intensity = 2.8 + Math.sin(performance.now() * 0.006) * 0.8;
  } else if (ledMode === "red") {
    readerLedMat.emissiveIntensity = 1.8 + Math.sin(performance.now() * 0.004) * 0.4;
    readerGlow.intensity = 1.4 + Math.sin(performance.now() * 0.004) * 0.4;
  }

  // ручка-рычаг: вниз по Z (как настоящая)
  if (handleTugT >= 0) {
    handleTugT += passDenyKind === "noPass" ? 0.048 : 0.055;
    const t = handleTugT;
    const strong = passDenyKind === "noPass";
    if (t < 0.45) {
      handleAngle = (t / 0.45) * (strong ? 0.48 : 0.35);
    } else if (t < (strong ? 1.55 : 1.35)) {
      const u = (t - 0.45) / (strong ? 1.1 : 0.9);
      const shakeAmp = strong ? 0.11 : 0.06;
      handleAngle =
        (strong ? 0.48 : 0.35) + Math.sin(u * Math.PI * (strong ? 9 : 6)) * shakeAmp * (1 - u);
      if (strong && lobbyDoorPivot) {
        lobbyDoorPivot.rotation.y = Math.sin(u * Math.PI * 10) * 0.012 * (1 - u);
      }
    } else {
      handleAngle *= 0.78;
      if (lobbyDoorPivot && !lobbyOpening && !lobbyDoorOpen) {
        lobbyDoorPivot.rotation.y *= 0.75;
      }
      if (handleAngle < 0.01) {
        handleAngle = 0;
        handleTugT = -1;
        lobbyDoorShake = 0;
        if (lobbyDoorPivot && !lobbyOpening && !lobbyDoorOpen) lobbyDoorPivot.rotation.y = 0;
      }
    }
    lobbyHandlePivot.rotation.z = -handleAngle;
  } else if (handlePullT >= 0 && !lobbyOpening && !lobbyClosing) {
    handlePullT += 0.04;
    const t = Math.min(1, handlePullT);
    // плавно вниз до ~70°
    handleAngle = t * t * (1.15);
    lobbyHandlePivot.rotation.z = -handleAngle;
    if (t >= 1) {
      handlePullT = -1;
      lobbyOpening = true;
      lobbyDoorT = 0;
      sfxDoor();
    }
  } else if (!lobbyOpening && !lobbyClosing) {
    // вернуть рычаг в горизонталь, если дверь ещё закрыта
    if (handleAngle > 0.002 && handlePullT < 0 && handleTugT < 0) {
      handleAngle *= 0.9;
      lobbyHandlePivot.rotation.z = -handleAngle;
    }
  }

  if (gateOpening) {
    // медленно — сначала весь механизм двери, потом переход
    gateOpenT = Math.min(1, gateOpenT + 0.0038);
    const t = gateOpenT;
    const easeOut = 1 - Math.pow(1 - t, 2.4);

    // —— фаза 1: засовы уходят по кругу ——
    const boltPhase = Math.min(1, t / 0.28);
    for (const b of gateBolts) {
      const local = Math.max(0, Math.min(1, boltPhase * gateBolts.length - b.i));
      const k = local * local * (3 - 2 * local);
      b.bolt.position.x = b.lockedX + (b.openX - b.lockedX) * k;
      if (gateLockLeds[b.i]) {
        const on = k > 0.85;
        gateLockLeds[b.i].color.setHex(on ? 0x44ff88 : 0xff3344);
        gateLockLeds[b.i].emissive.setHex(on ? 0x22ff66 : 0xff0022);
        gateLockLeds[b.i].emissiveIntensity = on ? 2.2 : 1.1;
      }
    }

    // —— фаза 2: штурвал + шестерни раскручиваются ——
    const spinPhase = Math.max(0, Math.min(1, (t - 0.08) / 0.35));
    gateWheelSpin = spinPhase * Math.PI * 3.2 + easeOut * Math.PI * 4;
    wheel.rotation.z = gateWheelSpin;

    // —— фаза 3: проворот на месте (снятие с упоров) ——
    const unlockSpin = Math.max(0, Math.min(1, (t - 0.22) / 0.18));
    const unlockAngle = unlockSpin * unlockSpin * Math.PI * 0.55;

    // —— фаза 4: втягивание и закатывание в карман ——
    const pull = Math.max(0, Math.min(1, (t - 0.18) / 0.2));
    const rollT = Math.max(0, (t - 0.32) / 0.68);
    const rollEase = rollT * rollT * (3 - 2 * rollT);
    const rollDist = rollEase * (GATE_DOOR_R * 2.3 + 0.2);

    gateDoorPivot.position.x = rollDist;
    gateDoorPivot.position.y = GATE_CY;
    gateDoorPivot.position.z = GATE_DOOR_Z - pull * 0.18;
    gateDoorPivot.rotation.x = 0;
    gateDoorPivot.rotation.y = 0;
    gateDoorPivot.rotation.z = -unlockAngle - rollDist / GATE_DOOR_R;

    for (const g of gateGears) {
      g.mesh.rotation.z =
        gateDoorPivot.rotation.z * g.ratio * 2.4 + spinPhase * Math.PI * 2 * g.ratio;
    }

    // поршни выдвигаются при закатывании
    if (gatePistonR?.rod) {
      gatePistonR.rod.position.x = 0.15 + rollEase * 0.55;
    }
    if (gatePistonL?.rod) {
      gatePistonL.rod.position.x = -0.15 - Math.min(1, pull * 1.2) * 0.2;
    }

    // сначала полностью показываем механизм двери, в хранилище — только в конце
    if (t > 0.45) peekBlock.visible = false;
    if (t >= 1) {
      gateOpening = false;
      peekBlock.visible = false;
      if (phase !== "vault") enterVault();
    }
  }

  if (camLerp) {
    camLerp.t = Math.min(1, camLerp.t + (camLerp.speed ?? 0.02));
    const e = 1 - Math.pow(1 - camLerp.t, 3);
    camera.position.lerpVectors(camLerp.fromPos, camLerp.toPos, e);
    // кратчайшая интерполяция yaw
    let dy = camLerp.toYaw - camLerp.fromYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    lookYaw = camLerp.fromYaw + dy * e;
    lookPitch = camLerp.fromPitch + (camLerp.toPitch - camLerp.fromPitch) * e;
    camera.rotation.y = lookYaw;
    camera.rotation.x = lookPitch;
    camera.rotation.z = 0;
    if (camLerp.t >= 1) {
      camAnchor.copy(camLerp.toPos);
      const done = camLerp.onDone;
      camLerp = null;
      if (done) done();
      else applyLook();
      updateRoomBackBtn();
    }
  } else if (!lookDragging) {
    camera.position.copy(camAnchor);
  }

  // комната 0 — открытие своей двери ключом
  if (introDoorUnlocking) {
    const d = introDoorUnlocking;
    d.openT = Math.min(1, d.openT + 0.022);
    const e = 1 - Math.pow(1 - d.openT, 2.4);
    d.pivot.rotation.y = -e * 1.55;
    if (d.openT >= 1) {
      d.opening = false;
      d.open = true;
      introDoorUnlocking = null;
      setTimeout(() => enterLobbyFromIntro(false), 280);
    }
  }

  // сейф
  handleTwist += (handleTarget - handleTwist) * 0.12;
  if (handleShake > 0) {
    handleShake *= 0.88;
    safeHandle.rotation.z = handleTwist + Math.sin(performance.now() * 0.08) * 0.05 * handleShake;
  } else {
    safeHandle.rotation.z = handleTwist;
  }
  if (safeOpening) {
    safeOpenT = Math.min(1, safeOpenT + 0.016);
    const e = 1 - Math.pow(1 - safeOpenT, 3);
    safeDoorPivot.rotation.y = -2.0 * e;
    if (safeOpenT >= 1) {
      safeOpening = false;
      const first = !safeOpen;
      if (first) hostEvent("safe");
      safeOpen = true;
      if (first) {
        sfxUnlock();
        setTimeout(() => {
          showFinale(vkUser.name || "Игрок", new Date().toLocaleString("ru-RU"));
        }, 600);
      }
    }
  }

  // ячейки
  cells.forEach((c) => {
    if (c.opening) {
      c.openT = Math.min(1, c.openT + 0.04);
      const e = 1 - Math.pow(1 - c.openT, 2);
      c.door.rotation.y = -e * 1.8;
      c.door.position.x = e * 0.15;
      if (c.openT >= 1) {
        c.opening = false;
        c.open = true;
        c.inside.visible = true;
        onCellOpened(c);
      }
    }
  });

  // глазок: превью на линзе / крупный круглый обзор
  try {
    if (peepholeLooking && focus === "peephole" && phase === "lobby" && !lobbyDoorOpen) {
      updatePeepholeStatus();
      syncPeepholeCam();
      const snap = beginPeepholeScene();
      renderer.render(scene, peepholeCam);
      endPeepholeScene(snap);
    } else {
      renderPeepholeView();
      renderer.render(scene, camera);
    }
  } catch {
    renderer.render(scene, camera);
  }
}

drawBoard();
loop();
window.__safeReady = true;
