(function initializeDaredevilPlanner(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("./contact-model.js"), ...require("./arena-geometry.js") } : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createDaredevilPlanner(dependencies) {
  "use strict";
  const { firstSegmentCircleContact, resolveArenaGeometry } = dependencies;

  const DAREDEVIL_BATON = Object.freeze({
    speed: 600, spin: Math.PI * 4, halfLength: 18, halfWidth: 2,
    inertia: (36 * 36 + 4 * 4) / 12, restitution: 0.8, targetMass: 2,
    attackHorizon: 1.6, step: 1 / 240, contactRelease: 1,
    maxTargets: 6, maxCandidates: 96
  });
  const EPSILON = 1e-8;
  const TAU = Math.PI * 2;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const normalizeAngle = (angle) => ((angle % TAU) + TAU) % TAU;

  function batonContactGeometry(baton, target, padding) {
    const cosine = Math.cos(baton.rotation);
    const sine = Math.sin(baton.rotation);
    const offsetX = target.x - baton.x;
    const offsetY = target.y - baton.y;
    const projection = clamp(offsetX * cosine + offsetY * sine,
      -DAREDEVIL_BATON.halfLength, DAREDEVIL_BATON.halfLength);
    const pointX = baton.x + cosine * projection;
    const pointY = baton.y + sine * projection;
    const deltaX = target.x - pointX;
    const deltaY = target.y - pointY;
    const distance = Math.hypot(deltaX, deltaY);
    const radius = target.radius + DAREDEVIL_BATON.halfWidth + padding;
    let normalX = distance > EPSILON ? deltaX / distance : -sine;
    let normalY = distance > EPSILON ? deltaY / distance : cosine;
    if (distance <= EPSILON && (finite(baton.vx) * normalX + finite(baton.vy) * normalY) < 0) {
      normalX = -normalX; normalY = -normalY;
    }
    return {
      normalX, normalY, pointX, pointY,
      penetration: Math.max(0, radius - distance), clearance: distance - radius
    };
  }

  function getBatonCircleContact(baton, target, padding = 0) {
    const contact = batonContactGeometry(baton, target, padding);
    return contact.clearance <= EPSILON ? contact : null;
  }

  function getSweptBatonCircleContact(start, end, target, previousTarget = target) {
    const moveX = end.x - start.x;
    const moveY = end.y - start.y;
    const targetX = target.x - previousTarget.x;
    const targetY = target.y - previousTarget.y;
    const relativeX = moveX - targetX;
    const relativeY = moveY - targetY;
    const turn = end.rotation - start.rotation;
    const enclosingRadius = target.radius + DAREDEVIL_BATON.halfLength + DAREDEVIL_BATON.halfWidth;
    const offsetX = previousTarget.x - start.x;
    const offsetY = previousTarget.y - start.y;
    if (Math.min(offsetX, offsetX - relativeX) > enclosingRadius ||
        Math.max(offsetX, offsetX - relativeX) < -enclosingRadius ||
        Math.min(offsetY, offsetY - relativeY) > enclosingRadius ||
        Math.max(offsetY, offsetY - relativeY) < -enclosingRadius) return null;
    const broadStart = firstSegmentCircleContact(start.x, start.y,
      start.x + relativeX, start.y + relativeY, previousTarget.x, previousTarget.y, enclosingRadius);
    if (broadStart === null) return null;
    // Distance to a rotating capsule is Lipschitz-continuous with this speed
    // bound. Conservative advancement checks the actual stick, not its broad circle.
    const speedBound = Math.hypot(relativeX, relativeY) + DAREDEVIL_BATON.halfLength * Math.abs(turn);
    let progress = broadStart;
    for (let iteration = 0; iteration < 48 && progress <= 1 + EPSILON; iteration += 1) {
      const rotation = start.rotation + turn * progress;
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      const x = offsetX - relativeX * progress;
      const y = offsetY - relativeY * progress;
      const projection = clamp(x * cosine + y * sine,
        -DAREDEVIL_BATON.halfLength, DAREDEVIL_BATON.halfLength);
      const clearance = Math.hypot(x - cosine * projection, y - sine * projection) -
        target.radius - DAREDEVIL_BATON.halfWidth;
      if (clearance <= 1e-6) {
        const contact = batonContactGeometry({
          x: start.x + moveX * progress, y: start.y + moveY * progress,
          rotation, vx: start.vx, vy: start.vy
        }, {
          x: previousTarget.x + targetX * progress,
          y: previousTarget.y + targetY * progress, radius: target.radius
        }, 0);
        return { ...contact, progress: clamp(progress, 0, 1) };
      }
      if (speedBound <= EPSILON) return null;
      progress += Math.max(1e-8, clearance / speedBound);
    }
    if (progress > 1 || speedBound <= EPSILON) return null;
    return searchGrazingBatonContact(start, end, target, previousTarget, progress, speedBound);
  }

  function searchGrazingBatonContact(start, end, target, previousTarget, progress, speedBound) {
    const moveX = end.x - start.x;
    const moveY = end.y - start.y;
    const targetX = target.x - previousTarget.x;
    const targetY = target.y - previousTarget.y;
    const relativeX = moveX - targetX;
    const relativeY = moveY - targetY;
    const turn = end.rotation - start.rotation;
    const offsetX = previousTarget.x - start.x;
    const offsetY = previousTarget.y - start.y;
    // Grazing entry can converge too slowly for the hot-path iteration budget.
    // Search unresolved intervals earliest-first using rigorous distance bounds,
    // without assuming a moving rotating capsule has one distance minimum.
    const tolerance = 1e-6;
    function clearanceAt(at) {
      const rotation = start.rotation + turn * at;
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      const x = offsetX - relativeX * at;
      const y = offsetY - relativeY * at;
      const along = clamp(x * cosine + y * sine,
        -DAREDEVIL_BATON.halfLength, DAREDEVIL_BATON.halfLength);
      return Math.hypot(x - cosine * along, y - sine * along) - target.radius - DAREDEVIL_BATON.halfWidth;
    }
    function intervalLowerBound(low, high, middleGap) {
      const middle = (low + high) * 0.5;
      const rotation = start.rotation + turn * middle;
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      const lowX = -offsetX + relativeX * low;
      const lowY = -offsetY + relativeY * low;
      const highX = -offsetX + relativeX * high;
      const highY = -offsetY + relativeY * high;
      const lowCenterX = lowX * cosine + lowY * sine;
      const lowCenterY = -lowX * sine + lowY * cosine;
      const highCenterX = highX * cosine + highY * sine;
      const highCenterY = -highX * sine + highY * cosine;
      const halfTurn = turn * (high - low) * 0.5;
      const armX = DAREDEVIL_BATON.halfLength * Math.abs(Math.cos(halfTurn));
      const armY = DAREDEVIL_BATON.halfLength * Math.abs(Math.sin(halfTurn));
      // Each rotating endpoint differs from its chord by at most L*w²*dt²/8.
      // The chord stays inside this box, including parallel near-miss paths.
      const curveError = DAREDEVIL_BATON.halfLength * halfTurn * halfTurn * 0.5;
      const minX = Math.min(lowCenterX, highCenterX) - armX - curveError;
      const maxX = Math.max(lowCenterX, highCenterX) + armX + curveError;
      const minY = Math.min(lowCenterY, highCenterY) - armY - curveError;
      const maxY = Math.max(lowCenterY, highCenterY) + armY + curveError;
      const distanceX = minX > 0 ? minX : maxX < 0 ? -maxX : 0;
      const distanceY = minY > 0 ? minY : maxY < 0 ? -maxY : 0;
      const boxBound = Math.hypot(distanceX, distanceY) - target.radius - DAREDEVIL_BATON.halfWidth;
      return Math.max(boxBound, middleGap - speedBound * (high - low) * 0.5);
    }
    function earliestContact(low, high, lowGap, highGap) {
      if (lowGap <= tolerance) return low;
      const middle = (low + high) * 0.5;
      const middleGap = clearanceAt(middle);
      if (intervalLowerBound(low, high, middleGap) > tolerance) return null;
      if (speedBound * (high - low) <= tolerance * 0.5 || high - low <= 1e-12) {
        if (middleGap <= tolerance) return middle;
        return highGap <= tolerance ? high : null;
      }
      const left = earliestContact(low, middle, lowGap, middleGap);
      return left !== null ? left : earliestContact(middle, high, middleGap, highGap);
    }
    const found = earliestContact(progress, 1, clearanceAt(progress), clearanceAt(1));
    if (found === null) return null;
    const contact = batonContactGeometry({
      x: start.x + moveX * found, y: start.y + moveY * found,
      rotation: start.rotation + turn * found, vx: start.vx, vy: start.vy
    }, {
      x: previousTarget.x + targetX * found,
      y: previousTarget.y + targetY * found, radius: target.radius
    }, 0);
    return { ...contact, progress: found };
  }

  function reflectBatonVelocity(vx, vy, normalX, normalY, outward) {
    const dot = vx * normalX + vy * normalY;
    if ((outward && dot >= 0) || (!outward && dot <= 0)) return { vx, vy };
    return { vx: vx - 2 * dot * normalX, vy: vy - 2 * dot * normalY };
  }

  function normalizeVelocity(vx, vy, speed, fallbackX, fallbackY) {
    const magnitude = Math.hypot(vx, vy);
    return magnitude > EPSILON ? { vx: vx / magnitude * speed, vy: vy / magnitude * speed }
      : { vx: fallbackX * speed, vy: fallbackY * speed };
  }

  function resolveBatonImpact(baton, target, contact, options = {}) {
    const wall = options.wall === true;
    const targetLocked = wall || options.targetLocked === true;
    const normalX = wall ? contact.normalX : -contact.normalX;
    const normalY = wall ? contact.normalY : -contact.normalY;
    const pointX = contact.pointX + (wall ? 0 : contact.normalX * DAREDEVIL_BATON.halfWidth);
    const pointY = contact.pointY + (wall ? 0 : contact.normalY * DAREDEVIL_BATON.halfWidth);
    const armX = pointX - baton.x;
    const armY = pointY - baton.y;
    const cross = armX * normalY - armY * normalX;
    const initialSpin = finite(baton.spin, DAREDEVIL_BATON.spin);
    const originalTargetVx = target ? finite(target.vx) : 0;
    const originalTargetVy = target ? finite(target.vy) : 0;
    const targetVx = targetLocked ? 0 : originalTargetVx;
    const targetVy = targetLocked ? 0 : originalTargetVy;
    const relativeNormal = (baton.vx - targetVx) * normalX +
      (baton.vy - targetVy) * normalY + initialSpin * cross;
    if (relativeNormal >= -EPSILON) return {
      vx: baton.vx, vy: baton.vy, spin: initialSpin,
      targetVx: originalTargetVx, targetVy: originalTargetVy, impulse: 0
    };
    const inverseTargetMass = targetLocked ? 0 : 1 / DAREDEVIL_BATON.targetMass;
    const impulse = -(1 + DAREDEVIL_BATON.restitution) * relativeNormal /
      (1 + inverseTargetMass + cross * cross / DAREDEVIL_BATON.inertia);
    let spin = clamp(initialSpin + impulse * cross / DAREDEVIL_BATON.inertia,
      -DAREDEVIL_BATON.spin, DAREDEVIL_BATON.spin);
    let velocity = normalizeVelocity(baton.vx + impulse * normalX,
      baton.vy + impulse * normalY, DAREDEVIL_BATON.speed, normalX, normalY);
    if (Math.abs(cross) <= EPSILON) {
      velocity = reflectBatonVelocity(baton.vx, baton.vy, normalX, normalY, true);
    }
    let changedTarget = { vx: originalTargetVx, vy: originalTargetVy };
    if (!targetLocked) {
      changedTarget = normalizeVelocity(originalTargetVx - impulse * normalX * inverseTargetMass,
        originalTargetVy - impulse * normalY * inverseTargetMass,
        Math.hypot(originalTargetVx, originalTargetVy), -normalX, -normalY);
    }
    // Fixed gameplay speeds and the spin limit can reintroduce incoming
    // contact after the unconstrained rigid-body impulse. Correct only the
    // direction needed to separate, retaining the resulting angular response.
    const otherNormal = targetLocked ? 0 : changedTarget.vx * normalX + changedTarget.vy * normalY;
    let requiredNormal = otherNormal - spin * cross;
    if (requiredNormal > DAREDEVIL_BATON.speed && Math.abs(cross) > EPSILON) {
      spin = clamp((otherNormal - DAREDEVIL_BATON.speed) / cross,
        -DAREDEVIL_BATON.spin, DAREDEVIL_BATON.spin);
      requiredNormal = otherNormal - spin * cross;
    }
    const currentNormal = velocity.vx * normalX + velocity.vy * normalY;
    if (currentNormal < requiredNormal - EPSILON) {
      const normalSpeed = clamp(requiredNormal + 0.01, -DAREDEVIL_BATON.speed, DAREDEVIL_BATON.speed);
      const tangentX = -normalY;
      const tangentY = normalX;
      let tangent = velocity.vx * tangentX + velocity.vy * tangentY;
      if (Math.abs(tangent) <= EPSILON) tangent = spin * (armX * normalX + armY * normalY);
      const tangentSign = tangent < 0 ? -1 : 1;
      const tangentSpeed = Math.sqrt(Math.max(0, DAREDEVIL_BATON.speed * DAREDEVIL_BATON.speed - normalSpeed * normalSpeed)) * tangentSign;
      velocity = { vx: normalX * normalSpeed + tangentX * tangentSpeed,
        vy: normalY * normalSpeed + tangentY * tangentSpeed };
    }
    return { ...velocity, spin, targetVx: changedTarget.vx, targetVy: changedTarget.vy, impulse };
  }

  function integrateBatonMotion(baton, dt) {
    return {
      x: baton.x + finite(baton.vx) * dt, y: baton.y + finite(baton.vy) * dt,
      vx: finite(baton.vx), vy: finite(baton.vy),
      rotation: baton.rotation + finite(baton.spin, DAREDEVIL_BATON.spin) * dt,
      spin: finite(baton.spin, DAREDEVIL_BATON.spin)
    };
  }

  function clampBatonToArena(baton, arenaSize, inset = 0.02) {
    const arena = resolveArenaGeometry(arenaSize);
    if (arena.shape === "circle") {
      const position = { ...baton };
      const dx = Math.cos(baton.rotation) * DAREDEVIL_BATON.halfLength;
      const dy = Math.sin(baton.rotation) * DAREDEVIL_BATON.halfLength;
      for (let iteration = 0; iteration < 12; iteration++) {
        let corrected = false;
        for (const sign of [-1, 1]) {
          const x = position.x + sign * dx, y = position.y + sign * dy;
          const point = arena.clampPoint(x, y, DAREDEVIL_BATON.halfWidth + inset);
          position.x += point.x - x; position.y += point.y - y;
          corrected ||= Math.hypot(point.x - x, point.y - y) > EPSILON;
        }
        if (!corrected) break;
      }
      return position;
    }
    const extentX = Math.abs(Math.cos(baton.rotation)) * DAREDEVIL_BATON.halfLength + DAREDEVIL_BATON.halfWidth;
    const extentY = Math.abs(Math.sin(baton.rotation)) * DAREDEVIL_BATON.halfLength + DAREDEVIL_BATON.halfWidth;
    return {
      ...baton,
      x: clamp(baton.x, Math.min(arena.centerX, arena.left + extentX + inset), Math.max(arena.centerX, arena.right - extentX - inset)),
      y: clamp(baton.y, Math.min(arena.centerY, arena.top + extentY + inset), Math.max(arena.centerY, arena.bottom - extentY - inset))
    };
  }

  function getBatonWallContact(baton, maxTime, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    if (arena.shape === "circle") return getCircularBatonWallContact(baton, maxTime, arena);
    let first = null;
    const spin = finite(baton.spin, DAREDEVIL_BATON.spin);
    for (let axis = 0; axis < 2; axis += 1) {
      const velocity = axis === 0 ? baton.vx : baton.vy;
      const position = axis === 0 ? baton.x : baton.y;
      const minimum = axis === 0 ? arena.left : arena.top;
      const maximum = axis === 0 ? arena.right : arena.bottom;
      const initialExtent = Math.abs(axis === 0 ? Math.cos(baton.rotation) : Math.sin(baton.rotation)) *
        DAREDEVIL_BATON.halfLength + DAREDEVIL_BATON.halfWidth;
      for (const sign of [-1, 1]) {
        const initialClearance = sign > 0 ? maximum - position - initialExtent : position - minimum - initialExtent;
        if (initialClearance > Math.abs(velocity) * maxTime +
            DAREDEVIL_BATON.halfLength * Math.abs(spin) * maxTime) continue;
        function clearance(time) {
          const rotation = baton.rotation + spin * time;
          const extent = Math.abs(axis === 0 ? Math.cos(rotation) : Math.sin(rotation)) *
            DAREDEVIL_BATON.halfLength + DAREDEVIL_BATON.halfWidth;
          return sign > 0 ? maximum - position - velocity * time - extent
            : position + velocity * time - minimum - extent;
        }
        let low = 0;
        let high = null;
        const initialContact = wallSupport(baton, axis, sign);
        const closingSpeed = -(baton.vx * initialContact.normalX + baton.vy * initialContact.normalY) -
          spin * ((initialContact.pointX - baton.x) * initialContact.normalY -
            (initialContact.pointY - baton.y) * initialContact.normalX);
        // A preceding response may start microscopically inside this face. Its
        // separating support must not be treated as another zero-time impact.
        if (initialClearance <= EPSILON && closingSpeed <= EPSILON) continue;
        if (initialClearance <= EPSILON && closingSpeed > EPSILON) high = 0;
        else {
          // Keep the ordinary midpoint/endpoint bracket, then include the true
          // clearance minima: translation shifts them away from support peaks.
          const middle = maxTime * 0.5;
          if (clearance(middle) <= 0) high = middle;
          else if (clearance(maxTime) <= 0) { low = middle; high = maxTime; }
          if (Math.abs(spin) > EPSILON) {
            const ratio = sign * velocity / (DAREDEVIL_BATON.halfLength * spin);
            if (Math.abs(ratio) <= 1) {
              const peakBase = (axis === 0 ? 0 : Math.PI / 2) + Math.asin(ratio);
              const finalRotation = baton.rotation + spin * maxTime;
              const firstPeak = Math.ceil((Math.min(baton.rotation, finalRotation) - peakBase) / Math.PI);
              const lastPeak = Math.floor((Math.max(baton.rotation, finalRotation) - peakBase) / Math.PI);
              for (let peak = firstPeak; peak <= lastPeak; peak += 1) {
                const time = (peakBase + peak * Math.PI - baton.rotation) / spin;
                if (time >= 0 && time <= maxTime && clearance(time) <= 0 &&
                    (high === null || time < high)) {
                  low = 0; high = time;
                }
              }
            }
          }
        }
        if (high === null) continue;
        for (let iteration = 0; high > low && iteration < 18; iteration += 1) {
          const middle = (low + high) * 0.5;
          if (clearance(middle) > 0) low = middle; else high = middle;
        }
        const at = integrateBatonMotion(baton, high);
        const support = wallSupport(at, axis, sign);
        const contact = { ...support, time: high };
        if (!first || contact.time < first.time - EPSILON) first = contact;
      }
    }
    return first;
  }

  function circularSupports(baton, arena) {
    return [-1, 1].map(sign => {
      const x = baton.x + Math.cos(baton.rotation) * sign * DAREDEVIL_BATON.halfLength;
      const y = baton.y + Math.sin(baton.rotation) * sign * DAREDEVIL_BATON.halfLength;
      const distance = Math.hypot(x - arena.centerX, y - arena.centerY);
      const normalX = distance > EPSILON ? (arena.centerX - x) / distance : 1;
      const normalY = distance > EPSILON ? (arena.centerY - y) / distance : 0;
      const pointX = x - normalX * DAREDEVIL_BATON.halfWidth;
      const pointY = y - normalY * DAREDEVIL_BATON.halfWidth;
      const cross = (pointX - baton.x) * normalY - (pointY - baton.y) * normalX;
      return { normalX, normalY, pointX, pointY, cross, wall: "circle",
        inwardNormalX: normalX, inwardNormalY: normalY,
        clearance: arena.width / 2 - distance - DAREDEVIL_BATON.halfWidth,
        closingSpeed: -(baton.vx * normalX + baton.vy * normalY) - finite(baton.spin) * cross };
    });
  }

  function getCircularBatonWallContact(baton, maxTime, arena) {
    const rate = Math.hypot(baton.vx, baton.vy) +
      Math.abs(finite(baton.spin, DAREDEVIL_BATON.spin)) * DAREDEVIL_BATON.halfLength;
    if (rate <= EPSILON) return null;
    let time = 0;
    // Conservative advancement bounds both translation and rotating capsule tips.
    for (let iteration = 0; iteration < 128 && time <= maxTime; iteration++) {
      const supports = circularSupports(integrateBatonMotion(baton, time), arena);
      const contact = supports.reduce((a, b) => a.clearance < b.clearance ? a : b);
      if (contact.clearance <= 1e-7 && contact.closingSpeed > EPSILON) return { ...contact, time };
      const advance = Math.max(1e-7, contact.clearance / rate);
      if (time + advance > maxTime) return null;
      time += advance;
    }
    return null;
  }

  function wallSupport(baton, axis, sign) {
    const cosine = Math.cos(baton.rotation);
    const sine = Math.sin(baton.rotation);
    const along = axis === 0 ? cosine : sine;
    const angularDerivative = (axis === 0 ? -sine : cosine) * finite(baton.spin, DAREDEVIL_BATON.spin);
    const supportDirection = Math.abs(along) > EPSILON ? along : angularDerivative;
    const endSign = Math.abs(supportDirection) <= EPSILON ? 0 : supportDirection * sign >= 0 ? 1 : -1;
    const armX = cosine * endSign * DAREDEVIL_BATON.halfLength + (axis === 0 ? sign * DAREDEVIL_BATON.halfWidth : 0);
    const armY = sine * endSign * DAREDEVIL_BATON.halfLength + (axis === 1 ? sign * DAREDEVIL_BATON.halfWidth : 0);
    const normalX = axis === 0 ? -sign : 0;
    const normalY = axis === 1 ? -sign : 0;
    const closingRotation = -finite(baton.spin, DAREDEVIL_BATON.spin) * (armX * normalY - armY * normalX);
    return {
      normalX, normalY, pointX: baton.x + armX, pointY: baton.y + armY,
      inwardNormalX: normalX, inwardNormalY: normalY,
      axisX: axis === 0, axisY: axis === 1,
      wall: axis === 0 ? sign < 0 ? "left" : "right" : sign < 0 ? "top" : "bottom",
      closingRotation, closingSpeed: -(baton.vx * normalX + baton.vy * normalY) + closingRotation
    };
  }

  function closestConstrainedVelocity(velocity, spin, constraints) {
    const originalAngle = Math.atan2(velocity.vy, velocity.vx);
    const angles = [originalAngle];
    const margin = DAREDEVIL_BATON.halfLength * spin * spin * DAREDEVIL_BATON.step + 0.02;
    for (const constraint of constraints) {
      const required = constraint.centerOnly ? 0 : margin - spin * constraint.cross;
      if (required > DAREDEVIL_BATON.speed + EPSILON) return null;
      if (required < -DAREDEVIL_BATON.speed) continue;
      const normalAngle = Math.atan2(constraint.normalY, constraint.normalX);
      const offset = Math.acos(clamp(required / DAREDEVIL_BATON.speed, -1, 1));
      angles.push(normalAngle - offset, normalAngle + offset);
    }
    let best = null;
    let bestAlignment = -Infinity;
    for (const angle of angles) {
      const vx = Math.cos(angle) * DAREDEVIL_BATON.speed;
      const vy = Math.sin(angle) * DAREDEVIL_BATON.speed;
      if (!constraints.every((constraint) => vx * constraint.normalX + vy * constraint.normalY >=
        (constraint.centerOnly ? 0 : margin - spin * constraint.cross) - 1e-6)) continue;
      const alignment = vx * velocity.vx + vy * velocity.vy;
      if (alignment > bestAlignment) { bestAlignment = alignment; best = { vx, vy }; }
    }
    return best;
  }

  function resolveBatonWallImpact(baton, contact, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const response = resolveBatonImpact(baton, null, contact, { wall: true });
    const incomingNormal = baton.vx * contact.normalX + baton.vy * contact.normalY;
    if (incomingNormal < -EPSILON) {
      // A fixed-speed weapon must send its centre away from a wall impact;
      // a separating rotating endpoint alone would otherwise keep it wall-bound.
      Object.assign(response, reflectBatonVelocity(baton.vx, baton.vy,
        contact.normalX, contact.normalY, true));
    }
    const constraints = [];
    if (arena.shape === "circle") {
      for (const support of circularSupports(baton, arena)) {
        if (support.clearance > DAREDEVIL_BATON.contactRelease) continue;
        constraints.push({ normalX: support.normalX, normalY: support.normalY, cross: support.cross });
        constraints.push({ normalX: support.normalX, normalY: support.normalY, cross: 0, centerOnly: true });
      }
    }
    if (arena.shape !== "circle") {
    for (let axis = 0; axis < 2; axis += 1) {
      for (const sign of [-1, 1]) {
        const support = wallSupport({ ...baton, spin: response.spin }, axis, sign);
        const currentFace = support.normalX === contact.normalX && support.normalY === contact.normalY;
        const gap = sign < 0 ? axis === 0 ? support.pointX - arena.left : support.pointY - arena.top
          : axis === 0 ? arena.right - support.pointX : arena.bottom - support.pointY;
        if (!currentFace && gap > DAREDEVIL_BATON.contactRelease) continue;
        constraints.push({ normalX: support.normalX, normalY: support.normalY,
          cross: (support.pointX - baton.x) * support.normalY -
            (support.pointY - baton.y) * support.normalX });
        constraints.push({ normalX: support.normalX, normalY: support.normalY, cross: 0, centerOnly: true });
      }
    }
    }
    let spin = response.spin;
    let velocity = closestConstrainedVelocity(response, spin, constraints);
    if (!velocity) {
      // Reduce angular speed only when no 600-speed direction can separate
      // the stick and its centre from the current/neighboring faces together.
      let low = 0;
      let high = 1;
      velocity = closestConstrainedVelocity(response, 0, constraints);
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const middle = (low + high) * 0.5;
        const candidate = closestConstrainedVelocity(response, response.spin * middle, constraints);
        if (candidate) { low = middle; velocity = candidate; } else high = middle;
      }
      spin = response.spin * low;
    }
    return { ...response, ...velocity, spin };
  }

  function reflectAxis(position, velocity, dt, radius, arenaSize) {
    const span = arenaSize - radius * 2;
    if (span <= EPSILON) return { position: arenaSize / 2, velocity: 0 };
    const raw = position - radius + velocity * dt;
    const phase = ((raw % (span * 2)) + span * 2) % (span * 2);
    const reflected = phase <= span;
    let nextVelocity = reflected ? velocity : -velocity;
    if (Math.abs(phase) <= EPSILON) nextVelocity = Math.abs(velocity);
    if (Math.abs(phase - span) <= EPSILON) nextVelocity = -Math.abs(velocity);
    return { position: radius + (reflected ? phase : span * 2 - phase), velocity: nextVelocity };
  }

  function moveTarget(target, dt, arenaSize) {
    if (target.movementLocked) return { ...target };
    const arena = resolveArenaGeometry(arenaSize);
    if (arena.shape !== "square") {
      const motion = arena.advanceMotion(target, dt);
      return { ...target, x: motion.x, y: motion.y, vx: motion.vx, vy: motion.vy };
    }
    arenaSize = arena.size;
    const x = reflectAxis(target.x, target.vx, dt, target.radius, arenaSize);
    const y = reflectAxis(target.y, target.vy, dt, target.radius, arenaSize);
    return { ...target, x: x.position, y: y.position, vx: x.velocity, vy: y.velocity };
  }

  function advanceTargetFrame(target, dt, arenaSize) {
    if (target.movementLocked) return;
    const arena = resolveArenaGeometry(arenaSize);
    if (arena.shape !== "square") {
      Object.assign(target, moveTarget(target, dt, arena));
      return;
    }
    arenaSize = arena.size;
    target.x += target.vx * dt; target.y += target.vy * dt;
    if (target.x <= target.radius) { target.x = target.radius; target.vx = Math.abs(target.vx); }
    if (target.x >= arenaSize - target.radius) { target.x = arenaSize - target.radius; target.vx = -Math.abs(target.vx); }
    if (target.y <= target.radius) { target.y = target.radius; target.vy = Math.abs(target.vy); }
    if (target.y >= arenaSize - target.radius) { target.y = arenaSize - target.radius; target.vy = -Math.abs(target.vy); }
  }

  function prepareInput(input) {
    const arenaSize = resolveArenaGeometry(input.arena || input.arenaSize);
    const origin = input.baton || input.origin || input.owner;
    const owner = input.owner || origin;
    const targets = (input.enemies || input.targets || [])
      .filter((target) => target.alive !== false && (target.targetable !== false || target.physical !== false))
      .map((target, index) => ({
        instanceId: target.instanceId || `target-${index}`,
        x: target.x, y: target.y, vx: finite(target.vx), vy: finite(target.vy),
        radius: finite(target.radius, 15), movementLocked: target.movementLocked === true,
        physical: target.physical !== false, targetable: target.targetable !== false
      }))
      .sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y))
      .slice(0, DAREDEVIL_BATON.maxTargets);
    return {
      origin: { x: origin.x, y: origin.y, rotation: origin.rotation,
        spin: finite(origin.spin, DAREDEVIL_BATON.spin) },
      owner: {
        x: owner.x, y: owner.y, vx: finite(owner.vx), vy: finite(owner.vy),
        radius: finite(owner.radius, 15), movementLocked: owner.movementLocked === true
      },
      targets, arenaSize,
      attackHorizon: finite(input.attackHorizon, DAREDEVIL_BATON.attackHorizon),
      collectTrace: input.collectTrace === true
    };
  }

  function simulatePrepared(input, angle, preservePose = false) {
    const { arenaSize, attackHorizon } = input;
    let baton = clampBatonToArena({
      x: input.origin.x, y: input.origin.y,
      vx: Math.cos(angle) * DAREDEVIL_BATON.speed, vy: Math.sin(angle) * DAREDEVIL_BATON.speed,
      rotation: preservePose ? finite(input.origin.rotation, angle) : angle,
      spin: input.origin.spin
    }, arenaSize);
    const targets = input.targets.map((target) => ({ ...target }));
    const previousTargets = input.targets.map((target) => ({ ...target }));
    const fromTargets = input.targets.map((target) => ({ ...target }));
    const toTargets = input.targets.map((target) => ({ ...target }));
    let owner = { ...input.owner };
    const contacts = targets.map(() => false);
    const hitTargets = new Set();
    const hitTimes = input.collectTrace ? [] : null;
    let time = 0;
    let expectedHits = 0;
    let wallBounces = 0;
    let hitValue = 0;
    let closestApproach = Infinity;
    while (time < attackHorizon - EPSILON) {
      const frameDt = Math.min(1 / 60, attackHorizon - time);
      for (let index = 0; index < targets.length; index += 1) {
        previousTargets[index].x = targets[index].x; previousTargets[index].y = targets[index].y;
        advanceTargetFrame(targets[index], frameDt, arenaSize);
      }
      advanceTargetFrame(owner, frameDt, arenaSize);
      let remaining = frameDt;
      let elapsed = 0;
      let events = 0;
      while (remaining > EPSILON && events < 48) {
        events += 1;
        const step = Math.min(remaining, DAREDEVIL_BATON.step);
        const wall = getBatonWallContact(baton, step, arenaSize);
        const duration = wall ? Math.min(step, wall.time) : step;
        const end = integrateBatonMotion(baton, duration);
        for (let index = 0; index < targets.length; index += 1) {
          const previous = previousTargets[index];
          const target = targets[index];
          const from = elapsed / frameDt;
          const to = (elapsed + duration) / frameDt;
          fromTargets[index].x = previous.x + (target.x - previous.x) * from;
          fromTargets[index].y = previous.y + (target.y - previous.y) * from;
          toTargets[index].x = previous.x + (target.x - previous.x) * to;
          toTargets[index].y = previous.y + (target.y - previous.y) * to;
        }
        let first = null;
        for (let index = 0; index < targets.length; index += 1) {
          if (contacts[index] && !getBatonCircleContact(baton, fromTargets[index], DAREDEVIL_BATON.contactRelease)) {
            contacts[index] = false;
          }
          const distanceX = end.x - toTargets[index].x;
          const distanceY = end.y - toTargets[index].y;
          closestApproach = Math.min(closestApproach, distanceX * distanceX + distanceY * distanceY);
          if (contacts[index]) continue;
          const contact = getSweptBatonCircleContact(baton, end, toTargets[index], fromTargets[index]);
          if (contact && (!first || contact.progress < first.contact.progress)) first = { index, contact };
        }
        if (first) {
          const used = duration * first.contact.progress;
          baton = integrateBatonMotion(baton, used);
          time += used; elapsed += used; remaining -= used;
          contacts[first.index] = true;
          const target = targets[first.index];
          if (target.targetable) {
            expectedHits += 1; hitTargets.add(target.instanceId);
            hitValue += 100 * (1 - 0.18 * time / attackHorizon);
            if (hitTimes) hitTimes.push({ time, instanceId: target.instanceId });
          }
          if (target.physical) {
            const response = resolveBatonImpact(baton, target, first.contact,
              { targetLocked: target.movementLocked });
            if (!target.movementLocked) {
              target.vx = response.targetVx; target.vy = response.targetVy;
            }
            baton.vx = response.vx; baton.vy = response.vy; baton.spin = response.spin;
          }
          continue;
        }
        baton = clampBatonToArena(end, arenaSize);
        time += duration; elapsed += duration; remaining -= duration;
        if (wall) {
          const response = resolveBatonWallImpact(baton, wall, arenaSize);
          baton.vx = response.vx; baton.vy = response.vy; baton.spin = response.spin;
          baton = clampBatonToArena(baton, arenaSize);
          wallBounces += 1;
          if (duration < EPSILON) {
            const nudge = Math.min(remaining, 1e-5);
            baton = clampBatonToArena(integrateBatonMotion(baton, nudge), arenaSize);
            time += nudge; elapsed += nudge; remaining -= nudge;
          }
        }
      }
      if (remaining > EPSILON) {
        baton = clampBatonToArena(integrateBatonMotion(baton, remaining), arenaSize);
        time += remaining;
      }
    }
    const returnDistance = Math.hypot(baton.x - owner.x, baton.y - owner.y);
    const size = resolveArenaGeometry(arenaSize).size;
    const missPenalty = expectedHits ? 0 : Math.min(size, Math.sqrt(closestApproach)) / size * 6;
    const score = input.targets.some((target) => target.targetable)
      ? hitValue + hitTargets.size * 6 - returnDistance / size * 4 - wallBounces * 0.025 - missPenalty : 0;
    const result = {
      angle: normalizeAngle(angle), score, expectedHits, uniqueTargets: hitTargets.size,
      wallBounces, returnDistance, end: { x: baton.x, y: baton.y },
      ownerEnd: { x: owner.x, y: owner.y }
    };
    if (hitTimes) result.hitTimes = hitTimes;
    return result;
  }

  function simulateBatonThrow(input, angle) {
    return simulatePrepared(prepareInput(input), angle, true);
  }

  function candidateAngles(input) {
    const candidates = [];
    function add(angle) {
      angle = normalizeAngle(angle);
      if (!candidates.some((other) => Math.abs(Math.atan2(Math.sin(other - angle), Math.cos(other - angle))) < 0.002)) {
        candidates.push(angle);
      }
    }
    const origin = input.origin;
    for (const target of input.targets) {
      if (!target.targetable) continue;
      add(Math.atan2(target.y - origin.y, target.x - origin.x));
      let predicted = target;
      for (let iteration = 0; iteration < 4; iteration += 1) {
        const time = Math.min(input.attackHorizon,
          Math.hypot(predicted.x - origin.x, predicted.y - origin.y) / DAREDEVIL_BATON.speed);
        predicted = moveTarget(target, time, input.arenaSize);
      }
      add(Math.atan2(predicted.y - origin.y, predicted.x - origin.x));
      // Unfold single-wall bankshots, then refine each route in the same
      // physical rollout as direct throws. Mirrors propose routes only.
      const margin = DAREDEVIL_BATON.halfLength + DAREDEVIL_BATON.halfWidth;
      const arena = resolveArenaGeometry(input.arenaSize);
      for (const wall of ["left", "right", "top", "bottom"]) {
        if (arena.shape === "circle") {
          for (let i = 0; i < 4; i++) {
            const p = arena.boundaryPoint(wall, (i + 0.5) / 4, margin);
            add(Math.atan2(p.y - origin.y, p.x - origin.x));
          }
          continue;
        }
        let point = predicted;
        for (let iteration = 0; iteration < 3; iteration += 1) {
          const mirror = {
            x: wall === "left" ? (arena.left + margin) * 2 - point.x : wall === "right" ? (arena.right - margin) * 2 - point.x : point.x,
            y: wall === "top" ? (arena.top + margin) * 2 - point.y : wall === "bottom" ? (arena.bottom - margin) * 2 - point.y : point.y
          };
          const flight = Math.min(input.attackHorizon,
            Math.hypot(mirror.x - origin.x, mirror.y - origin.y) / DAREDEVIL_BATON.speed);
          point = moveTarget(target, flight, input.arenaSize);
          if (iteration === 2) add(Math.atan2(mirror.y - origin.y, mirror.x - origin.x));
        }
      }
    }
    for (let index = 0; index < 32; index += 1) add(index * TAU / 32);
    return candidates.slice(0, 72);
  }

  function planBatonThrow(input) {
    const prepared = prepareInput(input);
    if (!prepared.targets.some((target) => target.targetable)) return {
      angle: normalizeAngle(finite(prepared.origin.rotation)), score: 0,
      expectedHits: 0, uniqueTargets: 0, wallBounces: 0, returnDistance: 0, candidateCount: 0
    };
    const angles = candidateAngles(prepared);
    const results = angles.map((angle) => simulatePrepared(prepared, angle));
    results.sort((a, b) => b.score - a.score || a.angle - b.angle);
    // Refine the three strongest coarse routes, including bankshots that miss
    // a narrow rotating endpoint. This remains a bounded local search.
    const seeds = results.slice(0, 3);
    for (const seed of seeds) {
      for (const offset of [-1, 1, -0.5, 0.5, -0.25, 0.25, -0.125, 0.125]) {
        if (angles.length >= DAREDEVIL_BATON.maxCandidates) break;
        const angle = normalizeAngle(seed.angle + offset * TAU / 32);
        if (angles.some((other) => Math.abs(Math.atan2(Math.sin(other - angle), Math.cos(other - angle))) < 0.002)) continue;
        angles.push(angle); results.push(simulatePrepared(prepared, angle));
      }
    }
    results.sort((a, b) => b.score - a.score || a.angle - b.angle);
    return { ...results[0], candidateCount: angles.length };
  }

  return {
    DAREDEVIL_BATON, getBatonCircleContact, getSweptBatonCircleContact,
    reflectBatonVelocity, integrateBatonMotion, clampBatonToArena,
    getBatonWallContact, resolveBatonImpact, resolveBatonWallImpact,
    simulateBatonThrow, planBatonThrow
  };
});
