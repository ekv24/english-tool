import { stateValue, storeState } from './sync.js';

/** @typedef {import('./reader-records.js').Feedback} Feedback */

/** @param {string} key @returns {Feedback} */
function feedback(key) {
  const value = stateValue(key);
  return value && typeof value === 'object' && !Array.isArray(value) && !('seconds' in value) ? /** @type {Feedback} */ (value) : {};
}

/** @param {HTMLElement} card */
function initFeedback(card) {
  const key = 'feedback:' + card.dataset.feedback;
  const note = card.querySelector('textarea');
  const details = card.querySelector('details');
  const status = card.querySelector('.feedback-status');

  function render() {
    const current = feedback(key);
    for (const button of card.querySelectorAll('button[data-interest], button[data-level]')) {
      if (!(button instanceof HTMLButtonElement)) continue;
      const field = button.dataset.interest ? 'interest' : 'level';
      button.setAttribute('aria-pressed', String(current[field] === button.dataset[field]));
    }
    if (note && document.activeElement !== note) note.value = current.note ?? '';
    if (details && current.note && !details.open) details.open = true;
  }

  /** @param {Partial<Feedback>} change */
  function update(change) {
    /** @type {Record<string, string|undefined>} */
    const next = { ...feedback(key), ...change };
    for (const [field, value] of Object.entries(next)) if (!value?.trim()) delete next[field];
    try {
      storeState(key, next);
      if (status) status.textContent = Object.keys(next).length ? 'Saved' : '';
    } catch {
      if (status) status.textContent = 'Couldn’t save. Try again.';
    }
    render();
  }

  card.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('button[data-interest], button[data-level]') : null;
    if (!(button instanceof HTMLButtonElement)) return;
    const field = button.dataset.interest ? 'interest' : 'level';
    const value = button.dataset[field];
    // Choosing the selected answer again clears it.
    update({ [field]: feedback(key)[field] === value ? undefined : value });
  });

  let timer = 0;
  const saveNote = () => {
    clearTimeout(timer);
    if (note && (feedback(key).note ?? '') !== note.value) update({ note: note.value });
  };
  note?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(saveNote, 700);
  });
  note?.addEventListener('blur', saveNote);
  window.addEventListener('pagehide', saveNote);
  window.addEventListener('readerstatechange', render);
  render();
  card.hidden = false;
}

for (const card of document.querySelectorAll('[data-feedback]')) {
  if (card instanceof HTMLElement) initFeedback(card);
}
