(() => {
  'use strict';
  const catalog = globalThis.GamesCatalog;
  const order = globalThis.GamesOrder;
  const positions = new Map(order.map((id, index) => [id, index]));
  const games = [...catalog].sort((a, b) =>
    (positions.get(a.id) ?? order.length) - (positions.get(b.id) ?? order.length));
  const $ = id => document.getElementById(id);
  const list = $('game-list');
  let selected = 0, page = 0, capacity = games.length;
  const remembered = history.state?.game;
  if (games.some(game => game.id === remembered)) selected = games.findIndex(game => game.id === remembered);
  let imageRequest = 0;
  const versions = new Map();
  function remember() {
    try { history.replaceState({ ...history.state, game: games[selected].id }, ''); } catch { /* Sandboxed file pages can deny history changes. */ }
  }
  function choose(index) {
    selected = index;
    const game = games[index];
    document.documentElement.style.setProperty('--accent', game.accent);
    $('game-title').textContent = game.title;
    $('game-version').textContent = versions.has(game.id) ? 'v' + versions.get(game.id) : '';
    $('game-description').textContent = game.description;
    $('game-input').textContent = game.input;
    $('game-note').textContent = game.note || '';
    $('preview-genre').textContent = game.genre;
    $('play').href = `games/${game.id}/index.html`;
    $('play').setAttribute('aria-label', `开始游戏：${game.title}`);
    $('position').textContent = `${selected + 1} / ${games.length}`;
    const request = ++imageRequest;
    const url = `hall/previews/${game.id}.webp`;
    const image = new Image();
    image.onload = () => {
      if (request !== imageRequest) return;
      $('preview').src = url;
      $('preview').alt = `${game.title}实际游戏画面`;
    };
    image.src = url;
    remember();
    renderList();
  }
  function renderList() {
    const active = document.activeElement?.dataset.game;
    list.replaceChildren();
    const start = page * capacity;
    for (let index = start; index < Math.min(start + capacity, games.length); index++) {
      const game = games[index];
      const button = document.createElement('button');
      button.className = 'game-choice';
      button.dataset.game = game.id;
      button.setAttribute('aria-pressed', String(index === selected));
      const copy = document.createElement('span');
      copy.className = 'choice-copy';
      const title = document.createElement('span');
      title.className = 'choice-title'; title.textContent = game.title;
      const type = document.createElement('span');
      type.className = 'choice-type'; type.textContent = game.genre;
      copy.append(title, type);
      const arrow = document.createElement('span');
      arrow.className = 'choice-arrow'; arrow.textContent = index === selected ? '↗' : '→'; arrow.ariaHidden = 'true';
      button.append(copy, arrow);
      button.addEventListener('click', () => choose(index));
      button.addEventListener('keydown', event => {
        const delta = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 0;
        if (!delta && !['Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? games.length - 1 : (index + delta + games.length) % games.length;
        page = Math.floor(target / capacity); choose(target);
        list.querySelector(`[data-game="${games[target].id}"]`).focus();
      });
      list.append(button);
    }
    const pages = Math.ceil(games.length / capacity);
    $('previous').disabled = page === 0;
    $('next').disabled = page === pages - 1;
    $('page-number').textContent = `${page + 1} / ${pages}`;
    $('pagination').style.visibility = pages > 1 ? 'visible' : 'hidden';
    if (active) list.querySelector(`[data-game="${active}"]`)?.focus({ preventScroll: true });
  }
  function fit() {
    const row = matchMedia('(max-width:740px) and (min-height:561px)').matches ? 52 : innerHeight <= 440 ? 52 : innerHeight <= 650 ? 56 : 72;
    const available = list.getBoundingClientRect().height;
    const next = Math.max(1, Math.min(games.length, Math.floor(available / row)));
    if (next !== capacity) { capacity = next; page = Math.floor(selected / capacity); renderList(); }
  }
  $('previous').onclick = () => { page--; renderList(); };
  $('next').onclick = () => { page++; renderList(); };
  addEventListener('pageshow', () => { page = Math.floor(selected / capacity); renderList(); fit(); });
  new ResizeObserver(fit).observe(list);
  choose(selected); fit();
  // Classic scripts work with file:// and each assignment is read in order.
  for (const game of games) {
    const script = document.createElement('script');
    script.src = `games/${game.id}/version.js`;
    script.async = false;
    script.onload = () => {
      const version = globalThis.GAME_VERSION;
      versions.set(game.id, version);
      if (games[selected].id === game.id) $('game-version').textContent = 'v' + version;
      script.remove();
    };
    script.onerror = () => script.remove();
    document.head.append(script);
  }
})();
