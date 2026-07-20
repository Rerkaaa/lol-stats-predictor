const a = document.querySelector('#teamA');
const b = document.querySelector('#teamB');
const button = document.querySelector('#predict');
const killsLine = document.querySelector('#killsLine');
const durationLine = document.querySelector('#durationLine');
const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const minutes = value => `${Math.floor(value)}:${String(Math.round((value % 1) * 60)).padStart(2, '0')}`;
const duration = value => value ? minutes(value / 60) : 'Duration unavailable';

const showView = view => {
  const matches = view === 'matches';
  document.querySelector('#predictorView').hidden = matches;
  document.querySelector('#matchesView').hidden = !matches;
  document.querySelector('#predictorHero').hidden = matches;
  document.querySelectorAll('[data-view-button]').forEach(item => item.classList.toggle('active', item.dataset.viewButton === view));
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
};
document.querySelectorAll('[data-view-button]').forEach(item => item.addEventListener('click', () => showView(item.dataset.viewButton)));
document.querySelector('[data-view-link]').addEventListener('click', event => { event.preventDefault(); showView('predictor'); });
if (location.hash === '#matches') showView('matches');

const fill = teams => [a, b].forEach(select => {
  select.innerHTML = '<option value="">Choose a team</option>' + teams.map(team => `<option value="${team.id}">${escape(team.name)} (${team.games} games)</option>`).join('');
});
const roster = team => team.roster.length ? team.roster.map(player => `${player.role || 'role'}: ${player.name}`).join(' • ') : 'No player rows available';
const context = (title, team) => `<article><h3>${title}</h3><p><strong>${team.recentGames}</strong> games in the last 45 days • <strong>${team.effectiveGames.toFixed(1)}</strong> effective weighted games</p><p>${roster(team)}</p></article>`;
const prop = (forecast, unit) => {
  if (!forecast) return 'Not enough complete map data for this forecast.';
  const line = forecast.line == null ? '' : `<br><strong>${(forecast.probabilityOverLine * 100).toFixed(0)}%</strong> over ${forecast.line}${unit} • <strong>${(forecast.probabilityUnderLine * 100).toFixed(0)}%</strong> under ${forecast.line}${unit}`;
  const range = unit === ' min' ? `${minutes(forecast.typicalLow)}–${minutes(forecast.typicalHigh)}` : `${forecast.typicalLow.toFixed(1)}–${forecast.typicalHigh.toFixed(1)}${unit}`;
  const expected = unit === ' min' ? minutes(forecast.expected) : forecast.expected.toFixed(1) + unit;
  return `Expected: <strong>${expected}</strong><br>Typical range: ${range}${line}`;
};

const playerTable = (players, team) => `<table class="player-table"><thead><tr><th>${escape(team)}</th><th>Champ</th><th>KDA</th><th>CS</th><th>Gold</th><th>Damage</th><th>Vision</th></tr></thead><tbody>${players.map(player => `<tr><td><span class="role">${escape(player.role || '—')}</span> ${escape(player.playerName)}</td><td>${escape(player.champion || '—')}</td><td>${player.kills ?? '—'}/${player.deaths ?? '—'}/${player.assists ?? '—'}</td><td>${player.cs ?? '—'}</td><td>${player.gold ?? '—'}</td><td>${player.damage ?? '—'}</td><td>${player.visionScore ?? '—'}</td></tr>`).join('') || '<tr><td colspan="7">Player statistics unavailable for this map.</td></tr>'}</tbody></table>`;
const objectiveLine = (label, blue, red) => `<span><b>${blue ?? '—'}</b> ${label} <b>${red ?? '—'}</b></span>`;
const mapCard = map => {
  const bluePlayers = map.players.filter(player => player.team === 'blue');
  const redPlayers = map.players.filter(player => player.team === 'red');
  return `<details class="map-card"><summary><span>Map ${map.number}</span><strong>${escape(map.blueTeam)} <b class="map-score">${map.blueKills ?? '—'} – ${map.redKills ?? '—'}</b> ${escape(map.redTeam)}</strong><span>${duration(map.durationSeconds)}${map.patch ? ` • Patch ${escape(map.patch)}` : ''}</span></summary><div class="map-content"><div class="objectives"><span class="objective-team">${escape(map.blueTeam)}</span>${objectiveLine('dragons', map.objectives.blue.dragons, map.objectives.red.dragons)}${objectiveLine('barons', map.objectives.blue.barons, map.objectives.red.barons)}${objectiveLine('towers', map.objectives.blue.towers, map.objectives.red.towers)}<span class="objective-team">${escape(map.redTeam)}</span></div><div class="player-tables">${playerTable(bluePlayers, map.blueTeam)}${playerTable(redPlayers, map.redTeam)}</div></div></details>`;
const seriesCard = series => `<article class="series"><div class="series-header"><div><p class="competition">${escape(series.competition)}</p><h2>${escape(series.teamA.name)} <strong>${series.teamA.score} – ${series.teamB.score}</strong> ${escape(series.teamB.name)}</h2><p>${series.maps.length} map${series.maps.length === 1 ? '' : 's'} played • latest map ${escape(series.playedAt || 'unknown')}</p></div><button class="open-series" type="button" aria-expanded="false">View maps</button></div><div class="series-maps" hidden>${series.maps.map(mapCard).join('')}</div></article>`;

fetch('/api/latest-series').then(response => response.json()).then(series => {
  const container = document.querySelector('#latestSeries');
  container.innerHTML = series.length ? series.map(seriesCard).join('') : 'No imported match results yet.';
  document.querySelector('#latestUpdated').textContent = series[0]?.playedAt ? `Latest imported map: ${series[0].playedAt}` : 'Waiting for data';
  container.querySelectorAll('.open-series').forEach(button => button.addEventListener('click', () => {
    const maps = button.closest('.series').querySelector('.series-maps');
    const opening = maps.hidden;
    maps.hidden = !opening;
    button.textContent = opening ? 'Hide maps' : 'View maps';
    button.setAttribute('aria-expanded', String(opening));
  }));
}).catch(() => { document.querySelector('#latestSeries').textContent = 'Latest results are temporarily unavailable.'; });

fetch('/api/teams').then(response => response.json()).then(fill).catch(() => { a.innerHTML = b.innerHTML = '<option>Data service unavailable</option>'; });

button.addEventListener('click', async () => {
  if (!a.value || !b.value || a.value === b.value) return;
  const response = await fetch(`/api/matchup?teamA=${a.value}&teamB=${b.value}&killsLine=${encodeURIComponent(killsLine.value)}&durationLine=${encodeURIComponent(durationLine.value)}`);
  const data = await response.json();
  if (!response.ok) { alert(data.error); return; }
  document.querySelector('#empty').hidden = true;
  document.querySelector('#result').hidden = false;
  document.querySelector('#teamAName').textContent = data.teamA;
  document.querySelector('#teamBName').textContent = data.teamB;
  document.querySelector('#probA').textContent = (data.probabilityA * 100).toFixed(1) + '%';
  document.querySelector('#probB').textContent = (data.probabilityB * 100).toFixed(1) + '%';
  document.querySelector('#confidence').textContent = `${data.model} • data coverage confidence: ${(data.confidence * 100).toFixed(0)}% • ${Math.round(data.activeWeight * 100)}% of model inputs available`;
  document.querySelector('#context').innerHTML = `<p class="asof">Current patch: <strong>${data.currentPatch || 'unknown'}</strong>${data.asOf ? ` • latest data: ${data.asOf}` : ''}</p>${context(data.teamA, data.teamAContext)}${context(data.teamB, data.teamBContext)}`;
  document.querySelector('#killsForecast').innerHTML = prop(data.mapForecasts.totalKills, ' kills');
  document.querySelector('#durationForecast').innerHTML = prop(data.mapForecasts.duration, ' min');
  document.querySelector('#factors').innerHTML = data.factors.map(factor => `<tr><td>${factor.name}</td><td>${factor.edge == null ? 'No data' : (factor.edge > 0 ? '+' : '') + factor.edge.toFixed(3)}</td><td>${(factor.weight * 100).toFixed(0)}%</td></tr>`).join('');
});
