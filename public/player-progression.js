(() => {
  let match = null;
  const base = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await base(...args);
    if (String(args[0] instanceof Request ? args[0].url : args[0]).includes('/api/summoner/match?')) {
      try { match = await response.clone().json(); } catch { match = null; }
    }
    return response;
  };
  const graph = (id, metric) => {
    const points = (match.timelinePlayers || []).map((frame) => ({ minute: frame.minute, value: frame.players.find((player) => player.participantId === id)?.[metric] || 0 }));
    const max = Math.max(1, ...points.map((point) => point.value));
    return `<svg viewBox="0 0 640 180"><polyline points="${points.map((point, index) => `${24 + index * 592 / Math.max(1, points.length - 1)},${156 - point.value / max * 132}`).join(' ')}"/><text x="24" y="173">0m</text><text x="590" y="173">${points.at(-1)?.minute ?? 0}m</text></svg>`;
  };
  const add = () => document.querySelectorAll('.full-match-panel:not([data-player-details])').forEach((panel) => {
    if (!match?.timelinePlayers || !match?.players) return;
    panel.dataset.playerDetails = 'true';
    const section = document.createElement('section');
    section.className = 'player-progression unified-player-details';
    let player = match.players[0], metric = 'gold';
    const name = (item) => item.summoner || item.champion;
    const draw = () => {
      section.querySelector('.progress-title').textContent = `${name(player)} — ${metric === 'xp' ? 'XP' : metric === 'cs' ? 'CS' : 'Gold'} over time`;
      section.querySelector('.progress-chart').innerHTML = graph(player.participantId, metric);
      section.querySelector('.build-title').textContent = `${name(player)} — item purchases`;
      const purchases = (match.itemEvents || []).filter((event) => event.participantId === player.participantId && event.type === 'ITEM_PURCHASED');
      section.querySelector('.build-events').innerHTML = purchases.map((event) => `<article><img src="https://ddragon.leagueoflegends.com/cdn/${encodeURIComponent(match.version)}/img/item/${event.itemId}.png" alt="${event.itemName}" title="${event.itemName}"><span>${event.minute}m</span></article>`).join('') || '<p>No purchase timeline available.</p>';
      section.querySelector('.rune-title').textContent = `Runes — ${name(player)}`;
      section.querySelector('.rune-icons').innerHTML = (player.runes || []).map((rune) => `<img src="https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}" title="${rune.name}: ${String(rune.description).replace(/<[^>]*>/g, ' ')}" alt="${rune.name}">`).join('') || '<p>No rune data available.</p>';
      section.querySelectorAll('[data-player]').forEach((button) => button.classList.toggle('active', Number(button.dataset.player) === player.participantId));
    };
    section.innerHTML = `<h3 class="progress-title"></h3><p class="player-detail-hint">Select a champion to update every section below.</p><div class="progress-players">${match.players.map((item) => `<button data-player="${item.participantId}">${item.champion}</button>`).join('')}</div><div class="timeline-metric-tabs"><button class="active" data-progress="gold">Gold</button><button data-progress="xp">XP</button><button data-progress="cs">CS</button></div><div class="progress-chart"></div><section class="item-build-timeline"><h3 class="build-title"></h3><div class="build-events"></div></section><section class="rune-view"><h3 class="rune-title"></h3><div class="rune-icons"></div></section>`;
    section.querySelectorAll('[data-player]').forEach((button) => button.addEventListener('click', () => { player = match.players.find((item) => item.participantId === Number(button.dataset.player)); draw(); }));
    section.querySelectorAll('[data-progress]').forEach((button) => button.addEventListener('click', () => { metric = button.dataset.progress; section.querySelectorAll('[data-progress]').forEach((tab) => tab.classList.toggle('active', tab === button)); draw(); }));
    draw(); panel.append(section);
  });
  new MutationObserver(() => requestAnimationFrame(add)).observe(document.querySelector('#lookupResult'), { childList: true, subtree: true });
})();
