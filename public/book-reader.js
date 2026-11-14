import './reader.js';
import './book.js';

const dialog = document.getElementById('book-figure-dialog');
const comparison = dialog?.querySelector('.book-figure-comparison');
const sizeToggle = dialog?.querySelector('button[data-figure-size]');
const heading = dialog?.querySelector('h2');
const book = dialog?.closest('[data-book]')?.getAttribute('data-book');
if (dialog instanceof HTMLDialogElement && comparison instanceof HTMLElement && sizeToggle && heading && book) {
  const images = [...comparison.querySelectorAll('img')];
  const links = [...comparison.querySelectorAll('a')];
  const views = [...comparison.querySelectorAll('.book-figure-view')];
  let zoomed = false;
  let figure = '';

  function updateSize() {
    comparison?.classList.toggle('is-zoomed', zoomed);
    if (sizeToggle) sizeToggle.textContent = zoomed ? 'Fit both' : 'Zoom in';
    for (const view of views) view.scrollTo(0, 0);
  }

  for (const image of document.querySelectorAll('#article img[data-original]')) {
    if (!(image instanceof HTMLImageElement) || image.closest('a')) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'book-figure-zoom';
    const label = image.alt && !/^(img|image|image\.png)$/i.test(image.alt.trim()) ? image.alt : 'figure';
    button.setAttribute('aria-label', 'Enlarge figure: ' + label);
    image.replaceWith(button);
    button.append(image);
    const wrapper = button.parentElement;
    if (wrapper?.matches('p') && wrapper.children.length === 1 && !wrapper.textContent.trim()) {
      wrapper.classList.add('book-figure');
    } else {
      button.classList.add('book-figure');
    }
    button.addEventListener('click', () => {
      figure = image.src;
      heading.textContent = label;
      const paths = [figure, '/books/' + book + '/images/' + encodeURIComponent(image.dataset.original ?? '')];
      paths.forEach((path, i) => {
        images[i].src = path;
        images[i].alt = label;
        links[i].href = path;
      });
      comparison.style.removeProperty('--figure-native-width');
      zoomed = false;
      updateSize();
      dialog.showModal();
      const openedFigure = figure;
      void Promise.all(images.map(img => img.decode())).then(() => {
        if (figure !== openedFigure) return;
        const width = Math.max(...images.map(img => img.naturalWidth));
        comparison.style.setProperty('--figure-native-width', width + 'px');
      }).catch(() => { /* Each image can still be opened directly. */ });
    });
  }
  sizeToggle.addEventListener('click', () => {
    zoomed = !zoomed;
    updateSize();
  });

  for (const [index, view] of views.entries()) {
    const other = views[1 - index];
    view.addEventListener('scroll', () => {
      if (!zoomed) return;
      const left = view.scrollLeft * (other.scrollWidth - other.clientWidth) / Math.max(1, view.scrollWidth - view.clientWidth);
      const top = view.scrollTop * (other.scrollHeight - other.clientHeight) / Math.max(1, view.scrollHeight - view.clientHeight);
      if (Math.abs(other.scrollLeft - left) >= 1 || Math.abs(other.scrollTop - top) >= 1) other.scrollTo(left, top);
    }, { passive: true });
  }
}
