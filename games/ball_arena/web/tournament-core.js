(function initializeTournamentBracket(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.ArenaTournamentCore = api;
})(globalThis, function createTournamentBracketApi() {
  "use strict";

  const DEFAULT_TOURNAMENT_SIZE = 32;
  // 界面上可选的正赛规模（2 的幂）。API 本身仍接受任意 2 的幂并用参赛池
  // 上限收口，这样老的对阵数据与测试里的自定义规模都不受影响。
  const TOURNAMENT_BRACKET_SIZES = Object.freeze([4, 8, 16, 32, 64, 128]);
  const TOURNAMENT_STORAGE_VERSION = 1;
  const DEFAULT_TOURNAMENT_MODE = "1v1";
  const TOURNAMENT_BATTLE_MODES = Object.freeze(["1v1"]);

  function isTournamentBattleMode(mode) {
    return TOURNAMENT_BATTLE_MODES.includes(mode);
  }

  function isPowerOfTwo(value) {
    return Number.isInteger(value) && value >= 2 && (value & (value - 1)) === 0;
  }

  function largestPowerOfTwoAtMost(value) {
    let result = 1;
    while (result * 2 <= value) result *= 2;
    return result;
  }

  function entrantCountForRound(bracket, roundIndex) {
    return bracket.size >> roundIndex;
  }

  function roundNameForRoundIndex(bracket, roundIndex) {
    const entrantCount = entrantCountForRound(bracket, roundIndex);
    if (entrantCount <= 2) return "决赛";
    if (entrantCount === 4) return "半决赛";
    return entrantCount + "强";
  }

  function validateEntrantIds(entrantIds) {
    if (!Array.isArray(entrantIds) || entrantIds.length < 2) {
      throw new Error("A tournament requires at least two entrant ball IDs");
    }
    const seen = new Set();
    for (const id of entrantIds) {
      if (typeof id !== "string" || id.length === 0) {
        throw new TypeError("Tournament entrant IDs must be non-empty strings");
      }
      if (seen.has(id)) {
        throw new Error(`Duplicate tournament entrant ID: ${id}`);
      }
      seen.add(id);
    }
  }

  function shuffleWithRandom(items, random) {
    const shuffled = items.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      const swapped = shuffled[swapIndex];
      shuffled[swapIndex] = shuffled[index];
      shuffled[index] = swapped;
    }
    return shuffled;
  }

  function tournamentTeamCapacity(definitions, teamSize) {
    if (![1, 2, 3].includes(teamSize)) throw new Error("Invalid tournament team size");
    const elites = definitions.filter((definition) => definition.rosterType === "elite").length;
    const normals = definitions.length - elites;
    if (teamSize === 1) return definitions.length;
    if (teamSize === 2) return elites + Math.floor(normals / 2);
    const pairs = Math.min(elites, normals);
    return pairs + Math.floor((normals - pairs) / 3);
  }

  function createTeamTournament(definitions, options = {}) {
    const teamSize = options.teamSize === undefined ? 1 : options.teamSize;
    const capacity = tournamentTeamCapacity(definitions, teamSize);
    validateEntrantIds(definitions.map((definition) => definition.id));
    const size = options.size === undefined ? DEFAULT_TOURNAMENT_SIZE : options.size;
    if (!isPowerOfTwo(size) || size > capacity) throw new Error("Insufficient tournament teams");
    if (teamSize === 1) return createTournamentBracket(definitions.map((definition) => definition.id), options);
    const random = options.random || Math.random;
    const normals = shuffleWithRandom(definitions.filter((definition) => definition.rosterType !== "elite"), random);
    const elites = shuffleWithRandom(definitions.filter((definition) => definition.rosterType === "elite"), random);
    const rosters = [];
    // Pack complete teams first, then draw teams. No ball can enter twice.
    while (elites.length && (teamSize === 2 || normals.length)) {
      const ballIds = [elites.pop().id];
      if (teamSize === 3) ballIds.push(normals.pop().id);
      rosters.push(ballIds);
    }
    while (normals.length >= teamSize) rosters.push(normals.splice(0, teamSize).map((definition) => definition.id));
    const teams = rosters.map((ballIds, index) => ({ id: `team-${index}`, ballIds }));
    const bracket = createTournamentBracket(teams.map((team) => team.id), options);
    bracket.teamSize = teamSize;
    bracket.teams = teams.filter((team) => bracket.entrants.includes(team.id));
    return bracket;
  }

  function tournamentEntrantBallIds(bracket, entrantId) {
    if (!entrantId) return [];
    if (bracket.teamSize === 1) return [entrantId];
    const team = bracket.teams.find((entry) => entry.id === entrantId);
    return team ? team.ballIds.slice() : [];
  }

  function createTournamentBracket(entrantIds, options) {
    if (options === null || typeof options !== "object") options = {};
    validateEntrantIds(entrantIds);

    const mode = options.mode === undefined
      ? DEFAULT_TOURNAMENT_MODE
      : options.mode;
    if (!isTournamentBattleMode(mode)) {
      throw new Error("Tournament mode must be 1v1 or bounce or gyro");
    }

    const requestedSize = options.size === undefined
      ? DEFAULT_TOURNAMENT_SIZE
      : options.size;
    if (!Number.isInteger(requestedSize) || requestedSize < 2) {
      throw new Error("Tournament size must be an integer of at least two");
    }
    const size = Math.min(requestedSize, largestPowerOfTwoAtMost(entrantIds.length));
    if (!isPowerOfTwo(size)) {
      throw new Error("Tournament size must be a power of two");
    }

    const random = typeof options.random === "function" ? options.random : Math.random;
    const entrants = shuffleWithRandom(entrantIds, random).slice(0, size);

    const roundCount = Math.round(Math.log2(size));
    const rounds = [];
    for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
      const matchCount = size >> (roundIndex + 1);
      const matches = [];
      for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
        matches.push({
          id: `r${roundIndex}-m${matchIndex}`,
          round: roundIndex,
          index: matchIndex,
          leftId: roundIndex === 0 ? entrants[matchIndex * 2] : null,
          rightId: roundIndex === 0 ? entrants[matchIndex * 2 + 1] : null,
          winnerId: null
        });
      }
      rounds.push(matches);
    }

    return {
      version: TOURNAMENT_STORAGE_VERSION,
      mode,
      filterElite: options.filterElite === true,
      teamSize: 1,
      size,
      entrants,
      rounds
    };
  }

  function findMatch(bracket, matchId) {
    for (const round of bracket.rounds) {
      for (const match of round) {
        if (match && match.id === matchId) return match;
      }
    }
    return null;
  }

  function allMatches(bracket) {
    const matches = [];
    for (const round of bracket.rounds) {
      for (const match of round) matches.push(match);
    }
    return matches;
  }

  function nextPendingMatch(bracket) {
    for (const round of bracket.rounds) {
      for (const match of round) {
        if (match && !match.winnerId && match.leftId && match.rightId) return match;
      }
    }
    return null;
  }

  function recordMatchResult(bracket, matchId, winnerId) {
    if (!bracket || !Array.isArray(bracket.rounds)) return false;
    const match = findMatch(bracket, matchId);
    if (!match || match.winnerId) return false;
    if (winnerId !== match.leftId && winnerId !== match.rightId) return false;
    match.winnerId = winnerId;

    const nextRound = bracket.rounds[match.round + 1];
    if (nextRound) {
      const nextMatch = nextRound[Math.floor(match.index / 2)];
      if (nextMatch) {
        if (match.index % 2 === 0) nextMatch.leftId = winnerId;
        else nextMatch.rightId = winnerId;
      }
    }
    return true;
  }

  function isTournamentComplete(bracket) {
    if (!bracket || !Array.isArray(bracket.rounds) || bracket.rounds.length === 0) {
      return false;
    }
    return allMatches(bracket).every((match) => match && match.winnerId);
  }

  function tournamentChampionId(bracket) {
    if (!isTournamentComplete(bracket)) return null;
    const finalRound = bracket.rounds[bracket.rounds.length - 1];
    return finalRound[0].winnerId;
  }

  function tournamentProgress(bracket) {
    const matches = allMatches(bracket);
    const playedCount = matches.filter((match) => match && match.winnerId).length;
    let roundIndex = bracket.rounds.length - 1;
    let matchNumberInRound = bracket.rounds[roundIndex].length;
    outer:
    for (let index = 0; index < bracket.rounds.length; index += 1) {
      const round = bracket.rounds[index];
      for (let matchIndex = 0; matchIndex < round.length; matchIndex += 1) {
        if (round[matchIndex] && !round[matchIndex].winnerId) {
          roundIndex = index;
          matchNumberInRound = matchIndex + 1;
          break outer;
        }
      }
    }
    return {
      playedCount,
      totalMatches: matches.length,
      roundIndex,
      roundName: roundNameForRoundIndex(bracket, roundIndex),
      matchesInRound: bracket.rounds[roundIndex].length,
      matchNumberInRound
    };
  }

  function serializeTournament(bracket) {
    return JSON.stringify(bracket);
  }

  function deserializeTournament(serialized) {
    let parsed;
    try {
      parsed = JSON.parse(serialized);
    } catch (_error) {
      return null;
    }
    if (!parsed || parsed.version !== TOURNAMENT_STORAGE_VERSION ||
        !isPowerOfTwo(parsed.size) || !Array.isArray(parsed.entrants) ||
        !Array.isArray(parsed.rounds)) {
      return null;
    }
    // Brackets written before mode selection predate the mode field and were
    // always ordinary 1v1 battles. Keep those sessions resumable.
    if (parsed.mode === undefined) parsed.mode = DEFAULT_TOURNAMENT_MODE;
    if (!isTournamentBattleMode(parsed.mode)) return null;
    if (parsed.filterElite === undefined) parsed.filterElite = false;
    if (typeof parsed.filterElite !== "boolean") return null;
    if (parsed.teamSize === undefined) parsed.teamSize = 1;
    if (![1, 2, 3].includes(parsed.teamSize)) return null;
    if (parsed.teamSize > 1) {
      if (!Array.isArray(parsed.teams) || parsed.teams.length !== parsed.size) return null;
      const teamIds = new Set();
      const ballIds = new Set();
      for (const team of parsed.teams) {
        if (!team || !parsed.entrants.includes(team.id) || teamIds.has(team.id) ||
            !Array.isArray(team.ballIds) || team.ballIds.length < 1 || team.ballIds.length > parsed.teamSize) return null;
        teamIds.add(team.id);
        for (const id of team.ballIds) {
          if (typeof id !== "string" || !id || ballIds.has(id)) return null;
          ballIds.add(id);
        }
      }
    }
    const expectedRoundCount = Math.round(Math.log2(parsed.size));
    if (parsed.rounds.length !== expectedRoundCount) return null;
    const entrantSet = new Set(parsed.entrants);
    if (entrantSet.size !== parsed.size) return null;

    for (let roundIndex = 0; roundIndex < parsed.rounds.length; roundIndex += 1) {
      const round = parsed.rounds[roundIndex];
      if (!Array.isArray(round) || round.length !== (parsed.size >> (roundIndex + 1))) {
        return null;
      }
      for (const match of round) {
        if (!match || typeof match.id !== "string" || match.id.length === 0 ||
            typeof match.round !== "number" || typeof match.index !== "number") {
          return null;
        }
        for (const side of ["leftId", "rightId", "winnerId"]) {
          if (match[side] !== null && typeof match[side] !== "string") return null;
        }
        if (match.winnerId !== null &&
            match.winnerId !== match.leftId && match.winnerId !== match.rightId) {
          return null;
        }
        if (match.leftId !== null && !entrantSet.has(match.leftId)) return null;
        if (match.rightId !== null && !entrantSet.has(match.rightId)) return null;
      }
    }
    return parsed;
  }

  return {
    DEFAULT_TOURNAMENT_SIZE,
    DEFAULT_TOURNAMENT_MODE,
    TOURNAMENT_BRACKET_SIZES,
    TOURNAMENT_BATTLE_MODES,
    isTournamentBattleMode,
    TOURNAMENT_STORAGE_VERSION,
    createTournamentBracket,
    createTeamTournament,
    tournamentTeamCapacity,
    tournamentEntrantBallIds,
    findTournamentMatch: findMatch,
    nextPendingMatch,
    recordMatchResult,
    isTournamentComplete,
    tournamentChampionId,
    tournamentProgress,
    roundNameForRoundIndex,
    serializeTournament,
    deserializeTournament
  };
});
