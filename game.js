import * as THREE from "three";

const LAYERS = [
  { name: "Кристалл", color: 0x22d3ee, emissive: 0x0e7490, hp: 10, size: 2.2 },
  { name: "Нефрит", color: 0x2dd4bf, emissive: 0x0f766e, hp: 12, size: 1.75 },
  { name: "Янтарь", color: 0xf97316, emissive: 0x9a3412, hp: 14, size: 1.35 },
  { name: "Рубин", color: 0xfb7185, emissive: 0x9f1239, hp: 16, size: 1.0 },
];

const stage = document.getElementById("stage");
const canvas = document.getElementById("game-canvas");
const ring = document.getElementById("click-ring");
const layerLabel = document.getElementById("layer-label");
const hpLabel = document.getElementById("hp-label");
const hpFill = document.getElementById("hp-fill");
const hintEl = document.getElementById("game-hint");
const winBanner = document.getElementById("win-banner");
const replayBtn = document.getElementById("replay-btn");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 0.35, 6.4);

const root = new THREE.Group();
scene.add(root);

const pivot = new THREE.Group();
root.add(pivot);

const debris = new THREE.Group();
root.add(debris);

const sparks = [];
const chunks = [];

let layerMeshes = [];
let chestGroup = null;
let layerIndex = 0;
let hp = LAYERS[0].hp;
let won = false;
let rotX = -0.32;
let rotY = 0.55;
let targetRotX = rotX;
let targetRotY = rotY;
let dragging = false;
let moved = false;
let pointerId = null;
let lastX = 0;
let lastY = 0;
let hitPulse = 0;
let impactLight = null;
let clock = new THREE.Clock();

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function setupLights() {
  scene.add(new THREE.AmbientLight(0x9eb6d0, 0.45));

  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(4.5, 6, 5);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x67e8f9, 0.55);
  fill.position.set(-5, 1.5, -2);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xf97316, 0.4);
  rim.position.set(0, -3, -4);
  scene.add(rim);

  impactLight = new THREE.PointLight(0xff3355, 0, 8, 2);
  scene.add(impactLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 64),
    new THREE.MeshStandardMaterial({
      color: 0x0a121c,
      roughness: 0.85,
      metalness: 0.2,
      transparent: true,
      opacity: 0.55,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.55;
  scene.add(floor);
}

function makeCubeMaterial(hex, emissiveHex, active) {
  return new THREE.MeshPhysicalMaterial({
    color: hex,
    emissive: emissiveHex,
    emissiveIntensity: active ? 0.35 : 0.12,
    metalness: 0.55,
    roughness: 0.22,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    reflectivity: 0.9,
    transparent: true,
    opacity: active ? 0.92 : 0.55,
    transmission: active ? 0.18 : 0.05,
    thickness: 0.6,
    envMapIntensity: 1.2,
  });
}

function makeLayerMesh(def, index, active) {
  const group = new THREE.Group();
  group.userData.layerIndex = index;

  const geo = new THREE.BoxGeometry(def.size, def.size, def.size, 2, 2, 2);
  const mat = makeCubeMaterial(def.color, def.emissive, active);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.isLayer = true;
  mesh.userData.layerIndex = index;
  group.add(mesh);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(def.size, def.size, def.size)),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: active ? 0.35 : 0.12,
    })
  );
  group.add(edges);

  const inner = new THREE.Mesh(
    new THREE.BoxGeometry(def.size * 0.92, def.size * 0.92, def.size * 0.92),
    new THREE.MeshBasicMaterial({
      color: def.color,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    })
  );
  group.add(inner);

  group.userData.mesh = mesh;
  group.userData.edges = edges;
  return group;
}

function makeChest() {
  const g = new THREE.Group();
  g.visible = false;

  const wood = new THREE.MeshStandardMaterial({
    color: 0xb45309,
    metalness: 0.35,
    roughness: 0.45,
    emissive: 0x78350f,
    emissiveIntensity: 0.15,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    metalness: 0.95,
    roughness: 0.25,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.35,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 0.65), wood);
  body.position.y = -0.05;
  g.add(body);

  const band = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.68), gold);
  band.position.y = 0.05;
  g.add(band);

  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.22, -0.32);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 0.65), wood);
  lid.position.set(0, 0.05, 0.32);
  lidPivot.add(lid);
  const lidBand = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.68), gold);
  lidBand.position.set(0, 0.05, 0.32);
  lidPivot.add(lidBand);
  g.add(lidPivot);

  const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16), gold);
  lock.rotation.x = Math.PI / 2;
  lock.position.set(0, 0.12, 0.34);
  g.add(lock);

  const glow = new THREE.PointLight(0xffd166, 0, 4, 2);
  glow.position.y = 0.3;
  g.add(glow);

  g.userData.lidPivot = lidPivot;
  g.userData.glow = glow;
  g.userData.open = 0;
  return g;
}

function rebuildLayers() {
  layerMeshes.forEach((m) => pivot.remove(m));
  layerMeshes = [];

  for (let i = LAYERS.length - 1; i >= 0; i--) {
    const active = i === layerIndex;
    const visible = i >= layerIndex;
    const mesh = makeLayerMesh(LAYERS[i], i, active);
    mesh.visible = visible;
    pivot.add(mesh);
    layerMeshes.push(mesh);
  }

  if (!chestGroup) {
    chestGroup = makeChest();
    pivot.add(chestGroup);
  }
  chestGroup.visible = false;
  chestGroup.userData.open = 0;
  chestGroup.userData.lidPivot.rotation.x = 0;
  chestGroup.userData.glow.intensity = 0;
}

function updateHud() {
  if (won) {
    layerLabel.textContent = "Приз";
    hpLabel.textContent = "OK";
    hpFill.style.transform = "scaleX(0)";
    hintEl.textContent = "Сундук открыт";
    return;
  }
  const layer = LAYERS[layerIndex];
  layerLabel.textContent = `Слой ${layerIndex + 1} / ${LAYERS.length}`;
  hpLabel.textContent = `HP ${hp}`;
  hpFill.style.transform = `scaleX(${Math.max(0, hp / layer.hp)})`;
  hintEl.textContent = `${layer.name} · крутите и кликайте`;
}

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function showClickRing(clientX, clientY) {
  const rect = stage.getBoundingClientRect();
  ring.style.left = `${clientX - rect.left}px`;
  ring.style.top = `${clientY - rect.top}px`;
  ring.classList.remove("is-on");
  void ring.offsetWidth;
  ring.classList.add("is-on");
}

function spawnSparks(point, count = 22) {
  for (let i = 0; i < count; i++) {
    const geo = new THREE.SphereGeometry(0.03 + Math.random() * 0.04, 6, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.35 ? 0xff3355 : 0xff7a8a,
      transparent: true,
      opacity: 1,
    });
    const p = new THREE.Mesh(geo, mat);
    p.position.copy(point);
    const dir = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    )
      .normalize()
      .multiplyScalar(2.2 + Math.random() * 3.5);
    scene.add(p);
    sparks.push({ mesh: p, vel: dir, life: 0.45 + Math.random() * 0.35 });
  }
}

function shatterLayer(def) {
  const size = def.size;
  const parts = 3;
  const cell = size / parts;
  const offset = (parts - 1) * 0.5;

  for (let x = 0; x < parts; x++) {
    for (let y = 0; y < parts; y++) {
      for (let z = 0; z < parts; z++) {
        if (Math.random() < 0.12) continue;
        const geo = new THREE.BoxGeometry(cell * 0.88, cell * 0.88, cell * 0.88);
        const mat = new THREE.MeshPhysicalMaterial({
          color: def.color,
          emissive: 0xff2244,
          emissiveIntensity: 0.55,
          metalness: 0.4,
          roughness: 0.35,
          transparent: true,
          opacity: 0.95,
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.set((x - offset) * cell, (y - offset) * cell, (z - offset) * cell);
        m.position.applyEuler(new THREE.Euler(rotX, rotY, 0));
        const outward = m.position.clone().normalize();
        if (outward.lengthSq() < 0.01) outward.set(0, 1, 0);
        const vel = outward
          .multiplyScalar(3 + Math.random() * 4)
          .add(new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2));
        debris.add(m);
        chunks.push({
          mesh: m,
          vel,
          spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
          life: 0.9 + Math.random() * 0.5,
        });
      }
    }
  }
}

function setActiveLayerVisuals() {
  layerMeshes.forEach((group) => {
    const i = group.userData.layerIndex;
    const active = i === layerIndex;
    const visible = i >= layerIndex && !won;
    group.visible = visible;
    if (!visible) return;
    const def = LAYERS[i];
    const mesh = group.userData.mesh;
    mesh.material.dispose();
    mesh.material = makeCubeMaterial(def.color, def.emissive, active);
    group.userData.edges.material.opacity = active ? 0.4 : 0.12;
  });
}

function hit(clientX, clientY) {
  if (won) return;

  const rect = stage.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const targets = layerMeshes
    .filter((g) => g.visible && g.userData.layerIndex === layerIndex)
    .map((g) => g.userData.mesh);
  const hits = raycaster.intersectObjects(targets, false);

  const point =
    hits[0]?.point?.clone() ||
    new THREE.Vector3(0, 0, LAYERS[layerIndex].size * 0.55).applyEuler(
      new THREE.Euler(rotX, rotY, 0)
    );

  showClickRing(clientX, clientY);
  spawnSparks(point, 26);
  hitPulse = 1;
  impactLight.position.copy(point);
  impactLight.intensity = 4.5;
  stage.classList.add("is-hit");
  setTimeout(() => stage.classList.remove("is-hit"), 140);

  const mesh = layerMeshes.find((g) => g.userData.layerIndex === layerIndex)?.userData.mesh;
  if (mesh) {
    mesh.material.emissive.setHex(0xff2244);
    mesh.material.emissiveIntensity = 0.95;
  }

  hp -= 1;
  if (hp <= 0) {
    const def = LAYERS[layerIndex];
    shatterLayer(def);
    layerIndex += 1;
    if (layerIndex >= LAYERS.length) {
      win();
    } else {
      hp = LAYERS[layerIndex].hp;
      setActiveLayerVisuals();
    }
  }
  updateHud();
}

function win() {
  won = true;
  layerMeshes.forEach((g) => {
    g.visible = false;
  });
  chestGroup.visible = true;
  winBanner.hidden = false;
  updateHud();
}

function resetGame() {
  won = false;
  layerIndex = 0;
  hp = LAYERS[0].hp;
  rotX = -0.32;
  rotY = 0.55;
  targetRotX = rotX;
  targetRotY = rotY;
  winBanner.hidden = true;
  while (debris.children.length) {
    const c = debris.children[0];
    debris.remove(c);
    c.geometry?.dispose();
    c.material?.dispose();
  }
  chunks.length = 0;
  sparks.forEach((s) => {
    scene.remove(s.mesh);
    s.mesh.geometry.dispose();
    s.mesh.material.dispose();
  });
  sparks.length = 0;
  rebuildLayers();
  setActiveLayerVisuals();
  updateHud();
}

function onPointerDown(e) {
  if (e.target.closest?.(".win-btn")) return;
  pointerId = e.pointerId;
  dragging = true;
  moved = false;
  lastX = e.clientX;
  lastY = e.clientY;
  stage.classList.add("is-dragging");
  stage.setPointerCapture?.(pointerId);
}

function onPointerMove(e) {
  if (!dragging || e.pointerId !== pointerId) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
  targetRotY += dx * 0.008;
  targetRotX += dy * 0.006;
  targetRotX = Math.max(-1.1, Math.min(1.1, targetRotX));
  lastX = e.clientX;
  lastY = e.clientY;
}

function onPointerUp(e) {
  if (e.pointerId !== pointerId) return;
  const wasDrag = moved;
  dragging = false;
  pointerId = null;
  stage.classList.remove("is-dragging");
  if (!wasDrag && !won) hit(e.clientX, e.clientY);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.033);

  rotX += (targetRotX - rotX) * 0.15;
  rotY += (targetRotY - rotY) * 0.15;
  pivot.rotation.set(rotX, rotY, 0);

  if (hitPulse > 0) {
    hitPulse = Math.max(0, hitPulse - dt * 3.2);
    const squash = 1 - hitPulse * 0.06;
    pivot.scale.set(squash, 1 + hitPulse * 0.05, squash);
    impactLight.intensity = hitPulse * 4.5;
    const active = layerMeshes.find((g) => g.userData.layerIndex === layerIndex)?.userData.mesh;
    if (active && !won && hp > 0) {
      active.material.emissiveIntensity = 0.35 + hitPulse * 0.7;
      if (hitPulse < 0.2) active.material.emissive.setHex(LAYERS[layerIndex].emissive);
    }
  } else {
    pivot.scale.set(1, 1, 1);
    impactLight.intensity = 0;
  }

  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt;
    s.vel.y -= 6 * dt;
    s.mesh.position.addScaledVector(s.vel, dt);
    s.mesh.material.opacity = Math.max(0, s.life * 2);
    s.mesh.scale.setScalar(Math.max(0.01, s.life * 2));
    if (s.life <= 0) {
      scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
      sparks.splice(i, 1);
    }
  }

  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i];
    c.life -= dt;
    c.vel.y -= 9 * dt;
    c.mesh.position.addScaledVector(c.vel, dt);
    c.mesh.rotation.x += c.spin.x * dt;
    c.mesh.rotation.y += c.spin.y * dt;
    c.mesh.material.opacity = Math.max(0, c.life);
    if (c.life <= 0) {
      debris.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh.material.dispose();
      chunks.splice(i, 1);
    }
  }

  if (won && chestGroup) {
    chestGroup.userData.open = Math.min(1, chestGroup.userData.open + dt * 1.4);
    chestGroup.userData.lidPivot.rotation.x = -chestGroup.userData.open * 1.85;
    chestGroup.userData.glow.intensity = chestGroup.userData.open * 2.8;
    chestGroup.rotation.y += dt * 0.55;
    chestGroup.position.y = Math.sin(clock.elapsedTime * 2.2) * 0.06;
  }

  // subtle idle shimmer on outer layer
  if (!won && !dragging) {
    targetRotY += dt * 0.12;
  }

  renderer.render(scene, camera);
}

setupLights();
rebuildLayers();
setActiveLayerVisuals();
updateHud();
resize();
animate();

stage.addEventListener("pointerdown", onPointerDown);
stage.addEventListener("pointermove", onPointerMove);
stage.addEventListener("pointerup", onPointerUp);
stage.addEventListener("pointercancel", onPointerUp);
replayBtn.addEventListener("click", resetGame);
window.addEventListener("resize", resize);
