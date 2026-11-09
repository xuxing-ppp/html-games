(function initializeDaYun(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createDaYunPlugin({ registerBall }) {
  const CONTACT_DAMAGE = 6;

  const daYunDefinition = {
    id: "daYun",
    name: "大运",
    englishName: "Da Yun",
    color: "#808080",
    description: "普攻型 / 撞击 -6HP",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior() {
      return {
        onCollision(context, target) {
          if (!context.blockedAtContact) {
            context.services.dealDamage(target, CONTACT_DAMAGE);
          }
        }
      };
    }
  };

  registerBall(daYunDefinition);
  return { daYunDefinition, daYunContactDamage: CONTACT_DAMAGE };
});
