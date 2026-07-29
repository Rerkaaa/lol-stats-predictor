(() => {
  const teamA = document.querySelector('#valorantTeamA');
  const teamB = document.querySelector('#valorantTeamB');
  const draft = document.querySelector('.valorant-draft-controls');
  if (!teamA || !teamB || !draft) return;
  const panel = document.createElement('section');
  panel.className = 'card valorant-lineup-controls';
  panel.innerHTML = '<h2>Confirmed starting five <small>(optional)</small></h2><p>Select five expected starters for each team. The tested lineup form factor activates only when both sides have five selected.</p><div class="valorant-lineup-grid"><article><h3>Team A</h3><div id="valorantLineupA">Choose a team first.</div></article><article><h3>Team B</h3><div id="valorantLineupB">Choose a team first.</div></article></div>';
  draft.insertAdjacentElement('afterend', panel);
  const style = document.createElement('style');
  style.textContent = '.valorant-lineup-controls{margin-top:14px}.valorant-lineup-controls h2,.valorant-lineup-controls p{margin:0 0 8px}.valorant-lineup-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.valorant-lineup-grid article{padding:12px;border:1px solid #70303d;border-radius:8px;background:#170d14}.valorant-lineup-grid h3{margin:0 0 8px}.valorant-lineup-player{display:flex;align-items:center;gap:7px;margin:5px 0;color:#fff1f2;font-weight:600}.valorant-lineup-player input{accent-color:#e7485d}@media(max-width:700px){.valorant-lineup-grid{grid-template-columns:1fr}}';
  document.head.append(style);
  const esc = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]);
  const targetFor = (side) => document.querySelector(side === 'A' ? '#valorantLineupA' : '#valorantLineupB');
  async function load(side) {
    const selector = side === 'A' ? teamA : teamB, target = targetFor(side);
    if (!selector.value) { target.textContent = 'Choose a team first.'; return; }
    target.textContent = 'Loading latest roster…';
    try {
      const response = await fetch(`/api/valorant/roster?team=${encodeURIComponent(selector.value)}`), players = await response.json();
      if (!response.ok || !Array.isArray(players) || !players.length) throw new Error('No roster');
      target.innerHTML = players.map((player, index) => `<label class="valorant-lineup-player"><input type="checkbox" value="${esc(player.name)}" ${index < 5 ? 'checked' : ''}> ${esc(player.name)}</label>`).join('');
    } catch { target.textContent = 'Roster data is unavailable for this team.'; }
  }
  teamA.addEventListener('change', () => load('A'));
  teamB.addEventListener('change', () => load('B'));
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    if (!raw.includes('/api/valorant/matchup?')) return nativeFetch(input, init);
    const url = new URL(raw, location.origin);
    for (const side of ['A', 'B']) {
      const selected = [...document.querySelectorAll(`#valorantLineup${side} input:checked`)].map((input) => input.value);
      if (selected.length === 5) url.searchParams.set(`lineup${side}`, selected.join(','));
    }
    return nativeFetch(url.pathname + url.search, init);
  };
})();
