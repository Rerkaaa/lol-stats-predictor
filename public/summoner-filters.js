(() => {
  const queueFromText = (text) => text.includes('Ranked Solo/Duo') ? 'ranked' : text.includes('ARAM') ? 'aram' : text.includes('Arena') ? 'arena' : text.includes('Normal') ? 'normal' : 'other';

  const addFilters = () => {
    const history = document.querySelector('#lookupHistory');
    const section = history?.closest('.lookup-section');
    if (!history || !section || section.querySelector('.summoner-filters')) return;

    const filters = document.createElement('div');
    filters.className = 'summoner-filters';
    filters.innerHTML = `<label>Queue<select data-filter="queue"><option value="all">All queues</option><option value="ranked">Ranked Solo/Duo</option><option value="normal">Normal</option><option value="aram">ARAM</option><option value="arena">Arena</option><option value="other">Other</option></select></label><label>Role<select data-filter="role"><option value="all">All roles</option><option value="TOP">Top</option><option value="JUNGLE">Jungle</option><option value="MIDDLE">Mid</option><option value="BOTTOM">Bot</option><option value="UTILITY">Support</option></select></label><label>Champion<input data-filter="champion" type="search" placeholder="Search champion"></label><button type="button" class="clear-summoner-filters">Clear</button><span class="filter-count" aria-live="polite"></span>`;
    section.querySelector('.history-tabs').insertAdjacentElement('afterend', filters);

    const apply = () => {
      const queue = filters.querySelector('[data-filter="queue"]').value;
      const role = filters.querySelector('[data-filter="role"]').value;
      const champion = filters.querySelector('[data-filter="champion"]').value.trim().toLowerCase();
      const rows = [...history.querySelectorAll('.recent-game')];
      let shown = 0;
      rows.forEach((row) => {
        const text = row.textContent || '';
        const rowRole = (row.querySelector('.champion-cell span')?.textContent || '').split(' · ')[0].trim();
        const rowChampion = (row.querySelector('.champion-cell strong')?.textContent || '').toLowerCase();
        const visible = (queue === 'all' || queueFromText(text) === queue) && (role === 'all' || rowRole === role) && (!champion || rowChampion.includes(champion));
        row.hidden = !visible;
        if (visible) shown += 1;
      });
      filters.querySelector('.filter-count').textContent = `${shown} match${shown === 1 ? '' : 'es'} shown`;
    };

    filters.querySelectorAll('select,input').forEach((input) => {
      input.addEventListener('input', apply);
      input.addEventListener('change', apply);
    });
    section.querySelectorAll('[data-history]').forEach((button) => button.addEventListener('click', () => requestAnimationFrame(apply)));
    filters.querySelector('.clear-summoner-filters').addEventListener('click', () => {
      filters.querySelector('[data-filter="queue"]').value = 'all';
      filters.querySelector('[data-filter="role"]').value = 'all';
      filters.querySelector('[data-filter="champion"]').value = '';
      apply();
    });
    window.addEventListener('summoner:champion-filter', (event) => {
      const champion = event.detail;
      filters.querySelector('[data-filter="champion"]').value = champion;
      section.querySelector('[data-history="all"]')?.click();
      requestAnimationFrame(apply);
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    apply();
  };

  new MutationObserver(() => requestAnimationFrame(addFilters)).observe(document.querySelector('#lookupResult'), { childList: true, subtree: true });
})();
