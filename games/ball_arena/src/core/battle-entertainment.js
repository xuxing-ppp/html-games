(function initializeBattleEntertainment(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBattleEntertainmentApi() {
  "use strict";
  const SAMPLE_SECONDS = 0.25;
  const MAX_CURVE_POINTS = 241;
  const BATTLE_ENTERTAINMENT_VERSION = 2.4;
  const OPENING_WINDOW_SECONDS = 8;
  const MEANINGFUL_HEALTH_CHANGE = 0.03;
  const ACTIVE_HEALTH_CHANGE = 0.002;
  const SWING_THRESHOLD = 0.08;
  const LEAD_CONFIRM_SECONDS = 1;
  const LEAD_FULL_SECONDS = 3;
  const LEAD_FULL_AREA = 0.6; // Normalized HP fraction * presentation seconds.
  const LEAD_FULL_MEAN_GAP = 0.2;
  const MIN_REVERSAL_QUALITY = 0.25;
  const clamp = (value) => Math.max(0, Math.min(1, value));

  // Half-second signed HP-difference windows suppress individual hit order.
  // Both sides of a turn need sustained movement; idle time cannot confirm it.
  function createTrendTracker() {
    let windowTime = 0, windowChange = 0;
    let stage = null, prior = null;
    let value = 0, count = 0, credited = 0;
    function consume(change) {
      const slope = change / 0.5;
      const sign = Math.abs(slope) >= 0.015 ? Math.sign(slope) : 0;
      if (!sign) {
        stage = null;
        prior = null;
        credited = 0;
        return;
      }
      if (!stage || stage.sign !== sign) {
        prior = stage && stage.seconds >= 1 && stage.distance >= 0.24 ? stage : null;
        stage = { sign, seconds: 0, distance: 0 };
        credited = 0;
      }
      stage.seconds += 0.5;
      stage.distance += Math.abs(change);
      if (!prior || stage.seconds < 1 || stage.distance < 0.24) return;
      const slopeChange = prior.distance / prior.seconds + stage.distance / stage.seconds;
      const quality = clamp(Math.min(prior.distance, stage.distance) / 0.4) *
        clamp(Math.min(prior.seconds, stage.seconds) / 2) * clamp(slopeChange / 0.12);
      if (quality > credited) {
        if (!credited) count += 1;
        value += quality - credited;
        credited = quality;
      }
    }
    return {
      sample(change, dt) {
        const slope = change / dt;
        let remaining = dt;
        while (remaining > 1e-9) {
          const step = Math.min(0.5 - windowTime, remaining);
          windowChange += slope * step;
          windowTime += step;
          remaining -= step;
          if (windowTime >= 0.5 - 1e-9) {
            consume(windowChange);
            windowTime = 0;
            windowChange = 0;
          }
        }
      },
      summarize: () => ({ trendReversals: count, trendReversalValue: value })
    };
  }

  function addArea(stats, area) {
    const delta = area - stats.mean;
    stats.count += 1;
    stats.mean += delta / stats.count;
    stats.m2 += delta * (area - stats.mean);
    stats.total += area;
  }

  function leadQuality(stage) {
    if (!stage || stage.seconds <= 0) return 0;
    return clamp(stage.area / LEAD_FULL_AREA) * clamp(stage.seconds / LEAD_FULL_SECONDS) *
      clamp((stage.area / stage.seconds - SWING_THRESHOLD) / (LEAD_FULL_MEAN_GAP - SWING_THRESHOLD));
  }

  // Streaming geometry and narrative state are separate. Raw lobes split at
  // interpolated zero crossings; effective leads absorb brief opposite blips.
  // Only O(1) aggregates/current stages are retained, not an unbounded lobe list.
  function createLeadAreaTracker() {
    const closed = { count: 0, mean: 0, m2: 0, total: 0 };
    const overturned = { count: 0, mean: 0, m2: 0, total: 0 };
    const comebackBySign = { "1": 0, "-1": 0 };
    let rawArea = 0;
    let incumbent = null;
    let challenger = null;
    let reversalValue = 0;
    let maxQuality = 0;

    function recordReversal(stage, stats, comebacks) {
      // Once a meaningful advantage has formed, a long near-tie pursuit must
      // not erase it by diluting the whole-stage mean gap.
      const quality = stage.quality;
      if (quality < MIN_REVERSAL_QUALITY) return 0;
      addArea(stats, stage.area);
      comebacks[-stage.sign] = Math.max(comebacks[-stage.sign], quality * clamp(stage.peak / 0.6));
      return quality;
    }

    function piece(startGap, endGap, dt) {
      if (!(dt > 0)) return;
      const sign = Math.sign(startGap || endGap);
      if (!sign) {
        if (challenger) challenger.hold = 0;
        return;
      }
      const start = Math.abs(startGap);
      const end = Math.abs(endGap);
      const area = (start + end) * dt / 2;
      rawArea += area;
      if (end === 0) {
        addArea(closed, rawArea);
        rawArea = 0;
      }

      if (incumbent && incumbent.sign === sign) {
        challenger = null;
        incumbent.area += area;
        incumbent.seconds += dt;
        incumbent.peak = Math.max(incumbent.peak, start, end);
        incumbent.quality = Math.max(incumbent.quality, leadQuality(incumbent));
        maxQuality = Math.max(maxQuality, incumbent.quality);
        return;
      }
      if (!challenger || challenger.sign !== sign) {
        challenger = { sign, area: 0, seconds: 0, peak: 0, hold: 0, quality: 0 };
      }
      challenger.area += area;
      challenger.seconds += dt;
      challenger.peak = Math.max(challenger.peak, start, end);
      challenger.quality = Math.max(challenger.quality, leadQuality(challenger));
      // Confirmation needs a continuous second above the 8-point threshold,
      // not a single peak followed by a long near-tie.
      challenger.hold = end < SWING_THRESHOLD ? 0 : start >= SWING_THRESHOLD
        ? challenger.hold + dt : dt * (end - SWING_THRESHOLD) / (end - start);
      if (challenger.hold + 1e-9 >= LEAD_CONFIRM_SECONDS) {
        if (incumbent) reversalValue += recordReversal(incumbent, overturned, comebackBySign);
        incumbent = challenger;
        challenger = null;
        maxQuality = Math.max(maxQuality, incumbent.quality);
      }
    }

    function sample(fromGap, toGap, dt) {
      if (fromGap * toGap < 0) {
        const split = dt * Math.abs(fromGap) / (Math.abs(fromGap) + Math.abs(toGap));
        piece(fromGap, 0, split);
        piece(0, toGap, dt - split);
      } else piece(fromGap, toGap, dt);
    }

    function summarize(winnerSign, finalGap) {
      const raw = { ...closed };
      if (rawArea > 0) addArea(raw, rawArea); // End boundary closes the final open lobe for statistics only.
      const reversed = { ...overturned };
      const comebacks = { ...comebackBySign };
      let value = reversalValue;
      // A decisive winning blow confirms the new leader without a fake waiting
      // period after death. Queries do not commit this terminal transition.
      if (incumbent && challenger && challenger.sign === winnerSign && Math.sign(finalGap) === winnerSign) {
        value += recordReversal(incumbent, reversed, comebacks);
      }
      return {
        leadAreaCount: raw.count, closedLeadAreaCount: closed.count,
        leadAreaTotal: raw.total, leadAreaMean: raw.mean,
        leadAreaVariance: raw.count ? Math.max(0, raw.m2 / raw.count) : 0,
        terminalLeadArea: rawArea,
        effectiveLeadChanges: reversed.count,
        reversedAreaMean: reversed.mean,
        reversedAreaVariance: reversed.count ? Math.max(0, reversed.m2 / reversed.count) : 0,
        reversalValue: value, comeback: comebacks[winnerSign] || 0,
        maxQuality
      };
    }
    return { sample, summarize };
  }

  // Read-only, opt-in observer for seed searches. Time is unscaled presentation
  // time: freezes are visible, hidden time skips are not. Never consumes RNG.
  function createBattleEntertainmentTracker(game) {
    const teams = game.teams.map((team) => {
      const members = team.balls.filter((ball) => !ball.isSummon).slice();
      return { id: team.id, members, capacity: members.reduce((sum, ball) =>
        sum + (ball.initialMaxHp > 0 ? ball.initialMaxHp : ball.maxHp), 0) };
    });
    // Horde / free-for-all do not have two comparable health reserves.
    if (teams.length !== 2 || teams.some((team) => !(team.capacity > 0))) return null;
    const readHealth = () => teams.map((team) => clamp(team.members.reduce((sum, ball) =>
      sum + Math.max(0, ball.hp), 0) / team.capacity));
    const initial = readHealth();
    let previous = [0, ...initial];
    let nextSample = SAMPLE_SECONDS;
    let curve = [previous];
    let curveInterval = SAMPLE_SECONDS;
    let lastCurveTime = 0;
    let pivot = initial[0] - initial[1];
    let extreme = pivot;
    let direction = 0;
    let confirmedVariation = 0;
    let rawVariation = 0;
    let burstEnergy = 0;
    let leader = 0;
    let leadChanges = 0;
    let minGap = pivot;
    let maxGap = pivot;
    let closeSeconds = 0;
    let quietSeconds = 0;
    let totalQuietSeconds = 0;
    let longestQuiet = 0;
    let openingImpactSeconds = null;
    let openingHealthMovement = 0;
    let activeSeconds = 0;
    let quietExcessSeconds = 0;
    let lastInteractionWindow = -1;
    let lastInteractionTime = -Infinity;
    let interactionWindows = 0;
    let quietRunReliefSeconds = 0;
    let interactionReliefSeconds = 0;
    const leadAreas = createLeadAreaTracker();
    const trends = createTrendTracker();

    // Only verified outcomes are admitted. One boolean window per presentation
    // second bounds both storage and the value of high-frequency attack spam.
    // Hidden simulation steps share their outer presentation timestamp.
    function observeInteraction(seconds, event) {
      if (!Number.isFinite(seconds) || seconds < previous[0]) {
        throw new TypeError("Entertainment interaction requires monotonic presentation seconds");
      }
      if (!event || !["block", "obstacle-destroyed"].includes(event.type) ||
          typeof event.actorId !== "string" || !event.actorId ||
          typeof event.targetId !== "string" || !event.targetId || event.actorId === event.targetId ||
          event.teamId === event.targetTeamId ||
          !teams.some(team => team.id === event.teamId) ||
          !teams.some(team => team.id === event.targetTeamId)) return;
      const window = Math.floor(seconds + 1e-9);
      if (window <= lastInteractionWindow) return;
      lastInteractionWindow = window;
      lastInteractionTime = seconds;
      interactionWindows += 1;
    }

    function sample(seconds, force = false) {
      if (!Number.isFinite(seconds) || seconds < previous[0]) {
        throw new TypeError("Entertainment sample requires monotonic presentation seconds");
      }
      if (seconds === previous[0] || (!force && seconds + 1e-9 < nextSample)) return;
      const health = readHealth();
      const point = [seconds, ...health];
      const dt = seconds - previous[0];
      const gap = health[0] - health[1];
      leadAreas.sample(previous[1] - previous[2], gap, dt);
      trends.sample(gap - (previous[1] - previous[2]), dt);
      const delta = Math.abs(gap - (previous[1] - previous[2]));
      rawVariation += delta;
      // Small alternating chips do not masquerade as dramatic burst damage.
      if (delta >= 0.02) burstEnergy += delta * clamp(delta / dt / 0.4);
      const healthChange = Math.abs(health[0] - previous[1]) + Math.abs(health[1] - previous[2]);
      const openingDt = Math.max(0, Math.min(seconds, OPENING_WINDOW_SECONDS) - previous[0]);
      if (openingImpactSeconds === null && openingDt > 0) {
        openingHealthMovement += healthChange * openingDt / dt;
        if (openingHealthMovement >= MEANINGFUL_HEALTH_CHANGE) {
          openingImpactSeconds = Math.min(seconds, OPENING_WINDOW_SECONDS);
        }
      }
      const observedDt = Math.min(dt, SAMPLE_SECONDS);
      if (healthChange < ACTIVE_HEALTH_CHANGE) {
        const previousExcess = Math.max(0, quietSeconds - 3);
        quietSeconds += observedDt;
        quietExcessSeconds += Math.max(0, quietSeconds - 3) - previousExcess;
        totalQuietSeconds += observedDt;
        // Evidence excuses only its nearby interval, at most three seconds per
        // uninterrupted quiet run. It does not reset that run, create activity
        // points, or purchase paced duration. A shield stalemate is still idle.
        if (seconds >= lastInteractionTime && seconds - lastInteractionTime < 1) {
          const relief = Math.min(observedDt, 3 - quietRunReliefSeconds);
          quietRunReliefSeconds += relief;
          interactionReliefSeconds += relief;
        }
      } else {
        activeSeconds += observedDt;
        quietSeconds = 0;
        quietRunReliefSeconds = 0;
      }
      longestQuiet = Math.max(longestQuiet, quietSeconds);
      if (Math.abs(gap) <= 0.15) closeSeconds += observedDt;
      minGap = Math.min(minGap, gap);
      maxGap = Math.max(maxGap, gap);
      const nextLeader = gap >= SWING_THRESHOLD ? 1 : gap <= -SWING_THRESHOLD ? -1 : 0;
      if (nextLeader) {
        if (leader && nextLeader !== leader) leadChanges += 1;
        leader = nextLeader;
      }
      if (!direction) {
        if (Math.abs(gap - pivot) >= SWING_THRESHOLD) {
          direction = Math.sign(gap - pivot);
          extreme = gap;
        }
      } else if (direction * (gap - extreme) >= 0) {
        extreme = gap;
      } else if (direction * (extreme - gap) >= SWING_THRESHOLD) {
        confirmedVariation += Math.abs(extreme - pivot);
        pivot = extreme;
        extreme = gap;
        direction *= -1;
      }
      previous = point;
      nextSample = seconds + SAMPLE_SECONDS;
      if (seconds - lastCurveTime + 1e-9 >= curveInterval || force) {
        curve.push(point);
        lastCurveTime = seconds;
        if (curve.length > MAX_CURVE_POINTS) {
          curve = curve.filter((_point, index) => index % 2 === 0 || index === curve.length - 1);
          curveInterval *= 2;
        }
      }
    }

    function summarize(winnerTeamId) {
      const duration = previous[0];
      const variation = confirmedVariation + (direction ? Math.abs(extreme - pivot) : 0);
      const netChange = Math.abs(previous[1] - previous[2] - (initial[0] - initial[1]));
      const winnerIndex = teams.findIndex((team) => team.id === winnerTeamId);
      const areas = leadAreas.summarize(winnerIndex === 0 ? 1 : winnerIndex === 1 ? -1 : 0,
        previous[1] - previous[2]);
      const readability = 0.25 + 0.75 * areas.maxQuality;
      const swing = clamp(Math.max(0, variation - netChange) / 1.2) * readability;
      const burst = (rawVariation > 0 ? clamp(burstEnergy / rawVariation) : 0) * readability;
      // Quality accumulates without duration normalization. A rational curve
      // leaves meaningful headroom for later reversals instead of halving each gain.
      const trend = trends.summarize();
      // Two views of the same story, not additive event counts. The stronger
      // aggregate wins: a completed lead reversal retains full credit, while
      // sustained counteroffensives can score without ever crossing zero.
      const reversalValue = Math.max(areas.reversalValue, 0.75 * trend.trendReversalValue);
      const reversals = reversalValue / (reversalValue + 3);
      const comeback = areas.comeback;
      // Variance is a small rhythm bonus over genuinely overturned advantages.
      // Neither a large terminal stomp nor raw crossing noise can supply it.
      const rhythm = (areas.reversedAreaMean > 0
        ? clamp(Math.sqrt(areas.reversedAreaVariance) / areas.reversedAreaMean) : 0) *
        clamp(areas.effectiveLeadChanges / 3) * reversals;
      const tension = duration > 0 ? closeSeconds / duration * clamp(variation / 0.5) : 0;
      const quietRatio = duration > 0 ? totalQuietSeconds / duration : 0;
      // Lack of HP movement is weak evidence of inactivity, not proof. Real
      // interactions can reduce this conservative discount by at most 25%.
      const rawIdlePenalty = duration > 0 ? Math.min(0.4,
        0.2 * quietRatio + 0.015 * Math.max(0, longestQuiet - 5)) : 0;
      const idlePenalty = rawIdlePenalty * (1 - (totalQuietSeconds > 0
        ? Math.min(0.25, interactionReliefSeconds / totalQuietSeconds) : 0));
      const opening = openingImpactSeconds === null ? 0 :
        clamp(1 - openingImpactSeconds / OPENING_WINDOW_SECONDS);
      const activity = duration > 0 ? clamp(activeSeconds / (duration * 0.2)) : 0;
      const winnerHpRatio = winnerIndex >= 0 ? previous[winnerIndex + 1] : null;
      const clutchFinish = winnerHpRatio === null ? 0 : clamp((0.35 - winnerHpRatio) / 0.35);
      // Smooth, mild short-story discount: no 25-second target/cliff. Empty
      // padding still cannot buy viewing time, even with defensive interactions.
      const pacedDurationSeconds = Math.max(0, duration - quietExcessSeconds);
      const shortPenalty = 0.1 * Math.exp(-Math.pow(pacedDurationSeconds / 6, 2));
      const breakdown = {
        opening: 5 * opening, activity: 5 * activity, swing: 12 * swing, burst: 10 * burst,
        reversals: 40 * reversals, comeback: 15 * comeback, tension: 3 * tension,
        clutchFinish: 5 * clutchFinish, rhythm: 5 * rhythm
      };
      const baseScore = Object.values(breakdown).reduce((sum, points) => sum + points, 0);
      const idleDeduction = baseScore * idlePenalty;
      const shortDeduction = (baseScore - idleDeduction) * shortPenalty;
      const score = baseScore - idleDeduction - shortDeduction;
      Object.assign(breakdown, { baseScore, idleDeduction, shortDeduction,
        interactionRelief: baseScore * (rawIdlePenalty - idlePenalty) * (1 - shortPenalty) });
      const points = curve.map((point) => point.slice());
      if (points[points.length - 1][0] !== previous[0]) {
        if (points.length === MAX_CURVE_POINTS) points.pop();
        points.push(previous.slice());
      }
      return {
        version: BATTLE_ENTERTAINMENT_VERSION, score: Number(score.toFixed(1)),
        components: { opening, activity, swing, burst, reversals, comeback, tension, clutchFinish,
          rhythm, idlePenalty, shortPenalty },
        breakdown, rawIdlePenalty, interactionWindows, interactionReliefSeconds,
        leadAreaCount: areas.leadAreaCount, closedLeadAreaCount: areas.closedLeadAreaCount,
        leadAreaTotal: areas.leadAreaTotal, leadAreaMean: areas.leadAreaMean,
        leadAreaVariance: areas.leadAreaVariance, terminalLeadArea: areas.terminalLeadArea,
        effectiveLeadChanges: areas.effectiveLeadChanges,
        ...trend, reversalValue,
        reversedAreaMean: areas.reversedAreaMean, reversedAreaVariance: areas.reversedAreaVariance,
        pacedDurationSeconds,
        openingImpactSeconds, activeRatio: duration > 0 ? clamp(activeSeconds / duration) : 0, winnerHpRatio,
        variation, leadChanges, largestDeficit: winnerIndex === 0 ? Math.max(0, -minGap) :
          winnerIndex === 1 ? Math.max(0, maxGap) : 0,
        curve: points, teamIds: teams.map((team) => team.id)
      };
    }
    return Object.freeze({ sample, summarize, observeInteraction });
  }
  return { createBattleEntertainmentTracker, BATTLE_ENTERTAINMENT_VERSION };
});
