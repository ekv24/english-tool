import { loadPosition } from './progress.js';
import './book.js';

function updateProgress() {
  for (const card of document.querySelectorAll('[data-material]')) {
    const position = loadPosition(card.getAttribute('data-material') ?? '');
    const percent = position?.percent ?? 0;
    const label = card.querySelector('.card-status');
    const progress = card.querySelector('progress');
    if (progress) progress.value = position?.read ? 100 : percent;
    if (label) label.textContent = position?.read ? 'Finished ✓'
      : percent ? 'At ' + percent + '%' : position?.y ? 'In progress' : 'To read';
  }
}

updateProgress();
window.addEventListener('pageshow', updateProgress);
window.addEventListener('readerstatechange', updateProgress);
