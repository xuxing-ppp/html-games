(function initializeTournamentBracket(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createTournamentBracketApi() {
  "use strict";

  // 4 强单败：两场半决赛 → 一场决赛。参赛方是外部给的不透明标识（队伍 id）。
  // 这里只负责「谁在哪个槽、哪场对哪场、谁晋级」，不碰渲染也不碰种子搜索。
  const SUPPORTED_SIZES = [4];

  function freezeMatch(match) {
    return Object.freeze({
      id: match.id,
      round: match.round,
      index: match.index,
      leftSlot: match.leftSlot,
      rightSlot: match.rightSlot,
      nextSlot: match.nextSlot,
      left: match.left,
      right: match.right,
      seed: match.seed,
      winner: match.winner,
      resolved: match.resolvedPair ? Object.freeze({ ...match.resolvedPair }) : null
    });
  }

  function createTournamentBracket(options = {}) {
    const size = options.size == null ? 4 : options.size;
    if (!SUPPORTED_SIZES.includes(size)) throw new Error("Tournament size is not supported yet");
    const slots = new Array(size).fill(null);
    const matches = [
      // 槽 0-3 是参赛方，槽 4-5 是两场半决赛的胜者位
      { id: "semi-1", round: 1, index: 0, leftSlot: 0, rightSlot: 1, nextSlot: 4, left: null, right: null, seed: null, winner: null, resolvedPair: null },
      { id: "semi-2", round: 1, index: 1, leftSlot: 2, rightSlot: 3, nextSlot: 5, left: null, right: null, seed: null, winner: null, resolvedPair: null },
      { id: "final", round: 2, index: 0, leftSlot: 4, rightSlot: 5, nextSlot: null, left: null, right: null, seed: null, winner: null, resolvedPair: null }
    ];
    const listeners = new Set();
    let selectedId = "semi-1";
    let revision = 0;

    function emit() {
      revision += 1;
      const snapshot = view();
      for (const listener of listeners) listener(snapshot);
    }

    function matchById(matchId) {
      const found = matches.find((match) => match.id === matchId);
      if (!found) throw new Error("Unknown tournament match: " + matchId);
      return found;
    }

    // 二级槽位由半决赛胜者提供；决赛的左右就是两个二级槽。
    function slotOccupant(slotIndex) {
      if (slotIndex < size) return slots[slotIndex];
      const feederIndex = slotIndex - size; // 4 → 半决赛 1，5 → 半决赛 2
      const feeder = matches[feederIndex];
      if (!feeder) throw new Error("Unknown tournament slot: " + slotIndex);
      return feeder.winner;
    }

    function refreshMatches() {
      for (const match of matches) {
        const previousLeft = match.left;
        const previousRight = match.right;
        match.left = slotOccupant(match.leftSlot);
        match.right = slotOccupant(match.rightSlot);
        // 只有「对阵本身没变」的结果才作数；换对手后即便胜者仍是同一队也必须重打。
        const pairingChanged = !match.resolvedPair ||
          match.resolvedPair.left !== match.left ||
          match.resolvedPair.right !== match.right;
        if (previousLeft !== match.left || previousRight !== match.right || (match.winner && pairingChanged)) {
          match.winner = null;
          match.seed = null;
          match.resolvedPair = null;
        }
      }
    }

    function view() {
      return Object.freeze({
        revision,
        size,
        slots: Object.freeze(slots.slice()),
        matches: Object.freeze(matches.map(freezeMatch)),
        selectedId,
        champion: matches[2].winner,
        complete: matches.every((match) => match.winner != null)
      });
    }

    // 改动任何一个槽位都可能让下游对局失效，统一清空所有结果。
    function invalidateAll() {
      for (const match of matches) {
        match.winner = null;
        match.seed = null;
        match.resolvedPair = null;
      }
    }

    function setEntrant(slotIndex, teamId) {
      if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= size) {
        throw new Error("Invalid tournament slot");
      }
      const next = teamId == null ? null : String(teamId);
      if (next !== null && !next.trim()) throw new Error("Entrant ID must be nonempty");
      if (next && slots.some((existing, index) => index !== slotIndex && existing === next)) {
        throw new Error("Team is already placed in another slot");
      }
      slots[slotIndex] = next;
      invalidateAll();
      refreshMatches();
      emit();
      return view();
    }

    function randomize(random, pool) {
      const source = Array.isArray(pool) ? pool.slice() : slots.filter(Boolean);
      if (source.length !== size) throw new Error("Random assignment needs exactly " + size + " teams");
      if (source.some((id) => id == null || !String(id).trim())) throw new Error("Entrant ID must be nonempty");
      const next = source.map(String);
      if (new Set(next).size !== size) throw new Error("Teams must have unique entrant IDs");
      const nextRandom = typeof random === "function" ? random : Math.random;
      for (let index = next.length - 1; index > 0; index -= 1) {
        const value = nextRandom();
        if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Random value must be in [0, 1)");
        const swap = Math.floor(value * (index + 1));
        const hold = next[index];
        next[index] = next[swap];
        next[swap] = hold;
      }
      for (let index = 0; index < size; index += 1) slots[index] = next[index];
      invalidateAll();
      refreshMatches();
      emit();
      return view();
    }

    function select(matchId) {
      matchById(matchId);
      selectedId = matchId;
      emit();
      return view();
    }

    function selectedMatch() {
      return freezeMatch(matchById(selectedId));
    }

    function setSeed(matchId, seed) {
      const match = matchById(matchId);
      if (!match.left || !match.right) throw new Error("Match has no opposing teams yet");
      // 换种子等于换结果：这一场的胜者作废，等待重新确认。
      if (seed != null && (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)) throw new Error("Invalid tournament seed");
      match.seed = seed == null ? null : seed;
      match.winner = null;
      match.resolvedPair = null;
      refreshMatches();
      emit();
      return view();
    }

    function recordWinner(matchId, winnerId) {
      const match = matchById(matchId);
      if (!match.left || !match.right) throw new Error("Match has no opposing teams yet");
      if (winnerId !== match.left && winnerId !== match.right) {
        throw new Error("Winner must be one of the two teams in this match");
      }
      match.winner = winnerId;
      match.resolvedPair = { left: match.left, right: match.right };
      refreshMatches();
      emit();
      return view();
    }

    function clearWinner(matchId) {
      const match = matchById(matchId);
      match.winner = null;
      match.seed = null;
      match.resolvedPair = null;
      refreshMatches();
      emit();
      return view();
    }

    function subscribe(listener) {
      if (typeof listener !== "function") throw new Error("Tournament subscriber must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    refreshMatches();
    return Object.freeze({
      size,
      get revision() { return revision; },
      view,
      subscribe,
      setEntrant,
      randomize,
      select,
      selectedMatch,
      setSeed,
      recordWinner,
      clearWinner
    });
  }

  return { createTournamentBracket, TOURNAMENT_SIZES: Object.freeze(SUPPORTED_SIZES) };
});