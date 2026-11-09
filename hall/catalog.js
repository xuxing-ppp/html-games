/* The hall describes games; each game's version.js owns its release version. */
globalThis.GamesCatalog = [
  { id: 'ball_arena', title: '小球擂台', genre: '自动对战', input: '鼠标／触屏 · 观战沙盒', accent: '#b78135', description: '为双方挑选角色，看技能与机关碰出意外。190 个角色，支持团战、车轮战、混战、系列赛与 4–128 强锦标赛。', runtime: { 'src': ['.js', '.svg', '.ttf', '.woff2'], 'web': ['.js', '.css'] } },
  { id: 'car_racing', title: '街机赛车', genre: '竞速', input: '键盘 · 本地双人', accent: '#a04424', description: '十二条立体赛道，漂移、飞跃与空中特技。支持单人竞速和双人分屏。', note: '早期开发版本', runtime: { 'src': ['.js'], 'styles': ['.css'], 'lib': ['.js', '.txt'] } },
  { id: 'function_missel', title: '函数导弹', genre: '策略对战', input: '键盘与鼠标 · 本地多人', accent: '#b7462b', description: '把函数变成弹道。在坐标战场上绕过掩体，击中对手，也可以交给 AI 对战。', runtime: { 'web': ['.js', '.css'], 'sound': ['.mp3'] } },
  { id: 'game_of_life', title: '生命游戏', genre: '模拟实验', input: '鼠标与键盘', accent: '#375c45', description: '放下一枚滑翔机，或设计自己的细胞世界。探索经典生命与 Logistic 连续生命。', runtime: { 'web': ['.js', '.css'] } },
  { id: 'ming_magistrate', title: '大明县令', genre: '叙事解谜', input: '鼠标／触屏 · 单人', accent: '#855137', description: '到净水县赴任，从查访、证词和账册中整理线索，作出自己的裁断。', runtime: { 'js': ['.js'], 'css': ['.css'], 'assets/runtime': ['.webp'] } },
  { id: 'neon_survivor_mobile', title: '霓虹幸存者', genre: '动作生存', input: '键盘／触屏 · 单人', accent: '#655392', description: '在怪潮中走位，拾取经验，搭配武器与进化。四张地图，支持触屏与自动模式。', runtime: { 'js': ['.js'], 'css': ['.css'], 'audio': ['.mp3'] }, files: ['manifest.json', 'icon.svg', 'sw.js', 'retire-offline.js'] },
  { id: 'war_simulator', title: '战争沙盘', genre: '战术模拟', input: '鼠标与键盘', accent: '#46643c', description: '摆出红蓝两军，选择兵种和地形，再让小兵们开战。支持征途、自由沙盘与战役实验。', runtime: { 'js': ['.js'], 'css': ['.css'] } },
  { id: 'xiangqi_beyond_the_river', title: '楚河行', genre: '卡牌战棋', input: '鼠标与键盘 · 单人', accent: '#8c6a32', description: '携一盏命灯入江湖。在棋盘上行步、出招与破阵，把武学组成自己的牌路。', runtime: { 'game': ['.js', '.css'] } }
];
