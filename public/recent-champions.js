(() => {
  let lookupData = null;
  const previousFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const response = await previousFetch(...args);
    const requestUrl = String(args[0] instanceof Request ? args[0].url : args[0]);
    if (requestUrl.includes('/api/summoner?')) {
      try { lookupData = await response.clone().json(); } catch { lookupData = null; }
    }
    return response;
  };

  const render = () => {
    const output = document.querySelector('#lookupResult');
    if (!lookupData || !output?.querySelector('.summoner-profile') || output.querySelector('.recent-champions')) return;
    const recent = [...(lookupData.matches || [])].sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt)).slice(0, 20);
    const champions = Object.values(recent.reduce((rows, game) => {
      const key = game.champion || 'Unknown';
      const row = rows[key] ||= { ...game, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, cs: 0, seconds: 0, roles: {} };
      row.games += 1;
      row.wins += game.win ? 1 : 0;
      row.kills += game.kills || 0;
      row.deaths += game.deaths || 0;
      row.assists += game.assists || 0;
      row.cs += game.cs || 0;
      row.seconds += game.durationSeconds || 0;
      row.roles[game.role || 'Unknown'] = (row.roles[game.role || 'Unknown'] || 0) + 1;
      return rows;
    }, {})).sort((left, right) => right.games - left.games || right.wins - left.wins).slice(0, 7);
    if (!champions.length) return;

    const section = document.createElement('section');
    section.className = 'lookup-section recent-champions';
    section.innerHTML = `<h2>Recent 20 games — champion breakdown</h2><p class="recent-champion-hint">Select a champion to open its saved match history.</p><div class="recent-champion-list"></div>`;
    const list = section.querySelector('.recent-champion-list');
    champions.forEach((champion) => {
      const role = Object.entries(champion.roles).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';
      const winRate = Math.round((champion.wins / champion.games) * 100);
      const kda = ((champion.kills + champion.assists) / Math.max(1, champion.deaths)).toFixed(2);
      const csPerMinute = champion.seconds ? (champion.cs / (champion.seconds / 60)).toFixed(1) : '–';
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'recent-champion-card';
      const image = lookupData.dataDragonVersion && champion.championAsset ? `<img src="https://ddragon.leagueoflegends.com/cdn/${encodeURIComponent(lookupData.dataDragonVersion)}/img/champion/${encodeURIComponent(champion.championAsset)}.png" alt="">` : '';
      card.innerHTML = `${image}<span class="recent-champion-name"><b>${champion.champion}</b><small>${role}</small></span><span><b>${champion.games} game${champion.games === 1 ? '' : 's'}</b><small>${winRate}% WR</small></span><span><b>${kda} KDA</b><small>${csPerMinute} CS/min</small></span>`;
      card.addEventListener('click', () => window.dispatchEvent(new CustomEvent('summoner:champion-filter', { detail: champion.champion })));
      list.append(card);
    });
    const trends = output.querySelector('.recent-form');
    if (trends) trends.insertAdjacentElement('afterend', section);
    else output.querySelector('.summoner-profile').insertAdjacentElement('afterend', section);
  };

  new MutationObserver(() => requestAnimationFrame(render)).observe(document.querySelector('#lookupResult'), { childList: true, subtree: true });
})();
