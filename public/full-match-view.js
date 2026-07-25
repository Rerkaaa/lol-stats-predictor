(() => {
  let lookupData = null;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (String(args[0] instanceof Request ? args[0].url : args[0]).includes('/api/summoner?')) {
      try { lookupData = await response.clone().json(); } catch { lookupData = null; }
    }
    return response;
  };

  const matchKey = (champion, date, kda) => `${champion}|${date}|${kda}`;
  const number = (value) => Number(value || 0).toLocaleString();
  const duration = (seconds) => `${Math.floor(Number(seconds || 0) / 60)}:${String(Number(seconds || 0) % 60).padStart(2, '0')}`;
  const sum = (players, field) => players.reduce((total, player) => total + (Number(player[field]) || 0), 0);
  const rating = (player, teamDamage) => Math.min(10, Math.max(1, (3.5 + ((player.kills + player.assists * .65) / Math.max(1, player.deaths)) + player.damage / Math.max(1, teamDamage) * 2.4))).toFixed(1);

  const render = (data) => {
    const blue = data.players.filter((player) => player.teamId === 100);
    const red = data.players.filter((player) => player.teamId === 200);
    const blueKills = sum(blue, 'kills'), redKills = sum(red, 'kills');
    const blueGold = sum(blue, 'gold'), redGold = sum(red, 'gold');
    const teamDamage = { 100: sum(blue, 'damage'), 200: sum(red, 'damage') };
    const teamWon = (players) => Boolean(players[0]?.win);
    const row = (player) => {
      const kda = (player.kills + player.assists) / Math.max(1, player.deaths);
      const killShare = Math.round((player.kills + player.assists) / Math.max(1, sum(player.teamId === 100 ? blue : red, 'kills')) * 100);
      const csPerMin = Number(player.cs || 0) / Math.max(1, Number(data.duration || 0) / 60);
      const icon = `https://ddragon.leagueoflegends.com/cdn/${encodeURIComponent(data.version)}/img/champion/${encodeURIComponent(player.championAsset)}.png`;
      return `<tr><td class="analysis-player"><img src="${icon}" title="${player.champion}" alt="${player.champion}"><div><strong>${player.summoner || player.champion}</strong><small title="${player.champion}">${player.champion}</small></div></td><td class="analysis-rating"><b>${rating(player, teamDamage[player.teamId])}</b></td><td class="analysis-kda"><b>${player.kills}/${player.deaths}/${player.assists}</b><small>${kda.toFixed(2)}:1 · ${killShare}% KP</small></td><td class="analysis-damage"><b>${number(player.damage)}</b><span><i style="width:${Math.round(Number(player.damage || 0) / Math.max(1, teamDamage[player.teamId]) * 100)}%"></i></span></td><td class="analysis-vision"><b>${number(player.vision)}</b><small>vision score</small></td><td class="analysis-cs"><b>${number(player.cs)}</b><small>${csPerMin.toFixed(1)}/m</small></td><td class="analysis-items">${(player.items || []).map((item) => `<img src="https://ddragon.leagueoflegends.com/cdn/${encodeURIComponent(data.version)}/img/item/${item.id}.png" title="${item.name}" alt="${item.name}">`).join('')}</td></tr>`;
    };
    const teamTable = (players, side) => `<section class="analysis-team ${side}"><header><strong>${teamWon(players) ? 'Victory' : 'Defeat'}</strong> <span>(${side} team)</span><div class="analysis-columns"><span>Rating</span><span>KDA</span><span>Damage</span><span>Vision</span><span>CS</span><span>Items</span></div></header><table><tbody>${players.map(row).join('')}</tbody></table></section>`;
    const panel = document.createElement('section');
    panel.className = 'full-match-panel scorecard-match-panel';
    panel.innerHTML = `<div class="full-match-head"><div><p class="eyebrow">Cached full match analysis</p><h2>Match overview</h2></div><button type="button" class="close-full-match">Close</button></div>${teamTable(blue, 'blue')}<div class="versus-totals"><div><b>${blueKills}</b><span>Total kills</span><b>${redKills}</b></div><div><b>${number(blueGold)}</b><span>Total gold</span><b>${number(redGold)}</b></div><small>${duration(data.duration)} game duration</small></div>${teamTable(red, 'red')}`;
    panel.querySelector('.close-full-match').addEventListener('click', () => panel.remove());
    return panel;
  };

  const wire = () => {
    const output = document.querySelector('#lookupResult');
    if (!lookupData || !output) return;
    const candidates = new Map();
    lookupData.matches.forEach((match) => {
      const key = matchKey(match.champion, new Date(match.playedAt).toLocaleDateString(), `${match.kills} / ${match.deaths} / ${match.assists}`);
      const list = candidates.get(key) || []; list.push(match); candidates.set(key, list);
    });
    output.querySelectorAll('.recent-game:not([data-full-match])').forEach((game) => {
      const match = candidates.get(matchKey(game.querySelector('.champion-cell strong')?.textContent?.trim(), game.querySelector(':scope > div:nth-of-type(3) span')?.textContent?.trim(), game.querySelector('.match-kda b')?.textContent?.trim()))?.shift();
      game.dataset.fullMatch = 'true'; if (!match) return;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'open-full-match'; button.textContent = 'Match Analysis';
      button.addEventListener('click', async () => {
        button.disabled = true; button.textContent = 'Loading match analysis…';
        try {
          const response = await fetch(`/api/summoner/match?region=${encodeURIComponent(lookupData.profile.region)}&matchId=${encodeURIComponent(match.id)}`);
          const data = await response.json(); if (!response.ok) throw new Error(data.error);
          game.querySelector('.full-match-panel')?.remove(); game.append(render(data)); button.textContent = 'Reload analysis';
        } catch (error) { button.textContent = error.message || 'Match unavailable'; }
        finally { button.disabled = false; }
      });
      game.append(button);
    });
  };
  new MutationObserver(() => requestAnimationFrame(wire)).observe(document.querySelector('#lookupResult'), { childList: true, subtree: true });
})();

// The compact table was already the right size. Only position its headings
// above the matching existing columns.
document.head.insertAdjacentHTML('beforeend', `<style id="scorecard-heading-position">
.scorecard-match-panel .analysis-team header{display:block!important;position:relative!important}
.scorecard-match-panel .analysis-team header>strong{position:absolute;left:12px;top:10px}
.scorecard-match-panel .analysis-team header>span{position:absolute;left:64px;top:10px;margin:0!important}
.scorecard-match-panel .analysis-columns{position:absolute!important;left:31.5%!important;top:0!important;width:68.5%!important;height:36px;align-items:center;grid-template-columns:50px 78px 94px 65px 54px minmax(0,1fr)!important}
@media(max-width:850px){.scorecard-match-panel .analysis-columns{left:31.5%!important;width:68.5%!important;grid-template-columns:44px 67px 80px 57px 48px minmax(0,1fr)!important}}
</style>`);
