W.Game.init();
W.Lab.init();
W.Campaign.init();
W.Interaction.init();
W.Maps.init();
W.Menu.init();

W.Presentation.init();

const versionLabel = document.querySelector?.('[data-game-version]');
if (versionLabel) versionLabel.textContent = 'v' + globalThis.GAME_VERSION;
