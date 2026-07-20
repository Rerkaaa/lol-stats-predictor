const a = document.querySelector('#teamA');
const b = document.querySelector('#teamB');
const button = document.querySelector('#predict');
const killsLine = document.querySelector('#killsLine');
const durationLine = document.querySelector('#durationLine');

const fill = teams => [a, b].forEach(select => {
  select.innerHTML = '<option value="">Choose a team</option>' + teams.map(team => `<option value="${team.id}">${team.name} (${team.games} games)</option>`).join('');
});
const roster = team => team.roster.length ? team.roster.map(player => `${player.role || 'role'}: ${player.name}`).join(' • ') : 'No player rows available';
const context = (title, team) => `<article><h3>${title}</h3><p><strong>${team.recentGames}</strong> games in the last 45 days • <strong>${team.effectiveGames.toFixed(1)}</strong> effective weighted games</p><p>${roster(team)}</p></article>`;
const minutes = value => `${Math.floor(value)}:${String(Math.round((value % 1) * 60)).padStart(2, '0')}`;
const prop = (forecast, unit) => {
  if (!forecast) return 'Not enough complete map data for this forecast.';
  const line = forecast.line == null ? '' : `<br><strong>${(forecast.probabilityOverLine * 100).toFixed(0)}%</strong> over ${forecast.line}${unit} • <strong>${(forecast.probabilityUnderLine * 100).toFixed(0)}%</strong> under ${forecast.line}${unit}`;
  const range = unit === ' min' ? `${minutes(forecast.typicalLow)}–${minutes(forecast.typicalHigh)}` : `${forecast.typicalLow.toFixed(1)}–${forecast.typicalHigh.toFixed(1)}${unit}`;
  const expected = unit === ' min' ? minutes(forecast.expected) : forecast.expected.toFixed(1) + unit;
  return `Expected: <strong>${expected}</strong><br>Typical range: ${range}${line}`;
};
const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const duration = value => value ? minutes(value / 60) : 'Duration unavailable';
const seriesCard = series => `<details class="series"><summary><span class="series-team">${escape(series.teamA.name)}</span><strong class="series-score">${series.teamA.score} – ${series.teamB.score}</strong><span class="series-team">${escape(series.teamB.name)}</span><span class="series-meta">${escape(series.competition)} • ${series.maps.length} map${series.maps.length === 1 ? '' : 's'} played</span></summary><div class="map-list">${series.maps.map(map => `<div class="map-row"><span>Map ${map.number}</span><span class="map-team ${map.winner === map.blueTeam ? 'map-winner' : ''}">${escape(map.blueTeam)}</span><strong class="map-score">${map.blueKills ?? '–'} – ${map.redKills ?? '–'}</strong><span class="map-team right ${map.winner === map.redTeam ? 'map-winner' : ''}">${escape(map.redTeam)}</span><span class="map-detail">${duration(map.durationSeconds)}${map.patch ? ` • ${escape(map.patch)}` : ''}</span></div>`).join('')}</div></details>`;

fetch('/api/latest-series').then(response => response.json()).then(series => {
  document.querySelector('#latestSeries').innerHTML = series.length ? series.map(seriesCard).join('') : 'No imported match results yet.';
  document.querySelector('#latestUpdated').textContent = series[0]?.playedAt ? `Latest map: ${series[0].playedAt}` : 'Waiting for data';
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
