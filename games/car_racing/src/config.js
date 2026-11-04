const CFG = {
  LAPS: 3, KART_COUNT: 8, ROAD_HALF: 8.5, GRASS_SLOW: 0.6,
  maxSpeed: 58, boostMaxSpeed: 82, accel: 24, brake: 42, reverseMax: 14, drag: 0.55,
  turnRate: 1.45, driftTurnRate: 2.35, driftMinSpeed: 12,
  steerLerp: 14,    // 转向平滑系数 (越大响应越快, 便于过急弯)
  boostTime: { 1: 0.7, 2: 1.0, 3: 1.4 },
  gravitySlope: 24,   // 坡度对速度的影响系数 (上坡减速、下坡加速)
};

// 难度配置 5 档 (rb=橡皮筋强度, maxMul=AI 速度倍率, agg=道具使用频率, lookAhead=前瞻段数,
//                 throttle=弯道保持油门角度, drift=漂移倾向)
const DIFF = {
  novice: { rb: 0.22, maxMul: 0.96, agg: 1.0, lookAhead: 6,  accelMul: 1.15 }, // 新手
  easy:   { rb: 0.14, maxMul: 0.98, agg: 1.3, lookAhead: 8,  accelMul: 1.22 }, // 简单
  normal: { rb: 0.08, maxMul: 1.00, agg: 1.6, lookAhead: 10, accelMul: 1.30 }, // 普通 (直道=玩家)
  hard:   { rb: 0.05, maxMul: 1.03, agg: 2.0, lookAhead: 12, accelMul: 1.38 }, // 困难
  expert: { rb: 0.03, maxMul: 1.06, agg: 2.6, lookAhead: 14, accelMul: 1.46 }, // 极限
};

const GAME = { mode: '1p', track: 8, event: 'race', car: 0, paint: 0, weather: 0, camera: 0 };

// 持久化设置 (sessionStorage 兜底)
const SETTINGS_KEY = 'kartrush_settings_v1';
const SETTINGS = (() => {
  const def = { master: 0.5, music: 0.4, sfx: 0.7, muted: false, laps: 3, diff: 'normal', qual: 'mid', reduceMotion: false };
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || sessionStorage.getItem(SETTINGS_KEY) || '{}');
    return Object.assign(def, s);
  } catch (e) { return def; }
})();
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); } catch (e) {
    try { sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); } catch (e2) { }
  }
}

const KART_COLORS = [0xff5252, 0x4d9bff, 0xffd23f, 0x5ce06b, 0xc061ff, 0xff8a3d, 0x3fe0d0, 0xff6fb5];

const CARS = [
  { name: 'SPRINT', label: '疾风', speed: 1, accel: 1, grip: 1, detail: '均衡 / 全能型' },
  { name: 'COMET', label: '彗星', speed: 1.12, accel: .84, grip: .90, detail: '极速 +12% / 转向 −10%' },
  { name: 'SLIDE', label: '游侠', speed: .95, accel: 1.16, grip: 1.20, detail: '加速 +16% / 转向 +20%' }
];
const PAINTS = [0xff694d, 0x64dccc, 0xf4d76f, 0xc1b0f2, 0xe9eef0];

export { CFG, DIFF, GAME, SETTINGS, saveSettings, KART_COLORS, CARS, PAINTS };
