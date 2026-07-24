(() => {
  const wireChampionCards = () => {
    document.querySelectorAll('.champ-grid article:not([data-drilldown])').forEach((card) => {
      const champion = card.querySelector('b')?.textContent?.trim();
      if (!champion) return;
      card.dataset.drilldown = 'true';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Show saved matches for ${champion}`);
      const open = () => window.dispatchEvent(new CustomEvent('summoner:champion-filter', { detail: champion }));
      card.addEventListener('click', open);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
    });
  };
  new MutationObserver(() => requestAnimationFrame(wireChampionCards)).observe(document.querySelector('#lookupResult'), { childList: true, subtree: true });
})();
