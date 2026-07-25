(() => {
  let latestMatch = null;
  const previousFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await previousFetch(...args);
    if (String(args[0] instanceof Request ? args[0].url : args[0]).includes('/api/summoner/match?')) { try { latestMatch = await response.clone().json(); } catch { latestMatch = null; } }
    return response;
  };
  const total = (players, field) => players.reduce((sum, player) => sum + (Number(player[field]) || 0), 0);
  const label = (metric) => metric === 'xp' ? 'XP' : metric === 'cs' ? 'CS' : 'Gold';
  const chart = (timeline, metric) => {
    const values = timeline.map((frame) => Number(frame.blue[metric] || 0) - Number(frame.red[metric] || 0));
    const width = 760, height = 240, left = 54, right = 24, top = 18, bottom = 34, plotWidth = width - left - right, plotHeight = height - top - bottom, center = top + plotHeight / 2;
    const max = Math.max(1000, ...values.map((value) => Math.abs(value))); const x = (index) => left + index * plotWidth / Math.max(1, values.length - 1), y = (value) => center - value / max * (plotHeight / 2 - 8);
    const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
    const area = `M ${x(0)} ${center} L ${points.replaceAll(',', ' ')} L ${x(values.length - 1)} ${center} Z`;
    const grid = [-1, -.5, 0, .5, 1].map((share) => { const value = max * share, position = y(value), display = value === 0 ? 'Even' : `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString()}`; return `<line class="timeline-grid" x1="${left}" x2="${width - right}" y1="${position}" y2="${position}"/><text class="timeline-axis" x="${left - 9}" y="${position + 4}" text-anchor="end">${display}</text>`; }).join('');
    return `<svg data-metric="${metric}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Team ${metric} lead over time"><defs><linearGradient id="leadFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5788e9" stop-opacity=".3"/><stop offset=".5" stop-color="#6f7fa8" stop-opacity=".08"/><stop offset="1" stop-color="#ed4d6c" stop-opacity=".3"/></linearGradient></defs>${grid}<path class="timeline-area" d="${area}"/><polyline class="timeline-line" points="${points}"/><rect x="${left}" y="9" width="10" height="10" rx="2" fill="#5788e9"/><text class="timeline-legend" x="${left + 16}" y="18">Blue lead</text><rect x="${left + 84}" y="9" width="10" height="10" rx="2" fill="#ed4d6c"/><text class="timeline-legend" x="${left + 100}" y="18">Red lead</text><line class="hover-line" y1="${top}" y2="${top + plotHeight}" hidden/><circle class="hover-dot" r="5" hidden/><text class="hover-label" hidden></text><text class="timeline-axis" x="${left}" y="${height - 10}">0m</text><text class="timeline-axis" x="${width - right}" y="${height - 10}" text-anchor="end">${timeline.at(-1)?.minute ?? 0}m</text></svg>`;
  };
  const bindHover = (view, timeline) => {
    const svg = view.querySelector('svg'); if (!svg) return;
    const show = (event) => {
      const rect = svg.getBoundingClientRect(), ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), index = Math.round(ratio * Math.max(0, timeline.length - 1)), frame = timeline[index]; if (!frame) return;
      const metric = svg.dataset.metric, values = timeline.map((item) => Number(item.blue[metric] || 0) - Number(item.red[metric] || 0)), max = Math.max(1000, ...values.map((value) => Math.abs(value))), width = 760, left = 54, right = 24, top = 18, bottom = 34, plotWidth = width - left - right, plotHeight = 240 - top - bottom, value = values[index], x = left + index * plotWidth / Math.max(1, timeline.length - 1), y = top + plotHeight / 2 - value / max * (plotHeight / 2 - 8);
      const line = svg.querySelector('.hover-line'), dot = svg.querySelector('.hover-dot'), text = svg.querySelector('.hover-label'); line.setAttribute('x1', x); line.setAttribute('x2', x); line.hidden = false; dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.hidden = false; text.setAttribute('x', Math.min(x + 12, 570)); text.setAttribute('y', Math.max(36, y - 12)); text.textContent = `${frame.minute}m · Blue ${Number(frame.blue[metric]).toLocaleString()} | Red ${Number(frame.red[metric]).toLocaleString()}`; text.hidden = false;
    };
    svg.addEventListener('pointermove', show); svg.addEventListener('pointerleave', () => svg.querySelectorAll('.hover-line,.hover-dot,.hover-label').forEach((item) => { item.hidden = true; }));
  };
  const enhance = () => {
    document.querySelectorAll('.summoner-match-details').forEach((detail) => { detail.hidden = true; });
    document.querySelectorAll('.open-full-match').forEach((button) => { if (!button.dataset.renamed) { button.dataset.renamed = 'true'; button.textContent = 'Match Analysis'; } });
    document.querySelectorAll('.full-match-panel:not([data-enhanced])').forEach((panel) => {
      if (!latestMatch?.players) return; panel.dataset.enhanced = 'true';
      const blue = latestMatch.players.filter((player) => player.teamId === 100), red = latestMatch.players.filter((player) => player.teamId === 200);
      const metrics = [['Kills', 'kills'], ['Gold', 'gold'], ['Damage', 'damage'], ['Vision', 'vision'], ['CS', 'cs']].map(([name, field]) => { const left = total(blue, field), right = total(red, field), share = Math.round(left / Math.max(1, left + right) * 100); return `<article><b>${name}</b><div><span style="width:${share}%"></span><i style="width:${100 - share}%"></i></div><small>${left.toLocaleString()} <em>vs</em> ${right.toLocaleString()}</small></article>`; }).join('');
      const extension = document.createElement('section'); extension.className = 'match-analysis-extension';
      extension.innerHTML = `<div class="analysis-tabs"><button class="active" data-analysis="teams">Team analysis</button><button data-analysis="timeline">Timeline</button></div><div class="analysis-view teams-view"><h3>Team comparison</h3><div class="metric-comparison">${metrics}</div></div><div class="analysis-view timeline-view" hidden><div class="timeline-metric-tabs"><button class="active" data-metric="gold">Gold</button><button data-metric="xp">XP</button><button data-metric="cs">CS</button></div><h3 class="timeline-title">Gold lead over time</h3><p>Blue above the centre line; Red below it. Hover to inspect exact team values.</p><div class="timeline-chart">${chart(latestMatch.timeline || [], 'gold')}</div></div>`;
      extension.querySelectorAll('[data-analysis]').forEach((button) => button.addEventListener('click', () => { extension.querySelectorAll('[data-analysis]').forEach((tab) => tab.classList.toggle('active', tab === button)); extension.querySelector('.teams-view').hidden = button.dataset.analysis !== 'teams'; extension.querySelector('.timeline-view').hidden = button.dataset.analysis !== 'timeline'; }));
      extension.querySelectorAll('[data-metric]').forEach((button) => button.addEventListener('click', () => { const metric = button.dataset.metric, view = extension.querySelector('.timeline-view'); extension.querySelectorAll('[data-metric]').forEach((tab) => tab.classList.toggle('active', tab === button)); extension.querySelector('.timeline-title').textContent = `${label(metric)} lead over time`; extension.querySelector('.timeline-chart').innerHTML = chart(latestMatch.timeline || [], metric); bindHover(view, latestMatch.timeline || []); }));
      bindHover(extension.querySelector('.timeline-view'), latestMatch.timeline || []); panel.append(extension);
    });
  };
  new MutationObserver(() => requestAnimationFrame(enhance)).observe(document.querySelector('#lookupResult'), { childList: true, subtree: true });
})();
