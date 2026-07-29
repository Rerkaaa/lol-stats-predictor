(() => {
  const controls = document.querySelector("#predictorView .controls");
  if (!controls) return;
  controls.insertAdjacentHTML("beforeend", '<label>Series<select id="lolBestOf"><option value="1" selected>Bo1</option><option value="3">Bo3</option><option value="5">Bo5</option></select></label>');
  controls.insertAdjacentHTML("afterend", '<section class="card expected-lineups"><div><h2>Expected lineup confirmation <small>(optional)</small></h2><p>Select the five players expected to start. A changed lineup reduces confidence rather than inventing statistics for a substitute.</p></div><div class="lineup-team"><h3>Team A</h3><div id="lineupAOptions" class="lineup-options">Choose Team A first.</div></div><div class="lineup-team"><h3>Team B</h3><div id="lineupBOptions" class="lineup-options">Choose Team B first.</div></div></section><section id="lolSeriesForecast" class="card series-forecast" hidden></section>');

  const selected = { A: new Set(), B: new Set() };
  const renderLineup = (side, players) => {
    const output = document.querySelector(`#lineup${side}Options`);
    if (!output) return;
    selected[side] = new Set(players.slice(0, 5).map((player) => player.name));
    output.innerHTML = players.length ? players.map((player) => `<button type="button" class="lineup-player selected" data-lineup-side="${side}" data-player="${encodeURIComponent(player.name)}"><b>${player.name}</b><span>${player.role || "role"} · ${player.games} games</span></button>`).join("") : "No roster data yet.";
  };
  const loadRoster = async (side, teamId) => {
    if (!teamId) return;
    const output = document.querySelector(`#lineup${side}Options`);
    if (output) output.textContent = "Loading recent roster…";
    try { renderLineup(side, await fetch(`/api/team-roster?team=${encodeURIComponent(teamId)}`).then((response) => response.json())); }
    catch { if (output) output.textContent = "Roster is temporarily unavailable."; }
  };
  a.addEventListener("change", () => loadRoster("A", a.value));
  b.addEventListener("change", () => loadRoster("B", b.value));
  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-lineup-side]") : null;
    if (!button) return;
    const side = button.dataset.lineupSide;
    const player = decodeURIComponent(button.dataset.player || "");
    if (!side || !player) return;
    const group = selected[side];
    if (group.has(player)) group.delete(player); else if (group.size < 5) group.add(player);
    document.querySelectorAll(`[data-lineup-side="${side}"]`).forEach((item) => item.classList.toggle("selected", group.has(decodeURIComponent(item.dataset.player || ""))));
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    if (url.startsWith("/api/matchup?")) {
      const amended = new URL(url, location.origin);
      amended.searchParams.set("bestOf", document.querySelector("#lolBestOf")?.value || "1");
      amended.searchParams.set("lineupA", [...selected.A].join(","));
      amended.searchParams.set("lineupB", [...selected.B].join(","));
      return originalFetch(amended.pathname + amended.search, init);
    }
    return originalFetch(input, init);
  };

  document.querySelector("#predict")?.addEventListener("click", () => {
    window.setTimeout(async () => {
      if (!a.value || !b.value || a.value === b.value) return;
      try {
        const response = await originalFetch(`/api/matchup?teamA=${encodeURIComponent(a.value)}&teamB=${encodeURIComponent(b.value)}&killsLine=${encodeURIComponent(killsLine.value)}&durationLine=${encodeURIComponent(durationLine.value)}&bestOf=${encodeURIComponent(document.querySelector("#lolBestOf")?.value || "1")}&lineupA=${encodeURIComponent([...selected.A].join(","))}&lineupB=${encodeURIComponent([...selected.B].join(","))}`);
        const data = await response.json();
        if (!response.ok) return;
        const panel = document.querySelector("#lolSeriesForecast");
        if (!panel) return;
        const outcomes = (data.seriesOutcomes || []).map((item) => `<li><b>${data.teamA} ${item.scoreA}–${item.scoreB} ${data.teamB}</b><span>${(item.probability * 100).toFixed(1)}%</span></li>`).join("");
        const line = data.lineup || {};
        const status = (team) => team?.expected?.length ? `${team.confirmed ? "Confirmed" : "Changed / incomplete"}: ${team.matched?.length || 0}/5 expected players match the rolling roster.` : "Using the latest recorded five-player roster.";
        panel.innerHTML = data.bestOf === 1 ? `<h2>Single-map prediction</h2><p>Bo1 selected — the win probability above is the map prediction.</p><p><b>Lineup:</b> ${status(line.teamA)} ${status(line.teamB)}</p>` : `<h2>Bo${data.bestOf} series forecast</h2><p><strong>${data.teamA}: ${(data.seriesProbabilityA * 100).toFixed(1)}%</strong> to win the series · <strong>${data.teamB}: ${(data.seriesProbabilityB * 100).toFixed(1)}%</strong></p><h3>Likely map scores</h3><ul>${outcomes}</ul><p><b>Lineup:</b> ${status(line.teamA)} ${status(line.teamB)}</p>`;
        panel.hidden = false;
      } catch { /* The normal comparison error is already displayed by the main view. */ }
    }, 0);
  });
})();
