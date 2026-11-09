(function initializeBattleResult(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBattleResultApi() {
  "use strict";

  function captureInitialHp(game) {
    return Object.fromEntries(game.teams.flatMap((team) => team.balls.map((ball) => [
      ball.instanceId,
      Number(ball.maxHp.toFixed(3))
    ])));
  }

  function serializeBattleResult(game, metadata) {
    if (!game || !Array.isArray(game.teams)) {
      throw new TypeError("Battle result requires a game with teams");
    }
    const timedOut = metadata.timedOut === true;
    return {
      tournamentId: metadata.tournamentId || null,
      matchId: metadata.matchId || null,
      mode: metadata.mode,
      battleSeconds: Number(game.time.toFixed(3)),
      timedOut,
      winnerTeamId: timedOut || !game.winnerTeam || game.winnerTeam.role === "horde"
        ? null
        : game.winnerTeam.id,
      teams: game.teams.map((team) => ({
        id: team.id,
        role: team.role,
        members: team.balls.map((ball) => {
          const initialHpMap = metadata.initialHpByInstanceId;
          const recordedInitialHp = initialHpMap && initialHpMap[ball.instanceId];
          return {
            ballId: ball.id,
            instanceId: ball.instanceId,
            name: ball.name,
            finalHp: Number(Math.max(0, ball.hp).toFixed(3)),
            initialMaxHp: recordedInitialHp != null
              ? recordedInitialHp
              : Number(ball.maxHp.toFixed(3))
          };
        })
      }))
    };
  }

  return { captureInitialHp, serializeBattleResult };
});
