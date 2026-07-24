(() => {
  let latestMatch = null;
  const previousFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await previousFetch(...args);
    if (String(args[0] instanceof Request ? args[0].url : args[0]).includes('/api/summoner/match?')) {
      try { latestMatch = await response.clone().json(); } catch { latestMatch = null; }
    }
    return response;
  };
  const total = (players, field) => players.reduce((sum, player) => sum + (Number(player[field]) || 0), 0);
  const chart = (timeline) => {
    const values = timeline.map((frame) => frame.blue.gold - frame.red.gold);
    const max = Math.max(1000, ...values.map((value) => Math.abs(value)));
    const width = 640, height = 190, pad = 24;
    const point = (value, index) => `${pad + (index * (width - pad * 2) / Math.max(1, values.length - 1))},${height / 2 - (value / max) * (height / 2 - pad)}`;
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Team gold lead over time"><line x1="${pad}" x2="${width - pad}" y1="${height / 2}" y2="${height / 2}"/><polyline points="${values.map(point).join(' ')}"/><text x="${pad}" y="${height - 5}">0m</text><text x="${width - 48}" y="${height - 5}">${timeline.at(-1)?.minute ?? 0}m</text></svg>`;
  };
  const enhance = () => {
    document.querySelectorAll('.summoner-match-details').forEach((detail) => { detail.hidden = true; });
    document.querySelectorAll('.open-full-match').forEach((button) => { if (!button.dataset.renamed) { button.dataset.renamed = 'true'; button.textContent = 'Match Analysis'; } });
    document.querySelectorAll('.full-match-panel:not([data-enhanced])').forEach((panel) => {
      if (!latestMatch?.players) return;
      panel.dataset.enhanced = 'true';
      const blue = latestMatch.players.filter((player) => player.teamId === 100), red = latestMatch.players.filter((player) => player.teamId === 200);
      const metrics = [['Kills', 'kills'], ['Gold', 'gold'], ['Damage', 'damage'], ['Vision', 'vision'], ['CS', 'cs']].map(([label, field]) => {
        const left = total(blue, field), right = total(red, field), share = Math.round(left / Math.max(1, left + right) * 100);
        return `<article><b>${label}</b><div><span style="width:${share}%"></span><i style="width:${100 - share}%"></i></div><small>${left.toLocaleString()} <em>vs</em> ${right.toLocaleString()}</small></article>`;
      }).join('');
      const extension = document.createElement('section');
      extension.className = 'match-analysis-extension';
      extension.innerHTML = `<div class="analysis-tabs"><button class="active" data-analysis="teams">Team analysis</button><button data-analysis="timeline">Gold timeline</button></div><div class="analysis-view teams-view"><h3>Team comparison</h3><div class="metric-comparison">${metrics}</div></div><div class="analysis-view timeline-view" hidden><h3>Gold lead over time</h3><p>Blue above the line; Red below the line.</p>${chart(latestMatch.timeline || [])}</div>`;
      extension.querySelectorAll('[data-analysis]').forEach((button) => button.addEventListener('click', () => { extension.querySelectorAll('[data-analysis]').forEach((tab) => tab.classList.toggle('active', tab === button)); extension.querySelector('.teams-view').hidden = button.dataset.analysis !== 'teams'; extension.querySelector('.timeline-view').hidden = button.dataset.analysis !== 'timeline'; }));
      panel.append(extension);
    });
  };
  new MutationObserver(() => requestAnimationFrame(enhance)).observe(document.querySelector('#lookupResult'), { childList: true, subtree: true });
})();
