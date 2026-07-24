(() => {
  let lookupData = null;
  const previousFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await previousFetch(...args);
    if (String(args[0] instanceof Request ? args[0].url : args[0]).includes('/api/summoner?')) {
      try { lookupData = await response.clone().json(); } catch { lookupData = null; }
    }
    return response;
  };
  const key = (champion, date, kda) => `${champion}|${date}|${kda}`;
  const format = (value) => Number(value || 0).toLocaleString();
  const render = (data) => {
    const team = (id) => data.players.filter((player) => player.teamId === id);
    const totals = (players, field) => players.reduce((sum, player) => sum + (Number(player[field]) || 0), 0);
    const row = (player) => `<tr><td><img src="https://ddragon.leagueoflegends.com/cdn/${encodeURIComponent(data.version)}/img/champion/${encodeURIComponent(player.championAsset)}.png" alt=""> ${player.champion}</td><td>${player.kills}/${player.deaths}/${player.assists}</td><td>${format(player.gold)}</td><td>${format(player.damage)}</td><td>${format(player.vision)}</td><td>${player.cs}</td><td>${player.items.map((item) => `<img class="full-item" src="https://ddragon.leagueoflegends.com/cdn/${encodeURIComponent(data.version)}/img/item/${item.id}.png" title="${item.name}" alt="${item.name}">`).join('')}</td></tr>`;
    const panel = document.createElement('section');
    panel.className = 'full-match-panel';
    const blue = team(100), red = team(200);
    panel.innerHTML = `<div class="full-match-head"><div><p class="eyebrow">Cached full match analysis</p><h2>Match overview</h2></div><button type="button" class="close-full-match">Close</button></div><div class="team-totals"><span>Blue: <b>${totals(blue, 'kills')} kills</b> · ${format(totals(blue, 'gold'))} gold · ${format(totals(blue, 'damage'))} damage</span><span>Red: <b>${totals(red, 'kills')} kills</b> · ${format(totals(red, 'gold'))} gold · ${format(totals(red, 'damage'))} damage</span></div><div class="full-team-grid"><div><h3>Blue team</h3><table><thead><tr><th>Champion</th><th>KDA</th><th>Gold</th><th>Damage</th><th>Vision</th><th>CS</th><th>Items</th></tr></thead><tbody>${blue.map(row).join('')}</tbody></table></div><div><h3>Red team</h3><table><thead><tr><th>Champion</th><th>KDA</th><th>Gold</th><th>Damage</th><th>Vision</th><th>CS</th><th>Items</th></tr></thead><tbody>${red.map(row).join('')}</tbody></table></div></div>`;
    panel.querySelector('.close-full-match').addEventListener('click', () => panel.remove());
    return panel;
  };
  const wire = () => {
    const output = document.querySelector('#lookupResult'); if (!lookupData || !output) return;
    const candidates = new Map();
    lookupData.matches.forEach((match) => { const k = key(match.champion, new Date(match.playedAt).toLocaleDateString(), `${match.kills} / ${match.deaths} / ${match.assists}`); const rows = candidates.get(k) || []; rows.push(match); candidates.set(k, rows); });
    output.querySelectorAll('.recent-game:not([data-full-match])').forEach((game) => {
      const match = candidates.get(key(game.querySelector('.champion-cell strong')?.textContent?.trim(), game.querySelector(':scope > div:nth-of-type(3) span')?.textContent?.trim(), game.querySelector('.match-kda b')?.textContent?.trim()))?.shift();
      game.dataset.fullMatch = 'true'; if (!match) return;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'open-full-match'; button.textContent = 'Full match analysis';
      button.addEventListener('click', async () => { button.disabled = true; button.textContent = 'Loading full match…'; try { const response = await fetch(`/api/summoner/match?region=${encodeURIComponent(lookupData.profile.region)}&matchId=${encodeURIComponent(match.id)}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); game.querySelector('.full-match-panel')?.remove(); game.append(render(data)); button.textContent = 'Reload full match'; } catch (error) { button.textContent = error.message || 'Match unavailable'; } finally { button.disabled = false; } });
      game.append(button);
    });
  };
  new MutationObserver(() => requestAnimationFrame(wire)).observe(document.querySelector('#lookupResult'), { childList: true, subtree: true });
})();
