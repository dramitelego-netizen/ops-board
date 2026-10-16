/**
 * FUTURUM Realm — живой персонаж, видимое оружие, прокачка способностей.
 */

const WORLD_W = 3200;
const WORLD_H = 2200;

const WEAPONS = [
  { id: "dagger", name: "Кинжал", dmg: 9, reach: 46, cd: 0.26, price: 0, color: "#e2e8f0", style: "dagger" },
  { id: "sword", name: "Меч странника", dmg: 15, reach: 56, cd: 0.32, price: 55, color: "#67e8f9", style: "sword" },
  { id: "axe", name: "Секира", dmg: 24, reach: 58, cd: 0.48, price: 130, color: "#fb7185", style: "axe" },
  { id: "spear", name: "Копьё бури", dmg: 18, reach: 86, cd: 0.36, price: 200, color: "#a78bfa", style: "spear" },
  { id: "hammer", name: "Молот грома", dmg: 30, reach: 54, cd: 0.58, price: 280, color: "#fbbf24", style: "hammer" },
  { id: "dual", name: "Парные клинки", dmg: 12, reach: 50, cd: 0.2, price: 340, color: "#f472b6", style: "dual" },
  { id: "scythe", name: "Коса затмения", dmg: 28, reach: 78, cd: 0.44, price: 400, color: "#c084fc", style: "scythe" },
  { id: "staff", name: "Посох кристалла", dmg: 22, reach: 70, cd: 0.4, price: 460, color: "#22d3ee", style: "staff" },
  { id: "blade", name: "Клинок FUTURUM", dmg: 36, reach: 76, cd: 0.28, price: 620, color: "#2dd4bf", style: "blade" },
];

const ABILITIES = [
  { id: "dash", key: "1", name: "Рывок", icon: "💨", cd: 3.4, cls: "dash", desc: "Рывок вперёд + неуязвимость" },
  { id: "bolt", key: "2", name: "Молния", icon: "⚡", cd: 5.8, cls: "bolt", desc: "Цепной разряд по врагам" },
  { id: "nova", key: "3", name: "Адский круг", icon: "🔥", cd: 7.8, cls: "nova", desc: "Взрыв вокруг героя" },
  { id: "rage", key: "4", name: "Берсерк", icon: "🩸", cd: 12.5, cls: "rage", desc: "Урон, скорость и криты" },
];

const MONSTER_TYPES = {
  slime: { name: "Слайм", hp: 30, dmg: 6, speed: 55, xp: 8, gold: [2, 6], color: "#4ade80", w: 30, h: 24, boss: false },
  wolf: { name: "Волк", hp: 48, dmg: 10, speed: 100, xp: 14, gold: [4, 11], color: "#94a3b8", w: 38, h: 28, boss: false },
  skeleton: { name: "Скелет", hp: 75, dmg: 14, speed: 72, xp: 22, gold: [8, 16], color: "#e2e8f0", w: 26, h: 46, boss: false },
  brute: { name: "Громила", hp: 150, dmg: 20, speed: 50, xp: 40, gold: [16, 32], color: "#fb7185", w: 44, h: 54, boss: false },
  boss_golem: { name: "Каменный страж", hp: 560, dmg: 28, speed: 44, xp: 180, gold: [80, 140], color: "#f59e0b", w: 74, h: 94, boss: true },
  boss_wraith: { name: "Теневой лорд", hp: 720, dmg: 34, speed: 74, xp: 240, gold: [120, 200], color: "#a78bfa", w: 58, h: 88, boss: true },
};

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  boot: document.getElementById("boot"),
  hud: document.getElementById("hud"),
  shop: document.getElementById("shop"),
  dead: document.getElementById("dead"),
  touch: document.getElementById("touch"),
  name: document.getElementById("player-name"),
  hpBar: document.getElementById("hp-bar"),
  xpBar: document.getElementById("xp-bar"),
  lvlChip: document.getElementById("lvl-chip"),
  goldChip: document.getElementById("gold-chip"),
  comboChip: document.getElementById("combo-chip"),
  weaponName: document.getElementById("weapon-name"),
  weaponMeta: document.getElementById("weapon-meta"),
  abilityBar: document.getElementById("ability-bar"),
  toast: document.getElementById("toast"),
  zone: document.getElementById("zone-hint"),
  shopList: document.getElementById("shop-list"),
  shopGold: document.getElementById("shop-gold"),
  deadStats: document.getElementById("dead-stats"),
  stick: document.getElementById("stick"),
  stickKnob: document.getElementById("stick-knob"),
};

let W = 0;
let H = 0;
let running = false;
let lastTs = 0;
let toastTimer = 0;
let shopTab = "weapons";
let cam = { x: 0, y: 0 };
let shake = 0;
let keys = {};
let stickVec = { x: 0, y: 0 };
let attackHeld = false;
let audioCtx = null;

const state = {
  player: null,
  monsters: [],
  drops: [],
  trees: [],
  rocks: [],
  effects: [],
  floats: [],
  rings: [],
  bolts: [],
  time: 0,
  bossesSpawned: { golem: false, wraith: false },
};

function rand(a, b) {
  return a + Math.random() * (b - a);
}
function irand(a, b) {
  return (a + Math.random() * (b - a + 1)) | 0;
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
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("is-on"), 1600);
}
function beep(freq = 440, dur = 0.06, type = "square", gain = 0.03) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.stop(audioCtx.currentTime + dur);
  } catch {
    /* ignore */
  }
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

function xpToLevel(lvl) {
  return 40 + lvl * 28;
}
function weaponOf(p) {
  return WEAPONS.find((w) => w.id === p.weaponId) || WEAPONS[0];
}
function abilityBase(id) {
  return ABILITIES.find((a) => a.id === id);
}
function abilityCd(p, id) {
  const base = abilityBase(id).cd;
  const lvl = p.abilityLvl[id] || 0;
  return base * Math.pow(0.86, lvl);
}
function abilityPower(p, id) {
  return 1 + (p.abilityLvl[id] || 0) * 0.14;
}
function skillUpgradeCost(lvl) {
  return 45 + lvl * 55;
}

function makePlayer(name) {
  return {
    name,
    x: rand(500, WORLD_W - 500),
    y: rand(500, WORLD_H - 500),
    facing: 1,
    hp: 100,
    maxHp: 100,
    gold: 35,
    xp: 0,
    level: 1,
    weaponId: "dagger",
    owned: { dagger: true },
    abilityLvl: { dash: 0, bolt: 0, nova: 0, rage: 0 },
    attackCd: 0,
    attackFlash: 0,
    cds: { dash: 0, bolt: 0, nova: 0, rage: 0 },
    dashT: 0,
    rageT: 0,
    invuln: 0,
    anim: 0,
    moving: false,
    kills: 0,
    bosses: 0,
    combo: 0,
    comboT: 0,
    trail: [],
  };
}

function makeMonster(typeId, x, y) {
  const t = MONSTER_TYPES[typeId];
  return {
    typeId,
    ...t,
    x,
    y,
    hp: t.hp,
    maxHp: t.hp,
    facing: Math.random() > 0.5 ? 1 : -1,
    attackCd: 0,
    hitFlash: 0,
    alive: true,
    wander: rand(0, Math.PI * 2),
    retarget: 0,
    anim: rand(0, 10),
  };
}

function buildWorld() {
  state.trees = [];
  for (let i = 0; i < 130; i++) {
    state.trees.push({
      x: rand(80, WORLD_W - 80),
      y: rand(80, WORLD_H - 80),
      h: rand(75, 140),
      trunk: rand(8, 14),
      shade: rand(0.85, 1.15),
    });
  }
  state.rocks = [];
  for (let i = 0; i < 45; i++) {
    state.rocks.push({ x: rand(60, WORLD_W - 60), y: rand(60, WORLD_H - 60), r: rand(12, 30) });
  }
  state.monsters = [];
  const packs = [
    ...Array(24).fill("slime"),
    ...Array(18).fill("wolf"),
    ...Array(12).fill("skeleton"),
    ...Array(8).fill("brute"),
  ];
  for (const typeId of packs) {
    state.monsters.push(makeMonster(typeId, rand(120, WORLD_W - 120), rand(120, WORLD_H - 120)));
  }
  state.drops = [];
  state.effects = [];
  state.floats = [];
  state.rings = [];
  state.bolts = [];
  state.bossesSpawned = { golem: false, wraith: false };
}

function spawnDrop(x, y, kind, amount) {
  state.drops.push({
    x: x + rand(-18, 18),
    y: y + rand(-12, 12),
    kind,
    amount,
    bob: rand(0, Math.PI * 2),
    life: 50,
  });
}

function floatText(x, y, text, color = "#fff", crit = false) {
  state.floats.push({ x, y, text, color, crit, life: crit ? 1.1 : 0.8, vy: crit ? -70 : -50 });
}

function burst(x, y, color, n = 10, speed = 160) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(speed * 0.4, speed);
    state.effects.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 30,
      life: rand(0.25, 0.75),
      color,
      r: rand(2, 5),
      glow: true,
    });
  }
}

function ring(x, y, color, maxR, life = 0.45) {
  state.rings.push({ x, y, color, r: 8, maxR, life, maxLife: life });
}

function gainXp(p, amount) {
  p.xp += amount;
  while (p.xp >= xpToLevel(p.level)) {
    p.xp -= xpToLevel(p.level);
    p.level += 1;
    p.maxHp += 12;
    p.hp = p.maxHp;
    toast(`⬆ Уровень ${p.level}!`);
    ring(p.x, p.y, "#67e8f9", 120, 0.7);
    beep(660, 0.08, "sine", 0.04);
  }
}

function addCombo(p) {
  p.combo += 1;
  p.comboT = 2.2;
  if (p.combo >= 3) {
    ui.comboChip.hidden = false;
    ui.comboChip.textContent = `COMBO x${p.combo}`;
  }
}

function killMonster(m, byPlayer) {
  if (!m.alive) return;
  m.alive = false;
  const [g0, g1] = m.gold;
  let gold = irand(g0, g1);
  if (byPlayer && state.player.combo >= 5) gold = Math.floor(gold * 1.35);
  spawnDrop(m.x, m.y, "gold", gold);
  if (Math.random() < 0.2) spawnDrop(m.x, m.y, "heart", 22);
  if (m.boss) spawnDrop(m.x, m.y, "chest", 1);
  burst(m.x, m.y - 24, m.color, m.boss ? 28 : 14, m.boss ? 260 : 180);
  ring(m.x, m.y, m.color, m.boss ? 140 : 60, 0.5);
  shake = Math.max(shake, m.boss ? 10 : 4);
  beep(m.boss ? 120 : 220, 0.08, "sawtooth", 0.035);
  if (byPlayer) {
    const p = state.player;
    p.kills += 1;
    if (m.boss) p.bosses += 1;
    gainXp(p, Math.floor(m.xp * (1 + Math.min(0.5, p.combo * 0.05))));
    floatText(m.x, m.y - m.h, `+${gold}◆`, "#fbbf24");
    toast(`${m.name} ✦ +${gold}◆`);
  }
  setTimeout(() => {
    if (!running || m.boss) return;
    const types = ["slime", "slime", "wolf", "skeleton", "brute"];
    state.monsters.push(makeMonster(types[(Math.random() * types.length) | 0], rand(100, WORLD_W - 100), rand(100, WORLD_H - 100)));
  }, 3800);
}

function hurtMonster(m, dmg, color = "#fecaca", knock = 16) {
  if (!m.alive) return false;
  const p = state.player;
  const crit = Math.random() < 0.18 + (p.rageT > 0 ? 0.15 : 0);
  const final = Math.floor(
    dmg * (crit ? 1.85 : 1) * (p.rageT > 0 ? 1.35 : 1) * (1 + Math.min(0.4, p.combo * 0.04))
  );
  m.hp -= final;
  m.hitFlash = 0.18;
  m.x += p.facing * knock;
  burst(m.x, m.y - m.h * 0.4, color, crit ? 12 : 6, crit ? 220 : 140);
  floatText(m.x, m.y - m.h * 0.7, String(final), crit ? "#fde68a" : "#fff", crit);
  if (crit) {
    shake = Math.max(shake, 6);
    beep(880, 0.05, "square", 0.03);
  } else beep(320, 0.04, "triangle", 0.02);
  addCombo(p);
  if (m.hp <= 0) killMonster(m, true);
  return true;
}

function tryAttack() {
  const p = state.player;
  if (!p || p.attackCd > 0) return;
  const w = weaponOf(p);
  p.attackCd = w.cd * (p.rageT > 0 ? 0.7 : 1) * (w.style === "dual" ? 0.92 : 1);
  p.attackFlash = 0.22;
  const reach = w.reach;
  const base = w.dmg + Math.floor((p.level - 1) * 1.8);
  let hits = 0;
  for (const m of state.monsters) {
    if (!m.alive) continue;
    const dx = m.x - p.x;
    const dy = m.y - p.y;
    const inFront = p.facing > 0 ? dx > -14 : dx < 14;
    if (inFront && Math.hypot(dx, dy) < reach + m.w * 0.3) {
      hurtMonster(m, base, w.color, w.style === "hammer" ? 26 : 16);
      hits += 1;
    }
  }
  // dual hits twice lightly visual
  if (w.style === "dual" && hits) ring(p.x + p.facing * 18, p.y - 8, w.color, reach * 0.4, 0.15);
  ring(p.x + p.facing * 24, p.y - 10, w.color, reach * 0.55, 0.22);
  if (hits) shake = Math.max(shake, w.style === "hammer" ? 5 : 3);
  else beep(180, 0.03, "triangle", 0.015);
}

function useAbility(id) {
  const p = state.player;
  if (!p || !running) return;
  if ((p.cds[id] || 0) > 0) return;
  const pow = abilityPower(p, id);
  const cd = abilityCd(p, id);

  if (id === "dash") {
    p.cds.dash = cd;
    p.dashT = 0.26;
    p.invuln = 0.3 + (p.abilityLvl.dash || 0) * 0.04;
    const distDash = 110 + (p.abilityLvl.dash || 0) * 18;
    p.x = clamp(p.x + p.facing * distDash, 30, WORLD_W - 30);
    for (let i = 0; i < 12; i++) burst(p.x - p.facing * i * 9, p.y - 20, "#67e8f9", 2, 70);
    ring(p.x, p.y, "#67e8f9", 70 + pow * 10, 0.35);
    // small damage at end
    for (const m of state.monsters) {
      if (m.alive && dist(m, p) < 55) hurtMonster(m, 10 * pow, "#67e8f9", 20);
    }
    toast("💨 Сверхрывок");
    beep(520, 0.07, "sine", 0.04);
  }

  if (id === "bolt") {
    p.cds.bolt = cd;
    const count = 4 + Math.min(3, p.abilityLvl.bolt | 0);
    const targets = state.monsters
      .filter((m) => m.alive && dist(m, p) < 260 + (p.abilityLvl.bolt || 0) * 20)
      .sort((a, b) => dist(a, p) - dist(b, p))
      .slice(0, count);
    if (!targets.length) {
      toast("Нет целей для молнии");
      p.cds.bolt = 0.5;
      return;
    }
    let prev = { x: p.x, y: p.y - 34 };
    for (const m of targets) {
      state.bolts.push({ x1: prev.x, y1: prev.y, x2: m.x, y2: m.y - m.h * 0.5, life: 0.3 });
      hurtMonster(m, (28 + p.level * 3) * pow, "#c4b5fd", 12);
      prev = { x: m.x, y: m.y - m.h * 0.5 };
    }
    shake = Math.max(shake, 7);
    toast(`⚡ Молния ×${targets.length}`);
    beep(740, 0.09, "sawtooth", 0.035);
  }

  if (id === "nova") {
    p.cds.nova = cd;
    const radius = 145 + (p.abilityLvl.nova || 0) * 16;
    ring(p.x, p.y, "#f97316", radius + 20, 0.55);
    ring(p.x, p.y, "#fb7185", radius * 0.7, 0.4);
    burst(p.x, p.y - 10, "#f97316", 34, 300);
    for (const m of state.monsters) {
      if (m.alive && dist(m, p) < radius) hurtMonster(m, (36 + p.level * 2) * pow, "#fdba74", 30);
    }
    shake = Math.max(shake, 9);
    toast("🔥 Адский круг");
    beep(160, 0.12, "sawtooth", 0.045);
  }

  if (id === "rage") {
    p.cds.rage = cd;
    p.rageT = 5.5 + (p.abilityLvl.rage || 0) * 0.8;
    p.hp = Math.min(p.maxHp, p.hp + 20 + (p.abilityLvl.rage || 0) * 6);
    ring(p.x, p.y, "#fb7185", 110, 0.6);
    burst(p.x, p.y - 20, "#fb7185", 24, 220);
    toast(`🩸 Берсерк ${p.rageT.toFixed(1)}с`);
    beep(200, 0.1, "square", 0.04);
  }
  renderAbilities();
}

function pickup() {
  const p = state.player;
  let best = null;
  let bestD = 40;
  for (const d of state.drops) {
    const dd = dist(p, d);
    if (dd < bestD) {
      best = d;
      bestD = dd;
    }
  }
  if (!best) return;
  if (best.kind === "gold") {
    p.gold += best.amount;
    floatText(best.x, best.y, `+${best.amount}`, "#fbbf24");
  } else if (best.kind === "heart") {
    p.hp = Math.min(p.maxHp, p.hp + best.amount);
    toast(`❤ +${best.amount} HP`);
  } else if (best.kind === "chest") {
    p.gold += 60;
    gainXp(p, 50);
    toast("🎁 Сундук босса!");
  }
  state.drops = state.drops.filter((x) => x !== best);
  beep(600, 0.05, "sine", 0.03);
}

function zoneName(p) {
  if (p.x < WORLD_W * 0.33) return "Тихие поля";
  if (p.x < WORLD_W * 0.66) return "Тёмный лес";
  return "Руины стража";
}

function maybeSpawnBosses() {
  const p = state.player;
  if (!state.bossesSpawned.golem && p.level >= 3) {
    state.bossesSpawned.golem = true;
    state.monsters.push(makeMonster("boss_golem", WORLD_W * 0.72, WORLD_H * 0.35));
    toast("⚠ Каменный страж пробудился!");
    shake = 12;
  }
  if (!state.bossesSpawned.wraith && p.level >= 5) {
    state.bossesSpawned.wraith = true;
    state.monsters.push(makeMonster("boss_wraith", WORLD_W * 0.82, WORLD_H * 0.7));
    toast("⚠ Теневой лорд явился!");
    shake = 12;
  }
}

function updateMonster(m, dt) {
  if (!m.alive) return;
  m.anim += dt;
  m.hitFlash = Math.max(0, m.hitFlash - dt);
  m.attackCd = Math.max(0, m.attackCd - dt);
  m.retarget -= dt;
  const p = state.player;
  const d = p ? dist(m, p) : 9999;
  const aggro = m.boss ? 440 : 220;
  if (p && d < aggro) {
    const ang = Math.atan2(p.y - m.y, p.x - m.x);
    m.facing = Math.cos(ang) >= 0 ? 1 : -1;
    const stop = m.boss ? 50 : 36;
    if (d > stop) {
      m.x += Math.cos(ang) * m.speed * dt;
      m.y += Math.sin(ang) * m.speed * dt * 0.85;
    } else if (m.attackCd <= 0 && p.invuln <= 0) {
      m.attackCd = m.boss ? 1.05 : 0.8;
      p.hp -= m.dmg;
      p.invuln = 0.4;
      p.combo = 0;
      p.comboT = 0;
      ui.comboChip.hidden = true;
      burst(p.x, p.y - 28, "#fb7185", 10);
      floatText(p.x, p.y - 50, `-${m.dmg}`, "#fb7185");
      shake = Math.max(shake, 5);
      if (p.hp <= 0) onPlayerDead();
    }
  } else {
    if (m.retarget <= 0) {
      m.retarget = rand(1, 2.4);
      m.wander = rand(0, Math.PI * 2);
    }
    m.x += Math.cos(m.wander) * m.speed * 0.35 * dt;
    m.y += Math.sin(m.wander) * m.speed * 0.28 * dt;
    m.facing = Math.cos(m.wander) >= 0 ? 1 : -1;
  }
  m.x = clamp(m.x, 40, WORLD_W - 40);
  m.y = clamp(m.y, 40, WORLD_H - 40);
}

function onPlayerDead() {
  running = false;
  const p = state.player;
  ui.dead.hidden = false;
  ui.deadStats.textContent = `Ур.${p.level} · убийств ${p.kills} · боссов ${p.bosses} · золото ${p.gold}`;
  shake = 14;
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
  p.comboT = Math.max(0, p.comboT - dt);
  if (p.comboT <= 0 && p.combo) {
    p.combo = 0;
    ui.comboChip.hidden = true;
  }
  for (const k of Object.keys(p.cds)) p.cds[k] = Math.max(0, p.cds[k] - dt);

  // always animate a bit for idle breath
  p.anim += dt * (p.moving ? 9.5 : 2.2);

  let mx = 0;
  let my = 0;
  if (keys.w || keys.arrowup) my -= 1;
  if (keys.s || keys.arrowdown) my += 1;
  if (keys.a || keys.arrowleft) mx -= 1;
  if (keys.d || keys.arrowright) mx += 1;
  mx += stickVec.x;
  my += stickVec.y;
  const len = Math.hypot(mx, my);
  p.moving = len > 0.1;
  if (p.moving) {
    if (mx !== 0) p.facing = mx > 0 ? 1 : -1;
    const sp = (124 + p.level * 2.2) * (p.dashT > 0 ? 2.8 : 1) * (p.rageT > 0 ? 1.25 : 1);
    p.x = clamp(p.x + (mx / len) * sp * dt, 30, WORLD_W - 30);
    p.y = clamp(p.y + (my / len) * sp * dt * 0.9, 30, WORLD_H - 30);
    p.trail.push({ x: p.x, y: p.y, life: 0.32 });
    if (p.trail.length > 14) p.trail.shift();
  }
  for (const t of p.trail) t.life -= dt;
  p.trail = p.trail.filter((t) => t.life > 0);

  if (attackHeld && ui.shop.hidden) tryAttack();
  for (const m of state.monsters) updateMonster(m, dt);

  state.drops = state.drops.filter((d) => {
    d.bob += dt * 4;
    d.life -= dt;
    if (d.kind === "gold" && dist(p, d) < 30) {
      p.gold += d.amount;
      floatText(d.x, d.y, `+${d.amount}`, "#fbbf24");
      return false;
    }
    return d.life > 0;
  });

  for (const e of state.effects) {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.vy += 240 * dt;
    e.life -= dt;
  }
  state.effects = state.effects.filter((e) => e.life > 0);
  for (const f of state.floats) {
    f.y += f.vy * dt;
    f.vy += 40 * dt;
    f.life -= dt;
  }
  state.floats = state.floats.filter((f) => f.life > 0);
  for (const r of state.rings) {
    r.life -= dt;
    const t = 1 - r.life / r.maxLife;
    r.r = 8 + (r.maxR - 8) * t;
  }
  state.rings = state.rings.filter((r) => r.life > 0);
  for (const b of state.bolts) b.life -= dt;
  state.bolts = state.bolts.filter((b) => b.life > 0);

  maybeSpawnBosses();
  ui.zone.textContent = zoneName(p);
  const sx = (Math.random() - 0.5) * shake;
  const sy = (Math.random() - 0.5) * shake;
  cam.x = clamp(p.x - W * 0.5 + sx, 0, Math.max(0, WORLD_W - W));
  cam.y = clamp(p.y - H * 0.62 + sy, 0, Math.max(0, WORLD_H - H));
  updateHud();
  renderAbilities();
}

function updateHud() {
  const p = state.player;
  ui.hpBar.style.transform = `scaleX(${clamp(p.hp / p.maxHp, 0, 1)})`;
  ui.xpBar.style.transform = `scaleX(${clamp(p.xp / xpToLevel(p.level), 0, 1)})`;
  ui.lvlChip.textContent = `LVL ${p.level}`;
  ui.goldChip.textContent = `◆ ${p.gold}`;
  const w = weaponOf(p);
  const dmg = w.dmg + Math.floor((p.level - 1) * 1.8);
  ui.weaponName.textContent = w.name;
  ui.weaponMeta.textContent = p.rageT > 0 ? `урон ~${Math.floor(dmg * 1.35)} · БЕРСЕРК` : `урон ${dmg}`;
}

function renderAbilities() {
  const p = state.player;
  if (!p) return;
  ui.abilityBar.innerHTML = ABILITIES.map((a) => {
    const cd = p.cds[a.id] || 0;
    const max = abilityCd(p, a.id);
    const pct = cd > 0 ? (cd / max) * 100 : 0;
    const lvl = p.abilityLvl[a.id] || 0;
    return `<button type="button" class="ability-slot ${a.cls} ${cd <= 0 ? "is-ready" : ""}" data-ability="${a.id}">
      <span class="key">${a.key}${lvl ? `·${lvl}` : ""}</span>
      <span class="icon">${a.icon}</span>
      <span>${a.name}</span>
      <i class="cd-mask" style="height:${pct}%"></i>
    </button>`;
  }).join("");
  ui.abilityBar.querySelectorAll("[data-ability]").forEach((btn) => {
    btn.onclick = () => useAbility(btn.dataset.ability);
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

/** Рисует оружие в руке — у каждого свой силуэт */
function drawWeaponInHand(wpn, facing, swing) {
  const f = facing;
  ctx.save();
  ctx.translate(10 * f, -8);
  ctx.rotate(f * (-0.55 + swing * 2.0));
  ctx.shadowColor = wpn.color;
  ctx.shadowBlur = 10;
  ctx.fillStyle = wpn.color;

  const style = wpn.style;
  if (style === "dagger") {
    ctx.fillRect(0, -2, 26, 4);
    ctx.beginPath();
    ctx.moveTo(26, -3);
    ctx.lineTo(34, 0);
    ctx.lineTo(26, 3);
    ctx.fill();
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(-4, -5, 8, 10);
  } else if (style === "sword" || style === "blade") {
    ctx.fillRect(0, -3.5, style === "blade" ? 42 : 34, 7);
    ctx.beginPath();
    ctx.moveTo(style === "blade" ? 42 : 34, -4);
    ctx.lineTo((style === "blade" ? 42 : 34) + 10, 0);
    ctx.lineTo(style === "blade" ? 42 : 34, 4);
    ctx.fill();
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(-6, -7, 12, 14);
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(-2, -9, 4, 18);
    if (style === "blade") {
      ctx.strokeStyle = "rgba(45,212,191,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(40, 0);
      ctx.stroke();
    }
  } else if (style === "axe") {
    ctx.fillStyle = "#78716c";
    ctx.fillRect(0, -2.5, 28, 5);
    ctx.fillStyle = wpn.color;
    ctx.beginPath();
    ctx.arc(28, 0, 14, -1.2, 1.2);
    ctx.lineTo(28, 0);
    ctx.fill();
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(-5, -6, 10, 12);
  } else if (style === "spear") {
    ctx.fillStyle = "#a8a29e";
    ctx.fillRect(0, -1.8, 52, 3.6);
    ctx.fillStyle = wpn.color;
    ctx.beginPath();
    ctx.moveTo(52, -5);
    ctx.lineTo(64, 0);
    ctx.lineTo(52, 5);
    ctx.fill();
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(-4, -5, 8, 10);
  } else if (style === "hammer") {
    ctx.fillStyle = "#a8a29e";
    ctx.fillRect(0, -2, 26, 4);
    ctx.fillStyle = wpn.color;
    roundRect(22, -12, 22, 24, 4);
    ctx.fill();
    ctx.fillStyle = "#fde68a";
    ctx.fillRect(26, -8, 14, 6);
    ctx.fillStyle = "#78716c";
    ctx.fillRect(-5, -5, 10, 10);
  } else if (style === "dual") {
    ctx.fillRect(0, -2, 28, 4);
    ctx.beginPath();
    ctx.moveTo(28, -3);
    ctx.lineTo(36, 0);
    ctx.lineTo(28, 3);
    ctx.fill();
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(-3, -4, 7, 8);
    // second blade behind
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = wpn.color;
    ctx.save();
    ctx.translate(-2 * f, 6);
    ctx.rotate(f * -0.35);
    ctx.fillRect(0, -2, 24, 3.5);
    ctx.restore();
    ctx.globalAlpha = 1;
  } else if (style === "scythe") {
    ctx.fillStyle = "#78716c";
    ctx.fillRect(0, -2, 40, 4);
    ctx.fillStyle = wpn.color;
    ctx.beginPath();
    ctx.moveTo(34, -2);
    ctx.quadraticCurveTo(58, -28, 48, 8);
    ctx.quadraticCurveTo(44, -4, 34, 2);
    ctx.fill();
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(-5, -5, 10, 10);
  } else if (style === "staff") {
    ctx.fillStyle = "#a8a29e";
    ctx.fillRect(0, -2, 44, 4);
    ctx.fillStyle = wpn.color;
    ctx.beginPath();
    ctx.arc(48, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ecfeff";
    ctx.beginPath();
    ctx.arc(48, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(-4, -5, 8, 10);
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawHero(p) {
  const x = p.x - cam.x;
  const y = p.y - cam.y;
  const f = p.facing;
  const wpn = weaponOf(p);
  const walk = p.anim;
  const breath = Math.sin(state.time * 2.4) * 1.2;
  const bob = p.moving ? Math.sin(walk) * 3.2 : breath;
  const lean = p.moving ? f * 0.08 : 0;
  const leg = p.moving ? Math.sin(walk) * 10 : Math.sin(state.time * 1.5) * 1.5;
  const arm = p.moving ? Math.sin(walk + Math.PI) * 0.45 : Math.sin(state.time * 1.5) * 0.08;
  const swing = p.attackFlash > 0 ? (0.22 - p.attackFlash) / 0.22 : 0;

  for (const t of p.trail) {
    ctx.globalAlpha = t.life * 0.4;
    ctx.fillStyle = p.rageT > 0 ? "#fb7185" : "#67e8f9";
    ctx.beginPath();
    ctx.ellipse(t.x - cam.x, t.y - cam.y, 11, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(x, y);
  if (p.invuln > 0 && ((state.time * 22) | 0) % 2 === 0) ctx.globalAlpha = 0.4;

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.beginPath();
  ctx.ellipse(0, 6, 18, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  if (p.rageT > 0) {
    ctx.strokeStyle = `rgba(251,113,133,${0.4 + Math.sin(state.time * 12) * 0.2})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -22, 36, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.translate(0, bob - 4);
  ctx.rotate(lean);

  // cape
  ctx.fillStyle = p.rageT > 0 ? "#9f1239" : "#0e7490";
  ctx.beginPath();
  ctx.moveTo(-6 * f, -22);
  ctx.quadraticCurveTo(-28 * f + Math.sin(walk * 0.8) * 6, -8, -22 * f, 18 + Math.sin(walk) * 3);
  ctx.lineTo(-4 * f, 10);
  ctx.closePath();
  ctx.fill();

  // back arm
  ctx.save();
  ctx.translate(-6 * f, -14);
  ctx.rotate(f * (-0.4 + arm * 0.7));
  ctx.fillStyle = "#fde68a";
  ctx.fillRect(-3, 0, 6, 16);
  ctx.restore();

  // legs with boots
  ctx.fillStyle = "#1e293b";
  ctx.save();
  ctx.translate(-6, 12);
  ctx.rotate((leg * Math.PI) / 180);
  roundRect(-4, 0, 8, 16, 3);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(-5, 14, 10, 5);
  ctx.restore();
  ctx.save();
  ctx.translate(5, 12);
  ctx.rotate((-leg * Math.PI) / 180);
  ctx.fillStyle = "#1e293b";
  roundRect(-4, 0, 8, 16, 3);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(-5, 14, 10, 5);
  ctx.restore();

  // torso
  const body = ctx.createLinearGradient(-14, -32, 14, 14);
  body.addColorStop(0, p.rageT > 0 ? "#fda4af" : "#a5f3fc");
  body.addColorStop(0.55, p.rageT > 0 ? "#e11d48" : "#22d3ee");
  body.addColorStop(1, p.rageT > 0 ? "#881337" : "#0e7490");
  ctx.fillStyle = body;
  roundRect(-13, -28, 26, 40, 9);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // belt + glow gem
  ctx.fillStyle = "#f97316";
  ctx.fillRect(-13, 0, 26, 7);
  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(0, 3.5, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // head
  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(0, -40, 13, 0, Math.PI * 2);
  ctx.fill();
  // hair
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.ellipse(-1 * f, -46, 12, 9, f * -0.2, Math.PI * 0.9, Math.PI * 2.1);
  ctx.fill();
  // ear
  ctx.fillStyle = "#fcd34d";
  ctx.beginPath();
  ctx.arc(-11 * f, -40, 3, 0, Math.PI * 2);
  ctx.fill();
  // eye glow
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.ellipse(5 * f, -40, 3.2, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#22d3ee";
  ctx.beginPath();
  ctx.arc(6 * f, -40, 1.6, 0, Math.PI * 2);
  ctx.fill();
  // mouth soft
  ctx.strokeStyle = "rgba(120,53,15,0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(3 * f, -34, 3, 0.1, Math.PI - 0.1);
  ctx.stroke();

  // front arm + weapon
  ctx.save();
  ctx.translate(8 * f, -12);
  const armRot = p.attackFlash > 0 ? f * (-0.9 + swing * 2.3) : f * (0.15 + arm);
  ctx.rotate(armRot);
  ctx.fillStyle = "#fde68a";
  ctx.fillRect(-3, 0, 6, 15);
  // hand
  ctx.beginPath();
  ctx.arc(0, 16, 4.5, 0, Math.PI * 2);
  ctx.fill();
  // weapon attached to hand
  ctx.translate(0, 14);
  drawWeaponInHand(wpn, f, swing);
  ctx.restore();

  // attack slash glow
  if (p.attackFlash > 0) {
    ctx.strokeStyle = wpn.color;
    ctx.globalAlpha = p.attackFlash * 4;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, -10, wpn.reach * 0.62, f > 0 ? -1.25 : Math.PI - 0.2, f > 0 ? 0.6 : Math.PI + 1.25);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // name
  ctx.fillStyle = "#67e8f9";
  ctx.font = "700 12px Chakra Petch, sans-serif";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;
  ctx.fillText(p.name, x, y - 72);
  ctx.shadowBlur = 0;
}

function drawMonster(m) {
  if (!m.alive) return;
  const x = m.x - cam.x;
  const y = m.y - cam.y;
  if (x < -110 || x > W + 110 || y < -130 || y > H + 90) return;
  const bob = Math.sin(m.anim * 4) * (m.boss ? 3 : 2);
  ctx.save();
  ctx.translate(x, y + bob);
  if (m.hitFlash > 0) ctx.filter = "brightness(2.2)";
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(0, 6, m.w * 0.45, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  if (m.boss) {
    const aura = ctx.createRadialGradient(0, -m.h * 0.4, 10, 0, -m.h * 0.4, m.w);
    aura.addColorStop(0, m.color + "66");
    aura.addColorStop(1, "transparent");
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, -m.h * 0.4, m.w, 0, Math.PI * 2);
    ctx.fill();
  }
  if (m.typeId === "slime") {
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.ellipse(0, -8, m.w * 0.45, m.h * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-6, -14, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#052e16";
    ctx.beginPath();
    ctx.arc(-6 * m.facing, -12, 3, 0, Math.PI * 2);
    ctx.arc(5 * m.facing, -12, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (m.typeId === "wolf") {
    ctx.fillStyle = m.color;
    roundRect(-m.w / 2, -m.h, m.w, m.h * 0.7, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(m.facing * 16, -m.h * 0.7, 13, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(m.facing * 22, -m.h * 0.75, 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = m.color;
    roundRect(-m.w * 0.28, -m.h * 0.75, m.w * 0.56, m.h * 0.55, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -m.h * 0.85, m.boss ? 17 : 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7f1d1d";
    ctx.beginPath();
    ctx.arc(-5, -m.h * 0.88, 2.6, 0, Math.PI * 2);
    ctx.arc(5, -m.h * 0.88, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = "none";
  ctx.restore();
  const bw = Math.max(30, m.w);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x - bw / 2, y - m.h - 16, bw, 6);
  ctx.fillStyle = m.boss ? "#fbbf24" : "#fb7185";
  ctx.fillRect(x - bw / 2, y - m.h - 16, bw * clamp(m.hp / m.maxHp, 0, 1), 6);
  ctx.fillStyle = m.boss ? "#fde68a" : "#e2e8f0";
  ctx.font = m.boss ? "700 12px Orbitron, sans-serif" : "600 10px Manrope, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(m.name, x, y - m.h - 20);
}

function drawTree(t) {
  const x = t.x - cam.x;
  const y = t.y - cam.y;
  if (x < -90 || x > W + 90 || y < -20 || y > H + 170) return;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x, y + 6, 24 * t.shade, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a2f1a";
  ctx.fillRect(x - t.trunk / 2, y - t.h * 0.45, t.trunk, t.h * 0.5);
  for (const L of [
    { oy: -t.h * 0.52, r: 30 * t.shade, c: "#14532d" },
    { oy: -t.h * 0.7, r: 25 * t.shade, c: "#166534" },
    { oy: -t.h * 0.88, r: 18 * t.shade, c: "#22c55e" },
  ]) {
    ctx.fillStyle = L.c;
    ctx.beginPath();
    ctx.ellipse(x, y + L.oy, L.r, L.r * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRock(r) {
  const x = r.x - cam.x;
  const y = r.y - cam.y;
  if (x < -40 || x > W + 40 || y < -40 || y > H + 40) return;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(x, y + 4, r.r, r.r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#64748b";
  ctx.beginPath();
  ctx.ellipse(x, y - r.r * 0.2, r.r, r.r * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawDrop(d) {
  const x = d.x - cam.x;
  const y = d.y - cam.y + Math.sin(d.bob) * 4;
  if (d.kind === "gold") {
    ctx.shadowColor = "#fbbf24";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else if (d.kind === "heart") {
    ctx.fillStyle = "#fb7185";
    ctx.beginPath();
    ctx.arc(x - 4, y, 5, 0, Math.PI * 2);
    ctx.arc(x + 4, y, 5, 0, Math.PI * 2);
    ctx.moveTo(x - 9, y + 1);
    ctx.lineTo(x, y + 12);
    ctx.lineTo(x + 9, y + 1);
    ctx.fill();
  } else {
    ctx.fillStyle = "#92400e";
    ctx.fillRect(x - 11, y - 6, 22, 15);
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(x - 11, y - 11, 22, 7);
  }
}

function drawGround() {
  ctx.fillStyle = "#142218";
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, 140);
  g.addColorStop(0, "#0a1424");
  g.addColorStop(1, "rgba(20,34,24,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 140);
  const cell = 64;
  const ox = -((cam.x / cell) % 1) * cell;
  const oy = -((cam.y / cell) % 1) * cell;
  for (let y = oy - cell; y < H + cell; y += cell) {
    for (let x = ox - cell; x < W + cell; x += cell) {
      const wx = cam.x + x;
      const wy = cam.y + y;
      const n = Math.sin(wx * 0.012) * Math.cos(wy * 0.01);
      ctx.fillStyle = n > 0.2 ? "#1d3326" : n < -0.25 ? "#101c16" : "#173024";
      ctx.fillRect(x, y, cell + 1, cell + 1);
    }
  }
  if (state.player) {
    const px = state.player.x - cam.x;
    const py = state.player.y - cam.y;
    const light = ctx.createRadialGradient(px, py, 10, px, py, 240);
    light.addColorStop(0, state.player.rageT > 0 ? "rgba(251,113,133,0.18)" : "rgba(34,211,238,0.14)");
    light.addColorStop(1, "transparent");
    ctx.fillStyle = light;
    ctx.fillRect(px - 240, py - 240, 480, 480);
  }
}

function drawFx() {
  for (const r of state.rings) {
    const a = clamp(r.life / r.maxLife, 0, 1);
    ctx.strokeStyle = r.color;
    ctx.globalAlpha = a * 0.85;
    ctx.lineWidth = 3 + (1 - a) * 4;
    ctx.beginPath();
    ctx.arc(r.x - cam.x, r.y - cam.y, r.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const b of state.bolts) {
    ctx.strokeStyle = `rgba(196,181,253,${b.life * 3})`;
    ctx.shadowColor = "#a78bfa";
    ctx.shadowBlur = 12;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x1 - cam.x, b.y1 - cam.y);
    ctx.quadraticCurveTo(
      (b.x1 + b.x2) / 2 + rand(-10, 10) - cam.x,
      (b.y1 + b.y2) / 2 + rand(-14, 14) - cam.y,
      b.x2 - cam.x,
      b.y2 - cam.y
    );
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  for (const e of state.effects) {
    ctx.globalAlpha = clamp(e.life * 2, 0, 1);
    if (e.glow) {
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 8;
    }
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x - cam.x, e.y - cam.y, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  for (const f of state.floats) {
    ctx.globalAlpha = clamp(f.life * 1.4, 0, 1);
    ctx.fillStyle = f.color;
    ctx.font = f.crit ? "800 18px Orbitron, sans-serif" : "700 14px Chakra Petch, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(f.text, f.x - cam.x, f.y - cam.y);
    ctx.globalAlpha = 1;
  }
}

function draw() {
  drawGround();
  const sprites = [];
  for (const t of state.trees) sprites.push({ y: t.y, draw: () => drawTree(t) });
  for (const r of state.rocks) sprites.push({ y: r.y, draw: () => drawRock(r) });
  for (const d of state.drops) sprites.push({ y: d.y, draw: () => drawDrop(d) });
  for (const m of state.monsters) if (m.alive) sprites.push({ y: m.y, draw: () => drawMonster(m) });
  if (state.player) sprites.push({ y: state.player.y, draw: () => drawHero(state.player) });
  sprites.sort((a, b) => a.y - b.y);
  for (const s of sprites) s.draw();
  drawFx();
  const vg = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.15, W / 2, H * 0.55, H * 0.8);
  vg.addColorStop(0, "transparent");
  vg.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
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

  if (shopTab === "weapons") {
    for (const w of WEAPONS) {
      if (w.id === "dagger") continue;
      const owned = !!p.owned[w.id];
      const row = document.createElement("div");
      row.className = "shop-item";
      row.innerHTML = `<div><h3>${w.name}</h3><p>Урон ${w.dmg} · радиус ${w.reach} · видно в руке</p></div>`;
      const btn = document.createElement("button");
      btn.className = "shop-buy";
      btn.textContent = owned ? (p.weaponId === w.id ? "В руках" : "Взять") : `${w.price} ◆`;
      btn.disabled = owned ? p.weaponId === w.id : p.gold < w.price;
      btn.onclick = () => {
        if (owned) p.weaponId = w.id;
        else if (p.gold >= w.price) {
          p.gold -= w.price;
          p.owned[w.id] = true;
          p.weaponId = w.id;
          toast(`⚔ ${w.name}`);
        }
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
      const cost = skillUpgradeCost(lvl);
      const nextCd = (abilityBase(a.id).cd * Math.pow(0.86, lvl + 1)).toFixed(1);
      const row = document.createElement("div");
      row.className = "shop-item";
      row.innerHTML = `<div><h3>${a.icon} ${a.name} · ур.${lvl}/5</h3><p>${a.desc}. След. откат ≈ ${nextCd}с, сильнее на 14%</p></div>`;
      const btn = document.createElement("button");
      btn.className = "shop-buy";
      btn.textContent = lvl >= 5 ? "MAX" : `${cost} ◆`;
      btn.disabled = lvl >= 5 || p.gold < cost;
      btn.onclick = () => {
        if (lvl >= 5 || p.gold < cost) return;
        p.gold -= cost;
        p.abilityLvl[a.id] = lvl + 1;
        toast(`${a.name} → ур.${lvl + 1}`);
        renderShop();
        renderAbilities();
        updateHud();
      };
      row.appendChild(btn);
      ui.shopList.appendChild(row);
    }
  }

  if (shopTab === "items") {
    for (const it of [
      { name: "Зелье жизни", desc: "+55 HP", cost: 22, fn: () => (p.hp = Math.min(p.maxHp, p.hp + 55)) },
      { name: "Эликсир опыта", desc: "До следующего уровня", cost: 90, fn: () => gainXp(p, xpToLevel(p.level) - p.xp) },
      {
        name: "Сброс отката",
        desc: "Все способности готовы",
        cost: 70,
        fn: () => {
          p.cds = { dash: 0, bolt: 0, nova: 0, rage: 0 };
        },
      },
    ]) {
      const row = document.createElement("div");
      row.className = "shop-item";
      row.innerHTML = `<div><h3>${it.name}</h3><p>${it.desc}</p></div>`;
      const btn = document.createElement("button");
      btn.className = "shop-buy";
      btn.textContent = `${it.cost} ◆`;
      btn.disabled = p.gold < it.cost;
      btn.onclick = () => {
        if (p.gold < it.cost) return;
        p.gold -= it.cost;
        it.fn();
        toast(it.name);
        renderShop();
        renderAbilities();
        updateHud();
      };
      row.appendChild(btn);
      ui.shopList.appendChild(row);
    }
  }
}

function startGame() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {
    /* ignore */
  }
  const name = (ui.name.value || "Странник").trim().slice(0, 14);
  buildWorld();
  state.player = makePlayer(name);
  ui.boot.hidden = true;
  ui.dead.hidden = true;
  ui.hud.hidden = false;
  ui.shop.hidden = true;
  if (matchMedia("(pointer: coarse)").matches) ui.touch.hidden = false;
  running = true;
  toast(`Появление · ${state.player.x | 0}, ${state.player.y | 0}`);
  updateHud();
  renderAbilities();
}

function respawn() {
  const old = state.player;
  state.player = makePlayer(old.name);
  state.player.gold = Math.floor(old.gold * 0.65);
  state.player.level = Math.max(1, old.level - 1);
  state.player.owned = { ...old.owned };
  state.player.weaponId = old.weaponId;
  state.player.abilityLvl = { ...old.abilityLvl };
  state.player.maxHp = 100 + (state.player.level - 1) * 12;
  state.player.hp = state.player.maxHp;
  ui.dead.hidden = true;
  running = true;
  toast("Воскрешение");
  renderAbilities();
}

window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.code === "Space") {
    e.preventDefault();
    attackHeld = true;
    tryAttack();
  }
  if (e.key.toLowerCase() === "e") pickup();
  if (e.key.toLowerCase() === "b") {
    ui.shop.hidden = !ui.shop.hidden;
    if (!ui.shop.hidden) renderShop();
  }
  if (e.key === "1") useAbility("dash");
  if (e.key === "2") useAbility("bolt");
  if (e.key === "3") useAbility("nova");
  if (e.key === "4") useAbility("rage");
  if (e.key === "Escape") ui.shop.hidden = true;
});
window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
  if (e.code === "Space") attackHeld = false;
});
canvas.addEventListener("mousedown", () => {
  attackHeld = true;
  tryAttack();
});
window.addEventListener("mouseup", () => {
  attackHeld = false;
});

document.getElementById("btn-start").onclick = startGame;
document.getElementById("btn-respawn").onclick = respawn;
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
  stickVec = { x: 0, y: 0 };
  ui.stickKnob.style.transform = "translate(0,0)";
});
function moveStick(e) {
  const rect = ui.stick.getBoundingClientRect();
  let dx = e.clientX - (rect.left + rect.width / 2);
  let dy = e.clientY - (rect.top + rect.height / 2);
  const max = 36;
  const len = Math.hypot(dx, dy) || 1;
  if (len > max) {
    dx = (dx / len) * max;
    dy = (dy / len) * max;
  }
  stickVec = { x: dx / max, y: dy / max };
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
document.querySelectorAll(".skill-btn").forEach((btn) => {
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    useAbility({ 1: "dash", 2: "bolt", 3: "nova", 4: "rage" }[btn.dataset.skill]);
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
