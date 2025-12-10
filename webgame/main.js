/* Neon Dodger - 3D with fallback to 2D if WebGL/WebGL2 unavailable (ES Module) */
import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
// Postprocessing imports (bloom)
import { EffectComposer } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CONFIG, getEnemyScore, getEnemyHP, getConfigForDifficulty, validateConfig } from './config.js';

(function () {
  // 2D fallback removed; only WebGL/Three.js path retained
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const levelEl = document.getElementById('level');
  const highScoreEl = document.getElementById('highscore');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const toggleHelp = document.getElementById('toggleHelp');

  let running = false;
  let paused = false;
  let last = 0;

  // Will derive size from wrapper; no 2D canvas
  let W = 1056; // initial default
  let H = 594;

  const keys = new Set();
  window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  const rnd = (min, max) => Math.random() * (max - min) + min;

  const player = { x: 0, y: 0, z: 0, r: CONFIG.player.radius, speed: CONFIG.player.speed, dash: CONFIG.player.dashSpeed, invuln: 0, vx: 0, vz: 0 };
  let score = 0;
  let lives = 3;
  let level = 1;
  let highScore = Number(localStorage.getItem('neonDodgerHighScore') || 0);
  // Difficulty selection (can later be user driven); fallback to 'normal'
  const DIFFICULTY = (localStorage.getItem('neonDodgerDifficulty') || 'normal');
  const ACTIVE_CONFIG = getConfigForDifficulty(DIFFICULTY);
  const validationErrors = validateConfig(ACTIVE_CONFIG);
  if (validationErrors.length) console.warn('CONFIG validation warnings:', validationErrors);
  const GAME_VERSION = ACTIVE_CONFIG.version;
  // Tunables (from CONFIG)
  const EFFECT_POOL_SIZE = ACTIVE_CONFIG.effects.poolSize;
  const MAX_TREES = ACTIVE_CONFIG.environment.maxTrees;
  const CAMERA_HEIGHT = ACTIVE_CONFIG.camera.height;
  const CAMERA_OFFSET_Z = ACTIVE_CONFIG.camera.offsetZ;
  const CAMERA_LAG = ACTIVE_CONFIG.camera.lag;
  const PHYSICS = ACTIVE_CONFIG.physics;

  const enemies = [];
  const chests = []; // replaced blue orbs with loot chests
  const trees = [];
  const bullets = []; // player projectiles
  const BULLET_SPEED = ACTIVE_CONFIG.combat.bulletSpeed;
  const BASE_SHOT_COOLDOWN = ACTIVE_CONFIG.combat.baseShotCooldown; // base seconds between shots (modified by buffs)
  let lastShotTime = -999;
  // Particle effect pooling
  const effectPool = [];
  const activeEffects = [];
  function initEffectPool(size = EFFECT_POOL_SIZE) {
    if (!hasThree || !scene) return;
    for (let i = 0; i < size; i++) {
      const group = new THREE.Group();
      const count = 6;
      for (let j = 0; j < count; j++) {
        const geo = new THREE.SphereGeometry(0.08, 8, 6);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff4d67, transparent: true, opacity: 0 });
        const m = new THREE.Mesh(geo, mat);
        const a = (Math.PI * 2 * j) / count;
        m.position.set(Math.cos(a) * 0.15, 0.6, Math.sin(a) * 0.15);
        group.add(m);
      }
      effectPool.push(group);
    }
  }
  function spawnHitEffect(x, z) {
    if (!hasThree || !scene || effectPool.length === 0) return;
    const group = effectPool.pop();
    group.position.set(x, 0, z);
    group.scale.set(1, 1, 1);
    for (const c of group.children) { c.material.opacity = 1; }
    scene.add(group);
    activeEffects.push({ group, t: 0 });
  }
  let treeSpawnAccumulator = 0; // time accumulator for deterministic spawn pacing
  const treeScrollSpeedBase = ACTIVE_CONFIG.environment.treeScrollBase; // base downward speed for trees to simulate forward motion
  // Instanced tree rendering (Option B performance upgrade)
  const USE_INSTANCED_TREES = true;
  let trunkInstMesh = null, crownRoundInstMesh = null;
  let trunkInstCount = 0, crownRoundInstCount = 0; // active counts (<= MAX_TREES)
  // treeRecycleZ depends on bounds; will assign after bounds defined below
  let treeRecycleZ;

  // Assume module import succeeded; we'll still gracefully fallback if renderer init fails
  // Always use Three.js (fallback removed)
  let hasThree = true;
  const bounds = ACTIVE_CONFIG.environment.bounds;
  // Now safe to compute recycle Z using bounds
  treeRecycleZ = -bounds.z - 1.5 - 8;
  let renderer, scene, camera, controls, playerMesh, composer, bloomPass;
  // Animation mixer for GLTF model (if animation clips present)
  let mixer = null;
  // BrainStem enemy model (lazy-loaded)
  let brainStemScene = null;
  const wrap = document.querySelector('.canvas-wrap');

  function resize() {
    const wrapW = wrap.clientWidth;
    const targetW = Math.max(640, Math.min(1320, wrapW));
    const targetH = Math.round(targetW * 9 / 16);
    W = targetW; H = targetH;
    if (renderer) renderer.setSize(W, H, false);
    if (composer) composer.setSize(W, H);
    if (camera) { camera.aspect = W / H; camera.updateProjectionMatrix(); }
  }
  window.addEventListener('resize', resize);
  if (hasThree) {
    try {
      // Create separate WebGL canvas to avoid 2D/WebGL context conflict
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(W, H, false);
      wrap.prepend(renderer.domElement);
      // 2D canvas removed; only WebGL canvas used
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      scene = new THREE.Scene();
      // Sky blue background
      scene.background = new THREE.Color(0x6fb9ff);
      camera = new THREE.PerspectiveCamera(58, W / H, 0.1, 100); // slightly narrower FOV
      camera.position.set(0, CAMERA_HEIGHT, CAMERA_OFFSET_Z);
      camera.lookAt(0, 0, 0);
      // OrbitControls is attached to THREE namespace by the global script
      if (OrbitControls) {
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enablePan = false;
        controls.enableZoom = true;
        controls.enableRotate = true;
        controls.target.set(0, 0, 0);
      } else {
        controls = null;
        console.warn('OrbitControls not available; continuing without camera controls');
      }
      scene.add(new THREE.AmbientLight(0x7fbfff, 0.6));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(3, 5, 4);
      scene.add(dir);
      // Ground plane (green) with subtle grid overlay
      const groundGeo = new THREE.PlaneGeometry(60, 30);
      const groundMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.8, metalness: 0.0 });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0;
      scene.add(ground);
      const grid = new THREE.GridHelper(30, 30, 0x157347, 0x1c8b4a);
      grid.material.opacity = 0.25;
      grid.material.transparent = true;
      grid.position.y = 0.01;
      scene.add(grid);
      // Instanced meshes setup (trunks + round crowns)
      if (USE_INSTANCED_TREES) {
        const trunkGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.9, vertexColors: true });
        trunkInstMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_TREES);
        trunkInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(trunkInstMesh);
        const crownGeo = new THREE.SphereGeometry(1, 16, 12);
        const crownMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.7, vertexColors: true });
        crownRoundInstMesh = new THREE.InstancedMesh(crownGeo, crownMat, MAX_TREES);
        crownRoundInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(crownRoundInstMesh);
        // Initialize colors so unused instance slots are not black
        for (let i = 0; i < MAX_TREES; i++) {
          trunkInstMesh.setColorAt(i, new THREE.Color(0x8d6e63));
          crownRoundInstMesh.setColorAt(i, new THREE.Color(0x2ecc71));
        }
        if (trunkInstMesh.instanceColor) trunkInstMesh.instanceColor.needsUpdate = true;
        if (crownRoundInstMesh.instanceColor) crownRoundInstMesh.instanceColor.needsUpdate = true;
      }
      // Postprocessing pipeline (conditional bloom)
      if (ACTIVE_CONFIG.effects.bloom?.enabled) {
        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), ACTIVE_CONFIG.effects.bloom.strength, ACTIVE_CONFIG.effects.bloom.radius, ACTIVE_CONFIG.effects.bloom.threshold);
        composer.addPass(bloomPass);
      }

      // Sun: emissive sphere with additional light
      const sunGeo = new THREE.SphereGeometry(2.5, 24, 16);
      const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff199 });
      const sun = new THREE.Mesh(sunGeo, sunMat);
      sun.position.set(-20, 15, -10);
      scene.add(sun);
      const sunLight = new THREE.PointLight(0xffdd88, 0.6, 100);
      sunLight.position.copy(sun.position);
      scene.add(sunLight);
      // Humanoid player (simple articulated figure)
      const playerGroup = new THREE.Group();
      // Torso
      const torsoGeo = new THREE.BoxGeometry(0.8, 1.2, 0.4);
      const torsoMat = new THREE.MeshStandardMaterial({ color: 0x62ffb3, emissive: 0x1b3, metalness: 0.1, roughness: 0.4 });
      const torso = new THREE.Mesh(torsoGeo, torsoMat);
      torso.position.y = 0.9; // center torso
      // Head
      const headGeo = new THREE.SphereGeometry(0.32, 16, 12);
      const headMat = new THREE.MeshStandardMaterial({ color: 0xd4ffe8, emissive: 0x224422, roughness: 0.6 });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = 1.65;
      // Arms (groups for pivot at shoulders)
      const armGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.9, 12);
      const armMat = new THREE.MeshStandardMaterial({ color: 0x62ffb3, emissive: 0x0f3d2b });
      const leftArmPivot = new THREE.Group();
      leftArmPivot.position.set(-0.5, 1.35, 0);
      const leftArm = new THREE.Mesh(armGeo, armMat);
      leftArm.position.y = -0.45; // hang down from pivot
      leftArmPivot.add(leftArm);
      const rightArmPivot = new THREE.Group();
      rightArmPivot.position.set(0.5, 1.35, 0);
      const rightArm = new THREE.Mesh(armGeo, armMat);
      rightArm.position.y = -0.45;
      rightArmPivot.add(rightArm);
      // Simple gun attached to right arm pivot
      const gunGeo = new THREE.BoxGeometry(0.55, 0.18, 0.22);
      const gunMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.55, roughness: 0.45, emissive: 0x0c0c0c });
      const gun = new THREE.Mesh(gunGeo, gunMat);
      gun.position.set(0.26, -0.25, 0.30);
      rightArmPivot.add(gun);
      // Legs (pivot at hips)
      const legGeo = new THREE.CylinderGeometry(0.14, 0.14, 1.0, 14);
      const legMat = new THREE.MeshStandardMaterial({ color: 0x49c6ff, emissive: 0x0b2331 });
      const leftLegPivot = new THREE.Group();
      leftLegPivot.position.set(-0.25, 0.5, 0);
      const leftLeg = new THREE.Mesh(legGeo, legMat);
      leftLeg.position.y = -0.5;
      leftLegPivot.add(leftLeg);
      const rightLegPivot = new THREE.Group();
      rightLegPivot.position.set(0.25, 0.5, 0);
      const rightLeg = new THREE.Mesh(legGeo, legMat);
      rightLeg.position.y = -0.5;
      rightLegPivot.add(rightLeg);
      // Assemble
      playerGroup.add(torso, head, leftArmPivot, rightArmPivot, leftLegPivot, rightLegPivot);
      playerGroup.position.set(player.x, 0, player.z);
      scene.add(playerGroup);
      playerMesh = playerGroup; // reuse variable for collision/position logic (fallback)
      // Store parts for animation (only for fallback rig)
      player.limbs = { leftArmPivot, rightArmPivot, leftLegPivot, rightLegPivot };
      player.parts = { head, torso, headBaseY: head.position.y };
      player.weapon = gun;
      player.animTime = 0;
      player.r = 0.7; // adjust collision radius for fallback figure

      // Initialize pooled particle effects
      initEffectPool();

      // Attempt to load external GLTF model (will replace fallback if successful)
      const loader = new GLTFLoader();
      loader.load(
        'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/CesiumMan/glTF/CesiumMan.gltf',
        (gltf) => {
          const model = gltf.scene;
          model.scale.set(0.9, 0.9, 0.9);
          model.position.set(player.x, 0, player.z);
          // Remove fallback rig
          if (playerMesh) scene.remove(playerMesh);
          scene.add(model);
          playerMesh = model;
          // Disable procedural limb animation for GLTF model
          delete player.limbs;
          delete player.parts;
          // Weapon from fallback rig no longer valid; disable to avoid stale world position usage
          if (player.weapon && !player.weapon.parent) {
            delete player.weapon;
          } else if (player.weapon) {
            // If still parented (shouldn't be), remove it explicitly
            player.weapon.parent.remove(player.weapon);
            delete player.weapon;
          }
          player.r = 0.6; // adjust radius for model
          // If animations exist, play the first clip
          if (gltf.animations && gltf.animations.length) {
            mixer = new THREE.AnimationMixer(model);
            const action = mixer.clipAction(gltf.animations[0]);
            action.play();
            console.log('GLTF model loaded with animation clip');
          } else {
            console.log('GLTF model loaded (no animation clips)');
          }
        },
        undefined,
        (err) => {
          console.warn('GLTF load failed, keeping fallback model', err);
        }
      );

      // Load BrainStem model for enemy usage
      // Use GLB binary for potentially simpler material setup
      loader.load(
        'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/BrainStem/glTF-Binary/BrainStem.glb',
        (gltf) => {
          brainStemScene = gltf.scene;
          // Normalize pivot so min.y = 0 for consistent positioning
          const box = new THREE.Box3().setFromObject(brainStemScene);
          const shiftY = box.min.y;
          brainStemScene.position.y -= shiftY; // move up if below ground
          // Enable shadows if renderer has them (optional)
          brainStemScene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          console.log('BrainStem enemy model loaded');
        },
        undefined,
        (err) => console.warn('BrainStem model load failed', err)
      );

      // Removed remote Monster model (CORS/404); using procedural orc enemies instead.
    } catch (err) {
      console.error('Three.js init error - game unavailable:', err);
      hasThree = false;
      overlayTitle.textContent = 'WebGL Error';
      overlayText.textContent = 'Unable to initialize WebGL. Please check browser/GPU settings.';
      overlay.classList.remove('hidden');
      return;
    }
  }

  // Initial resize to fit container
  resize();

  function reset() {
    if (scene) {
      for (const e of enemies) if (e.mesh) scene.remove(e.mesh);
      // Remove any existing loot chests (was: orbs before refactor)
      for (const c of chests) if (c.mesh) scene.remove(c.mesh);
      for (const b of bullets) if (b.mesh) scene.remove(b.mesh);
      for (const t of trees) { if (t.trunk) scene.remove(t.trunk); if (t.crown) scene.remove(t.crown); }
      for (const ef of activeEffects) { scene.remove(ef.group); effectPool.push(ef.group); }
    }
    score = 0; lives = 3; level = 1;
    player.x = 0; player.z = 0; player.invuln = 0;
    enemies.length = 0; chests.length = 0; trees.length = 0; bullets.length = 0; activeEffects.length = 0; // keep pool intact
    player.buffs = {}; // clear weapon buffs
    spawnWave(level);
    spawnTrees(8);
    updateHUD();
  }
  // Shooting: create bullet(s) from gun/world position with buffs
  const _tmpVec = new THREE.Vector3();
  function currentShotCooldown() {
    const nowMs = performance.now();
    if (player.buffs?.rapid && player.buffs.rapid.end > nowMs) return BASE_SHOT_COOLDOWN * ACTIVE_CONFIG.buffs.rapidCooldownFactor;
    return BASE_SHOT_COOLDOWN;
  }
  function shoot() {
    if (!hasThree || !scene || !playerMesh) return;
    const now = performance.now() / 1000;
    if (now - lastShotTime < currentShotCooldown()) return; // cooldown gate
    lastShotTime = now;
    if (player.weapon && player.weapon.parent) player.weapon.getWorldPosition(_tmpVec);
    else { playerMesh.getWorldPosition(_tmpVec); _tmpVec.y += 1.0; _tmpVec.z -= 0.3; }
    const multiActive = player.buffs?.multi && player.buffs.multi.end > performance.now();
    const explosiveActive = player.buffs?.explosive && player.buffs.explosive.end > performance.now();
    const spread = multiActive ? ACTIVE_CONFIG.buffs.multiSpreadAngles : [0];
    for (const ang of spread) {
      const geo = new THREE.SphereGeometry(0.12, 10, 8);
      const mat = new THREE.MeshStandardMaterial({ color: explosiveActive ? 0xff6644 : 0xfff199, emissive: explosiveActive ? 0x552200 : 0x443300, roughness: 0.35 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(_tmpVec);
      scene.add(mesh);
      const vx = Math.sin(ang) * BULLET_SPEED * 0.6;
      const vz = -BULLET_SPEED * Math.cos(ang);
      bullets.push({ mesh, vx, vz, r: 0.12, explosive: explosiveActive });
    }
  }
  // Space bar shoot listener (keydown only to prevent hold-fire spam beyond cooldown)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      // Prevent page scroll / button focus that can cause camera resize jitter
      e.preventDefault();
      // Only allow shooting while game is running and not paused
      if (running && !paused) shoot();
    }
  });

  function updateHUD() {
    scoreEl.textContent = String(score);
    livesEl.textContent = String(lives);
    levelEl.textContent = String(level);
    if (highScoreEl) highScoreEl.textContent = String(highScore);
    const verEl = document.getElementById('version');
    if (verEl) verEl.textContent = ACTIVE_CONFIG.version;
    // Update health pie chart (assumes max 3 lives; renders proportion)
    const pie = document.getElementById('healthPie');
    if (pie) {
      const fill = pie.querySelector('.pie-fill');
      const maxLives = 3; // current cap
      const frac = Math.max(0, Math.min(1, lives / maxLives));
      const circumference = 2 * Math.PI * 18; // r=18
      const dash = `${circumference * frac} ${circumference}`;
      fill.setAttribute('stroke-dasharray', dash);
    }
  }

  function spawnWave(n) {
    const count = Math.min(5 + n * 2, 12);
    for (let i = 0; i < count; i++) enemies.push(createEnemy());
    const chestCount = Math.min(ACTIVE_CONFIG.loot.chestWaveBase + Math.floor(n / ACTIVE_CONFIG.loot.chestWaveDivisor), ACTIVE_CONFIG.loot.chestWaveMax);
    for (let i = 0; i < chestCount; i++) spawnChest();
  }

  // Loot chest creation (replaces former blue orbs)
  function spawnChest() {
    const size = 0.5;
    const body = new THREE.Mesh(new THREE.BoxGeometry(size, size*0.6, size), new THREE.MeshStandardMaterial({ color: 0x2d3436, roughness: 0.75, metalness: 0.25 }));
    const lid = new THREE.Mesh(new THREE.BoxGeometry(size, size*0.25, size), new THREE.MeshStandardMaterial({ color: 0xffc107, emissive: 0x332200, metalness: 0.6, roughness: 0.4 }));
    body.position.y = size*0.3; lid.position.y = size*0.65;
    const group = new THREE.Group(); group.add(body, lid);
    group.position.set(rnd(-bounds.x + 0.5, bounds.x - 0.5), 0, -bounds.z - 1.5);
    scene.add(group);
    chests.push({ mesh: group, vz: rnd(1.5, 4.0), r: 0.55 });
  }
  function applyChestLoot() {
    const roll = Math.random();
    const nowMs = performance.now();
    let type;
    if (roll < 0.25) type = 'health'; else if (roll < 0.50) type = 'rapid'; else if (roll < 0.80) type = 'multi'; else type = 'explosive';
    switch (type) {
      case 'health': lives += 1; updateHUD(); break;
      case 'rapid': player.buffs.rapid = { end: nowMs + ACTIVE_CONFIG.buffs.durationMs }; break;
      case 'multi': player.buffs.multi = { end: nowMs + ACTIVE_CONFIG.buffs.durationMs }; break;
      case 'explosive': player.buffs.explosive = { end: nowMs + ACTIVE_CONFIG.buffs.durationMs }; break;
    }
    spawnHitEffect(player.x, player.z);
  }

  // Trees: passive obstacles that block movement but don't hurt the player
  function spawnTree() { spawnTrees(1); }
  function spawnTrees(count) {
    for (let i = 0; i < count; i++) {
      const typeRand = Math.random();
      const type = (typeRand < 0.5) ? 'round' : (typeRand < 0.85 ? 'pine' : 'dead');
      const x = rnd(-bounds.x + 0.8, bounds.x - 0.8);
      const z = treeRecycleZ + rnd(0, 8); // spawn far away
      let trunkH, crownR, r, trunkR;
      let crown = null, trunk = null; // keep refs if non-instanced
      if (type === 'round') {
        trunkH = rnd(3.0, 4.2); crownR = rnd(1.0, 1.6); trunkR = 0.28; r = crownR * 0.9 + 0.4;
      } else if (type === 'pine') {
        trunkH = rnd(2.8, 3.5); crownR = 1.0; trunkR = 0.22; r = 1.0;
      } else { // dead
        trunkH = rnd(3.5, 5.0); crownR = 0; trunkR = 0.18; r = 0.6;
      }
      let crownIndex = -1, trunkIndex = -1;
      if (USE_INSTANCED_TREES) {
        // trunk instance
        trunkIndex = trunkInstCount < MAX_TREES ? trunkInstCount++ : Math.floor(Math.random() * MAX_TREES);
        const mTrunk = new THREE.Matrix4();
        mTrunk.compose(new THREE.Vector3(x, trunkH / 2, z), new THREE.Quaternion(), new THREE.Vector3(trunkR, trunkH, trunkR));
        trunkInstMesh.setMatrixAt(trunkIndex, mTrunk);
        trunkInstMesh.setColorAt(trunkIndex, new THREE.Color(type === 'dead' ? 0x5d473f : 0x8d6e63));
        trunkInstMesh.instanceMatrix.needsUpdate = true;
        if (trunkInstMesh.instanceColor) trunkInstMesh.instanceColor.needsUpdate = true;
        if (type === 'round') {
          crownIndex = crownRoundInstCount < MAX_TREES ? crownRoundInstCount++ : Math.floor(Math.random() * MAX_TREES);
          const mCrown = new THREE.Matrix4();
          mCrown.compose(new THREE.Vector3(x, trunkH - 0.4 + crownR * 0.9, z), new THREE.Quaternion(), new THREE.Vector3(crownR, crownR, crownR));
          crownRoundInstMesh.setMatrixAt(crownIndex, mCrown);
          crownRoundInstMesh.setColorAt(crownIndex, new THREE.Color(0x2ecc71));
          crownRoundInstMesh.instanceMatrix.needsUpdate = true;
          if (crownRoundInstMesh.instanceColor) crownRoundInstMesh.instanceColor.needsUpdate = true;
        } else if (type === 'pine') {
          // Keep pine crowns as grouped meshes (not instanced) for layered look
          crown = new THREE.Group();
          const layers = 3;
            for (let l = 0; l < layers; l++) {
              const hLayer = 1.1 - l * 0.15;
              const rad = 1.0 - l * 0.25;
              const cone = new THREE.Mesh(new THREE.ConeGeometry(rad, hLayer, 12), new THREE.MeshStandardMaterial({ color: 0x27ae60, roughness: 0.6 }));
              cone.position.set(0, trunkH + hLayer/2 + l * 0.2, 0);
              crown.add(cone);
            }
          crown.position.set(x, 0, z);
          scene.add(crown);
        }
      } else {
        // Fallback to previous non-instanced path if disabled
        // (Simplified to round trees only for brevity)
        trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.8, trunkR, trunkH, 12), new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.9 }));
        trunk.position.set(x, trunkH / 2, z); scene.add(trunk);
        if (type === 'round') {
          crown = new THREE.Mesh(new THREE.SphereGeometry(crownR, 16, 12), new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.7 }));
          crown.position.set(x, trunkH - 0.4 + crownR * 0.9, z); scene.add(crown);
        }
      }
      trees.push({ x, z, r, trunkR, trunkH, crownR, type, trunk, crown, trunkIndex, crownIndex });
    }
  }

  // (2D collision helper removed in 3D version)
  // Procedural orc enemy (group builder)
  function createOrcEnemy() {
    const group = new THREE.Group();
    // Torso
    const torsoGeo = new THREE.CylinderGeometry(0.55, 0.65, 1.2, 10);
    const skinColor = new THREE.Color().setHSL(0.33, 0.6, 0.35 + Math.random()*0.05); // greenish
    const torsoMat = new THREE.MeshStandardMaterial({ color: skinColor, emissive: 0x112210, roughness: 0.6 });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 0.6;
    group.add(torso);
    // Head
    const headGeo = new THREE.SphereGeometry(0.38, 14, 10);
    const head = new THREE.Mesh(headGeo, torsoMat.clone());
    head.position.y = 1.4;
    group.add(head);
    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.05, 8, 6);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffdd55, emissive: 0x552200 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.12, 1.45, 0.30);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.12, 1.45, 0.30);
    group.add(eyeL, eyeR);
    // Horns
    const hornGeo = new THREE.ConeGeometry(0.09, 0.28, 8);
    const hornMat = new THREE.MeshStandardMaterial({ color: 0xf0e6d2, emissive: 0x222222, roughness: 0.4 });
    const hornL = new THREE.Mesh(hornGeo, hornMat); hornL.position.set(-0.22, 1.55, 0.05); hornL.rotation.x = -0.8;
    const hornR = new THREE.Mesh(hornGeo, hornMat); hornR.position.set(0.22, 1.55, 0.05); hornR.rotation.x = -0.8;
    group.add(hornL, hornR);
    // Arms
    const armGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.9, 8);
    const armMat = torsoMat.clone(); armMat.emissive.setHex(0x0d1909);
    const armL = new THREE.Mesh(armGeo, armMat); armL.position.set(-0.55, 0.9, 0); armL.rotation.z = 0.2;
    const armR = new THREE.Mesh(armGeo, armMat); armR.position.set(0.55, 0.9, 0); armR.rotation.z = -0.2;
    group.add(armL, armR);
    // Legs
    const legGeo = new THREE.CylinderGeometry(0.16, 0.18, 1.0, 10);
    const legMat = torsoMat.clone(); legMat.emissive.setHex(0x081208);
    const legL = new THREE.Mesh(legGeo, legMat); legL.position.set(-0.25, 0.05, 0); legL.rotation.z = 0.05;
    const legR = new THREE.Mesh(legGeo, legMat); legR.position.set(0.25, 0.05, 0); legR.rotation.z = -0.05;
    group.add(legL, legR);
    // Weapon (club)
    const clubGeo = new THREE.CylinderGeometry(0.07, 0.2, 0.9, 8);
    const clubMat = new THREE.MeshStandardMaterial({ color: 0x5d3b1a, roughness: 0.8 });
    const club = new THREE.Mesh(clubGeo, clubMat); club.position.set(0.75, 0.85, 0); club.rotation.z = -0.9;
    group.add(club);
    // Position spawn
    group.position.set(rnd(-bounds.x + 0.5, bounds.x - 0.5), 0, -bounds.z - 1.5);
    scene.add(group);
    const box = new THREE.Box3().setFromObject(group);
    const hw = (box.max.x - box.min.x) / 2;
    const hd = (box.max.z - box.min.z) / 2;
    const rotY = rnd(0.3, 0.9) * (Math.random() < 0.5 ? -1 : 1);
    return { mesh: group, vz: rnd(2.0, 4.2), hw, hd, rotY, rotX: 0, kind: 'orc', hp: 2 };
  }

  // Enemy factory: varied shapes & rotations
  function createEnemy() {
    // Chance for BrainStem enemy if loaded
    if (brainStemScene && Math.random() < ACTIVE_CONFIG.enemies.chances.brainStem) {
      // Wrap clone in a group to recenter pivot and tighten hitbox
      const clone = brainStemScene.clone(true);
      const wrapper = new THREE.Group();
      wrapper.add(clone);
      // Original bounds
      const origBox = new THREE.Box3().setFromObject(wrapper);
      const size = origBox.getSize(new THREE.Vector3());
      const targetHeight = 2.4; // desired height
      const scale = targetHeight / (size.y || 1);
      wrapper.scale.set(scale, scale, scale);
      // Recenter horizontally (x,z) so collider is tight and symmetric
      const scaledBox = new THREE.Box3().setFromObject(wrapper);
      const center = scaledBox.getCenter(new THREE.Vector3());
      wrapper.position.x -= center.x;
      wrapper.position.z -= center.z;
      // Recompute final box for collider extents
      const finalBox = new THREE.Box3().setFromObject(wrapper);
      const finalSize = finalBox.getSize(new THREE.Vector3());
      // Apply collider shrink factor to avoid overly large hitbox from tiny protrusions
      const colliderShrink = 0.55; // tuned factor
      const hw = (finalSize.x * 0.5) * colliderShrink;
      const hd = (finalSize.z * 0.5) * colliderShrink;
      // Position spawn (y uses half final height)
      wrapper.position.y = (finalSize.y * 0.5);
      wrapper.position.x += rnd(-bounds.x + 0.5, bounds.x - 0.5);
      wrapper.position.z = -bounds.z - 1.5;
      scene.add(wrapper);
      return { mesh: wrapper, vz: rnd(2.2, 4.0), hw, hd, rotY: rnd(0.4, 1.0) * (Math.random() < 0.5 ? -1 : 1), rotX: 0, kind: 'brainstem', hp: getEnemyHP('brainstem'), ai: { driftSeed: Math.random() * Math.PI * 2 } };
    }
    // Chance for orc enemy
    if (Math.random() < ACTIVE_CONFIG.enemies.chances.orc) {
      const orc = createOrcEnemy();
      orc.ai = { steer: true };
      return orc;
    }
    // Primitive geometric hazard variety
    const type = Math.random();
    let geo, h = 1, w = 1, d = 1;
    let kind, hp;
    if (type < 0.3) { // box
      w = 0.8 + rnd(0.2, 1.1); d = 0.8 + rnd(0.2, 1.1); h = rnd(0.8, 1.4); geo = new THREE.BoxGeometry(w, h, d); kind = 'box'; hp = 1;
    } else if (type < 0.55) { // cylinder
      h = rnd(1.0, 1.6); w = d = rnd(0.7, 1.05); geo = new THREE.CylinderGeometry(w * 0.5, w * 0.5, h, 12); kind = 'cylinder'; hp = 1;
    } else if (type < 0.75) { // cone
      h = rnd(1.2, 1.8); w = d = rnd(0.9, 1.3); geo = new THREE.ConeGeometry(w * 0.55, h, 14); kind = 'cone'; hp = 1;
    } else if (type < 0.9) { // icosahedron tougher
      h = w = d = rnd(0.9, 1.3); geo = new THREE.IcosahedronGeometry(w * 0.55, 0); kind = 'icosa'; hp = 3;
    } else { // torus tougher
      w = d = rnd(1.1, 1.5); h = 0.6; geo = new THREE.TorusGeometry(w * 0.45, w * 0.18, 12, 18); kind = 'torus'; hp = 3;
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0xff4d67, emissive: 0x220000, roughness: 0.55, metalness: 0.08 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(rnd(-bounds.x + 0.5, bounds.x - 0.5), h * 0.5, -bounds.z - 1.5);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const hw = (bb.max.x - bb.min.x) / 2;
    const hd = (bb.max.z - bb.min.z) / 2;
    const rotY = rnd(0.6, 2.0) * (Math.random() < 0.5 ? -1 : 1);
    const rotX = (type > 0.55 && Math.random() < 0.4) ? rnd(0.3, 1.0) : 0;
    scene.add(mesh);
    return { mesh, vz: rnd(2.0, 5.5), hw, hd, rotY, rotX, kind, hp };
  }

  function update(dt) {
    const spd = keys.has('shift') ? player.dash : player.speed;
    const up = keys.has('arrowup') || keys.has('w');
    const down = keys.has('arrowdown') || keys.has('s');
    const left = keys.has('arrowleft') || keys.has('a');
    const right = keys.has('arrowright') || keys.has('d');
      // Save previous position for blocking resolution
      const prevX = player.x, prevZ = player.z;
      if (up) player.z -= spd * dt;
      if (down) player.z += spd * dt;
      if (left) player.x -= spd * dt;
      if (right) player.x += spd * dt;
      // Apply knockback velocities (simple Euler integration)
      player.x += player.vx * dt;
      player.z += player.vz * dt;
      player.x = Math.max(-bounds.x, Math.min(bounds.x, player.x));
      player.z = Math.max(-bounds.z, Math.min(bounds.z, player.z));
      // Block on trees by trunk only (allow passing near foliage)
      for (const t of trees) {
        const dx = player.x - t.x;
        const dz = player.z - t.z;
        const collideR = player.r + (t.trunkR || 0.25);
        if (dx*dx + dz*dz < collideR * collideR) {
          player.x = prevX; player.z = prevZ; break;
        }
      }
      if (playerMesh) playerMesh.position.set(player.x, 0, player.z);
      // Dampen player velocities
      const damp = Math.exp(-PHYSICS.damping * dt);
      player.vx *= damp; player.vz *= damp;
      // Procedural fallback humanoid animation (states: idle, walk, run, hit)
      if (player.limbs) {
        player.animTime += dt;
        const moving = (up || down || left || right);
        // Measure movement speed (distance moved this frame / dt)
        const moveDist = Math.sqrt((player.x - prevX) * (player.x - prevX) + (player.z - prevZ) * (player.z - prevZ));
        const moveSpeed = dt > 0 ? moveDist / dt : 0;
        // Determine state
        if (player.invuln > 0.0) player.state = 'hit';
        else if (!moving) player.state = 'idle';
        else if (moveSpeed > player.speed * 0.85) player.state = 'run';
        else player.state = 'walk';
        // Animation parameters per state
        let swingSpeed, amp;
        switch (player.state) {
          case 'run': swingSpeed = 9.0; amp = 1.05; break;
          case 'walk': swingSpeed = 6.0; amp = 0.7; break;
          case 'hit': swingSpeed = 2.0; amp = 0.2; break; // subdued while flashing
          default: swingSpeed = 2.2; amp = 0.12; // idle micro sway
        }
        const phase = player.animTime * swingSpeed;
        const sa = Math.sin(phase) * amp;
        const ca = Math.sin(phase + Math.PI) * amp;
        // Apply limb rotations
        player.limbs.leftArmPivot.rotation.x = sa;
        player.limbs.rightArmPivot.rotation.x = ca;
        player.limbs.leftLegPivot.rotation.x = ca * 0.55;
        player.limbs.rightLegPivot.rotation.x = sa * 0.55;
        // Head bob & torso lean (stored in parts)
        if (player.parts) {
          const headBob = (player.state === 'idle')
            ? Math.sin(player.animTime * 2.4) * 0.035
            : Math.sin(phase) * (player.state === 'run' ? 0.07 : 0.05);
          player.parts.head.position.y = player.parts.headBaseY + headBob;
          // Lean based on forward/backward movement (negative z movement => forward lean)
          const dz = player.z - prevZ;
            const lean = THREE.MathUtils.clamp(-dz * 1.2, -0.25, 0.25);
          player.parts.torso.rotation.x = lean;
        }
      }
      // Advance GLTF animation mixer if present
      if (mixer) mixer.update(dt);
      // Camera follow: keep player centered horizontally and ahead vertically
      if (camera) {
        const targetPos = { x: player.x, y: CAMERA_HEIGHT, z: player.z + CAMERA_OFFSET_Z };
        camera.position.x += (targetPos.x - camera.position.x) * CAMERA_LAG;
        camera.position.y += (targetPos.y - camera.position.y) * CAMERA_LAG;
        camera.position.z += (targetPos.z - camera.position.z) * CAMERA_LAG;
        // Keep OrbitControls focus on player to avoid downward tilt toward origin
        if (controls) {
          controls.target.set(player.x, 0.9, player.z);
          controls.update();
        } else {
          camera.lookAt(player.x, 0.9, player.z);
        }
      }

    if (player.invuln > 0) player.invuln -= dt;
    // Update pooled particle effects
    if (activeEffects.length) {
      for (let i = activeEffects.length - 1; i >= 0; i--) {
        const ef = activeEffects[i];
        ef.t += dt;
        const life = 0.6;
        const alpha = Math.max(0, 1 - ef.t / life);
        const scale = 1 + ef.t * 2.5;
        ef.group.scale.set(scale, scale, scale);
        for (const c of ef.group.children) { c.material.opacity = alpha; }
        if (ef.t >= life) {
          scene.remove(ef.group);
          activeEffects.splice(i, 1);
          effectPool.push(ef.group);
        }
      }
    }

    // move enemies + simple AI steering
    for (const e of enemies) {
      if (e.vz == null) e.vz = (e.kind === 'brainstem') ? rnd(2.2, 4.0) : rnd(2.0, 5.0);
      if (e.vx == null) e.vx = 0;
      e.mesh.position.z += e.vz * dt;
      e.mesh.position.x += e.vx * dt;
      // Dampen enemy lateral knockback velocity
      e.vx *= Math.exp(-PHYSICS.damping * dt);
      // Orc steering toward player X
      if (e.ai?.steer) {
        const dx = player.x - e.mesh.position.x;
        e.mesh.position.x += THREE.MathUtils.clamp(dx * ACTIVE_CONFIG.ai.orcTurnSpeed * dt, -0.3, 0.3);
      } else if (e.kind === 'brainstem' && e.ai) {
        const time = performance.now() * 0.001;
        const phase = time + e.ai.driftSeed;
        const drift = Math.sin(phase * 0.8) * ACTIVE_CONFIG.ai.brainStemDrift * dt;
        const track = (player.x - e.mesh.position.x) * 0.15 * dt;
        e.mesh.position.x += drift + THREE.MathUtils.clamp(track, -0.25, 0.25);
      }
      if (e.rotY) e.mesh.rotation.y += e.rotY * dt;
      if (e.rotX) e.mesh.rotation.x += e.rotX * dt;
    }
    // move bullets (support horizontal spread)
    if (bullets.length) {
      for (const b of bullets) {
        b.mesh.position.z += b.vz * dt;
        if (b.vx) b.mesh.position.x += b.vx * dt;
      }
      for (let i = bullets.length - 1; i >= 0; i--) {
        const p = bullets[i].mesh.position;
        if (p.z < -bounds.z - 14 || Math.abs(p.x) > bounds.x + 4) { scene.remove(bullets[i].mesh); bullets.splice(i, 1); }
      }
    }
    // recycle enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].mesh.position.z > bounds.z + 2) { scene.remove(enemies[i].mesh); enemies.splice(i, 1); }
    }
    // move chests
    for (const c of chests) { c.mesh.position.z += (c.vz ?? 0) * dt; }
    // recycle chests
    for (let i = chests.length - 1; i >= 0; i--) {
      if (chests[i].mesh.position.z > bounds.z + 2) { scene.remove(chests[i].mesh); chests.splice(i, 1); }
    }

    // Random tree spawning (only in 3D mode)
    // Increase accumulator by elapsed time; spawn when exceeds interval that shortens with level
    treeSpawnAccumulator += dt;
    const spawnInterval = Math.max(1.5, 4.0 - level * 0.15);
    if (trees.length < MAX_TREES && treeSpawnAccumulator >= spawnInterval) {
      treeSpawnAccumulator = 0;
      spawnTree();
    }

        // Scroll trees downward to simulate player moving forward through a forest
        const treeScrollSpeed = treeScrollSpeedBase + level * 0.15; // slight speed increase with level
        for (let i = 0; i < trees.length; i++) {
          const t = trees[i];
          t.z += treeScrollSpeed * dt;
          // Non-instanced meshes update
          if (!USE_INSTANCED_TREES) {
            if (t.trunk) t.trunk.position.z = t.z;
            if (t.crown) t.crown.position.z = t.z;
          }
          // Recycle via reposition for instanced trees
          if (t.z > bounds.z + 2) {
            t.x = rnd(-bounds.x + 0.8, bounds.x - 0.8);
            t.z = treeRecycleZ + rnd(0, 8);
            // Randomize sizes again
            if (t.type === 'round') {
              t.trunkH = rnd(3.0, 4.2); t.crownR = rnd(1.0, 1.6); t.trunkR = 0.28; t.r = t.crownR * 0.9 + 0.4;
            } else if (t.type === 'pine') {
              t.trunkH = rnd(2.8, 3.5); t.trunkR = 0.22; t.crownR = 1.0; t.r = 1.0;
            } else {
              t.trunkH = rnd(3.5, 5.0); t.trunkR = 0.18; t.crownR = 0; t.r = 0.6;
            }
            // Update pine crown group position/structure if not instanced
            if (!USE_INSTANCED_TREES && t.type === 'pine' && t.crown) {
              t.crown.position.set(t.x, 0, t.z);
            }
          }
          if (USE_INSTANCED_TREES) {
            // Update instance matrices
            const mTrunk = new THREE.Matrix4();
            mTrunk.compose(new THREE.Vector3(t.x, t.trunkH / 2, t.z), new THREE.Quaternion(), new THREE.Vector3(t.trunkR, t.trunkH, t.trunkR));
            if (t.trunkIndex >= 0) trunkInstMesh.setMatrixAt(t.trunkIndex, mTrunk);
            if (t.type === 'round' && t.crownIndex >= 0) {
              const mCrown = new THREE.Matrix4();
              mCrown.compose(new THREE.Vector3(t.x, t.trunkH - 0.4 + t.crownR * 0.9, t.z), new THREE.Quaternion(), new THREE.Vector3(t.crownR, t.crownR, t.crownR));
              crownRoundInstMesh.setMatrixAt(t.crownIndex, mCrown);
              // Slight crown brightness variation on recycle
              const crownColor = new THREE.Color(0x2ecc71);
              crownColor.offsetHSL(0, 0, (Math.random()*0.12) - 0.06);
              crownRoundInstMesh.setColorAt(t.crownIndex, crownColor);
            }
          }
        }
        if (USE_INSTANCED_TREES) {
          trunkInstMesh.instanceMatrix.needsUpdate = true;
          crownRoundInstMesh.instanceMatrix.needsUpdate = true;
          if (trunkInstMesh.instanceColor) trunkInstMesh.instanceColor.needsUpdate = true;
          if (crownRoundInstMesh.instanceColor) crownRoundInstMesh.instanceColor.needsUpdate = true;
        }
      // collisions
      if (player.invuln <= 0) {
        for (const e of enemies) {
          const px = player.x, pz = player.z;
          const ex = e.mesh.position.x, ez = e.mesh.position.z;
          // Horizontal capsule treated as circle using physics.playerCapsuleRadius
          const pr = PHYSICS.playerCapsuleRadius;
          if (Math.abs(px - ex) <= e.hw + pr && Math.abs(pz - ez) <= e.hd + pr) {
            lives -= 1; player.invuln = CONFIG.player.invulnDuration; playHit();
            spawnHitEffect(px, pz);
            // Apply player knockback away from enemy center
            const dx = px - ex; const dz = pz - ez;
            const len = Math.max(0.001, Math.hypot(dx, dz));
            const nx = dx / len; const nz = dz / len;
            player.vx += nx * PHYSICS.playerKnockback;
            player.vz += nz * PHYSICS.playerKnockback;
            if (playerMesh) {
              const torso = playerMesh.children[0];
              if (torso && torso.material && torso.material.emissive) {
                torso.material.emissive.setHex(0xff3333);
                setTimeout(() => { torso.material.emissive.setHex(0x1b3); }, 180);
              }
            }
            if (lives <= 0) { gameOver(); return; }
            updateHUD();
            break;
          }
        }
      }

    // Bullet vs enemy collisions (multi-hit logic)
    if (hasThree && bullets.length && enemies.length) {
      for (let bi = bullets.length - 1; bi >= 0; bi--) {
        const b = bullets[bi];
        const bx = b.mesh.position.x;
        const bz = b.mesh.position.z;
        let consumedBullet = false;
        for (let ei = enemies.length - 1; ei >= 0; ei--) {
          const e = enemies[ei];
          const ex = e.mesh.position.x;
          const ez = e.mesh.position.z;
          if (Math.abs(bx - ex) <= e.hw + b.r && Math.abs(bz - ez) <= e.hd + b.r) {
            // Apply damage
            e.hp = (e.hp || 1) - 1;
            // Enemy knockback from bullet direction (use bullet velocities)
            const mag = Math.max(0.001, Math.hypot(b.vx || 0, b.vz));
            const nx = (b.vx || 0) / mag;
            const nz = b.vz / mag;
            e.vx = (e.vx || 0) + nx * PHYSICS.enemyKnockback;
            e.vz += nz * PHYSICS.enemyKnockback * 0.2; // slight extra push forward
            spawnHitEffect(ex, ez);
            if (e.hp <= 0) {
              scene.remove(e.mesh);
              enemies.splice(ei, 1);
              score += getEnemyScore(e.kind);
              updateHUD();
            } else {
              // Optional minor emissive flash for surviving enemy
              if (e.mesh.material && e.mesh.material.emissive) {
                e.mesh.material.emissive.setHex(0xff5555);
                setTimeout(() => { if (e.mesh && e.mesh.material && e.hp > 0) e.mesh.material.emissive.setHex(0x220000); }, 120);
              }
            }
            // Explosive splash
            if (b.explosive) {
              const radiusSq = ACTIVE_CONFIG.combat.explosiveRadius * ACTIVE_CONFIG.combat.explosiveRadius;
              for (let ej = enemies.length - 1; ej >= 0; ej--) {
                if (ej === ei) continue;
                const oe = enemies[ej];
                const dxs = oe.mesh.position.x - ex;
                const dzs = oe.mesh.position.z - ez;
                if (dxs*dxs + dzs*dzs <= radiusSq) {
                  oe.hp = (oe.hp || 1) - 2;
                  spawnHitEffect(oe.mesh.position.x, oe.mesh.position.z);
                  if (oe.hp <= 0) {
                    scene.remove(oe.mesh); enemies.splice(ej, 1);
                    score += getEnemyScore(oe.kind);
                  }
                }
              }
              updateHUD();
            }
            consumedBullet = true;
            break;
          }
        }
        if (consumedBullet) {
          scene.remove(b.mesh);
          bullets.splice(bi, 1);
        }
      }
    }

    // chest collection
    for (let i = chests.length - 1; i >= 0; i--) {
      const c = chests[i];
      const dx = player.x - c.mesh.position.x;
      const dz = player.z - c.mesh.position.z;
      if ((dx*dx + dz*dz) <= (player.r + c.r)*(player.r + c.r)) {
        scene.remove(c.mesh); chests.splice(i, 1);
        applyChestLoot(); score += 5; updateHUD(); playCollect();
      }
    }

    // level progression
    if (enemies.length < Math.min(ACTIVE_CONFIG.progression.enemyCapBase + level * ACTIVE_CONFIG.progression.enemyCapPerLevel, ACTIVE_CONFIG.progression.enemyCapMax)) {
      enemies.push(createEnemy());
    }
    // Reduce periodic chest spawn rate for better balance
    if (chests.length < Math.min(ACTIVE_CONFIG.loot.chestWaveBase + Math.floor(level / ACTIVE_CONFIG.loot.chestPeriodicDivisor), ACTIVE_CONFIG.loot.chestPeriodicMax) && Math.random() < ACTIVE_CONFIG.loot.chestPeriodicChance) {
      spawnChest();
    }

    // gentle difficulty scaling
    if (score > level * ACTIVE_CONFIG.progression.levelScoreMultiplier) {
      level += 1;
      spawnWave(level);
      updateHUD();
    }
  }

  function draw() {
    if (renderer && scene && camera) {
      if (controls && controls.update) controls.update();
      if (composer) composer.render(); else renderer.render(scene, camera);
    }
  }

  function frame(ts) {
    if (!running) return;
    const dt = Math.min(0.033, (ts - last) / 1000);
    last = ts;
    if (!paused) {
      update(dt);
      draw();
    }
    requestAnimationFrame(frame);
  }

  function gameOver() {
    running = false;
    overlayTitle.textContent = 'Game Over';
    overlayText.textContent = `Final Score: ${score}. Press Start to play again.`;
    overlay.classList.remove('hidden');
    btnStart.textContent = 'Start';
    if (score > highScore) {
      highScore = score;
      localStorage.setItem('neonDodgerHighScore', String(highScore));
      updateHUD();
    }
  }

  // UI handlers
  btnStart.addEventListener('click', () => {
    initAudio(); // lazy audio init
    reset();
    overlay.classList.add('hidden');
    if (!running) {
      running = true; paused = false; last = performance.now();
      requestAnimationFrame(frame);
    } else {
      paused = false; last = performance.now();
    }
    btnPause.textContent = 'Pause';
    // Keep Start label constant to avoid confusion; it restarts each click.
  });
  btnPause.addEventListener('click', () => {
    paused = !paused;
    btnPause.textContent = paused ? 'Resume' : 'Pause';
  });
  // Restart button removed; Start now functions as restart.
  toggleHelp.addEventListener('click', (e) => {
    e.preventDefault();
    const isHidden = overlay.classList.contains('hidden');
    overlayTitle.textContent = 'Neon Dodger';
    overlayText.textContent = 'Use arrow keys or WASD to move. Avoid red blocks. Loot chests for health & weapon buffs. Press Start to play.';
    if (isHidden) overlay.classList.remove('hidden'); else overlay.classList.add('hidden');
  });

  // show help initially
  overlay.classList.remove('hidden');
})();

// Web Audio (simple tone-based sfx)
let audioCtx = null;
function initAudio() {
  if (audioCtx) return;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
  catch (e) { console.warn('Audio init failed', e); }
}
function playTone(freq, dur, type = 'sine', gain = 0.15) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type; osc.frequency.value = freq;
  osc.connect(g); g.connect(audioCtx.destination);
  g.gain.setValueAtTime(gain, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  osc.start(); osc.stop(audioCtx.currentTime + dur);
}
function playCollect() { playTone(660, 0.18, 'square', 0.12); }
function playHit() { playTone(140, 0.32, 'sawtooth', 0.18); }
