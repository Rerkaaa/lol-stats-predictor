(() => {
  const syncBackground = (svg) => requestAnimationFrame(() => {
    const label = svg.querySelector('.hover-label');
    if (!label || label.hidden) return;
    let box = svg.querySelector('.hover-background');
    if (!box) {
      box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      box.classList.add('hover-background');
      box.setAttribute('rx', '4');
      box.setAttribute('fill', '#071225');
      box.setAttribute('opacity', '.94');
      svg.insertBefore(box, label);
    }
    const bounds = label.getBBox();
    box.setAttribute('x', String(bounds.x - 6));
    box.setAttribute('y', String(bounds.y - 4));
    box.setAttribute('width', String(bounds.width + 12));
    box.setAttribute('height', String(bounds.height + 8));
    box.hidden = false;
  });
  new MutationObserver(() => document.querySelectorAll('.timeline-view svg').forEach((svg) => {
    if (svg.dataset.backgroundBound) return;
    svg.dataset.backgroundBound = 'true';
    svg.addEventListener('pointermove', () => syncBackground(svg));
    svg.addEventListener('pointerleave', () => { const box = svg.querySelector('.hover-background'); if (box) box.hidden = true; });
  })).observe(document.querySelector('#lookupResult'), { childList: true, subtree: true });
})();
