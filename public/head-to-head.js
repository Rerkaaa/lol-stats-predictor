(() => {
  const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

  document.querySelector("#lolShowHeadToHead")?.addEventListener("click", () => {
    if (!a.value || !b.value || a.value === b.value) return;
    const left = teams.find((team) => String(team.id) === a.value);
    const right = teams.find((team) => String(team.id) === b.value);
    if (!left || !right) return;
    historyTeam.value = left.name;
    historyOpponent.value = right.name;
    showView("matches");
    loadHistory();
    document.querySelector("#matchesView")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelector("#valorantPredict")?.addEventListener("click", () => {
    window.setTimeout(() => {
      const panel = document.querySelector("#valorantHeadToHead");
      if (!panel || panel.querySelector("#valorantShowHeadToHead")) return;
      panel.insertAdjacentHTML("beforeend", '<button id="valorantShowHeadToHead" class="head-to-head-button" type="button">View match history</button><div id="valorantHistoryResults" class="head-to-head-results" hidden></div>');
    }, 0);
  });

  document.addEventListener("click", async (event) => {
    const button = event.target instanceof Element ? event.target.closest("#valorantShowHeadToHead") : null;
    if (!button || !valorantA.value || !valorantB.value || valorantA.value === valorantB.value) return;
    const output = document.querySelector("#valorantHistoryResults");
    if (!output) return;
    if (!output.hidden) {
      output.hidden = true;
      button.textContent = "View match history";
      return;
    }
    button.textContent = "Loading match history…";
    button.setAttribute("disabled", "");
    try {
      const response = await fetch(`/api/valorant/match-history?teamA=${encodeURIComponent(valorantA.value)}&teamB=${encodeURIComponent(valorantB.value)}`);
      const series = await response.json();
      if (!response.ok) throw new Error("Unable to load history.");
      output.innerHTML = series.length ? series.map((item) => {
        const maps = item.maps.map((map) => `<li><b>${esc(map.name)}</b> · ${esc(map.teamA)} ${map.teamAScore}–${map.teamBScore} ${esc(map.teamB)}${map.winner ? ` · ${esc(map.winner)} won` : ""}</li>`).join("");
        return `<article><p>${esc(item.event || "Valorant event")} · ${new Date(item.playedAt).toLocaleDateString()}</p><h3>${esc(item.teamA)} <strong>${item.teamAScore}–${item.teamBScore}</strong> ${esc(item.teamB)}</h3><p>Bo${item.bestOf || "?"}${item.winner ? ` · Winner: ${esc(item.winner)}` : ""}</p><ul>${maps}</ul></article>`;
      }).join("") : "<p>No imported head-to-head series found for these teams.</p>";
      output.hidden = false;
      button.textContent = "Hide match history";
    } catch {
      output.innerHTML = "<p>Match history is temporarily unavailable.</p>";
      output.hidden = false;
      button.textContent = "Hide match history";
    } finally {
      button.removeAttribute("disabled");
    }
  });
})();
