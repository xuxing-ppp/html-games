(function initializeMilitaryGrenade(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...require("../core/ball-registry.js"),
        ...require("./grenade.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createMilitaryGrenadePlugin({
  registerBall,
  createGrenadeDefinition,
  predictiveLandingPoint
}) {
  const MILITARY_BODY_COLOR = "#3f7f2e";
  const MILITARY_PALETTE = {
    shadowColor: "#8da96c",
    shell: "#142d0d",
    body: "#315f20",
    face: "#477d2c",
    grid: "rgba(10, 35, 5, 0.84)",
    accent: "#6d9e43",
    fuse: "#666d62",
    fuseDark: "#30362f",
    spark: "#e45a2b",
    bodyGrid: "rgba(11, 38, 5, 0.84)",
    bodyAccent: "#659842",
    bodyOutline: "#234d18",
    bodyGloss: "rgba(218, 240, 197, 0.34)",
    shadowFill: "rgba(7, 22, 4, 0.86)"
  };

  const militaryGrenadeDefinition = createGrenadeDefinition({
    id: "militaryGrenade",
    name: "战术手雷",
    englishName: "Military Grenade",
    color: MILITARY_BODY_COLOR,
    description: "2.5秒周期 / 预测落点 / 灰白粒子爆炸",
    blastDamage: 4,
    explosionMode: "particles",
    explosionKind: "military-grenade-explosion",
    entityKind: "military-grenade-thrown",
    knockbackIdPrefix: "military-grenade",
    landingDustKind: "military-grenade-landing-dust",
    landingDustColor: "#65705d",
    reloadPingKind: "military-grenade-reload-ping",
    reloadPingColor: "#a8cc76",
    palette: MILITARY_PALETTE,
    landingPointSelector(args) {
      return predictiveLandingPoint(args);
    }
  });

  registerBall(militaryGrenadeDefinition);
  return {
    militaryGrenadeDefinition,
    MILITARY_GRENADE_BODY_COLOR: MILITARY_BODY_COLOR,
    MILITARY_GRENADE_PALETTE: Object.freeze({ ...MILITARY_PALETTE })
  };
});
