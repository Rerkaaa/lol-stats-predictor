(() => {
  let currentData = null;
  const previousFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const response = await previousFetch(...args);
    const requestUrl = String(args[0] instanceof Request ? args[0].url : args[0]);
    if (requestUrl.includes('/api/summoner?')) {
      try { currentData = await response.clone().json(); } catch { currentData = null; }
    }
    return response;
  };

  const recentStats = (matches) => {
    const games = [...matches].sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt)).slice(0, 20);
    const wins = games.filter((game) => game.win).length;
    const kills = games.reduce((total, game) => total + (game.kills || 0), 0);
    const deaths = games.reduce((total, game) => total + (game.deaths || 0), 0);
    const assists = games.reduce((total, game) => total + (game.assists || 0), 0);
    const minutes = games.reduce((total, game) => total + ((game.durationSeconds || 0) / 60), 0);
    const cs = games.reduce((total, game) => total + (game.cs || 0), 0);
    return { games, wins, kills, deaths, assists, csPerMinute: minutes ? cs / minutes : 0 };
  };

  const renderTrends = () => {
    const output = document.querySelector('#lookupResult');
    if (!currentData || !output?.querySelector('.summoner-profile') || output.querySelector('.recent-form')) return;
    const stats = recentStats(currentData.matches || []);
    if (!stats.games.length) return;
    const winRate = Math.round((stats.wins / stats.games.length) * 100);
    const kda = ((stats.kills + stats.assists) / Math.max(1, stats.deaths)).toFixed(2);
    const strip = stats.games.map((game) => `<span class="form-game ${game.win ? 'win' : 'loss'}" title="${game.win ? 'Victory' : 'Defeat'} · ${new Date(game.playedAt).toLocaleDateString()}">${game.win ? 'W' : 'L'}</span>`).join('');
    const section = document.createElement('section');
    section.className = 'recent-form';
    section.innerHTML = `<div class="form-heading"><div><p class="eyebrow">Stored match history</p><h2>Recent form</h2></div><span>Last ${stats.games.length} games</span></div><div class="form-stats"><article><b>${winRate}%</b><span>Win rate · ${stats.wins}W-${stats.games.length - stats.wins}L</span></article><article><b>${kda}</b><span>KDA · ${stats.kills}/${stats.deaths}/${stats.assists}</span></article><article><b>${stats.csPerMinute.toFixed(1)}</b><span>CS per minute</span></article></div><div class="form-strip" aria-label="Recent match results, newest first">${strip}</div>`;
    const rankTracking = output.querySelector('.rank-tracking');
    if (rankTracking) rankTracking.insertAdjacentElement('afterend', section);
    else output.querySelector('.summoner-profile').insertAdjacentElement('afterend', section);
  };

  new MutationObserver(() => requestAnimationFrame(renderTrends)).observe(document.querySelector('#lookupResult'), { childList: true, subtree: true });
})();
