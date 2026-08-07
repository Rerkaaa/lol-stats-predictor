(() => {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "/qol-navigation.css?v=1";
  document.head.append(stylesheet);
  if (location.hash === "#dev") return;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const normalized = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
  const teamName = (label) => label.replace(/\s+\((?:\d[\d,]*)(?:\s+(?:games|maps))?\)\s*$/i, "").trim();
  const optionRows = (select) => [...select.options].filter((option) => option.value).map((option) => ({ id: option.value, name: teamName(option.textContent || ""), detail: (option.textContent || "").match(/\(([^)]+)\)\s*$/)?.[1] || "" }));
  const textRepairs = new Map([["â€™", "’"], ["â€˜", "‘"], ["â€œ", "“"], ["â€", "”"], ["â€“", "–"], ["â€”", "—"], ["â€¦", "…"], ["â€¢", "•"], ["Â·", "·"], ["â˜…", "★"], ["â˜†", "☆"]]);
  const repairText = (root) => {
    if (root.nodeType === Node.TEXT_NODE) {
      let value = root.nodeValue;
      textRepairs.forEach((replacement, broken) => { value = value.replaceAll(broken, replacement); });
      root.nodeValue = value;
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      let value = walker.currentNode.nodeValue;
      textRepairs.forEach((replacement, broken) => { value = value.replaceAll(broken, replacement); });
      walker.currentNode.nodeValue = value;
    }
  };
  repairText(document.body);
  new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => repairText(node)))).observe(document.body, { childList: true, subtree: true });

  function createCombobox({ input, select, onSelect }) {
    const host = document.createElement("div");
    host.className = "team-combobox";
    const search = input || document.createElement("input");
    if (!input) {
      search.type = "text";
      search.autocomplete = "off";
      search.placeholder = "Type a team name";
      select.insertAdjacentElement("afterend", host);
      host.append(search);
      select.hidden = true;
    } else {
      input.parentNode.insertBefore(host, input);
      host.append(input);
      input.removeAttribute("list");
      input.autocomplete = "off";
    }
    search.setAttribute("role", "combobox");
    search.setAttribute("aria-autocomplete", "list");
    search.setAttribute("aria-expanded", "false");
    const suggestions = document.createElement("div");
    suggestions.className = "team-suggestions";
    suggestions.hidden = true;
    suggestions.setAttribute("role", "listbox");
    host.append(suggestions);
    let highlighted = -1;

    const rows = () => optionRows(select);
    const choose = (row) => {
      search.value = row.name;
      select.value = row.id;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      search.dispatchEvent(new Event("change", { bubbles: true }));
      close();
      onSelect?.(row);
    };
    const close = () => { suggestions.hidden = true; search.setAttribute("aria-expanded", "false"); highlighted = -1; };
    const render = () => {
      const query = normalized(search.value);
      const matches = rows().filter((row) => !query || normalized(row.name).includes(query));
      highlighted = matches.length ? 0 : -1;
      suggestions.innerHTML = matches.length ? matches.map((row, index) => `<button type="button" class="team-suggestion${index === highlighted ? " active" : ""}" role="option" data-team-id="${escapeHtml(row.id)}"><span>${escapeHtml(row.name)}</span><small>${escapeHtml(row.detail)}</small></button>`).join("") : `<span class="team-no-results">No teams contain “${escapeHtml(search.value)}”.</span>`;
      suggestions.hidden = false;
      search.setAttribute("aria-expanded", "true");
      suggestions.querySelectorAll("[data-team-id]").forEach((button) => button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const row = matches.find((item) => item.id === button.dataset.teamId);
        if (row) choose(row);
      }));
    };
    const move = (direction) => {
      const buttons = [...suggestions.querySelectorAll(".team-suggestion")];
      if (!buttons.length) return;
      highlighted = (highlighted + direction + buttons.length) % buttons.length;
      buttons.forEach((button, index) => button.classList.toggle("active", index === highlighted));
      buttons[highlighted].scrollIntoView({ block: "nearest" });
    };
    search.addEventListener("focus", render);
    search.addEventListener("input", () => {
      if (select.value && normalized(rows().find((row) => row.id === select.value)?.name) !== normalized(search.value)) select.value = "";
      render();
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (suggestions.hidden) render(); else move(event.key === "ArrowDown" ? 1 : -1); }
      if (event.key === "Enter" && !suggestions.hidden) { const button = suggestions.querySelectorAll(".team-suggestion")[highlighted]; const row = button && rows().find((item) => item.id === button.dataset.teamId); if (row) { event.preventDefault(); choose(row); } }
      if (event.key === "Escape") close();
    });
    search.addEventListener("blur", () => setTimeout(close, 120));
    const observer = new MutationObserver(() => {
      const selected = rows().find((row) => row.id === select.value);
      if (selected && !search.value) search.value = selected.name;
    });
    observer.observe(select, { childList: true, subtree: true });
    return { input: search, select, rows, clear: () => { search.value = ""; select.value = ""; close(); } };
  }

  function setup() {
    const nav = document.querySelector(".nav-links");
    const valorantView = document.querySelector("#valorantView");
    const liveLeagueView = document.querySelector("#liveLeagueView");
    if (!nav || !valorantView || !liveLeagueView) return false;

    const legacy = document.createElement("div");
    legacy.className = "legacy-navigation";
    [...nav.children].forEach((button) => legacy.append(button));
    const products = document.createElement("div");
    products.className = "product-navigation";
    products.innerHTML = `<button class="product-tab" data-product="lol">League of Legends</button><button class="product-tab" data-product="valorant">Valorant</button><button class="product-tab" data-product="lookup">Summoner Lookup</button>`;
    nav.append(products, legacy);

    const header = document.querySelector("header");
    const subnav = document.createElement("div");
    subnav.className = "product-subnav";
    header.querySelector(".site-nav").insertAdjacentElement("afterend", subnav);

    const valorantLatest = document.createElement("section");
    valorantLatest.id = "valorantMatchesView";
    valorantLatest.className = "page-view valorant-latest-view";
    valorantLatest.hidden = true;
    valorantLatest.innerHTML = `<div class="matches-hero"><p class="eyebrow">2025–2026 professional data</p><h1>Latest Valorant Matches</h1><p>Browse imported series, open every played map, or filter one team and its head-to-head history.</p><p id="valorantLatestUpdated" class="muted">Loading latest series…</p></div><section class="valorant-history-controls"><label>Team<input id="valorantHistoryTeam" placeholder="Type or select a team"></label><label>Opponent <span class="optional">optional</span><input id="valorantHistoryOpponent" placeholder="Type or select an opponent"></label><button id="clearValorantHistory" type="button">Clear filters</button></section><p id="valorantHistorySummary" class="muted"></p><div id="valorantLatestSeries" class="valorant-series-list" aria-live="polite"></div>`;
    document.querySelector("#lookupView").before(valorantLatest);

    const legacyButton = (view) => legacy.querySelector(`[data-view-button="${view}"]`);
    let currentProduct = "lol", currentAction = "predict", valorantLoaded = false;
    const navItems = {
      lol: [["predict", "Predict"], ["latest", "Latest matches"], ["live", "Schedule & live"]],
      valorant: [["predict", "Predict"], ["latest", "Latest matches"], ["live", "Live matches"]],
    };
    const markNavigation = () => {
      products.querySelectorAll("[data-product]").forEach((button) => button.classList.toggle("active", button.dataset.product === currentProduct));
      subnav.querySelectorAll("[data-action]").forEach((button) => button.classList.toggle("active", button.dataset.action === currentAction));
    };
    const showCustomValorantLatest = () => {
      document.querySelectorAll(".page-view").forEach((view) => { view.hidden = view !== valorantLatest; });
      document.querySelector("#predictorHero").hidden = true;
      valorantLatest.hidden = false;
      history.replaceState(null, "", "#valorantMatches");
      if (!valorantLoaded) loadValorantSeries();
    };
    const open = (product, action = "predict") => {
      currentProduct = product;
      currentAction = action;
      if (!(product === "valorant" && action === "latest")) valorantLatest.hidden = true;
      if (product === "lookup") {
        subnav.hidden = true;
        legacyButton("lookup")?.click();
        history.replaceState(null, "", "#lookup");
      } else {
        subnav.hidden = false;
        subnav.dataset.product = product;
        subnav.innerHTML = navItems[product].map(([key, label]) => `<button type="button" data-action="${key}">${label}</button>`).join("");
        subnav.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => open(product, button.dataset.action)));
        if (product === "lol") {
          if (action === "predict") legacyButton("predictor")?.click();
          if (action === "latest") legacyButton("matches")?.click();
          if (action === "live") legacyButton("liveLeague")?.click();
        } else {
          if (action === "predict") legacyButton("valorant")?.click();
          if (action === "live") legacyButton("live")?.click();
          if (action === "latest") showCustomValorantLatest();
        }
      }
      markNavigation();
    };
    products.querySelectorAll("[data-product]").forEach((button) => button.addEventListener("click", () => open(button.dataset.product, button.dataset.product === "lookup" ? "lookup" : "predict")));
    legacy.addEventListener("click", () => { valorantLatest.hidden = true; });
    document.querySelector(".brand")?.addEventListener("click", () => open("lol", "predict"));

    const lolA = createCombobox({ select: document.querySelector("#teamA") });
    const lolB = createCombobox({ select: document.querySelector("#teamB") });
    const valorantA = createCombobox({ select: document.querySelector("#valorantTeamA") });
    const valorantB = createCombobox({ select: document.querySelector("#valorantTeamB") });
    const lolHistoryTeamSelect = document.createElement("select"), lolHistoryOpponentSelect = document.createElement("select");
    lolHistoryTeamSelect.hidden = lolHistoryOpponentSelect.hidden = true;
    document.querySelector("#matchesView").append(lolHistoryTeamSelect, lolHistoryOpponentSelect);
    const syncLolHistoryOptions = () => {
      const html = document.querySelector("#teamA").innerHTML;
      lolHistoryTeamSelect.innerHTML = html;
      lolHistoryOpponentSelect.innerHTML = html;
    };
    syncLolHistoryOptions();
    new MutationObserver(syncLolHistoryOptions).observe(document.querySelector("#teamA"), { childList: true, subtree: true });
    createCombobox({ input: document.querySelector("#historyTeam"), select: lolHistoryTeamSelect });
    createCombobox({ input: document.querySelector("#historyOpponent"), select: lolHistoryOpponentSelect });
    const historyTeamSelect = document.createElement("select"), historyOpponentSelect = document.createElement("select");
    historyTeamSelect.hidden = historyOpponentSelect.hidden = true;
    valorantLatest.append(historyTeamSelect, historyOpponentSelect);
    const syncHistoryOptions = (items) => {
      const html = `<option value="">Choose a team</option>${items.map((team) => `<option value="${team.id}">${escapeHtml(team.name)} (${team.maps} maps)</option>`).join("")}`;
      historyTeamSelect.innerHTML = html;
      historyOpponentSelect.innerHTML = html;
    };
    fetch("/api/valorant/teams?all=1").then((response) => response.ok ? response.json() : []).then(syncHistoryOptions).catch(() => syncHistoryOptions([]));
    const valorantHistoryA = createCombobox({ input: document.querySelector("#valorantHistoryTeam"), select: historyTeamSelect, onSelect: () => loadValorantSeries() });
    const valorantHistoryB = createCombobox({ input: document.querySelector("#valorantHistoryOpponent"), select: historyOpponentSelect, onSelect: () => loadValorantSeries() });

    const output = document.querySelector("#valorantLatestSeries"), summary = document.querySelector("#valorantHistorySummary"), updated = document.querySelector("#valorantLatestUpdated");
    const playerTable = (players, team) => {
      const rows = players.filter((player) => player.team === team);
      return `<table class="valorant-player-table"><thead><tr><th>${escapeHtml(team)}</th><th>Agent</th><th>ACS</th><th>K / D / A</th></tr></thead><tbody>${rows.map((player) => `<tr><td>${escapeHtml(player.player)}</td><td>${escapeHtml(player.agent || "—")}</td><td>${player.acs == null ? "—" : Number(player.acs).toFixed(0)}</td><td>${player.kills ?? "—"} / ${player.deaths ?? "—"} / ${player.assists ?? "—"}</td></tr>`).join("") || `<tr><td colspan="4">No player rows imported.</td></tr>`}</tbody></table>`;
    };
    const renderValorantSeries = (series) => {
      output.innerHTML = series.length ? series.map((item, index) => `<article class="valorant-series-card"><div class="valorant-series-head"><span class="team">${escapeHtml(item.teamA)}</span><strong class="valorant-series-score"><span>${item.teamAScore ?? 0}</span><span>–</span><span>${item.teamBScore ?? 0}</span></strong><span class="team">${escapeHtml(item.teamB)}</span><p class="valorant-series-meta">${escapeHtml(item.event || "Unknown event")} · ${item.bestOf ? `Bo${item.bestOf}` : `${item.maps.length} maps`} · ${new Date(item.playedAt).toLocaleString()}</p><button class="valorant-expand" type="button" data-series="valorant-series-${index}">View maps</button></div><div class="valorant-map-list" id="valorant-series-${index}" hidden>${item.maps.map((map) => `<details class="valorant-map-card"><summary><span>Map ${map.number}</span><strong>${escapeHtml(map.name || "Unknown map")}</strong><span>${map.teamAScore ?? 0} – ${map.teamBScore ?? 0}</span></summary><div class="valorant-player-grid">${playerTable(map.players || [], item.teamA)}${playerTable(map.players || [], item.teamB)}</div></details>`).join("") || `<p class="valorant-empty">No map rows were imported for this series.</p>`}</div></article>`).join("") : `<section class="valorant-empty">No imported Valorant series match these filters.</section>`;
      output.querySelectorAll("[data-series]").forEach((button) => button.addEventListener("click", () => {
        const panel = output.querySelector(`#${button.dataset.series}`);
        panel.hidden = !panel.hidden;
        button.textContent = panel.hidden ? "View maps" : "Hide maps";
      }));
    };
    async function loadValorantSeries() {
      valorantLoaded = true;
      const query = new URLSearchParams();
      if (historyTeamSelect.value) query.set("team", historyTeamSelect.value);
      if (historyOpponentSelect.value) query.set("opponent", historyOpponentSelect.value);
      output.innerHTML = `<section class="valorant-empty">Loading imported Valorant series…</section>`;
      const left = valorantHistoryA.rows().find((row) => row.id === historyTeamSelect.value), right = valorantHistoryB.rows().find((row) => row.id === historyOpponentSelect.value);
      summary.textContent = left ? right ? `Showing head-to-head series: ${left.name} vs ${right.name}.` : `Showing imported series for ${left.name}.` : "Showing the latest imported Valorant series.";
      try {
        const response = await fetch(`/api/valorant/latest-series${query.size ? `?${query}` : ""}`, { cache: "no-store" });
        const series = await response.json();
        if (!response.ok) throw new Error(series.error || "Latest Valorant matches are unavailable.");
        renderValorantSeries(series);
        updated.textContent = series[0]?.playedAt ? `Latest imported series: ${new Date(series[0].playedAt).toLocaleString()}` : "No imported series found.";
      } catch (error) {
        output.innerHTML = `<section class="valorant-empty">${escapeHtml(error.message || "Latest Valorant matches are temporarily unavailable.")}</section>`;
      }
    }
    document.querySelector("#clearValorantHistory").addEventListener("click", () => { valorantHistoryA.clear(); valorantHistoryB.clear(); loadValorantSeries(); });

    const initial = location.hash;
    if (initial === "#matches") open("lol", "latest");
    else if (initial === "#liveLeague") open("lol", "live");
    else if (initial === "#valorant") open("valorant", "predict");
    else if (initial === "#valorantMatches") open("valorant", "latest");
    else if (initial === "#live") open("valorant", "live");
    else if (initial === "#lookup") open("lookup", "lookup");
    else open("lol", "predict");
    void lolA; void lolB; void valorantA; void valorantB;
    return true;
  }

  let attempts = 0;
  const boot = () => { if (!setup() && attempts++ < 40) setTimeout(boot, 50); };
  boot();
})();
