// Central game configuration for Neon Dodger
// Adjust balance & tunables here; consumed by main.js
export const CONFIG = Object.freeze({
  version: '1.0.0',
  player: { radius: 0.5, speed: 6.0, dashSpeed: 11.0, invulnDuration: 0.9 },
  camera: { height: 4.8, offsetZ: 5.8, lag: 0.18, fov: 58 },
  environment: { bounds: { x: 12, z: 6 }, maxTrees: 26, treeScrollBase: 1.2 },
  combat: { bulletSpeed: 12.0, baseShotCooldown: 0.28, explosiveRadius: 1.6 },
  buffs: { durationMs: 6000, rapidCooldownFactor: 0.4, multiSpreadAngles: [-0.18, 0, 0.18] },
  enemies: {
    chances: { brainStem: 0.15, orc: 0.50 },
    hp: { brainstem: 4, orc: 2, icosa: 3, torus: 3, default: 1 },
    scores: { brainstem: 40, orc: 25, icosa: 30, torus: 30, default: 15 }
  },
  loot: {
    chestWaveBase: 1,
    chestWaveDivisor: 3,
    chestWaveMax: 3,
    chestPeriodicDivisor: 3,
    chestPeriodicMax: 4,
    chestPeriodicChance: 0.006,
    chestSpawnZOffset: 1.5
  },
  effects: {
    poolSize: 32,
    bloom: { enabled: true, strength: 0.8, radius: 0.4, threshold: 0.85 },
    particles: { maxGpuParticles: 600 }
  },
  ai: {
    orcTurnSpeed: 1.25, // how quickly orcs steer toward player X
    brainStemDrift: 0.6 // lateral drift speed base for brainstem enemies
  },
  physics: {
    playerCapsuleHeight: 1.8, // vertical span for capsule (visual torso+legs)
    playerCapsuleRadius: 0.55, // horizontal collision radius (replaces player.r where appropriate)
    playerKnockback: 3.2, // magnitude applied to player on enemy collision
    enemyKnockback: 2.4, // base magnitude applied to enemy when hit by bullet
    damping: 5.0 // per-second velocity damping for knockback velocities
  },
  progression: { levelScoreMultiplier: 100, enemyCapBase: 5, enemyCapPerLevel: 2, enemyCapMax: 30 }
});

export function getEnemyHP(kind) {
  return CONFIG.enemies.hp[kind] ?? CONFIG.enemies.hp.default;
}
export function getEnemyScore(kind) {
  return CONFIG.enemies.scores[kind] ?? CONFIG.enemies.scores.default;
}

// Difficulty presets override selected numeric fields.
export const DIFFICULTIES = Object.freeze({
  easy: {
    combat: { baseShotCooldown: 0.24 },
    enemies: { chances: { orc: 0.45, brainStem: 0.10 } },
    progression: { levelScoreMultiplier: 80 },
    loot: { chestPeriodicChance: 0.009 }
  },
  normal: {},
  hard: {
    combat: { baseShotCooldown: 0.32 },
    enemies: { chances: { orc: 0.55, brainStem: 0.20 } },
    progression: { levelScoreMultiplier: 110 },
    loot: { chestPeriodicChance: 0.004 }
  }
});

// Shallow merge utility for nested config sections
function mergeSection(base, patch) {
  if (!patch) return base;
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    if (typeof patch[k] === 'object' && patch[k] && !Array.isArray(patch[k])) out[k] = { ...base[k], ...patch[k] };
    else out[k] = patch[k];
  }
  return out;
}

export function getConfigForDifficulty(name = 'normal') {
  const diff = DIFFICULTIES[name] || {};
  return Object.freeze({
    ...CONFIG,
    combat: mergeSection(CONFIG.combat, diff.combat),
    enemies: mergeSection(CONFIG.enemies, diff.enemies),
    progression: mergeSection(CONFIG.progression, diff.progression),
    loot: mergeSection(CONFIG.loot, diff.loot)
  });
}

// Validation helper to catch obvious misconfigs.
export function validateConfig(cfg) {
  const errors = [];
  if (cfg.player.speed <= 0) errors.push('player.speed must be > 0');
  if (cfg.combat.baseShotCooldown <= 0) errors.push('combat.baseShotCooldown must be > 0');
  if (cfg.combat.explosiveRadius <= 0) errors.push('combat.explosiveRadius must be > 0');
  if (cfg.loot.chestPeriodicChance < 0 || cfg.loot.chestPeriodicChance > 1) errors.push('loot.chestPeriodicChance out of [0,1]');
  if (cfg.enemies.chances.orc < 0 || cfg.enemies.chances.orc > 1) errors.push('enemies.chances.orc out of [0,1]');
  if (cfg.enemies.chances.brainStem < 0 || cfg.enemies.chances.brainStem > 1) errors.push('enemies.chances.brainStem out of [0,1]');
  if (cfg.effects.bloom && (cfg.effects.bloom.strength < 0 || cfg.effects.bloom.radius < 0)) errors.push('effects.bloom values must be >= 0');
  return errors;
}
