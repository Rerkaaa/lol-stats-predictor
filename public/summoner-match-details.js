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

  const matchKey = (champion, date, kda) => `${champion}|${date}|${kda}`;
  const number = (value) => Number(value || 0).toLocaleString();

  const addDetails = () => {
    const output = document.querySelector('#lookupResult');
    if (!lookupData || !output?.querySelector('#lookupHistory')) return;
    const candidates = new Map();
    (lookupData.matches || []).forEach((match) => {
      const key = matchKey(match.champion, new Date(match.playedAt).toLocaleDateString(), `${match.kills} / ${match.deaths} / ${match.assists}`);
      const list = candidates.get(key) || [];
      list.push(match);
      candidates.set(key, list);
    });
    output.querySelectorAll('.recent-game:not([data-match-details])').forEach((row) => {
      const champion = row.querySelector('.champion-cell strong')?.textContent?.trim() || '';
      const date = row.querySelector(':scope > div:nth-of-type(3) span')?.textContent?.trim() || '';
      const kda = row.querySelector('.match-kda b')?.textContent?.trim() || '';
      const match = candidates.get(matchKey(champion, date, kda))?.shift();
      row.dataset.matchDetails = 'true';
      const details = document.createElement('details');
      details.className = 'summoner-match-details';
      if (!match || match.gold == null) {
        details.innerHTML = '<summary>Match details</summary><p>Detailed statistics are collected after the next manual Update for this player.</p>';
      } else {
        const items = (match.items || []).map((item) => {
          const image = lookupData.dataDragonVersion ? `<img src="https://ddragon.leagueoflegends.com/cdn/${encodeURIComponent(lookupData.dataDragonVersion)}/img/item/${encodeURIComponent(item.id)}.png" alt="${item.name}" title="${item.name}">` : `<span title="${item.name}">${item.name}</span>`;
          return image;
        }).join('') || '<span>No completed items recorded.</span>';
        details.innerHTML = `<summary>Match details</summary><div class="detail-stats"><span><b>${number(match.gold)}</b> gold</span><span><b>${number(match.damage)}</b> champion damage</span><span><b>${number(match.vision)}</b> vision score</span><span><b>${number(match.wardsPlaced)}</b> wards placed</span><span><b>${number(match.wardsKilled)}</b> wards cleared</span></div><div class="detail-items"><b>Items</b><div>${items}</div></div>`;
      }
      row.append(details);
    });
  };

  new MutationObserver(() => requestAnimationFrame(addDetails)).observe(document.querySelector('#lookupResult'), { childList: true, subtree: true });
})();
