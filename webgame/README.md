# Neon Dodger (Web Game)

A lightweight 3D browser game built with Three.js. Dodge red hazards, loot chests for buffs, shoot enemies, and climb levels.

Current Version: 1.0.0

## Run Locally

Use any static file server. Two easy options:

### Python (built-in)
```zsh
cd webgame
python3 -m http.server 8080
# Open http://localhost:8080 in your browser
```

### Node (`serve`)
```zsh
cd webgame
npx serve . -p 8080
# Open http://localhost:8080
```

## Controls
- Arrow keys or WASD: Move
- Shift: Dash
- Space: Shoot (fires a forward projectile)
- Start: Begin / restart
- Pause: Toggle pause

## Features
- Pure 3D mode (Three.js) – 2D fallback removed
- Articulated humanoid player (procedural limb animation)
- GLTF player model (CesiumMan) auto-loads if network OK; otherwise uses in-code rig
- Shooting system (gun, bullets, hit effects, kill scoring)
  - Multi-hit enemies: Orcs (2), Icosahedron/Torus (3), others (1)
- Dynamic enemy spawning (vertical flow toward player)
- Loot chests (random items): Health (+1 life) or timed weapon buffs (Rapid fire, Multi‑shot arc, Explosive rounds)
- High score persistence (localStorage)
- Varied forest trees (round, pine, dead) with continuous scrolling
- Hit feedback (red flash + pooled particle burst)
- ES Module Three.js (r160-ready)
- Lightweight Web Audio effects (collect, hit)
- Procedural orc enemies mixed with geometric hazards
- BrainStem glTF enemy (higher HP, higher score) for added variety

## HUD
- In‑game floating HUD shows Score, Lives, Level, and Version.
- Player health is visualized as a pie chart for quick readability.

## Files
- `index.html`: Game UI scaffold and WebGL canvas
- `style.css`: Neon aesthetic styles
- `main.js`: Core logic (3D only), player animation, particles, trees, collisions, shooting, scoring
- `config.js`: Centralized tunables (version, balance, spawn rates, scoring, buffs)

## Notes
- Uses ES module imports for Three.js and OrbitControls (future‑proof vs deprecated global builds removed after r160).
- Import Map provides bare specifier `three` so example loaders resolve internally.
- WebGL required (Chrome/Firefox/Safari). If initialization fails, an overlay message appears.
- Hackable structure: single `main.js` module, minimal globals.
- Particle effects pooled to reduce garbage collection churn.
- Enemies use a mix of procedural primitive shapes and custom-built orc character groups (no external model dependency).

## Migrating / Extending Three.js
To pin a specific version or self-host:
```html
<script type="module">
	import * as THREE from '/vendor/three.module.js';
	import { OrbitControls } from '/vendor/OrbitControls.js';
	import './main.js';
</script>
```
When adding loaders (GLTF, etc.), import from `examples/jsm/` similarly:
```js
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
```

Import Map currently used:
```html
<script type="importmap">{
	"imports": { "three": "https://unpkg.com/three@0.160.0/build/three.module.js" }
}</script>
```

## Potential Next Enhancements
- Precise collision (sphere vs oriented box SAT)
- Orb collection sparkle trail
- Tree object pooling / pre-allocation
- Touch/mobile controls & adaptive layout
- Mute toggle for audio

## Credits
CesiumMan & BrainStem glTF sample models © Analytical Graphics, Inc. (AGI) / KhronosGroup glTF-Sample-Models (CC BY 4.0).
