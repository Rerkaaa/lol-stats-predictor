(() => new MutationObserver(() => document.querySelectorAll('.progress-players:not([data-selection])').forEach((group) => {
  group.dataset.selection = 'true';
  group.querySelector('button')?.classList.add('active');
  group.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => group.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button))));
})).observe(document.querySelector('#lookupResult'), { childList: true, subtree: true }))();
