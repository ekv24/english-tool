import { readerSyncStatus, registerVocabularyReview, scheduleSync, syncReaderState } from './sync.js';

/** @typedef {import('../vocabulary-review.mjs').ReviewAction} ReviewAction */
/** @typedef {ReturnType<ReturnType<typeof import('../vocabulary-review.mjs').createVocabularyReview>>} Snapshot */

const pendingKey = 'vocabulary-review:pending';
const snapshotKey = 'vocabulary-review:snapshot';
/** @type {Snapshot | null} */
let snapshot = readCache(snapshotKey, null);
/** @type {ReviewAction | null} */
let pending = readCache(pendingKey, null);
let error = '';

const gradesKey = 'vocabulary-review:grades';

/** Grades given on this device, kept per session for the summary. @returns {{id:string, grades:Record<number,string>}} */
function readGrades() {
  return readCache(gradesKey, { id: '', grades: {} });
}

/** Puts the saved expression in the example sentence inside a highlight. @param {HTMLElement} target @param {string} sentence @param {string} text */
function showExample(target, sentence, text) {
  const at = text ? sentence.toLowerCase().indexOf(text.toLowerCase()) : -1;
  if (at < 0) { target.textContent = sentence; return; }
  const mark = document.createElement('mark');
  mark.textContent = sentence.slice(at, at + text.length);
  target.replaceChildren(sentence.slice(0, at), mark, sentence.slice(at + text.length));
}

/** @template T @param {string} key @param {T} fallback @returns {T} */
function readCache(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; }
  catch { return fallback; }
}

/** @param {Element} list */
export function initReview(list) {
  const home = /** @type {HTMLElement} */ (document.querySelector('[data-vocabulary-home]'));
  const panel = /** @type {HTMLElement} */ (document.querySelector('.review-session'));
  const launch = /** @type {HTMLElement} */ (document.querySelector('.review-launch'));
  const start = /** @type {HTMLButtonElement} */ (launch.querySelector('[data-review-start]'));
  const summary = /** @type {HTMLElement} */ (launch.querySelector('[data-review-summary]'));
  const heading = /** @type {HTMLElement} */ (panel.querySelector('[data-review-heading]'));
  const summaryLine = /** @type {HTMLElement} */ (panel.querySelector('[data-review-summary-line]'));
  const progress = /** @type {HTMLElement} */ (panel.querySelector('[data-review-progress]'));
  const position = /** @type {HTMLElement} */ (progress.querySelector('span'));
  const meter = /** @type {HTMLProgressElement} */ (progress.querySelector('progress'));
  const example = /** @type {HTMLElement} */ (panel.querySelector('[data-review-example]'));
  const translation = /** @type {HTMLElement} */ (panel.querySelector('[data-review-translation]'));
  const source = /** @type {HTMLAnchorElement} */ (panel.querySelector('[data-review-source]'));
  const status = /** @type {HTMLElement} */ (panel.querySelector('[data-review-status]'));
  const exit = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-review-exit]'));
  const actions = /** @type {HTMLElement} */ (panel.querySelector('[data-review-tools]'));
  const hint = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-review-hint]'));
  const reveal = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-review-reveal]'));
  const again = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-review-again]'));
  const remembered = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-review-remembered]'));
  const more = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-review-more]'));
  const exclude = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-review-exclude]'));

  let opened = false;
  let shown = '';
  let revealed = false;
  let hinted = false;

  /** @param {ReviewAction} action */
  function push(action) {
    if (pending) return;
    error = '';
    try { localStorage.setItem(pendingKey, JSON.stringify(action)); }
    catch {
      error = 'Browser storage is unavailable. This change could not be saved.';
      render();
      return;
    }
    pending = action;
    render();
    void syncReaderState();
    scheduleSync();
  }

  function current() {
    const session = snapshot?.session;
    if (!session) return null;
    const answered = pending?.type === 'answer' && pending.id === session.id && pending.step === session.step;
    return { ...session, step: session.step + Number(answered) };
  }

  function render() {
    const wasOpen = !panel.hidden;
    const session = current();
    const card = session?.queue[session.step];
    const available = snapshot?.available ?? 0;
    const offline = readerSyncStatus === 'unavailable';
    const waiting = pending && offline ? 'Saved on this device. Waiting to sync.' : '';
    const hasExpressions = Boolean(list.querySelector('li'));
    launch.hidden = !hasExpressions && !available && !card && !pending;
    home.hidden = opened;
    panel.hidden = !opened;
    start.hidden = !card && !available && !pending;
    start.textContent = card ? 'Continue review' : session ? 'Review more' : 'Start review';
    start.disabled = pending !== null && !card;
    if (!opened) {
      let copy;
      if (error || waiting) copy = error || waiting;
      else if (card && session) copy = (session.total - session.step) + ' left';
      else if (available && snapshot?.waiting) {
        // Show the whole backlog, not just the next round.
        const { due, fresh } = snapshot.waiting;
        copy = [due ? due + ' to repeat' : '', fresh ? fresh + ' new' : ''].filter(Boolean).join(' · ');
      }
      else if (available) copy = available + (available === 1 ? ' expression ready' : ' expressions ready');
      else if (snapshot?.nextDue) copy = 'Next review ' +
        new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(snapshot.nextDue);
      else if (!snapshot) copy = offline ? 'Review unavailable offline' : 'Checking for review…';
      else copy = 'No expressions ready';
      if (summary.textContent !== copy) summary.textContent = copy;
    }

    for (const button of list.querySelectorAll('[data-review-preference]')) {
      if (!(button instanceof HTMLButtonElement)) continue;
      const preference = snapshot?.entries[button.dataset.reviewPreference ?? ''];
      const included = preference?.preference === 'include' ||
        (preference?.preference !== 'exclude' && (preference?.suggested || Boolean(preference?.dueAt)));
      button.textContent = included ? 'Exclude from review' : 'Add to review';
      button.value = included ? 'exclude' : 'include';
      button.disabled = pending !== null;
      button.hidden = !preference;
    }

    if (!opened) return;
    const starting = pending?.type === 'start' && !card;
    const finished = Boolean(session && !card && !starting);
    const next = starting ? 'starting' : session ? session.id + ':' + session.step : '';
    const changed = shown !== next;
    if (changed) {
      shown = next;
      revealed = false;
      hinted = false;
    }
    panel.classList.toggle('has-review-card', Boolean(card));
    heading.textContent = card?.lemma ?? (starting ? 'Starting review…' :
      finished ? 'Review complete' : 'Review unavailable');
    progress.hidden = !card;
    if (card && session) {
      const number = session.step + 1;
      position.textContent = number + ' / ' + session.total;
      meter.max = session.total;
      meter.value = session.step;
      meter.setAttribute('aria-valuetext', 'Card ' + number + ' of ' + session.total);
    }
    summaryLine.hidden = !finished || !session?.total;
    if (finished && session?.total) {
      const local = readGrades();
      const grades = local.id === session.id ? Object.values(local.grades) : [];
      const again = grades.filter(grade => grade === 'again').length;
      const parts = [session.total + (session.total === 1 ? ' expression reviewed' : ' expressions reviewed')];
      if (grades.length) parts.push((grades.length - again) + ' remembered', again + ' again');
      if (!available && snapshot?.nextDue) parts.push('next review ' +
        new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(snapshot.nextDue));
      else if (!available) parts.push('nothing else due today');
      summaryLine.textContent = parts.join(' · ');
    } else summaryLine.textContent = '';
    showExample(example, card?.expression.sentence ?? '', card?.expression.text ?? '');
    example.hidden = !(card?.expression.sentence && (card.showContext || hinted || revealed));
    translation.hidden = !card || !revealed;
    translation.textContent = card?.expression.translation ?? '';
    source.hidden = translation.hidden;
    source.href = card?.expression.href ?? '/vocabulary';
    source.setAttribute('aria-label', card?.expression.title ? 'Source passage in ' + card.expression.title : 'Source passage');
    actions.hidden = !card;
    hint.hidden = !example.hidden || !example.textContent || revealed;
    exclude.disabled = pending !== null;
    exclude.textContent = pending?.type === 'preference' && pending.key === card?.sourceKey ?
      'Excluding…' : 'Exclude from review';
    reveal.hidden = !card || revealed;
    again.hidden = !card || !revealed;
    remembered.hidden = again.hidden;
    more.hidden = !finished || !available;
    more.disabled = pending !== null;
    again.disabled = pending !== null;
    remembered.disabled = pending !== null;
    const statusText = error || waiting;
    if (status.textContent !== statusText) status.textContent = statusText;
    if (!wasOpen || changed) {
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'nearest' });
    }
  }

  start.addEventListener('click', () => {
    const session = current();
    if (session?.queue[session.step]) {
      opened = true;
      shown = '';
      render();
      window.scrollTo(0, 0);
    } else if (snapshot?.available) {
      opened = true;
      push({ type: 'start', after: snapshot.session?.id ?? null });
      window.scrollTo(0, 0);
    }
  });
  more.addEventListener('click', () => {
    if (snapshot?.session && snapshot.available) push({ type: 'start', after: snapshot.session.id });
  });
  exit.addEventListener('click', () => {
    opened = false;
    render();
    const title = home.querySelector('h1');
    if (start.hidden) title?.focus();
    else start.focus();
  });
  hint.addEventListener('click', () => {
    hinted = true;
    render();
    example.focus({ preventScroll: true });
  });
  reveal.addEventListener('click', () => {
    revealed = true;
    render();
    translation.focus({ preventScroll: true });
  });
  /** @param {'again'|'remembered'} grade */
  function answer(grade) {
    const session = current();
    if (!session?.queue[session.step] || !revealed) return;
    const local = readGrades();
    const grades = local.id === session.id ? local.grades : {};
    try { localStorage.setItem(gradesKey, JSON.stringify({ id: session.id, grades: { ...grades, [session.step]: grade } })); }
    catch { /* The summary only loses its counts. */ }
    push({ type: 'answer', id: session.id, step: session.step, grade, answeredAt: Date.now() });
  }
  // Space or Enter shows the answer; 1 and 2 grade it, like most flashcard apps.
  document.addEventListener('keydown', event => {
    if (panel.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, button, a, summary')) {
      if (event.key === ' ' || event.key === 'Enter') return;
    }
    /** @param {HTMLButtonElement} button */
    const press = button => {
      if (button.hidden || button.disabled) return false;
      event.preventDefault();
      button.click();
      return true;
    };
    if (event.key === ' ' || event.key === 'Enter') press(reveal);
    else if (event.key === '1') press(again);
    else if (event.key === '2') press(remembered);
  });
  again.addEventListener('click', () => answer('again'));
  remembered.addEventListener('click', () => answer('remembered'));
  exclude.addEventListener('click', () => {
    const session = current();
    const card = session?.queue[session.step];
    if (card) push({ type: 'preference', key: card.sourceKey, preference: 'exclude' });
  });
  list.addEventListener('click', event => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const key = event.target.dataset.reviewPreference;
    const preference = event.target.value;
    if (key && (preference === 'include' || preference === 'exclude')) push({ type: 'preference', key, preference });
  });
  registerVocabularyReview(() => pending ?? true);
  window.addEventListener('vocabularyreviewchange', event => {
    if (!(event instanceof CustomEvent)) return;
    const data = event.detail;
    snapshot = data.snapshot;
    let anotherPending = false;
    try { localStorage.setItem(snapshotKey, JSON.stringify(snapshot)); }
    catch { /* The server remains the source of truth when the cache is full. */ }
    try {
      if (pending && data.request === pending) {
        const shared = readCache(pendingKey, null);
        if (JSON.stringify(shared) === JSON.stringify(pending)) localStorage.removeItem(pendingKey);
        else anotherPending = shared !== null;
        pending = readCache(pendingKey, null);
      }
    } catch { /* A confirmed server update can be fetched on the next visit. */ }
    if (anotherPending) scheduleSync();
    render();
  });
  window.addEventListener('storage', event => {
    if (event.key === pendingKey) {
      pending = readCache(pendingKey, null);
      snapshot = readCache(snapshotKey, snapshot);
      if (pending) scheduleSync();
      render();
    }
  });
  window.addEventListener('readersyncstatus', render);
  render();
  return render;
}
