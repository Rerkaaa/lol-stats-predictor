(() => {
  let currentLadder = null;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const requestUrl = String(args[0] instanceof Request ? args[0].url : args[0]);
    if (requestUrl.includes('/api/summoner?')) {
      try {
        currentLadder = (await response.clone().json()).ladder ?? null;
      } catch {
        currentLadder = null;
      }
    }
    return response;
  };

  const improveProfile = () => {
    const profile = document.querySelector('.summoner-profile');
    const icon = profile?.querySelector('.profile-icon');
    if (!profile || !icon || icon.parentElement?.classList.contains('profile-portrait')) return;

    const level = profile.querySelector('.eyebrow')?.textContent?.match(/level\s+(\d+)/i)?.[1];
    const portrait = document.createElement('div');
    portrait.className = 'profile-portrait';
    profile.insertBefore(portrait, icon);
    portrait.append(icon);
    if (level) {
      const label = document.createElement('span');
      label.className = 'profile-level';
      label.textContent = `Level ${level}`;
      portrait.append(label);
      profile.querySelector('.eyebrow')?.remove();
    }

    if (currentLadder) {
      const rankLine = profile.querySelector('.rank-line');
      if (rankLine && !rankLine.querySelector('.ladder-rank')) {
        const ladder = document.createElement('small');
        ladder.className = 'ladder-rank';
        ladder.textContent = ` · Ladder rank #${Number(currentLadder.position).toLocaleString()} (${Number(currentLadder.topPercent).toFixed(2)}% of Master+)`;
        rankLine.append(ladder);
      }
    }
  };

  new MutationObserver(improveProfile).observe(document.querySelector('#lookupResult'), { childList: true, subtree: true });
})();
