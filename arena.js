/**
 * FUTURUM Arena — браузерная арена 1000×1000.
 * Одиночный режим с ботами (мультиплеер потребует сервер).
 */

const WORLD = 1000;
const BOT_COUNT = 18;
const LOOT_COUNT = 40;

const WEAPONS = {
  pistol: {
    id: "pistol",
    name: "Пистолет",
    dmg: 12,
    rate: 0.28,
    speed: 420,
    spread: 0.06,
    range: 380,
    color: "#94a3b8",
    price: 0,
  },
  smg: {
    id: "smg",
    name: "ПП «Шёпот»",
    dmg: 8,
    rate: 0.09,
    speed: 480,
    spread: 0.14,
    range: 320,
    color: "#67e8f9",
    price: 90,
  },
  shotgun: {
    id: "shotgun",
    name: "Дробовик",
    dmg: 9,
    rate: 0.7,
    speed: 380,
    spread: 0.28,
    range: 220,
    pellets: 5,
    color: "#fb7185",
    price: 140,
  },
  rifle: {
    id: "rifle",
    name: "Винтовка",
    dmg: 28,
    rate: 0.55,
    speed: 620,
    spread: 0.02,
    range: 520,
    color: "#fbbf24",
    price: 220,
  },
  laser: {
    id: "laser",
    name: "Луч FUTURUM",
    dmg: 18,
    rate: 0.16,
    speed: 700,
    spread: 0.01,
    range: 560,
    color: "#22d3ee",
    price: 360,
  },
};

const ABILITIES = [
  { id: "dash", name: "Рывок", key: "1", cd: 4 },
  { id: "shield", name: "Щит", key: "2", cd: 10 },
  { id: "pulse", name: "Импульс", key: "3", cd: 8 },
  { id: "heal", name: "Наногель", key: "4", cd: 12 },
];

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const minimap = document.getElementById("minimap");
const mctx = minimap.getContext("2d");

const ui = {
  boot: document.getElementById("boot"),
  hud: document.getElementById("hud"),
  shop: document.getElementById("shop"),
  dead: document.getElementById("dead"),
  touch: document.getElementById("touch"),
  name: document.getElementById("player-name"),
  hpBar: document.getElementById("hp-bar"),
  scrapChip: document.getElementById("scrap-chip"),
  killChip: document.getElementById("kill-chip"),
  weaponName: document.getElementById("weapon-name"),
  weaponAmmo: document.getElementById("weapon-ammo"),
  weaponLvl: document.getElementById("weapon-lvl"),
  abilities: document.getElementById("abilities"),
  toast: document.getElementById("toast"),
  coords: document.getElementById("coords"),
  shopList: document.getElementById("shop-list"),
  shopScrap: document.getElementById("shop-scrap"),
  deadStats: document.getElementById("dead-stats"),
  stick: document.getElementById("stick"),
  stickKnob: document.getElementById("stick-knob"),
};

let W = 0;
let H = 0;
let running = false;
let shopTab = "weapons";
let toastTimer = 0;
let cam = { x: 0, y: 0 };
let mouse = { x: 0, y: 0, down: false };
let keys = {};
let stickVec = { x: 0, y: 0 };
let fireTouch = false;
let lastTs = 0;

const state = {
  player: null,
  bots: [],
  bullets: [],
  loot: [],
  particles: [],
  obstacles: [],
  time: 0,
};

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("is-on"), 1800);
}

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function randomPoint(margin = 40) {
  return {
    x: rand(margin, WORLD - margin),
    y: rand(margin, WORLD - margin),
  };
}

function makeActor(name, isPlayer = false) {
  const p = randomPoint();
  const hues = [190, 160, 25, 350, 280, 45];
  return {
    id: Math.random().toString(36).slice(2, 9),
    name,
    isPlayer,
    x: p.x,
    y: p.y,
    vx: 0,
    vy: 0,
    angle: rand(0, Math.PI * 2),
    hp: 100,
    maxHp: 100,
    speed: isPlayer ? 145 : rand(90, 130),
    radius: 14,
    scrap: isPlayer ? 40 : 0,
    kills: 0,
    weaponId: "pistol",
    weaponLvl: 1,
    owned: { pistol: true },
    fireCd: 0,
    dashCd: 0,
    shieldCd: 0,
    pulseCd: 0,
    healCd: 0,
    shieldT: 0,
    dashT: 0,
    hue: hues[(Math.random() * hues.length) | 0],
    ai: isPlayer
      ? null
      : {
          aim: rand(0, Math.PI * 2),
          retarget: 0,
          aggression: Math.random(),
        },
    alive: true,
  };
}

function buildWorld() {
  state.obstacles = [];
  for (let i = 0; i < 55; i++) {
    const p = randomPoint(60);
    state.obstacles.push({
      x: p.x,
      y: p.y,
      w: rand(28, 70),
      h: rand(28, 70),
      kind: Math.random() > 0.5 ? "crate" : "rock",
    });
  }

  state.loot = [];
  for (let i = 0; i < LOOT_COUNT; i++) spawnLoot();

  state.bots = [];
  for (let i = 0; i < BOT_COUNT; i++) {
    state.bots.push(makeActor(`Бот-${i + 1}`));
  }
  state.bullets = [];
  state.particles = [];
}

function spawnLoot(near = null) {
  const kinds = [
    { type: "scrap", amount: 8 + ((Math.random() * 18) | 0), color: "#fbbf24" },
    { type: "scrap", amount: 15 + ((Math.random() * 25) | 0), color: "#f59e0b" },
    { type: "med", amount: 25, color: "#4ade80" },
    { type: "ammo", amount: 1, color: "#67e8f9" },
  ];
  if (Math.random() < 0.12) {
    const ids = ["smg", "shotgun", "rifle"];
    kinds.push({
      type: "weapon",
      weaponId: ids[(Math.random() * ids.length) | 0],
      color: "#fb7185",
    });
  }
  const kind = kinds[(Math.random() * kinds.length) | 0];
  let p = near
    ? { x: near.x + rand(-30, 30), y: near.y + rand(-30, 30) }
    : randomPoint(50);
  p.x = clamp(p.x, 20, WORLD - 20);
  p.y = clamp(p.y, 20, WORLD - 20);
  state.loot.push({ ...p, ...kind, r: 8, life: 1 });
}

function weaponOf(actor) {
  return WEAPONS[actor.weaponId] || WEAPONS.pistol;
}

function weaponDamage(actor) {
  const w = weaponOf(actor);
  return w.dmg * (1 + (actor.weaponLvl - 1) * 0.18);
}

function collideObstacles(ent, nx, ny) {
  const r = ent.radius;
  for (const o of state.obstacles) {
    const cx = clamp(nx, o.x - o.w / 2, o.x + o.w / 2);
    const cy = clamp(ny, o.y - o.h / 2, o.y + o.h / 2);
    const dx = nx - cx;
    const dy = ny - cy;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

function moveEntity(ent, dx, dy, dt) {
  const len = Math.hypot(dx, dy) || 1;
  const boost = ent.dashT > 0 ? 2.4 : 1;
  const sp = ent.speed * boost * dt;
  const mx = (dx / len) * sp;
  const my = (dy / len) * sp;
  let nx = ent.x + mx;
  let ny = ent.y + my;
  nx = clamp(nx, ent.radius, WORLD - ent.radius);
  ny = clamp(ny, ent.radius, WORLD - ent.radius);
  if (!collideObstacles(ent, nx, ent.y)) ent.x = nx;
  if (!collideObstacles(ent, ent.x, ny)) ent.y = ny;
}

function shoot(actor) {
  if (!actor.alive || actor.fireCd > 0) return;
  const w = weaponOf(actor);
  const pellets = w.pellets || 1;
  actor.fireCd = w.rate / (1 + (actor.weaponLvl - 1) * 0.08);
  for (let i = 0; i < pellets; i++) {
    const spread = (Math.random() - 0.5) * w.spread * 2;
    const a = actor.angle + spread;
    state.bullets.push({
      x: actor.x + Math.cos(a) * (actor.radius + 6),
      y: actor.y + Math.sin(a) * (actor.radius + 6),
      vx: Math.cos(a) * w.speed,
      vy: Math.sin(a) * w.speed,
      life: w.range / w.speed,
      dmg: weaponDamage(actor),
      owner: actor.id,
      color: w.color,
      r: pellets > 1 ? 2.5 : 3.2,
    });
  }
  burst(actor.x + Math.cos(actor.angle) * 18, actor.y + Math.sin(actor.angle) * 18, w.color, 4);
}

function burst(x, y, color, n = 8) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(40, 160);
    state.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: rand(0.2, 0.55),
      color,
      r: rand(1.5, 3.5),
    });
  }
}

function killActor(victim, killer) {
  if (!victim.alive) return;
  victim.alive = false;
  victim.hp = 0;
  burst(victim.x, victim.y, `hsl(${victim.hue} 80% 60%)`, 18);
  for (let i = 0; i < 3; i++) spawnLoot(victim);

  if (killer?.isPlayer) {
    killer.kills += 1;
    killer.scrap += 12 + ((Math.random() * 18) | 0);
    toast(`Убит ${victim.name} · +лом`);
  }

  if (victim.isPlayer) {
    running = false;
    ui.dead.hidden = false;
    ui.deadStats.textContent = `Убийств: ${victim.kills} · Лом: ${victim.scrap} · Оружие: ${weaponOf(victim).name} ур.${victim.weaponLvl}`;
  } else {
    setTimeout(() => {
      const i = state.bots.indexOf(victim);
      if (i >= 0) state.bots[i] = makeActor(`Бот-${((Math.random() * 90) | 0) + 1}`);
    }, 2500);
  }
}

function damage(target, amount, source) {
  if (!target.alive) return;
  if (target.shieldT > 0) amount *= 0.35;
  target.hp -= amount;
  burst(target.x, target.y, "#fb7185", 5);
  if (target.hp <= 0) killActor(target, source);
}

function useAbility(id) {
  const p = state.player;
  if (!p?.alive) return;
  if (id === "dash" && p.dashCd <= 0) {
    p.dashCd = ABILITIES[0].cd;
    p.dashT = 0.22;
    toast("Рывок!");
  }
  if (id === "shield" && p.shieldCd <= 0) {
    p.shieldCd = ABILITIES[1].cd;
    p.shieldT = 3.2;
    toast("Щит активен");
  }
  if (id === "pulse" && p.pulseCd <= 0) {
    p.pulseCd = ABILITIES[2].cd;
    for (const b of state.bots) {
      if (b.alive && dist(p, b) < 120) {
        damage(b, 22, p);
        const a = Math.atan2(b.y - p.y, b.x - p.x);
        b.x += Math.cos(a) * 28;
        b.y += Math.sin(a) * 28;
      }
    }
    burst(p.x, p.y, "#67e8f9", 24);
    toast("Импульс!");
  }
  if (id === "heal" && p.healCd <= 0) {
    p.healCd = ABILITIES[3].cd;
    p.hp = Math.min(p.maxHp, p.hp + 35);
    toast("+35 HP");
  }
}

function pickupNearest() {
  const p = state.player;
  if (!p?.alive) return;
  let best = null;
  let bestD = 28;
  for (const l of state.loot) {
    const d = dist(p, l);
    if (d < bestD) {
      best = l;
      bestD = d;
    }
  }
  if (!best) return;
  if (best.type === "scrap") {
    p.scrap += best.amount;
    toast(`+${best.amount} лома`);
  } else if (best.type === "med") {
    p.hp = Math.min(p.maxHp, p.hp + best.amount);
    toast(`Аптечка +${best.amount}`);
  } else if (best.type === "ammo") {
    p.weaponLvl = Math.min(8, p.weaponLvl + 1);
    toast(`Усиление оружия → ур.${p.weaponLvl}`);
  } else if (best.type === "weapon") {
    p.owned[best.weaponId] = true;
    p.weaponId = best.weaponId;
    toast(`Новое оружие: ${WEAPONS[best.weaponId].name}`);
  }
  state.loot = state.loot.filter((x) => x !== best);
}

function updateBot(bot, dt) {
  if (!bot.alive) return;
  bot.ai.retarget -= dt;
  const player = state.player;
  const target =
    player?.alive && dist(bot, player) < 280 + bot.ai.aggression * 180
      ? player
      : null;

  if (bot.ai.retarget <= 0) {
    bot.ai.retarget = rand(0.4, 1.2);
    if (target) bot.ai.aim = Math.atan2(target.y - bot.y, target.x - bot.x);
    else bot.ai.aim = rand(0, Math.PI * 2);
  }

  bot.angle = bot.ai.aim;
  const wantFight = target && dist(bot, target) < 220;
  if (wantFight) {
    const d = dist(bot, target);
    if (d > 90) moveEntity(bot, Math.cos(bot.angle), Math.sin(bot.angle), dt);
    else if (d < 55) moveEntity(bot, -Math.cos(bot.angle), -Math.sin(bot.angle), dt);
    if (Math.random() < 0.02 + bot.ai.aggression * 0.03) shoot(bot);
  } else {
    moveEntity(bot, Math.cos(bot.ai.aim), Math.sin(bot.ai.aim), dt);
  }
  bot.fireCd = Math.max(0, bot.fireCd - dt);
}

function update(dt) {
  state.time += dt;
  const p = state.player;
  if (!p?.alive) return;

  // cooldowns
  for (const a of [p, ...state.bots]) {
    a.fireCd = Math.max(0, a.fireCd - dt);
    a.dashCd = Math.max(0, (a.dashCd || 0) - dt);
    a.shieldCd = Math.max(0, (a.shieldCd || 0) - dt);
    a.pulseCd = Math.max(0, (a.pulseCd || 0) - dt);
    a.healCd = Math.max(0, (a.healCd || 0) - dt);
    a.shieldT = Math.max(0, (a.shieldT || 0) - dt);
    a.dashT = Math.max(0, (a.dashT || 0) - dt);
  }

  let mx = 0;
  let my = 0;
  if (keys.w || keys.arrowup) my -= 1;
  if (keys.s || keys.arrowdown) my += 1;
  if (keys.a || keys.arrowleft) mx -= 1;
  if (keys.d || keys.arrowright) mx += 1;
  mx += stickVec.x;
  my += stickVec.y;
  if (mx || my) moveEntity(p, mx, my, dt);

  const worldMx = mouse.x + cam.x;
  const worldMy = mouse.y + cam.y;
  p.angle = Math.atan2(worldMy - p.y, worldMx - p.x);

  if ((mouse.down || fireTouch) && ui.shop.hidden) shoot(p);

  for (const b of state.bots) updateBot(b, dt);

  // bullets
  for (const b of state.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
  }
  state.bullets = state.bullets.filter((b) => {
    if (b.life <= 0) return false;
    if (b.x < 0 || b.y < 0 || b.x > WORLD || b.y > WORLD) return false;
    for (const o of state.obstacles) {
      if (
        b.x > o.x - o.w / 2 &&
        b.x < o.x + o.w / 2 &&
        b.y > o.y - o.h / 2 &&
        b.y < o.y + o.h / 2
      ) {
        burst(b.x, b.y, b.color, 3);
        return false;
      }
    }
    const actors = [state.player, ...state.bots].filter((a) => a && a.alive && a.id !== b.owner);
    for (const a of actors) {
      if (dist(b, a) < a.radius + b.r) {
        const owner =
          b.owner === state.player.id
            ? state.player
            : state.bots.find((x) => x.id === b.owner);
        damage(a, b.dmg, owner);
        burst(b.x, b.y, b.color, 6);
        return false;
      }
    }
    return true;
  });

  // particles
  for (const pt of state.particles) {
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    pt.vx *= 0.96;
    pt.vy *= 0.96;
  }
  state.particles = state.particles.filter((pt) => pt.life > 0);

  // auto-pickup scrap close
  state.loot = state.loot.filter((l) => {
    if (l.type === "scrap" && dist(p, l) < 22) {
      p.scrap += l.amount;
      return false;
    }
    l.life -= dt * 0.02;
    return l.life > 0;
  });

  while (state.loot.length < LOOT_COUNT * 0.7) spawnLoot();

  cam.x = clamp(p.x - W / 2, 0, Math.max(0, WORLD - W));
  cam.y = clamp(p.y - H / 2, 0, Math.max(0, WORLD - H));

  updateHud();
}

function updateHud() {
  const p = state.player;
  ui.hpBar.style.transform = `scaleX(${clamp(p.hp / p.maxHp, 0, 1)})`;
  ui.scrapChip.textContent = `⚙ ${p.scrap}`;
  ui.killChip.textContent = `✖ ${p.kills}`;
  const w = weaponOf(p);
  ui.weaponName.textContent = w.name;
  ui.weaponAmmo.textContent = "∞";
  ui.weaponLvl.textContent = `ур. ${p.weaponLvl}`;
  ui.coords.textContent = `${p.x | 0}, ${p.y | 0}`;

  ui.abilities.innerHTML = ABILITIES.map((a) => {
    const cd = p[`${a.id}Cd`] || 0;
    return `<div class="ability ${cd > 0 ? "is-cd" : ""}">${a.name}<br>${a.key}</div>`;
  }).join("");
}

function drawActor(a) {
  if (!a.alive) return;
  const x = a.x - cam.x;
  const y = a.y - cam.y;
  if (x < -40 || y < -40 || x > W + 40 || y > H + 40) return;

  ctx.save();
  ctx.translate(x, y);

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 10, 12, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (a.shieldT > 0) {
    ctx.strokeStyle = "rgba(103,232,249,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, a.radius + 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.rotate(a.angle);
  // body
  const g = ctx.createLinearGradient(-12, -12, 12, 12);
  g.addColorStop(0, `hsl(${a.hue} 70% 62%)`);
  g.addColorStop(1, `hsl(${a.hue} 70% 38%)`);
  ctx.fillStyle = g;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1.5;
  roundRect(-11, -11, 22, 22, 6);
  ctx.fill();
  ctx.stroke();

  // head visor
  ctx.fillStyle = a.isPlayer ? "#e0f7ff" : "#0b1220";
  ctx.fillRect(2, -5, 8, 10);
  ctx.fillStyle = a.isPlayer ? "#22d3ee" : `hsl(${a.hue} 90% 70%)`;
  ctx.fillRect(4, -3, 5, 6);

  // gun
  const w = weaponOf(a);
  ctx.fillStyle = w.color;
  ctx.fillRect(10, -2.5, 16, 5);
  ctx.restore();

  // name
  ctx.fillStyle = a.isPlayer ? "#67e8f9" : "#cbd5e1";
  ctx.font = "600 11px Manrope, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(a.name, x, y - 22);

  // hp
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x - 16, y - 18, 32, 4);
  ctx.fillStyle = a.isPlayer ? "#4ade80" : "#fb7185";
  ctx.fillRect(x - 16, y - 18, 32 * clamp(a.hp / a.maxHp, 0, 1), 4);
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
  ctx.clearRect(0, 0, W, H);

  // ground
  ctx.fillStyle = "#0a121c";
  ctx.fillRect(0, 0, W, H);

  const grid = 50;
  const ox = -(cam.x % grid);
  const oy = -(cam.y % grid);
  ctx.strokeStyle = "rgba(103,232,249,0.05)";
  ctx.lineWidth = 1;
  for (let x = ox; x < W; x += grid) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = oy; y < H; y += grid) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // soft zones
  for (let i = 0; i < 6; i++) {
    const zx = ((i * 173) % WORLD) - cam.x;
    const zy = ((i * 251) % WORLD) - cam.y;
    const grd = ctx.createRadialGradient(zx, zy, 10, zx, zy, 180);
    grd.addColorStop(0, "rgba(34,211,238,0.05)");
    grd.addColorStop(1, "transparent");
    ctx.fillStyle = grd;
    ctx.fillRect(zx - 180, zy - 180, 360, 360);
  }

  // obstacles
  for (const o of state.obstacles) {
    const x = o.x - cam.x;
    const y = o.y - cam.y;
    if (x < -80 || y < -80 || x > W + 80 || y > H + 80) continue;
    ctx.fillStyle = o.kind === "crate" ? "#1e293b" : "#334155";
    ctx.strokeStyle = o.kind === "crate" ? "#f59e0b55" : "#64748b88";
    ctx.lineWidth = 2;
    ctx.fillRect(x - o.w / 2, y - o.h / 2, o.w, o.h);
    ctx.strokeRect(x - o.w / 2, y - o.h / 2, o.w, o.h);
  }

  // loot
  for (const l of state.loot) {
    const x = l.x - cam.x;
    const y = l.y - cam.y;
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.arc(x, y, l.r + Math.sin(state.time * 4 + l.x) * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(x - 2, y - 2, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const pt of state.particles) {
    ctx.globalAlpha = clamp(pt.life * 2, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x - cam.x, pt.y - cam.y, pt.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  for (const b of state.bullets) {
    ctx.fillStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(b.x - cam.x, b.y - cam.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  for (const b of state.bots) drawActor(b);
  if (state.player) drawActor(state.player);

  drawMinimap();
}

function drawMinimap() {
  mctx.clearRect(0, 0, 120, 120);
  mctx.fillStyle = "#071018";
  mctx.fillRect(0, 0, 120, 120);
  const s = 120 / WORLD;
  mctx.fillStyle = "#1e293b";
  for (const o of state.obstacles) {
    mctx.fillRect(o.x * s - 1, o.y * s - 1, 2, 2);
  }
  mctx.fillStyle = "#fb7185";
  for (const b of state.bots) {
    if (!b.alive) continue;
    mctx.fillRect(b.x * s - 1, b.y * s - 1, 2, 2);
  }
  if (state.player?.alive) {
    mctx.fillStyle = "#67e8f9";
    mctx.fillRect(state.player.x * s - 2, state.player.y * s - 2, 4, 4);
  }
  mctx.strokeStyle = "rgba(103,232,249,0.35)";
  mctx.strokeRect(cam.x * s, cam.y * s, W * s, H * s);
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
  ui.shopScrap.textContent = String(p.scrap);
  ui.shopList.innerHTML = "";

  if (shopTab === "weapons") {
    for (const w of Object.values(WEAPONS)) {
      if (w.id === "pistol") continue;
      const owned = !!p.owned[w.id];
      const row = document.createElement("div");
      row.className = "shop-item";
      row.innerHTML = `
        <div>
          <h3>${w.name}</h3>
          <p>Урон ${w.dmg} · скорость ${Math.round(1 / w.rate)}/с</p>
        </div>
      `;
      const btn = document.createElement("button");
      btn.className = "shop-buy";
      btn.textContent = owned ? (p.weaponId === w.id ? "Надето" : "Надеть") : `${w.price} лом`;
      btn.disabled = owned ? p.weaponId === w.id : p.scrap < w.price;
      btn.onclick = () => {
        if (owned) {
          p.weaponId = w.id;
        } else if (p.scrap >= w.price) {
          p.scrap -= w.price;
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
  }

  if (shopTab === "upgrades") {
    const cost = 40 + p.weaponLvl * 25;
    const row = document.createElement("div");
    row.className = "shop-item";
    row.innerHTML = `
      <div>
        <h3>Улучшить оружие</h3>
        <p>Сейчас ур.${p.weaponLvl} → ур.${Math.min(8, p.weaponLvl + 1)} · +урон и скорострельность</p>
      </div>
    `;
    const btn = document.createElement("button");
    btn.className = "shop-buy";
    btn.textContent = p.weaponLvl >= 8 ? "MAX" : `${cost} лом`;
    btn.disabled = p.weaponLvl >= 8 || p.scrap < cost;
    btn.onclick = () => {
      if (p.weaponLvl >= 8 || p.scrap < cost) return;
      p.scrap -= cost;
      p.weaponLvl += 1;
      toast(`Оружие ур.${p.weaponLvl}`);
      renderShop();
      updateHud();
    };
    row.appendChild(btn);
    ui.shopList.appendChild(row);

    const hpCost = 70;
    const row2 = document.createElement("div");
    row2.className = "shop-item";
    row2.innerHTML = `<div><h3>Усилить корпус</h3><p>Макс. HP +20 (сейчас ${p.maxHp})</p></div>`;
    const btn2 = document.createElement("button");
    btn2.className = "shop-buy";
    btn2.textContent = `${hpCost} лом`;
    btn2.disabled = p.scrap < hpCost || p.maxHp >= 200;
    btn2.onclick = () => {
      if (p.scrap < hpCost || p.maxHp >= 200) return;
      p.scrap -= hpCost;
      p.maxHp += 20;
      p.hp += 20;
      toast("Корпус усилен");
      renderShop();
      updateHud();
    };
    row2.appendChild(btn2);
    ui.shopList.appendChild(row2);
  }

  if (shopTab === "consumables") {
    const items = [
      { name: "Аптечка", desc: "+40 HP", cost: 25, fn: () => (p.hp = Math.min(p.maxHp, p.hp + 40)) },
      { name: "Сброс щита", desc: "Мгновенный щит 3с", cost: 35, fn: () => (p.shieldT = 3) },
      { name: "Ящик лома", desc: "+50 лома", cost: 0, freeOnce: true, fn: () => (p.scrap += 50) },
    ];
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "shop-item";
      row.innerHTML = `<div><h3>${it.name}</h3><p>${it.desc}</p></div>`;
      const btn = document.createElement("button");
      btn.className = "shop-buy";
      btn.textContent = it.cost ? `${it.cost} лом` : "Бесплатно";
      btn.disabled = it.cost > 0 && p.scrap < it.cost;
      btn.onclick = () => {
        if (it.cost > 0) {
          if (p.scrap < it.cost) return;
          p.scrap -= it.cost;
        }
        it.fn();
        toast(it.name);
        renderShop();
        updateHud();
      };
      row.appendChild(btn);
      ui.shopList.appendChild(row);
    }
  }
}

function startGame() {
  const name = (ui.name.value || "Оператор").trim().slice(0, 14);
  buildWorld();
  state.player = makeActor(name, true);
  state.player.owned = { pistol: true };
  ui.boot.hidden = true;
  ui.dead.hidden = true;
  ui.hud.hidden = false;
  ui.shop.hidden = true;
  if (matchMedia("(pointer: coarse)").matches) ui.touch.hidden = false;
  running = true;
  toast(`Спавн: ${state.player.x | 0}, ${state.player.y | 0}`);
  updateHud();
}

function respawn() {
  const name = state.player?.name || "Оператор";
  const scrapKeep = Math.floor((state.player?.scrap || 0) * 0.5);
  const owned = { ...(state.player?.owned || { pistol: true }) };
  const lvl = Math.max(1, (state.player?.weaponLvl || 1) - 1);
  state.player = makeActor(name, true);
  state.player.scrap = scrapKeep;
  state.player.owned = owned;
  state.player.weaponId = owned.laser
    ? "laser"
    : owned.rifle
      ? "rifle"
      : owned.shotgun
        ? "shotgun"
        : owned.smg
          ? "smg"
          : "pistol";
  state.player.weaponLvl = lvl;
  ui.dead.hidden = true;
  running = true;
  toast("Респавн");
}

// input
window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === "e") pickupNearest();
  if (e.key.toLowerCase() === "b") {
    ui.shop.hidden = !ui.shop.hidden;
    if (!ui.shop.hidden) renderShop();
  }
  if (e.key === "1") useAbility("dash");
  if (e.key === "2") useAbility("shield");
  if (e.key === "3") useAbility("pulse");
  if (e.key === "4") useAbility("heal");
  if (e.key === "Escape") ui.shop.hidden = true;
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
});
window.addEventListener("mouseup", () => {
  mouse.down = false;
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

// touch stick
const stick = ui.stick;
const knob = ui.stickKnob;
let stickId = null;
stick.addEventListener("pointerdown", (e) => {
  stickId = e.pointerId;
  stick.setPointerCapture(stickId);
  moveStick(e);
});
stick.addEventListener("pointermove", (e) => {
  if (e.pointerId === stickId) moveStick(e);
});
stick.addEventListener("pointerup", () => {
  stickId = null;
  stickVec = { x: 0, y: 0 };
  knob.style.transform = "translate(0,0)";
});
function moveStick(e) {
  const rect = stick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = e.clientX - cx;
  let dy = e.clientY - cy;
  const max = 36;
  const len = Math.hypot(dx, dy) || 1;
  if (len > max) {
    dx = (dx / len) * max;
    dy = (dy / len) * max;
  }
  stickVec = { x: dx / max, y: dy / max };
  knob.style.transform = `translate(${dx}px,${dy}px)`;
}
const fireBtn = document.getElementById("fire-btn");
fireBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  fireTouch = true;
});
fireBtn.addEventListener("pointerup", () => {
  fireTouch = false;
});
fireBtn.addEventListener("pointercancel", () => {
  fireTouch = false;
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
