# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What This Is

A top-down TABS (Totally Accurate Battle Simulator) clone — "电子斗蛐蛐" (electronic cricket fighting). Pure Canvas 2D + vanilla JS, zero dependencies. Runs by double-clicking `index.html` (file:// protocol).

## Running & Testing

- **Run**: Open `index.html` in Chrome/Edge. No build step, no server needed.
- **Verify changes**: Playwright tests in `/tmp/pwtest/` (run `node /tmp/pwtest/<test>.js`). Requires `playwright` installed in `/tmp/pwtest/`.
- **Syntax check all JS**: `node -e 'const fs=require("fs"),path=require("path");const D="js";let e=0;for(const f of fs.readdirSync(D).filter(f=>f.endsWith(".js"))){try{new Function(fs.readFileSync(path.join(D,f),"utf8"));}catch(x){e++;console.log(f+": "+x.message);}}console.log(e===0?"OK":"ERR "+e);'`

## Architecture

**11 IIFE modules** loaded via classic `<script src>` (NOT ES modules — file:// CORS blocks them). Global namespace `W` shared across all modules. Load order in index.html defines dependency chain.

| Module | Role |
|---|---|
| `js/util.js` | `W.Util`: clamp, rand, shade(color), normalizeAngle |
| `js/config.js` | `W.Config`: CONST (physics tuning) + UNIT_TYPES (12 units, JSON-like) + TEAM_COLORS |
| `js/physics.js` | `W.Physics`: fixed-timestep rigid body sim. Body collision (collideBodies), weapon hinge (integrateWeapons: spring-damper with ±90° constraint), weapon collision (weaponCollide + weaponVsWeapon with full 2D rotational impulse), boundary bounce, heal |
| `js/ai.js` | `W.AI`: melee charges (thrust toward enemy), ranged kites. Special hook called BEFORE movement (rage overrides u.moveSpeed) |
| `js/projectiles.js` | `W.Projectiles`: pooled 2D projectiles, sub-stepped, AoE explosion (mage), shield block |
| `js/specials.js` | `W.Specials`: heal_aura (priest), rage (berserker). Shield is passive (checked in weaponCollide/onHit) |
| `js/effects.js` | `W.Effects`: hit particles, slash arc, dust, heal sparkles, explosion ring |
| `js/terrain.js` | `W.Terrain`: five fixed tactical maps, slowdown queries, obstacle collision, segment tests, radius-aware A* and deployment vacancy search |
| `js/renderer.js` | `W.Renderer`: camera (s2w/w2s), sprite cache (pre-rendered per type×team×pose), tiled grass, HUD, ghost preview |
| `js/ui.js` | `W.UI`: sidebar auto-generated from UNIT_TYPES, mouse placement (team by x-position), WASD pan, keyboard shortcuts (Tab/Space/M/R/C/G) |
| `js/game.js` | `W.Game`: state, fixed-timestep loop (60Hz), phase machine (setup/battle), camera bounds clamping, pause/slow-mo, randomArmy, spawnBatch |

## Key Design Decisions

- **Units = ball + stick on elastic hinge**: body is a circle (radius), weapon is a segment hinged at the body's front circumference point (H = pos + radius·dir(angle)). Weapon swings around H (wangle), constrained to ±82.8° (can't overlap body). Spring-damper (WSPIN_OMEGA/ZETA) pulls wangle toward body angle; WEAPON_TRANSFER (0.3) couples weapon↔body rotation through the hinge.
- **Adding a unit**: add one entry to `UNIT_TYPES` in config.js. Sidebar auto-generates. Zero AI/physics/renderer changes needed. Optional fields: `helmet` (bool, default true), `special` ({kind:'rage'|'heal_aura'|'shield'}), `projectile.aoe` ({radius,damage,kb}).
- **Placement**: no team selection needed — place left half = red, right half = blue. Spawn overlap is checked.
- **Camera**: bounded so viewport never exceeds map boundary + 30px margin. Min zoom ensures full map visibility.
- **Helmets/shields**: frontal damage reduction. Helmet ×0.25, shield ×0.1. Checked via `dot(attacker_pos - target_pos, target_facing) > 0` in weaponCollide and projectiles onHit.

## Physics Constants (in CONST)

All tuning lives in `W.Config.CONST` inside config.js. Key groups:
- Movement: THRUST_SCALE, STAND_FRICTION, CHARGE_MULT
- Body collision: COLLIDE_RESTITUTION_STAND (0.95 billiard), COLLIDE_FRICTION, INERTIA_FACTOR
- Weapon hinge: WSPIN_OMEGA (spring stiffness), WSPIN_ZETA (damping), WSPIN_INIT (initial spin), WEAPON_TRANSFER (hinge coupling)
- Bounds: BOUND_X / BOUND_Y follow the active map; meadow defaults to (840, 420).

## Battlefield layout and maps

Each map has its own polygon outline and dimensions. Meadow is 1680×840 (2:1); the other maps include octagonal, long hexagonal, concave hourglass and asymmetric outlines. W.Terrain.contains/lineClear/collideBoundary own actual playable boundaries; use per-map passable queries for validating saves before switching the active map. `css/battlefield.css` owns the final sidebar and stage layout; HUD, canvas and camera buttons occupy separate rows. `js/maps.js` owns the home map selector and preview. The roster is paged by both width and height; the rack collapses on portrait phones and during battle. Grassland is always used in the campaign. Sandbox saves retain the `war-lab-v1` key, with optional `map` (legacy saves default to meadow). Run `node tests/terrain.cjs` for tactical geometry and routing checks, plus the existing simulation/startup/browser tests.

## 美术与窗口验收

本项目同时遵守项目根目录的 [AGENTS.md](../../AGENTS.md) 的通用要求。

- 使用可摆弄的玩具兵沙盘风格，突出红蓝阵营、小兵和武器造型，战场始终为视觉主体。
- 兵种使用侧边分页栏，分页同时考虑宽度和高度；窄竖屏可收起，部署工具分组，战斗时释放战场空间。
- 主页面随窗口宽高自动适配，不出现整页横向或纵向滚动；主要内容和关键操作完整落在窗口内。
- 布局验收至少覆盖 1920×1080、1440×900、1280×720、960×540、844×390、390×844，以及连续缩放窗口。
- 重点检查兵种分页、部署／开始／暂停入口、布阵坐标和相机换算；调整窗口不得重置布阵或战斗状态。
- 布局改动实际运行 `tests/layout_browser.py` 并查看画面，不能只以没有滚动条作为验收结果。
