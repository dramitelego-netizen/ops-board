/**
 * FUTURUM Tower — 20 круглых этажей, сундуки, зачары, босс у центральной двери.
 */

const MAX_FLOOR = 20;
const RADIUS = 520; // радиус круглой карты
const CX = 0;
const CY = 0;

const ENCHANTS = {
  none: { id: "none", name: "без чар", color: "#94a3b8", price: 0 },
  burn: { id: "burn", name: "Горение", color: "#f97316", price: 80, desc: "Доп. урон огнём" },
  frost: { id: "frost", name: "Мороз", color: "#67e8f9", price: 90, desc: "Замедляет врагов" },
  storm: { id: "storm", name: "Гроза", color: "#a78bfa", price: 110, desc: "Шанс цепной молнии" },
  vamp: { id: "vamp", name: "Вампиризм", color: "#fb7185", price: 120, desc: "Лечение с урона" },
  sharp: { id: "sharp", name: "Острота", color: "#fde68a", price: 100, desc: "+крит и урон" },
};

const WEAPONS = [
  { id: "sword", name: "Меч", pattern: "slash", dmg: 14, reach: 58, cd: 0.32, color: "#67e8f9", style: "sword", hint: "быстрый удар" },
  { id: "axe", name: "Топор", pattern: "heavy", dmg: 28, reach: 62, cd: 0.62, color: "#fb7185", style: "axe", hint: "сильно, медленно" },
  { id: "bow", name: "Лук", pattern: "bow", dmg: 12, reach: 420, cd: 0.38, color: "#fbbf24", style: "bow", hint: "стрелы дальние" },
  { id: "staff", name: "Посох", pattern: "staff", dmg: 16, reach: 380, cd: 0.48, color: "#22d3ee", style: "staff", hint: "магический шар" },
  { id: "spear", name: "Копьё", pattern: "thrust", dmg: 18, reach: 92, cd: 0.4, color: "#a78bfa", style: "spear", hint: "выпад вперёд" },
  { id: "hammer", name: "Молот", pattern: "slam", dmg: 32, reach: 70, cd: 0.7, color: "#f59e0b", style: "hammer", hint: "удар по площади" },
  { id: "daggers", name: "Клинки", pattern: "dual", dmg: 9, reach: 48, cd: 0.18, color: "#f472b6", style: "dual", hint: "очень быстро" },
  { id: "tome", name: "Гримуар", pattern: "nova_shot", dmg: 11, reach: 300, cd: 0.55, color: "#c084fc", style: "staff", hint: "взрывная руна" },
];

const ABILITIES = [
  { id: "dash", key: "␣", name: "Прыжок", icon: "⬆", cd: 2.6, cls: "dash" },
  { id: "bolt", key: "2", name: "Молния", icon: "⚡", cd: 5.5, cls: "bolt" },
  { id: "nova", key: "3", name: "Круг", icon: "🔥", cd: 7.2, cls: "nova" },
  { id: "rage", key: "4", name: "Ярость", icon: "🩸", cd: 11, cls: "rage" },
];

const isTouchUI = () => matchMedia("(pointer: coarse)").matches;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const ui = {
  boot: document.getElementById("boot"),
  hud: document.getElementById("hud"),
  shop: document.getElementById("shop"),
  dead: document.getElementById("dead"),
  clear: document.getElementById("clear"),
  touch: document.getElementById("touch"),
  name: document.getElementById("player-name"),
  hpBar: document.getElementById("hp-bar"),
  floorChip: document.getElementById("floor-chip"),
  goldChip: document.getElementById("gold-chip"),
  enchantChip: document.getElementById("enchant-chip"),
  weaponName: document.getElementById("weapon-name"),
  weaponMeta: document.getElementById("weapon-meta"),
  doorStatus: document.getElementById("door-status"),
  safeBanner: document.getElementById("safe-banner"),
  weaponRack: document.getElementById("weapon-rack"),
  abilityBar: document.getElementById("ability-bar"),
  toast: document.getElementById("toast"),
  shopList: document.getElementById("shop-list"),
  shopGold: document.getElementById("shop-gold"),
  deadStats: document.getElementById("dead-stats"),
  clearStats: document.getElementById("clear-stats"),
  stick: document.getElementById("stick"),
  stickKnob: document.getElementById("stick-knob"),
};

let W = 0;
let H = 0;
let running = false;
let lastTs = 0;
let toastT = 0;
let shopTab = "enchants";
let cam = { x: 0, y: 0 };
let shake = 0;
let keys = {};
let stick = { x: 0, y: 0 };
let mouse = { x: 0, y: 0, down: false };
let attackHeld = false;

const state = {
  floor: 0, // 0 = hub
  player: null,
  monsters: [],
  boss: null,
  doorOpen: false,
  chests: [],
  shots: [],
  effects: [],
  floats: [],
  rings: [],
  bolts: [],
  time: 0,
};

function rand(a, b) {
  return a + Math.random() * (b - a);
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function toast(t) {
  ui.toast.textContent = t;
  ui.toast.classList.add("is-on");
  clearTimeout(toastT);
  toastT = setTimeout(() => ui.toast.classList.remove("is-on"), 1600);
}
function weaponOf(p) {
  return WEAPONS.find((w) => w.id === p.weaponId) || WEAPONS[0];
}
function enchantOf(p) {
  return ENCHANTS[p.enchant] || ENCHANTS.none;
}
function inCircle(x, y, r = RADIUS) {
  return x * x + y * y <= r * r;
}
function clampToCircle(ent, r = RADIUS - ent.radius) {
  const d = Math.hypot(ent.x, ent.y);
  if (d > r) {
    ent.x = (ent.x / d) * r;
    ent.y = (ent.y / d) * r;
  }
}
function floorScale() {
  return 1 + (state.floor - 1) * 0.12;
}

function resize() {
  W = innerWidth;
  H = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = (W * dpr) | 0;
  canvas.height = (H * dpr) | 0;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function makePlayer(name) {
  return {
    name,
    x: 0,
    y: RADIUS * 0.55,
    aim: -Math.PI / 2,
    facing: 1,
    radius: 14,
    hp: 120,
    maxHp: 120,
    gold: 40,
    weaponId: "sword",
    enchant: "none",
    abilityLvl: { dash: 0, bolt: 0, nova: 0, rage: 0 },
    cds: { dash: 0, bolt: 0, nova: 0, rage: 0 },
    attackCd: 0,
    attackFlash: 0,
    dashT: 0,
    rageT: 0,
    invuln: 0,
    anim: 0,
    moving: false,
    moveAng: -Math.PI / 2,
    jumpY: 0,
    kills: 0,
    trail: [],
  };
}

function spawnPoint(angle, distMul = 0.72) {
  return { x: Math.cos(angle) * RADIUS * distMul, y: Math.sin(angle) * RADIUS * distMul };
}

function makeMonster(kind, x, y, isBoss = false) {
  const scale = floorScale();
  const base = {
    slime: { name: "Слайм", hp: 28, dmg: 6, speed: 70, color: "#4ade80", w: 28, h: 22 },
    wolf: { name: "Волк", hp: 42, dmg: 9, speed: 110, color: "#94a3b8", w: 36, h: 26 },
    skeleton: { name: "Скелет", hp: 55, dmg: 12, speed: 85, color: "#e2e8f0", w: 24, h: 42 },
    brute: { name: "Громила", hp: 95, dmg: 16, speed: 55, color: "#fb7185", w: 40, h: 48 },
  }[kind] || { name: "Тень", hp: 40, dmg: 8, speed: 80, color: "#a78bfa", w: 30, h: 36 };

  const hp = Math.floor(base.hp * scale * (isBoss ? 8 + state.floor * 0.6 : 1));
  return {
    kind,
    name: isBoss ? `Страж ${state.floor} этажа` : base.name,
    x,
    y,
    hp,
    maxHp: hp,
    dmg: Math.floor(base.dmg * scale * (isBoss ? 1.6 : 1)),
    speed: base.speed * (isBoss ? 0.85 : 1),
    color: isBoss ? "#f59e0b" : base.color,
    w: isBoss ? base.w * 1.7 : base.w,
    h: isBoss ? base.h * 1.7 : base.h,
    boss: isBoss,
    alive: true,
    facing: 1,
    attackCd: 0,
    hitFlash: 0,
    slow: 0,
    burn: 0,
    anim: rand(0, 8),
    radius: isBoss ? 28 : 16,
  };
}

function buildHub() {
  state.floor = 0;
  state.monsters = [];
  state.boss = null;
  state.doorOpen = true;
  state.chests = [];
  state.shots = [];
  state.player.x = 0;
  state.player.y = 120;
  state.player.hp = state.player.maxHp;
  ui.safeBanner.hidden = false;
  renderWeaponRack();
  setDoorUI();
  toast("Лагерь башни · выберите оружие и войдите в портал");
}

function buildFloor(n) {
  state.floor = n;
  state.doorOpen = false;
  state.monsters = [];
  state.shots = [];
  state.chests = [];
  ui.safeBanner.hidden = true;
  ui.weaponRack.hidden = true;

  // player at south ring
  state.player.x = 0;
  state.player.y = RADIUS * 0.62;
  state.player.invuln = 1.2;

  const count = 6 + Math.min(14, n * 1.2);
  const kinds = ["slime", "wolf", "skeleton", "brute"];
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const d = rand(RADIUS * 0.28, RADIUS * 0.78);
    const p = { x: Math.cos(a) * d, y: Math.sin(a) * d };
    if (Math.hypot(p.x, p.y) < 110) continue; // keep center for boss/door
    const kind = kinds[Math.min(kinds.length - 1, (Math.random() * Math.min(4, 1 + n / 5)) | 0)];
    state.monsters.push(makeMonster(kind, p.x, p.y, false));
  }

  // chests around the ring
  const chestN = 2 + Math.min(4, (n / 4) | 0);
  for (let i = 0; i < chestN; i++) {
    const a = (Math.PI * 2 * i) / chestN + rand(-0.2, 0.2);
    const d = RADIUS * 0.55;
    state.chests.push({
      x: Math.cos(a) * d,
      y: Math.sin(a) * d,
      open: false,
      bob: rand(0, 5),
    });
  }

  // boss near center door (slightly offset)
  const bossKinds = ["brute", "skeleton", "wolf", "brute"];
  const bk = bossKinds[Math.min(bossKinds.length - 1, (n / 5) | 0)];
  state.boss = makeMonster(bk, 55, -20, true);
  state.monsters.push(state.boss);

  setDoorUI();
  toast(`Этаж ${n} · убейте стража у двери`);
}

function setDoorUI() {
  if (state.floor === 0) {
    ui.doorStatus.textContent = "портал на 1 этаж открыт · подойдите к центру (F)";
    ui.doorStatus.classList.add("is-open");
    return;
  }
  if (state.doorOpen) {
    ui.doorStatus.textContent =
      state.floor >= MAX_FLOOR ? "выход открыт" : `дверь открыта · этаж ${state.floor + 1} (F)`;
    ui.doorStatus.classList.add("is-open");
  } else {
    ui.doorStatus.textContent = "дверь закрыта · убейте босса этажа";
    ui.doorStatus.classList.remove("is-open");
  }
}

function renderWeaponRack() {
  ui.weaponRack.hidden = false;
  ui.weaponRack.innerHTML = WEAPONS.map((w) => {
    const on = state.player.weaponId === w.id ? "is-on" : "";
    return `<button type="button" class="${on}" data-w="${w.id}"><strong>${w.name}</strong>${w.hint}</button>`;
  }).join("");
  ui.weaponRack.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      state.player.weaponId = btn.dataset.w;
      toast(`Оружие: ${weaponOf(state.player).name}`);
      renderWeaponRack();
      updateHud();
    };
  });
}

function floatText(x, y, text, color) {
  state.floats.push({ x, y, text, color, life: 0.85, vy: -55 });
}
function burst(x, y, color, n = 10, spd = 160) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(spd * 0.4, spd);
    state.effects.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20, life: rand(0.2, 0.6), color, r: rand(2, 5) });
  }
}
function ring(x, y, color, maxR, life = 0.4) {
  state.rings.push({ x, y, color, r: 6, maxR, life, maxLife: life });
}

function applyEnchantOnHit(m, dmg) {
  const p = state.player;
  const e = p.enchant;
  if (e === "burn") {
    m.burn = Math.max(m.burn, 2.2);
    dmg = Math.floor(dmg * 1.12);
  }
  if (e === "frost") {
    m.slow = Math.max(m.slow, 1.8);
    dmg = Math.floor(dmg * 1.05);
  }
  if (e === "sharp") {
    if (Math.random() < 0.28) {
      dmg = Math.floor(dmg * 1.9);
      floatText(m.x, m.y - m.h, "CRIT", "#fde68a");
    } else dmg = Math.floor(dmg * 1.1);
  }
  if (e === "vamp") {
    p.hp = Math.min(p.maxHp, p.hp + Math.max(1, Math.floor(dmg * 0.12)));
  }
  if (e === "storm" && Math.random() < 0.25) {
    const others = state.monsters.filter((o) => o.alive && o !== m && dist(o, m) < 140).slice(0, 2);
    for (const o of others) {
      state.bolts.push({ x1: m.x, y1: m.y - 20, x2: o.x, y2: o.y - 20, life: 0.22 });
      hurt(o, Math.floor(dmg * 0.45), false);
    }
  }
  return dmg;
}

function hurt(m, dmg, fromPlayer = true) {
  if (!m.alive) return;
  if (fromPlayer) dmg = applyEnchantOnHit(m, dmg);
  if (state.player.rageT > 0 && fromPlayer) dmg = Math.floor(dmg * 1.3);
  m.hp -= dmg;
  m.hitFlash = 0.15;
  floatText(m.x, m.y - m.h * 0.6, String(dmg), enchantOf(state.player).color);
  burst(m.x, m.y - 20, m.color, 6, 140);
  if (m.hp <= 0) kill(m);
}

function kill(m) {
  if (!m.alive) return;
  m.alive = false;
  const gold = m.boss ? 25 + state.floor * 4 : 3 + state.floor;
  state.player.gold += gold;
  state.player.kills += 1;
  burst(m.x, m.y - 20, m.color, m.boss ? 24 : 12, 220);
  ring(m.x, m.y, m.color, m.boss ? 120 : 50, 0.45);
  shake = Math.max(shake, m.boss ? 10 : 3);
  toast(`${m.name} ✦ +${gold}◆`);

  if (m.boss) {
    state.doorOpen = true;
    setDoorUI();
    toast("Дверь открыта! Подойдите к центру (F)");
    ring(0, 0, "#4ade80", 100, 0.8);
  }
}

function tryAttack() {
  const p = state.player;
  if (!p || p.attackCd > 0) return;
  const w = weaponOf(p);
  p.attackCd = w.cd * (p.rageT > 0 ? 0.72 : 1);
  p.attackFlash = 0.2;
  const dmg = w.dmg + Math.floor(state.floor * 1.2);
  const ang = p.aim;
  const fx = Math.cos(ang);
  const fy = Math.sin(ang);

  if (w.pattern === "bow") {
    state.shots.push({
      x: p.x + fx * 20,
      y: p.y + fy * 20,
      vx: fx * 520,
      vy: fy * 520,
      life: 1.1,
      dmg,
      color: w.color,
      r: 4,
      kind: "arrow",
    });
    return;
  }
  if (w.pattern === "staff") {
    state.shots.push({
      x: p.x + fx * 18,
      y: p.y + fy * 18,
      vx: fx * 380,
      vy: fy * 380,
      life: 1.2,
      dmg,
      color: w.color,
      r: 7,
      kind: "orb",
      pierce: 1,
    });
    ring(p.x, p.y, w.color, 40, 0.2);
    return;
  }
  if (w.pattern === "nova_shot") {
    state.shots.push({
      x: p.x + fx * 16,
      y: p.y + fy * 16,
      vx: fx * 300,
      vy: fy * 300,
      life: 1.0,
      dmg,
      color: w.color,
      r: 8,
      kind: "rune",
      explode: 70,
    });
    return;
  }

  // melee patterns
  let hits = 0;
  for (const m of state.monsters) {
    if (!m.alive) continue;
    const dx = m.x - p.x;
    const dy = m.y - p.y;
    const d = Math.hypot(dx, dy);
    const to = Math.atan2(dy, dx);
    let ad = Math.abs(Math.atan2(Math.sin(to - ang), Math.cos(to - ang)));

    if (w.pattern === "slash" || w.pattern === "dual") {
      if (d < w.reach && ad < 1.1) {
        hurt(m, dmg);
        m.x += fx * 12;
        m.y += fy * 12;
        hits++;
      }
    } else if (w.pattern === "heavy") {
      if (d < w.reach && ad < 0.9) {
        hurt(m, dmg);
        m.x += fx * 26;
        m.y += fy * 26;
        hits++;
        shake = Math.max(shake, 5);
      }
    } else if (w.pattern === "thrust") {
      // narrow long
      if (d < w.reach && ad < 0.35) {
        hurt(m, dmg);
        m.x += fx * 20;
        m.y += fy * 20;
        hits++;
      }
    } else if (w.pattern === "slam") {
      if (d < w.reach) {
        hurt(m, dmg);
        hits++;
      }
    }
  }
  if (w.pattern === "slam") ring(p.x, p.y, w.color, w.reach, 0.3);
  else ring(p.x + fx * 24, p.y + fy * 24, w.color, 36, 0.2);
  if (w.pattern === "dual" && hits) {
    // second tick
    setTimeout(() => {
      if (!running) return;
      for (const m of state.monsters) {
        if (!m.alive) continue;
        if (dist(m, p) < w.reach && Math.abs(Math.atan2(m.y - p.y, m.x - p.x) - p.aim) < 1.2) hurt(m, Math.floor(dmg * 0.7));
      }
    }, 90);
  }
}

function abilityCd(p, id) {
  const base = ABILITIES.find((a) => a.id === id).cd;
  return base * Math.pow(0.86, p.abilityLvl[id] || 0);
}

function useAbility(id) {
  const p = state.player;
  if (!p || (p.cds[id] || 0) > 0) return;
  p.cds[id] = abilityCd(p, id);
  const pow = 1 + (p.abilityLvl[id] || 0) * 0.14;

  if (id === "dash") {
    const ang = p.moving ? p.moveAng : p.aim;
    const jumpDist = 130 + (p.abilityLvl.dash || 0) * 18;
    p.dashT = 0.24;
    p.invuln = 0.3;
    p.jumpY = 36;
    p.x += Math.cos(ang) * jumpDist;
    p.y += Math.sin(ang) * jumpDist;
    clampToCircle(p);
    burst(p.x, p.y, "#67e8f9", 14, 120);
    ring(p.x, p.y, "#67e8f9", 55, 0.3);
    toast("⬆ Прыжок");
  }
  if (id === "bolt") {
    const targets = state.monsters.filter((m) => m.alive && dist(m, p) < 280).sort((a, b) => dist(a, p) - dist(b, p)).slice(0, 4 + (p.abilityLvl.bolt || 0));
    let prev = { x: p.x, y: p.y - 30 };
    for (const m of targets) {
      state.bolts.push({ x1: prev.x, y1: prev.y, x2: m.x, y2: m.y - 20, life: 0.25 });
      hurt(m, Math.floor(26 * pow));
      prev = { x: m.x, y: m.y - 20 };
    }
    toast("⚡ Молния");
  }
  if (id === "nova") {
    ring(p.x, p.y, "#f97316", 150, 0.5);
    for (const m of state.monsters) if (m.alive && dist(m, p) < 150) hurt(m, Math.floor(34 * pow));
    toast("🔥 Круг");
  }
  if (id === "rage") {
    p.rageT = 5.5 + (p.abilityLvl.rage || 0) * 0.7;
    p.hp = Math.min(p.maxHp, p.hp + 20);
    toast("🩸 Ярость");
  }
  renderAbilities();
}

function openChest(c) {
  if (c.open) return;
  c.open = true;
  const roll = Math.random();
  const p = state.player;
  if (roll < 0.45) {
    const g = 12 + state.floor * 3 + ((Math.random() * 15) | 0);
    p.gold += g;
    toast(`Сундук · +${g}◆`);
  } else if (roll < 0.7) {
    p.hp = Math.min(p.maxHp, p.hp + 35);
    toast("Сундук · зелье +35 HP");
  } else {
    const list = ["burn", "frost", "storm", "vamp", "sharp"];
    const e = list[(Math.random() * list.length) | 0];
    p.enchant = e;
    toast(`Сундук · зачар «${ENCHANTS[e].name}»!`);
    ring(c.x, c.y, ENCHANTS[e].color, 80, 0.5);
  }
  burst(c.x, c.y, "#fbbf24", 14, 160);
  updateHud();
}

function tryInteract() {
  const p = state.player;
  // chests
  for (const c of state.chests) {
    if (!c.open && dist(p, c) < 42) {
      openChest(c);
      return;
    }
  }
  // door / portal at center
  if (Math.hypot(p.x, p.y) < 70) {
    if (state.floor === 0 || state.doorOpen) {
      if (state.floor >= MAX_FLOOR) {
        winTower();
        return;
      }
      buildFloor(state.floor + 1);
      updateHud();
      return;
    }
    toast("Сначала убейте босса этажа");
  }
}

function winTower() {
  running = false;
  ui.clear.hidden = false;
  ui.clearStats.textContent = `Все 20 этажей · убийств ${state.player.kills} · золото ${state.player.gold}`;
}

function cycleWeapon(dir) {
  const ids = WEAPONS.map((w) => w.id);
  let i = ids.indexOf(state.player.weaponId);
  i = (i + dir + ids.length) % ids.length;
  state.player.weaponId = ids[i];
  toast(weaponOf(state.player).name);
  if (state.floor === 0) renderWeaponRack();
  updateHud();
}

function updateMonster(m, dt) {
  if (!m.alive) return;
  m.anim += dt;
  m.hitFlash = Math.max(0, m.hitFlash - dt);
  m.attackCd = Math.max(0, m.attackCd - dt);
  m.slow = Math.max(0, m.slow - dt);
  if (m.burn > 0) {
    m.burn -= dt;
    if (((state.time * 4) | 0) !== (((state.time - dt) * 4) | 0)) {
      m.hp -= Math.max(1, (2 + state.floor / 3) | 0);
      if (m.hp <= 0) kill(m);
    }
  }
  const p = state.player;
  // don't enter very center until engaged; boss stays near door
  const spd = m.speed * (m.slow > 0 ? 0.45 : 1) * dt;
  const d = dist(m, p);
  if (d < (m.boss ? 460 : 280)) {
    const ang = Math.atan2(p.y - m.y, p.x - m.x);
    m.facing = Math.cos(ang) >= 0 ? 1 : -1;
    if (d > 36) {
      m.x += Math.cos(ang) * spd;
      m.y += Math.sin(ang) * spd * 0.9;
    } else if (m.attackCd <= 0 && p.invuln <= 0) {
      m.attackCd = m.boss ? 1.05 : 0.75;
      p.hp -= m.dmg;
      p.invuln = 0.4;
      floatText(p.x, p.y - 40, `-${m.dmg}`, "#fb7185");
      shake = Math.max(shake, 5);
      if (p.hp <= 0) onDead();
    }
  }
  clampToCircle(m, RADIUS - 20);
  // keep non-boss a bit out of exact door if far
  if (!m.boss && Math.hypot(m.x, m.y) < 50) {
    const a = Math.atan2(m.y, m.x) || 0;
    m.x = Math.cos(a) * 70;
    m.y = Math.sin(a) * 70;
  }
}

function onDead() {
  running = false;
  ui.dead.hidden = false;
  ui.deadStats.textContent = `Этаж ${state.floor} · убийств ${state.player.kills} · золото ${state.player.gold}`;
}

function update(dt) {
  state.time += dt;
  shake = Math.max(0, shake - dt * 18);
  const p = state.player;
  if (!p) return;

  p.attackCd = Math.max(0, p.attackCd - dt);
  p.attackFlash = Math.max(0, p.attackFlash - dt);
  p.dashT = Math.max(0, p.dashT - dt);
  p.rageT = Math.max(0, p.rageT - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.jumpY = Math.max(0, p.jumpY - dt * 110);
  for (const k of Object.keys(p.cds)) p.cds[k] = Math.max(0, p.cds[k] - dt);

  let mx = 0;
  let my = 0;
  if (keys.w || keys.ц || keys.arrowup) my -= 1;
  if (keys.s || keys.ы || keys.arrowdown) my += 1;
  if (keys.a || keys.ф || keys.arrowleft) mx -= 1;
  if (keys.d || keys.в || keys.arrowright) mx += 1;
  mx += stick.x;
  my += stick.y;
  const len = Math.hypot(mx, my);
  p.moving = len > 0.08;
  p.anim += dt * (p.moving ? 11 : 2.2);
  if (p.moving) {
    p.moveAng = Math.atan2(my, mx);
    const sp = 195 * (p.dashT > 0 ? 2.5 : 1) * (p.rageT > 0 ? 1.2 : 1);
    p.x += (mx / len) * sp * dt;
    p.y += (my / len) * sp * dt;
    clampToCircle(p);
    p.trail.push({ x: p.x, y: p.y, life: 0.28 });
    if (p.trail.length > 12) p.trail.shift();
  }

  // PC: aim with mouse. Mobile: aim with stick / last move
  if (isTouchUI()) {
    if (Math.hypot(stick.x, stick.y) > 0.15) p.aim = Math.atan2(stick.y, stick.x);
    else if (p.moving) p.aim = p.moveAng;
  } else {
    const worldMx = mouse.x + cam.x;
    const worldMy = mouse.y + cam.y;
    p.aim = Math.atan2(worldMy - p.y, worldMx - p.x);
  }
  p.facing = Math.cos(p.aim) >= 0 ? 1 : -1;
  for (const t of p.trail) t.life -= dt;
  p.trail = p.trail.filter((t) => t.life > 0);

  if ((attackHeld || mouse.down) && ui.shop.hidden) tryAttack();

  for (const m of state.monsters) updateMonster(m, dt);

  // shots
  for (const s of state.shots) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    for (const m of state.monsters) {
      if (!m.alive) continue;
      if (dist(s, m) < m.radius + s.r) {
        hurt(m, s.dmg);
        if (s.explode) {
          ring(s.x, s.y, s.color, s.explode, 0.35);
          for (const o of state.monsters) if (o.alive && dist(o, s) < s.explode) hurt(o, Math.floor(s.dmg * 0.6));
          s.life = 0;
        } else if (s.pierce) {
          s.pierce -= 1;
          if (s.pierce < 0) s.life = 0;
        } else s.life = 0;
        break;
      }
    }
    if (!inCircle(s.x, s.y, RADIUS - 8)) s.life = 0;
  }
  state.shots = state.shots.filter((s) => s.life > 0);

  for (const e of state.effects) {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.life -= dt;
  }
  state.effects = state.effects.filter((e) => e.life > 0);
  for (const f of state.floats) {
    f.y += f.vy * dt;
    f.life -= dt;
  }
  state.floats = state.floats.filter((f) => f.life > 0);
  for (const r of state.rings) {
    r.life -= dt;
    r.r = 6 + (r.maxR - 6) * (1 - r.life / r.maxLife);
  }
  state.rings = state.rings.filter((r) => r.life > 0);
  for (const b of state.bolts) b.life -= dt;
  state.bolts = state.bolts.filter((b) => b.life > 0);

  // auto pickup near chests prompt via door status already; interact F

  cam.x = p.x - W / 2 + (Math.random() - 0.5) * shake;
  cam.y = p.y - H * 0.58 + (Math.random() - 0.5) * shake;
  updateHud();
  renderAbilities();
}

function updateHud() {
  const p = state.player;
  ui.hpBar.style.transform = `scaleX(${clamp(p.hp / p.maxHp, 0, 1)})`;
  ui.floorChip.textContent = state.floor === 0 ? "Лагерь" : `Этаж ${state.floor}/${MAX_FLOOR}`;
  ui.goldChip.textContent = `◆ ${p.gold}`;
  const en = enchantOf(p);
  ui.enchantChip.textContent = en.name;
  ui.enchantChip.style.borderColor = en.color;
  ui.enchantChip.style.color = en.color;
  const w = weaponOf(p);
  ui.weaponName.textContent = w.name;
  ui.weaponMeta.textContent = `${w.hint} · ${w.pattern}`;
}

function renderAbilities() {
  const p = state.player;
  if (!p) return;
  ui.abilityBar.innerHTML = ABILITIES.map((a) => {
    const cd = p.cds[a.id] || 0;
    const max = abilityCd(p, a.id);
    const pct = cd > 0 ? (cd / max) * 100 : 0;
    return `<button type="button" class="ability-slot ${a.cls} ${cd <= 0 ? "is-ready" : ""}" data-ability="${a.id}">
      <span class="key">${a.key}</span><span class="icon">${a.icon}</span><span>${a.name}</span>
      <i class="cd-mask" style="height:${pct}%"></i></button>`;
  }).join("");
  ui.abilityBar.querySelectorAll("[data-ability]").forEach((b) => {
    b.onclick = () => useAbility(b.dataset.ability);
  });
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawWeapon(wpn, f, swing) {
  ctx.save();
  ctx.translate(10 * f, -8);
  ctx.rotate(f * (-0.5 + swing * 1.9));
  ctx.shadowColor = wpn.color;
  ctx.shadowBlur = 8;
  ctx.fillStyle = wpn.color;
  if (wpn.style === "bow") {
    ctx.strokeStyle = wpn.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(18, 0, 16, -1.2, 1.2);
    ctx.stroke();
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(4, -1, 22, 2);
  } else if (wpn.style === "axe") {
    ctx.fillStyle = "#78716c";
    ctx.fillRect(0, -2, 26, 4);
    ctx.fillStyle = wpn.color;
    ctx.beginPath();
    ctx.arc(28, 0, 13, -1.1, 1.1);
    ctx.lineTo(28, 0);
    ctx.fill();
  } else if (wpn.style === "spear") {
    ctx.fillStyle = "#a8a29e";
    ctx.fillRect(0, -1.5, 50, 3);
    ctx.fillStyle = wpn.color;
    ctx.beginPath();
    ctx.moveTo(50, -5);
    ctx.lineTo(62, 0);
    ctx.lineTo(50, 5);
    ctx.fill();
  } else if (wpn.style === "hammer") {
    ctx.fillStyle = "#a8a29e";
    ctx.fillRect(0, -2, 24, 4);
    ctx.fillStyle = wpn.color;
    roundRect(20, -11, 20, 22, 3);
    ctx.fill();
  } else if (wpn.style === "dual") {
    ctx.fillRect(0, -2, 28, 4);
    ctx.globalAlpha = 0.7;
    ctx.fillRect(2, 5, 22, 3);
    ctx.globalAlpha = 1;
  } else if (wpn.style === "staff") {
    ctx.fillStyle = "#a8a29e";
    ctx.fillRect(0, -2, 40, 4);
    ctx.fillStyle = wpn.color;
    ctx.beginPath();
    ctx.arc(44, 0, 8, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillRect(0, -3, 36, 6);
    ctx.beginPath();
    ctx.moveTo(36, -4);
    ctx.lineTo(46, 0);
    ctx.lineTo(36, 4);
    ctx.fill();
  }
  ctx.fillStyle = "#fbbf24";
  ctx.fillRect(-4, -5, 8, 10);
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawHero(p) {
  const x = p.x - cam.x;
  const y = p.y - cam.y - (p.jumpY || 0);
  const f = p.facing;
  const wpn = weaponOf(p);
  const bob = p.moving ? Math.sin(p.anim) * 3 : Math.sin(state.time * 2.2);
  const leg = p.moving ? Math.sin(p.anim) * 9 : 0;
  const swing = p.attackFlash > 0 ? (0.2 - p.attackFlash) / 0.2 : 0;

  for (const t of p.trail) {
    ctx.globalAlpha = t.life * 0.4;
    ctx.fillStyle = "#67e8f9";
    ctx.beginPath();
    ctx.ellipse(t.x - cam.x, t.y - cam.y, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(x, y + bob - 4);
  if (p.invuln > 0 && ((state.time * 20) | 0) % 2 === 0) ctx.globalAlpha = 0.4;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 8, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // cape
  ctx.fillStyle = "#0e7490";
  ctx.beginPath();
  ctx.moveTo(-4 * f, -18);
  ctx.quadraticCurveTo(-24 * f, 0, -18 * f, 16 + Math.sin(p.anim) * 3);
  ctx.lineTo(-2 * f, 8);
  ctx.fill();

  ctx.fillStyle = "#1e293b";
  ctx.fillRect(-8, 10, 6, 14);
  ctx.fillRect(2, 10, 6, 14);
  ctx.save();
  ctx.translate(-5, 12);
  ctx.rotate((leg * Math.PI) / 160);
  ctx.fillRect(-3, 0, 6, 14);
  ctx.restore();

  const g = ctx.createLinearGradient(-12, -28, 12, 10);
  g.addColorStop(0, "#a5f3fc");
  g.addColorStop(1, "#0e7490");
  ctx.fillStyle = g;
  roundRect(-12, -26, 24, 36, 8);
  ctx.fill();
  ctx.fillStyle = "#f97316";
  ctx.fillRect(-12, -2, 24, 6);
  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(0, -38, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(-2 * f, -44, 9, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#22d3ee";
  ctx.beginPath();
  ctx.arc(5 * f, -38, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(8 * f, -10);
  ctx.rotate(p.attackFlash > 0 ? f * (-0.8 + swing * 2.2) : f * 0.2);
  ctx.fillStyle = "#fde68a";
  ctx.fillRect(-3, 0, 6, 14);
  ctx.translate(0, 12);
  drawWeapon(wpn, f, swing);
  ctx.restore();
  ctx.restore();

  ctx.fillStyle = "#67e8f9";
  ctx.font = "700 12px Chakra Petch, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(p.name, x, y - 66);
}

function drawMonster(m) {
  if (!m.alive) return;
  const x = m.x - cam.x;
  const y = m.y - cam.y;
  const bob = Math.sin(m.anim * 4) * 2;
  ctx.save();
  ctx.translate(x, y + bob);
  if (m.hitFlash > 0) ctx.filter = "brightness(2)";
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(0, 6, m.w * 0.4, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (m.boss) {
    ctx.strokeStyle = "rgba(251,191,36,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -m.h * 0.4, m.w * 0.7, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = m.color;
  roundRect(-m.w * 0.3, -m.h * 0.75, m.w * 0.6, m.h * 0.55, 6);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -m.h * 0.85, m.boss ? 16 : 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.filter = "none";
  ctx.restore();
  const bw = Math.max(28, m.w);
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(x - bw / 2, y - m.h - 14, bw, 5);
  ctx.fillStyle = m.boss ? "#fbbf24" : "#fb7185";
  ctx.fillRect(x - bw / 2, y - m.h - 14, bw * clamp(m.hp / m.maxHp, 0, 1), 5);
  ctx.fillStyle = m.boss ? "#fde68a" : "#e2e8f0";
  ctx.font = m.boss ? "700 11px Orbitron, sans-serif" : "600 10px Manrope, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(m.name, x, y - m.h - 18);
}

function draw() {
  ctx.fillStyle = "#070b12";
  ctx.fillRect(0, 0, W, H);

  // circular floor
  const gx = CX - cam.x;
  const gy = CY - cam.y;
  ctx.beginPath();
  ctx.arc(gx, gy, RADIUS, 0, Math.PI * 2);
  const floorGrad = ctx.createRadialGradient(gx, gy, 40, gx, gy, RADIUS);
  floorGrad.addColorStop(0, state.floor === 0 ? "#14532d" : "#1e293b");
  floorGrad.addColorStop(0.55, state.floor === 0 ? "#166534" : "#0f172a");
  floorGrad.addColorStop(1, "#020617");
  ctx.fillStyle = floorGrad;
  ctx.fill();
  ctx.strokeStyle = state.doorOpen || state.floor === 0 ? "rgba(74,222,128,0.55)" : "rgba(251,113,133,0.35)";
  ctx.lineWidth = 4;
  ctx.stroke();

  // grid rings
  ctx.strokeStyle = "rgba(103,232,249,0.06)";
  ctx.lineWidth = 1;
  for (let r = 100; r < RADIUS; r += 100) {
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // door in center
  const doorOpen = state.floor === 0 || state.doorOpen;
  ctx.save();
  ctx.translate(gx, gy);
  ctx.fillStyle = doorOpen ? "rgba(74,222,128,0.25)" : "rgba(127,29,29,0.45)";
  roundRect(-28, -40, 56, 80, 10);
  ctx.fill();
  ctx.strokeStyle = doorOpen ? "#4ade80" : "#fb7185";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = doorOpen ? "#bbf7d0" : "#fecaca";
  ctx.font = "700 10px Chakra Petch, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(doorOpen ? "ДВЕРЬ" : "ЗАПЕРТО", 0, 4);
  if (doorOpen) {
    ctx.strokeStyle = `rgba(74,222,128,${0.35 + Math.sin(state.time * 4) * 0.2})`;
    ctx.beginPath();
    ctx.arc(0, 0, 48 + Math.sin(state.time * 3) * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // chests
  for (const c of state.chests) {
    const x = c.x - cam.x;
    const y = c.y - cam.y + Math.sin(state.time * 3 + c.bob) * 3;
    ctx.fillStyle = c.open ? "#44403c" : "#b45309";
    ctx.fillRect(x - 14, y - 10, 28, 20);
    ctx.fillStyle = c.open ? "#78716c" : "#fbbf24";
    ctx.fillRect(x - 14, y - 16, 28, 8);
    if (!c.open) {
      ctx.fillStyle = "#fde68a";
      ctx.font = "700 9px Chakra Petch, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("F", x, y - 22);
    }
  }

  const sprites = [];
  for (const m of state.monsters) if (m.alive) sprites.push({ y: m.y, draw: () => drawMonster(m) });
  if (state.player) sprites.push({ y: state.player.y, draw: () => drawHero(state.player) });
  sprites.sort((a, b) => a.y - b.y);
  for (const s of sprites) s.draw();

  // shots
  for (const s of state.shots) {
    ctx.fillStyle = s.color;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(s.x - cam.x, s.y - cam.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  for (const r of state.rings) {
    ctx.globalAlpha = clamp(r.life / r.maxLife, 0, 1);
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(r.x - cam.x, r.y - cam.y, r.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const b of state.bolts) {
    ctx.strokeStyle = `rgba(196,181,253,${b.life * 3})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x1 - cam.x, b.y1 - cam.y);
    ctx.lineTo(b.x2 - cam.x, b.y2 - cam.y);
    ctx.stroke();
  }
  for (const e of state.effects) {
    ctx.globalAlpha = clamp(e.life * 2, 0, 1);
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x - cam.x, e.y - cam.y, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  for (const f of state.floats) {
    ctx.globalAlpha = clamp(f.life * 1.5, 0, 1);
    ctx.fillStyle = f.color;
    ctx.font = "700 13px Chakra Petch, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(f.text, f.x - cam.x, f.y - cam.y);
    ctx.globalAlpha = 1;
  }
}

function loop(ts) {
  const dt = Math.min(0.033, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  if (running) update(dt);
  if (running || state.player) draw();
  else {
    ctx.fillStyle = "#05080e";
    ctx.fillRect(0, 0, W, H);
  }
  requestAnimationFrame(loop);
}

function renderShop() {
  const p = state.player;
  ui.shopGold.textContent = String(p.gold);
  ui.shopList.innerHTML = "";
  if (shopTab === "enchants") {
    for (const e of Object.values(ENCHANTS)) {
      if (e.id === "none") continue;
      const row = document.createElement("div");
      row.className = "shop-item";
      row.innerHTML = `<div><h3 style="color:${e.color}">${e.name}</h3><p>${e.desc}</p></div>`;
      const btn = document.createElement("button");
      btn.className = "shop-buy";
      btn.textContent = p.enchant === e.id ? "Надето" : `${e.price} ◆`;
      btn.disabled = p.enchant === e.id || p.gold < e.price;
      btn.onclick = () => {
        if (p.gold < e.price) return;
        p.gold -= e.price;
        p.enchant = e.id;
        toast(`Зачар: ${e.name}`);
        renderShop();
        updateHud();
      };
      row.appendChild(btn);
      ui.shopList.appendChild(row);
    }
  }
  if (shopTab === "skills") {
    for (const a of ABILITIES) {
      const lvl = p.abilityLvl[a.id] || 0;
      const cost = 40 + lvl * 50;
      const row = document.createElement("div");
      row.className = "shop-item";
      row.innerHTML = `<div><h3>${a.icon} ${a.name} · ${lvl}/5</h3><p>Меньше откат, сильнее эффект</p></div>`;
      const btn = document.createElement("button");
      btn.className = "shop-buy";
      btn.textContent = lvl >= 5 ? "MAX" : `${cost} ◆`;
      btn.disabled = lvl >= 5 || p.gold < cost;
      btn.onclick = () => {
        if (lvl >= 5 || p.gold < cost) return;
        p.gold -= cost;
        p.abilityLvl[a.id] = lvl + 1;
        toast(`${a.name} ур.${lvl + 1}`);
        renderShop();
        renderAbilities();
      };
      row.appendChild(btn);
      ui.shopList.appendChild(row);
    }
  }
  if (shopTab === "items") {
    for (const it of [
      { name: "Большое зелье", cost: 25, fn: () => (p.hp = Math.min(p.maxHp, p.hp + 60)) },
      { name: "+20 макс HP", cost: 70, fn: () => { p.maxHp += 20; p.hp += 20; } },
    ]) {
      const row = document.createElement("div");
      row.className = "shop-item";
      row.innerHTML = `<div><h3>${it.name}</h3></div>`;
      const btn = document.createElement("button");
      btn.className = "shop-buy";
      btn.textContent = `${it.cost} ◆`;
      btn.disabled = p.gold < it.cost;
      btn.onclick = () => {
        if (p.gold < it.cost) return;
        p.gold -= it.cost;
        it.fn();
        renderShop();
        updateHud();
      };
      row.appendChild(btn);
      ui.shopList.appendChild(row);
    }
  }
}

function startGame() {
  state.player = makePlayer((ui.name.value || "Странник").trim().slice(0, 14));
  buildHub();
  ui.boot.hidden = true;
  ui.dead.hidden = true;
  ui.clear.hidden = true;
  ui.hud.hidden = false;
  ui.shop.hidden = true;
  if (isTouchUI()) ui.touch.hidden = false;
  running = true;
  updateHud();
  renderAbilities();
}

function respawn() {
  const name = state.player.name;
  const gold = Math.floor(state.player.gold * 0.5);
  const enchant = state.player.enchant;
  const abilityLvl = { ...state.player.abilityLvl };
  const weaponId = state.player.weaponId;
  state.player = makePlayer(name);
  state.player.gold = gold;
  state.player.enchant = enchant;
  state.player.abilityLvl = abilityLvl;
  state.player.weaponId = weaponId;
  ui.dead.hidden = true;
  ui.clear.hidden = true;
  buildHub();
  running = true;
  updateHud();
}

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (["w", "a", "s", "d", "ц", "ф", "ы", "в", " "].includes(k) || e.code === "Space") e.preventDefault();
  if (e.code === "Space") {
    useAbility("dash"); // прыжок на ПК
    return;
  }
  if (k === "f") tryInteract();
  if (k === "q") cycleWeapon(-1);
  if (k === "e") cycleWeapon(1);
  if (k === "b") {
    ui.shop.hidden = !ui.shop.hidden;
    if (!ui.shop.hidden) renderShop();
  }
  if (k === "1") useAbility("dash");
  if (k === "2") useAbility("bolt");
  if (k === "3") useAbility("nova");
  if (k === "4") useAbility("rage");
  if (k === "escape") ui.shop.hidden = true;
});
window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});
canvas.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
canvas.addEventListener("mousedown", () => {
  mouse.down = true;
  tryAttack();
});
window.addEventListener("mouseup", () => {
  mouse.down = false;
});

document.getElementById("btn-start").onclick = startGame;
document.getElementById("btn-respawn").onclick = respawn;
document.getElementById("btn-again").onclick = respawn;
document.getElementById("btn-shop").onclick = () => {
  ui.shop.hidden = false;
  renderShop();
};
document.getElementById("shop-close").onclick = () => {
  ui.shop.hidden = true;
};
document.querySelectorAll(".tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-on"));
    tab.classList.add("is-on");
    shopTab = tab.dataset.tab;
    renderShop();
  };
});

let stickId = null;
ui.stick.addEventListener("pointerdown", (e) => {
  stickId = e.pointerId;
  ui.stick.setPointerCapture(stickId);
  moveStick(e);
});
ui.stick.addEventListener("pointermove", (e) => {
  if (e.pointerId === stickId) moveStick(e);
});
ui.stick.addEventListener("pointerup", () => {
  stickId = null;
  stick = { x: 0, y: 0 };
  ui.stickKnob.style.transform = "translate(0,0)";
});
function moveStick(e) {
  const rect = ui.stick.getBoundingClientRect();
  let dx = e.clientX - (rect.left + rect.width / 2);
  let dy = e.clientY - (rect.top + rect.height / 2);
  const max = 48;
  const len = Math.hypot(dx, dy) || 1;
  if (len > max) {
    dx = (dx / len) * max;
    dy = (dy / len) * max;
  }
  stick = { x: dx / max, y: dy / max };
  ui.stickKnob.style.transform = `translate(${dx}px,${dy}px)`;
}
document.getElementById("fire-btn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  attackHeld = true;
  tryAttack();
});
document.getElementById("fire-btn").addEventListener("pointerup", () => {
  attackHeld = false;
});
document.getElementById("fire-btn").addEventListener("pointercancel", () => {
  attackHeld = false;
});
document.getElementById("btn-jump").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  useAbility("dash");
});
document.getElementById("btn-interact").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  tryInteract();
});
document.getElementById("btn-weapon").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  cycleWeapon(1);
});
document.querySelectorAll(".skill-btn").forEach((btn) => {
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    useAbility({ 2: "bolt", 3: "nova", 4: "rage" }[btn.dataset.skill]);
  });
});

window.addEventListener("resize", resize);
resize();
requestAnimationFrame(loop);
try {
  const cached = localStorage.getItem("futurum_vk_name");
  if (cached) ui.name.value = cached.slice(0, 14);
} catch {
  /* ignore */
}
