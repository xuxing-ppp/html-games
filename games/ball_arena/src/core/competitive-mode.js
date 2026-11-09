(function initializeCompetitiveMode(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCompetitiveModeApi() {
  "use strict";

  const EPSILON = 1e-9;
  const MODES = new Set(["wheel", "brawl", "coop"]);

  function finiteTime(value, fallback = 0) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function getTeamBalls(game, team) {
    if (!team) return [];
    // `team.balls` is the configured roster. Runtime indexes also contain
    // summons, so never use them to build the wheel/co-op lineup.
    if (Array.isArray(team.balls)) return team.balls;
    if (game && game.ballsByTeamId && typeof game.ballsByTeamId.get === "function") {
      const indexed = game.ballsByTeamId.get(team.id);
      if (Array.isArray(indexed)) return indexed;
    }
    return Array.isArray(team.balls) ? team.balls : [];
  }

  function living(ball) {
    return Boolean(ball && Number.isFinite(ball.hp) && ball.hp > 0);
  }

  function combatActor(source) {
    return source && source.actor ? source.actor : source;
  }

  function freezeSnapshot(value) {
    if (Array.isArray(value)) {
      value.forEach(freezeSnapshot);
      return Object.freeze(value);
    }
    if (value && typeof value === "object") {
      Object.keys(value).forEach((key) => freezeSnapshot(value[key]));
      return Object.freeze(value);
    }
    return value;
  }

  function findBrawlWinner(game) {
    if (!game || !game.config || game.config.mode !== "brawl") return null;
    const livingBalls = [];
    for (const team of game.teams || []) {
      for (const ball of team && team.balls || []) {
        if (living(ball)) livingBalls.push(ball);
      }
    }
    return livingBalls.length === 1 ? livingBalls[0] : null;
  }

  class CompetitiveModeController {
    constructor({ engine, game, mode, onSwitch = null } = {}) {
      if (!engine || !game) {
        throw new TypeError("Competitive mode requires an engine and game");
      }
      const resolvedMode = mode || (game.config && game.config.mode);
      if (!MODES.has(resolvedMode)) {
        throw new Error(`Unsupported competitive mode: ${resolvedMode}`);
      }
      if (typeof onSwitch !== "function" && onSwitch !== null) {
        throw new TypeError("Competitive mode onSwitch callback must be a function");
      }

      this.engine = engine;
      this.game = game;
      this.mode = resolvedMode;
      this.onSwitch = onSwitch;
      this.arenaSize = Number.isFinite(game.arenaSize)
        ? game.arenaSize
        : Number.isFinite(game.config && game.config.arenaSize)
          ? game.config.arenaSize
          : 200;
      this.disposed = false;
      this.rosters = new Map();
      this.rosterBalls = new Set();
      this.brawlRootCache = new Map();
      this.activeByTeamId = new Map();
      this.nextIndexByTeamId = new Map();
      this.defeatedTeams = new Set();
      this.entities = [];
      this.modeEntities = this.entities;
      this.elapsed = finiteTime(game.time);

      this.initialize();
    }

    initialize() {
      const teams = Array.isArray(this.game.teams) ? this.game.teams : [];
      for (const team of teams) {
        const balls = getTeamBalls(this.game, team).filter(Boolean);
        const roster = balls.map((ball, index) => ({ ball, index }));
        this.rosters.set(team.id, roster);
        for (const entry of roster) this.rosterBalls.add(entry.ball);

        if (this.mode === "brawl") {
          for (const entry of roster) this.markActive(entry.ball, true, "active");
          const firstLiving = roster.find((entry) => living(entry.ball));
          this.activeByTeamId.set(team.id, (firstLiving && firstLiving.ball) || null);
          this.nextIndexByTeamId.set(team.id, roster.length);
          if (!roster.some((entry) => living(entry.ball))) this.defeatedTeams.add(team.id);
          continue;
        }

        const first = roster.find((entry) => living(entry.ball));
        this.activeByTeamId.set(team.id, first ? first.ball : null);
        this.nextIndexByTeamId.set(team.id, first ? first.index + 1 : roster.length);
        for (const entry of roster) {
          this.markActive(entry.ball, Boolean(first && entry.ball === first.ball),
            first && entry.ball === first.ball ? "active" : "bench");
        }
        if (!first) this.defeatedTeams.add(team.id);
      }
      this.syncGameView();
    }

    init() {
      return this.statusSnapshot();
    }

    markActive(ball, active, state) {
      if (!ball) return;
      // These fields are intentionally instance-local metadata. Engine integration
      // can use them to skip bench bodies without changing ball definitions.
      ball.competitiveMode = this.mode;
      ball.competitiveState = state;
      ball.isModeBench = !active;
      ball.isModeActive = Boolean(active);
      ball.modeActive = Boolean(active);
      ball.active = Boolean(active);
      if (state === "defeated") ball.competitiveRetired = true;
    }

    syncGameView() {
      const active = {};
      for (const [teamId, ball] of this.activeByTeamId) {
        active[teamId] = ball ? ball.instanceId : null;
      }
      this.game.competitiveMode = this;
      this.game.activeInstanceIds = active;
      if (this.mode === "coop") {
        const firstTeam = (Array.isArray(this.game.teams) && this.game.teams[0]) || null;
        this.game.activePlayerInstanceId = active.left ||
          (firstTeam && active[firstTeam.id]) || null;
      }
    }

    rosterFor(teamId) {
      return this.rosters.get(teamId) || [];
    }

    teamIdFor(ballOrInstanceId) {
      const instanceId = typeof ballOrInstanceId === "string"
        ? ballOrInstanceId
        : ballOrInstanceId && ballOrInstanceId.instanceId;
      if (typeof instanceId !== "string") return null;
      for (const [teamId, roster] of this.rosters) {
        if (roster.some((entry) => entry.ball.instanceId === instanceId)) return teamId;
      }
      return null;
    }

    activeFor(teamId) {
      return this.activeByTeamId.get(teamId) || null;
    }

    getActive(teamId) {
      if (teamId !== undefined) return this.activeFor(teamId);
      const result = {};
      for (const [id, ball] of this.activeByTeamId) result[id] = ball;
      return result;
    }

    getActiveInstanceId(teamId) {
      const ball = this.activeFor(teamId);
      return ball ? ball.instanceId : null;
    }

    activeBalls(teamId) {
      if (teamId !== undefined) {
        const active = this.activeFor(teamId);
        return active ? [active] : [];
      }
      return Array.from(this.activeByTeamId.values()).filter(Boolean);
    }

    benchBalls(teamId) {
      const teams = teamId === undefined
        ? Array.from(this.rosters.keys())
        : [teamId];
      const benches = [];
      for (const id of teams) {
        const active = this.activeFor(id);
        for (const entry of this.rosterFor(id)) {
          if (entry.ball !== active && living(entry.ball)) benches.push(entry.ball);
        }
      }
      return benches;
    }

    isActive(ballOrInstanceId) {
      if (this.mode === "brawl") {
        const candidate = typeof ballOrInstanceId === "string"
          ? (this.game.ballByInstanceId && this.game.ballByInstanceId.get(ballOrInstanceId))
          : ballOrInstanceId;
        return Boolean(candidate && candidate.isModeActive === true && living(candidate));
      }
      const teamId = this.teamIdFor(ballOrInstanceId);
      if (!teamId) return false;
      const instanceId = typeof ballOrInstanceId === "string"
        ? ballOrInstanceId
        : ballOrInstanceId && ballOrInstanceId.instanceId;
      const active = this.activeFor(teamId);
      return Boolean(active && active.instanceId === instanceId);
    }

    isBench(ballOrInstanceId) {
      const teamId = this.teamIdFor(ballOrInstanceId);
      if (!teamId) return false;
      return !this.isActive(ballOrInstanceId);
    }

    switchTeam(teamId, instanceId, reason = "switch") {
      const roster = this.rosterFor(teamId);
      const candidateEntry = roster.find((entry) => entry.ball.instanceId === instanceId);
      if (!candidateEntry || !living(candidateEntry.ball)) return false;
      const previous = this.activeFor(teamId);
      if (previous === candidateEntry.ball) return true;

      if (previous) this.markActive(previous, false, living(previous) ? "bench" : "defeated");
      this.markActive(candidateEntry.ball, true, "active");
      this.activeByTeamId.set(teamId, candidateEntry.ball);
      this.defeatedTeams.delete(teamId);
      const team = (this.game.teams || []).find((item) => item.id === teamId);
      const isPlayerTeam = this.mode === "coop" && team && team.role === "player";
      if (!isPlayerTeam) {
        this.nextIndexByTeamId.set(teamId, Math.max(
          this.nextIndexByTeamId.get(teamId) || 0,
          candidateEntry.index + 1
        ));
      }
      this.syncGameView();
      if (this.onSwitch) this.onSwitch({
        mode: this.mode,
        teamId,
        previous,
        current: candidateEntry.ball,
        reason
      });
      return true;
    }

    switchPlayer(instanceId) {
      if (this.mode !== "coop" || typeof instanceId !== "string") return false;
      const playerTeam = this.game.teams && this.game.teams.find((team) => team.role === "player")
        || this.game.teams && this.game.teams[0];
      return Boolean(playerTeam && this.switchTeam(playerTeam.id, instanceId, "player"));
    }

    advanceTeam(teamId) {
      const roster = this.rosterFor(teamId);
      const current = this.activeFor(teamId);
      if (current && living(current)) return current;
      if (current) this.markActive(current, false, "defeated");

      const team = (this.game.teams || []).find((item) => item.id === teamId);
      const isPlayerTeam = this.mode === "coop" && team && team.role === "player";
      let start = isPlayerTeam ? 0 : (this.nextIndexByTeamId.get(teamId) || 0);
      while (start < roster.length && (
        roster[start].ball === current || !living(roster[start].ball)
      )) {
        this.markActive(roster[start].ball, false, "defeated");
        start += 1;
      }
      if (start >= roster.length) {
        this.activeByTeamId.set(teamId, null);
        this.nextIndexByTeamId.set(teamId, roster.length);
        this.defeatedTeams.add(teamId);
        this.syncGameView();
        return null;
      }
      const next = roster[start].ball;
      this.nextIndexByTeamId.set(teamId, start + 1);
      this.activeByTeamId.set(teamId, next);
      this.markActive(next, true, "active");
      this.defeatedTeams.delete(teamId);
      this.syncGameView();
      if (this.onSwitch) this.onSwitch({
        mode: this.mode,
        teamId,
        previous: current,
        current: next,
        reason: "defeat",
        entryEffect: this.mode === "wheel" ? {
          id: "wheel-entry-protection",
          duration: 1, // World seconds; freezes with world time.
          hidesCombatant: true,
          getContactProfile() { return { attackable: false, targetable: false }; }
        } : null
      });
      return next;
    }

    update(dt = 0) {
      if (this.disposed) return;
      const elapsed = Math.max(0, Number.isFinite(dt) ? dt : 0);
      this.elapsed += elapsed;
      if (this.game.state && this.game.state !== "running") return;

      if (this.mode === "brawl") {
        const survivors = this.brawlEntrants();
        for (const teamId of this.rosters.keys()) {
          let alive = false;
          for (const entrant of survivors.keys()) {
            if (entrant.teamId === teamId) {
              alive = true;
              break;
            }
          }
          if (alive) this.defeatedTeams.delete(teamId);
          else this.defeatedTeams.add(teamId);
        }
        return;
      }

      // Sequential teams advance after the engine has emitted onDeath for the
      // defeated active ball. See afterDeaths().
    }

    afterDeaths() {
      if (this.disposed || this.mode === "brawl") return;
      for (const teamId of this.rosters.keys()) {
        const active = this.activeFor(teamId);
        if (!active || !living(active)) this.advanceTeam(teamId);
      }
    }

    nextTransitionIn() {
      if (this.disposed) return Infinity;
      if (this.mode === "brawl") return Infinity;
      for (const active of this.activeByTeamId.values()) {
        if (!active || !living(active)) return EPSILON;
      }
      return Infinity;
    }

    livingForTeam(teamId) {
      return this.rosterFor(teamId).filter((entry) => living(entry.ball)).map((entry) => entry.ball);
    }

    isTeamDefeated(teamId) {
      if (this.mode === "brawl") {
        for (const entrant of this.brawlEntrants().keys()) {
          if (entrant.teamId === teamId) return false;
        }
        return true;
      }
      return this.defeatedTeams.has(teamId) || this.livingForTeam(teamId).length === 0;
    }

    checkWinner() {
      const teams = this.game.teams || [];
      if (this.mode === "brawl") {
        // 输赢按"选手"算：本体死了但分身还活着，这名选手就还没有出局，
        // 不能把剩下的分身当成空气提前判定胜负。
        const survivors = this.brawlEntrants();
        if (survivors.size === 0) {
          return { winnerTeam: null, loserTeam: null, winner: null };
        }
        if (survivors.size > 1) return null;
        const winner = this.getBrawlWinner();
        return winner
          ? { winnerTeam: this.getBrawlWinnerTeam(), loserTeam: null, winner }
          : null;
      }
      if (teams.length < 2) return null;
      const leftDefeated = this.isTeamDefeated(teams[0].id);
      const rightDefeated = this.isTeamDefeated(teams[1].id);
      if (!leftDefeated && !rightDefeated) return null;
      if (leftDefeated && rightDefeated) {
        return { winnerTeam: null, loserTeam: null, winner: null };
      }
      const loserTeam = leftDefeated ? teams[0] : teams[1];
      const winnerTeam = leftDefeated ? teams[1] : teams[0];
      const winner = this.activeFor(winnerTeam.id) || this.livingForTeam(winnerTeam.id)[0] || null;
      return { winnerTeam, loserTeam, winner };
    }

    isBrawlEnemy(left, right) {
      if (this.mode !== "brawl" || !right) return false;

      const actor = combatActor(left);
      const sourceTeamId = left && left.actor ? left.teamId : actor && actor.teamId;
      const targetRoot = this.brawlRootFor(right);
      if (
        !actor || actor === right ||
        sourceTeamId === undefined || sourceTeamId === null ||
        right.teamId === undefined || right.teamId === null ||
        (actor.isCombatEntity !== true && (actor.active === false || actor.isModeBench === true)) ||
        !targetRoot ||
        right.active === false || right.isModeBench === true || !living(right)
      ) return false;

      // 同一名选手的本体和分身互为队友：大混战的敌我按"归属根"划分，
      // 而不是按共享的名单队伍。
      const actorRoot = this.brawlRootFor(actor);
      if (actorRoot) {
        if (actorRoot === targetRoot) return false;
        // A body hit captured while alive may finish this contact before the
        // death phase. It does not authorize new attacks from a defeated ball.
        const contact = left && left.contact;
        const finalContact = left && left.kind === "body" && contact &&
          contact.actor === actor && contact.target === right && contact.overlapping &&
          contact.actorHp > 0 && actor.deathNotified !== true;
        return actor.active !== false && actor.isModeBench !== true &&
          (living(actor) || finalContact);
      }

      // 独立实体和持续伤害沿 owner/credit 回推归属，避免同一棵树互相误伤。
      const sourceRoot = this.brawlRootFor(left && left.owner) ||
        this.brawlRootFor(left && left.credit);
      if (sourceRoot && sourceRoot === targetRoot) return false;

      if (actor.isCombatEntity === true) {
        // Final hits can consume the entity before dealing damage. Dispatch
        // and removal are owned by EntitySystem, not by enemy classification.
        return typeof actor.instanceId === "string" && actor.instanceId.length > 0;
      }

      const isEffectActor = left && left.actor === actor &&
        (left.entity === actor || actor.combatSource === left || left.kind === "dot") &&
        Number.isFinite(actor.expiresAt);
      return isEffectActor && actor.expiresAt > finiteTime(this.game.time) + EPSILON &&
        typeof actor.instanceId === "string" && actor.instanceId.length > 0;
    }

    brawlRuntimeBalls() {
      if (Array.isArray(this.game.balls)) return this.game.balls;
      const balls = [];
      for (const list of this.game.ballsByTeamId.values()) {
        if (Array.isArray(list)) balls.push(...list);
      }
      return balls;
    }

    brawlParentOf(ball) {
      const summonerId = ball && ball.summonerInstanceId;
      if (typeof summonerId !== "string") return null;
      const index = this.game.ballByInstanceId;
      if (index && typeof index.get === "function") return index.get(summonerId) || null;
      return this.brawlRuntimeBalls().find((item) => item.instanceId === summonerId) || null;
    }

    // 大混战里的"选手"是名单球。名单球的分身只要挂在它名下（召唤链回溯到
    // 该名单球），就仍代表这名选手参赛，不能被当成路人忽略。
    brawlRootFor(ball) {
      if (!ball) return null;
      if (this.rosterBalls.has(ball)) return ball;
      if (ball.isSummon !== true || typeof ball.instanceId !== "string") return null;
      if (this.brawlRootCache.has(ball.instanceId)) {
        return this.brawlRootCache.get(ball.instanceId);
      }
      let root = null;
      let cursor = ball;
      const visited = new Set();
      while (cursor && cursor.isSummon === true && !visited.has(cursor.instanceId)) {
        visited.add(cursor.instanceId);
        const parent = this.brawlParentOf(cursor);
        if (!parent) break;
        if (this.rosterBalls.has(parent)) {
          root = parent;
          break;
        }
        cursor = parent;
      }
      this.brawlRootCache.set(ball.instanceId, root);
      return root;
    }

    // 仍然参赛的选手 -> 代表它的身体：本体活着就是本体，本体已死则交给
    // 还活着的、计入存活的分身。
    brawlEntrants() {
      const entrants = new Map();
      for (const roster of this.rosters.values()) {
        for (const entry of roster) {
          if (living(entry.ball)) entrants.set(entry.ball, entry.ball);
        }
      }
      for (const body of this.brawlRuntimeBalls()) {
        if (body.isSummon !== true || !living(body)) continue;
        const definition = body.definition;
        if (!definition || definition.summonsCountForTeamSurvival !== true) continue;
        const root = this.brawlRootFor(body);
        if (!root || entrants.has(root)) continue;
        entrants.set(root, body);
      }
      return entrants;
    }

    getBrawlLivingBalls() {
      if (this.mode !== "brawl") return [];
      const balls = [];
      for (const roster of this.rosters.values()) {
        for (const entry of roster) if (living(entry.ball)) balls.push(entry.ball);
      }
      for (const body of this.brawlRuntimeBalls()) {
        if (body.isSummon === true && living(body) && this.brawlRootFor(body)) {
          balls.push(body);
        }
      }
      return balls;
    }

    getBrawlWinner() {
      const entrants = this.brawlEntrants();
      if (entrants.size !== 1) return null;
      for (const representative of entrants.values()) return representative;
      return null;
    }

    getBrawlWinnerTeam() {
      const winner = this.getBrawlWinner();
      if (!winner) return null;
      return (this.game.teams || []).find((team) => team.id === winner.teamId) || null;
    }

    brawlWinner() {
      return this.getBrawlWinner();
    }

    getWinner() {
      return this.mode === "brawl" ? this.getBrawlWinner() : null;
    }

    statusSnapshot() {
      const teams = [];
      const active = {};
      const benches = {};
      const eliminated = {};
      for (const team of this.game.teams || []) {
        const roster = this.rosterFor(team.id);
        const activeBall = this.activeFor(team.id);
        const benchIds = [];
        const eliminatedIds = [];
        for (const entry of roster) {
          if (!living(entry.ball)) eliminatedIds.push(entry.ball.instanceId);
          else if (this.mode !== "brawl" && (!activeBall || entry.ball !== activeBall)) {
            benchIds.push(entry.ball.instanceId);
          }
        }
        const activeId = activeBall ? activeBall.instanceId : null;
        active[team.id] = activeId;
        benches[team.id] = benchIds;
        eliminated[team.id] = eliminatedIds;
        teams.push({
          id: team.id,
          role: team.role || null,
          activeInstanceId: activeId,
          benchInstanceIds: benchIds,
          eliminatedInstanceIds: eliminatedIds,
          livingCount: this.livingForTeam(team.id).length,
          defeated: this.isTeamDefeated(team.id)
        });
      }
      const winner = this.mode === "brawl" ? this.getBrawlWinner() : null;
      return freezeSnapshot({
        mode: this.mode,
        time: finiteTime(this.game.time, this.elapsed),
        elapsed: this.elapsed,
        active,
        activeInstanceIds: active,
        benches,
        benchInstanceIds: benches,
        eliminated,
        teams,
        playerInstanceId: this.game.activePlayerInstanceId || active.left || null,
        brawlWinnerInstanceId: winner ? winner.instanceId : null
      });
    }

    getState() {
      return this.statusSnapshot();
    }

    getStatus() {
      return this.statusSnapshot();
    }

    dispose() {
      if (this.disposed) return;
      for (const roster of this.rosters.values()) {
        for (const entry of roster) {
          const ball = entry.ball;
          if (!ball) continue;
          delete ball.competitiveMode;
          delete ball.competitiveState;
          delete ball.isModeBench;
          delete ball.isModeActive;
          delete ball.modeActive;
          delete ball.active;
          delete ball.competitiveRetired;
        }
      }
      if (this.game.competitiveMode === this) delete this.game.competitiveMode;
      if (this.game.activeInstanceIds) delete this.game.activeInstanceIds;
      if (this.game.activePlayerInstanceId) delete this.game.activePlayerInstanceId;
      this.rosters.clear();
      this.rosterBalls.clear();
      this.brawlRootCache.clear();
      this.activeByTeamId.clear();
      this.nextIndexByTeamId.clear();
      this.defeatedTeams.clear();
      this.entities.length = 0;
      this.disposed = true;
    }
  }

  function createCompetitiveModeController(engine, game, options = {}) {
    // Accept the object form as well as the engine/game/options form used by
    // the existing survival controllers. This keeps direct mode tests small.
    if (engine && !game && typeof engine === "object" && engine.engine && engine.game) {
      return new CompetitiveModeController(engine);
    }
    return new CompetitiveModeController({ engine, game, ...options });
  }

  return {
    MODES,
    findBrawlWinner,
    CompetitiveModeController,
    createCompetitiveModeController
  };
});
