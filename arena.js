/**
 * FUTURUM Realm — вид «в три четверти»: герой на поле, деревья, монстры, боссы, золото.
 */

const WORLD_W = 3200;
const WORLD_H = 2200;

const WEAPONS = [
  { id: "dagger", name: "Кинжал", dmg: 8, range: 42, cd: 0.32, price: 0 },
  { id: "sword", name: "Меч странника", dmg: 14, range: 52, cd: 0.38, price: 60 },
  { id: "axe", name: "Секира", dmg: 22, range: 58, cd: 0.55, price: 140 },
  { id: "spear", name: "Копьё бури", dmg: 18, reach: 78, cd: 0.42, price: 220 },
  { id: "blade", name: "Клинок FUTURUM", dmg: 32, reach: 70, cd: 0.34, price: 420 },
];

const MONSTER_TYPES = {
  slime: {
    name: "Слайм",
    hp: 28,
    dmg: 6,
    speed: 55,
    xp: 8,
    gold: [2, 6],
    color: "#4ade80",
    w: 28,
    h: 22,
    boss: false,
  },
  wolf: {
    name: "Волк",
    hp: 45,
    dmg: 10,
    speed: 95,
    xp: 14,
    gold: [4, 10],
    color: "#94a3b8",
    w: 36,
    h: 28,
    boss: false,
  },
  skeleton: {
    name: "Скелет",
    hp: 70,
    dmg: 14,
    speed: 70,
    xp: 22,
    gold: [8, 16],
    color: "#e2e8f0",
    w: 26,
    h: 44,
    boss: false,
  },
  brute: {
    name: "Громила",
    hp: 140,
    dmg: 20,
    speed: 48,
    xp: 40,
    gold: [16, 30],
    color: "#fb7185",
    w: 42,
    h: 52,
    boss: false,
  },
  boss_golem: {
    name: "Каменный страж",
    hp: 520,
    dmg: 28,
    speed: 42,
    xp: 180,
    gold: [80, 140],
    color: "#f59e0b",
    w: 70,
    h: 90,
    boss: true,
  },
  boss_wraith: {
    name: "Теневой лорд",
    hp: 680,
    dmg: 34,
    speed: 70,
    xp: 240,
    gold: [120, 200],
    color: "#a78bfa",
    w: 56,
    h: 86,
    boss: true,
  },
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
  weaponName: document.getElementById("weapon-name"),
  weaponMeta: document.getElementById("weapon-meta"),
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
let keys = {};
let stickVec = { x: 0, y: 0 };
let attackHeld = false;

const state = {
  player: null,
  monsters: [],
  drops: [],
  trees: [],
  rocks: [],
  effects: [],
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
  toastTimer = setTimeout(() => ui.toast.classList.remove("is-on"), 1700);
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
    x: rand(400, WORLD_W - 400),
    y: rand(400, WORLD_H - 400),
    facing: 1,
    hp: 100,
    maxHp: 100,
    gold: 15,
    xp: 0,
    level: 1,
    weaponId: "dagger",
    owned: { dagger: true },
    attackCd: 0,
    attackFlash: 0,
    dashCd: 0,
    dashT: 0,
    invuln: 0,
    anim: 0,
    moving: false,
    kills: 0,
    bosses: 0,
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
  for (let i = 0; i < 120; i++) {
    state.trees.push({
      x: rand(80, WORLD_W - 80),
      y: rand(80, WORLD_H - 80),
      h: rand(70, 130),
      trunk: rand(8, 14),
      shade: rand(0.85, 1.1),
    });
  }
  state.rocks = [];
  for (let i = 0; i < 40; i++) {
    state.rocks.push({
      x: rand(60, WORLD_W - 60),
      y: rand(60, WORLD_H - 60),
      r: rand(12, 28),
    });
  }

  state.monsters = [];
  const packs = [
    ...Array(22).fill("slime"),
    ...Array(16).fill("wolf"),
    ...Array(12).fill("skeleton"),
    ...Array(7).fill("brute"),
  ];
  for (const typeId of packs) {
    state.monsters.push(makeMonster(typeId, rand(120, WORLD_W - 120), rand(120, WORLD_H - 120)));
  }

  state.drops = [];
  state.effects = [];
  state.bossesSpawned = { golem: false, wraith: false };
}

function spawnDrop(x, y, kind, amount, extra = {}) {
  state.drops.push({
    x: x + rand(-16, 16),
    y: y + rand(-10, 10),
    kind,
    amount,
    ...extra,
    bob: rand(0, Math.PI * 2),
    life: 45,
  });
}

function gainXp(p, amount) {
  p.xp += amount;
  while (p.xp >= xpToLevel(p.level)) {
    p.xp -= xpToLevel(p.level);
    p.level += 1;
    p.maxHp += 12;
    p.hp = p.maxHp;
    toast(`Уровень ${p.level}! +HP`);
  }
}

function killMonster(m, byPlayer) {
  if (!m.alive) return;
  m.alive = false;
  const [g0, g1] = m.gold;
  const gold = irand(g0, g1);
  spawnDrop(m.x, m.y, "gold", gold);
  if (Math.random() < 0.18) spawnDrop(m.x, m.y, "heart", 20);
  if (m.boss) spawnDrop(m.x, m.y, "chest", 1);
  if (byPlayer) {
    const p = state.player;
    p.kills += 1;
    if (m.boss) p.bosses += 1;
    gainXp(p, m.xp);
    toast(`${m.name} повержен · +${gold}◆`);
  }
  burst(m.x, m.y - 20, m.color, 16);

  setTimeout(() => {
    if (!running) return;
    if (m.boss) return;
    const types = ["slime", "slime", "wolf", "skeleton", "brute"];
    const t = types[(Math.random() * types.length) | 0];
    state.monsters.push(makeMonster(t, rand(100, WORLD_W - 100), rand(100, WORLD_H - 100)));
  }, 4000);
}

function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(40, 180);
    state.effects.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 40,
      life: rand(0.25, 0.7),
      color,
      r: rand(2, 5),
    });
  }
}

function tryAttack() {
  const p = state.player;
  if (!p || p.attackCd > 0) return;
  const w = weaponOf(p);
  p.attackCd = w.cd;
  p.attackFlash = 0.18;
  const reach = w.reach || 48;
  const dmg = w.dmg + Math.floor((p.level - 1) * 1.6);
  let hit = false;
  for (const m of state.monsters) {
    if (!m.alive) continue;
    const dx = m.x - p.x;
    const dy = m.y - p.y;
    const inFront = p.facing > 0 ? dx > -10 : dx < 10;
    if (inFront && Math.hypot(dx, dy) < reach + m.w * 0.35) {
      m.hp -= dmg;
      m.hitFlash = 0.15;
      m.x += p.facing * 14;
      burst(m.x, m.y - m.h * 0.4, "#fecaca", 6);
      hit = true;
      if (m.hp <= 0) killMonster(m, true);
    }
  }
  if (hit) burst(p.x + p.facing * 28, p.y - 24, "#fde68a", 4);
}

function useDash() {
  const p = state.player;
  if (!p || p.dashCd > 0) return;
  p.dashCd = 3.5;
  p.dashT = 0.2;
  p.invuln = 0.25;
  toast("Рывок");
}

function pickup() {
  const p = state.player;
  let best = null;
  let bestD = 36;
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
    toast(`+${best.amount} золота`);
  } else if (best.kind === "heart") {
    p.hp = Math.min(p.maxHp, p.hp + best.amount);
    toast(`+${best.amount} HP`);
  } else if (best.kind === "chest") {
    p.gold += 50;
    gainXp(p, 40);
    toast("Сундук босса!");
  }
  state.drops = state.drops.filter((x) => x !== best);
}

function zoneName(p) {
  if (p.x < WORLD_W * 0.33) return "Тихие поля";
  if (p.x < WORLD_W * 0.66) return "Тёмный лес";
  return "Руины стража";
}

function maybeSpawnBosses() {
  const p = state.player;
  if (!p) return;
  if (!state.bossesSpawned.golem && p.level >= 3) {
    state.bossesSpawned.golem = true;
    state.monsters.push(makeMonster("boss_golem", WORLD_W * 0.72, WORLD_H * 0.35));
    toast("Пробудился Каменный страж!");
  }
  if (!state.bossesSpawned.wraith && p.level >= 5) {
    state.bossesSpawned.wraith = true;
    state.monsters.push(makeMonster("boss_wraith", WORLD_W * 0.82, WORLD_H * 0.7));
    toast("Теневой лорд явился!");
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
  const aggro = m.boss ? 420 : 210;

  if (p && d < aggro) {
    const ang = Math.atan2(p.y - m.y, p.x - m.x);
    m.facing = Math.cos(ang) >= 0 ? 1 : -1;
    const stop = m.boss ? 48 : 34;
    if (d > stop) {
      m.x += Math.cos(ang) * m.speed * dt;
      m.y += Math.sin(ang) * m.speed * dt * 0.85;
    } else if (m.attackCd <= 0 && p.invuln <= 0) {
      m.attackCd = m.boss ? 1.1 : 0.85;
      p.hp -= m.dmg;
      p.invuln = 0.45;
      burst(p.x, p.y - 30, "#fb7185", 8);
      if (p.hp <= 0) onPlayerDead();
    }
  } else {
    if (m.retarget <= 0) {
      m.retarget = rand(1, 2.5);
      m.wander = rand(0, Math.PI * 2);
    }
    m.x += Math.cos(m.wander) * m.speed * 0.35 * dt;
    m.y += Math.sin(m.wander) * m.speed * 0.3 * dt;
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
}

function update(dt) {
  state.time += dt;
  const p = state.player;
  if (!p) return;

  p.attackCd = Math.max(0, p.attackCd - dt);
  p.attackFlash = Math.max(0, p.attackFlash - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.dashT = Math.max(0, p.dashT - dt);
  p.invuln = Math.max(0, p.invuln - dt);

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
    const sp = (118 + p.level * 2) * (p.dashT > 0 ? 2.6 : 1);
    p.x = clamp(p.x + (mx / len) * sp * dt, 30, WORLD_W - 30);
    p.y = clamp(p.y + (my / len) * sp * dt * 0.9, 30, WORLD_H - 30);
    p.anim += dt * 8;
  }

  if (attackHeld && ui.shop.hidden) tryAttack();

  for (const m of state.monsters) updateMonster(m, dt);

  // auto gold pickup close
  state.drops = state.drops.filter((d) => {
    d.bob += dt * 4;
    d.life -= dt;
    if (d.kind === "gold" && dist(p, d) < 28) {
      p.gold += d.amount;
      return false;
    }
    return d.life > 0;
  });

  for (const e of state.effects) {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.vy += 220 * dt;
    e.life -= dt;
  }
  state.effects = state.effects.filter((e) => e.life > 0);

  maybeSpawnBosses();
  ui.zone.textContent = zoneName(p);

  cam.x = clamp(p.x - W * 0.5, 0, Math.max(0, WORLD_W - W));
  cam.y = clamp(p.y - H * 0.62, 0, Math.max(0, WORLD_H - H));
  updateHud();
}

function updateHud() {
  const p = state.player;
  ui.hpBar.style.transform = `scaleX(${clamp(p.hp / p.maxHp, 0, 1)})`;
  ui.xpBar.style.transform = `scaleX(${clamp(p.xp / xpToLevel(p.level), 0, 1)})`;
  ui.lvlChip.textContent = `LVL ${p.level}`;
  ui.goldChip.textContent = `◆ ${p.gold}`;
  const w = weaponOf(p);
  ui.weaponName.textContent = w.name;
  ui.weaponMeta.textContent = `урон ${w.dmg + Math.floor((p.level - 1) * 1.6)}`;
}

/* ---------- drawing (side / 3/4 character view) ---------- */

function drawGround() {
  ctx.fillStyle = "#1a2a1f";
  ctx.fillRect(0, 0, W, H);

  // parallax sky band at top of camera if near north
  const skyH = 120;
  const g = ctx.createLinearGradient(0, 0, 0, skyH);
  g.addColorStop(0, "#0b1524");
  g.addColorStop(1, "rgba(26,42,31,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, skyH);

  const cell = 64;
  const ox = -((cam.x / cell) % 1) * cell;
  const oy = -((cam.y / cell) % 1) * cell;
  for (let y = oy - cell; y < H + cell; y += cell) {
    for (let x = ox - cell; x < W + cell; x += cell) {
      const wx = cam.x + x;
      const wy = cam.y + y;
      const n = Math.sin(wx * 0.01) * Math.cos(wy * 0.01);
      ctx.fillStyle = n > 0.15 ? "#203528" : n < -0.2 ? "#16241c" : "#1c2f23";
      ctx.fillRect(x, y, cell + 1, cell + 1);
      if (((wx / cell) | 0) % 3 === 0 && ((wy / cell) | 0) % 2 === 0) {
        ctx.fillStyle = "rgba(74,222,128,0.05)";
        ctx.beginPath();
        ctx.ellipse(x + 20, y + 28, 10, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawTree(t) {
  const x = t.x - cam.x;
  const y = t.y - cam.y;
  if (x < -80 || x > W + 80 || y < -20 || y > H + 160) return;

  // shadow on ground
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(x, y + 6, 22 * t.shade, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // trunk
  ctx.fillStyle = "#5b3a22";
  ctx.fillRect(x - t.trunk / 2, y - t.h * 0.45, t.trunk, t.h * 0.5);

  // foliage layers (side-view canopy)
  const layers = [
    { oy: -t.h * 0.55, r: 28 * t.shade, c: "#166534" },
    { oy: -t.h * 0.72, r: 24 * t.shade, c: "#15803d" },
    { oy: -t.h * 0.88, r: 18 * t.shade, c: "#22c55e" },
  ];
  for (const L of layers) {
    ctx.fillStyle = L.c;
    ctx.beginPath();
    ctx.ellipse(x, y + L.oy, L.r, L.r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRock(r) {
  const x = r.x - cam.x;
  const y = r.y - cam.y;
  if (x < -40 || x > W + 40 || y < -40 || y > H + 40) return;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(x, y + 4, r.r * 0.9, r.r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#64748b";
  ctx.beginPath();
  ctx.ellipse(x, y - r.r * 0.2, r.r, r.r * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#94a3b8";
  ctx.beginPath();
  ctx.ellipse(x - r.r * 0.25, y - r.r * 0.35, r.r * 0.35, r.r * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHero(p) {
  const x = p.x - cam.x;
  const y = p.y - cam.y;
  const bob = p.moving ? Math.sin(p.anim) * 2 : 0;
  const f = p.facing;

  ctx.save();
  ctx.translate(x, y);
  if (p.invuln > 0 && ((state.time * 20) | 0) % 2 === 0) ctx.globalAlpha = 0.45;

  // ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 4, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(0, bob - 6);

  // legs
  const legSwing = p.moving ? Math.sin(p.anim) * 7 : 0;
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(-8 + legSwing * 0.15, 8, 6, 14);
  ctx.fillRect(2 - legSwing * 0.15, 8, 6, 14);

  // body
  const body = ctx.createLinearGradient(-12, -28, 12, 10);
  body.addColorStop(0, "#67e8f9");
  body.addColorStop(1, "#0e7490");
  ctx.fillStyle = body;
  roundRect(-11, -26, 22, 34, 7);
  ctx.fill();

  // scarf / belt
  ctx.fillStyle = "#f97316";
  ctx.fillRect(-11, -4, 22, 5);

  // head
  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(0, -36, 11, 0, Math.PI * 2);
  ctx.fill();

  // hair
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(-2 * f, -40, 9, Math.PI, Math.PI * 2);
  ctx.fill();

  // eye
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(4 * f, -36, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // weapon swing
  const w = weaponOf(p);
  const swing = p.attackFlash > 0 ? (0.18 - p.attackFlash) / 0.18 : 0;
  const ang = f * (-0.6 + swing * 1.8);
  ctx.save();
  ctx.translate(8 * f, -8);
  ctx.rotate(ang);
  ctx.fillStyle = "#cbd5e1";
  ctx.fillRect(0, -3, w.reach ? w.reach * 0.7 : 34, 6);
  ctx.fillStyle = "#fbbf24";
  ctx.fillRect(-4, -5, 10, 10);
  ctx.restore();

  // attack arc
  if (p.attackFlash > 0) {
    ctx.strokeStyle = `rgba(253,230,138,${p.attackFlash * 4})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -10, (w.reach || 48) * 0.7, f > 0 ? -1.1 : Math.PI - 0.2, f > 0 ? 0.5 : Math.PI + 1.1);
    ctx.stroke();
  }

  ctx.restore();

  // nametag
  ctx.fillStyle = "#67e8f9";
  ctx.font = "700 12px Chakra Petch, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(p.name, x, y - 64);
}

function drawMonster(m) {
  if (!m.alive) return;
  const x = m.x - cam.x;
  const y = m.y - cam.y;
  if (x < -100 || x > W + 100 || y < -120 || y > H + 80) return;

  const bob = Math.sin(m.anim * 4) * (m.boss ? 3 : 2);
  ctx.save();
  ctx.translate(x, y + bob);
  if (m.hitFlash > 0) ctx.filter = "brightness(2)";

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(0, 6, m.w * 0.45, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  if (m.typeId === "slime") {
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.ellipse(0, -8, m.w * 0.45, m.h * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#052e16";
    ctx.beginPath();
    ctx.arc(-6 * m.facing, -12, 3, 0, Math.PI * 2);
    ctx.arc(4 * m.facing, -12, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (m.typeId === "wolf") {
    ctx.fillStyle = m.color;
    roundRect(-m.w / 2, -m.h, m.w, m.h * 0.7, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(m.facing * 16, -m.h * 0.7, 12, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(m.facing * 20, -m.h * 0.75, 8, 3);
  } else {
    // biped: skeleton / brute / bosses
    ctx.fillStyle = m.color;
    roundRect(-m.w * 0.28, -m.h * 0.75, m.w * 0.56, m.h * 0.55, 6);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -m.h * 0.85, m.boss ? 16 : 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = m.boss ? "#7f1d1d" : "#0f172a";
    ctx.beginPath();
    ctx.arc(-5, -m.h * 0.88, 2.5, 0, Math.PI * 2);
    ctx.arc(5, -m.h * 0.88, 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (m.boss) {
      ctx.strokeStyle = "rgba(251,191,36,0.65)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -m.h * 0.5, m.w * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.filter = "none";
  ctx.restore();

  // hp bar
  const bw = Math.max(28, m.w);
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(x - bw / 2, y - m.h - 14, bw, 5);
  ctx.fillStyle = m.boss ? "#fbbf24" : "#fb7185";
  ctx.fillRect(x - bw / 2, y - m.h - 14, bw * clamp(m.hp / m.maxHp, 0, 1), 5);

  ctx.fillStyle = m.boss ? "#fde68a" : "#cbd5e1";
  ctx.font = m.boss ? "700 12px Orbitron, sans-serif" : "600 10px Manrope, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(m.name, x, y - m.h - 18);
}

function drawDrop(d) {
  const x = d.x - cam.x;
  const y = d.y - cam.y + Math.sin(d.bob) * 3;
  if (x < -20 || x > W + 20 || y < -20 || y > H + 20) return;
  if (d.kind === "gold") {
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.arc(x - 2, y - 2, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (d.kind === "heart") {
    ctx.fillStyle = "#fb7185";
    ctx.beginPath();
    ctx.arc(x - 4, y, 5, 0, Math.PI * 2);
    ctx.arc(x + 4, y, 5, 0, Math.PI * 2);
    ctx.moveTo(x - 8, y + 2);
    ctx.lineTo(x, y + 12);
    ctx.lineTo(x + 8, y + 2);
    ctx.fill();
  } else {
    ctx.fillStyle = "#b45309";
    ctx.fillRect(x - 10, y - 6, 20, 14);
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(x - 10, y - 10, 20, 6);
  }
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

function draw() {
  drawGround();

  // depth sort props + actors by y
  const sprites = [];
  for (const t of state.trees) sprites.push({ y: t.y, draw: () => drawTree(t) });
  for (const r of state.rocks) sprites.push({ y: r.y, draw: () => drawRock(r) });
  for (const d of state.drops) sprites.push({ y: d.y, draw: () => drawDrop(d) });
  for (const m of state.monsters) {
    if (m.alive) sprites.push({ y: m.y, draw: () => drawMonster(m) });
  }
  if (state.player) sprites.push({ y: state.player.y, draw: () => drawHero(state.player) });
  sprites.sort((a, b) => a.y - b.y);
  for (const s of sprites) s.draw();

  for (const e of state.effects) {
    ctx.globalAlpha = clamp(e.life * 2, 0, 1);
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x - cam.x, e.y - cam.y, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75);
  vg.addColorStop(0, "transparent");
  vg.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function loop(ts) {
  const dt = Math.min(0.033, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  if (running) update(dt);
  draw();
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
    row.innerHTML = `<div><h3>${w.name}</h3><p>Урон ${w.dmg} · досягаемость ${w.reach || 48}</p></div>`;
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
        toast(`Куплено: ${w.name}`);
      }
      renderShop();
      updateHud();
    };
    row.appendChild(btn);
    ui.shopList.appendChild(row);
  }

  const heals = [
    { name: "Зелье жизни", desc: "+50 HP", cost: 20, fn: () => (p.hp = Math.min(p.maxHp, p.hp + 50)) },
    { name: "Эликсир силы", desc: "+1 уровень оружия (бонус к урону через lvl)", cost: 80, fn: () => gainXp(p, xpToLevel(p.level)) },
  ];
  for (const it of heals) {
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
  const name = (ui.name.value || "Странник").trim().slice(0, 14);
  buildWorld();
  state.player = makePlayer(name);
  ui.boot.hidden = true;
  ui.dead.hidden = true;
  ui.hud.hidden = false;
  ui.shop.hidden = true;
  if (matchMedia("(pointer: coarse)").matches) ui.touch.hidden = false;
  running = true;
  toast(`Вы появились в мире · ${state.player.x | 0}, ${state.player.y | 0}`);
  updateHud();
}

function respawn() {
  const old = state.player;
  state.player = makePlayer(old.name);
  state.player.gold = Math.floor(old.gold * 0.6);
  state.player.level = Math.max(1, old.level - 1);
  state.player.owned = { ...old.owned };
  state.player.weaponId = old.weaponId;
  state.player.maxHp = 100 + (state.player.level - 1) * 12;
  state.player.hp = state.player.maxHp;
  ui.dead.hidden = true;
  running = true;
  toast("Вы воскресли");
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
  if (e.key === "1") useDash();
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

// touch
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
const fireBtn = document.getElementById("fire-btn");
fireBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  attackHeld = true;
  tryAttack();
});
fireBtn.addEventListener("pointerup", () => {
  attackHeld = false;
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
