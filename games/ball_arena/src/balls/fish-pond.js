(function initializeFishPond(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign(
      {},
      require("../core/ball-registry.js"),
      require("../core/arena-geometry.js"),
      require("./fish-hook.js")
    )
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createFishPondPlugin({
  registerBall,
  resolveArenaGeometry,
  getArenaWallContacts,
  createFishHookEntity,
  FISH_HOOK_SPEED
}) {
  // 鱼塘：本体是游戏默认纯色球（颜色取自需求给的那张图，暗橄榄绿）。
  // 规则按需求固定：
  //   1. 碰到战场**任意一边**都在接触点下钩，方向垂直于那条边指向场内
  //      （顶边向下、底边向上、左右边横向），一直放到对面边缘；
  //   2. 下降速度 20，数量不限（顶边每碰一次放一根，前面没收回来的不影响）；
  //   3. 钩到人立刻收线（原版鱼钩的 250）把鱼拖回顶部；什么都没钩到就一直放到
  //      碰到**底部**边缘，然后**停在那里不动** —— 没有「空钩回收」这个过程，
  //      后面谁撞上来就钩谁、钩到才收线；
  //   4. 伤害和角色「鱼钩」完全一样：收线路上每 30 距离 -2。
  //      这一整根钩子实体就是 fish-hook.js 里的 createHookEntity，
  //      这里只换了抛法：竖直、慢降、碰底转收线、不定住本体。
  const POND_COLOR = "#576145";
  // 钩子慢速档：下沉放线用它，什么都没钩到时沿原路回收也用它。
  // （钩到鱼的回收是另一档：原版鱼钩的 250，见 FISH_HOOK_SPEED。）
  const HOOK_DROP_SPEED = 20;
  const HOOK_KIND = "fish-pond-hook";

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  const fishPondDefinition = {
    id: "fishPond",
    name: "鱼塘",
    englishName: "Fish Pond",
    color: POND_COLOR,
    description: "任意边垂直放钩 放线20 / 钩到即收线250 / 空钩到对边停住 / 每30距离-2",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    // 一趟完整循环：下沉（200 场地 5 秒）+ 收线，留点余量。
    rionCycleDuration: 8,
    createBehavior(services) {
      function dropHook(context, contactX, contactY, direction) {
        const arena = resolveArenaGeometry(context.game);
        const { x: startX, y: startY } = arena.clampPoint(contactX, contactY);
        // 放线长度 = 从接触点沿这个方向到对面边缘的距离。
        const maxOutwardLength = arena.movementLimit(startX, startY,
          direction.x, direction.y, arena.size * 2);
        return createFishHookEntity(
          // 起点是接触点，方向垂直于被撞的那条边、指向场地内侧。
          services,
          { x: startX, y: startY },
          direction,
          null,
          // 钩子收完（回到顶部接触点）时把钓线一起收掉，和鱼钩的 finishHook 一样。
          (hook) => {
            if (hook.lineEffect) hook.lineEffect.visualActive = false;
          },
          {
            kind: HOOK_KIND,
            // 独立实体：鱼塘被打了，已经放下去的钩子照样沉到底再收回来。
            lifecycle: "independent",
            speed: HOOK_DROP_SPEED,
            // 钩到东西往回拉：原版鱼钩的收线速度（250），这一段就是拉线攻击。
            reelSpeed: FISH_HOOK_SPEED,
            // 从接触点一直放到对面边缘。
            maxOutwardLength,
            // 碰到对面边缘就地停止放线。
            stopAtWall: true,
            // 停住待命：没钩到人就一直停在对面边缘，不做「空钩回收」；
            // 有谁撞上来才上钩、才收线。
            restAtWall: true,
            // 鱼塘本体照常乱弹，不像鱼钩本体那样被钉住。
            pinOwner: false,
            // 一根钩子只钩一个敌方；已经被别的钩子钩住的也不再重复上钩。
            maxReelTargets: 1
          }
        );
      }

      return {
        onWallBounce(context) {
          // 任意边都能下钩，方向垂直于被撞的那条边、指向场内：
          //   顶边 → 向下，底边 → 向上，左边 → 向右，右边 → 向左。
          const contact = getArenaWallContacts(context)[0];
          if (contact) dropHook(context, contact.x, contact.y,
            { x: contact.normalX, y: contact.normalY });
        }
        // 本体不实现 drawBody：需求是纯色绘制，交给渲染器的默认平涂 + 描边。
      };
    }
  };

  registerBall(fishPondDefinition);

  return {
    fishPondDefinition,
    FISH_POND_CONSTANTS: Object.freeze({
      POND_COLOR,
      HOOK_DROP_SPEED,
      HOOK_KIND
    })
  };
});
