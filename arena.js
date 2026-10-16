/**
 * FUTURUM Realm — более сочный бой, способности, VFX, комбо.
 */

const WORLD_W = 3200;
const WORLD_H = 2200;

const WEAPONS = [
  { id: "dagger", name: "Кинжал", dmg: 9, reach: 46, cd: 0.28, price: 0, color: "#cbd5e1" },
  { id: "sword", name: "Меч странника", dmg: 15, reach: 56, cd: 0.34, price: 60, color: "#67e8f9" },
  { id: "axe", name: "Секира", dmg: 24, reach: 60, cd: 0.5, price: 140, color: "#fb7185" },
  { id: "spear", name: "Копьё бури", dmg: 19, reach: 82, cd: 0.38, price: 220, color: "#a78bfa" },
  { id: "blade", name: "Клинок FUTURUM", dmg: 34, reach: 74, cd: 0.3, price: 420, color: "#22d3ee" },
];

const ABILITIES = [
  { id: "dash", key: "1", name: "Рывок", icon: "💨", cd: 3.2, cls: "dash" },
  { id: "bolt", key: "2", name: "Молния", icon: "⚡", cd: 5.5, cls: "bolt" },
  { id: "nova", key: "3", name: "Адский круг", icon: "🔥", cd: 7.5, cls: "nova" },
  { id: "rage", key: "4", name: "Берсерк", icon: "🩸", cd: 12, cls: "rage" },
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

function makePlayer(name) {
  return {
    name,
    x: rand(500, WORLD_W - 500),
    y: rand(500, WORLD_H - 500),
    facing: 1,
    hp: 100,
    maxHp: 100,
    gold: 20,
    xp: 0,
    level: 1,
    weaponId: "dagger",
    owned: { dagger: true },
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
  state.floats.push({
    x,
    y,
    text,
    color,
    crit,
    life: crit ? 1.1 : 0.8,
    vy: crit ? -70 : -50,
  });
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
    beep(880, 0.1, "sine", 0.03);
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
    const xpBonus = 1 + Math.min(0.5, p.combo * 0.05);
    gainXp(p, Math.floor(m.xp * xpBonus));
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
  const final = Math.floor(dmg * (crit ? 1.85 : 1) * (p.rageT > 0 ? 1.35 : 1) * (1 + Math.min(0.4, p.combo * 0.04)));
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
  p.attackCd = w.cd * (p.rageT > 0 ? 0.7 : 1);
  p.attackFlash = 0.2;
  const reach = w.reach;
  const base = w.dmg + Math.floor((p.level - 1) * 1.8);
  let hits = 0;
  for (const m of state.monsters) {
    if (!m.alive) continue;
    const dx = m.x - p.x;
    const dy = m.y - p.y;
    const inFront = p.facing > 0 ? dx > -14 : dx < 14;
    if (inFront && Math.hypot(dx, dy) < reach + m.w * 0.3) {
      hurtMonster(m, base, w.color, 18);
      hits += 1;
    }
  }
  ring(p.x + p.facing * 24, p.y - 10, w.color, reach * 0.55, 0.22);
  if (hits) shake = Math.max(shake, 3);
  else beep(180, 0.03, "triangle", 0.015);
}

function useAbility(id) {
  const p = state.player;
  if (!p || !running) return;
  if ((p.cds[id] || 0) > 0) return;

  if (id === "dash") {
    p.cds.dash = ABILITIES[0].cd;
    p.dashT = 0.24;
    p.invuln = 0.28;
    p.x = clamp(p.x + p.facing * 110, 30, WORLD_W - 30);
    for (let i = 0; i < 10; i++) {
      burst(p.x - p.facing * i * 10, p.y - 20, "#67e8f9", 2, 60);
    }
    ring(p.x, p.y, "#67e8f9", 70, 0.35);
    toast("💨 Сверхрывок");
    beep(520, 0.07, "sine", 0.04);
  }

  if (id === "bolt") {
    p.cds.bolt = ABILITIES[1].cd;
    const targets = state.monsters
      .filter((m) => m.alive && dist(m, p) < 260)
      .sort((a, b) => dist(a, p) - dist(b, p))
      .slice(0, 5);
    if (!targets.length) {
      toast("Нет целей для молнии");
      p.cds.bolt = 0.6;
      return;
    }
    let prev = { x: p.x, y: p.y - 30 };
    for (const m of targets) {
      state.bolts.push({ x1: prev.x, y1: prev.y, x2: m.x, y2: m.y - m.h * 0.5, life: 0.28 });
      hurtMonster(m, 26 + p.level * 3, "#c4b5fd", 10);
      prev = { x: m.x, y: m.y - m.h * 0.5 };
    }
    shake = Math.max(shake, 7);
    toast("⚡ Цепная молния");
    beep(740, 0.09, "sawtooth", 0.035);
  }

  if (id === "nova") {
    p.cds.nova = ABILITIES[2].cd;
    ring(p.x, p.y, "#f97316", 160, 0.55);
    ring(p.x, p.y, "#fb7185", 110, 0.4);
    burst(p.x, p.y - 10, "#f97316", 30, 280);
    for (const m of state.monsters) {
      if (!m.alive) continue;
      if (dist(m, p) < 150) hurtMonster(m, 34 + p.level * 2, "#fdba74", 28);
    }
    shake = Math.max(shake, 9);
    toast("🔥 Адский круг");
    beep(160, 0.12, "sawtooth", 0.045);
  }

  if (id === "rage") {
    p.cds.rage = ABILITIES[3].cd;
    p.rageT = 6;
    p.hp = Math.min(p.maxHp, p.hp + 25);
    ring(p.x, p.y, "#fb7185", 100, 0.6);
    burst(p.x, p.y - 20, "#fb7185", 20, 200);
    toast("🩸 Берсерк 6с · +урон +скорость");
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
      const dmg = m.dmg;
      p.hp -= dmg;
      p.invuln = 0.4;
      p.combo = 0;
      p.comboT = 0;
      ui.comboChip.hidden = true;
      burst(p.x, p.y - 28, "#fb7185", 10);
      floatText(p.x, p.y - 50, `-${dmg}`, "#fb7185");
      shake = Math.max(shake, 5);
      beep(90, 0.08, "square", 0.04);
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
  ui.deadStats.textContent = `Ур.${p.level} · убийств ${p.kills} · боссов ${p.bosses} · золото ${p.gold} · макс комбо было`;
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
    const sp = (122 + p.level * 2.2) * (p.dashT > 0 ? 2.8 : 1) * (p.rageT > 0 ? 1.25 : 1);
    p.x = clamp(p.x + (mx / len) * sp * dt, 30, WORLD_W - 30);
    p.y = clamp(p.y + (my / len) * sp * dt * 0.9, 30, WORLD_H - 30);
    p.anim += dt * 9;
    p.trail.push({ x: p.x, y: p.y, life: 0.35 });
    if (p.trail.length > 12) p.trail.shift();
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
    const pct = cd > 0 ? (cd / a.cd) * 100 : 0;
    return `<button type="button" class="ability-slot ${a.cls} ${cd <= 0 ? "is-ready" : ""}" data-ability="${a.id}">
      <span class="key">${a.key}</span>
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

  // soft light under player
  if (state.player) {
    const px = state.player.x - cam.x;
    const py = state.player.y - cam.y;
    const light = ctx.createRadialGradient(px, py, 10, px, py, 220);
    light.addColorStop(0, state.player.rageT > 0 ? "rgba(251,113,133,0.16)" : "rgba(34,211,238,0.12)");
    light.addColorStop(1, "transparent");
    ctx.fillStyle = light;
    ctx.fillRect(px - 220, py - 220, 440, 440);
  }
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
  const layers = [
    { oy: -t.h * 0.52, r: 30 * t.shade, c: "#14532d" },
    { oy: -t.h * 0.7, r: 25 * t.shade, c: "#166534" },
    { oy: -t.h * 0.88, r: 18 * t.shade, c: "#22c55e" },
  ];
  for (const L of layers) {
    ctx.fillStyle = L.c;
    ctx.beginPath();
    ctx.ellipse(x, y + L.oy, L.r, L.r * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(187,247,208,0.15)";
  ctx.beginPath();
  ctx.ellipse(x - 6, y - t.h * 0.85, 8, 5, 0, 0, Math.PI * 2);
  ctx.fill();
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
  ctx.fillStyle = "#cbd5e1";
  ctx.beginPath();
  ctx.ellipse(x - r.r * 0.25, y - r.r * 0.4, r.r * 0.3, r.r * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHero(p) {
  const x = p.x - cam.x;
  const y = p.y - cam.y;
  const bob = p.moving ? Math.sin(p.anim) * 2.5 : 0;
  const f = p.facing;
  const wpn = weaponOf(p);

  // dash trails
  for (const t of p.trail) {
    ctx.globalAlpha = t.life * 0.45;
    ctx.fillStyle = p.rageT > 0 ? "#fb7185" : "#67e8f9";
    ctx.beginPath();
    ctx.ellipse(t.x - cam.x, t.y - cam.y, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(x, y);
  if (p.invuln > 0 && ((state.time * 22) | 0) % 2 === 0) ctx.globalAlpha = 0.4;

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 5, 17, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  if (p.rageT > 0) {
    ctx.strokeStyle = `rgba(251,113,133,${0.35 + Math.sin(state.time * 10) * 0.2})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -20, 34, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.translate(0, bob - 6);
  const leg = p.moving ? Math.sin(p.anim) * 8 : 0;
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(-9 + leg * 0.2, 10, 7, 15);
  ctx.fillRect(2 - leg * 0.2, 10, 7, 15);

  const body = ctx.createLinearGradient(-14, -30, 14, 12);
  body.addColorStop(0, p.rageT > 0 ? "#fda4af" : "#a5f3fc");
  body.addColorStop(1, p.rageT > 0 ? "#be123c" : "#0e7490");
  ctx.fillStyle = body;
  roundRect(-13, -28, 26, 38, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.stroke();

  ctx.fillStyle = "#f97316";
  ctx.fillRect(-13, -2, 26, 6);

  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(0, -38, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(-2 * f, -42, 10, Math.PI * 1.05, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#22d3ee";
  ctx.beginPath();
  ctx.arc(5 * f, -38, 2.4, 0, Math.PI * 2);
  ctx.fill();

  const swing = p.attackFlash > 0 ? (0.2 - p.attackFlash) / 0.2 : 0;
  ctx.save();
  ctx.translate(10 * f, -10);
  ctx.rotate(f * (-0.7 + swing * 2.1));
  ctx.shadowColor = wpn.color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = wpn.color;
  ctx.fillRect(0, -3.5, (wpn.reach || 48) * 0.72, 7);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fbbf24";
  ctx.fillRect(-5, -6, 12, 12);
  ctx.restore();

  if (p.attackFlash > 0) {
    ctx.strokeStyle = `rgba(253,230,138,${p.attackFlash * 5})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, -12, wpn.reach * 0.65, f > 0 ? -1.2 : Math.PI - 0.15, f > 0 ? 0.55 : Math.PI + 1.2);
    ctx.stroke();
  }

  ctx.restore();
  ctx.fillStyle = "#67e8f9";
  ctx.font = "700 12px Chakra Petch, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(p.name, x, y - 68);
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
    aura.addColorStop(0, m.color + "55");
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
  const hg = ctx.createLinearGradient(x - bw / 2, 0, x + bw / 2, 0);
  hg.addColorStop(0, m.boss ? "#f59e0b" : "#fb7185");
  hg.addColorStop(1, m.boss ? "#fde68a" : "#fecaca");
  ctx.fillStyle = hg;
  ctx.fillRect(x - bw / 2, y - m.h - 16, bw * clamp(m.hp / m.maxHp, 0, 1), 6);
  ctx.fillStyle = m.boss ? "#fde68a" : "#e2e8f0";
  ctx.font = m.boss ? "700 12px Orbitron, sans-serif" : "600 10px Manrope, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(m.name, x, y - m.h - 20);
}

function drawDrop(d) {
  const x = d.x - cam.x;
  const y = d.y - cam.y + Math.sin(d.bob) * 4;
  if (x < -20 || x > W + 20) return;
  if (d.kind === "gold") {
    ctx.shadowColor = "#fbbf24";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fef3c7";
    ctx.beginPath();
    ctx.arc(x - 2, y - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
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
    const mx = (b.x1 + b.x2) / 2 + rand(-8, 8);
    const my = (b.y1 + b.y2) / 2 + rand(-12, 12);
    ctx.quadraticCurveTo(mx - cam.x, my - cam.y, b.x2 - cam.x, b.y2 - cam.y);
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
  for (const w of WEAPONS) {
    if (w.id === "dagger") continue;
    const owned = !!p.owned[w.id];
    const row = document.createElement("div");
    row.className = "shop-item";
    row.innerHTML = `<div><h3>${w.name}</h3><p>Урон ${w.dmg} · радиус ${w.reach}</p></div>`;
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
  for (const it of [
    { name: "Зелье жизни", desc: "+55 HP", cost: 22, fn: () => (p.hp = Math.min(p.maxHp, p.hp + 55)) },
    { name: "Эликсир опыта", desc: "Почти до след. уровня", cost: 90, fn: () => gainXp(p, xpToLevel(p.level) - p.xp) },
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
      updateHud();
    };
    row.appendChild(btn);
    ui.shopList.appendChild(row);
  }
}

function startGame() {
  if (audioCtx?.state === "suspended") audioCtx.resume();
  else beep(440, 0.01, "sine", 0.001);
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
    const map = { 1: "dash", 2: "bolt", 3: "nova", 4: "rage" };
    useAbility(map[btn.dataset.skill]);
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
