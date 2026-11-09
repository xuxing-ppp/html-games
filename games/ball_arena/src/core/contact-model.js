(function initializeContactModel(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createContactModelApi() {
  "use strict";

  function firstSegmentCircleContact(startX, startY, endX, endY, centerX, centerY, radius) {
    const epsilon = 1e-9;
    const offsetX = startX - centerX;
    const offsetY = startY - centerY;
    const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
    if (c <= epsilon) return 0;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const a = deltaX * deltaX + deltaY * deltaY;
    if (a <= epsilon) return null;
    const b = 2 * (offsetX * deltaX + offsetY * deltaY);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    const first = (-b - root) / (2 * a);
    const second = (-b + root) / (2 * a);
    if (first >= -epsilon && first <= 1 + epsilon) return Math.max(0, Math.min(1, first));
    if (second >= -epsilon && second <= 1 + epsilon) return Math.max(0, Math.min(1, second));
    return null;
  }

  function normalizeProfile(profile = {}, defaults = {}) {
    return {
      physical: profile.physical === undefined
        ? defaults.physical !== false
        : profile.physical !== false,
      targetable: profile.targetable === undefined
        ? defaults.targetable !== false
        : profile.targetable !== false
    };
  }

  function mergeContactProfiles(base = {}, overlays = []) {
    const merged = normalizeProfile(base);
    for (const overlay of overlays) {
      if (!overlay) continue;
      const normalized = normalizeProfile(overlay);
      if (overlay.physical !== undefined) merged.physical = normalized.physical;
      if (overlay.targetable !== undefined) merged.targetable = normalized.targetable;
    }
    return Object.freeze(merged);
  }

  function createContactEvent({
    actor,
    target,
    overlapping = false,
    normalX = 0,
    normalY = 0,
    penetration = 0,
    distance = 0,
    kind = "body"
  } = {}) {
    if (!actor || !target) throw new TypeError("Contact event requires actor and target");
    if (typeof overlapping !== "boolean" ||
        ![normalX, normalY, penetration, distance].every(Number.isFinite)) {
      throw new TypeError("Contact event geometry must be finite");
    }
    if (typeof kind !== "string" || !kind) {
      throw new TypeError("Contact event requires a kind");
    }
    return Object.freeze({
      actor,
      target,
      actorHp: actor.hp,
      overlapping: Boolean(overlapping),
      normalX,
      normalY,
      penetration: Math.max(0, penetration),
      distance: Math.max(0, distance),
      kind
    });
  }

  return { mergeContactProfiles, createContactEvent, firstSegmentCircleContact };
});
