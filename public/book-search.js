/** @param {string} title */
function words(title) {
  return title.normalize('NFKD').toLowerCase().replace(/[\p{M}'’]/gu, '').match(/\p{L}+|\d+/gu) ?? [];
}

for (const field of document.querySelectorAll('[data-book-filter]')) {
  if (field instanceof HTMLInputElement) initializeSearch(field);
}

/** @param {HTMLInputElement} input */
function initializeSearch(input) {
  const search = input.closest('.book-search');
  const toc = search?.nextElementSibling;
  const status = search?.querySelector('[data-book-filter-status]');
  if (!(toc instanceof HTMLElement) || !toc.matches('.book-toc') || !(status instanceof HTMLElement)) return;

  /** @type {{row: HTMLLIElement, titleWords: string[]}[]} */
  const entries = [];
  for (const link of toc.querySelectorAll('a[data-page-title], a.book-entry')) {
    // A part heading links its title page; the part stays visible while any of its entries match.
    if (link.closest('.book-part-title')) continue;
    const row = link.closest('li');
    if (!(row instanceof HTMLLIElement)) continue;
    const title = link.getAttribute('data-page-title') ?? link.querySelector('.book-entry-title')?.textContent ?? '';
    entries.push({ row, titleWords: words(title) });
  }
  const parts = Array.from(toc.querySelectorAll('.book-part')).filter(part => part instanceof HTMLElement);
  const dialog = input.closest('dialog');
  status.hidden = false;

  const update = () => {
    const query = input.value.replace(/\b(?:chapter|ch)[\s.:#-]*(?=\d)/gi, '');
    const terms = words(query);
    let matches = 0;
    for (const { row, titleWords } of entries) {
      const visible = terms.every(term => titleWords.some(word => /^\d/.test(term)
        ? /^\d/.test(word) && Number(word) === Number(term)
        : word.includes(term)));
      if (!visible && row.contains(document.activeElement)) input.focus({ preventScroll: true });
      row.hidden = !visible;
      if (visible) matches++;
    }
    for (const part of parts) {
      part.hidden = !part.querySelector(':scope > ul > li:not([hidden])');
    }
    status.textContent = !terms.length ? '' : matches === 0 ? 'No matching titles.'
      : matches === 1 ? '1 match' : matches + ' matches';
  };

  input.addEventListener('input', () => {
    update();
    if (dialog) toc.scrollTop = 0;
  });
  (dialog ?? input).addEventListener('keydown', event => {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Escape' || event.isComposing || !input.value) return;
    event.preventDefault();
    event.stopPropagation();
    input.value = '';
    update();
    input.focus({ preventScroll: true });
  });
  dialog?.addEventListener('close', () => {
    input.value = '';
    update();
  });
  window.addEventListener('pageshow', update);
  update();
}
