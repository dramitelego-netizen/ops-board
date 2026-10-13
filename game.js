/**
 * Многослойный куб-кликер: вращение + клики ломают слои, внутри сундук.
 */

const LAYERS = [
  { name: "Внешний", color: "#22d3ee", hp: 10, size: 100 },
  { name: "Бирюзовый", color: "#2dd4bf", hp: 12, size: 82 },
  { name: "Янтарный", color: "#f97316", hp: 14, size: 64 },
  { name: "Коралловый", color: "#fb7185", hp: 16, size: 48 },
];

const FACE_NAMES = ["front", "back", "right", "left", "top", "bottom"];

const stackEl = document.getElementById("cube-stack");
const worldEl = document.getElementById("world");
const stageEl = document.getElementById("stage");
const fxEl = document.getElementById("fx");
const chestEl = document.getElementById("chest");
const layerLabel = document.getElementById("layer-label");
const hpLabel = document.getElementById("hp-label");
const hintEl = document.getElementById("game-hint");
const winBanner = document.getElementById("win-banner");
const replayBtn = document.getElementById("replay-btn");

let rotX = -22;
let rotY = 32;
let layerIndex = 0;
let hp = LAYERS[0].hp;
let won = false;
let dragging = false;
let moved = false;
let pointerId = null;
let lastX = 0;
let lastY = 0;

function shade(hex, amount) {
  const n = hex.replace("#", "");
  const full =
    n.length === 3
      ? n
          .split("")
          .map((c) => c + c)
          .join("")
      : n;
  const num = parseInt(full, 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 255) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 255) + amount));
  const b = Math.min(255, Math.max(0, (num & 255) + amount));
  return `rgb(${r}, ${g}, ${b})`;
}

function faceStyle(name, half) {
  switch (name) {
    case "front":
      return `translateZ(${half}px)`;
    case "back":
      return `rotateY(180deg) translateZ(${half}px)`;
    case "right":
      return `rotateY(90deg) translateZ(${half}px)`;
    case "left":
      return `rotateY(-90deg) translateZ(${half}px)`;
    case "top":
      return `rotateX(90deg) translateZ(${half}px)`;
    case "bottom":
      return `rotateX(-90deg) translateZ(${half}px)`;
    default:
      return "";
  }
}

function buildLayers() {
  stackEl.innerHTML = "";

  LAYERS.forEach((layer, index) => {
    const el = document.createElement("div");
    el.className = "layer";
    el.dataset.index = String(index);
    el.style.width = `${layer.size}%`;
    el.style.height = `${layer.size}%`;

    FACE_NAMES.forEach((face, fi) => {
      const faceEl = document.createElement("div");
      faceEl.className = `face face-${face}`;
      const tint = shade(layer.color, (fi % 3) * 12 - 18);
      faceEl.style.background = `linear-gradient(145deg, ${shade(layer.color, 28)}, ${tint})`;
      el.appendChild(faceEl);
    });

    stackEl.appendChild(el);
  });

  requestAnimationFrame(applyFaceDepths);
  updateVisibility();
  updateHud();
}

function applyFaceDepths() {
  stackEl.querySelectorAll(".layer").forEach((layerEl) => {
    const size = layerEl.getBoundingClientRect().width;
    const half = size / 2;
    FACE_NAMES.forEach((face) => {
      const faceEl = layerEl.querySelector(`.face-${face}`);
      if (faceEl) faceEl.style.transform = faceStyle(face, half);
    });
  });
}

function applyRotation() {
  worldEl.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
}

function updateVisibility() {
  stackEl.querySelectorAll(".layer").forEach((el) => {
    const i = Number(el.dataset.index);
    el.classList.toggle("is-gone", i < layerIndex);
  });
}

function updateHud() {
  if (won) {
    layerLabel.textContent = "Приз";
    hpLabel.textContent = "готово";
    hintEl.textContent = "Сундук открыт";
    return;
  }
  const layer = LAYERS[layerIndex];
  layerLabel.textContent = `Слой ${layerIndex + 1} / ${LAYERS.length}`;
  hpLabel.textContent = `HP ${hp}`;
  hintEl.textContent = `${layer.name} · крутите и кликайте`;
}

function spawnShards(color) {
  const rect = stageEl.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;

  for (let i = 0; i < 18; i++) {
    const shard = document.createElement("div");
    shard.className = "shard";
    const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.4;
    const dist = 70 + Math.random() * 110;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 20;
    shard.style.left = `${cx - 9}px`;
    shard.style.top = `${cy - 9}px`;
    shard.style.background = shade(color, Math.random() * 40 - 20);
    shard.style.setProperty("--dx", `${dx.toFixed(1)}px`);
    shard.style.setProperty("--dy", `${dy.toFixed(1)}px`);
    shard.style.setProperty("--rot", `${(Math.random() * 240 - 120).toFixed(0)}deg`);
    fxEl.appendChild(shard);
    shard.addEventListener("animationend", () => shard.remove(), { once: true });
  }
}

function flashHit() {
  worldEl.classList.add("is-hit");
  const current = stackEl.querySelector(`.layer[data-index="${layerIndex}"]`);
  if (current) {
    current.classList.remove("is-cracked");
    void current.offsetWidth;
    current.classList.add("is-cracked");
  }
  setTimeout(() => worldEl.classList.remove("is-hit"), 160);
}

function breakLayer() {
  const layer = LAYERS[layerIndex];
  spawnShards(layer.color);
  layerIndex += 1;

  if (layerIndex >= LAYERS.length) {
    win();
    return;
  }

  hp = LAYERS[layerIndex].hp;
  updateVisibility();
  updateHud();
}

function win() {
  won = true;
  updateVisibility();
  stackEl.style.display = "none";
  chestEl.hidden = false;
  requestAnimationFrame(() => chestEl.classList.add("is-open"));
  winBanner.hidden = false;
  updateHud();
}

function hit() {
  if (won) return;
  flashHit();
  hp -= 1;
  if (hp <= 0) breakLayer();
  else updateHud();
}

function resetGame() {
  won = false;
  layerIndex = 0;
  hp = LAYERS[0].hp;
  rotX = -22;
  rotY = 32;
  stackEl.style.display = "";
  chestEl.hidden = true;
  chestEl.classList.remove("is-open");
  winBanner.hidden = true;
  fxEl.innerHTML = "";
  buildLayers();
  applyRotation();
}

function onPointerDown(e) {
  if (won) return;
  pointerId = e.pointerId;
  dragging = true;
  moved = false;
  lastX = e.clientX;
  lastY = e.clientY;
  stageEl.classList.add("is-dragging");
  stageEl.setPointerCapture?.(pointerId);
}

function onPointerMove(e) {
  if (!dragging || e.pointerId !== pointerId) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
  rotY += dx * 0.45;
  rotX -= dy * 0.45;
  rotX = Math.max(-68, Math.min(68, rotX));
  lastX = e.clientX;
  lastY = e.clientY;
  applyRotation();
}

function onPointerUp(e) {
  if (e.pointerId !== pointerId) return;
  const wasDrag = moved;
  dragging = false;
  pointerId = null;
  stageEl.classList.remove("is-dragging");
  if (!wasDrag && !won) hit();
}

stageEl.addEventListener("pointerdown", onPointerDown);
stageEl.addEventListener("pointermove", onPointerMove);
stageEl.addEventListener("pointerup", onPointerUp);
stageEl.addEventListener("pointercancel", onPointerUp);
replayBtn.addEventListener("click", resetGame);
window.addEventListener("resize", applyFaceDepths);

buildLayers();
applyRotation();
