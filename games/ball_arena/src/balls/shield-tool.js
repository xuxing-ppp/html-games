(function initializeShieldTool(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...Object.assign({}, require("../core/ball-registry.js"), require("../core/knockback.js")), ...require("../core/contact-model.js") }
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports ? require("../core/arena-geometry.js") : root.BallBattle));

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createShieldToolPlugin({ resolveArenaGeometry, registerBall, createKnockbackEffect: createSharedKnockback, firstSegmentCircleContact }) {
  const DEFENSE_DURATION = 1.5;
  const ATTACK_DURATION = 10.5;
  const SHIELD_SPEED = 350;
  const SHIELD_SPIN_PER_SECOND = 4;
  const SHIELD_RADIUS = 15;
  const BODY_HIT_DAMAGE = 2;
  const SHIELD_HIT_DAMAGE = 5;
  const KNOCKBACK_DURATION = 0.1;
  const KNOCKBACK_SPEED_FACTOR = 5;
  const STUN_DURATION = 0.4;
  const STUN_SPEED_FACTOR = 0.4;
  const RETRACT_DURATION = 0.3;
  const LARGE_ENTITY_SIZE = 40;
  const BODY_COLOR = "#3e4650";
  const SHIELD_STEEL_BASE = "#454d55";
  const SHIELD_STEEL_LIGHT = "#5b646d";
  const SHIELD_STEEL_DARK = "#343a41";
  const SHIELD_STEEL_RIVET = "#c2cad1";
  const SHIELD_STEEL_STAR = "#9aa3ac";
  const SHIELD_RIM = "#1f2327";
  const SARDINE_SHATTER_COLOR = "#8f1730";
  const EPSILON = 1e-9;
  const FAR_FUTURE = 1e9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let directionX = x;
    let directionY = y;
    if (Math.hypot(directionX, directionY) <= EPSILON) {
      directionX = fallbackX;
      directionY = fallbackY;
    }
    const magnitude = Math.hypot(directionX, directionY) || 1;
    return { x: directionX / magnitude, y: directionY / magnitude };
  }

  function closestPointOnSegment(x, y, start, end) {
    const lineX = end.x - start.x;
    const lineY = end.y - start.y;
    const lengthSquared = lineX * lineX + lineY * lineY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((x - start.x) * lineX + (y - start.y) * lineY) / lengthSquared,
        0,
        1
      );
    return {
      x: start.x + lineX * progress,
      y: start.y + lineY * progress
    };
  }

  function shakeOffset(time) {
    return {
      x: Math.sin(time * 97) * 1.4,
      y: Math.cos(time * 83) * 1.4
    };
  }

  function pointInsidePolygon(x, y, vertices) {
    let inside = false;
    for (let index = 0, previous = vertices.length - 1;
      index < vertices.length;
      previous = index, index += 1) {
      const currentPoint = vertices[index];
      const previousPoint = vertices[previous];
      const crosses = (currentPoint.y > y) !== (previousPoint.y > y) &&
        x < (previousPoint.x - currentPoint.x) * (y - currentPoint.y) /
          (previousPoint.y - currentPoint.y || EPSILON) + currentPoint.x;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function entitySize(entity) {
    if (Number.isFinite(entity.radius)) return entity.radius;
    if (Array.isArray(entity.vertices) && entity.vertices.length > 0) {
      const xs = entity.vertices.map((vertex) => vertex.x);
      const ys = entity.vertices.map((vertex) => vertex.y);
      return Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys)
      );
    }
    if (Number.isFinite(entity.length) && Number.isFinite(entity.width)) {
      return Math.max(entity.length, entity.width);
    }
    if (Number.isFinite(entity.width) && Number.isFinite(entity.height)) {
      return Math.max(entity.width, entity.height);
    }
    if (Number.isFinite(entity.width)) return entity.width;
    return 0;
  }

  function segmentContact(x, y, radius, start, end, width = 0) {
    const closest = closestPointOnSegment(x, y, start, end);
    const distance = Math.hypot(x - closest.x, y - closest.y);
    const contactRadius = radius + Math.max(0, width) / 2;
    if (distance > contactRadius + EPSILON) return null;
    const lineX = end.x - start.x;
    const lineY = end.y - start.y;
    const normal = normalizeDirection(
      x - closest.x,
      y - closest.y,
      -lineY,
      lineX
    );
    return {
      x: closest.x,
      y: closest.y,
      normalX: normal.x,
      normalY: normal.y,
      penetration: Math.max(0, contactRadius - distance)
    };
  }

  function circleContact(x, y, radius, centerX, centerY, entityRadius) {
    const deltaX = x - centerX;
    const deltaY = y - centerY;
    const distance = Math.hypot(deltaX, deltaY);
    const contactRadius = radius + entityRadius;
    if (distance > contactRadius + EPSILON) return null;
    const normal = normalizeDirection(deltaX, deltaY, -1, 0);
    return {
      x: centerX + normal.x * entityRadius,
      y: centerY + normal.y * entityRadius,
      normalX: normal.x,
      normalY: normal.y,
      penetration: Math.max(0, contactRadius - distance)
    };
  }

  function rectangleContact(x, y, radius, rectangle) {
    const cosine = Math.cos(rectangle.angle || 0);
    const sine = Math.sin(rectangle.angle || 0);
    const offsetX = x - rectangle.x;
    const offsetY = y - rectangle.y;
    const localX = offsetX * cosine + offsetY * sine;
    const localY = -offsetX * sine + offsetY * cosine;
    let contactX = clamp(localX, -rectangle.halfLength, rectangle.halfLength);
    let contactY = clamp(localY, -rectangle.halfWidth, rectangle.halfWidth);
    const inside = Math.abs(localX) <= rectangle.halfLength + EPSILON &&
      Math.abs(localY) <= rectangle.halfWidth + EPSILON;
    let normalLocalX;
    let normalLocalY;
    let distance;
    let penetration;
    if (inside) {
      const distanceX = rectangle.halfLength - Math.abs(localX);
      const distanceY = rectangle.halfWidth - Math.abs(localY);
      if (distanceX <= distanceY) {
        normalLocalX = localX < 0 ? -1 : 1;
        normalLocalY = 0;
        contactX = normalLocalX * rectangle.halfLength;
        contactY = localY;
        distance = distanceX;
      } else {
        normalLocalX = 0;
        normalLocalY = localY < 0 ? -1 : 1;
        contactX = localX;
        contactY = normalLocalY * rectangle.halfWidth;
        distance = distanceY;
      }
      penetration = radius + distance;
    } else {
      const deltaX = localX - contactX;
      const deltaY = localY - contactY;
      distance = Math.hypot(deltaX, deltaY);
      if (distance > radius + EPSILON) return null;
      const normal = normalizeDirection(deltaX, deltaY, -1, 0);
      normalLocalX = normal.x;
      normalLocalY = normal.y;
      penetration = Math.max(0, radius - distance);
    }
    return {
      x: rectangle.x + contactX * cosine - contactY * sine,
      y: rectangle.y + contactX * sine + contactY * cosine,
      normalX: normalLocalX * cosine - normalLocalY * sine,
      normalY: normalLocalX * sine + normalLocalY * cosine,
      penetration
    };
  }

  function polygonContact(x, y, radius, vertices) {
    let closest = null;
    let closestDistance = Infinity;
    let closestIndex = 0;
    vertices.forEach((start, index) => {
      const end = vertices[(index + 1) % vertices.length];
      const point = closestPointOnSegment(x, y, start, end);
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance >= closestDistance) return;
      closest = point;
      closestDistance = distance;
      closestIndex = index;
    });
    const inside = pointInsidePolygon(x, y, vertices);
    if (!inside && closestDistance > radius + EPSILON) return null;
    const start = vertices[closestIndex];
    const end = vertices[(closestIndex + 1) % vertices.length];
    const signedArea = vertices.reduce((sum, vertex, index) => {
      const next = vertices[(index + 1) % vertices.length];
      return sum + vertex.x * next.y - next.x * vertex.y;
    }, 0);
    const outwardX = signedArea >= 0 ? end.y - start.y : start.y - end.y;
    const outwardY = signedArea >= 0 ? start.x - end.x : end.x - start.x;
    const normal = inside
      ? normalizeDirection(outwardX, outwardY, -1, 0)
      : normalizeDirection(x - closest.x, y - closest.y, outwardX, outwardY);
    return {
      x: closest.x,
      y: closest.y,
      normalX: normal.x,
      normalY: normal.y,
      penetration: inside ? radius + closestDistance : Math.max(0, radius - closestDistance)
    };
  }

  function hikariTrainContact(entity, x, y, radius) {
    if (entity.kind !== "hikari-rail-train" || entity.phase !== "train") return null;
    const startDistance = Math.max(0, entity.trainDistance - 800);
    const endDistance = Math.min(entity.length, entity.trainDistance);
    if (endDistance <= startDistance + EPSILON) return null;
    return segmentContact(
      x,
      y,
      radius,
      {
        x: entity.startX + entity.directionX * startDistance,
        y: entity.startY + entity.directionY * startDistance
      },
      {
        x: entity.startX + entity.directionX * endDistance,
        y: entity.startY + entity.directionY * endDistance
      },
      (entity.owner && entity.owner.radius ? entity.owner.radius : 15) * 2
    );
  }

  function entityContactAt(entity, x, y, radius) {
    const trainContact = hikariTrainContact(entity, x, y, radius);
    if (trainContact || entity.kind === "hikari-rail-train") return trainContact;
    if (Array.isArray(entity.shieldBreakPoints)) {
      const breakRadius = Number.isFinite(entity.shieldBreakRadius)
        ? Math.max(0, entity.shieldBreakRadius)
        : 0;
      for (let index = 0; index < entity.shieldBreakPoints.length; index += 1) {
        const point = entity.shieldBreakPoints[index];
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        const contact = circleContact(x, y, radius, point.x, point.y, breakRadius);
        if (contact) {
          contact.shieldBreakPoint = point;
          contact.shieldBreakPointIndex = index;
          return contact;
        }
      }
      return null;
    }
    if (Array.isArray(entity.vertices) && entity.vertices.length >= 3) {
      return polygonContact(x, y, radius, entity.vertices);
    }
    if (entity.start && entity.end) {
      return segmentContact(x, y, radius, entity.start, entity.end, entity.width || 0);
    }
    if (
      Number.isFinite(entity.startX) && Number.isFinite(entity.startY) &&
      Number.isFinite(entity.endX) && Number.isFinite(entity.endY)
    ) {
      return segmentContact(
        x,
        y,
        radius,
        { x: entity.startX, y: entity.startY },
        { x: entity.endX, y: entity.endY },
        entity.width || 0
      );
    }
    if (
      Number.isFinite(entity.anchorX) && Number.isFinite(entity.anchorY) &&
      Number.isFinite(entity.inwardX) && Number.isFinite(entity.inwardY) &&
      Number.isFinite(entity.extension) && Number.isFinite(entity.width)
    ) {
      return rectangleContact(x, y, radius, {
        x: entity.anchorX + entity.inwardX * entity.extension / 2,
        y: entity.anchorY + entity.inwardY * entity.extension / 2,
        halfLength: entity.extension / 2,
        halfWidth: entity.width / 2,
        angle: Math.atan2(entity.inwardY, entity.inwardX)
      });
    }
    if (
      Number.isFinite(entity.x) && Number.isFinite(entity.y) &&
      Number.isFinite(entity.normalX) && Number.isFinite(entity.normalY) &&
      Number.isFinite(entity.width) && Number.isFinite(entity.height)
    ) {
      return rectangleContact(x, y, radius, {
        x: entity.x + entity.normalX * entity.height / 2,
        y: entity.y + entity.normalY * entity.height / 2,
        halfLength: entity.height / 2,
        halfWidth: entity.width / 2,
        angle: Math.atan2(entity.normalY, entity.normalX)
      });
    }
    if (
      Number.isFinite(entity.x) && Number.isFinite(entity.y) &&
      Number.isFinite(entity.length) && Number.isFinite(entity.width)
    ) {
      return rectangleContact(x, y, radius, {
        x: entity.x,
        y: entity.y,
        halfLength: entity.length / 2,
        halfWidth: entity.width / 2,
        angle: entity.angle || 0
      });
    }
    if (
      Number.isFinite(entity.x) && Number.isFinite(entity.y) &&
      Number.isFinite(entity.width) && Number.isFinite(entity.height)
    ) {
      return rectangleContact(x, y, radius, {
        x: entity.x,
        y: entity.y,
        halfLength: entity.width / 2,
        halfWidth: entity.height / 2,
        angle: entity.angle || 0
      });
    }
    if (Number.isFinite(entity.x) && Number.isFinite(entity.y)) {
      return circleContact(x, y, radius, entity.x, entity.y, entity.radius || 0);
    }
    return null;
  }

  function entityContact(entity, shield) {
    const contact = entityContactAt(entity, shield.x, shield.y, shield.radius);
    if (contact) return contact;
    if (!Number.isFinite(shield.previousX) || !Number.isFinite(shield.previousY)) {
      return null;
    }
    return entityContactAt(
      entity,
      shield.previousX,
      shield.previousY,
      shield.radius
    );
  }

  function oversizedEntity(entity) {
    if (
      entity.kind === "da-yun-v2-truck" ||
      entity.kind === "hikari-rail-train" ||
      entity.kind === "hanako-pillar" ||
      entity.kind === "round-shield" ||
      // 老木师的木板是钉死在墙上的实心板：飞盾和钢卷都得改向弹开，
      // 而不是把它当弱质道具直接碾掉（木板自己按 3 次撞击结算破损）。
      entity.kind === "old-wood-master-plank" ||
      /^billiards-.+-table$/.test(entity.kind || "")
    ) return true;
    if (entity.combatKind === "summon" && entity.solid === true) return true;
    return entity.solid === true && entitySize(entity) > LARGE_ENTITY_SIZE;
  }

  function reflectShieldFromEntity(shield, entity, normalX, normalY) {
    const entityVx = Number.isFinite(entity.vx) ? entity.vx : 0;
    const entityVy = Number.isFinite(entity.vy) ? entity.vy : 0;
    const relativeNormal =
      (shield.vx - entityVx) * normalX +
      (shield.vy - entityVy) * normalY;
    if (relativeNormal >= -EPSILON) return false;
    const direction = normalizeDirection(
      shield.vx - 2 * relativeNormal * normalX,
      shield.vy - 2 * relativeNormal * normalY,
      normalX,
      normalY
    );
    shield.vx = direction.x * SHIELD_SPEED;
    shield.vy = direction.y * SHIELD_SPEED;
    return true;
  }

  function shatterSardines(shield, school, entityServices) {
    if (school.kind !== "ocean-sardine-school" || !Array.isArray(school.fish)) {
      return false;
    }
    const survivors = [];
    for (const fish of school.fish) {
      const contact = entityContact(fish, shield);
      if (!contact) {
        survivors.push(fish);
        continue;
      }
      entityServices.spawnVisualEffect(createChipBurst(
        contact.x,
        contact.y,
        SARDINE_SHATTER_COLOR,
        8
      ));
    }
    school.fish = survivors;
    if (survivors.length === 0) {
      school.life = 0;
      school.entityActive = false;
    }
    return true;
  }

  function resolveEntityContacts(shield, game, entityServices) {
    const current = new Set();
    for (const entity of game.combatEntities) {
      if (!entity || entity === shield || entity.isProjectile) continue;
      if (!entity.entityActive || entity.life <= 0) continue;
      if (entity.teamId === shield.teamId) continue;
      // 持械等与本体绑定的装备不是可碾碎的第三方道具。
      if (entity.attachedToOwner === true) continue;
      if (shatterSardines(shield, entity, entityServices)) continue;
      const contact = entityContact(entity, shield);
      if (!contact) continue;

      if (oversizedEntity(entity) || entity.roundShieldResponse === "reflect") {
        const key = entity.instanceId || entity.kind;
        current.add(key);
        if (contact.penetration > 0) {
          Object.assign(shield, resolveArenaGeometry(game).clampPoint(shield.x + contact.normalX * contact.penetration, shield.y + contact.normalY * contact.penetration, shield.radius));
        }
        if (!shield.entityContacts.has(key)) {
          const incoming = normalizeDirection(shield.vx, shield.vy, 1, 0);
          const reflected = reflectShieldFromEntity(
            shield,
            entity,
            contact.normalX,
            contact.normalY
          );
          if (reflected && typeof entity.onShieldDeflected === "function") {
            entity.onShieldDeflected({
              entity,
              shield,
              contact,
              game,
              directionX: incoming.x,
              directionY: incoming.y
            });
          }
        }
        continue;
      }

      const colour = entity.color ||
        (entity.owner && entity.owner.color) ||
        "#ffffff";
      if (typeof entity.onShieldDestroyed === "function") {
        entity.onShieldDestroyed(entity, contact);
      }
      entity.life = 0;
      entity.entityActive = false;
      entityServices.spawnVisualEffect(createChipBurst(
        contact.x,
        contact.y,
        colour,
        12
      ));
    }
    shield.entityContacts = current;
  }

  function absorbProjectiles(shield, game, entityServices) {
    for (const entity of game.combatEntities) {
      if (!entity || !entity.isProjectile) continue;
      if (!entity.entityActive || entity.life <= 0) continue;
      if (entity.teamId === shield.teamId) continue;
      // Bullets without a world position or radius (e.g. Gojo's red, Kuroko's
      // shots) must not be treated as touching: NaN comparisons would destroy
      // them the moment they spawn. Use the engine's default bullet radius.
      if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue;
      const radius = Number.isFinite(entity.radius) ? entity.radius : 3;
      const previous = {
        x: Number.isFinite(entity.previousX) ? entity.previousX : entity.x,
        y: Number.isFinite(entity.previousY) ? entity.previousY : entity.y
      };
      const closest = closestPointOnSegment(
        shield.x,
        shield.y,
        previous,
        entity
      );
      const distance = Math.hypot(closest.x - shield.x, closest.y - shield.y);
      if (distance > radius + shield.radius) continue;
      const colour = entity.color ||
        (entity.owner && entity.owner.color) ||
        "#ffffff";
      entity.life = 0;
      entity.entityActive = false;
      entityServices.spawnVisualEffect(createChipBurst(
        closest.x,
        closest.y,
        colour,
        8
      ));
    }
  }

  function reflectShieldFromTarget(target, shield, normalX, normalY) {
    const relativeNormal =
      (shield.vx - target.vx) * normalX +
      (shield.vy - target.vy) * normalY;
    if (relativeNormal <= EPSILON) return false;
    const reflectedX = shield.vx - 2 * relativeNormal * normalX;
    const reflectedY = shield.vy - 2 * relativeNormal * normalY;
    // Reflect relative to the enemy keeps the direction but can change the
    // magnitude (a fast-moving enemy makes the shield faster). Renormalize
    // to the fixed flight speed so the shield never accelerates.
    const direction = normalizeDirection(
      reflectedX,
      reflectedY,
      -shield.vx,
      -shield.vy
    );
    shield.vx = direction.x * SHIELD_SPEED;
    shield.vy = direction.y * SHIELD_SPEED;
    return true;
  }

  function updateShieldContacts(shield, entityServices, arenaSize) {
    const current = new Set();
    const prevX = Number.isFinite(shield.previousX) ? shield.previousX : shield.x;
    const prevY = Number.isFinite(shield.previousY) ? shield.previousY : shield.y;
    entityServices.forEachEnemy((target) => {
      const profile = entityServices.getContactProfile(target);
      if (!profile.solid) return;
      // Swept contact: the shield's motion segment this frame against the
      // enemy circle. This catches the frame where a fast shield overtakes
      // its target and would otherwise read a reversed normal.
      const closest = closestPointOnSegment(
        target.x,
        target.y,
        { x: prevX, y: prevY },
        { x: shield.x, y: shield.y }
      );
      const minimumDistance = target.radius + shield.radius;
      if (Math.hypot(target.x - closest.x, target.y - closest.y) >= minimumDistance) {
        return;
      }
      // Hit normal from the enemy centre to the contact point; when the
      // centres line up exactly, fall back to the shield's own heading so
      // the enemy is knocked along the shield's travel direction.
      const fallback = normalizeDirection(shield.vx, shield.vy, 1, 0);
      const normal = normalizeDirection(
        target.x - closest.x,
        target.y - closest.y,
        fallback.x,
        fallback.y
      );
      const normalX = normal.x;
      const normalY = normal.y;
      // Separate only the pairs that still overlap at frame end.
      const currentDistance = Math.hypot(target.x - shield.x, target.y - shield.y);
      const targetLocked = entityServices.isMovementLocked(target);
      if (currentDistance < minimumDistance && currentDistance > EPSILON) {
        const pushX = (target.x - shield.x) / currentDistance;
        const pushY = (target.y - shield.y) / currentDistance;
        const overlap = minimumDistance - currentDistance;
        if (!targetLocked) {
          Object.assign(target, resolveArenaGeometry(arenaSize).clampPoint(target.x + pushX * overlap * 0.5, target.y + pushY * overlap * 0.5, target.radius));
        }
        Object.assign(shield, resolveArenaGeometry(arenaSize).clampPoint(shield.x - pushX * overlap * 0.5, shield.y - pushY * overlap * 0.5, shield.radius));
      }
      const key = target.instanceId || target.id;
      const isNewContact = !shield.contacts.has(key);
      current.add(key);
      // Only the first contact of an entry reflects both bodies and deals the
      // hit; sustained overlap is separated by pushing alone so a reflected
      // shield resting against the enemy cannot re-bounce it every frame.
      if (!isNewContact) return;
      reflectShieldFromTarget(target, shield, normalX, normalY);
      if (!targetLocked) {
        const velocityDot = target.vx * normalX + target.vy * normalY;
        if (velocityDot < 0) {
          target.vx -= 2 * velocityDot * normalX;
          target.vy -= 2 * velocityDot * normalY;
        }
        const storedDot = target.storedVx * normalX + target.storedVy * normalY;
        if (storedDot < 0) {
          target.storedVx -= 2 * storedDot * normalX;
          target.storedVy -= 2 * storedDot * normalY;
        }
      }
      if (!profile.attackable) return;
      if (!entityServices.dealDamage(target, SHIELD_HIT_DAMAGE, {
        collisionDamage: true
      })) return;
      const direction = normalizeDirection(
        target.vx,
        target.vy,
        normalX,
        normalY
      );
      entityServices.applyEffect(target, createShieldHitEffect(
        direction.x,
        direction.y
      ));
      entityServices.spawnVisualEffect(createChipBurst(
        target.x,
        target.y,
        SHIELD_STEEL_LIGHT,
        10
      ));
      entityServices.spawnVisualEffect(createChipBurst(
        target.x,
        target.y,
        SHIELD_STEEL_DARK,
        10
      ));
    });
    shield.contacts = current;
  }

  function createShieldHitEffect(directionX, directionY) {
    return createSharedKnockback({
      id: "round-shield-hit",
      duration: KNOCKBACK_DURATION + STUN_DURATION,
      impulseDuration: KNOCKBACK_DURATION,
      directionX,
      directionY,
      speedMultiplier: KNOCKBACK_SPEED_FACTOR,
      settleSpeedMultiplier: STUN_SPEED_FACTOR,
      restorePreviousSpeed: true,
      preventsAttack: true,
      phase: "knockback",
      visualType: null,
      onApply({ effect, game }) {
        effect.knockbackEndsAt = game.time + KNOCKBACK_DURATION;
      },
      update({ effect, game }) {
        effect.phase = game.time + EPSILON < effect.knockbackEndsAt ? "knockback" : "stun";
        effect.visualType = effect.phase === "stun" ? "stun" : null;
      },
      drawBefore({ ball, effect, game }, context) {
        if (effect.phase !== "stun") return;
        const offset = shakeOffset(game.time);
        effect.renderOffsetX = offset.x;
        effect.renderOffsetY = offset.y;
        context.translate(offset.x, offset.y);
      },
      draw({ ball, effect }, context) {
        context.save();
        context.translate(-(effect.renderOffsetX || 0), -(effect.renderOffsetY || 0));
        context.strokeStyle = "rgba(46, 95, 196, 0.8)";
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(ball.x, ball.y, ball.radius + 3, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    });
  }
  // Shatter burst tinted with the destroyed object's colour: an expanding
  // ring plus drifting chips, same language as the Armor shell burst.
  function createChipBurst(x, y, colour, count) {
    const particles = Array.from({ length: count }, (_, index) => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 4 + Math.random() * 20;
      return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        size: 2 + index % 4
      };
    });
    return {
      kind: "round-shield-burst",
      life: 0.5,
      x,
      y,
      color: colour,
      particles,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= 1 - progress;
        context.strokeStyle = effect.color;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(effect.x, effect.y, 6 + progress * 22, 0, Math.PI * 2);
        context.stroke();
        effect.particles.forEach((particle) => {
          const spread = 0.4 + progress * 0.9;
          context.fillStyle = effect.color;
          context.fillRect(
            Math.round(effect.x + particle.x * spread - particle.size / 2),
            Math.round(
              effect.y + particle.y * spread - particle.size / 2 - progress * 6
            ),
            particle.size,
            particle.size
          );
        });
        context.restore();
      }
    };
  }

  function drawShieldStar(context, radius) {
    const outerRadius = radius * 0.9;
    const innerRadius = radius * 0.38;
    context.beginPath();
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      const pointRadius = index % 2 === 0 ? outerRadius : innerRadius;
      const pointX = Math.cos(angle) * pointRadius;
      const pointY = Math.sin(angle) * pointRadius;
      if (index === 0) context.moveTo(pointX, pointY);
      else context.lineTo(pointX, pointY);
    }
    context.closePath();
    context.fillStyle = SHIELD_STEEL_STAR;
    context.fill();
  }

  // US Agent's unpainted homemade shield: riveted steel panels, a welded
  // seam, a central bolt boss and a stamped unpainted star. `spin` rotates
  // the whole plate while flying; `scale` animates the retract.
  function drawShieldDisc(context, x, y, radius, spin, scale = 1) {
    const r = Math.max(0.5, radius * scale);
    context.save();
    context.translate(x, y);
    context.rotate(spin);

    context.beginPath();
    context.fillStyle = SHIELD_STEEL_BASE;
    context.arc(0, 0, r, 0, Math.PI * 2);
    context.closePath();
    context.fill();

    // Lighter top plate, welded onto the dark base along the horizontal seam.
    context.beginPath();
    context.fillStyle = SHIELD_STEEL_LIGHT;
    context.arc(0, 0, r * 0.84, Math.PI, Math.PI * 2);
    context.closePath();
    context.fill();

    context.strokeStyle = SHIELD_STEEL_DARK;
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(-r * 0.84, 0);
    context.lineTo(r * 0.84, 0);
    context.stroke();

    // Central bolt boss with the stamped star.
    context.beginPath();
    context.fillStyle = SHIELD_STEEL_DARK;
    context.arc(0, 0, r * 0.42, 0, Math.PI * 2);
    context.closePath();
    context.fill();
    drawShieldStar(context, r * 0.24);

    // Rivet ring around the rim.
    context.fillStyle = SHIELD_STEEL_RIVET;
    for (let index = 0; index < 8; index += 1) {
      const angle = -Math.PI / 2 + index * Math.PI / 4;
      const rivetX = Math.cos(angle) * r * 0.86;
      const rivetY = Math.sin(angle) * r * 0.86;
      context.beginPath();
      context.arc(rivetX, rivetY, Math.max(0.6, r * 0.05), 0, Math.PI * 2);
      context.fill();
    }

    context.strokeStyle = SHIELD_RIM;
    context.lineWidth = 0.9;
    context.beginPath();
    context.arc(0, 0, r, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  function moveShield(effect, elapsed, arenaSize) {
    effect.previousX = effect.x; effect.previousY = effect.y;
    const arena = resolveArenaGeometry(arenaSize);
    const endX = effect.x + effect.vx * elapsed, endY = effect.y + effect.vy * elapsed;
    const hit = arena.traceSegment(effect.x, effect.y, endX, endY, SHIELD_RADIUS);
    effect.x = hit ? hit.x : endX; effect.y = hit ? hit.y : endY;
    if (hit) {
      if (arena.shape !== "circle" && hit.normalX && hit.normalY) { effect.vx *= -1; effect.vy *= -1; }
      else {
        const dot = effect.vx * hit.normalX + effect.vy * hit.normalY;
        effect.vx -= 2 * dot * hit.normalX; effect.vy -= 2 * dot * hit.normalY;
      }
    }
  }

  function beginRetract(effect) {
    effect.phase = "retract";
    effect.retractElapsed = 0;
    effect.retractStartX = effect.x;
    effect.retractStartY = effect.y;
    effect.vx = 0;
    effect.vy = 0;
    effect.contacts.clear();
    effect.entityContacts.clear();
  }

  function createShieldEntity(services, source, target) {
    const direction = normalizeDirection(
      target.x - source.x,
      target.y - source.y
    );
    return {
      kind: "round-shield",
      combatKind: "summon",
      lifecycle: "owner-bound",
      borrowedAttackClock: true,
      life: FAR_FUTURE,
      solid: true,
      radius: SHIELD_RADIUS,
      x: source.x,
      y: source.y,
      vx: direction.x * SHIELD_SPEED,
      vy: direction.y * SHIELD_SPEED,
      phase: "attack",
      attackElapsed: 0,
      retractElapsed: 0,
      contacts: new Set(),
      entityContacts: new Set(),
      update({ effect, game, services: entityServices }, dt) {
        const elapsed = Math.max(0, dt);
        if (effect.phase === "attack") {
          moveShield(effect, elapsed, game);
          updateShieldContacts(effect, entityServices, game);
          if (!services.borrowedAttackOnly) {
            absorbProjectiles(effect, game, entityServices);
            resolveEntityContacts(effect, game, entityServices);
          }
          effect.attackElapsed += elapsed;
          if (effect.attackElapsed + EPSILON >= ATTACK_DURATION) {
            effect.phase = "detached";
            effect.contacts.clear();
            effect.entityContacts.clear();
          }
          return;
        }
        if (effect.phase === "detached") {
          const owner = effect.owner;
          const direction = normalizeDirection(
            owner.x - effect.x,
            owner.y - effect.y,
            effect.vx,
            effect.vy
          );
          effect.vx = direction.x * SHIELD_SPEED;
          effect.vy = direction.y * SHIELD_SPEED;
          const startX = effect.x;
          const startY = effect.y;
          moveShield(effect, elapsed, game);
          const contact = firstSegmentCircleContact(
            startX,
            startY,
            effect.x,
            effect.y,
            owner.x,
            owner.y,
            owner.radius + effect.radius
          );
          if (contact !== null) {
            effect.x = startX + (effect.x - startX) * contact;
            effect.y = startY + (effect.y - startY) * contact;
            beginRetract(effect);
          }
          return;
        }
        effect.retractElapsed = Math.min(
          RETRACT_DURATION,
          effect.retractElapsed + elapsed
        );
        const progress = clamp(effect.retractElapsed / RETRACT_DURATION, 0, 1);
        const eased = progress * progress * (3 - 2 * progress);
        effect.x = effect.retractStartX +
          (effect.owner.x - effect.retractStartX) * eased;
        effect.y = effect.retractStartY +
          (effect.owner.y - effect.retractStartY) * eased;
        if (effect.retractElapsed + EPSILON >= RETRACT_DURATION) {
          effect.x = effect.owner.x;
          effect.y = effect.owner.y;
          effect.life = 0;
          effect.entityActive = false;
        }
      },
      draw({ effect, game }, context) {
        const spin = (services.borrowedAttackOnly ? services.getAttackTime() : game.time) * SHIELD_SPIN_PER_SECOND * Math.PI * 2;
        const retractProgress = clamp(
          effect.retractElapsed / RETRACT_DURATION,
          0,
          1
        );
        const scale = effect.phase === "retract"
          ? 1 - Math.sin(retractProgress * Math.PI) * 0.18
          : 1;
        drawShieldDisc(context, effect.x, effect.y, effect.radius, spin, scale);
      }
    };
  }


  return {
    createChipBurst,
    // Shared geometry/policy helpers for impact mechanics that use the same
    // weak-prop versus oversized-entity contract as the flying shield.
    getShieldEntityContact: entityContactAt,
    isShieldOversizedEntity: oversizedEntity
  };
});
