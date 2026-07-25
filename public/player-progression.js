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
  const metricName = (metric) => metric === 'xp' ? 'XP' : metric === 'cs' ? 'CS' : 'Gold';
  const format = (value, metric) => metric === 'cs' ? Math.round(value).toLocaleString() : Math.round(value).toLocaleString();
  const chartData = (id, metric) => (match.timelinePlayers || []).map((frame) => ({ minute: frame.minute, value: Number(frame.players.find((player) => player.participantId === id)?.[metric] || 0) }));
  const graph = (points, metric) => {
    const width = 760, height = 240, left = 54, right = 22, top = 18, bottom = 34, plotWidth = width - left - right, plotHeight = height - top - bottom;
    const max = Math.max(1, ...points.map((point) => point.value));
    const x = (index) => left + index * plotWidth / Math.max(1, points.length - 1);
    const y = (value) => top + plotHeight - value / max * plotHeight;
    const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
    const area = `M ${x(0)} ${top + plotHeight} L ${line.replaceAll(',', ' ')} L ${x(points.length - 1)} ${top + plotHeight} Z`;
    const grids = [0, .25, .5, .75, 1].map((share) => { const value = max * share, position = y(value); return `<line class="progress-grid" x1="${left}" x2="${width - right}" y1="${position}" y2="${position}"/><text class="progress-axis" x="${left - 9}" y="${position + 4}" text-anchor="end">${format(value, metric)}</text>`; }).join('');
    return `<svg class="progress-detail-chart" viewBox="0 0 ${width} ${height}" data-metric="${metric}"><defs><linearGradient id="progressFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f2a1b2" stop-opacity=".28"/><stop offset="1" stop-color="#f2a1b2" stop-opacity="0"/></linearGradient></defs>${grids}<path class="progress-area" d="${area}"/><polyline class="progress-line" points="${line}"/><line class="progress-hover-line" y1="${top}" y2="${top + plotHeight}" hidden/><circle class="progress-hover-dot" r="5" hidden/><rect class="progress-hover-background" rx="5" hidden/><text class="progress-hover-label" hidden></text><text class="progress-axis" x="${left}" y="${height - 10}">0m</text><text class="progress-axis" x="${width - right}" y="${height - 10}" text-anchor="end">${points.at(-1)?.minute ?? 0}m</text></svg>`;
  };
  const bindHover = (container, points, metric) => {
    const svg = container.querySelector('.progress-detail-chart'); if (!svg || !points.length) return;
    const show = (event) => {
      const rect = svg.getBoundingClientRect(), ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const index = Math.round(ratio * Math.max(0, points.length - 1)), point = points[index]; if (!point) return;
      const left = 54, right = 22, top = 18, bottom = 34, width = 760, height = 240, plotWidth = width - left - right, plotHeight = height - top - bottom;
      const max = Math.max(1, ...points.map((item) => item.value)), x = left + index * plotWidth / Math.max(1, points.length - 1), y = top + plotHeight - point.value / max * plotHeight;
      const line = svg.querySelector('.progress-hover-line'), dot = svg.querySelector('.progress-hover-dot'), label = svg.querySelector('.progress-hover-label'), background = svg.querySelector('.progress-hover-background');
      line.setAttribute('x1', x); line.setAttribute('x2', x); line.hidden = false;
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.hidden = false;
      label.setAttribute('x', Math.min(x + 12, 610)); label.setAttribute('y', Math.max(34, y - 12)); label.textContent = `${point.minute}m · ${metricName(metric)} ${format(point.value, metric)}`; label.hidden = false;
      requestAnimationFrame(() => { const box = label.getBBox(); background.setAttribute('x', box.x - 7); background.setAttribute('y', box.y - 5); background.setAttribute('width', box.width + 14); background.setAttribute('height', box.height + 10); background.hidden = false; });
    };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerleave', () => svg.querySelectorAll('.progress-hover-line,.progress-hover-dot,.progress-hover-label,.progress-hover-background').forEach((item) => { item.hidden = true; }));
  };
  const add = () => document.querySelectorAll('.full-match-panel:not([data-player-details])').forEach((panel) => {
    if (!match?.timelinePlayers || !match?.players) return;
    panel.dataset.playerDetails = 'true';
    const section = document.createElement('section'); section.className = 'player-progression unified-player-details';
    let player = match.players[0], metric = 'gold'; const name = (item) => item.summoner || item.champion;
    const draw = () => {
      const points = chartData(player.participantId, metric);
      section.querySelector('.progress-title').textContent = `${name(player)} — ${metricName(metric)} over time`;
      section.querySelector('.progress-chart').innerHTML = graph(points, metric); bindHover(section.querySelector('.progress-chart'), points, metric);
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
